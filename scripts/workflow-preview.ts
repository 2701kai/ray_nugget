import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { googleClient } from './google-client';
import { speechCloud } from '../server/google-speech';
import { transcriptions } from '../server/transcriptions';
import { detailService, googleDetails } from '../server/details';
import { rayService, rayTransport } from '../server/ray';
import { ApiError } from '../server/hosted-jobs';
import { sqliteAtomic } from '../tests/helpers/sqlite-atomic';
import { MAX_VOICE_BYTES } from '../src/domain/draft';

// Development-only: loopback, separate database, no Firebase or team writes.
// Google Speech V2 / EU extraction and Ray are real services, invoked on demand.
const root = resolve('dist-preview'), port = 8086;
const project = process.env.PETE_GCP_PROJECT || 'bevmaq-platform';
const bucket = process.env.PETE_GCP_BUCKET || 'bevmaq-platform-pete-audio';
if (!(await Bun.file(resolve(root, 'sw.js')).exists())) throw new Error('Build the workflow preview first.');
await mkdir('data', { recursive: true });
let cachedClient: Awaited<ReturnType<typeof googleClient>> | undefined, expires = 0;
async function client() {
  if (!cachedClient || Date.now() >= expires) { cachedClient = await googleClient(project); expires = Date.now() + 45 * 60_000; }
  return cachedClient;
}
const cloud = speechCloud({ project, bucket, location: 'eu', model: 'chirp_3', languages: ['de-DE', 'en-US'] }, client);
const prefix = (name: string) => `workflow-preview/${name}`;
const speech = transcriptions(new Database('data/workflow-speech.sqlite'), {
  upload: (name, bytes, mime) => cloud.upload(prefix(name), bytes, mime), submit: name => cloud.submit(prefix(name)),
  operation: name => cloud.operation(name), remove: name => cloud.remove(prefix(name)),
});
const { store } = sqliteAtomic('data/workflow-services.sqlite');
const details = detailService(store, { engine: 'Google gemini-3.1-flash-lite · EU', async extract(text, kind, context) { return googleDetails(project, 'gemini-3.1-flash-lite', await client()).extract(text, kind, context); } });
const ray = rayService(store, rayTransport('https://ray.bevmaq.com'));
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const server = Bun.serve({ hostname: '127.0.0.1', port, idleTimeout: 120, maxRequestBodySize: MAX_VOICE_BYTES,
  async fetch(request) {
    const url = new URL(request.url);
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(url.host)) return json({ error: 'Forbidden host.' }, 403);
    if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return json({ error: 'Forbidden origin.' }, 403);
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'Forbidden site.' }, 403);
    try {
      if (url.pathname.startsWith('/api/')) {
        const match = url.pathname.match(/^\/api\/(transcriptions|extractions|ray)\/([a-f0-9]{64})$/);
        if (!match) return json({ error: 'Not found.' }, 404);
        const [, kind, id] = match;
        if (kind === 'transcriptions') {
          if (request.method === 'POST') {
            const mime = request.headers.get('Content-Type')?.split(';')[0] || '';
            if (!/^audio\/(webm|ogg|mp4|m4a|x-m4a|wav|mpeg|flac)$/.test(mime)) return json({ error: 'Unsupported audio format.' }, 415);
            const bytes = new Uint8Array(await request.arrayBuffer());
            if (!bytes.length || bytes.length > MAX_VOICE_BYTES || new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== id) return json({ error: 'Invalid recording.' }, 400);
            speech.submit(id, bytes, mime, request.headers.get('X-Pete-Retry') === '1');
          } else if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
          const job = speech.get(id);
          return job ? json({ state: job.state, text: job.text, error: job.error, engine: 'Google Speech-to-Text V2 · chirp_3 · eu' }) : json({ error: 'Not found.' }, 404);
        }
        if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
        const body = await request.json();
        return json(kind === 'ray' ? await ray.consult('workflow-preview', id, body) : await details.extract('workflow-preview', id, body.kind, body.text, body.context));
      }
      if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
      const path = decodeURIComponent(url.pathname), absolute = resolve(root, `.${path}`);
      if (absolute !== root && !absolute.startsWith(root + sep)) return json({ error: 'Not found.' }, 404);
      let file = Bun.file(absolute === root ? resolve(root, 'index.html') : absolute);
      if (!(await file.exists())) {
        if (path.includes('.') || !request.headers.get('accept')?.includes('text/html')) return json({ error: 'Not found.' }, 404);
        file = Bun.file(resolve(root, 'index.html'));
      }
      return new Response(request.method === 'HEAD' ? null : file, { headers: { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Type': path.endsWith('.webmanifest') ? 'application/manifest+json' : file.type } });
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'The preview service could not finish this request.' }, error instanceof ApiError ? error.status : 503); }
  },
});
setInterval(() => { void speech.maintain(); }, 3000);
console.log(`Pete workflow preview: http://localhost:${server.port} (local visitors; real EU speech, extraction and Ray)`);
