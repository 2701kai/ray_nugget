import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { openDB } from 'idb';
import { createDraft, type Attachment } from '../src/domain/draft';
import { assertBackupSize, decodeBackup, encodeBackup, restoredSnapshot, type BackupSnapshot } from '../src/backup/archive';
import { openRepository } from '../src/storage/repository.web';

const now = '2026-10-27T13:00:00.000Z';
const digest = async (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
const join = (parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
async function fixture() {
  const repo = await openRepository(crypto.randomUUID());
  await repo.create(createDraft('source-visitor', 'contact', 'Synthetic fair', now), true);
  await repo.update('source-visitor', { type: 'edit', patch: { contact: { name: 'Backup Visitor', company: 'Synthetic Co' }, request: { product: 'Manually corrected product' } } });
  for (const [kind, bytes] of [['card', new Uint8Array([1, 2, 3])], ['voice', new Uint8Array([4, 5, 6, 7])]] as const) {
    const attachment: Attachment = { id: `${kind}-source`, kind, name: kind === 'card' ? 'synthetic.png' : 'synthetic.webm', mimeType: kind === 'card' ? 'image/png' : 'audio/webm;codecs=opus', bytes: bytes.byteLength, sha256: await digest(bytes), capturedAt: now, ...(kind === 'voice' ? { voiceMode: 'conversation', consentConfirmed: true } : {}) };
    await repo.update('source-visitor', { type: 'attach', attachment }, undefined, bytes);
  }
  const job = (await repo.claimJob(['card'], 'never-export-this-lease', Date.now() + 10))!;
  await repo.finishJob(job.id, job.leaseId!, { text: 'Card source text', fields: { email: 'visitor@example.test' }, engine: 'Synthetic OCR' });
  let draft = (await repo.list())[0];
  draft = await repo.reviewJob(job.id, { email: 'corrected@example.test' }, draft.revision);
  await repo.update(draft.id, { type: 'addNote', id: 'note-source', text: 'A note to keep' });
  return repo;
}

// Rewrite the public manifest and its checksum to exercise schema validation,
// rather than merely failing the integrity check first.
async function rewrite(bytes: Uint8Array, change: (root: any) => void) {
  const prefixLength = 'PETE_BACKUP_V1\n'.length;
  const headerLength = prefixLength + 4 + 64;
  const oldSize = new DataView(bytes.buffer, bytes.byteOffset).getUint32(prefixLength);
  const root = JSON.parse(new TextDecoder().decode(bytes.subarray(headerLength, headerLength + oldSize)));
  change(root);
  const metadata = new TextEncoder().encode(JSON.stringify(root));
  const header = bytes.slice(0, headerLength);
  new DataView(header.buffer).setUint32(prefixLength, metadata.length);
  header.set(new TextEncoder().encode(await digest(metadata)), prefixLength + 4);
  return join([header, metadata, bytes.subarray(headerLength + oldSize)]);
}

test('backup roundtrip preserves originals, reviewed fields, notes and source links across databases', async () => {
  const source = await fixture(); const target = await openRepository(crypto.randomUUID());
  await target.create(createDraft('unrelated', 'contact', '', now), true);
  await target.savePreferences({ sender: { name: 'Target colleague', company: 'BEVMAQ', phone: '' }, event: 'Target event' });
  const before = (await source.list())[0];
  const file = join(await encodeBackup(await source.snapshot(before.id), digest));
  expect(new TextDecoder().decode(file).includes('never-export-this-lease')).toBe(false);
  const verified = await decodeBackup(file, digest);
  const restored = await target.restore(verified);
  expect(restored.created).toBe(true);
  expect(restored.draft.id).not.toBe(before.id);
  expect(restored.draft.contact).toEqual(before.contact);
  expect(restored.draft.request).toEqual(before.request);
  expect(restored.draft.entries).toEqual(before.entries);
  expect(restored.draft.attachments).toEqual(before.attachments);
  expect(restored.draft.appliedJobs).toEqual([`${restored.draft.id}/card-source`]);
  expect(restored.draft.provenance['contact.email']).toMatchObject({ source: 'extraction', attachmentId: 'card-source', jobId: `${restored.draft.id}/card-source` });
  expect((await target.jobs()).find(j => j.kind === 'card')).toMatchObject({ state: 'complete', result: { text: 'Card source text' } });
  expect((await target.jobs()).find(j => j.kind === 'card')?.reviewedAt).toBeDefined();
  expect(await target.media(restored.draft.id, 'voice-source')).toEqual(new Uint8Array([4, 5, 6, 7]));
  expect(await target.media(restored.draft.id, 'card-source')).toEqual(new Uint8Array([1, 2, 3]));
  expect((await target.media(restored.draft.id, 'card-source'))?.buffer.byteLength).toBe(3);
  expect(await target.media('unrelated', 'voice-source')).toBeUndefined();
  expect((await target.preferences()).sender.name).toBe('Target colleague');
  expect(await target.activeDraft()).toBe(restored.draft.id);
  expect((await source.list())[0]).toEqual(before);
  await source.close(); await target.close();
});

test('in-flight work restores paused, without a lease or automatic cloud submission', async () => {
  const source = await fixture(); const target = await openRepository(crypto.randomUUID());
  await source.claimJob(['voice'], 'private-live-lease', Date.now() + 10);
  const file = join(await encodeBackup(await source.snapshot('source-visitor'), digest));
  expect(new TextDecoder().decode(file).includes('private-live-lease')).toBe(false);
  const restored = await target.restore(await decodeBackup(file, digest));
  expect((await target.jobs()).find(j => j.kind === 'voice')).toMatchObject({ state: 'failed', attempts: 0 });
  expect((await target.jobs()).find(j => j.kind === 'voice')?.leaseId).toBeUndefined();
  expect(await target.claimJob(['voice'], 'automatic')).toBeUndefined();
  await target.retryJob(`${restored.draft.id}/voice-source`);
  expect((await target.claimJob(['voice'], 'explicit'))?.draftId).toBe(restored.draft.id);
  await source.close(); await target.close();
});

test('same-file retries and concurrent imports never overwrite edits or duplicate originals', async () => {
  const source = await fixture(); const name = crypto.randomUUID();
  const target = await openRepository(name); const secondTab = await openRepository(name);
  const verified = await decodeBackup(join(await encodeBackup(await source.snapshot('source-visitor'), digest)), digest);
  const imports = await Promise.all([target.restore(verified), secondTab.restore(verified)]);
  expect(imports.filter(result => result.created)).toHaveLength(1);
  expect(await target.list()).toHaveLength(1);
  const draft = imports[0].draft;
  await target.update(draft.id, { type: 'edit', patch: { contact: { name: 'Edited after restore' } } });
  expect((await target.restore(verified)).draft.contact.name).toBe('Edited after restore');
  expect(await target.jobs()).toHaveLength(2);
  await target.close(); await secondTab.close();
  const reopened = await openRepository(name);
  expect((await reopened.list())[0].contact.name).toBe('Edited after restore');
  expect(await reopened.media(draft.id, 'voice-source')).toEqual(new Uint8Array([4, 5, 6, 7]));
  // A restored copy can itself be backed up, including all remapped provenance.
  const again = await decodeBackup(join(await encodeBackup(await reopened.snapshot(draft.id), digest)), digest);
  expect(again.draft.contact.name).toBe('Edited after restore');
  await reopened.close(); await source.close();
});

test('corruption, truncation and appended data are rejected before any restore can be attempted', async () => {
  const source = await fixture(); const file = join(await encodeBackup(await source.snapshot('source-visitor'), digest));
  const corruptMedia = file.slice(); corruptMedia[corruptMedia.length - 1] ^= 255;
  const corruptMetadata = file.slice(); corruptMetadata[100] ^= 1;
  for (const bytes of [new Uint8Array(), file.subarray(0, 30), file.subarray(0, file.length - 1), corruptMedia, corruptMetadata, join([file, new Uint8Array([0])])]) {
    await expect(decodeBackup(bytes, digest)).rejects.toThrow();
  }
  await source.close();
});

test('import rejects malformed identities, source ownership, metadata, unsupported schemas and unsafe media', async () => {
  const source = await fixture(); const file = join(await encodeBackup(await source.snapshot('source-visitor'), digest));
  for (const mutate of [
    (r: any) => { r.format = 'pete-backup/v99'; },
    (r: any) => { r.draft.schemaVersion = 2; },
    (r: any) => { r.draft.id = '../another-visitor'; },
    (r: any) => { r.draft.contact.name = {}; },
    (r: any) => { r.draft.provenance['contact.email'].jobId = 'other/card-source'; },
    (r: any) => { r.draft.attachments[0].mimeType = 'image/svg+xml'; },
    (r: any) => { r.draft.attachments[1].consentConfirmed = false; },
    (r: any) => { r.draft.attachments[0].bytes = 999_999_999; },
    (r: any) => { r.draft.attachments.push(r.draft.attachments[0]); },
    (r: any) => { r.jobs[0].attachmentId = 'another-source'; },
    (r: any) => { r.jobs.pop(); },
    (r: any) => { r.jobs[0].result.text = 'x'.repeat(50_001); },
    (r: any) => { Object.defineProperty(r.draft.provenance, '__proto__', { value: { source: 'manual', at: now }, enumerable: true }); },
  ]) await expect(decodeBackup(await rewrite(file, mutate), digest)).rejects.toThrow();
  await source.close();
});

test('snapshot failure and a transaction conflict cannot leave a partially restored visitor', async () => {
  const source = await fixture(); const name = crypto.randomUUID(); const target = await openRepository(name);
  await target.create(createDraft('existing', 'contact', '', now), true);
  const snapshot = await source.snapshot('source-visitor');
  await expect(encodeBackup({ ...snapshot, media: snapshot.media.slice(1) }, digest)).rejects.toThrow('missing');
  const damaged: BackupSnapshot = { ...snapshot, media: snapshot.media.map(m => ({ ...m, bytes: new Uint8Array(m.bytes.length) })) };
  await expect(encodeBackup(damaged, digest)).rejects.toThrow('damaged');
  const verified = await decodeBackup(join(await encodeBackup(snapshot, digest)), digest);
  const restored = restoredSnapshot(verified);
  // Simulate an insertion conflict after the draft and media writes have started.
  const raw = await openDB(name);
  await raw.put('jobs', restored.jobs[0]);
  await expect(target.restore(verified)).rejects.toThrow();
  expect((await target.list()).map(d => d.id)).toEqual(['existing']);
  expect(await target.media(restored.draft.id, 'card-source')).toBeUndefined();
  expect(await target.activeDraft()).toBe('existing');
  raw.close(); await target.close(); await source.close();
});

test('metadata-only visitor backups work and follow-up previews require preparing again', async () => {
  const source = await openRepository(crypto.randomUUID());
  await source.create(createDraft('empty', 'contact', '', now));
  let snapshot = await source.snapshot('empty');
  snapshot.draft.followup = { id: 'intro', state: 'prepared', recipient: '+12025550182', message: 'Synthetic introduction', preparedAt: now };
  const restored = restoredSnapshot(await decodeBackup(join(await encodeBackup(snapshot, digest)), digest));
  expect(restored.draft.followup?.state).toBe('outdated');
  expect(restored.jobs).toHaveLength(0);
  expect(restored.media).toHaveLength(0);
  await source.close();
});

test('oversized backups and inconsistent source records fail before creating a file', async () => {
  const source = await fixture(); const snapshot = await source.snapshot('source-visitor');
  const oversized = { ...snapshot.draft, attachments: Array.from({ length: 3 }, () => ({ ...snapshot.draft.attachments[1], bytes: 60 * 1024 * 1024 })) };
  expect(() => assertBackupSize(oversized)).toThrow('too large');
  await expect(encodeBackup({ ...snapshot, jobs: snapshot.jobs.map(j => ({ ...j, draftId: 'different-visitor' })) }, digest)).rejects.toThrow('another visitor');
  await expect(encodeBackup({ ...snapshot, jobs: snapshot.jobs.map(j => ({ ...j, state: 'complete', result: undefined })) }, digest)).rejects.toThrow('incomplete');
  await source.close();
});
