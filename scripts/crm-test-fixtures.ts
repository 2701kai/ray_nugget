import { leadIntake } from '../server/lead-intake';
import { prepareCrmDelivery } from '../server/crm-delivery';
import { createDraft, reduceDraft } from '../src/domain/draft';
import { newJob } from '../src/processing/jobs';
import type { AtomicStore } from '../server/hosted-store';
import type { hostedStorage } from '../server/hosted-storage';

const sha = (value: string | Uint8Array) => new Bun.CryptoHasher('sha256').update(value).digest('hex');
const when = '2026-10-28T12:00:00.000Z';

/** Uses the actual intake serializer. Everything here is synthetic. */
export async function crmTestFixtures() {
  const fixtures = [];
  for (const [index, kind] of (['card', 'voice', 'voice'] as const).entries()) {
    let stored = '';
    const storage = { async put(_path: string, bytes: Uint8Array) { stored = new TextDecoder().decode(bytes); } } as ReturnType<typeof hostedStorage>;
    const intake = leadIntake({} as AtomicStore, storage, () => Date.parse(when));
    const team = { id: 'synthetic-fair', event: 'Synthetic fair', actor: 'owner@example.test', members: ['owner@example.test'] };
    let draft = createDraft(`synthetic-crm-${index}`, kind === 'card' ? 'card' : 'voice', team.event, when);
    const media = { id: `synthetic-${kind}-${index}`, name: 'Synthetic evidence', kind, sha256: sha(`synthetic-media-${index}`), bytes: 20,
      mimeType: kind === 'card' ? 'image/png' : 'audio/webm', capturedAt: when,
      ...(kind === 'voice' ? { voiceMode: index === 2 ? 'conversation' as const : 'memo' as const, ...(index === 2 ? { consentConfirmed: true } : {}) } : {}) };
    draft = reduceDraft(draft, { type: 'attach', attachment: media }, when);
    const job = { ...newJob(draft.id, media, Date.parse(when)), state: 'complete' as const, result: {
      text: kind === 'card' ? 'Synthetic Card • Example Test Company' : 'Synthetic source: Wir brauchen 120 Liter pro Stunde.',
      engine: 'synthetic', fields: { name: 'Synthetic Visitor' },
    } };
    draft = reduceDraft(draft, { type: 'autofill', jobId: job.id, attachmentId: media.id, fields: { name: 'Synthetic Visitor' } }, when);
    draft = reduceDraft(draft, { type: 'edit', patch: { contact: { company: 'Example Test Company' }, request: { intent: index === 2 ? 'sell' : 'buy', product: 'juice', throughput: '120', unit: 'L/h' } } }, when);
    await intake.prepare(sha(`pete-team/${team.id}`), sha(draft.id), { draft, jobs: [job] }, sha(`snapshot-${index}`), team);
    const envelope = JSON.parse(stored);
    fixtures.push(prepareCrmDelivery({ leadId: envelope.leadId, sequence: 1, sourceReceiptId: envelope.receiptId,
      envelopeSha256: sha(stored), envelopeJson: stored, owner: { email: team.actor, version: 1 } }));
  }
  return fixtures;
}

if (import.meta.main) {
  const destination = process.argv[2];
  if (!destination) throw new Error('Pass a local fixture output path.');
  await Bun.write(destination, JSON.stringify(await crmTestFixtures(), null, 2));
}
