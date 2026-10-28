import { expect, test } from 'bun:test';
import { createDraft, reduceDraft, type Attachment } from '../src/domain/draft';
import { newJob, NEVER, type Extraction } from '../src/processing/jobs';
import { changedDetails, reviewChanges } from '../src/processing/review';

const at = (minute: number) => `2026-10-28T10:${String(minute).padStart(2, '0')}:00.000Z`;
const attachment = (id: string, minute: number): Attachment => ({ id, kind: 'voice', name: `${id}.webm`, mimeType: 'audio/webm', bytes: 3, sha256: id, capturedAt: at(minute) });
const result: Extraction = { text: 'We need juice at 2400 bottles per hour.', fields: { name: 'Mara Lind' }, request: { product: 'juice', capacity: { throughput: '2400', unit: 'bottles/h' } }, evidence: { 'request.throughput': '2400 bottles per hour' }, engine: 'Synthetic' };
function fixture() {
  const first = attachment('first', 1), followup = attachment('followup', 3);
  let draft = createDraft('visitor', 'voice', '', at(0));
  draft = reduceDraft(draft, { type: 'attach', attachment: first }, at(1));
  const job = { ...newJob(draft.id, first, Date.parse(at(1))), state: 'complete' as const, readyAt: NEVER, result, updatedAt: Date.parse(at(2)) };
  draft = reduceDraft(draft, { type: 'autofill', jobId: job.id, attachmentId: first.id, fields: result.fields, request: result.request }, at(2));
  draft = reduceDraft(draft, { type: 'attach', attachment: followup }, at(3));
  const update = { ...newJob(draft.id, followup, Date.parse(at(3))), state: 'complete' as const, readyAt: NEVER, result: { ...result, fields: {}, request: { capacity: { throughput: '3000', unit: 'bottles/h' as const } } }, updatedAt: Date.parse(at(4)) };
  return { draft, job, update };
}

test('spoken change compares saved and proposed capacity as one choice and does not mutate the draft', () => {
  const { draft, update } = fixture();
  const changes = reviewChanges(draft, update);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ key: 'request.capacity', saved: '2400 bottles/h', proposed: '3000 bottles/h', superseded: false });
  expect(changedDetails(changes)).toEqual({ fields: {}, request: { capacity: { throughput: '3000', unit: 'bottles/h' } } });
  expect(draft.request.throughput).toBe('2400');
});
test('accepted spoken corrections supersede old warnings, including an older job that completes late', () => {
  let { draft, job, update } = fixture();
  draft = reduceDraft(draft, { type: 'reviewExtraction', jobId: update.id, attachmentId: update.attachmentId, ...changedDetails(reviewChanges(draft, update)) }, at(5));
  for (const original of [job, { ...job, updatedAt: Date.parse(at(8)) }]) {
    expect(reviewChanges(draft, original)).toMatchObject([{ key: 'request.capacity', superseded: true }]);
    expect(changedDetails(reviewChanges(draft, original))).toEqual({ fields: {}, request: undefined });
  }
  expect(reviewChanges(draft, { ...update, reviewedAt: Date.parse(at(5)) })).toEqual([]);
  expect(draft.contact.name).toBe('Mara Lind');
});
test('a correction during processing stays authoritative; a later capture can still offer a new change', () => {
  let { draft, update } = fixture();
  draft = reduceDraft(draft, { type: 'edit', patch: { request: { throughput: '2700', unit: 'bottles/h' } } }, at(4));
  expect(reviewChanges(draft, update)[0].superseded).toBe(true);
  const later = attachment('later', 6);
  draft = reduceDraft(draft, { type: 'attach', attachment: later }, at(6));
  expect(reviewChanges(draft, { ...update, id: 'visitor/later', attachmentId: later.id })[0].superseded).toBe(false);
});
test('deliberately cleared details are shown as protected blanks and change only after explicit selection', () => {
  let { draft, update } = fixture();
  draft = reduceDraft(draft, { type: 'edit', patch: { contact: { phone: '' } } }, at(2));
  const source = { ...update, result: { ...result, fields: { phone: '+12025550182' }, request: undefined } };
  const changes = reviewChanges(draft, source);
  expect(changes[0]).toMatchObject({ saved: 'Left blank intentionally', proposed: '+12025550182', superseded: false });
  expect(draft.contact.phone).toBe('');
  const next = reduceDraft(draft, { type: 'reviewExtraction', jobId: source.id, attachmentId: source.attachmentId, ...changedDetails(changes) }, at(5));
  expect(next.contact.phone).toBe('+12025550182');
});
test('foreign, partial and previously reviewed sources never enter quick confirmation', () => {
  const { draft, update } = fixture();
  expect(reviewChanges(draft, { ...update, draftId: 'another-visitor' })).toEqual([]);
  expect(reviewChanges(draft, { ...update, attachmentId: 'foreign' })).toEqual([]);
  expect(reviewChanges(draft, { ...update, state: 'running' })).toEqual([]);
  expect(reviewChanges(draft, { ...update, reviewedAt: 0 })).toEqual([]);
});
test('legacy transcripts remain reviewable while structured abstentions do not become regex guesses', () => {
  const { draft, update } = fixture();
  const source = { ...update, result: { text: 'We need milk in PET bottles.', fields: {}, engine: 'Legacy' } };
  expect(reviewChanges(draft, source).map(change => change.proposed)).toEqual(['milk', 'PET bottles']);
  expect(reviewChanges(draft, { ...source, result: { ...source.result, evidence: {}, questions: ['Which product?'] } })).toEqual([]);
});
