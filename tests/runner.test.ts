import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { openRepository } from '../src/storage/repository.web';
import { startProcessing } from '../src/processing/runner';

test('a healthy lane does not clear another lane error; recovery clears the warning without reopening', async () => {
  const repo = await openRepository(crypto.randomUUID());
  const claim = repo.claimJob; let broken = true;
  repo.claimJob = async (...args) => {
    if (args[0].includes('card') && broken) throw new Error('Synthetic queue read failure');
    return claim(...args);
  };
  const errors: Array<string | undefined> = [];
  let sawFailure!: () => void; let sawRecovery!: () => void;
  const failed = new Promise<void>(resolve => { sawFailure = resolve; });
  const recovered = new Promise<void>(resolve => { sawRecovery = resolve; });
  const runner = startProcessing(repo, { kinds: ['card', 'voice'], async process() { throw new Error('No job should run'); }, async close() {} }, async () => {}, message => {
    errors.push(message); if (message) sawFailure(); else sawRecovery();
  }, () => crypto.randomUUID());
  try {
    await failed; await repo.jobs();
    expect(errors).toEqual(['Synthetic queue read failure']);
    broken = false; runner.wake(); await recovered;
    expect(errors).toEqual(['Synthetic queue read failure', undefined]);
    expect(await repo.list()).toEqual([]);
  } finally { await runner.close(); await repo.close(); }
});
