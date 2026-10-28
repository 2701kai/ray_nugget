import { createHash } from 'node:crypto';
import type { CrmReceipt } from './crm-delivery';
import type { RecordValue } from './hosted-store';
import type { LeadReceipt } from '../src/leads/types';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const hex = /^[a-f0-9]{64}$/;
export const OUTBOX_IDLE = Number.MAX_SAFE_INTEGER;
export type CrmSource = Pick<LeadReceipt, 'leadId' | 'receiptId' | 'ownerEmail' | 'ownerVersion'> & { envelope: string; envelopeSha256: string };
export type OutboxFailure = { code: 'source_missing' | 'source_invalid' | 'transport' | 'rejected' | 'attempt_limit'; at: number; status?: number };
export type OutboxHead = {
  destinationId: string; leadId: string; sequence: number; settled: number; snapshot: string;
  state: 'ready' | 'leased' | 'retry' | 'blocked' | 'idle'; wakeAt: number;
  leaseId?: string; leaseUntil?: number; failure?: OutboxFailure; receipt?: CrmReceipt;
};
export type OutboxOperation = {
  format: 'pete-crm-outbox/v1'; destinationId: string; leadId: string; sequence: number;
  operationId: string; sourceReceiptId: string; owner: { email: string; version: number };
  envelope: string; envelopeSha256: string; createdAt: number;
  state: 'queued' | 'leased' | 'retry' | 'blocked' | 'received' | 'superseded';
  attempts: number; totalAttempts: number; leaseId?: string; leaseUntil?: number;
  failure?: OutboxFailure; receipt?: CrmReceipt; lastManualRetryAt?: number;
};

export function validateCrmSource(source: CrmSource) {
  const path = source.envelope.match(/^owners\/([a-f0-9]{64})\/leads\/([a-f0-9]{64})\/([a-f0-9]{64})\.json$/);
  if (!path || source.envelopeSha256 !== path[3] || !hex.test(source.receiptId)
      || source.leadId !== sha(`pete-lead/v1/${path[1]}/${path[2]}`)
      || !source.ownerEmail || !Number.isSafeInteger(source.ownerVersion) || source.ownerVersion < 1) throw new Error('Invalid CRM queue source.');
}

/** Construct only when a destination has been explicitly enabled. The returned
 * enqueue is pure and must run inside the source/owner transaction. Large source
 * JSON stays in its immutable object; Firestore receives only small references. */
export function crmOutbox(destinationId: string, now = Date.now) {
  if (!hex.test(destinationId)) throw new Error('Invalid CRM destination identity.');
  const collection = `crmOutboxes/${destinationId}/leads`;
  const key = (leadId: string) => {
    if (!hex.test(leadId)) throw new Error('Invalid lead identity.');
    return `${collection}/${leadId}`;
  };
  const operationKey = (leadId: string, sequence: number) => `${key(leadId)}/operations/${sequence}`;
  return {
    destinationId, collection, key, operationKey,
    enqueue(records: Record<string, RecordValue | undefined>, source: CrmSource): Record<string, RecordValue> {
      validateCrmSource(source);
      const headKey = key(source.leadId);
      if (!Object.hasOwn(records, headKey)) throw new Error('Read the CRM outbox head in the source transaction.');
      const head = records[headKey] as OutboxHead | undefined;
      const snapshot = sha(JSON.stringify([source.receiptId, source.envelopeSha256, source.ownerEmail, source.ownerVersion]));
      if (head?.snapshot === snapshot) return {};
      const sequence = (head?.sequence ?? 0) + 1;
      if (!Number.isSafeInteger(sequence)) throw new Error('CRM delivery sequence is exhausted.');
      const time = now();
      const operation: OutboxOperation = {
        format: 'pete-crm-outbox/v1', destinationId, leadId: source.leadId, sequence,
        operationId: sha(`pete-crm/v1/${source.leadId}/${sequence}`), sourceReceiptId: source.receiptId,
        owner: { email: source.ownerEmail, version: source.ownerVersion }, envelope: source.envelope,
        envelopeSha256: source.envelopeSha256, createdAt: time, state: 'queued', attempts: 0, totalAttempts: 0,
      };
      const next: OutboxHead = head
        ? { ...head, sequence, snapshot, ...(head.state === 'idle' ? { state: 'ready', wakeAt: time } : {}) }
        : { destinationId, leadId: source.leadId, sequence, snapshot, settled: 0, state: 'ready', wakeAt: time };
      return { [headKey]: next, [operationKey(source.leadId, sequence)]: operation };
    },
  };
}
