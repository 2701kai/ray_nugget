import { expect, test } from 'bun:test';
import { parseCapturedDetails } from '../src/domain/details';
import { detailService, detailsId, type DetailsModel } from '../server/details';
import { hostedHandler } from '../server/hosted-api';
import { hostedJobs } from '../server/hosted-jobs';
import type { AtomicStore, RecordValue } from '../server/hosted-store';

class MemoryStore implements AtomicStore {
  records = new Map<string, RecordValue>();
  async read<T>(key: string) { return structuredClone(this.records.get(key)) as T | undefined; }
  async atomic<T>(keys: string[], run: (records: Record<string, RecordValue | undefined>) => { result: T; writes?: Record<string, RecordValue> }) {
    const { result, writes } = run(Object.fromEntries(keys.map(key => [key, structuredClone(this.records.get(key))])));
    for (const [key, value] of Object.entries(writes ?? {})) this.records.set(key, JSON.parse(JSON.stringify(value)));
    return result;
  }
}
const candidate = (field: string, value: string, evidence: string, uncertain = false) => ({ field, value, evidence, uncertain });
const text = 'Mara Lind\nTest GmbH\nmara@example.test';
const raw = { candidates: [candidate('contact.name', 'Mara Lind', 'Mara Lind'), candidate('contact.email', 'mara@example.test', 'mara@example.test')], questions: [] };

test('structured details require real quotes and preserve ambiguity without guessing', () => {
  expect(parseCapturedDetails(raw, text, 'card').fields).toEqual({ name: 'Mara Lind', email: 'mara@example.test' });
  expect(() => parseCapturedDetails(raw, 'unrelated source', 'card')).toThrow('matching source');
  expect(parseCapturedDetails({ candidates: [candidate('contact.name', 'Mara Lind', text, true)], questions: [] }, text, 'card').fields).toEqual({});
  expect(parseCapturedDetails({ candidates: [candidate('contact.name', 'Mara Lind', text), candidate('contact.name', 'Test GmbH', text)], questions: [] }, text, 'card').fields).toEqual({});
  expect(parseCapturedDetails({ candidates: [candidate('contact.phone', '+49305559999', '+49 30 55501234')], questions: [] }, '+49 30 55501234', 'card').fields).toEqual({});
  expect(parseCapturedDetails({ candidates: [candidate('contact.email', 'madeup@example.test', text), candidate('contact.phone', '+49305550123', 'Mara Lind')], questions: [] }, text, 'card').fields).toEqual({});
});
test('capacity must be a clear paired positive hourly value, and cards cannot create requests', () => {
  const source = 'We need juice at 2400 bottles per hour. About 5000 bottles per hour might also work.';
  const values = [candidate('request.product', 'juice', source), candidate('request.throughput', '2400', 'We need juice at 2400 bottles per hour.'), candidate('request.unit', 'bottles/h', 'We need juice at 2400 bottles per hour.')];
  expect(parseCapturedDetails({ candidates: values, questions: [] }, source, 'voice').request).toEqual({ product: 'juice', capacity: { throughput: '2400', unit: 'bottles/h' } });
  expect(parseCapturedDetails({ candidates: values, questions: [] }, source, 'card').request).toBeUndefined();
  expect(parseCapturedDetails({ candidates: values.slice(0, 2), questions: [] }, source, 'voice').request?.capacity).toBeUndefined();
  expect(parseCapturedDetails({ candidates: [values[2], candidate('request.throughput', '5000', 'About 5000 bottles per hour might also work.')], questions: [] }, source, 'voice').request?.capacity).toBeUndefined();
});
test('same source replays once per owner, concurrent requests share a lease and cached results', async () => {
  const store = new MemoryStore(); let calls = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const model: DetailsModel = { engine: 'synthetic', async extract() { calls++; await gate; return raw; } };
  const service = detailService(store, model); const id = detailsId('card', text);
  const first = service.extract('alice', id, 'card', text);
  await Promise.resolve();
  expect((await service.extract('alice', id, 'card', text)).state).toBe('processing');
  release();
  expect((await first).result?.fields.name).toBe('Mara Lind');
  expect((await detailService(store, model).extract('alice', id, 'card', text)).state).toBe('complete');
  expect(calls).toBe(1);
  await service.extract('bob', id, 'card', text); expect(calls).toBe(2);
  await expect(service.extract('alice', id, 'voice', text)).rejects.toThrow('Invalid source');
  expect([...store.records.values()].some(record => 'text' in record)).toBe(false);
});
test('model failures have bounded retries and daily allowance is enforced before another model call', async () => {
  const store = new MemoryStore(); let calls = 0;
  const service = detailService(store, { engine: 'synthetic', async extract() { calls++; throw new Error('synthetic outage'); } }, () => 0);
  const id = detailsId('card', text);
  for (let i = 0; i < 3; i++) await expect(service.extract('alice', id, 'card', text)).rejects.toThrow();
  expect(calls).toBe(2);
  store.records.set('extractionQuotas/bob_1970-01-01', { count: 100 });
  await expect(service.extract('bob', id, 'card', text)).rejects.toThrow('allowance');
  expect(calls).toBe(2);
});
test('expired model leases cannot overwrite a newer completed result', async () => {
  const store = new MemoryStore(); let now = 0, calls = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const service = detailService(store, { engine: 'synthetic', async extract() { if (++calls === 1) { await gate; return { candidates: [], questions: [] }; } return raw; } }, () => now);
  const id = detailsId('card', text); const first = service.extract('alice', id, 'card', text);
  await Promise.resolve(); now = 91_000;
  await service.extract('alice', id, 'card', text); release();
  expect((await first).result?.fields.name).toBe('Mara Lind');
});
test('detail API requires company identity and allowed origin, validates source and returns cached details', async () => {
  const store = new MemoryStore(); let calls = 0;
  const details = detailService(store, { engine: 'synthetic', async extract() { calls++; return raw; } });
  const jobs = {} as ReturnType<typeof hostedJobs>;
  const handler = hostedHandler(jobs, async token => ({ uid: token, email: token === 'outsider' ? 'outside@example.test' : 'synthetic@bevmaq.com', email_verified: true }), ['https://pete.example.test'], 'synthetic', details);
  const call = (token = 'alice', origin = 'https://pete.example.test', body: unknown = { text, kind: 'card' }) => handler(new Request(`https://pete.example.test/api/extractions/${detailsId('card', text)}`, { method: 'POST', headers: { Authorization: token ? `Bearer ${token}` : '', Origin: origin }, body: JSON.stringify(body) }));
  expect((await call('')).status).toBe(401); expect((await call('outsider')).status).toBe(403); expect((await call('alice', '')).status).toBe(403);
  expect((await call('alice', 'https://pete.example.test', { text: 'changed', kind: 'card' })).status).toBe(400);
  expect((await call()).status).toBe(200); expect((await (await call()).json()).result.fields.name).toBe('Mara Lind'); expect(calls).toBe(1);
});
