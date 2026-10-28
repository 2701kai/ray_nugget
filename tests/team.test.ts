import { expect, test } from 'bun:test';
import 'fake-indexeddb/auto';
import type { ProcessingJob } from '../src/processing/jobs';
import { createDraft, reduceDraft } from '../src/domain/draft';
import { manifestText, mergeTeam } from '../src/team/merge';
import { openRepository } from '../src/storage/repository.web';
import { openTeamStorage } from '../src/team/storage.web';
import { hostedHandler } from '../server/hosted-api';
import { cloudBackups } from '../server/cloud-backups';
import type { hostedJobs } from '../server/hosted-jobs';
import type { AtomicStore, RecordValue } from '../server/hosted-store';
const date = '2026-10-28T08:00:00.000Z';
const base = () => ({ draft: createDraft('synthetic-team-visitor', 'contact', 'CIBUSTEC', date), jobs: [] as ProcessingJob[] });
const edited = (source: ReturnType<typeof base>, name: string) => ({ ...source, draft: reduceDraft(source.draft, { type: 'edit', patch: { contact: { name } } }, date) });

test('team merge combines separate fields and notes without crossing visitor identity', () => {
  const b = base(), l = edited(b, 'Synthetic visitor');
  const r = { ...b, draft: reduceDraft(b.draft, { type: 'addNote', id: 'other-note', text: 'Synthetic follow-up' }, date) };
  const result = mergeTeam(manifestText(b), manifestText(l), manifestText(r));
  expect(result.conflicts).toEqual([]);
  expect(result.snapshot.draft.contact.name).toBe('Synthetic visitor');
  expect(result.snapshot.draft.entries?.[0].text).toBe('Synthetic follow-up');
  expect(result.snapshot.draft.provenance['contact.name']).toEqual(l.draft.provenance['contact.name']);
  expect(() => mergeTeam(manifestText(b), manifestText(l), manifestText({ ...r, draft: { ...r.draft, id: 'another-visitor' } }))).toThrow('association');
});
test('same-field edits require a decision, intentional empty values and capacity units remain paired', () => {
  const b = edited(base(), 'Original');
  const l = edited(b, ''), r = edited(b, 'Team name');
  const pending = mergeTeam(manifestText(b), manifestText(l), manifestText(r));
  expect(pending.conflicts).toEqual(['contact.name']);
  const resolved = mergeTeam(manifestText(b), manifestText(l), manifestText(r), { 'contact.name': 'local' });
  expect(resolved.conflicts).toEqual([]); expect(resolved.snapshot.draft.contact.name).toBe('');
  const capacity = (n: string, unit: 'bottles/h' | 'L/h') => ({ ...b, draft: reduceDraft(b.draft, { type: 'edit', patch: { request: { throughput: n, unit } } }, date) });
  const merged = mergeTeam(manifestText(b), manifestText(capacity('1200', 'bottles/h')), manifestText(capacity('90', 'L/h')), { 'request.throughput': 'team' });
  expect(merged.conflicts).toEqual([]); expect(merged.snapshot.draft.request).toMatchObject({ throughput: '90', unit: 'L/h' });
});
test('team storage applies atomically, preserves private data and rejects a stale download after local editing', async () => {
  const name = `team-test-${crypto.randomUUID()}`, repo = await openRepository(name), team = await openTeamStorage(name);
  try {
    const b = base(); await repo.create(b.draft);
    await team.share(b.draft.id, { id: 'test-event', name: 'CIBUSTEC', members: [] });
    const before = (await team.read(b.draft.id)).snapshot!;
    const remote = edited(before, 'Remote name');
    await repo.update(b.draft.id, { type: 'edit', patch: { contact: { name: 'Local edit during download' } } });
    expect(await team.apply(remote, [], manifestText(before), { teamId: 'test-event', base: manifestText(remote) })).toBe(false);
    expect((await repo.list())[0].contact.name).toBe('Local edit during download');
    expect((await team.links())[b.draft.id].base).toBeUndefined();
    const latest = (await team.read(b.draft.id)).snapshot!;
    expect(await team.apply(remote, [], manifestText(latest), { teamId: 'test-event', base: manifestText(remote) })).toBe(true);
    expect((await repo.list())[0].id).toBe(b.draft.id);
  } finally { team.close(); await repo.close(); indexedDB.deleteDatabase(name); }
});
class MemoryStore implements AtomicStore {
  records = new Map<string, RecordValue>();
  async read<T>(key: string) { return structuredClone(this.records.get(key)) as T | undefined; }
  async atomic<T>(keys: string[], run: (records: Record<string, RecordValue | undefined>) => { result: T; writes?: Record<string, RecordValue> }) {
    const { result, writes } = run(Object.fromEntries(keys.map(key => [key, structuredClone(this.records.get(key))])));
    for (const [key, value] of Object.entries(writes ?? {})) this.records.set(key, structuredClone(value));
    return result;
  }
}
test('team API admits only configured verified members, keeps personal copies private, and fences stale saves', async () => {
  const store = new MemoryStore(), files = new Map<string, Uint8Array>();
  const cloud = cloudBackups(store, { async begin() { return 'https://storage.googleapis.com/synthetic'; }, async inspect() { return undefined; }, async put(name, bytes) { files.set(name, bytes); }, async read(name) { const b = files.get(name); return b ? new Response(new Uint8Array(b)) : undefined; } }, async owner => [...store.records].filter(([k]) => k.startsWith(`cloudOwners/${owner}/drafts/`)).map(([, v]) => v as any));
  const handler = hostedHandler({} as ReturnType<typeof hostedJobs>, async token => ({ uid: token, email: `${token}@bevmaq.com`, email_verified: token !== 'unverified' }), ['https://test.example'], 'synthetic', undefined, cloud, [{ id: 'test-event', name: 'CIBUSTEC', members: ['alpha@bevmaq.com', 'beta@bevmaq.com', 'unverified@bevmaq.com'] }]);
  const call = (token: string, path: string, body?: unknown) => handler(new Request(`https://test.example/api${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, Origin: 'https://test.example', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  const id = new Bun.CryptoHasher('sha256').update(base().draft.id).digest('hex');
  const initial = await call('alpha', `/teams/test-event/drafts/${id}`, { manifest: manifestText(base()), expected: null });
  expect(initial.status).toBe(200); const saved = await initial.json();
  expect(saved.createdBy).toBe('alpha@bevmaq.com');
  expect((await call('beta', `/teams/test-event/drafts/${id}`)).status).toBe(200);
  expect((await call('outsider', `/teams/test-event/drafts/${id}`)).status).toBe(403);
  expect((await call('unverified', '/teams')).status).toBe(403);
  expect(await (await call('beta', '/cloud/drafts')).json()).toEqual([]);
  const updated = await call('beta', `/teams/test-event/drafts/${id}`, { manifest: manifestText(edited(base(), 'Beta edit')), expected: saved.fingerprint });
  expect(updated.status).toBe(200); expect(await updated.json()).toMatchObject({ createdBy: 'alpha@bevmaq.com', updatedBy: 'beta@bevmaq.com' });
  expect((await call('alpha', `/teams/test-event/drafts/${id}`, { manifest: manifestText(edited(base(), 'Stale alpha edit')), expected: saved.fingerprint })).status).toBe(409);
  expect((await call('alpha', `/teams/test-event/drafts/${'f'.repeat(64)}`, { manifest: manifestText(base()), expected: null })).status).toBe(409);
  const wrongEvent = base(); wrongEvent.draft.event = 'Different event';
  expect((await call('alpha', `/teams/test-event/drafts/${id}`, { manifest: manifestText(wrongEvent), expected: null })).status).toBe(409);
});

test('a received team note preserves the source device processing lease and original bytes', async () => {
  const name = `team-pending-${crypto.randomUUID()}`, repo = await openRepository(name), team = await openTeamStorage(name);
  try {
    const b = base(); await repo.create(b.draft);
    const bytes = new Uint8Array([1, 3, 7, 9]);
    const attachment = { id: 'shared-recording', kind: 'voice' as const, name: 'Synthetic recording', bytes: bytes.length, sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), mimeType: 'audio/webm', capturedAt: date, voiceMode: 'memo' as const };
    await repo.update(b.draft.id, { type: 'attach', attachment }, undefined, bytes);
    const job = await repo.claimJob(['voice'], 'active-source-lease'); expect(job).toBeDefined();
    const current = (await team.read(b.draft.id)).snapshot!;
    const draft = reduceDraft(current.draft, { type: 'addNote', id: 'team-note', text: 'Synthetic team detail' }, date);
    const { decodeManifest } = await import('../src/backup/archive');
    const portable = decodeManifest(new TextEncoder().encode(manifestText({ draft, jobs: current.jobs })));
    expect(portable.jobs[0].state).toBe('failed');
    expect(await team.apply(portable, [], manifestText(current), { teamId: 'synthetic-team', base: manifestText(portable) })).toBe(true);
    expect((await repo.jobs())[0]).toMatchObject({ state: 'running', leaseId: 'active-source-lease' });
    expect(await repo.media(draft.id, attachment.id)).toEqual(bytes);
    expect(await repo.finishJob(job!.id, 'active-source-lease', { text: 'Synthetic', engine: 'fixture', fields: { name: 'Spoken name' } })).toBe(true);
    expect((await repo.list())[0].entries?.[0].text).toBe('Synthetic team detail');
    expect((await repo.list())[0].contact.name).toBe('Spoken name');
  } finally { team.close(); await repo.close(); indexedDB.deleteDatabase(name); }
});

test('sharing an independently restored copy has no invented baseline and requires resolving differing fields', () => {
  const local = base(), remote = edited(base(), 'Name already in team');
  const result = mergeTeam(undefined, manifestText(local), manifestText(remote));
  expect(result.conflicts).toEqual(['contact.name']);
  expect(result.snapshot.draft.contact.name).toBe('');
  const chosen = mergeTeam(undefined, manifestText(local), manifestText(remote), { 'contact.name': 'team' });
  expect(chosen.conflicts).toEqual([]); expect(chosen.snapshot.draft.contact.name).toBe('Name already in team');
});
