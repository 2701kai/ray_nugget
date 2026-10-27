import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { openRepository } from '../src/storage/repository.web';
import { createDraft, type Attachment } from '../src/domain/draft';

const now = '2026-10-27T13:00:00.000Z';
const card: Attachment = { id: 'card', kind: 'card', name: 'synthetic.png', mimeType: 'image/png', bytes: 3, sha256: 'synthetic-hash', capturedAt: now };

test('metadata and original media survive closing/reopening, with visitor isolation', async () => {
  const name = crypto.randomUUID();
  let repo = await openRepository(name);
  await repo.create(createDraft('a', 'card', 'Fair', now));
  await repo.create(createDraft('b', 'contact', 'Fair', now));
  await repo.update('a', { type: 'attach', attachment: card }, undefined, new Uint8Array([9, 4, 7]));
  await repo.update('b', { type: 'edit', patch: { contact: { name: 'Second visitor' } } });
  await repo.close();
  repo = await openRepository(name);
  expect((await repo.list()).find(d => d.id === 'a')?.attachments).toHaveLength(1);
  expect(await repo.media('a', card.id)).toEqual(new Uint8Array([9, 4, 7]));
  expect(await repo.media('b', card.id)).toBeUndefined();
  expect((await repo.list()).find(d => d.id === 'b')?.attachments).toHaveLength(0);
  await repo.close();
});

test('failed attachment persistence rolls back metadata and a retry can save it', async () => {
  const repo = await openRepository(crypto.randomUUID());
  await repo.create(createDraft('a', 'card', '', now));
  await expect(repo.update('a', { type: 'attach', attachment: card }, undefined, new Uint8Array([1]))).rejects.toThrow('complete file');
  expect((await repo.list())[0].attachments).toHaveLength(0);
  expect((await repo.list())[0].revision).toBe(0);
  expect(await repo.media('a', card.id)).toBeUndefined();
  await repo.update('a', { type: 'attach', attachment: card }, undefined, new Uint8Array([1, 2, 3]));
  await repo.update('a', { type: 'attach', attachment: { ...card, id: 'retry' } }, undefined, new Uint8Array([1, 2, 3]));
  expect((await repo.list())[0].attachments).toHaveLength(1);
  expect(await repo.media('a', 'retry')).toBeUndefined();
  await repo.close();
});

test('concurrent patches retain both edits and stale forms cannot overwrite newer data', async () => {
  const name = crypto.randomUUID();
  const a = await openRepository(name);
  const b = await openRepository(name);
  await a.create(createDraft('a', 'contact', '', now));
  await Promise.all([
    a.update('a', { type: 'edit', patch: { contact: { name: 'Visitor A' } } }),
    b.update('a', { type: 'edit', patch: { contact: { company: 'Company A' } } }),
  ]);
  expect((await a.list())[0].contact).toMatchObject({ name: 'Visitor A', company: 'Company A' });
  await expect(a.update('a', { type: 'edit', patch: { contact: { name: 'Stale form' } } }, 0)).rejects.toThrow('changed while');
  expect((await b.list())[0].contact.name).toBe('Visitor A');
  await a.close(); await b.close();
});

test('active visitor survives reopening; append-only notes survive concurrent writes and retries', async () => {
  const name = crypto.randomUUID();
  const a = await openRepository(name);
  const b = await openRepository(name);
  await a.create(createDraft('a', 'contact', '', now), true);
  await b.create(createDraft('b', 'voice', '', now), true);
  await a.activateDraft('a');
  await Promise.all([
    a.update('a', { type: 'addNote', id: 'one', text: 'First requirement' }),
    b.update('a', { type: 'addNote', id: 'two', text: 'Second requirement' }),
  ]);
  await a.update('a', { type: 'addNote', id: 'one', text: 'First requirement' });
  await expect(a.activateDraft('missing')).rejects.toThrow('no longer exists');
  await a.close(); await b.close();
  const reopened = await openRepository(name);
  expect(await reopened.activeDraft()).toBe('a');
  const records = await reopened.list();
  expect(records.find(d => d.id === 'a')?.entries?.map(e => e.text).sort()).toEqual(['First requirement', 'Second requirement']);
  expect(records.find(d => d.id === 'b')?.entries).toBeUndefined();
  await reopened.close();
});
