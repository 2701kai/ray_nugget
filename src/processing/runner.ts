import type { Attachment } from '../domain/draft';
import type { DraftRepository } from '../storage/types';
import type { Extraction, ProcessingJob } from './jobs';

export interface Processor {
  kinds: Attachment['kind'][];
  isAvailable?(kind: Attachment['kind']): boolean;
  process(job: ProcessingJob, bytes: Uint8Array, mimeType: string, signal: AbortSignal): Promise<Extraction>;
  close(): Promise<void>;
}

// One job per kind: a long cloud transcription cannot block local card OCR.
// Storage leases also fence other tabs and restarts.
export function startProcessing(repo: DraftRepository, processor: Processor, changed: () => Promise<void>, error: (message?: string) => void, uuid: () => string) {
  const controller = new AbortController();
  type Lane = { kind: Attachment['kind']; busy: boolean; heartbeat?: ReturnType<typeof setInterval>; error?: string };
  const lanes: Lane[] = processor.kinds.map(kind => ({ kind, busy: false }));
  let reportedError: string | undefined;
  function report(lane: Lane, message?: string) {
    lane.error = message;
    const current = lanes.find(lane => lane.error)?.error;
    if (current !== reportedError) { reportedError = current; error(current); }
  }
  async function tick(lane: Lane) {
    if (lane.busy || controller.signal.aborted || processor.isAvailable?.(lane.kind) === false) return;
    lane.busy = true;
    let job: ProcessingJob | undefined;
    const leaseId = uuid();
    try {
      job = await repo.claimJob([lane.kind], leaseId);
      if (controller.signal.aborted) return;
      report(lane);
      if (!job) return;
      const activeJob = job;
      lane.heartbeat = setInterval(() => { void repo.renewJob(activeJob.id, leaseId).catch(() => undefined); }, 10_000);
      await changed();
      const draft = (await repo.list()).find(d => d.id === activeJob.draftId);
      const attachment = draft?.attachments.find(a => a.id === activeJob.attachmentId);
      const bytes = await repo.media(activeJob.draftId, activeJob.attachmentId);
      if (!attachment || !bytes) throw new Error('The original recording or photo is unavailable.');
      const result = await processor.process(activeJob, bytes, attachment.mimeType, controller.signal);
      if (!controller.signal.aborted) await repo.finishJob(activeJob.id, leaseId, result);
    } catch (e) {
      if (!controller.signal.aborted) {
        const message = e instanceof Error ? e.message : 'Processing failed. Please retry.';
        if (job) await repo.failJob(job.id, leaseId, message).catch(() => report(lane, 'Could not save processing status.'));
        else report(lane, message);
      }
    } finally {
      if (lane.heartbeat) clearInterval(lane.heartbeat);
      if (job && !controller.signal.aborted) await changed().catch(() => report(lane, 'Could not refresh processing status.'));
      lane.busy = false;
    }
  }
  const wake = () => { for (const lane of lanes) void tick(lane); };
  const timer = setInterval(wake, 1500);
  wake();
  return {
    wake,
    async close() { controller.abort(); clearInterval(timer); for (const lane of lanes) if (lane.heartbeat) clearInterval(lane.heartbeat); await processor.close(); },
  };
}
