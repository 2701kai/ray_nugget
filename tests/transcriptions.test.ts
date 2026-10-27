import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { transcriptions } from '../server/transcriptions';
import { CloudError, transcriptOf, type SpeechCloud, type SpeechOperation } from '../server/google-speech';

function cloudFixture() {
  const calls = { upload: 0, submit: 0, remove: 0 };
  let operation: SpeechOperation = { name: 'synthetic-operation', done: false };
  const cloud: SpeechCloud = {
    async upload() { calls.upload++; }, async submit() { calls.submit++; return 'synthetic-operation'; },
    async operation() { return operation; }, async remove() { calls.remove++; },
  };
  return { calls, cloud, complete() { operation = { name: 'synthetic-operation', done: true, response: { results: { 'gs://synthetic/input': { inlineResult: { transcript: { results: [{ alternatives: [{ transcript: 'Synthetic conversation.' }] }] } } } } } }; } };
}
async function settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

test('repeated uploads and gateway restart resume one Google operation and clean up its input', async () => {
  const db = new Database(':memory:'); const fixture = cloudFixture();
  let store = transcriptions(db, fixture.cloud);
  store.submit('sample', new Uint8Array([1]), 'audio/wav');
  store.submit('sample', new Uint8Array([1]), 'audio/wav');
  await settle();
  expect(fixture.calls).toMatchObject({ upload: 1, submit: 1 });
  expect(store.get('sample')?.state).toBe('submitted');
  store = transcriptions(db, fixture.cloud);
  store.submit('sample', new Uint8Array([1]), 'audio/wav');
  fixture.complete(); await store.poll('sample');
  expect(store.get('sample')).toMatchObject({ state: 'complete', text: 'Synthetic conversation.', cleanupPending: false });
  expect(fixture.calls).toEqual({ upload: 1, submit: 1, remove: 1 });
  db.close();
});

test('uncertain submission cannot be duplicated by client retries', async () => {
  const db = new Database(':memory:'); const fixture = cloudFixture();
  fixture.cloud.submit = async () => { fixture.calls.submit++; throw new CloudError('Synthetic connection lost after submission', false); };
  const store = transcriptions(db, fixture.cloud);
  store.submit('sample', new Uint8Array([1]), 'audio/wav'); await settle();
  expect(store.get('sample')?.state).toBe('uncertain');
  store.submit('sample', new Uint8Array([1]), 'audio/wav', true); await settle();
  expect(fixture.calls.submit).toBe(1);
  expect(fixture.calls.remove).toBe(0);
  db.close();
});

test('definitive failures require explicit retry and cleanup can recover later', async () => {
  const db = new Database(':memory:'); const fixture = cloudFixture();
  const submit = fixture.cloud.submit;
  fixture.cloud.submit = async () => { throw new CloudError('Synthetic permission error', true); };
  const store = transcriptions(db, fixture.cloud);
  store.submit('sample', new Uint8Array([1]), 'audio/wav'); await settle();
  expect(store.get('sample')?.state).toBe('failed');
  store.submit('sample', new Uint8Array([1]), 'audio/wav'); await settle();
  expect(fixture.calls.upload).toBe(1);
  fixture.cloud.submit = submit;
  store.submit('sample', new Uint8Array([1]), 'audio/wav', true); await settle();
  fixture.complete(); fixture.cloud.remove = async () => { throw new Error('Synthetic cleanup outage'); };
  await store.poll('sample');
  expect(store.get('sample')?.cleanupPending).toBe(true);
  fixture.cloud.remove = async () => { fixture.calls.remove++; };
  await store.maintain();
  expect(store.get('sample')?.cleanupPending).toBe(false);
  db.close();
});

test('Google per-file failure is not reported as an empty successful transcript', () => {
  expect(() => transcriptOf({ name: 'test', done: true, response: { results: { test: { error: { message: 'Unsupported audio' } } } } })).toThrow('Unsupported audio');
  expect(() => transcriptOf({ name: 'test', done: true })).toThrow('unexpected number');
});
