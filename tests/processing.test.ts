import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { openDB } from 'idb';
import { openRepository } from '../src/storage/repository.web';
import { createDraft, type Attachment } from '../src/domain/draft';
import { contactCandidates } from '../src/processing/contact';
import { LEASE_MS } from '../src/processing/jobs';

const card: Attachment = { id: 'card', kind: 'card', name: 'synthetic.png', mimeType: 'image/png', bytes: 3, sha256: 'synthetic', capturedAt: '2026-10-27T13:00:00.000Z' };
const result = { text: 'Company: Test GmbH\nhello@example.test', fields: { company: 'Test GmbH', email: 'hello@example.test' }, engine: 'Synthetic test processor' };
async function setup() {
  const name = crypto.randomUUID(); const repo = await openRepository(name);
  await repo.create(createDraft('visitor-a', 'card', '', card.capturedAt));
  await repo.update('visitor-a', { type: 'attach', attachment: card }, undefined, new Uint8Array([1, 2, 3]));
  return { name, repo };
}

test('capture atomically queues one job; failed saves and duplicate media do not create work', async () => {
  const { repo } = await setup();
  await repo.update('visitor-a', { type: 'attach', attachment: { ...card, id: 'duplicate' } }, undefined, new Uint8Array([1, 2, 3]));
  await expect(repo.update('visitor-a', { type: 'attach', attachment: { ...card, id: 'broken', sha256: 'different' } }, undefined, new Uint8Array([1]))).rejects.toThrow();
  expect(await repo.jobs()).toHaveLength(1);
  expect((await repo.jobs())[0]).toMatchObject({ draftId: 'visitor-a', attachmentId: 'card', state: 'queued' });
  await repo.close();
});

test('one tab owns a job; expired owners cannot finish or renew after a restart', async () => {
  const { name, repo } = await setup(); const other = await openRepository(name); const now = Date.now() + 100;
  const claims = await Promise.all([repo.claimJob(['card'], 'first', now), other.claimJob(['card'], 'second', now)]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const job = claims.find(Boolean)!;
  await repo.close();
  const resumed = await other.claimJob(['card'], 'resumed', now + LEASE_MS + 1);
  expect(resumed?.id).toBe(job.id);
  expect(await other.finishJob(job.id, job.leaseId!, result, now + LEASE_MS + 2)).toBe(false);
  expect(await other.renewJob(job.id, job.leaseId!, now + LEASE_MS + 2)).toBe(false);
  expect(await other.finishJob(job.id, 'resumed', result, now + LEASE_MS + 2)).toBe(true);
  expect(await other.claimJob(['card'], 'duplicate', now + LEASE_MS + 3)).toBeUndefined();
  expect((await other.list())[0].contact.email).toBe('');
  await other.close();
});

test('failure backs off, exhausts automatic attempts, and manual retry survives reopening', async () => {
  const { name, repo } = await setup(); let now = Date.now() + 100;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const job = await repo.claimJob(['card'], `lease-${attempt}`, now);
    expect(job?.attempts).toBe(attempt);
    await repo.failJob(job!.id, job!.leaseId!, 'Synthetic processor unavailable', now + 1);
    expect(await repo.claimJob(['card'], 'too-early', now + 2)).toBeUndefined();
    now += 5000 * attempt ** 2 + 2;
  }
  expect((await repo.jobs())[0].state).toBe('failed');
  await repo.retryJob((await repo.jobs())[0].id, now); await repo.close();
  const reopened = await openRepository(name);
  expect((await reopened.claimJob(['card'], 'retry', now + 1))?.attempts).toBe(1);
  await reopened.close();
});

test('result review preserves manual details until explicitly selected and fences stale forms', async () => {
  const { repo } = await setup(); const now = Date.now() + 100;
  const job = (await repo.claimJob(['card'], 'worker', now))!;
  await repo.update('visitor-a', { type: 'edit', patch: { contact: { company: 'Manual company' } } });
  await repo.finishJob(job.id, 'worker', result, now + 1);
  const draft = (await repo.list())[0];
  expect(draft.contact.company).toBe('Manual company');
  await expect(repo.reviewJob(job.id, result.fields, 0)).rejects.toThrow('changed while');
  expect((await repo.jobs())[0].reviewedAt).toBeUndefined();
  const reviewed = await repo.reviewJob(job.id, { email: result.fields.email }, draft.revision);
  expect(reviewed.contact).toMatchObject({ company: 'Manual company', email: result.fields.email });
  expect(reviewed.provenance['contact.email']).toMatchObject({ source: 'extraction', jobId: job.id, attachmentId: card.id });
  expect(reviewed.provenance['contact.email'].reviewedAt).toBeDefined();
  expect((await repo.reviewJob(job.id, result.fields, draft.revision)).revision).toBe(reviewed.revision);
  await repo.close();
});

test('version-one database upgrades without losing original media or drafts', async () => {
  const name = crypto.randomUUID();
  const legacy = await openDB(name, 1, { upgrade(db) { db.createObjectStore('drafts', { keyPath: 'id' }); db.createObjectStore('media'); db.createObjectStore('settings'); } });
  const draft = createDraft('old', 'card', 'Old event', card.capturedAt); draft.attachments.push(card);
  await legacy.put('drafts', draft); await legacy.put('media', new Uint8Array([7, 8, 9]), 'old:card'); legacy.close();
  const repo = await openRepository(name);
  expect((await repo.list())[0]).toEqual(draft);
  expect(await repo.media('old', 'card')).toEqual(new Uint8Array([7, 8, 9]));
  expect(await repo.jobs()).toHaveLength(1);
  expect((await repo.jobs())[0].draftId).toBe('old');
  await repo.close();
});

test('RFQ review commits selected fields and source provenance atomically to its original visitor', async () => {
  const { repo, name } = await setup();
  const voice: Attachment = { ...card, id: 'voice', kind: 'voice', sha256: 'voice-synthetic', mimeType: 'audio/webm' };
  await repo.update('visitor-a', { type: 'attach', attachment: voice }, undefined, new Uint8Array([1, 2, 3]));
  await repo.create(createDraft('visitor-b', 'contact', '', card.capturedAt), true);
  const job = (await repo.claimJob(['voice'], 'worker', Date.now() + 100))!;
  // This is the old stored extraction shape: no migration or repeat cloud work.
  await repo.finishJob(job.id, 'worker', { ...result, text: 'We need juice in glass bottles at 2400 bottles/h.' });
  let draft = (await repo.list()).find(d => d.id === 'visitor-a')!;
  const stale = draft.revision;
  draft = await repo.update(draft.id, { type: 'edit', patch: { request: { product: 'Manual product', packaging: '' } } });
  const options = { request: { capacity: { throughput: '2400', unit: 'bottles/h' as const } }, appendTranscript: true };
  await expect(repo.reviewJob(job.id, {}, stale, options)).rejects.toThrow('changed while');
  await expect(repo.reviewJob(job.id, {}, draft.revision, { request: { product: 'Must not partially save', capacity: { throughput: '0', unit: '' } } })).rejects.toThrow('positive throughput');
  expect((await repo.jobs()).find(j => j.id === job.id)?.reviewedAt).toBeUndefined();
  expect((await repo.list()).find(d => d.id === draft.id)?.request.product).toBe('Manual product');
  const reviewed = await repo.reviewJob(job.id, {}, draft.revision, options);
  expect(reviewed.request).toMatchObject({ product: 'Manual product', packaging: '', throughput: '2400', unit: 'bottles/h', intent: 'unspecified' });
  expect(reviewed.note).toBe('We need juice in glass bottles at 2400 bottles/h.');
  expect((await repo.list()).find(d => d.id === 'visitor-b')?.request.throughput).toBe('');
  expect(await repo.activeDraft()).toBe('visitor-b');
  expect((await repo.reviewJob(job.id, {}, stale, options)).revision).toBe(reviewed.revision);
  await repo.close();
  const reopened = await openRepository(name);
  expect((await reopened.list()).find(d => d.id === draft.id)?.provenance['request.throughput']).toMatchObject({ attachmentId: voice.id, jobId: job.id, source: 'extraction' });
  await reopened.close();
});

test('candidate extraction keeps ambiguous contact values in the text and does not invent country codes', () => {
  expect(contactCandidates('Name: Synthetic Visitor\nFirma: Test GmbH\nhello@example.test\n+1 202 555 0182')).toEqual({ name: 'Synthetic Visitor', company: 'Test GmbH', email: 'hello@example.test', phone: '+12025550182' });
  expect(contactCandidates('0171 5550101\na@example.test\nb@example.test')).toEqual({});
  expect(contactCandidates('+1 202 555 0182\n+1 202 555 0183').phone).toBeUndefined();
});
