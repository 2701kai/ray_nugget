import { GoogleAuth } from 'google-auth-library';

export type SpeechConfig = { project: string; location: string; bucket: string; model: string; languages: string[] };
export type SpeechOperation = { name: string; done?: boolean; error?: { message?: string }; response?: { results?: Record<string, { error?: { message?: string }; inlineResult?: { transcript?: { results?: Array<{ alternatives?: Array<{ transcript?: string }> }> } } }> } };
export interface SpeechCloud {
  upload(name: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  submit(name: string): Promise<string>;
  operation(name: string): Promise<SpeechOperation>;
  remove(name: string): Promise<void>;
}
export class CloudError extends Error {
  constructor(message: string, public readonly definitive: boolean) { super(message); }
}
export function speechCloud(config: SpeechConfig): SpeechCloud {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'], projectId: config.project });
  const endpoint = `https://${config.location}-speech.googleapis.com/v2`;
  async function request(url: string, init: RequestInit = {}) {
    let headers: Headers;
    try { const client = await auth.getClient(); headers = new Headers(await client.getRequestHeaders(url)); }
    catch { throw new CloudError('Google credentials need refreshing: run gcloud auth application-default login.', true); }
    headers.set('x-goog-user-project', config.project);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    let response: Response;
    try { response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(90_000) }); }
    catch { throw new CloudError('Google did not confirm the request. Its submission status must be checked before sending again.', false); }
    if (init.method === 'DELETE' && response.status === 404) return response;
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new CloudError(`Google ${response.status}: ${body.error?.message || response.statusText}`, response.status >= 400 && response.status < 500);
    }
    return response;
  }
  return {
    async upload(name, bytes, mimeType) {
      const query = new URLSearchParams({ uploadType: 'media', name });
      await request(`https://storage.googleapis.com/upload/storage/v1/b/${config.bucket}/o?${query}`, { method: 'POST', headers: { 'Content-Type': mimeType }, body: new Uint8Array(bytes) });
    },
    async submit(name) {
      const response = await request(`${endpoint}/projects/${config.project}/locations/${config.location}/recognizers/_:batchRecognize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          config: { autoDecodingConfig: {}, model: config.model, languageCodes: config.languages },
          files: [{ uri: `gs://${config.bucket}/${name}` }], recognitionOutputConfig: { inlineResponseConfig: {} },
        }),
      });
      const data = await response.json() as { name?: string };
      if (!data.name) throw new CloudError('Google accepted the request without returning an operation ID. Check its status before retrying.', false);
      return data.name;
    },
    async operation(name) {
      const parts = name.split('/');
      if (parts.length !== 6 || parts[0] !== 'projects' || !(parts[1] === config.project || /^\d+$/.test(parts[1])) || parts[2] !== 'locations' || parts[3] !== config.location || parts[4] !== 'operations' || !/^[\w-]+$/.test(parts[5])) throw new Error('Invalid speech operation.');
      return await (await request(`${endpoint}/${name}`)).json() as SpeechOperation;
    },
    async remove(name) { await request(`https://storage.googleapis.com/storage/v1/b/${config.bucket}/o/${encodeURIComponent(name)}`, { method: 'DELETE' }); },
  };
}

export function transcriptOf(operation: SpeechOperation): string {
  if (operation.error) throw new Error(operation.error.message || 'Google transcription failed.');
  const files = Object.values(operation.response?.results ?? {});
  if (files.length !== 1) throw new Error('Google returned an unexpected number of transcription results.');
  const file = files[0];
  if (file.error) throw new Error(file.error.message || 'Google could not read the recording.');
  if (!file.inlineResult?.transcript) throw new Error('Google returned no inline transcript.');
  return (file.inlineResult.transcript.results ?? []).map(segment => segment.alternatives?.[0]?.transcript?.trim() ?? '').filter(Boolean).join('\n');
}
