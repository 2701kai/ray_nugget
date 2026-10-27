export type CaptureKind = 'contact' | 'request' | 'card' | 'voice';
export type Contact = { name: string; company: string; email: string; phone: string };
export type Request = {
  intent: 'buy' | 'sell' | 'unspecified';
  product: string;
  packaging: string;
  throughput: string;
  unit: '' | 'units/h' | 'bottles/h' | 'L/h';
};
export type Attachment = {
  id: string;
  kind: 'card' | 'voice';
  name: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  capturedAt: string;
  voiceMode?: 'memo' | 'conversation';
  consentConfirmed?: boolean;
};
export type Sender = { name: string; company: string; phone: string };
export type Followup = {
  id: string;
  state: 'prepared' | 'outdated';
  recipient: string;
  message: string;
  preparedAt: string;
};
type Origin = { source: 'manual' | 'extraction'; at: string; attachmentId?: string; jobId?: string; reviewedAt?: string };
export type Draft = {
  schemaVersion: 1;
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  entry: CaptureKind;
  event: string;
  contact: Contact;
  request: Request;
  note: string;
  entries?: Array<{ id: string; text: string; createdAt: string }>;
  attachments: Attachment[];
  provenance: Record<string, Origin>;
  appliedJobs: string[];
  suggestions: Array<{ field: keyof Contact; value: string; attachmentId: string; jobId: string }>;
  followup?: Followup;
};
export type Patch = { contact?: Partial<Contact>; request?: Partial<Request>; event?: string; note?: string };
export type DraftAction =
  | { type: 'edit'; patch: Patch }
  | { type: 'addNote'; id: string; text: string }
  | { type: 'attach'; attachment: Attachment }
  | { type: 'enrich'; jobId: string; attachmentId: string; fields: Partial<Contact> }
  | { type: 'reviewExtraction'; jobId: string; attachmentId: string; fields: Partial<Contact>; transcript?: string }
  | { type: 'followup'; sender: Sender; operationId: string };

export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 180;
export const MAX_CONVERSATION_SECONDS = 30 * 60;
export const MAX_VOICE_BYTES = 60 * 1024 * 1024;
export const mediaLimit = (kind: Attachment['kind']) => kind === 'voice' ? MAX_VOICE_BYTES : MAX_MEDIA_BYTES;

export function createDraft(id: string, entry: CaptureKind, event: string, now: string): Draft {
  return {
    schemaVersion: 1, id, revision: 0, createdAt: now, updatedAt: now, entry, event,
    contact: { name: '', company: '', email: '', phone: '' },
    request: { intent: 'unspecified', product: '', packaging: '', throughput: '', unit: '' },
    note: '', attachments: [], provenance: {}, appliedJobs: [], suggestions: [],
  };
}

export function titleOf(draft: Draft): string {
  return draft.contact.name || draft.contact.company || 'Untitled visitor';
}

export function rfqGaps(request: Request): string[] {
  const gaps: string[] = [];
  if (!request.product.trim()) gaps.push('Product');
  if (!request.packaging.trim()) gaps.push('Container');
  const amount = request.throughput.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0 || !Number.isFinite(Number(amount)) || !request.unit) gaps.push('Throughput + unit');
  return gaps;
}

export function internationalPhone(value: string): string {
  const trimmed = value.trim();
  if (!/^(\+|00)[\d\s().-]+$/.test(trimmed)) throw new Error('Use an international number, starting with + and the country code.');
  const phone = trimmed.replace(/^00/, '+').replace(/[\s().-]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error('Check the country code and mobile number.');
  return phone;
}

function introduction(draft: Draft, sender: Sender, now: string) {
  const recipient = internationalPhone(draft.contact.phone);
  if (!sender.name.trim()) throw new Error('Add your name in Your details before preparing an introduction.');
  const senderPhone = internationalPhone(sender.phone);
  const date = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin' }).format(new Date(now));
  const greeting = draft.contact.name.trim() ? `Hallo ${draft.contact.name.trim()},` : 'Hallo,';
  const context = draft.event.trim() ? ` bei ${draft.event.trim()}` : '';
  const signature = [sender.name.trim(), sender.company.trim(), senderPhone].filter(Boolean).join('\n');
  return { recipient, message: `${greeting}\n\nvielen Dank für unser Gespräch${context} am ${date}. Hier sind meine Kontaktdaten. Weitere Informationen können Sie mir gerne hier schicken.\n\n${signature}` };
}

export function reduceDraft(draft: Draft, action: DraftAction, now: string): Draft {
  const next: Draft = {
    ...draft, contact: { ...draft.contact }, request: { ...draft.request },
    attachments: [...draft.attachments], provenance: { ...draft.provenance },
    suggestions: [...draft.suggestions], appliedJobs: [...draft.appliedJobs],
  };
  if (action.type === 'edit') {
    for (const section of ['contact', 'request'] as const) {
      const patch = action.patch[section];
      if (!patch) continue;
      for (const [key, raw] of Object.entries(patch)) {
        if (!(key in next[section]) || typeof raw !== 'string') throw new Error('Unsupported draft field.');
        if (raw.length > 2000) throw new Error('Keep individual fields under 2,000 characters.');
        Object.assign(next[section], { [key]: raw.trim() });
        next.provenance[`${section}.${key}`] = { source: 'manual', at: now };
      }
    }
    if (action.patch.event !== undefined) next.event = action.patch.event.trim().slice(0, 200);
    if (action.patch.note !== undefined) {
      if (action.patch.note.length > 10000) throw new Error('Keep a note under 10,000 characters.');
      next.note = action.patch.note;
    }
  } else if (action.type === 'addNote') {
    if (draft.entries?.some(entry => entry.id === action.id)) return draft;
    if (!action.text.trim() || action.text.length > 10000) throw new Error('Write a note of up to 10,000 characters.');
    next.entries = [...(draft.entries ?? []), { id: action.id, text: action.text.trim(), createdAt: now }];
  } else if (action.type === 'attach') {
    const attachment = action.attachment;
    if (attachment.bytes <= 0 || attachment.bytes > mediaLimit(attachment.kind)) throw new Error(`Choose a non-empty file smaller than ${mediaLimit(attachment.kind) / 1024 / 1024} MiB.`);
    if (attachment.kind === 'voice' && attachment.voiceMode === 'conversation' && !attachment.consentConfirmed) throw new Error('Confirm consent before saving a conversation recording.');
    if (draft.attachments.some(a => a.id === attachment.id || (a.sha256 === attachment.sha256 && a.kind === attachment.kind))) return draft;
    next.attachments.push(attachment);
  } else if (action.type === 'enrich') {
    if (draft.appliedJobs.includes(action.jobId)) return draft;
    if (!draft.attachments.some(a => a.id === action.attachmentId)) throw new Error('The extraction source does not belong to this draft.');
    for (const field of Object.keys(action.fields) as Array<keyof Contact>) {
      if (!(field in next.contact)) throw new Error('Unsupported extracted field.');
      const value = action.fields[field]?.trim();
      if (!value) continue;
      const key = `contact.${field}`;
      if (next.contact[field] || next.provenance[key]?.source === 'manual') {
        if (next.contact[field] !== value) next.suggestions.push({ field, value, attachmentId: action.attachmentId, jobId: action.jobId });
      } else {
        next.contact[field] = value;
        next.provenance[key] = { source: 'extraction', at: now, attachmentId: action.attachmentId, jobId: action.jobId };
      }
    }
    next.appliedJobs.push(action.jobId);
  } else if (action.type === 'reviewExtraction') {
    if (draft.appliedJobs.includes(action.jobId)) return draft;
    if (!draft.attachments.some(a => a.id === action.attachmentId)) throw new Error('The extraction source does not belong to this draft.');
    for (const [field, value] of Object.entries(action.fields)) {
      if (!Object.hasOwn(next.contact, field) || typeof value !== 'string' || value.length > 2000) throw new Error('Invalid reviewed contact field.');
      next.contact[field as keyof Contact] = value.trim();
      next.provenance[`contact.${field}`] = { source: 'extraction', at: now, reviewedAt: now, attachmentId: action.attachmentId, jobId: action.jobId };
    }
    if (action.transcript) {
      const note = [next.note, action.transcript].filter(Boolean).join('\n\n');
      if (note.length > 10000) throw new Error('The transcript and existing notes exceed 10,000 characters. Copy the relevant parts instead.');
      next.note = note;
      next.provenance.note = { source: 'extraction', at: now, reviewedAt: now, attachmentId: action.attachmentId, jobId: action.jobId };
    }
    next.appliedJobs.push(action.jobId);
  } else {
    const prepared = introduction(draft, action.sender, now);
    if (draft.followup?.state === 'prepared' && draft.followup.recipient === prepared.recipient && draft.followup.message === prepared.message) return draft;
    next.followup = { id: action.operationId, state: 'prepared', preparedAt: now, ...prepared };
  }
  if (action.type !== 'followup' && next.followup && (next.contact.name !== draft.contact.name || next.contact.phone !== draft.contact.phone || next.event !== draft.event)) {
    next.followup = { ...next.followup, state: 'outdated' };
  }
  return { ...next, revision: draft.revision + 1, updatedAt: now };
}

export class RevisionConflict extends Error {
  constructor() { super('This draft changed while you were editing. Reopen it to review the latest version before saving.'); }
}

export function checkRevision(draft: Draft | undefined, expected?: number): asserts draft is Draft {
  if (!draft) throw new Error('This draft could not be found.');
  if (expected !== undefined && draft.revision !== expected) throw new RevisionConflict();
}

export function exportDraft(draft: Draft) {
  return {
    format: 'pete-draft/v1', exportedAt: new Date().toISOString(), draft,
    qualification: { complete: rfqGaps(draft.request).length === 0, missing: rfqGaps(draft.request) },
    media: 'Metadata only. Original files remain on this device.',
  };
}
