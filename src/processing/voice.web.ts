import type { Extraction, ProcessingJob } from './jobs';
import { contactCandidates } from './contact';

export const gateway = process.env.EXPO_PUBLIC_PROCESSING_URL?.replace(/\/$/, '');
type ResponseBody = { state: string; text?: string; error?: string; engine?: string };
export async function transcribe(job: ProcessingJob, bytes: Uint8Array, mimeType: string, signal: AbortSignal): Promise<Extraction> {
  if (!gateway) throw new Error('The Google transcription connection is not configured.');
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const url = `${gateway}/transcriptions/${id}`;
  let response = await fetch(url, { signal });
  let data: ResponseBody | undefined;
  if (response.ok) data = await response.json() as ResponseBody;
  if (response.status === 404 || (data?.state === 'failed' && job.attempts === 1)) {
    response = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': mimeType, 'X-Pete-Retry': job.attempts === 1 ? '1' : '0' }, body: new Uint8Array(bytes) });
    data = await response.json() as ResponseBody;
  }
  if (!response.ok) throw new Error(data?.error || 'The transcription gateway is unavailable. Start it and retry.');
  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  while (data && !['complete', 'failed', 'uncertain'].includes(data.state)) {
    if (Date.now() > deadline) throw new Error('Google is still processing. Retry later to check the existing operation.');
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(new Error('Processing stopped.')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 3000);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
    response = await fetch(url, { signal });
    if (!response.ok) throw new Error('The transcription connection was interrupted. The Google operation is preserved.');
    data = await response.json() as ResponseBody;
  }
  if (data?.state !== 'complete') throw new Error(data?.error || 'Google could not transcribe this recording.');
  const text = data.text || '';
  return { text, fields: contactCandidates(text), engine: data.engine || 'Google Speech-to-Text V2 · EU' };
}
