import { requestFields, detailKeys, type CapturedDetails } from '../domain/details';
import { checkRevision, reduceDraft, type Attachment, type Contact, type Draft, type RequestReview } from '../domain/draft';

export const LEASE_MS = 30_000;
export const MAX_ATTEMPTS = 3;
export const NEVER = Number.MAX_SAFE_INTEGER;
export type Extraction = CapturedDetails & { text: string; engine: string };
export function validateExtraction(result: Extraction) {
  if (!result || typeof result.text !== 'string' || result.text.length > 50_000 || typeof result.engine !== 'string' || !result.engine || result.engine.length > 100 || !result.fields || typeof result.fields !== 'object' || Array.isArray(result.fields)) throw new Error('Invalid extraction result.');
  for (const [key, value] of Object.entries(result.fields)) if (!['name', 'company', 'phone', 'email'].includes(key) || typeof value !== 'string' || value.length > 2000) throw new Error('Invalid extracted field.');
  if (result.request !== undefined) requestFields(result.request);
  if (result.questions !== undefined && (!Array.isArray(result.questions) || result.questions.length > 6 || result.questions.some(q => typeof q !== 'string' || q.length > 300))) throw new Error('Invalid clarification.');
  if (result.evidence !== undefined && (!result.evidence || typeof result.evidence !== 'object' || Array.isArray(result.evidence) || Object.entries(result.evidence).some(([key, value]) => !detailKeys.includes(key as typeof detailKeys[number]) || typeof value !== 'string' || value.length > 1000))) throw new Error('Invalid source evidence.');
}
export type ReviewOptions = { appendTranscript?: boolean; request?: RequestReview };
export type ProcessingJob = {
  id: string; draftId: string; attachmentId: string; kind: Attachment['kind'];
  state: 'queued' | 'running' | 'failed' | 'complete';
  attempts: number; readyAt: number; createdAt: number; updatedAt: number;
  leaseId?: string; error?: string; result?: Extraction; reviewedAt?: number;
};
export function newJob(draftId: string, attachment: Attachment, now = Date.now()): ProcessingJob {
  return { id: `${draftId}/${attachment.id}`, draftId, attachmentId: attachment.id, kind: attachment.kind, state: 'queued', attempts: 0, readyAt: now, createdAt: now, updatedAt: now };
}
export interface JobTransaction {
  job(id: string): Promise<ProcessingJob | undefined>;
  putJob(job: ProcessingJob): Promise<void>;
  next(kinds: Attachment['kind'][], now: number): Promise<ProcessingJob | undefined>;
  draft(id: string): Promise<Draft | undefined>;
  putDraft(draft: Draft): Promise<void>;
}
export interface JobDriver {
  atomic<T>(run: (tx: JobTransaction) => Promise<T>): Promise<T>;
  list(): Promise<ProcessingJob[]>;
}
export function processingRepository(driver: JobDriver) {
  const owns = (job: ProcessingJob | undefined, leaseId: string, now: number): job is ProcessingJob => !!job && job.state === 'running' && job.leaseId === leaseId && job.readyAt > now;
  return {
    jobs: () => driver.list(),
    claimJob(kinds: Attachment['kind'][], leaseId: string, now = Date.now()) {
      return driver.atomic(async tx => {
        for (;;) {
          const job = await tx.next(kinds, now);
          if (!job) return undefined;
          if (job.attempts >= MAX_ATTEMPTS) {
            await tx.putJob({ ...job, state: 'failed', readyAt: NEVER, leaseId: undefined, error: 'Processing was interrupted repeatedly. Retry when this device is ready.', updatedAt: now });
            continue;
          }
          const claimed: ProcessingJob = { ...job, state: 'running', attempts: job.attempts + 1, leaseId, readyAt: now + LEASE_MS, updatedAt: now, error: undefined };
          await tx.putJob(claimed); return claimed;
        }
      });
    },
    renewJob(id: string, leaseId: string, now = Date.now()) {
      return driver.atomic(async tx => {
        const job = await tx.job(id);
        if (!owns(job, leaseId, now)) return false;
        await tx.putJob({ ...job, readyAt: now + LEASE_MS, updatedAt: now }); return true;
      });
    },
    saveJobSource(id: string, leaseId: string, source: Extraction, now = Date.now()) {
      return driver.atomic(async tx => {
        const job = await tx.job(id);
        if (!owns(job, leaseId, now)) return false;
        validateExtraction(source);
        await tx.putJob({ ...job, result: source, updatedAt: now });
        return true;
      });
    },
    finishJob(id: string, leaseId: string, result: Extraction, now = Date.now()) {
      return driver.atomic(async tx => {
        const job = await tx.job(id);
        if (!owns(job, leaseId, now)) return false;
        validateExtraction(result);
        const draft = await tx.draft(job.draftId);
        if (!draft?.attachments.some(a => a.id === job.attachmentId)) throw new Error('The extraction source no longer belongs to this visitor.');
        const filled = reduceDraft(draft, { type: 'autofill', jobId: job.id, attachmentId: job.attachmentId, fields: result.fields, request: job.kind === 'voice' ? result.request : undefined }, new Date(now).toISOString());
        await tx.putDraft(filled);
        await tx.putJob({ ...job, state: 'complete', readyAt: NEVER, leaseId: undefined, result, updatedAt: now });
        return true;
      });
    },
    failJob(id: string, leaseId: string, error: string, now = Date.now()) {
      return driver.atomic(async tx => {
        const job = await tx.job(id);
        if (!owns(job, leaseId, now)) return false;
        const failed = job.attempts >= MAX_ATTEMPTS;
        await tx.putJob({ ...job, state: failed ? 'failed' : 'queued', readyAt: failed ? NEVER : now + 5000 * job.attempts ** 2, leaseId: undefined, error: error.slice(0, 500), updatedAt: now });
        return true;
      });
    },
    retryJob(id: string, now = Date.now()) {
      return driver.atomic(async tx => {
        const job = await tx.job(id);
        if (!job) throw new Error('Processing task not found.');
        if (job.state === 'complete' || (job.state === 'running' && job.readyAt > now)) return;
        await tx.putJob({ ...job, state: 'queued', attempts: 0, readyAt: now, leaseId: undefined, error: undefined, updatedAt: now });
      });
    },
    reviewJob(id: string, fields: Partial<Contact>, revision: number, options: ReviewOptions = {}, now = Date.now()) {
      return driver.atomic(async tx => {
        const job = await tx.job(id);
        if (!job?.result || job.state !== 'complete') throw new Error('There is no result to review yet.');
        const draft = await tx.draft(job.draftId);
        if (job.reviewedAt !== undefined && draft) return draft;
        checkRevision(draft, revision);
        if (options.request && job.kind !== 'voice') throw new Error('Request review needs a voice transcript.');
        const next = reduceDraft(draft, { type: 'reviewExtraction', jobId: job.id, attachmentId: job.attachmentId, fields, request: options.request, transcript: options.appendTranscript && job.kind === 'voice' ? job.result.text : undefined }, new Date(now).toISOString());
        await tx.putDraft(next);
        await tx.putJob({ ...job, reviewedAt: now, updatedAt: now });
        return next;
      });
    },
  };
}
export type ProcessingRepository = ReturnType<typeof processingRepository>;
