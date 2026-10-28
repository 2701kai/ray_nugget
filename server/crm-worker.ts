import type { Firestore } from 'firebase-admin/firestore';
import { crmDelivery, CrmDeliveryError, prepareCrmDelivery, parseCrmReceipt, type CrmReceipt, type CrmDelivery } from './crm-delivery';
import { crmOutbox, OUTBOX_IDLE, validateCrmSource, type OutboxHead, type OutboxOperation, type OutboxFailure } from './crm-outbox';
import type { AtomicStore } from './hosted-store';

class SourceError extends Error {
  constructor(readonly code: 'source_missing' | 'source_invalid', readonly retryable: boolean) { super(code); }
}

/** Invoked by a bounded job, never by an open browser or a fire-and-forget HTTP
 * callback. No environment defaults, live scheduler, or CRM activation here. */
export function crmWorker(options: {
  store: AtomicStore; transport: ReturnType<typeof crmDelivery>;
  readSource: (path: string) => Promise<string | undefined>;
  due?: (now: number, limit: number) => Promise<string[]>;
  now?: () => number; leaseMs?: number; maxAttempts?: number; random?: () => number;
}) {
  const { store, transport } = options;
  const now = options.now ?? Date.now, random = options.random ?? Math.random;
  const leaseMs = options.leaseMs ?? 120_000, maxAttempts = options.maxAttempts ?? 8;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('Invalid CRM worker limits.');
  const queue = crmOutbox(transport.destinationId, now);
  async function claim(leadId: string) {
    const key = queue.key(leadId), seen = await store.read<OutboxHead>(key);
    if (!seen || seen.wakeAt > now() || ['idle', 'blocked'].includes(seen.state)) return;
    const sequence = seen.settled + 1, opKey = queue.operationKey(leadId, sequence), leaseId = crypto.randomUUID();
    return store.atomic([key, opKey], records => {
      const head = records[key] as OutboxHead | undefined, operation = records[opKey] as OutboxOperation | undefined;
      if (!head || head.settled + 1 !== sequence || head.wakeAt > now() || ['idle', 'blocked'].includes(head.state)) return { result: undefined };
      if (!operation || operation.destinationId !== transport.destinationId || operation.leadId !== leadId || operation.sequence !== sequence) {
        return { result: undefined, writes: { [key]: { ...head, state: 'blocked', wakeAt: OUTBOX_IDLE, failure: { code: 'source_invalid', at: now() } } } };
      }
      const leaseUntil = now() + leaseMs;
      const next: OutboxOperation = { ...operation, state: 'leased', leaseId, leaseUntil, attempts: operation.attempts + 1, totalAttempts: operation.totalAttempts + 1 };
      return { result: next, writes: { [key]: { ...head, state: 'leased', leaseId, leaseUntil, wakeAt: leaseUntil }, [opKey]: next } };
    });
  }
  async function finish(operation: OutboxOperation, outcome: { receipt: CrmReceipt } | { failure: OutboxFailure; retryable: boolean }) {
    const key = queue.key(operation.leadId), opKey = queue.operationKey(operation.leadId, operation.sequence);
    return store.atomic([key, opKey], records => {
      const head = records[key] as OutboxHead | undefined, row = records[opKey] as OutboxOperation | undefined;
      // An expired/replaced worker cannot overwrite a newer lease or receipt.
      if (!head || !row || head.leaseId !== operation.leaseId || row.leaseId !== operation.leaseId
          || head.settled + 1 !== operation.sequence || (head.leaseUntil ?? 0) <= now()) return { result: 'stale' as const };
      if ('receipt' in outcome) {
        const state = operation.sequence === head.sequence ? 'idle' : 'ready';
        return { result: 'acknowledged' as const, writes: {
          [key]: { ...head, settled: operation.sequence, state, wakeAt: state === 'idle' ? OUTBOX_IDLE : now(), receipt: outcome.receipt, leaseId: undefined, leaseUntil: undefined, failure: undefined },
          [opKey]: { ...row, state: outcome.receipt.status, receipt: outcome.receipt, leaseId: undefined, leaseUntil: undefined, failure: undefined },
        } };
      }
      // One final receipt-only attempt follows the last possible submission.
      // A response lost on that submission must still be recoverable.
      const retry = outcome.retryable && operation.attempts <= maxAttempts;
      const delay = Math.round(Math.min(3_600_000, 5000 * 2 ** Math.min(operation.attempts - 1, 10)) * (0.75 + random() * 0.5));
      const state = retry ? 'retry' : 'blocked';
      return { result: state, writes: {
        [key]: { ...head, state, wakeAt: retry ? now() + delay : OUTBOX_IDLE, failure: outcome.failure, leaseId: undefined, leaseUntil: undefined },
        [opKey]: { ...row, state, failure: outcome.failure, leaseId: undefined, leaseUntil: undefined },
      } };
    });
  }
  async function run(leadId: string) {
    const operation = await claim(leadId);
    if (!operation) return 'skipped';
    let receipt: CrmReceipt, delivery: CrmDelivery;
    try {
      try { validateCrmSource({ ...operation, receiptId: operation.sourceReceiptId, ownerEmail: operation.owner.email, ownerVersion: operation.owner.version }); }
      catch { throw new SourceError('source_invalid', false); }
      const source = await options.readSource(operation.envelope);
      if (source === undefined) throw new SourceError('source_missing', true);
      try {
        delivery = prepareCrmDelivery({ leadId: operation.leadId, sequence: operation.sequence, sourceReceiptId: operation.sourceReceiptId,
          owner: operation.owner, envelopeSha256: operation.envelopeSha256, envelopeJson: source });
        if (operation.format !== 'pete-crm-outbox/v1' || delivery.operationId !== operation.operationId) throw new Error('Invalid operation binding.');
      } catch { throw new SourceError('source_invalid', false); }
      const recovered = await transport.receipt(delivery);
      if (recovered) receipt = recovered;
      else {
        if (operation.attempts > maxAttempts) return finish(operation, { failure: { code: 'attempt_limit', at: now() }, retryable: false });
        const current = await store.read<OutboxHead>(queue.key(leadId));
        if (!current || current.leaseId !== operation.leaseId || (current.leaseUntil ?? 0) <= now()) return 'stale';
        receipt = await transport.send(delivery);
      }
      // Check again at the persistence boundary, including injected transports.
      receipt = parseCrmReceipt(receipt, delivery);
    } catch (error) {
      const failure: OutboxFailure = { code: error instanceof SourceError ? error.code : error instanceof CrmDeliveryError && !error.retryable ? 'rejected' : 'transport',
        at: now(), ...(error instanceof CrmDeliveryError && error.status ? { status: error.status } : {}) };
      return finish(operation, { failure, retryable: error instanceof SourceError || error instanceof CrmDeliveryError ? error.retryable : true });
    }
    // Keep persistence failure outside transport failure handling. A restart
    // must query the immutable destination receipt instead of inventing failure.
    return finish(operation, { receipt });
  }
  return {
    run,
    status: (leadId: string) => store.read<OutboxHead>(queue.key(leadId)),
    async drain(limit = 20) {
      if (!options.due) throw new Error('Provide an explicit outbox discovery query.');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Use a batch size from 1 to 100.');
      const leads = [...new Set(await options.due(now(), limit))].slice(0, limit);
      const results = [];
      while (leads.length && results.length < limit) {
        const leadId = leads.shift()!, outcome = await run(leadId);
        results.push({ leadId, outcome });
        if (outcome === 'acknowledged') {
          const head = await store.read<OutboxHead>(queue.key(leadId));
          if (head?.state === 'ready' && head.wakeAt <= now()) leads.push(leadId);
        }
      }
      return results;
    },
    /** Trusted operator action only; no browser route exposes it. */
    async retryBlocked(leadId: string, operationId: string, expectedAttempts: number) {
      const key = queue.key(leadId), seen = await store.read<OutboxHead>(key);
      if (!seen) return false;
      const opKey = queue.operationKey(leadId, seen.settled + 1);
      return store.atomic([key, opKey], records => {
        const head = records[key] as OutboxHead | undefined, row = records[opKey] as OutboxOperation | undefined;
        if (!head || head.settled !== seen.settled || head.state !== 'blocked' || row?.state !== 'blocked'
            || row.operationId !== operationId || row.totalAttempts !== expectedAttempts) return { result: false };
        return { result: true, writes: {
          [key]: { ...head, state: 'ready', wakeAt: now(), failure: undefined },
          [opKey]: { ...row, state: 'queued', attempts: 0, failure: undefined, lastManualRetryAt: now() },
        } };
      });
    },
  };
}

export function firestoreCrmDue(db: Firestore, destinationId: string) {
  const queue = crmOutbox(destinationId);
  return async (now: number, limit: number) => {
    const result = await db.collection(queue.collection).where('wakeAt', '<=', now).orderBy('wakeAt').limit(limit).get();
    return result.docs.map(doc => doc.id);
  };
}
