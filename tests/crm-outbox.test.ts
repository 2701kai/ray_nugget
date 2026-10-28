import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cloudBackups } from '../server/cloud-backups';
import { crmDelivery, type CrmDelivery, type CrmReceipt } from '../server/crm-delivery';
import { crmOutbox, type OutboxHead, type OutboxOperation } from '../server/crm-outbox';
import { crmWorker } from '../server/crm-worker';
import { createDraft, reduceDraft } from '../src/domain/draft';
import { encodeManifest } from '../src/backup/archive';
import { sqliteAtomic } from './helpers/sqlite-atomic';
import { runConfiguredCrmWorker } from '../server/run-crm-worker';

const sha = (value: string | Uint8Array) => new Bun.CryptoHasher('sha256').update(value).digest('hex');
const team = { id: 'synthetic-outbox', event: 'Synthetic fair', actor: 'alpha@example.test', members: ['alpha@example.test', 'beta@example.test'] };
const scope = sha(`pete-team/${team.id}`), when = '2026-10-28T12:00:00.000Z';
function fixture(path?: string) {
  const db = sqliteAtomic(path), files = new Map<string, string>(), remote = new Map<string, CrmReceipt>();
  let time = Date.parse(when), posts = 0, status = 200, lost = false;
  const transport = crmDelivery({ endpoint: 'https://crm.example.test/api/v1/pete-intake/', audience: 'https://crm.example.test', token: async () => 'synthetic', fetch: async (url, init) => {
    if (status !== 200) return Response.json({ error: 'Synthetic rejection; never persist this response body.' }, { status });
    if (init?.method === 'GET') {
      const receipt = remote.get(String(url).split('/').at(-1)!);
      return Response.json(receipt ?? {}, { status: receipt ? 200 : 404 });
    }
    const sent = JSON.parse(init?.body as string) as CrmDelivery; posts++;
    let receipt = remote.get(sent.operationId);
    if (!receipt) {
      receipt = { format: 'pete-crm-receipt/v1', operationId: sent.operationId, leadId: sent.leadId, sequence: sent.sequence,
        sourceReceiptId: sent.sourceReceiptId, envelopeSha256: sent.envelopeSha256, status: 'received', recordId: sent.leadId, receivedAt: new Date(time).toISOString(), messagesSent: false };
      remote.set(sent.operationId, receipt);
    }
    if (lost) { lost = false; throw new Error('Synthetic response loss'); }
    return Response.json(receipt);
  } });
  const queue = crmOutbox(transport.destinationId, () => time);
  const storage = {
    async put(path: string, bytes: Uint8Array) { if (!files.has(path)) files.set(path, new TextDecoder().decode(bytes)); },
    async read(path: string) { const value = files.get(path); return value === undefined ? undefined : new Response(value); },
    async inspect(_path: string) { return undefined; },
    async begin() { return 'https://storage.example.test/synthetic'; },
  };
  const service = (enabled = true) => cloudBackups(db.store, storage, async () => [], () => time, enabled ? queue : undefined);
  let draft = createDraft('synthetic-queued-visitor', 'contact', team.event, when);
  draft = reduceDraft(draft, { type: 'edit', patch: { contact: { name: 'Synthetic visitor' } } }, when);
  const id = sha(draft.id), leadId = sha(`pete-lead/v1/${scope}/${id}`);
  const worker = (overrides: Partial<Parameters<typeof crmWorker>[0]> = {}) => crmWorker({ store: db.store, transport, readSource: async path => files.get(path), now: () => time, random: () => 0.5, ...overrides });
  const head = () => db.store.read<OutboxHead>(queue.key(leadId));
  const operation = (n: number) => db.store.read<OutboxOperation>(queue.operationKey(leadId, n));
  return { ...db, files, remote, transport, queue, draft, id, leadId, service, worker, head, operation,
    advance: (ms = 130_000) => { time += ms; }, time: () => time,
    posts: () => posts, reject: (value: number) => { status = value; }, loseResponse: () => { lost = true; } };
}

test('source and owner changes enqueue once in their save transactions, including processing with unchanged draft revision', async () => {
  const f = fixture();
  try {
    const service = f.service(), snapshot = { draft: f.draft, jobs: [] };
    const first = await service.save(scope, f.id, encodeManifest(snapshot), null, team);
    await service.save(scope, f.id, encodeManifest(snapshot), null, { ...team, actor: team.members[1] });
    expect((await f.head())?.sequence).toBe(1);
    // A source snapshot can change without a larger draft revision.
    snapshot.draft = { ...f.draft, note: 'Synthetic processing-enriched source' };
    const second = await service.save(scope, f.id, encodeManifest(snapshot), first.fingerprint, team);
    expect(second.revision).toBe(first.revision); expect((await f.head())?.sequence).toBe(2);
    await service.assign(scope, f.id, team, team.members[1], 1);
    await service.assign(scope, f.id, team, team.members[1], 1); // Lost assignment response.
    expect((await f.head())?.sequence).toBe(3);
    expect((await f.operation(2))?.sourceReceiptId).toBe((await f.operation(3))?.sourceReceiptId);
    expect((await f.operation(3))?.owner).toEqual({ email: team.members[1], version: 2 });
    await expect(service.save(scope, f.id, encodeManifest({ draft: f.draft, jobs: [] }), second.fingerprint, team)).rejects.toMatchObject({ status: 409 });
    expect((await f.head())?.sequence).toBe(3);
  } finally { f.close(); }
});

test('disabled destinations, personal saves and empty visitors never queue; explicit backfill adds only the latest source', async () => {
  const f = fixture();
  try {
    const bytes = encodeManifest({ draft: f.draft, jobs: [] });
    const saved = await f.service(false).save(scope, f.id, bytes, null, team);
    expect(await f.head()).toBeUndefined();
    await f.service().save('personal-owner', f.id, bytes, null);
    expect(await f.head()).toBeUndefined();
    const empty = createDraft('empty', 'contact', team.event, when);
    await f.service().save(scope, sha(empty.id), encodeManifest({ draft: empty, jobs: [] }), null, team);
    expect(f.entries().filter(([key]) => key.startsWith('crmOutboxes/'))).toHaveLength(0);
    expect(await f.service().save(scope, f.id, bytes, saved.fingerprint, team)).toEqual(saved);
    await f.service().save(scope, f.id, bytes, saved.fingerprint, team);
    expect((await f.head())?.sequence).toBe(1);
  } finally { f.close(); }
});

test('a failed queue append rolls back cloud pointer, intake receipt and owner change', async () => {
  const f = fixture();
  try {
    f.db.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON records WHEN NEW.key LIKE 'crmOutboxes/%/operations/%' BEGIN SELECT RAISE(ABORT, 'Synthetic queue write failure'); END");
    await expect(f.service().save(scope, f.id, encodeManifest({ draft: f.draft, jobs: [] }), null, team)).rejects.toThrow('queue write failure');
    expect(await f.service().get(scope, f.id)).toBeUndefined(); expect(f.entries()).toEqual([]);
    f.db.exec('DROP TRIGGER fail_queue');
    const saved = await f.service().save(scope, f.id, encodeManifest({ draft: f.draft, jobs: [] }), null, team);
    f.db.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON records WHEN NEW.key LIKE 'crmOutboxes/%/operations/%' BEGIN SELECT RAISE(ABORT, 'Synthetic queue write failure'); END");
    await expect(f.service().assign(scope, f.id, team, team.members[1], 1)).rejects.toThrow('queue write failure');
    expect(await f.service().get(scope, f.id)).toEqual(saved);
    expect((await f.head())?.sequence).toBe(1);
  } finally { f.close(); }
});

test('concurrent workers claim once and new edits during delivery retain their place in the queue', async () => {
  const f = fixture();
  try {
    const saved = await f.service().save(scope, f.id, encodeManifest({ draft: f.draft, jobs: [] }), null, team);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
    const worker = f.worker({ readSource: async path => { started(); await gate; return f.files.get(path); } });
    const first = worker.run(f.leadId); await ready;
    expect(await f.worker().run(f.leadId)).toBe('skipped');
    await f.service().assign(scope, f.id, team, team.members[1], 1);
    release(); expect(await first).toBe('acknowledged');
    expect(await f.head()).toMatchObject({ settled: 1, sequence: 2, state: 'ready' });
    expect(await f.worker().run(f.leadId)).toBe('acknowledged');
    expect(await f.head()).toMatchObject({ settled: 2, sequence: 2, state: 'idle' });
    expect(f.posts()).toBe(2); expect((await f.operation(1))?.receipt?.sourceReceiptId).toBe(saved.lead?.receiptId);
  } finally { f.close(); }
});

test('a lost response recovers by receipt lookup after a durable-store restart, without another POST', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pete-outbox-test-')), path = join(dir, 'queue.sqlite');
  const f = fixture(path);
  try {
    await f.service().save(scope, f.id, encodeManifest({ draft: f.draft, jobs: [] }), null, team);
    f.loseResponse(); expect(await f.worker().run(f.leadId)).toBe('retry'); expect(f.posts()).toBe(1);
    expect((await f.head())?.wakeAt).toBe(f.time() + 5000);
    f.close(); f.advance();
    const restarted = sqliteAtomic(path);
    try {
      expect(await f.worker({ store: restarted.store }).run(f.leadId)).toBe('acknowledged');
      expect(f.posts()).toBe(1);
      expect(await restarted.store.read(queueKey(f))).toMatchObject({ settled: 1, state: 'idle' });
    } finally { restarted.close(); }
  } finally { f.close(); rmSync(dir, { recursive: true, force: true }); }
});
const queueKey = (f: ReturnType<typeof fixture>) => f.queue.key(f.leadId);

test('acceptance followed by failed local receipt storage recovers when the lease expires', async () => {
  const f = fixture();
  try {
    await f.service().save(scope, f.id, encodeManifest({ draft: f.draft, jobs: [] }), null, team);
    f.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON records WHEN NEW.key LIKE 'crmOutboxes/%/operations/%' AND json_extract(NEW.value, '$.state')='received' BEGIN SELECT RAISE(ABORT, 'Synthetic receipt write failure'); END");
    await expect(f.worker().run(f.leadId)).rejects.toThrow('receipt write failure');
    expect(await f.head()).toMatchObject({ state: 'leased', settled: 0 }); expect(f.posts()).toBe(1);
    f.db.exec('DROP TRIGGER fail_receipt'); f.advance();
    expect(await f.worker().run(f.leadId)).toBe('acknowledged'); expect(f.posts()).toBe(1);
  } finally { f.close(); }
});

test('expired workers cannot submit after another lease takes over or overwrite its receipt', async () => {
  const f = fixture();
  try {
    await f.service().save(scope, f.id, encodeManifest({ draft: f.draft, jobs: [] }), null, team);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
    const slow = f.worker({ readSource: async path => { started(); await gate; return f.files.get(path); } }).run(f.leadId);
    await ready; f.advance();
    expect(await f.worker().run(f.leadId)).toBe('acknowledged');
    release(); expect(await slow).toBe('stale');
    expect(f.posts()).toBe(1); expect(await f.head()).toMatchObject({ state: 'idle', settled: 1 });
  } finally { f.close(); }
});

test('rejections block visibly, preserve the operation and require a current explicit retry', async () => {
  const f = fixture();
  try {
    await f.service().save(scope, f.id, encodeManifest({ draft: f.draft, jobs: [] }), null, team);
    f.reject(403); expect(await f.worker().run(f.leadId)).toBe('blocked');
    const head = await f.head(), row = (await f.operation(1))!;
    expect(head).toMatchObject({ settled: 0, state: 'blocked', failure: { code: 'rejected', status: 403 } });
    expect(JSON.stringify(f.entries())).not.toContain('never persist this response body');
    await f.service().assign(scope, f.id, team, team.members[1], 1);
    expect(await f.worker().run(f.leadId)).toBe('skipped');
    expect(await f.worker().retryBlocked(f.leadId, row.operationId, row.totalAttempts + 1)).toBe(false);
    expect(await f.worker().retryBlocked(f.leadId, row.operationId, row.totalAttempts)).toBe(true);
    f.reject(200); expect(await f.worker().run(f.leadId)).toBe('acknowledged');
    expect((await f.operation(1))?.totalAttempts).toBe(2);
    expect(await f.worker().run(f.leadId)).toBe('acknowledged');
  } finally { f.close(); }
});

test('a late successful POST cannot overwrite a receipt or a later owner delivery after lease replacement', async () => {
  const f = fixture();
  try {
    await f.service().save(scope, f.id, encodeManifest({ draft: f.draft, jobs: [] }), null, team);
    let release!: () => void, accepted!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { accepted = resolve; });
    const transport = { ...f.transport, send: async (delivery: CrmDelivery) => { const receipt = await f.transport.send(delivery); accepted(); await gate; return receipt; } };
    const first = f.worker({ transport }).run(f.leadId); await ready;
    f.advance(); expect(await f.worker().run(f.leadId)).toBe('acknowledged');
    await f.service().assign(scope, f.id, team, team.members[1], 1);
    expect(await f.worker().run(f.leadId)).toBe('acknowledged');
    release(); expect(await first).toBe('stale');
    expect(await f.head()).toMatchObject({ settled: 2, state: 'idle', receipt: { sequence: 2 } });
    expect(f.posts()).toBe(2);
  } finally { f.close(); }
});

test('retry budget allows final receipt recovery but bounds repeated unavailable destinations', async () => {
  const f = fixture();
  try {
    await f.service().save(scope, f.id, encodeManifest({ draft: f.draft, jobs: [] }), null, team);
    f.loseResponse(); const worker = f.worker({ maxAttempts: 1 });
    expect(await worker.run(f.leadId)).toBe('retry'); f.advance();
    expect(await worker.run(f.leadId)).toBe('acknowledged'); expect(f.posts()).toBe(1);
    await f.service().assign(scope, f.id, team, team.members[1], 1);
    f.reject(503); expect(await worker.run(f.leadId)).toBe('retry');
    expect(await worker.run(f.leadId)).toBe('skipped'); f.advance();
    expect(await worker.run(f.leadId)).toBe('blocked'); expect((await f.head())?.settled).toBe(1);
  } finally { f.close(); }
});

test('missing or damaged source evidence is never submitted and queue records stay small', async () => {
  const f = fixture();
  try {
    const draft = { ...f.draft, entries: Array.from({ length: 150 }, (_, i) => ({ id: `source-${i}`, text: 'Synthetic evidence '.repeat(500), createdAt: when })) };
    await f.service().save(scope, f.id, encodeManifest({ draft, jobs: [] }), null, team);
    const row = (await f.operation(1))!;
    expect(JSON.stringify(row).length).toBeLessThan(2000);
    const source = f.files.get(row.envelope)!; expect(source.length).toBeGreaterThan(1024 * 1024); f.files.delete(row.envelope);
    expect(await f.worker().run(f.leadId)).toBe('retry'); f.advance();
    f.files.set(row.envelope, source + ' ');
    expect(await f.worker().run(f.leadId)).toBe('blocked');
    expect((await f.head())?.failure?.code).toBe('source_invalid'); expect(f.posts()).toBe(0);
  } finally { f.close(); }
});

test('bounded discovery deduplicates leads and a changed destination never consumes another queue', async () => {
  const f = fixture();
  try {
    await f.service().save(scope, f.id, encodeManifest({ draft: f.draft, jobs: [] }), null, team);
    const other = crmDelivery({ endpoint: 'https://other.example.test/', audience: 'https://other.example.test', token: async () => { throw new Error('Should not authenticate'); } });
    expect(await f.worker({ transport: other }).run(f.leadId)).toBe('skipped');
    expect(await f.worker({ due: async () => [f.leadId, f.leadId] }).drain()).toHaveLength(1);
    expect(f.posts()).toBe(1);
  } finally { f.close(); }
});

test('worker entry point is disabled without explicit activation and a complete target', async () => {
  await expect(runConfiguredCrmWorker({})).rejects.toThrow('disabled');
  await expect(runConfiguredCrmWorker({ PETE_CRM_DELIVERY_ENABLED: 'true' })).rejects.toThrow('PETE_GCP_PROJECT');
  await expect(runConfiguredCrmWorker({ PETE_CRM_DELIVERY_ENABLED: 'true', PETE_GCP_PROJECT: 'synthetic', PETE_FIRESTORE_DATABASE: 'synthetic',
    PETE_BACKUP_BUCKET: 'synthetic', PETE_CRM_ENDPOINT: 'http://unprotected.example.test/', PETE_CRM_AUDIENCE: 'https://crm.example.test' })).rejects.toThrow('HTTPS');
});
