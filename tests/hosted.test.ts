import { expect, test } from 'bun:test';
import { hostedJobs, type HostedJob, type UploadStorage } from '../server/hosted-jobs';
import { hostedHandler, ownerOf } from '../server/hosted-api';
import type { AtomicStore, RecordValue } from '../server/hosted-store';
import { CloudError, type SpeechCloud } from '../server/google-speech';

class MemoryStore implements AtomicStore {
  records = new Map<string, RecordValue>();
  async read<T>(key: string) { return structuredClone(this.records.get(key)) as T | undefined; }
  async atomic<T>(keys: string[], run: (records: Record<string, RecordValue | undefined>) => { result: T; writes?: Record<string, RecordValue> }) {
    const { result, writes } = run(Object.fromEntries(keys.map(key => [key, structuredClone(this.records.get(key))])));
    for (const [key, value] of Object.entries(writes ?? {})) this.records.set(key, JSON.parse(JSON.stringify(value)));
    return result;
  }
}
const id = 'a'.repeat(64);
const origin = 'https://pete.example.test';
function setup() {
  const store = new MemoryStore();
  let now = Date.now(); let uploaded = false; let complete = false;
  const calls = { begin: 0, submit: 0, remove: 0 };
  const uploads: UploadStorage = {
    async begin() { calls.begin++; return 'https://storage.googleapis.com/synthetic-session'; },
    async inspect() { return uploaded ? { bytes: 100, mimeType: 'audio/webm', sha256: id } : undefined; },
  };
  const cloud: SpeechCloud = {
    async upload() { throw new Error('Hosted uploads must bypass the API.'); },
    async submit() { calls.submit++; return 'synthetic-operation'; },
    async operation() { return { name: 'synthetic-operation', done: complete, response: { results: { source: { inlineResult: { transcript: { results: [{ alternatives: [{ transcript: 'Synthetic request.' }] }] } } } } } }; },
    async remove() { calls.remove++; },
  };
  const create = () => hostedJobs(store, cloud, uploads, () => now);
  return { store, calls, uploads, cloud, create, service: create(), upload() { uploaded = true; }, complete() { complete = true; now += 4000; }, advance(ms: number) { now += ms; } };
}

test('hosted jobs isolate users and concurrent upload/submit requests start only one operation', async () => {
  const f = setup();
  await Promise.all([f.service.init('alice', id, 100, 'audio/webm', origin), f.service.init('alice', id, 100, 'audio/webm', origin)]);
  expect(f.calls.begin).toBe(1);
  expect(await f.service.get('bob', id)).toBeUndefined();
  await f.service.init('bob', id, 100, 'audio/webm', origin);
  expect(f.calls.begin).toBe(2);
  expect((await f.service.get('alice', id))!.objectName).not.toBe((await f.service.get('bob', id))!.objectName);
  await f.service.submit('alice', id); expect(f.calls.submit).toBe(0);
  f.upload();
  await Promise.all([f.service.submit('alice', id), f.service.submit('alice', id)]);
  expect(f.calls.submit).toBe(1);
  expect((await f.service.get('bob', id))!.state).toBe('uploading');
  f.complete();
  expect(await f.create().get('alice', id)).toMatchObject({ state: 'complete', text: 'Synthetic request.', cleanupPending: false });
  expect(f.calls).toEqual({ begin: 2, submit: 1, remove: 1 });
});

test('uncertain Google submission remains fenced after service restart and explicit retry', async () => {
  const f = setup();
  f.cloud.submit = async () => { f.calls.submit++; throw new CloudError('Connection lost after submission', false); };
  await f.service.init('alice', id, 100, 'audio/webm', origin); f.upload();
  expect((await f.service.submit('alice', id)).state).toBe('uncertain');
  const restarted = f.create();
  await restarted.init('alice', id, 100, 'audio/webm', origin, true);
  await restarted.submit('alice', id);
  expect(f.calls.submit).toBe(1);
  expect(f.calls.remove).toBe(0);
});

test('mismatched uploaded bytes never reach Speech and failed originals are cleaned up', async () => {
  const f = setup();
  f.uploads.inspect = async () => ({ bytes: 99, mimeType: 'audio/webm', sha256: id });
  await f.service.init('alice', id, 100, 'audio/webm', origin);
  expect((await f.service.submit('alice', id)).state).toBe('failed');
  expect(f.calls.submit).toBe(0); expect(f.calls.remove).toBe(1);
  expect((await f.service.init('alice', id, 100, 'audio/webm', origin, true)).state).toBe('uploading');
});

test('expired verification can recover but expired submitting cannot cause duplicate billing', async () => {
  const f = setup();
  await f.service.init('alice', id, 100, 'audio/webm', origin);
  const key = `jobs/alice_${id}`;
  const job = f.store.records.get(key) as HostedJob;
  f.store.records.set(key, { ...job, state: 'verifying', leaseUntil: 0 });
  expect((await f.service.get('alice', id))!.state).toBe('uploading');
  f.store.records.set(key, { ...job, state: 'submitting', leaseUntil: 0 });
  expect((await f.service.get('alice', id))!.state).toBe('uncertain');
  await f.service.submit('alice', id);
  expect(f.calls.submit).toBe(0);
});

test('authentication requires a verified exact company domain and users cannot query another owner', async () => {
  const f = setup();
  const identities = { alice: { uid: 'a', email: 'a@bevmaq.com', email_verified: true }, bob: { uid: 'b', email: 'b@bevmaq.com', email_verified: true }, outsider: { uid: 'c', email: 'c@bevmaq.com.evil.test', email_verified: true }, unverified: { uid: 'd', email: 'd@bevmaq.com', email_verified: false } };
  const handler = hostedHandler(f.service, async token => { const value = identities[token as keyof typeof identities]; if (!value) throw new Error('Invalid token'); return value; }, [origin], 'Test');
  const request = (token?: string) => new Request(`${origin}/api/transcriptions/${id}`, { headers: token ? { Authorization: `Bearer ${token}`, Origin: origin } : {} });
  expect((await handler(request())).status).toBe(401);
  expect((await handler(request('invalid'))).status).toBe(401);
  expect((await handler(request('outsider'))).status).toBe(403);
  expect((await handler(request('unverified'))).status).toBe(403);
  await f.service.init(ownerOf(identities.alice), id, 100, 'audio/webm', origin);
  expect((await handler(request('alice'))).status).toBe(200);
  expect((await handler(request('bob'))).status).toBe(404);
  expect((await handler(request('alice'))).headers.get('Cache-Control')).toBe('no-store');
  for (const body of ['null', '[]', '{broken']) {
    const response = await handler(new Request(`${origin}/api/transcriptions/${id}/upload`, { method: 'POST', headers: { Authorization: 'Bearer alice', Origin: origin }, body }));
    expect(response.status).toBe(400);
  }
});

test('pilot allowance is transactional and replaying the same job does not spend it twice', async () => {
  const f = setup();
  for (let i = 0; i < 40; i++) await f.service.init('alice', String(i).padStart(64, '0'), 100, 'audio/webm', origin);
  expect((await f.service.init('alice', '0'.repeat(64), 100, 'audio/webm', origin)).state).toBe('uploading');
  await expect(f.service.init('alice', id, 100, 'audio/webm', origin)).rejects.toMatchObject({ status: 429 });
  expect(f.calls.begin).toBe(40);
});
