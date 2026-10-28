import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { openRepository } from '../src/storage/repository.web';
import { createDraft, type Attachment } from '../src/domain/draft';
import { decodeBackup, encodeBackup, decodeManifest, encodeManifest } from '../src/backup/archive';
import { sourceText, sourceAttribution } from '../src/processing/source';
import { prepareRayInput } from '../src/ray/brief';
import { continuationBlock } from '../src/ray/continuation';
import { manifestText, mergeTeam } from '../src/team/merge';

const digest = async (b: Uint8Array) => new Bun.CryptoHasher('sha256').update(b).digest('hex');
async function fixture() {
  const name = crypto.randomUUID(), repo = await openRepository(name);
  const at = '2026-10-28T10:00:00.000Z';
  await repo.create(createDraft('visitor', 'voice', 'Synthetic fair', at));
  const media = new Uint8Array([1, 2, 3]);
  const attachment: Attachment = { id: 'answer', kind: 'voice', name: 'Voice note', mimeType: 'audio/webm', bytes: media.length, sha256: await digest(media), capturedAt: at };
  await repo.update('visitor', { type: 'attach', attachment }, undefined, media);
  const now = Date.now() + 100;
  const job = (await repo.claimJob(['voice'], 'old-lease', now))!;
  await repo.finishJob(job.id, 'old-lease', { text: 'Frühstück mm', fields: {}, engine: 'Google Gemini · EU', sourceEngine: 'Google Speech-to-Text V2 · chirp_3 · eu', questions: ['Some details are unclear.'] }, now + 1);
  return { name, repo, job, now };
}

test('corrected wording survives restart and backup while original transcript and audio stay intact', async () => {
  const { name, repo, job, now } = await fixture();
  const draft = (await repo.list())[0];
  await repo.correctTranscript(job.id, 'Fruchtstücke, maximal 1 mm.', 'edit-one', draft.revision, now + 2);
  const snapshot = await repo.snapshot(draft.id);
  expect(snapshot.jobs[0].state).toBe('queued');
  expect(sourceText(snapshot.jobs[0].result)).toBe('Fruchtstücke, maximal 1 mm.');
  expect(snapshot.jobs[0].result!.text).toBe('Frühstück mm');
  expect(snapshot.media[0].bytes).toEqual(new Uint8Array([1, 2, 3]));
  const decoded = decodeManifest(encodeManifest(snapshot));
  expect(decoded.jobs[0].state).toBe('failed'); // imported unfinished work is paused
  expect(sourceText(decoded.jobs[0].result)).toBe('Fruchtstücke, maximal 1 mm.');
  expect(decoded.jobs[0].result!.text).toBe('Frühstück mm');
  expect(sourceAttribution(decoded.jobs[0].result)).toContain('Speech-to-Text V2');
  const parts = await encodeBackup(snapshot, digest);
  expect(new TextDecoder().decode(parts[0]).startsWith('PETE_BACKUP_V2\n')).toBe(true);
  expect(JSON.parse(new TextDecoder().decode(parts[1])).format).toBe('pete-backup/v2');
  const bytes = new Uint8Array(await new Blob(parts.map(part => new Uint8Array(part))).arrayBuffer());
  const restored = await decodeBackup(bytes, digest);
  expect(sourceText(restored.jobs[0].result)).toBe('Fruchtstücke, maximal 1 mm.');
  expect(restored.media[0].bytes).toEqual(snapshot.media[0].bytes);
  const mismatched = bytes.slice(); mismatched['PETE_BACKUP_V'.length] = '1'.charCodeAt(0);
  await expect(decodeBackup(mismatched, digest)).rejects.toThrow('unsupported');
  expect(continuationBlock(snapshot.draft, snapshot.jobs)).toBe('processing');
  expect(await repo.finishJob(job.id, 'old-lease', job.result!, now + 3)).toBe(false);
  await repo.close();
  const reopened = await openRepository(name);
  expect(sourceText((await reopened.jobs())[0].result)).toBe('Fruchtstücke, maximal 1 mm.');
  await reopened.close();
});

test('reinterpreting a correction adds the missing value and sends corrected evidence to Ray', async () => {
  const { repo, job, now } = await fixture();
  let draft = (await repo.list())[0];
  await repo.correctTranscript(job.id, 'Fruchtstücke, maximal 1 mm.', 'edit-one', draft.revision, now + 2);
  const current = (await repo.claimJob(['voice'], 'new-lease', now + 3))!;
  expect(current.result!.text).toBe('Frühstück mm');
  await repo.finishJob(job.id, 'new-lease', { ...current.result!, fields: {}, request: { particleSize: '1 mm', productProperties: 'Fruchtstücke' }, questions: [] }, now + 4);
  draft = (await repo.list())[0];
  const jobs = await repo.jobs();
  expect(draft.request.particleSize).toBe('1 mm');
  expect(draft.request.productProperties).toBe('Fruchtstücke');
  expect(continuationBlock(draft, jobs)).toBeUndefined();
  const input = await prepareRayInput(draft, jobs, digest);
  expect(input.brief).toContain('1 mm');
  expect(input.brief).not.toContain('Frühstück');
  await expect(repo.correctTranscript(job.id, '2 mm', 'edit-two', draft.revision - 1, now + 5)).rejects.toThrow('changed');
  await repo.close();
});

test('competing corrections require a choice and preserve both correction histories', async () => {
  const { repo, job, now } = await fixture();
  const before = await repo.snapshot('visitor'), base = manifestText(before);
  await repo.correctTranscript(job.id, 'Fruchtstücke 1 mm', 'local-edit', before.draft.revision, now + 2);
  const local = await repo.snapshot('visitor');
  const remote = structuredClone(local);
  remote.jobs[0].result!.sourceEdits = [{ id: 'remote-edit', text: 'Fruchtstücke 1.5 mm', createdAt: new Date(now + 3).toISOString() }];
  remote.jobs[0].result!.activeEditId = 'remote-edit';
  const conflict = mergeTeam(base, manifestText(local), manifestText(remote));
  expect(conflict.conflicts).toContain('job.visitor/answer');
  const selected = mergeTeam(base, manifestText(local), manifestText(remote), { 'job.visitor/answer': 'team' });
  expect(selected.conflicts).toEqual([]);
  expect(sourceText(selected.snapshot.jobs[0].result)).toBe('Fruchtstücke 1.5 mm');
  expect(selected.snapshot.jobs[0].result!.sourceEdits).toHaveLength(2);
  expect(sourceText(decodeManifest(encodeManifest(selected.snapshot)).jobs[0].result)).toBe('Fruchtstücke 1.5 mm');
  await repo.close();
});

test('legacy extraction labels do not invent historical transcription provenance', () => {
  expect(sourceAttribution({ text: 'text', fields: {}, engine: 'Google gemini-3.1-flash-lite · EU' })).toBe('Original transcription engine was not retained');
});

test('completed interpretation supersedes paused processing of the same correction', async () => {
  const { repo, job, now } = await fixture();
  const before = await repo.snapshot('visitor');
  await repo.correctTranscript(job.id, 'Fruit pieces, maximum 1 mm.', 'edit-one', before.draft.revision, now + 2);
  const pending = await repo.snapshot('visitor');
  const running = (await repo.claimJob(['voice'], 'corrected-lease', now + 3))!;
  await repo.finishJob(job.id, 'corrected-lease', { ...running.result!, fields: {}, request: { particleSize: '1 mm' }, questions: [] }, now + 4);
  const complete = await repo.snapshot('visitor');
  for (const [local, remote] of [[pending, complete], [complete, pending]]) {
    const result = mergeTeam(manifestText(before), manifestText(local), manifestText(remote));
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.jobs[0].state).toBe('complete');
    expect(result.snapshot.jobs[0].result!.request!.particleSize).toBe('1 mm');
  }
  await repo.close();
});
