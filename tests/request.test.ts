import { expect, test } from 'bun:test';
import { createDraft, reduceDraft, type Attachment } from '../src/domain/draft';
import { requestCandidates } from '../src/processing/request';

test('English and German filling requests retain exact source evidence and explicit hourly units', () => {
  const english = 'We need to fill juice into glass bottles at 12,000 bottles per hour.';
  const result = requestCandidates(english);
  expect(result.product?.value).toBe('juice');
  expect(result.packaging?.value).toBe('glass bottles');
  expect(result.capacity?.value).toEqual({ throughput: '12000', unit: 'bottles/h' });
  for (const candidate of Object.values(result)) expect(english.includes(candidate!.evidence)).toBe(true);
  const german = requestCandidates('Wir benötigen eine Abfüllung für Bier in Glasflaschen mit 12.000 Flaschen pro Stunde.');
  expect(german.product?.value).toBe('Bier');
  expect(german.packaging?.value).toBe('Glasflaschen');
  expect(german.capacity?.value).toEqual({ throughput: '12000', unit: 'bottles/h' });
});

test('labelled custom products and packaging work without a beverage vocabulary match', () => {
  const result = requestCandidates('Produkt: Shampoo\nGebinde: 500 ml HDPE\nDurchsatz: 2 400 Einheiten/h');
  expect(result.product?.value).toBe('Shampoo');
  expect(result.packaging?.value).toBe('500 ml HDPE');
  expect(result.capacity?.value).toEqual({ throughput: '2400', unit: 'units/h' });
  expect(requestCandidates('Required throughput: 25,5 Liter pro Stunde').capacity?.value).toEqual({ throughput: '25.5', unit: 'L/h' });
});

test('conflicting products, packaging, and rates remain in the transcript', () => {
  const result = requestCandidates('We need beer and juice in glass bottles and cans at 2400 bottles/h. We need 3000 bottles/h.');
  expect(result.product).toBeUndefined();
  expect(result.packaging).toBeUndefined();
  expect(result.capacity).toBeUndefined();
  expect(requestCandidates('Product: beer\nProduct: juice').product).toBeUndefined();
  expect(requestCandidates('We need juice at 2400 bottles/h. We need juice at 2400 bottles/h.').capacity?.value.throughput).toBe('2400');
});

test('negation, ranges, estimates, unsupported units and missing units never become exact rates', () => {
  for (const text of [
    'We do not need 2400 bottles/h.', 'We need 2000–3000 bottles/h.',
    'We need between 2000 and 3000 bottles/h.', 'We need 2000 to 3000 bottles/h.', 'Wir brauchen 2000 bis 3000 Flaschen/h.',
    'We need about 2400 bottles/h.', 'Wir brauchen ca. 2400 Flaschen/h.',
    'We need at least 2400 bottles/h.', 'We need 50 bottles/min.',
    'Throughput: 2400', 'We need 1,500 L/h.', 'We need 1.500 L/h.',
    'We need 0 bottles/h.', 'We need -2400 bottles/h.', 'We need ~2400 bottles/h.',
    'We need 40 bottles/min. We need 2400 bottles/h.',
  ]) expect(requestCandidates(text).capacity, text).toBeUndefined();
  expect(requestCandidates('We do not need beer in glass bottles.').product).toBeUndefined();
  expect(requestCandidates('We need beer or juice in bottles.').product).toBeUndefined();
});

test('request review is source-bound, validates capacity as a pair, and preserves unselected fields', () => {
  const now = '2026-10-27T13:00:00.000Z';
  const source: Attachment = { id: 'voice-a', kind: 'voice', name: 'synthetic.webm', mimeType: 'audio/webm', bytes: 3, sha256: 'synthetic', capturedAt: now };
  let draft = reduceDraft(createDraft('visitor-a', 'voice', '', now), { type: 'attach', attachment: source }, now);
  draft = reduceDraft(draft, { type: 'edit', patch: { request: { product: 'Manually corrected', packaging: '' } } }, now);
  const review = { type: 'reviewExtraction' as const, jobId: 'job-a', attachmentId: source.id, fields: {}, request: { capacity: { throughput: '2400', unit: 'bottles/h' as const } } };
  const reviewed = reduceDraft(draft, review, now);
  expect(reviewed.request).toEqual({ intent: 'unspecified', product: 'Manually corrected', packaging: '', throughput: '2400', unit: 'bottles/h' });
  expect(reviewed.provenance['request.packaging'].source).toBe('manual');
  expect(reviewed.provenance['request.throughput']).toMatchObject({ source: 'extraction', attachmentId: source.id, jobId: 'job-a', reviewedAt: now });
  expect(reviewed.provenance['request.unit']).toEqual(reviewed.provenance['request.throughput']);
  expect(reduceDraft(reviewed, review, now)).toBe(reviewed);
  expect(() => reduceDraft(createDraft('visitor-b', 'voice', '', now), review, now)).toThrow('does not belong');
  expect(() => reduceDraft(draft, { ...review, request: { capacity: { throughput: '2400', unit: '' } } }, now)).toThrow('select its unit');
  expect(() => reduceDraft(draft, { ...review, request: { capacity: { throughput: '-1', unit: 'bottles/h' } } }, now)).toThrow('positive throughput');
});
