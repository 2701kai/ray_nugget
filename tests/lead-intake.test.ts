import { expect, test } from 'bun:test';
import { cloudBackups, type CloudCopy } from '../server/cloud-backups';
import { hostedHandler } from '../server/hosted-api';
import type { hostedJobs } from '../server/hosted-jobs';
import type { AtomicStore, RecordValue } from '../server/hosted-store';
import { encodeManifest } from '../src/backup/archive';
import { createDraft, reduceDraft } from '../src/domain/draft';
import { newJob } from '../src/processing/jobs';

const sha = (value: string | Uint8Array) => new Bun.CryptoHasher('sha256').update(value).digest('hex');
const when = '2026-10-28T16:00:00.000Z';
const team = { id: 'test-fair', event: 'Synthetic fair', actor: 'alpha@bevmaq.com', members: ['alpha@bevmaq.com', 'beta@bevmaq.com'] };
const scope = sha(`pete-team/${team.id}`);
const origin = 'https://pete.example.test';
function fixture() {
  const records = new Map<string, RecordValue>(), files = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  let failObjectWrite = false, time = Date.parse(when);
  const store: AtomicStore = {
    async read<T>(key: string) { return structuredClone(records.get(key)) as T | undefined; },
    async atomic(keys, run) {
      const { result, writes } = run(Object.fromEntries(keys.map(k => [k, structuredClone(records.get(k))])));
      for (const [k, v] of Object.entries(writes ?? {})) records.set(k, structuredClone(v));
      return result;
    },
  };
  const service = cloudBackups(store, {
    async begin() { return 'https://storage.googleapis.com/synthetic-intake'; },
    async inspect(path) { const file = files.get(path); return file && { bytes: file.bytes.length, mimeType: file.mimeType, sha256: sha(file.bytes) }; },
    async put(path, bytes) { if (failObjectWrite && path.includes('/leads/')) throw new Error('Synthetic object storage interruption'); if (!files.has(path)) files.set(path, { bytes: new Uint8Array(bytes), mimeType: 'application/json' }); },
    async read(path) { const file = files.get(path); return file && new Response(new Uint8Array(file.bytes)); },
  }, async owner => [...records].filter(([k]) => k.startsWith(`cloudOwners/${owner}/drafts/`)).map(([, v]) => v as CloudCopy), () => time++);
  const handler = hostedHandler({} as ReturnType<typeof hostedJobs>, async token => ({ uid: token, email: `${token}@bevmaq.com`, email_verified: token !== 'unverified' }), [origin], 'synthetic', undefined, service, [{ id: team.id, name: team.event, members: team.members }]);
  const call = (actor: string | undefined, path: string, body?: unknown, requestOrigin = origin) => handler(new Request(`${origin}/api${path}`, {
    method: body ? 'POST' : 'GET', headers: { Origin: requestOrigin, 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${actor}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  return { records, files, service, call, failObjectWrite: () => { failObjectWrite = true; }, receipts: () => [...records.keys()].filter(k => k.includes('/receipts/')) };
}
const blank = (id = 'synthetic-intake-visitor') => ({ draft: createDraft(id, 'contact', team.event, when), jobs: [] as ReturnType<typeof newJob>[] });
const named = (id?: string) => { const s = blank(id); s.draft = reduceDraft(s.draft, { type: 'edit', patch: { contact: { name: 'Synthetic visitor', company: 'Fixture Bottling' } } }, when); return s; };

test('automatic intake accepts an incomplete lead once, retains first owner and rejects stale updates', async () => {
  const f = fixture(), snapshot = named(), id = sha(snapshot.draft.id), bytes = encodeManifest(snapshot);
  const first = await f.service.save(scope, id, bytes, null, team);
  expect(first.lead).toMatchObject({ ownerEmail: team.actor, ownerVersion: 1, state: 'received', crmState: 'not_connected', sourceFingerprint: sha(bytes) });
  // A second device retries after the first response was lost.
  const replay = await f.service.save(scope, id, bytes, null, { ...team, actor: team.members[1] });
  expect(replay).toEqual(first); expect(f.receipts()).toHaveLength(1);
  snapshot.draft = reduceDraft(snapshot.draft, { type: 'edit', patch: { request: { product: 'juice', throughput: '120', unit: 'L/h' } } }, when);
  const updated = await f.service.save(scope, id, encodeManifest(snapshot), first.fingerprint, { ...team, actor: team.members[1] });
  expect(updated.lead?.leadId).toBe(first.lead?.leadId); expect(updated.lead?.receiptId).not.toBe(first.lead?.receiptId);
  expect(updated.lead?.ownerEmail).toBe(team.actor); expect(updated.lead?.receivedBy).toBe(team.members[1]);
  const receipt = f.records.get(f.receipts().at(-1)!)!;
  const envelope = JSON.parse(new TextDecoder().decode(f.files.get(receipt.envelope as string)!.bytes));
  expect(envelope.request).toMatchObject({ throughput: '120', unit: 'L/h', packaging: '' });
  expect(envelope.readiness.fillingRequirementsMissing.length).toBeGreaterThan(0);
  expect(envelope.permissions).toEqual({ inquiry: 'not_collected', followup: 'not_collected', newsletter: 'not_collected' });
  expect(receipt.envelopeSha256).toBe(sha(f.files.get(receipt.envelope as string)!.bytes));
  await expect(f.service.save(scope, id, bytes, updated.fingerprint, team)).rejects.toMatchObject({ status: 409 });
  expect((await f.service.get(scope, id))?.lead).toEqual(updated.lead); expect(f.receipts()).toHaveLength(2);
  // Similar contact data is not permission to merge a second person.
  const other = named('another-visitor');
  expect((await f.service.save(scope, sha(other.draft.id), encodeManifest(other), null, team)).lead?.leadId).not.toBe(first.lead?.leadId);
});

test('personal backups and empty placeholders do not create leads; legacy shared copies backfill once', async () => {
  const f = fixture(), empty = blank(), id = sha(empty.draft.id);
  const start = await f.service.save(scope, id, encodeManifest(empty), null, team);
  expect(start.intakeVersion).toBe(1); expect(start.lead).toBeUndefined(); expect(f.receipts()).toHaveLength(0);
  const snapshot = named();
  await f.service.save('personal-owner', id, encodeManifest(snapshot), null);
  expect(f.receipts()).toHaveLength(0);
  const legacy: CloudCopy = { ...start, fingerprint: sha(encodeManifest(snapshot)), revision: snapshot.draft.revision, createdBy: team.actor };
  delete legacy.intakeVersion;
  f.records.set(`cloudOwners/${scope}/drafts/${id}`, legacy);
  const saved = await f.service.save(scope, id, encodeManifest(snapshot), legacy.fingerprint, { ...team, actor: team.members[1] });
  expect(saved.lead?.ownerEmail).toBe(team.actor); expect(f.receipts()).toHaveLength(1);
  expect(await f.service.save(scope, id, encodeManifest(snapshot), null, team)).toEqual(saved);
  // Clearing the last details after intake must update the lead, not leave the
  // previous contact as the latest payload.
  snapshot.draft = reduceDraft(snapshot.draft, { type: 'edit', patch: { contact: { name: '', company: '' } } }, when);
  const cleared = await f.service.save(scope, id, encodeManifest(snapshot), saved.fingerprint, team);
  expect(cleared.lead?.sourceRevision).toBe(snapshot.draft.revision); expect(f.receipts()).toHaveLength(2);
});

test('failed envelope storage or unverified originals never acknowledge intake; memo and recording consent stay distinct', async () => {
  const f = fixture(), snapshot = named(), id = sha(snapshot.draft.id);
  f.failObjectWrite();
  await expect(f.service.save(scope, id, encodeManifest(snapshot), null, team)).rejects.toThrow('interruption');
  expect(await f.service.get(scope, id)).toBeUndefined(); expect(f.receipts()).toHaveLength(0);
  const g = fixture(), bytes = new Uint8Array([1, 4, 7]), media = { id: 'synthetic-conversation', kind: 'voice' as const, name: 'Synthetic consented conversation', bytes: bytes.length, sha256: sha(bytes), mimeType: 'audio/webm', capturedAt: when, voiceMode: 'conversation' as const, consentConfirmed: true };
  snapshot.draft = reduceDraft(snapshot.draft, { type: 'attach', attachment: media }, when);
  snapshot.jobs = [newJob(snapshot.draft.id, media, Date.parse(when))];
  await expect(g.service.save(scope, id, encodeManifest(snapshot), null, team)).rejects.toMatchObject({ status: 409 });
  expect(g.receipts()).toHaveLength(0);
  await g.service.init(scope, media.sha256, bytes.length, media.mimeType, origin);
  g.files.set(`owners/${scope}/media/${media.sha256}`, { bytes, mimeType: media.mimeType });
  await g.service.complete(scope, media.sha256);
  await g.service.save(scope, id, encodeManifest(snapshot), null, team);
  const row = g.records.get(g.receipts()[0])!;
  const body = JSON.parse(new TextDecoder().decode(g.files.get(row.envelope as string)!.bytes));
  expect(body.sources[0]).toMatchObject({ consentConfirmed: true, voiceMode: 'conversation', processing: { state: 'pending' } });
  expect(body.permissions.inquiry).toBe('not_collected'); expect(body.readiness.pendingSources).toEqual([media.id]);
  const forged = JSON.parse(new TextDecoder().decode(encodeManifest(snapshot)));
  forged.draft.provenance['contact.name'] = { source: 'extraction', at: when, attachmentId: 'another-visitors-card', jobId: 'another-visitor/another-visitors-card' };
  await expect(g.service.save(scope, id, new TextEncoder().encode(JSON.stringify(forged)), null, team)).rejects.toMatchObject({ status: 400 });
});

test('owner assignment is team-authenticated, versioned and retryable without changing receipt history or customer fields', async () => {
  const f = fixture(), snapshot = named(), id = sha(snapshot.draft.id), path = `/teams/${team.id}/drafts/${id}`;
  const initial = await f.call('alpha', path, { manifest: new TextDecoder().decode(encodeManifest(snapshot)), expected: null });
  expect(initial.status).toBe(200); const first = await initial.json();
  const originalReceipt = structuredClone(f.records.get(f.receipts()[0]));
  const assign = { ownerEmail: team.members[1], expectedVersion: 1 };
  for (const [actor, status] of [[undefined, 401], ['outsider', 403], ['unverified', 403]] as const) expect((await f.call(actor, `${path}/owner`, assign)).status).toBe(status);
  expect((await f.call('alpha', `${path}/owner`, assign, 'https://foreign.example.test')).status).toBe(403);
  expect((await f.call('alpha', `${path}/owner`, { ...assign, ownerEmail: 'outsider@bevmaq.com' })).status).toBe(400);
  expect((await f.call('alpha', `/cloud/drafts/${id}/owner`, assign)).status).toBe(403);
  const changed = await f.call('alpha', `${path}/owner`, assign); expect(changed.status).toBe(200);
  const latest = await changed.json();
  expect(latest.lead).toMatchObject({ ownerEmail: team.members[1], ownerVersion: 2, receiptId: first.lead.receiptId });
  expect(latest.fingerprint).toBe(first.fingerprint);
  expect(await (await f.call('alpha', `${path}/owner`, assign)).json()).toEqual(latest);
  expect((await f.call('beta', `${path}/owner`, { ownerEmail: team.actor, expectedVersion: 1 })).status).toBe(409);
  expect(f.records.get(f.receipts()[0])).toEqual(originalReceipt);
  expect([...f.records.keys()].filter(k => k.includes('/assignments/'))).toHaveLength(1);
  snapshot.draft = reduceDraft(snapshot.draft, { type: 'addNote', id: 'follow-up', text: 'Synthetic later note' }, when);
  const updated = await f.call('alpha', path, { manifest: new TextDecoder().decode(encodeManifest(snapshot)), expected: first.fingerprint });
  expect((await updated.json()).lead).toMatchObject({ ownerEmail: team.members[1], ownerVersion: 2 });
});

test('card and voice evidence retain manual corrections, unresolved changes and seller intent without claiming filling readiness', async () => {
  const f = fixture(), snapshot = named(), id = sha(snapshot.draft.id);
  for (const [index, kind] of (['card', 'voice'] as const).entries()) {
    const bytes = new Uint8Array([index + 1, 17, 31]);
    const attachment = { id: `synthetic-${kind}`, kind, name: `Synthetic ${kind}`, bytes: bytes.length, sha256: sha(bytes), mimeType: kind === 'card' ? 'image/png' : 'audio/wav', capturedAt: '2026-10-28T16:01:00.000Z', ...(kind === 'voice' ? { voiceMode: 'memo' as const } : {}) };
    snapshot.draft = reduceDraft(snapshot.draft, { type: 'attach', attachment }, attachment.capturedAt);
    const job = newJob(snapshot.draft.id, attachment, Date.parse(attachment.capturedAt));
    snapshot.jobs.push({ ...job, state: 'complete', result: { text: kind === 'card' ? 'Synthetic card source' : 'We want to sell an existing filling machine.', engine: 'Synthetic fixture', fields: kind === 'card' ? { name: 'Alternative card name' } : {}, ...(kind === 'voice' ? { request: { intent: 'sell' as const }, evidence: { 'request.intent': 'We want to sell' } } : {}) } });
    await f.service.init(scope, attachment.sha256, bytes.length, attachment.mimeType, origin);
    f.files.set(`owners/${scope}/media/${attachment.sha256}`, { bytes, mimeType: attachment.mimeType });
    await f.service.complete(scope, attachment.sha256);
  }
  snapshot.draft = reduceDraft(snapshot.draft, { type: 'edit', patch: { request: { intent: 'sell' } } }, '2026-10-28T16:02:00.000Z');
  await f.service.save(scope, id, encodeManifest(snapshot), null, team);
  const receipt = f.records.get(f.receipts()[0])!;
  const payload = JSON.parse(new TextDecoder().decode(f.files.get(receipt.envelope as string)!.bytes));
  expect(payload.contact.name).toBe('Synthetic visitor');
  expect(payload.provenance['contact.name'].source).toBe('manual');
  expect(payload.sources.map((s: any) => s.processing.result.text)).toEqual(['Synthetic card source', 'We want to sell an existing filling machine.']);
  expect(payload.readiness.changesToReview).toEqual([{ attachmentId: 'synthetic-card', field: 'contact.name' }]);
  expect(payload.request.intent).toBe('sell');
  expect(payload.readiness.fillingRequirementsMissing).toBeNull();
  expect(payload.readiness.pendingSources).toEqual([]);
});
