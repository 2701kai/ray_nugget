import { strict as assert } from 'node:assert';
import { crmDelivery, CrmDeliveryError, prepareCrmDelivery } from '../server/crm-delivery';
import { crmTestFixtures } from './crm-test-fixtures';

const endpoint = process.argv[2];
if (!endpoint || !['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname)) throw new Error('Synthetic probe accepts loopback only.');
const fixture = (await crmTestFixtures())[0];
const options = { endpoint, audience: 'https://crm.example.test', token: async () => 'synthetic-test-token' };
const adapter = crmDelivery(options);
assert.equal(await adapter.receipt(fixture), undefined);
let lost = false;
const interrupted = crmDelivery({ ...options, fetch: (async (...args: Parameters<typeof fetch>) => {
  const response = await fetch(...args);
  if (!lost && response.ok) { lost = true; await response.text(); throw new Error('Synthetic response loss after durable acceptance'); }
  return response;
}) });
await assert.rejects(interrupted.send(fixture), error => error instanceof CrmDeliveryError && error.retryable);
const recovered = await adapter.receipt(fixture);
assert.ok(recovered); assert.equal(recovered.messagesSent, false);
assert.deepEqual(await adapter.send(fixture), recovered);
const reassigned = prepareCrmDelivery({ ...fixture, sequence: 2, owner: { email: 'second-owner@example.test', version: 2 } });
assert.equal((await adapter.send(reassigned)).status, 'received');
assert.deepEqual(await adapter.send(fixture), recovered); // Old ack is immutable; current lead stays at sequence 2.
const changed = { ...fixture, owner: { email: 'invalid-replay@example.test', version: 3 } };
await assert.rejects(adapter.send(changed), error => error instanceof CrmDeliveryError && error.status === 409 && !error.retryable);
console.log('Bun → Django HTTP: accepted, lost response recovered, replayed, reassigned; no messages.');
