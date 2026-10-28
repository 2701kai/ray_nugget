import { expect, test } from 'bun:test';
import { cloudBackups } from '../server/cloud-backups';
import { hostedHandler, ownerOf } from '../server/hosted-api';
import type { hostedJobs } from '../server/hosted-jobs';
import type { AtomicStore, RecordValue } from '../server/hosted-store';
import { encodeManifest, decodeManifest } from '../src/backup/archive';
import { createDraft, reduceDraft } from '../src/domain/draft';
import { newJob } from '../src/processing/jobs';

const hash = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
const date = '2026-10-28T06:00:00.000Z', origin = 'https://pete.example.test', copyId = 'a'.repeat(64);
class MemoryStore implements AtomicStore {
  records = new Map<string, RecordValue>();
  async read<T>(key: string) { return structuredClone(this.records.get(key)) as T | undefined; }
  async atomic<T>(keys: string[], run: (records: Record<string, RecordValue | undefined>) => { result: T; writes?: Record<string, RecordValue> }) {
    const { result, writes } = run(Object.fromEntries(keys.map(key => [key, structuredClone(this.records.get(key))])));
    for (const [key, value] of Object.entries(writes ?? {})) this.records.set(key, structuredClone(value));
    return result;
  }
}
function fixture() {
  const store = new MemoryStore(), originals = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  let begins = 0;
  const service = cloudBackups(store, {
    async begin() { begins++; return 'https://storage.googleapis.com/synthetic'; },
    async inspect(name) { const value = originals.get(name); return value && { bytes: value.bytes.length, sha256: hash(value.bytes), mimeType: value.mimeType }; },
    async put(name, bytes) { if (!originals.has(name)) originals.set(name, { bytes, mimeType: 'application/json' }); },
    async read(name, range) { const value = originals.get(name); return value && new Response(new Uint8Array(range ? value.bytes.subarray(range.start, range.end + 1) : value.bytes), { headers: { 'Content-Type': value.mimeType } }); },
  }, async owner => [...store.records].filter(([key]) => key.startsWith(`cloudOwners/${owner}/drafts/`)).map(([, value]) => value as any));
  const bytes = new Uint8Array([5, 7, 11, 19]);
  const attachment = { id: 'synthetic-audio', kind: 'voice' as const, name: 'Synthetic memo', bytes: bytes.length, sha256: hash(bytes), mimeType: 'audio/webm', capturedAt: date, voiceMode: 'memo' as const };
  const draft = reduceDraft(createDraft('synthetic-visitor', 'voice', 'Synthetic fair', date), { type: 'attach', attachment }, date);
  const manifest = encodeManifest({ draft, jobs: [newJob(draft.id, attachment, Date.parse(date))] });
  return { store, originals, service, bytes, attachment, draft, manifest, begins: () => begins,
    upload(owner = 'alice', data = bytes) { originals.set(`owners/${owner}/media/${attachment.sha256}`, { bytes: data, mimeType: attachment.mimeType }); },
    init(owner = 'alice') { return service.init(owner, attachment.sha256, bytes.length, attachment.mimeType, origin); },
  };
}

test('cloud acknowledgement requires every original; retries reuse verified media and preserve restore evidence', async () => {
  const f = fixture(); const id = f.attachment.sha256;
  await f.init(); await f.init(); expect(f.begins()).toBe(1);
  expect(await f.service.complete('alice', id)).toEqual({ complete: false });
  await expect(f.service.save('alice', copyId, f.manifest, null)).rejects.toThrow('waiting');
  f.upload(); expect(await f.service.complete('alice', id)).toEqual({ complete: true });
  expect(await f.init()).toEqual({ complete: true }); expect(f.begins()).toBe(1);
  const saved = await f.service.save('alice', copyId, f.manifest, null);
  expect(saved.fingerprint).toBe(hash(f.manifest));
  expect(await f.service.save('alice', copyId, f.manifest, null)).toEqual(saved);
  const manifest = new Uint8Array(await (await f.service.manifest('alice', copyId))!.arrayBuffer());
  expect(decodeManifest(manifest).draft).toEqual(f.draft);
  expect(new Uint8Array(await (await f.service.media('alice', id))!.arrayBuffer())).toEqual(f.bytes);
  expect(new Uint8Array(await (await f.service.media('alice', id, 2))!.arrayBuffer())).toEqual(f.bytes.subarray(2));
  await expect(f.service.media('alice', id, 4)).rejects.toMatchObject({ status: 416 });
});

test('cloud originals and draft pointers are isolated by verified owner', async () => {
  const f = fixture(); await f.init(); f.upload(); await f.service.complete('alice', f.attachment.sha256);
  await f.service.save('alice', copyId, f.manifest, null);
  expect(await f.service.list('bob')).toEqual([]); expect(await f.service.get('bob', copyId)).toBeUndefined();
  await expect(f.service.manifest('bob', copyId)).rejects.toMatchObject({ status: 404 });
  await expect(f.service.media('bob', f.attachment.sha256)).rejects.toMatchObject({ status: 404 });
  await expect(f.service.save('bob', copyId, f.manifest, null)).rejects.toMatchObject({ status: 409 });
});

test('corrupted upload never becomes a saved cloud visitor', async () => {
  const f = fixture(); await f.init(); f.upload('alice', new Uint8Array([2, 3, 5, 7]));
  await expect(f.service.complete('alice', f.attachment.sha256)).rejects.toMatchObject({ status: 409 });
  await expect(f.service.save('alice', copyId, f.manifest, null)).rejects.toThrow('waiting');
  expect(await f.service.get('alice', copyId)).toBeUndefined();
});

test('late snapshot cannot replace newer cloud details and stale parents require retry', async () => {
  const f = fixture(); await f.init(); f.upload(); await f.service.complete('alice', f.attachment.sha256);
  const saved = await f.service.save('alice', copyId, f.manifest, null);
  const next = reduceDraft(f.draft, { type: 'edit', patch: { contact: { name: 'Synthetic corrected visitor' } } }, date);
  const latest = encodeManifest({ draft: next, jobs: [newJob(next.id, f.attachment, Date.parse(date))] });
  await expect(f.service.save('alice', copyId, latest, null)).rejects.toMatchObject({ status: 409 });
  const updated = await f.service.save('alice', copyId, latest, saved.fingerprint);
  await expect(f.service.save('alice', copyId, f.manifest, updated.fingerprint)).rejects.toMatchObject({ status: 409 });
  expect((await f.service.get('alice', copyId))?.title).toBe('Synthetic corrected visitor');
});

test('cloud API requires authentication and company account; foreign origins and paths cannot publish', async () => {
  const f = fixture();
  const verify = async (token: string) => ({ uid: token, email: token === 'outsider' ? 'visitor@example.test' : 'synthetic@bevmaq.com', email_verified: true });
  const handler = hostedHandler({} as ReturnType<typeof hostedJobs>, verify, [origin], 'synthetic', undefined, f.service);
  const request = (path: string, token?: string, method = 'GET', requestOrigin = origin) => handler(new Request(`https://pete.example.test/api/cloud/${path}`, { method, headers: { Origin: requestOrigin, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) }));
  expect((await request('drafts')).status).toBe(401);
  expect((await request('drafts', 'outsider')).status).toBe(403);
  expect((await request(`drafts/${copyId}`, 'alice', 'POST', 'https://other.example.test')).status).toBe(403);
  expect((await request('drafts', 'alice')).status).toBe(200);
  expect((await request('media/not-a-hash', 'alice')).status).toBe(404);
  expect(ownerOf(await verify('alice'))).not.toBe(ownerOf(await verify('bob')));
});
