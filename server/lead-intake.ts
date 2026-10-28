import { createHash } from 'node:crypto';
import type { BackupSnapshot } from '../src/backup/archive';
import { rfqGaps } from '../src/domain/draft';
import { reviewChanges } from '../src/processing/review';
import type { LeadReceipt } from '../src/leads/types';
import type { CloudCopy } from './cloud-backups';
import type { hostedStorage } from './hosted-storage';
import type { AtomicStore, RecordValue } from './hosted-store';
import { ApiError } from './hosted-jobs';
import type { crmOutbox } from './crm-outbox';

export type TeamContext = { id: string; actor: string; event: string; members: string[] };
const hash = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
const keyOf = (scope: string, id: string) => `cloudOwners/${scope}/leads/${id}`;
type IntakeRecord = LeadReceipt & { envelope: string; envelopeSha256: string; firstReceivedAt: string };

/** Non-sending intake. Its only effects are immutable storage and atomic receipts. */
export function leadIntake(store: AtomicStore, storage: ReturnType<typeof hostedStorage>, now: () => number, outbox?: ReturnType<typeof crmOutbox>) {
  return {
    async prepare(scope: string, id: string, snapshot: Omit<BackupSnapshot, 'media'>, fingerprint: string, team: TeamContext) {
      const { draft, jobs } = snapshot;
      const leadId = hash(`pete-lead/v1/${scope}/${id}`);
      const receiptId = hash(`${leadId}/${fingerprint}`);
      const key = keyOf(scope, id), receiptKey = `${key}/receipts/${receiptId}`;
      const content = !!(draft.attachments.length || draft.entries?.length || draft.note.trim() || Object.values(draft.contact).some(v => v.trim()) || draft.request.intent !== 'unspecified' || draft.request.product.trim() || draft.request.packaging.trim() || draft.request.throughput.trim());
      const payload = {
        format: 'pete-lead/v1', leadId, receiptId,
        workspace: { id: team.id, event: team.event },
        source: { draftId: draft.id, revision: draft.revision, fingerprint, createdAt: draft.createdAt, updatedAt: draft.updatedAt },
        contact: draft.contact, request: draft.request, event: draft.event,
        note: draft.note, entries: draft.entries ?? [], provenance: draft.provenance,
        sources: draft.attachments.map(attachment => {
          const job = jobs.find(j => j.attachmentId === attachment.id);
          return { ...attachment, processing: { state: job?.result ? 'complete' : 'pending', ...(job?.result ? { result: job.result } : {}), ...(job?.reviewedAt !== undefined ? { reviewedAt: job.reviewedAt } : {}) } };
        }),
        readiness: {
          // Filling criteria are not a seller-machine specification or a
          // universal definition of a qualified sales lead.
          fillingRequirementsMissing: draft.request.intent === 'sell' ? null : rfqGaps(draft.request),
          pendingSources: draft.attachments.filter(a => !jobs.some(j => j.attachmentId === a.id && j.result)).map(a => a.id),
          changesToReview: jobs.flatMap(job => reviewChanges(draft, job).filter(c => !c.superseded).map(c => ({ attachmentId: job.attachmentId, field: c.key }))),
        },
        permissions: { inquiry: 'not_collected', followup: 'not_collected', newsletter: 'not_collected' },
      };
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      const envelopeSha256 = hash(bytes);
      // Content-addressing also keeps a future envelope migration from reusing
      // an old immutable object path for different bytes.
      const envelope = `owners/${scope}/leads/${id}/${envelopeSha256}.json`;
      await storage.put(envelope, bytes);
      return {
        keys: [key, receiptKey, ...(outbox ? [outbox.key(leadId)] : [])],
        commit(records: Record<string, RecordValue | undefined>, previous?: CloudCopy) {
          const current = records[key] as IntakeRecord | undefined;
          if (!content && !current) return { lead: undefined, writes: {} };
          const existing = records[receiptKey] as IntakeRecord | undefined;
          if (existing && existing.envelopeSha256 !== envelopeSha256) throw new ApiError('This intake receipt already refers to different details.', 409);
          // A receipt replay can acknowledge the current snapshot, never roll
          // a lead back to an older accepted source or owner assignment.
          if (existing && current?.sourceFingerprint !== fingerprint) throw new ApiError('A newer lead receipt is already saved. Refresh the visitor.', 409);
          const receivedAt = new Date(now()).toISOString();
          const record: IntakeRecord = existing ?? {
            leadId, receiptId, sourceFingerprint: fingerprint, sourceRevision: draft.revision,
            state: 'received', crmState: 'not_connected', receivedAt, receivedBy: team.actor,
            ownerEmail: current?.ownerEmail || previous?.createdBy || team.actor,
            ownerVersion: current?.ownerVersion || 1,
            ownerAssignedAt: current?.ownerAssignedAt || receivedAt,
            ownerAssignedBy: current?.ownerAssignedBy || team.actor,
            envelope, envelopeSha256, firstReceivedAt: current?.firstReceivedAt || receivedAt,
          };
          // Assignment changes are separate from immutable receipt history.
          const latest = existing && current ? current : record;
          const { envelope: _object, envelopeSha256: _hash, firstReceivedAt: _first, ...lead } = latest;
          return { lead, writes: { ...(existing ? {} : { [key]: record, [receiptKey]: record }), ...outbox?.enqueue(records, latest) } };
        },
      };
    },
    async assign(scope: string, id: string, team: TeamContext, email: unknown, expectedVersion: unknown) {
      if (typeof email !== 'string' || !team.members.includes(email) || !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) throw new ApiError('Choose a current team member and refresh the lead owner.');
      const key = keyOf(scope, id), copyKey = `cloudOwners/${scope}/drafts/${id}`;
      const leadId = hash(`pete-lead/v1/${scope}/${id}`);
      return store.atomic([key, copyKey, ...(outbox ? [outbox.key(leadId)] : [])], records => {
        const current = records[key] as IntakeRecord | undefined, copy = records[copyKey] as CloudCopy | undefined;
        if (!current || !copy?.lead) throw new ApiError('The lead is still waiting to reach company storage.', 409);
        // A lost successful response may be retried with the same old version.
        if (current.ownerEmail === email && (current.ownerVersion === expectedVersion || (current.ownerVersion === Number(expectedVersion) + 1 && current.ownerAssignedBy === team.actor))) return { result: copy, writes: outbox?.enqueue(records, current) };
        if (current.ownerVersion !== expectedVersion) throw new ApiError('Someone changed the lead owner. Refresh before choosing again.', 409);
        const next: IntakeRecord = { ...current, ownerEmail: email, ownerVersion: current.ownerVersion + 1, ownerAssignedAt: new Date(now()).toISOString(), ownerAssignedBy: team.actor };
        const { envelope: _object, envelopeSha256: _hash, firstReceivedAt: _first, ...lead } = next;
        const saved = { ...copy, lead };
        const auditKey = `${key}/assignments/${next.ownerVersion}`;
        return { result: saved, writes: { [key]: next, [copyKey]: saved, [auditKey]: { ownerEmail: email, version: next.ownerVersion, assignedAt: next.ownerAssignedAt, assignedBy: team.actor }, ...outbox?.enqueue(records, next) } };
      });
    },
  };
}
