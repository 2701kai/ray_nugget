import { createHash } from 'node:crypto';
import type { HostedJob } from './hosted-jobs';
import { ApiError, hostedJobs } from './hosted-jobs';

export type Identity = { uid: string; email?: string; email_verified?: boolean };
export function ownerOf(identity: Identity) {
  if (!identity.email_verified || !identity.email?.toLowerCase().endsWith('@bevmaq.com') || !identity.uid) throw new ApiError('Use a verified BEVMAQ email account.', 403);
  return createHash('sha256').update(identity.uid).digest('hex');
}
export function hostedHandler(jobs: ReturnType<typeof hostedJobs>, verify: (token: string) => Promise<Identity>, allowedOrigins: string[], engine: string) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('Origin') || '';
    const headers = { 'Cache-Control': 'no-store', 'Vary': 'Origin', ...(allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) };
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    if (request.method === 'OPTIONS') return allowedOrigins.includes(origin) ? new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } }) : json({ error: 'Forbidden origin.' }, 403);
    if (path === '/health' && request.method === 'GET') return json({ ready: true, authentication: 'required', engine });
    if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin.' }, 403);
    try {
      const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
      if (!token) throw new ApiError('Sign in to Pete to process this recording.', 401);
      let identity: Identity;
      try { identity = await verify(token); } catch { throw new ApiError('Your session expired. Sign in again.', 401); }
      const owner = ownerOf(identity);
      const route = path.match(/^\/transcriptions\/([a-f0-9]{64})(?:\/(upload|submit))?$/);
      if (!route) throw new ApiError('Not found.', 404);
      const [, id, action] = route;
      let job: HostedJob | undefined;
      if (request.method === 'GET' && !action) job = await jobs.get(owner, id);
      else if (request.method === 'POST' && action === 'upload') {
        if (!allowedOrigins.includes(origin)) throw new ApiError('A valid app origin is required.', 403);
        const raw = await request.text();
        if (raw.length > 2048) throw new ApiError('Request too large.', 413);
        let body: { bytes: number; mimeType: string; retry?: boolean };
        try { body = JSON.parse(raw); } catch { throw new ApiError('Invalid upload request.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('Invalid upload request.');
        job = await jobs.init(owner, id, body.bytes, body.mimeType, origin, body.retry === true);
      } else if (request.method === 'POST' && action === 'submit') job = await jobs.submit(owner, id);
      else throw new ApiError('Method not allowed.', 405);
      if (!job) throw new ApiError('Recording not found.', 404);
      return json({ state: job.state, text: job.text, error: job.error, engine, uploadUrl: job.state === 'uploading' ? job.uploadUrl : undefined });
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      console.error('Pete processing request failed:', error instanceof Error ? error.name : 'UnknownError');
      return json({ error: 'Processing is temporarily unavailable. The original remains saved; retry shortly.' }, 503);
    }
  };
}
