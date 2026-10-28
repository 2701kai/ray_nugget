import { expect, test } from 'bun:test';
import { crmDelivery, prepareCrmDelivery, type CrmReceipt } from '../server/crm-delivery';
import { crmTestFixtures } from '../scripts/crm-test-fixtures';

const fixture = (await crmTestFixtures())[0];
const receipt: CrmReceipt = { format: 'pete-crm-receipt/v1', operationId: fixture.operationId, leadId: fixture.leadId,
  sequence: fixture.sequence, sourceReceiptId: fixture.sourceReceiptId, envelopeSha256: fixture.envelopeSha256,
  status: 'received', recordId: fixture.leadId, receivedAt: '2026-10-28T12:00:00Z', messagesSent: false };
const options = { endpoint: 'https://crm.example.test/api/v1/pete-intake/', audience: 'https://crm.example.test', token: async () => 'synthetic' };
const reply = (body: unknown, status = 200) => async () => Response.json(body, { status });

test('CRM operation binds the exact source and a durable sequence, including owner-only changes', () => {
  expect(prepareCrmDelivery(fixture)).toEqual(fixture);
  const assigned = prepareCrmDelivery({ ...fixture, sequence: 2, owner: { email: 'second@example.test', version: 2 } });
  expect(assigned.operationId).not.toBe(fixture.operationId);
  expect(assigned.envelopeSha256).toBe(fixture.envelopeSha256);
  expect(assigned.sourceReceiptId).toBe(fixture.sourceReceiptId);
  for (const sequence of [0, -1, Number.MAX_SAFE_INTEGER + 1, 1.2]) expect(() => prepareCrmDelivery({ ...fixture, sequence })).toThrow();
  expect(() => prepareCrmDelivery({ ...fixture, envelopeJson: fixture.envelopeJson + ' ' })).toThrow();
  expect(() => prepareCrmDelivery({ ...fixture, sourceReceiptId: '0'.repeat(64) })).toThrow();
});

test('CRM transport sends only to an explicit protected endpoint, with no redirects', async () => {
  let called = false;
  const api = crmDelivery({ ...options, token: async audience => { expect(audience).toBe(options.audience); return 'synthetic'; },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe(options.endpoint); expect(init?.redirect).toBe('error');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer synthetic' });
      expect(JSON.parse(init?.body as string)).toEqual(fixture); called = true;
      return Response.json(receipt);
    }) });
  expect(await api.send(fixture)).toEqual(receipt); expect(called).toBe(true);
  for (const endpoint of ['http://public.example.test/', 'https://user:secret@crm.example.test/', 'https://crm.example.test/?redirect=x', 'https://crm.example.test/no-slash']) {
    expect(() => crmDelivery({ ...options, endpoint })).toThrow();
  }
});

test('CRM acknowledgment must bind every identity, status and no-message condition', async () => {
  for (const change of [{ operationId: '0'.repeat(64) }, { leadId: '0'.repeat(64) }, { sequence: 9 }, { sourceReceiptId: '0'.repeat(64) },
    { envelopeSha256: '0'.repeat(64) }, { recordId: 'other' }, { receivedAt: 'invalid' }, { status: 'queued' }, { messagesSent: true }]) {
    await expect(crmDelivery({ ...options, fetch: reply({ ...receipt, ...change }) }).send(fixture)).rejects.toMatchObject({ retryable: false });
  }
  // Generic HTTP 202 is never proof of intake, even if the response says OK.
  await expect(crmDelivery({ ...options, fetch: reply({ ok: true }, 202) }).send(fixture)).rejects.toThrow('receipt');
  expect(await crmDelivery({ ...options, fetch: reply({ ...receipt, status: 'superseded' }) }).send(fixture)).toMatchObject({ status: 'superseded' });
});

test('CRM timeout, rejection and missing-receipt states stay distinct', async () => {
  for (const status of [408, 429, 500, 503]) await expect(crmDelivery({ ...options, fetch: reply({}, status) }).send(fixture)).rejects.toMatchObject({ retryable: true, status });
  for (const status of [400, 403, 409, 413]) await expect(crmDelivery({ ...options, fetch: reply({}, status) }).send(fixture)).rejects.toMatchObject({ retryable: false, status });
  const api = crmDelivery({ ...options, fetch: async () => { throw new Error('Synthetic network interruption'); } });
  await expect(api.send(fixture)).rejects.toMatchObject({ retryable: true });
  expect(await crmDelivery({ ...options, fetch: reply({}, 404) }).receipt(fixture)).toBeUndefined();
});

test('temporary identity and truncated-response failures can recover, without submitting after token timeout', async () => {
  let calls = 0;
  const unavailable = crmDelivery({ ...options, timeoutMs: 5, token: async () => new Promise<string>(() => {}), fetch: async () => { calls++; return Response.json(receipt); } });
  await expect(unavailable.send(fixture)).rejects.toMatchObject({ retryable: true });
  expect(calls).toBe(0);
  await expect(crmDelivery({ ...options, token: async () => { throw new Error('Synthetic identity failure'); } }).send(fixture)).rejects.toMatchObject({ retryable: true });
  await expect(crmDelivery({ ...options, fetch: async () => new Response('{') }).send(fixture)).rejects.toMatchObject({ retryable: true });
});
