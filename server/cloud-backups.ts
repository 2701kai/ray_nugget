import { createHash } from 'node:crypto';
import { decodeManifest } from '../src/backup/archive';
import { ApiError } from './hosted-jobs';
import type { AtomicStore } from './hosted-store';
import type { hostedStorage } from './hosted-storage';

export type CloudCopy = { id: string; draftId: string; fingerprint: string; revision: number; title: string; company: string; savedAt: string; createdBy?: string; updatedBy?: string };
type Media = { bytes: number; mimeType: string; verified?: boolean; uploadUrl?: string; startedAt: number };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function cloudBackups(store: AtomicStore, storage: ReturnType<typeof hostedStorage>, list: (owner: string) => Promise<CloudCopy[]>, now = Date.now) {
  const object = (owner: string, id: string) => `owners/${owner}/media/${id}`;
  const mediaKey = (owner: string, id: string) => `cloudOwners/${owner}/media/${id}`;
  const draftKey = (owner: string, id: string) => `cloudOwners/${owner}/drafts/${id}`;
  async function init(owner: string, id: string, bytes: number, mimeType: string, origin: string) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || typeof mimeType !== 'string' || !/^(audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac|m4a)(;.*)?|image\/(png|jpeg|jpg|webp|heic|heif|gif|bmp))$/i.test(mimeType) || bytes > (mimeType.startsWith('image/') ? 15 : 60) * 1024 * 1024) throw new ApiError('Invalid cloud original.');
    const key = mediaKey(owner, id);
    const existing = await store.read<Media>(key);
    if (existing?.bytes !== undefined && (existing.bytes !== bytes || existing.mimeType !== mimeType)) throw new ApiError('Original metadata does not match.', 409);
    if (existing?.verified) return { complete: true };
    if (existing?.uploadUrl && existing.startedAt > now() - 86_400_000) return { uploadUrl: existing.uploadUrl };
    const day = new Date(now()).toISOString().slice(0, 10);
    const ownerQuota = `cloudQuota/${owner}-${day}`, globalQuota = `cloudQuota/global-${day}`;
    await store.atomic([key, ownerQuota, globalQuota], records => {
      const mine = Number(records[ownerQuota]?.bytes || 0), total = Number(records[globalQuota]?.bytes || 0);
      if (mine + bytes > 1024 ** 3 || total + bytes > 5 * 1024 ** 3) throw new ApiError('Cloud storage daily upload limit reached. Originals remain on this device; saving retries tomorrow.', 429);
      return { result: undefined, writes: { [ownerQuota]: { bytes: mine + bytes }, [globalQuota]: { bytes: total + bytes } } };
    });
    const uploadUrl = await storage.begin(object(owner, id), mimeType, bytes, origin);
    return store.atomic([key], records => {
      if (records[key]?.verified) return { result: { complete: true } as { complete?: boolean; uploadUrl?: string } };
      const current = records[key] as Media | undefined;
      if (current?.uploadUrl && current.startedAt > now() - 86_400_000) return { result: { uploadUrl: current.uploadUrl } };
      return { result: { uploadUrl }, writes: { [key]: { bytes, mimeType, uploadUrl, startedAt: now() } } };
    });
  }
  async function complete(owner: string, id: string) {
    const key = mediaKey(owner, id); const media = await store.read<Media>(key);
    if (!media) throw new ApiError('Cloud original not found.', 404);
    if (media.verified) return { complete: true };
    const original = await storage.inspect(object(owner, id));
    if (!original) return { complete: false };
    if (original.sha256 !== id || original.bytes !== media.bytes || original.mimeType !== media.mimeType) throw new ApiError('Cloud original did not pass its integrity check.', 409);
    await store.atomic([key], () => ({ result: undefined, writes: { [key]: { bytes: media.bytes, mimeType: media.mimeType, verified: true, startedAt: media.startedAt } } }));
    return { complete: true };
  }
  async function save(owner: string, id: string, bytes: Uint8Array, expected: string | null, team?: { actor: string; event: string }) {
    let snapshot;
    try { snapshot = decodeManifest(bytes); } catch { throw new ApiError('Cloud visitor details are invalid or too large.'); }
    if (team && (snapshot.draft.event !== team.event || sha(new TextEncoder().encode(snapshot.draft.id)) !== id)) throw new ApiError('Der Besucher gehört zu einem anderen Event.', 409);
    for (const attachment of snapshot.draft.attachments) {
      const media = await store.read<Media>(mediaKey(owner, attachment.sha256));
      if (!media?.verified || media.bytes !== attachment.bytes || media.mimeType !== attachment.mimeType) throw new ApiError('An original is still waiting to reach company storage.', 409);
    }
    const fingerprint = sha(bytes);
    await storage.put(`owners/${owner}/manifests/${fingerprint}.json`, bytes);
    const draft = snapshot.draft;
    const value: CloudCopy = { id, draftId: draft.id, fingerprint, revision: draft.revision, title: draft.contact.name || draft.contact.company || 'Untitled visitor', company: draft.contact.company, savedAt: new Date(now()).toISOString() };
    const key = draftKey(owner, id);
    return store.atomic([key], records => {
      const current = records[key] as CloudCopy | undefined;
      if (current?.fingerprint === fingerprint) return { result: current };
      if ((current?.fingerprint ?? null) !== expected || (current && (current.draftId !== draft.id || current.revision > draft.revision))) throw new ApiError('This cloud copy changed in another tab. Pete will retry from the latest local draft.', 409);
      const saved = team ? { ...value, createdBy: current?.createdBy || team.actor, updatedBy: team.actor } : value;
      return { result: saved, writes: { [key]: saved } };
    });
  }
  return { init, complete, save, list,
    get: (owner: string, id: string) => store.read<CloudCopy>(draftKey(owner, id)),
    async manifest(owner: string, id: string) {
      const copy = await store.read<CloudCopy>(draftKey(owner, id));
      if (!copy) throw new ApiError('Cloud visitor not found.', 404);
      return storage.read(`owners/${owner}/manifests/${copy.fingerprint}.json`);
    },
    async media(owner: string, id: string, offset = 0) {
      const media = await store.read<Media>(mediaKey(owner, id));
      if (!media?.verified) throw new ApiError('Cloud original not found.', 404);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= media.bytes) throw new ApiError('Invalid download position.', 416);
      return storage.read(object(owner, id), { start: offset, end: Math.min(media.bytes - 1, offset + 4 * 1024 * 1024 - 1) });
    },
  };
}
