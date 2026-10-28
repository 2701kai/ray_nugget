import { createHash } from 'node:crypto';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = /^[a-f0-9]{64}$/;
type HttpFetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type CrmDelivery = {
  format: 'pete-crm-delivery/v1'; operationId: string; leadId: string; sequence: number;
  sourceReceiptId: string; owner: { email: string; version: number };
  envelopeSha256: string; envelopeJson: string;
};
export type CrmReceipt = {
  format: 'pete-crm-receipt/v1'; operationId: string; leadId: string; sequence: number;
  sourceReceiptId: string; envelopeSha256: string; status: 'received' | 'superseded';
  recordId: string; receivedAt: string; messagesSent: false;
};
export class CrmDeliveryError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) { super(message); }
}

/** The caller must durably allocate sequence and persist this exact delivery
 * before sending. Neither a draft revision nor a timestamp is that sequence. */
export function prepareCrmDelivery(input: Omit<CrmDelivery, 'format' | 'operationId'>): CrmDelivery {
  if (![input.leadId, input.sourceReceiptId, input.envelopeSha256].every(v => digest.test(v))
    || !Number.isSafeInteger(input.sequence) || input.sequence < 1
    || !Number.isSafeInteger(input.owner.version) || input.owner.version < 1
    || !input.owner.email || input.owner.email.length > 254
    || sha(input.envelopeJson) !== input.envelopeSha256) throw new Error('Invalid CRM delivery source.');
  const envelope = JSON.parse(input.envelopeJson);
  if (envelope.format !== 'pete-lead/v1' || envelope.leadId !== input.leadId || envelope.receiptId !== input.sourceReceiptId) throw new Error('CRM delivery belongs to a different lead or receipt.');
  return { ...input, owner: { ...input.owner }, format: 'pete-crm-delivery/v1', operationId: sha(`pete-crm/v1/${input.leadId}/${input.sequence}`) };
}

function parseReceipt(body: unknown, sent: CrmDelivery): CrmReceipt {
  if (!body || typeof body !== 'object') throw new CrmDeliveryError('CRM returned an invalid receipt.', false);
  const row = body as Partial<CrmReceipt>;
  if (row.format !== 'pete-crm-receipt/v1' || row.operationId !== sent.operationId || row.leadId !== sent.leadId
      || row.sequence !== sent.sequence || row.sourceReceiptId !== sent.sourceReceiptId || row.envelopeSha256 !== sent.envelopeSha256
      || !['received', 'superseded'].includes(row.status ?? '') || row.recordId !== sent.leadId
      || typeof row.receivedAt !== 'string' || !Number.isFinite(Date.parse(row.receivedAt)) || row.messagesSent !== false) {
    throw new CrmDeliveryError('CRM receipt does not acknowledge this delivery.', false);
  }
  return row as CrmReceipt;
}

/** Dormant transport: no environment defaults, scheduler, browser API or live
 * destination. Tokens and customer payloads are never logged. */
export function crmDelivery(options: {
  endpoint: string; audience: string; token: (audience: string) => Promise<string>;
  fetch?: HttpFetch; timeoutMs?: number;
}) {
  const endpoint = new URL(options.endpoint), audience = new URL(options.audience);
  const local = (url: URL) => url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((endpoint.protocol !== 'https:' && !local(endpoint)) || (audience.protocol !== 'https:' && !local(audience))
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !endpoint.pathname.endsWith('/')) {
    throw new Error('CRM intake requires an explicit HTTPS endpoint ending in / (loopback is allowed for tests).');
  }
  async function request(method: 'POST' | 'GET', delivery: CrmDelivery): Promise<CrmReceipt | undefined> {
    const token = await options.token(options.audience);
    const url = method === 'POST' ? endpoint.href : `${endpoint.href}operations/${delivery.operationId}`;
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(delivery) } : {}),
      });
    } catch {
      throw new CrmDeliveryError('CRM acknowledgment is uncertain; retry the saved operation.', true);
    }
    if (method === 'GET' && response.status === 404) return undefined;
    if (!response.ok) throw new CrmDeliveryError('CRM has not acknowledged this delivery.', response.status >= 500 || [408, 429].includes(response.status), response.status);
    try { return parseReceipt(await response.json(), delivery); }
    catch (error) { if (error instanceof CrmDeliveryError) throw error; throw new CrmDeliveryError('CRM returned an invalid receipt.', false); }
  }
  return {
    async send(delivery: CrmDelivery) { return (await request('POST', delivery))!; },
    receipt(delivery: CrmDelivery) { return request('GET', delivery); },
  };
}
