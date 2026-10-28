import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { crmDelivery } from '../server/crm-delivery';
import { crmOutbox, type OutboxOperation } from '../server/crm-outbox';
import { crmWorker } from '../server/crm-worker';
import { sqliteAtomic } from '../tests/helpers/sqlite-atomic';
import { crmTestFixtures } from './crm-test-fixtures';

const endpoint = process.argv[2];
if (!endpoint || !['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname)) throw new Error('Synthetic probe accepts loopback only.');
const sent = (await crmTestFixtures())[1], body = JSON.parse(sent.envelopeJson);
const sha = (value: string) => new Bun.CryptoHasher('sha256').update(value).digest('hex');
const source = { leadId: sent.leadId, receiptId: sent.sourceReceiptId, ownerEmail: sent.owner.email, ownerVersion: sent.owner.version,
  envelopeSha256: sent.envelopeSha256, envelope: `owners/${sha(`pete-team/${body.workspace.id}`)}/leads/${sha(body.source.draftId)}/${sent.envelopeSha256}.json` };
const phase = process.argv[3];
if (!phase) {
  const dir = mkdtempSync(join(tmpdir(), 'pete-outbox-http-')), path = join(dir, 'outbox.sqlite');
  try {
    const time = Date.now();
    for (const [index, step] of ['lost', 'recover', 'assign'].entries()) {
      // Each stage is a new process. Only the SQLite queue and receiver survive.
      const child = Bun.spawn([process.execPath, import.meta.path, endpoint, step, path, String(time + index * 60_000)], { stdout: 'pipe', stderr: 'pipe' });
      const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
      assert.equal(await child.exited, 0, err);
      const stats = JSON.parse(out);
      assert.equal(stats.posts, step === 'recover' ? 0 : 1);
    }
    console.log('Durable outbox → Django HTTP: separate worker processes recovered a lost receipt and updated the owner without a duplicate POST.');
  } finally { rmSync(dir, { recursive: true, force: true }); }
} else {
  assert.ok(['lost', 'recover', 'assign'].includes(phase));
  const db = sqliteAtomic(process.argv[4]), time = Number(process.argv[5]);
  let posts = 0;
  const transport = crmDelivery({ endpoint, audience: 'https://crm.example.test', token: async () => 'synthetic-test-token', fetch: async (url, init) => {
    if (init?.method === 'POST') posts++;
    const response = await fetch(url, init);
    if (phase === 'lost' && init?.method === 'POST' && response.ok) { await response.text(); throw new Error('Synthetic lost acceptance response'); }
    return response;
  } });
  const queue = crmOutbox(transport.destinationId, () => time);
  const worker = crmWorker({ store: db.store, transport, readSource: async () => sent.envelopeJson, now: () => time, random: () => 0.5 });
  try {
    if (phase !== 'recover') await db.store.atomic([queue.key(sent.leadId)], records => ({ result: undefined,
      writes: queue.enqueue(records, phase === 'assign' ? { ...source, ownerEmail: 'second@example.test', ownerVersion: 2 } : source) }));
    assert.equal(await worker.run(sent.leadId), phase === 'lost' ? 'retry' : 'acknowledged');
    if (phase === 'recover') {
      const row = await db.store.read<OutboxOperation>(queue.operationKey(sent.leadId, 1));
      assert.equal(row?.receipt?.messagesSent, false); assert.equal(row?.attempts, 2);
    }
    if (phase === 'assign') assert.equal((await worker.status(sent.leadId))?.settled, 2);
    console.log(JSON.stringify({ phase, posts }));
  } finally { db.close(); }
}
