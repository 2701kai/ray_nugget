import type { Draft } from '../domain/draft';
import type { ProcessingJob } from '../processing/jobs';
import { reviewChanges } from '../processing/review';

// Advice can still be requested manually with incomplete sources. Automatic
// continuation waits for new answers to settle and for actual conflicts to clear.
export function continuationBlock(draft: Draft, jobs: ProcessingJob[]): 'processing' | 'failed' | 'review' | undefined {
  const latest = [...(draft.ray ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const fresh = draft.attachments.filter(a => a.kind === 'voice' && (latest?.sourceIds ? !latest.sourceIds.includes(a.id) : !latest || a.capturedAt >= latest.createdAt));
  for (const a of fresh) {
    const job = jobs.find(j => j.draftId === draft.id && j.attachmentId === a.id);
    if (job?.state === 'failed') return 'failed';
    if (!job || job.state !== 'complete') return 'processing';
    if (reviewChanges(draft, job).some(c => !c.superseded) || job.reviewedAt === undefined && job.result?.questions?.length) return 'review';
  }
}

export type ContinuationSession = { enabled: boolean; attempts: number; lastSource?: string; lastAt: number };
export const MAX_AUTOMATIC_CONSULTATIONS = 12;
export const MIN_CONSULTATION_INTERVAL = 3000;
export function canContinue(session: ContinuationSession | undefined, source: string, now: number) {
  return !!session?.enabled && session.attempts < MAX_AUTOMATIC_CONSULTATIONS && source !== session.lastSource && now - session.lastAt >= MIN_CONSULTATION_INTERVAL;
}
