import { GoogleAuth } from 'google-auth-library';
import { MAX_VOICE_BYTES } from '../src/domain/draft';

export function hostedStorage(project: string, bucket: string) {
  const auth = new GoogleAuth({ projectId: project, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  async function request(url: string, init: RequestInit = {}) {
    const headers = new Headers(await (await auth.getClient()).getRequestHeaders(url));
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(40_000) });
    if (!response.ok && response.status !== 404) throw new Error(`Temporary storage request failed (${response.status}). Retry shortly.`);
    return response;
  }
  return {
    async begin(name: string, mimeType: string, bytes: number, origin: string) {
      const query = new URLSearchParams({ uploadType: 'resumable', name, ifGenerationMatch: '0' });
      const response = await request(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?${query}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(bytes), Origin: origin },
        body: JSON.stringify({ contentType: mimeType, cacheControl: 'no-store' }),
      });
      const session = response.headers.get('location');
      if (!session?.startsWith('https://storage.googleapis.com/')) throw new Error('Storage did not return an upload session. Retry shortly.');
      return session;
    },
    async inspect(name: string) {
      const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}`;
      const response = await request(url);
      if (response.status === 404) return undefined;
      const metadata = await response.json() as { size: string; contentType: string; generation: string };
      if (Number(metadata.size) > MAX_VOICE_BYTES) throw new Error('The uploaded recording exceeds 60 MiB.');
      const original = await request(`${url}?alt=media&generation=${encodeURIComponent(metadata.generation)}`);
      if (!original.body) throw new Error('The uploaded recording is unavailable.');
      const hash = new Bun.CryptoHasher('sha256');
      let bytes = 0;
      for await (const chunk of original.body) {
        bytes += chunk.byteLength;
        if (bytes > MAX_VOICE_BYTES) throw new Error('The uploaded recording exceeds 60 MiB.');
        hash.update(chunk);
      }
      return { bytes, sha256: hash.digest('hex'), mimeType: metadata.contentType };
    },
  };
}
