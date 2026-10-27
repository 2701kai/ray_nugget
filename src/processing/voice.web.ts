import type { Extraction, ProcessingJob } from './jobs';
import { contactCandidates } from './contact';
import { accessToken, auth } from '../session.web';

export const gateway = process.env.EXPO_PUBLIC_PROCESSING_URL?.replace(/\/$/, '');
type ResponseBody = { state: string; text?: string; error?: string; engine?: string; uploadUrl?: string };
async function upload(session: string, bytes: Uint8Array, mimeType: string, signal: AbortSignal) {
  const url = new URL(session);
  if (url.origin !== 'https://storage.googleapis.com') throw new Error('The upload destination is invalid.');
  const status = await fetch(session, { method: 'PUT', signal, headers: { 'Content-Range': `bytes */${bytes.length}` }, body: new Uint8Array() });
  if (status.ok) return;
  if (status.status !== 308) throw new Error('The upload session expired. Retry this recording after its upload expires.');
  const range = status.headers.get('Range')?.match(/^bytes=0-(\d+)$/);
  const start = range ? Number(range[1]) + 1 : 0;
  if (start >= bytes.length) return;
  const result = await fetch(session, { method: 'PUT', signal, headers: { 'Content-Type': mimeType, 'Content-Range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` }, body: new Uint8Array(bytes.subarray(start)) });
  if (!result.ok) throw new Error('Upload interrupted. Pete will resume from the saved original.');
}
export async function transcribe(job: ProcessingJob, bytes: Uint8Array, mimeType: string, signal: AbortSignal): Promise<Extraction> {
  if (!gateway) throw new Error('The Google transcription connection is not configured.');
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const url = `${gateway}/transcriptions/${id}`;
  async function api(target: string, init: RequestInit = {}) {
    const token = await accessToken();
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(target, { ...init, signal, headers });
  }
  let response = await api(url);
  let data: ResponseBody | undefined;
  if (response.ok) data = await response.json() as ResponseBody;
  if (response.status === 404 || (data?.state === 'failed' && job.attempts === 1)) {
    response = auth
      ? await api(`${url}/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bytes: bytes.length, mimeType: mimeType.split(';')[0], retry: job.attempts === 1 }) })
      : await api(url, { method: 'POST', headers: { 'Content-Type': mimeType, 'X-Pete-Retry': job.attempts === 1 ? '1' : '0' }, body: new Uint8Array(bytes) });
    data = await response.json() as ResponseBody;
  }
  if (!response.ok) throw new Error(data?.error || (auth ? 'The transcription service is unavailable. Your original remains saved; retry shortly.' : 'The transcription gateway is unavailable. Start it and retry.'));
  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  while (data && !['complete', 'failed', 'uncertain'].includes(data.state)) {
    if (auth && data.state === 'uploading' && data.uploadUrl) {
      // Check server-side object state first in case an earlier upload completed.
      response = await api(`${url}/submit`, { method: 'POST' });
      if (!response.ok) throw new Error('Could not check the uploaded recording. Retry shortly.');
      data = await response.json() as ResponseBody;
      if (data.state === 'uploading' && data.uploadUrl) {
        await upload(data.uploadUrl, bytes, mimeType.split(';')[0], signal);
        response = await api(`${url}/submit`, { method: 'POST' });
        if (!response.ok) throw new Error('The recording is uploaded. Retry to check its processing status.');
        data = await response.json() as ResponseBody;
      }
      if (['complete', 'failed', 'uncertain'].includes(data.state)) break;
    }
    if (Date.now() > deadline) throw new Error('Google is still processing. Retry later to check the existing operation.');
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(new Error('Processing stopped.')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 3000);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
    response = await api(url);
    if (!response.ok) throw new Error('The transcription connection was interrupted. The Google operation is preserved.');
    data = await response.json() as ResponseBody;
  }
  if (data?.state !== 'complete') throw new Error(data?.error || 'Google could not transcribe this recording.');
  const text = data.text || '';
  return { text, fields: contactCandidates(text), engine: data.engine || 'Google Speech-to-Text V2 · EU' };
}
