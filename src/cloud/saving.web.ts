import type { DraftRepository } from '../storage/types';
import { decodeManifest, encodeManifest, type VerifiedBackup } from '../backup/archive';
import { digest } from '../backup/digest';
import { auth, accessToken } from '../session.web';
import { gateway, upload } from '../processing/voice.web';
import type { CloudCopy, CloudStatus } from './saving';
export type { CloudCopy, CloudStatus } from './saving';

export function startCloudSaving(repo: DraftRepository, changed: (states: Record<string, CloudStatus>) => void) {
  const uid = auth?.currentUser?.uid;
  const enabled = !!uid && !!gateway;
  const controller = new AbortController();
  const states: Record<string, CloudStatus> = {};
  const saved = new Map<string, string>();
  let busy = false;
  let installation: string;
  try {
    const key = `pete-cloud-installation-${uid}`;
    installation = localStorage.getItem(key) || crypto.randomUUID();
    if (enabled) localStorage.setItem(key, installation);
  } catch { installation = crypto.randomUUID(); }
  async function api(path: string, init: RequestInit = {}) {
    if (controller.signal.aborted || !uid || auth?.currentUser?.uid !== uid) throw new Error('The signed-in account changed.');
    const token = await accessToken();
    const response = await fetch(`${gateway}/cloud/${path}`, { ...init, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]), headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (!response.ok && response.status !== 404) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Company cloud saving is paused. Pete will retry.');
    }
    return response;
  }
  const post = async (path: string, body: unknown = {}) => (await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  function report(id: string, state: CloudStatus) { states[id] = state; if (!controller.signal.aborted) changed({ ...states }); }
  async function tick() {
    if (!enabled || busy || controller.signal.aborted) return;
    busy = true;
    try {
      const [drafts, jobs] = await Promise.all([repo.list(), repo.jobs()]);
      for (const draft of drafts) {
        if (controller.signal.aborted) break;
        const revision = draft.revision;
        try {
          if (!navigator.onLine) { report(draft.id, { state: 'pending', revision }); continue; }
          const metadata = encodeManifest({ draft, jobs: jobs.filter(job => job.draftId === draft.id) });
          const fingerprint = await digest(metadata);
          if (saved.get(draft.id) === fingerprint) continue;
          report(draft.id, { state: 'saving', revision });
          const id = await digest(new TextEncoder().encode(`${installation}/${draft.id}`));
          const response = await api(`drafts/${id}`);
          const current: CloudCopy | undefined = response.status === 404 ? undefined : await response.json();
          if (current?.fingerprint !== fingerprint) {
            for (const attachment of draft.attachments) {
              const session = await post(`media/${attachment.sha256}/upload`, { bytes: attachment.bytes, mimeType: attachment.mimeType });
              if (!session.complete) {
                if (!(await post(`media/${attachment.sha256}/complete`)).complete) {
                  const bytes = await repo.media(draft.id, attachment.id);
                  if (!bytes || bytes.length !== attachment.bytes || await digest(bytes) !== attachment.sha256) throw new Error('An original could not be read for cloud saving. Keep this device’s data.');
                  await upload(session.uploadUrl, bytes, attachment.mimeType, AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]));
                  if (!(await post(`media/${attachment.sha256}/complete`)).complete) throw new Error('Original upload is incomplete. Pete will retry.');
                }
              }
            }
            await post(`drafts/${id}`, { expected: current?.fingerprint ?? null, manifest: new TextDecoder().decode(metadata) });
          }
          saved.set(draft.id, fingerprint);
          report(draft.id, { state: 'saved', revision });
        } catch (error) {
          report(draft.id, { state: navigator.onLine ? 'error' : 'pending', revision, message: error instanceof Error ? error.message : 'Cloud saving interrupted. Pete will retry.' });
        }
      }
    } catch { /* Repository recovery owns local-storage errors; never block capture. */ }
    finally { busy = false; }
  }
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const wake = () => { if (enabled) { clearTimeout(debounce); debounce = setTimeout(() => { void tick(); }, 800); } };
  const timer = enabled ? setInterval(() => { void tick(); }, 10_000) : undefined;
  if (enabled) { window.addEventListener('online', wake); wake(); }
  return { enabled, wake,
    close() { controller.abort(); clearInterval(timer); clearTimeout(debounce); window.removeEventListener('online', wake); },
    async list(): Promise<CloudCopy[]> { const response = await api('drafts'); if (!response.ok) throw new Error('Cloud visitors are unavailable.'); return response.json(); },
    async restore(id: string): Promise<VerifiedBackup> {
      const response = await api(`drafts/${id}`);
      if (!response.ok) throw new Error('Cloud visitor not found.');
      const copy: CloudCopy = await response.json();
      const original = await api(`drafts/${id}/manifest`);
      if (!original.ok) throw new Error('Cloud visitor details are unavailable.');
      const metadata = new Uint8Array(await original.arrayBuffer());
      if (await digest(metadata) !== copy.fingerprint) throw new Error('The cloud copy was updated. Open it again.');
      const snapshot = decodeManifest(metadata);
      const media = [];
      for (const attachment of snapshot.draft.attachments) {
        const bytes = new Uint8Array(attachment.bytes);
        for (let offset = 0; offset < attachment.bytes; offset += 4 * 1024 * 1024) {
          const result = await api(`media/${attachment.sha256}?offset=${offset}`);
          if (!result.ok) throw new Error('A cloud original is missing.');
          const chunk = new Uint8Array(await result.arrayBuffer());
          if (chunk.length !== Math.min(4 * 1024 * 1024, attachment.bytes - offset)) throw new Error('Cloud download was interrupted. Open the copy again.');
          bytes.set(chunk, offset);
        }
        if (bytes.length !== attachment.bytes || await digest(bytes) !== attachment.sha256) throw new Error('A cloud original did not pass its integrity check.');
        media.push({ attachmentId: attachment.id, bytes });
      }
      return { ...snapshot, media, fingerprint: copy.fingerprint };
    },
  };
}
