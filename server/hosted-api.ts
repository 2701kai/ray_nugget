import type { detailService } from './details';
import { createHash } from 'node:crypto';
import type { HostedJob } from './hosted-jobs';
import { ApiError, hostedJobs } from './hosted-jobs';
import type { Team } from '../src/team/types';
import type { cloudBackups } from './cloud-backups';
import type { TeamContext } from './lead-intake';

export type Identity = { uid: string; email?: string; email_verified?: boolean };
export function ownerOf(identity: Identity) {
  if (!identity.email_verified || !identity.email?.toLowerCase().endsWith('@bevmaq.com') || !identity.uid) throw new ApiError('Use a verified BEVMAQ email account.', 403);
  return createHash('sha256').update(identity.uid).digest('hex');
}
export function hostedHandler(jobs: ReturnType<typeof hostedJobs>, verify: (token: string) => Promise<Identity>, allowedOrigins: string[], engine: string, details?: ReturnType<typeof detailService>, cloud?: ReturnType<typeof cloudBackups>, teams: Team[] = []) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('Origin') || '';
    const headers = { 'Cache-Control': 'no-store', 'Vary': 'Origin', ...(allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) };
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    const url = new URL(request.url);
    let path = url.pathname.replace(/^\/api(?=\/)/, '');
    if (request.method === 'OPTIONS') return allowedOrigins.includes(origin) ? new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } }) : json({ error: 'Forbidden origin.' }, 403);
    if (path === '/health' && request.method === 'GET') return json({ ready: true, authentication: 'required', engine, automaticFilling: !!details, cloudSaving: !!cloud, leadIntake: !!cloud, crmDelivery: false });
    if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin.' }, 403);
    try {
      const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
      if (!token) throw new ApiError('Sign in to Pete to process this recording.', 401);
      let identity: Identity;
      try { identity = await verify(token); } catch { throw new ApiError('Your session expired. Sign in again.', 401); }
      const owner = ownerOf(identity);
      let cloudOwner = owner;
      let teamContext: TeamContext | undefined;
      if (path === '/teams' && request.method === 'GET') return json(teams.filter(t => t.members.includes(identity.email!.toLowerCase())));
      if (path.startsWith('/teams/')) {
        const match = path.match(/^\/teams\/([a-z0-9-]+)(\/.*)$/);
        const team = teams.find(t => t.id === match?.[1] && t.members.includes(identity.email!.toLowerCase()));
        if (!team || !match) throw new ApiError('Your account does not have access to this team workspace.', 403);
        cloudOwner = createHash('sha256').update(`pete-team/${team.id}`).digest('hex');
        teamContext = { id: team.id, actor: identity.email!.toLowerCase(), event: team.name, members: team.members };
        path = `/cloud${match[2]}`;
      }
      if (path.startsWith('/cloud/')) {
        if (!cloud) throw new ApiError('Company cloud saving is temporarily unavailable. Captures remain on this device.', 503);
        if (request.method === 'POST' && !allowedOrigins.includes(origin)) throw new ApiError('A valid app origin is required.', 403);
        if (request.method === 'GET' && path === '/cloud/drafts') return json(await cloud.list(cloudOwner));
        const route = path.match(/^\/cloud\/(media|drafts)\/([a-f0-9]{64})(?:\/(upload|complete|manifest|owner))?$/);
        if (!route) throw new ApiError('Not found.', 404);
        const [, kind, id, action] = route;
        if (request.method === 'GET') {
          if (kind === 'drafts' && !action) { const copy = await cloud.get(cloudOwner, id); return copy ? json(copy) : json({ error: 'Cloud visitor not found.' }, 404); }
          if ((kind === 'drafts' && action === 'manifest') || (kind === 'media' && !action)) {
            const result = kind === 'media' ? await cloud.media(cloudOwner, id, Number(url.searchParams.get('offset') || 0)) : await cloud.manifest(cloudOwner, id);
            if (!result) throw new ApiError('Cloud original not found.', 404);
            return new Response(result.body, { status: result.status, headers: { ...headers, 'Content-Type': result.headers.get('Content-Type') || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' } });
          }
        }
        if (request.method === 'POST') {
          if (kind === 'media' && action === 'complete') return json(await cloud.complete(cloudOwner, id));
          const raw = await request.text();
          if (new TextEncoder().encode(raw).length > (kind === 'media' ? 2048 : 4_500_000)) throw new ApiError('Request too large.', 413);
          let body;
          try { body = JSON.parse(raw); } catch { throw new ApiError('Invalid cloud request.'); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('Invalid cloud request.');
          if (kind === 'drafts' && action === 'owner') {
            if (!teamContext) throw new ApiError('Lead ownership is available in a shared workspace.', 403);
            return json(await cloud.assign(cloudOwner, id, teamContext, body.ownerEmail, body.expectedVersion));
          }
          if (kind === 'media' && action === 'upload') return json(await cloud.init(cloudOwner, id, body.bytes, body.mimeType, origin));
          if (kind === 'drafts' && !action && typeof body.manifest === 'string' && (body.expected === null || /^[a-f0-9]{64}$/.test(body.expected))) return json(await cloud.save(cloudOwner, id, new TextEncoder().encode(body.manifest), body.expected, teamContext));
        }
        throw new ApiError('Method not allowed.', 405);
      }
      const extractionRoute = path.match(/^\/extractions\/([a-f0-9]{64})$/);
      if (extractionRoute) {
        if (request.method !== 'POST') throw new ApiError('Method not allowed.', 405);
        if (!allowedOrigins.includes(origin)) throw new ApiError('A valid app origin is required.', 403);
        if (!details) throw new ApiError('Automatic filling is temporarily unavailable. Your source stays saved.', 503);
        const raw = await request.text();
        if (raw.length > 310_000) throw new ApiError('Request too large.', 413);
        let body;
        try { body = JSON.parse(raw); } catch { throw new ApiError('Invalid extraction request.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('Invalid extraction request.');
        const result = await details.extract(owner, extractionRoute[1], body.kind, body.text);
        return json(result, result.state === 'complete' ? 200 : 202);
      }
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
