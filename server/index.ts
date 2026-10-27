import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { speechCloud } from './google-speech';
import { transcriptions } from './transcriptions';
import { MAX_VOICE_BYTES } from '../src/domain/draft';

const project = process.env.PETE_GCP_PROJECT;
const bucket = process.env.PETE_GCP_BUCKET;
const location = process.env.PETE_GCP_LOCATION || 'eu';
const model = process.env.PETE_SPEECH_MODEL || 'chirp_3';
const origin = process.env.PETE_ALLOWED_ORIGIN || 'http://localhost:8081';
if (!project || !bucket) throw new Error('Set PETE_GCP_PROJECT and PETE_GCP_BUCKET in .env.local.');
if (![project, bucket, location, model].every(value => /^[a-z0-9_.-]+$/.test(value))) throw new Error('Invalid Google Cloud configuration.');
await mkdir('data', { recursive: true });
let store: ReturnType<typeof transcriptions>;

const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Pete-Retry', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: cors });
const server = Bun.serve({
  // This development gateway intentionally cannot bind a public interface.
  // Deployment needs user authentication before allowing cloud processing.
  hostname: '127.0.0.1', port: 8091, maxRequestBodySize: MAX_VOICE_BYTES,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.host !== '127.0.0.1:8091' || request.headers.get('Origin') !== origin) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/health' && request.method === 'GET') return json({ ready: true, provider: 'Google Speech-to-Text V2', location, model });
    if (!store) return json({ error: 'The gateway is starting.' }, 503);
    const id = url.pathname.match(/^\/transcriptions\/([a-f0-9]{64})$/)?.[1];
    if (!id) return json({ error: 'Not found.' }, 404);
    try {
      if (request.method === 'POST') {
        const mimeType = request.headers.get('Content-Type')?.split(';')[0] ?? '';
        if (!['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/mpeg', 'audio/flac'].includes(mimeType)) return json({ error: 'Unsupported audio format.' }, 415);
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (!bytes.length || bytes.length > MAX_VOICE_BYTES) return json({ error: 'Recording exceeds the 60 MiB limit.' }, 413);
        if (new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== id) return json({ error: 'Recording fingerprint does not match.' }, 400);
        store.submit(id, bytes, mimeType, request.headers.get('X-Pete-Retry') === '1');
      } else if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
      const job = store.get(id);
      if (!job) return json({ error: 'Not found.' }, 404);
      return json({ state: job.state, text: job.text, error: job.error, engine: `Google Speech-to-Text V2 · ${model} · ${location}` });
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'The transcription gateway could not complete this request.' }, 503); }
  },
});
const db = new Database('data/transcriptions.sqlite', { create: true });
store = transcriptions(db, speechCloud({ project, bucket, location, model, languages: (process.env.PETE_SPEECH_LANGUAGES || 'de-DE,en-US').split(',') }));
setInterval(() => { void store.maintain(); }, 5000);

console.log(`Pete transcription gateway: http://${server.hostname}:${server.port} (${location}, ${model})`);
