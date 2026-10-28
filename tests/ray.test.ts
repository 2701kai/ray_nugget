import { expect, test } from 'bun:test';
import { createDraft, reduceDraft } from '../src/domain/draft';
import { prepareRayInput, raySource } from '../src/ray/brief';
import { parseRayAdvice, type RayAdvice, type RayInput } from '../src/ray/types';
import { rayId, rayService, rayTransport } from '../server/ray';
import { sqliteAtomic } from './helpers/sqlite-atomic';
import { decodeManifest, encodeManifest, restoredSnapshot } from '../src/backup/archive';
import { mergeTeam, manifestText } from '../src/team/merge';
import { hostedHandler } from '../server/hosted-api';
import { cloudBackups } from '../server/cloud-backups';
import { newJob } from '../src/processing/jobs';
import type { hostedJobs } from '../server/hosted-jobs';

const date = '2026-10-28T10:00:00.000Z';
const digest = async (b: Uint8Array) => new Bun.CryptoHasher('sha256').update(b).digest('hex');
const draft = () => reduceDraft(createDraft('visitor-a', 'voice', 'Synthetic fair', date), { type: 'addNote', id: 'note-a', text: 'We want a filler for peach nectar. Krones preferred. Delivery next summer. Container undecided.' }, date);
const input = (): RayInput => ({ version: 1, draftId: 'visitor-a', sourceFingerprint: 'b'.repeat(64), window: 1, brief: 'Peach nectar filler. Output 800 L/h. Packaging undecided.', omitted: 0, pending: 0 });
const machine = { sku: 'SYNTHETIC-1', title: 'Synthetic filler', manufacturer: 'Test maker', url: 'https://www.bevmaq.com/machines/synthetic/', updated: date };
const advice = (id = 'a'.repeat(64)): RayAdvice => ({ id, draftId: 'visitor-a', sourceFingerprint: 'b'.repeat(64), createdAt: date, brief: input().brief, omitted: 0, pending: 0, text: 'What container and output do you need?', questions: [], machines: [machine], selectedSkus: [] });

test('need brief keeps brands, timing and exact units but excludes card data and known contact identifiers', async () => {
  let d = reduceDraft(draft(), { type: 'edit', patch: { contact: { name: 'Alex Demo', company: 'Synthetic Company', email: 'alex@example.test', phone: '+493012345678' }, request: { throughput: '800', unit: 'L/h' } } }, date);
  d = reduceDraft(d, { type: 'addNote', id: 'note-b', text: 'Alex Demo needs an aseptic filler. Email alex@example.test or +493012345678.' }, date);
  const body = await prepareRayInput(d, [], digest, 1);
  expect(body.brief).toContain('800 L/h'); expect(body.brief).toContain('Krones'); expect(body.brief).toContain('next summer');
  expect(body.brief).not.toContain('Alex Demo'); expect(body.brief).not.toContain('alex@example.test'); expect(body.brief).not.toContain('+493012345678');
  expect(JSON.stringify(body)).not.toContain('Synthetic Company');
  const card = { id: 'card', kind: 'card' as const, name: 'card', bytes: 3, sha256: 'd'.repeat(64), mimeType: 'image/jpeg', capturedAt: date };
  d = reduceDraft(d, { type: 'attach', attachment: card }, date);
  const job = { ...newJob(d.id, card), result: { text: 'DO NOT SEND CARD TEXT', fields: {}, engine: 'fixture' } };
  expect((await prepareRayInput(d, [job], digest)).brief).not.toContain('DO NOT SEND');
});

test('advice and selections do not stale the need; new voice, corrections and source results do', async () => {
  const d = draft(), before = raySource(d, []);
  const withAdvice = reduceDraft(d, { type: 'rayAdvice', advice: advice() }, date);
  const selected = reduceDraft(withAdvice, { type: 'raySelect', consultationId: advice().id, sku: machine.sku, selected: true }, date);
  expect(raySource(selected, [])).toBe(before);
  const corrected = reduceDraft(selected, { type: 'edit', patch: { request: { throughput: '900', unit: 'L/h' } } }, date);
  expect(raySource(corrected, [])).not.toBe(before);
  const attachment = { id: 'voice', kind: 'voice' as const, name: 'memo', bytes: 3, sha256: 'c'.repeat(64), mimeType: 'audio/webm', capturedAt: date };
  const voice = reduceDraft(selected, { type: 'attach', attachment }, date);
  const job = newJob(voice.id, attachment);
  expect(raySource(voice, [job])).not.toBe(before);
  expect(raySource(voice, [{ ...job, result: { text: 'Glass bottles.', fields: {}, engine: 'fixture' } }])).not.toBe(raySource(voice, [job]));
  const foreign = { ...job, draftId: 'visitor-b', result: { text: 'Foreign visitor needs cans.', fields: {}, engine: 'fixture' } };
  expect((await prepareRayInput(voice, [foreign], digest)).brief).not.toContain('Foreign');
});

test('long sources disclose omissions without cutting quotes; seller and empty records do not start matching', async () => {
  const d = draft(); d.entries = [{ id: 'long', createdAt: date, text: Array.from({ length: 100 }, (_, i) => `Requirement ${i} for a synthetic filling installation with specific interfaces.`).join(' ') }];
  const result = await prepareRayInput(d, [], digest);
  expect(result.brief.length).toBeLessThanOrEqual(1450); expect(result.omitted).toBeGreaterThan(0); expect(result.brief.endsWith('.')).toBe(true);
  d.request.intent = 'sell'; await expect(prepareRayInput(d, [], digest)).rejects.toThrow('seller');
  await expect(prepareRayInput(createDraft('empty', 'contact', '', date), [], digest)).rejects.toThrow('equipment need');
});

test('excerpts keep decimal bottle sizes and grouped numeric quantities intact', async () => {
  const d = draft(); d.entries = [{ id: 'decimal', createdAt: date, text: 'We need 0.5 L PET bottles. Capacity is 2.400 bottles/h. Then 0,33 L glass.' }];
  const result = await prepareRayInput(d, [], digest);
  expect(result.brief).toContain('0.5 L PET'); expect(result.brief).toContain('2.400 bottles/h'); expect(result.brief).toContain('0,33 L glass');
});

test('Ray advice round-trips with backups, restores with the new visitor ID, and merges alongside team edits', () => {
  const base = draft(); const a = reduceDraft(base, { type: 'rayAdvice', advice: advice() }, date);
  const selected = reduceDraft(a, { type: 'raySelect', consultationId: advice().id, sku: machine.sku, selected: true }, date);
  const bytes = encodeManifest({ draft: selected, jobs: [] }); const decoded = decodeManifest(bytes);
  expect(decoded.draft.ray).toEqual(selected.ray);
  const restored = restoredSnapshot({ ...decoded, media: [], fingerprint: 'c'.repeat(64) });
  expect(restored.draft.ray![0].draftId).toBe(restored.draft.id);
  expect(restored.draft.ray![0].selectedSkus).toEqual([machine.sku]);
  const remote = reduceDraft(base, { type: 'edit', patch: { contact: { name: 'Changed by teammate' } } }, date);
  const merged = mergeTeam(manifestText({ draft: base, jobs: [] }), manifestText({ draft: selected, jobs: [] }), manifestText({ draft: remote, jobs: [] }));
  expect(merged.conflicts).toEqual([]); expect(merged.snapshot.draft.ray).toEqual(selected.ray); expect(merged.snapshot.draft.contact.name).toBe('Changed by teammate');
  expect(() => reduceDraft(base, { type: 'rayAdvice', advice: { ...advice(), draftId: 'visitor-b' } }, date)).toThrow('another visitor');
  expect(() => parseRayAdvice({ ...advice(), machines: [{ ...machine, url: 'javascript:alert(1)' }] })).toThrow();
  expect(() => parseRayAdvice({ ...advice(), selectedSkus: ['NOT-EVIDENCED'] })).toThrow();
});

test('concurrent taps call Ray once; lost replies recover durably and other users remain isolated', async () => {
  const db = sqliteAtomic(); let calls = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const transport = { async consult() { calls++; await gate; return advice(); } };
  const service = rayService(db.store, transport); const body = input(), id = rayId(body);
  const first = service.consult('alice', id, body);
  await Promise.resolve();
  expect((await service.consult('alice', id, body)).state).toBe('processing'); expect(calls).toBe(1);
  release(); const complete = await first;
  expect((await rayService(db.store, transport).consult('alice', id, body))).toEqual(complete); expect(calls).toBe(1);
  await service.consult('bob', id, body); expect(calls).toBe(2);
  await expect(service.consult('alice', id, { ...body, draftId: 'visitor-b' })).rejects.toThrow('fingerprint');
  db.close();
});

test('failed calls have a cooldown and attempt cap; an expired lease cannot overwrite a newer result', async () => {
  const db = sqliteAtomic(); let now = 1000000, calls = 0;
  const service = rayService(db.store, { async consult() { calls++; throw new Error('private upstream error'); } }, () => now);
  const body = input(), id = rayId(body);
  await expect(service.consult('alice', id, body)).rejects.toThrow('could not finish');
  await expect(service.consult('alice', id, body)).rejects.toMatchObject({ status: 429 }); expect(calls).toBe(1);
  for (let i = 0; i < 2; i++) { now += 60001; await expect(service.consult('alice', id, body)).rejects.toMatchObject({ status: 503 }); }
  now += 60001; await expect(service.consult('alice', id, body)).rejects.toMatchObject({ status: 422 }); expect(calls).toBe(3);
  expect(JSON.stringify(db.entries())).not.toContain('private upstream');
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const slow = rayService(db.store, { async consult() { await gate; return { ...advice(), text: 'Old answer' }; } }, () => now);
  const first = slow.consult('new-user', id, body); await Promise.resolve(); now += 100001;
  const newer = await rayService(db.store, { async consult() { return { ...advice(), text: 'New answer' }; } }, () => now).consult('new-user', id, body);
  release(); expect((await first).result?.text).toBe(newer.result?.text); db.close();
});

test('transport uses only consultation and verified catalogue evidence, preserving L/h in text', async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const fake: typeof fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname; calls.push({ path, init });
    if (path === '/api/chat') return Response.json({ language: 'en', text: 'Possible candidate; confirm fit.', evidence: [{ sku: machine.sku }], skus: [], action: 'enquiry', review: true, brief: { openQuestions: ['Which container?'] } });
    return Response.json({ ...machine, available: true });
  }, { preconnect() {} });
  const result = await rayTransport('https://ray.bevmaq.com', fake).consult(input());
  expect(result.machines).toEqual([machine]); expect(result.questions).toEqual(['Which container?']);
  expect(calls.map(c => c.path)).toEqual(['/api/chat', `/api/products/${machine.sku}`]);
  const body = JSON.parse(String(calls[0].init?.body)); expect(body.requirements.capacity).toBeNull(); expect(body.message).toContain('800 L/h'); expect(body.message.length).toBeLessThanOrEqual(2000);
  expect(body.history).toEqual([]); expect(calls[0].init?.redirect).toBe('error');
});

test('Ray route requires verified company authentication and valid origin, even for cached responses', async () => {
  const db = sqliteAtomic(); let calls = 0;
  const service = rayService(db.store, { async consult() { calls++; return advice(); } });
  const handler = hostedHandler({} as ReturnType<typeof hostedJobs>, async uid => ({ uid, email: uid === 'other' ? 'someone@example.test' : 'synthetic@bevmaq.com', email_verified: true }), ['https://pete.example.test'], 'test', undefined, undefined, [], service);
  const body = input(); const send = (token?: string, origin = 'https://pete.example.test') => handler(new Request(`https://pete.example.test/api/ray/${rayId(body)}`, { method: 'POST', headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
  expect((await send()).status).toBe(401); expect((await send('other')).status).toBe(403); expect((await send('alice', 'https://evil.example.test')).status).toBe(403); expect(calls).toBe(0);
  expect((await send('alice')).status).toBe(200); expect((await send('alice')).status).toBe(200); expect(calls).toBe(1); db.close();
});

test('an older client cannot overwrite a cloud visitor and silently remove saved Ray advice', async () => {
  const db = sqliteAtomic(); const objects = new Map<string, Uint8Array>();
  const cloud = cloudBackups(db.store, { async begin() { throw new Error('unused'); }, async inspect() { return undefined; }, async put(k, v) { objects.set(k, v); }, async read(k) { const value = objects.get(k); return value ? new Response(new Uint8Array(value)) : undefined; } }, async () => []);
  const d = reduceDraft(draft(), { type: 'rayAdvice', advice: advice() }, date);
  const first = await cloud.save('alice', 'e'.repeat(64), encodeManifest({ draft: d, jobs: [] }), null);
  const older = { ...d, ray: undefined, revision: d.revision + 1 };
  await expect(cloud.save('alice', first.id, encodeManifest({ draft: older, jobs: [] }), first.fingerprint)).rejects.toMatchObject({ status: 409 });
  expect((await cloud.get('alice', first.id))!.fingerprint).toBe(first.fingerprint); db.close();
});

test('the authenticated route accepts bounded conversation history beyond the old brief-only body limit', async () => {
  const db = sqliteAtomic(); let calls = 0;
  const service = rayService(db.store, { async consult(body) { calls++; expect(body.history).toHaveLength(8); return advice(); } });
  const handler = hostedHandler({} as ReturnType<typeof hostedJobs>, async uid => ({ uid, email: 'synthetic@bevmaq.com', email_verified: true }), ['https://pete.example.test'], 'test', undefined, undefined, [], service);
  const body: RayInput = { ...input(), version: 2, history: Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', text: 'Synthetic context. '.repeat(100) })), sourceIds: Array.from({ length: 250 }, (_, i) => `source-${i}`) };
  const response = await handler(new Request(`https://pete.example.test/api/ray/${rayId(body)}`, { method: 'POST', headers: { Origin: 'https://pete.example.test', Authorization: 'Bearer synthetic' }, body: JSON.stringify(body) }));
  expect(response.status).toBe(200); expect(calls).toBe(1); db.close();
});
