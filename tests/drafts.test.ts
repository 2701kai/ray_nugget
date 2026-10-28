import { describe, expect, test } from 'bun:test';
import { createDraft, reduceDraft, rfqGaps, internationalPhone, type Attachment } from '../src/domain/draft';

const now = '2026-10-27T13:00:00.000Z';
const card: Attachment = { id: 'card-a', kind: 'card', name: 'synthetic-card.png', mimeType: 'image/png', bytes: 3, sha256: 'synthetic-hash-a', capturedAt: now };
const sender = { name: 'Test Salesperson', company: 'Example Test Company', phone: '+1 202 555 0181' };

describe('draft lifecycle', () => {
  test('all entry points allow an incomplete durable draft and qualification remains explicit', () => {
    for (const entry of ['contact', 'card', 'voice', 'request'] as const) {
      const draft = createDraft(entry, entry, 'Synthetic Fair', now);
      expect(draft.entry).toBe(entry);
      expect(rfqGaps(draft.request)).toEqual(['Product', 'Container', 'Throughput + unit']);
    }
    const draft = reduceDraft(createDraft('a', 'request', '', now), { type: 'edit', patch: { request: { product: 'Juice', packaging: 'Glass', throughput: '2400', unit: 'bottles/h' } } }, now);
    expect(rfqGaps(draft.request)).toEqual([]);
    expect(rfqGaps({ ...draft.request, throughput: '-5' })).toEqual(['Throughput + unit']);
    expect(rfqGaps({ ...draft.request, unit: '' })).toEqual(['Throughput + unit']);
  });

  test('late extraction preserves manual corrections, including deliberately cleared values', () => {
    let draft = reduceDraft(createDraft('a', 'card', '', now), { type: 'attach', attachment: card }, now);
    draft = reduceDraft(draft, { type: 'edit', patch: { contact: { name: 'Manually corrected', phone: '' } } }, now);
    const action = { type: 'enrich' as const, jobId: 'job-1', attachmentId: card.id, fields: { name: 'Extracted name', phone: '+12025550182', company: 'Synthetic Company' } };
    draft = reduceDraft(draft, action, now);
    expect(draft.contact).toMatchObject({ name: 'Manually corrected', phone: '', company: 'Synthetic Company' });
    expect(draft.suggestions).toHaveLength(2);
    expect(draft.provenance['contact.company']).toMatchObject({ source: 'extraction', attachmentId: card.id });
    expect(reduceDraft(draft, action, now)).toBe(draft);
  });

  test('another visitor cannot receive enrichment from a foreign attachment', () => {
    const other = createDraft('visitor-b', 'contact', '', now);
    expect(() => reduceDraft(other, { type: 'enrich', jobId: 'job', attachmentId: card.id, fields: { name: 'Wrong visitor' } }, now)).toThrow('does not belong');
    expect(other.contact.name).toBe('');
  });

  test('conversation recordings require consent and duplicate media does not multiply attachments', () => {
    const draft = createDraft('a', 'voice', '', now);
    expect(() => reduceDraft(draft, { type: 'attach', attachment: { ...card, kind: 'voice', voiceMode: 'conversation' } }, now)).toThrow('consent');
    const saved = reduceDraft(draft, { type: 'attach', attachment: card }, now);
    expect(reduceDraft(saved, { type: 'attach', attachment: { ...card, id: 'retry-id' } }, now)).toBe(saved);
    expect(() => reduceDraft(draft, { type: 'attach', attachment: { ...card, bytes: 0 } }, now)).toThrow('non-empty');
  });
});

describe('WhatsApp introduction preparation', () => {
  test('missing or ambiguous numbers cannot produce an introduction', () => {
    expect(() => internationalPhone('0171 555 0101')).toThrow('international');
    expect(() => internationalPhone('+1 202 555 0181 ext 7')).toThrow();
    expect(internationalPhone('001 202 555 0181')).toBe('+12025550181');
    expect(() => reduceDraft(createDraft('a', 'contact', '', now), { type: 'followup', sender, operationId: 'send-1' }, now)).toThrow();
  });

  test('double taps reuse the prepared operation; changed recipients invalidate rather than retarget it', () => {
    let draft = reduceDraft(createDraft('a', 'contact', 'Synthetic Fair', now), { type: 'edit', patch: { contact: { name: 'Synthetic Visitor', phone: '+12025550182' } } }, now);
    draft = reduceDraft(draft, { type: 'followup', sender, operationId: 'intro-1' }, now);
    expect(draft.followup).toMatchObject({ id: 'intro-1', state: 'prepared', recipient: '+12025550182' });
    expect(draft.followup?.message).toContain('10/27/2026');
    expect(draft.followup?.message).toContain(sender.name);
    const duplicate = reduceDraft(draft, { type: 'followup', sender, operationId: 'intro-2' }, now);
    expect(duplicate).toBe(draft);
    const changed = reduceDraft(draft, { type: 'edit', patch: { contact: { phone: '+12025550183' } } }, now);
    expect(changed.followup).toMatchObject({ id: 'intro-1', state: 'outdated', recipient: '+12025550182' });
    expect(changed.contact.phone).toBe('+12025550183');
    expect(reduceDraft(changed, { type: 'followup', sender, operationId: 'intro-3' }, now).followup).toMatchObject({ state: 'prepared', recipient: '+12025550183' });
  });
});
