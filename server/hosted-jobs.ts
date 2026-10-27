import { CloudError, transcriptOf, type SpeechCloud } from './google-speech';
import { MAX_VOICE_BYTES } from '../src/domain/draft';
import type { AtomicStore, RecordValue } from './hosted-store';

export class ApiError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const audioTypes = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/mpeg', 'audio/flac'];
export type HostedJob = RecordValue & {
  owner: string; id: string; objectName: string; nonce: string; bytes: number; mimeType: string;
  state: 'creating' | 'uploading' | 'verifying' | 'submitting' | 'submitted' | 'complete' | 'failed' | 'uncertain';
  createdAt: number; updatedAt: number; leaseUntil: number; nextPollAt: number;
  uploadUrl?: string; operation?: string; text?: string; error?: string; cleanupPending?: boolean;
};
export interface UploadStorage {
  begin(name: string, mimeType: string, bytes: number, origin: string): Promise<string>;
  inspect(name: string): Promise<{ bytes: number; sha256: string; mimeType: string } | undefined>;
}
export function hostedJobs(store: AtomicStore, cloud: SpeechCloud, uploads: UploadStorage, clock = Date.now, uuid = () => crypto.randomUUID()) {
  const keyOf = (owner: string, id: string) => `jobs/${owner}_${id}`;
  async function change(key: string, predicate: (job: HostedJob) => boolean, patch: Partial<HostedJob>) {
    return store.atomic([key], records => {
      const current = records[key] as HostedJob | undefined;
      if (!current || !predicate(current)) return { result: false };
      return { result: true, writes: { [key]: { ...current, ...patch, updatedAt: clock() } } };
    });
  }
  async function cleanup(key: string, job: HostedJob) {
    try {
      await cloud.remove(job.objectName);
      await change(key, current => current.nonce === job.nonce && ['complete', 'failed'].includes(current.state), { cleanupPending: false });
    } catch { /* A subsequent status request retries; bucket lifecycle is the fallback. */ }
  }
  async function get(owner: string, id: string): Promise<HostedJob | undefined> {
    const key = keyOf(owner, id);
    const job = await store.read<HostedJob>(key);
    if (!job) return;
    if (job.state === 'submitting' && job.leaseUntil < clock()) {
      await change(key, current => current.state === 'submitting' && current.nonce === job.nonce && current.leaseUntil < clock(), { state: 'uncertain', error: 'Submission was interrupted. An administrator must check the Google operation before retrying.' });
    } else if (job.state === 'verifying' && job.leaseUntil < clock()) {
      await change(key, current => current.state === 'verifying' && current.nonce === job.nonce, { state: 'uploading', leaseUntil: 0 });
    } else if (['creating', 'uploading'].includes(job.state) && job.createdAt + 24 * 60 * 60 * 1000 < clock()) {
      await change(key, current => current.nonce === job.nonce && ['creating', 'uploading'].includes(current.state), { state: 'failed', error: 'This upload expired. Retry the saved original.', cleanupPending: true });
    } else if (job.state === 'submitted' && job.operation && job.nextPollAt <= clock()) {
      const claimed = await change(key, current => current.state === 'submitted' && current.nonce === job.nonce && current.nextPollAt <= clock(), { nextPollAt: clock() + 3000 });
      if (claimed) {
        const operation = await cloud.operation(job.operation);
        if (operation.done) {
          let result: Partial<HostedJob>;
          try { result = { state: 'complete', text: transcriptOf(operation), error: undefined, cleanupPending: true }; }
          catch (error) { result = { state: 'failed', error: error instanceof Error ? error.message : 'Google could not transcribe this recording.', cleanupPending: true }; }
          await change(key, current => current.nonce === job.nonce && current.state === 'submitted', result);
        }
      }
    }
    const latest = (await store.read<HostedJob>(key))!;
    if (latest.cleanupPending && ['complete', 'failed'].includes(latest.state)) await cleanup(key, latest);
    return (await store.read<HostedJob>(key))!;
  }
  async function init(owner: string, id: string, bytes: number, mimeType: string, origin: string, retry = false) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_VOICE_BYTES) throw new ApiError('Choose a non-empty recording up to 60 MiB.', 413);
    if (!audioTypes.includes(mimeType)) throw new ApiError('Unsupported audio format.', 415);
    const key = keyOf(owner, id);
    const day = new Date(clock()).toISOString().slice(0, 10);
    const quota = `quotas/${owner}_${day}`;
    const total = `quotas/global_${day}`;
    const nonce = uuid();
    const claimed = await store.atomic([key, quota, total], records => {
      const current = records[key] as HostedJob | undefined;
      if (current && !(current.state === 'failed' && retry) && !(current.state === 'creating' && current.leaseUntil < clock())) return { result: false };
      const userCount = Number(records[quota]?.count ?? 0);
      const totalCount = Number(records[total]?.count ?? 0);
      if (userCount >= 40 || totalCount >= 200) throw new ApiError('Today’s pilot processing allowance has been reached. Your original remains saved.', 429);
      const job: HostedJob = { owner, id, nonce, objectName: `hosted/${owner}/${id}/${nonce}.audio`, bytes, mimeType, state: 'creating', createdAt: clock(), updatedAt: clock(), leaseUntil: clock() + 90_000, nextPollAt: 0 };
      return { result: true, writes: { [key]: job, [quota]: { count: userCount + 1 }, [total]: { count: totalCount + 1 } } };
    });
    if (claimed) {
      const job = (await store.read<HostedJob>(key))!;
      try {
        const uploadUrl = await uploads.begin(job.objectName, mimeType, bytes, origin);
        await change(key, current => current.nonce === nonce && current.state === 'creating', { state: 'uploading', uploadUrl, leaseUntil: 0 });
      } catch {
        await change(key, current => current.nonce === nonce && current.state === 'creating', { state: 'failed', error: 'Could not prepare the upload. Retry the saved recording.' });
      }
    }
    return (await get(owner, id))!;
  }
  async function submit(owner: string, id: string) {
    const key = keyOf(owner, id);
    const job = await get(owner, id);
    if (!job) throw new ApiError('Recording not found.', 404);
    if (job.state !== 'uploading') return job;
    if (!(await change(key, current => current.state === 'uploading' && current.nonce === job.nonce, { state: 'verifying', leaseUntil: clock() + 90_000 }))) return (await get(owner, id))!;
    try {
      const original = await uploads.inspect(job.objectName);
      if (!original) {
        await change(key, current => current.state === 'verifying' && current.nonce === job.nonce, { state: 'uploading', leaseUntil: 0 });
        return (await get(owner, id))!;
      }
      if (original.bytes !== job.bytes || original.sha256 !== id || original.mimeType !== job.mimeType) throw new ApiError('The upload does not match the saved recording. Retry the original.');
      const claimed = await change(key, current => current.state === 'verifying' && current.nonce === job.nonce, { state: 'submitting', leaseUntil: clock() + 120_000, uploadUrl: undefined });
      if (!claimed) return (await get(owner, id))!;
      const operation = await cloud.submit(job.objectName);
      await change(key, current => current.state === 'submitting' && current.nonce === job.nonce, { state: 'submitted', operation, leaseUntil: 0, nextPollAt: clock() + 3000 });
    } catch (error) {
      const current = await store.read<HostedJob>(key);
      const uncertain = current?.state === 'submitting' && (!(error instanceof CloudError) || !error.definitive);
      await change(key, current => current.nonce === job.nonce && ['submitting', 'verifying'].includes(current.state), {
        state: uncertain ? 'uncertain' : 'failed', cleanupPending: !uncertain,
        error: uncertain ? 'Google submission could not be confirmed. An administrator must check before retrying.' : error instanceof Error ? error.message : 'Processing failed. Retry the original.',
        uploadUrl: undefined,
      });
    }
    return (await get(owner, id))!;
  }
  return { get, init, submit };
}
