import { requestKeys, requestTextKeys, qualificationKeys, parseCaptureContext, parseQuestionDecision } from '../domain/requirements';
import { mediaLimit, type Attachment, type Contact, type Draft } from '../domain/draft';
import { detailKeys, requestFields } from '../domain/details';
import { NEVER, newJob, validateExtraction, type Extraction, type ProcessingJob } from '../processing/jobs';
import { parseRayAdvice } from '../ray/types';

export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAGIC = 'PETE_BACKUP_V1\n';
const CORRECTED_MAGIC = 'PETE_BACKUP_V2\n';
const HEADER_BYTES = MAGIC.length + 4 + 64;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export type Digest = (bytes: Uint8Array) => Promise<string>;
export type BackupSnapshot = { draft: Draft; jobs: ProcessingJob[]; media: Array<{ attachmentId: string; bytes: Uint8Array }> };
export type VerifiedBackup = BackupSnapshot & { fingerprint: string };
const invalid = () => new Error('This backup is incomplete, damaged, or from an unsupported version of Pete.');

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || value.length > max) throw invalid();
  return value;
}
function id(value: unknown): string {
  const result = string(value, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw invalid();
  return result;
}
function hash(value: unknown): string {
  const result = string(value, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) throw invalid();
  return result;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw invalid();
  return value;
}
function date(value: unknown): string {
  const result = string(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) throw invalid();
  return result;
}
function oneOf<const T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw invalid();
  return value as T;
}
function array(value: unknown, max = 250): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  return value;
}
function unique<T>(values: T[]): T[] {
  if (new Set(values).size !== values.length) throw invalid();
  return values;
}
const contactKeys = ['name', 'company', 'email', 'phone'] as const;
function extraction(value: unknown): Extraction {
  const raw = object(value); const fields = object(raw.fields); const parsed: Partial<Contact> = {};
  for (const field of Object.keys(fields)) parsed[oneOf(field, contactKeys)] = string(fields[field]);
  const engine = string(raw.engine, 100);
  if (!engine) throw invalid();
  const result: Extraction = { text: string(raw.text, 50_000), engine, fields: parsed };
  if (raw.sourceEngine !== undefined) result.sourceEngine = string(raw.sourceEngine, 100);
  if (raw.sourceEdits !== undefined) result.sourceEdits = array(raw.sourceEdits, 50).map(value => { const e = object(value); return { id: id(e.id), text: string(e.text, 50_000), createdAt: date(e.createdAt) }; });
  if (raw.activeEditId !== undefined) result.activeEditId = id(raw.activeEditId);
  if (raw.request !== undefined) {
    const request = object(raw.request);
    result.request = {};
    for (const field of ['intent', ...requestTextKeys] as const) if (request[field] !== undefined) Object.assign(result.request, { [field]: string(request[field]) });
    if (request.capacity !== undefined) {
      const capacity = object(request.capacity);
      result.request.capacity = { throughput: string(capacity.throughput), unit: oneOf(capacity.unit, ['units/h', 'bottles/h', 'L/h']) };
    }
    requestFields(result.request);
  }
  if (raw.evidence !== undefined) result.evidence = Object.fromEntries(Object.entries(object(raw.evidence)).map(([key, value]) => [oneOf(key, detailKeys), string(value, 1000)]));
  if (raw.questions !== undefined) result.questions = array(raw.questions, 6).map(value => string(value, 300));
  validateExtraction(result);
  return result;
}

// Construct only known fields. File contents never become settings, credentials,
// URLs, leases, executable code, or ready-to-run processing instructions.
function manifest(value: unknown): Omit<BackupSnapshot, 'media'> {
  const root = object(value);
  if (root.format !== 'pete-backup/v1' && root.format !== 'pete-backup/v2') throw invalid();
  const raw = object(root.draft);
  if (raw.schemaVersion !== 1) throw invalid();
  const contact = object(raw.contact); const request = object(raw.request);
  const draft: Draft = {
    schemaVersion: 1, id: id(raw.id), revision: integer(raw.revision), createdAt: date(raw.createdAt), updatedAt: date(raw.updatedAt),
    entry: oneOf(raw.entry, ['contact', 'request', 'voice', 'card']), event: string(raw.event, 200),
    contact: { name: string(contact.name), company: string(contact.company), email: string(contact.email), phone: string(contact.phone) },
    request: { intent: oneOf(request.intent, ['buy', 'sell', 'unspecified']), product: string(request.product), packaging: string(request.packaging), throughput: string(request.throughput), unit: oneOf(request.unit, ['', 'units/h', 'bottles/h', 'L/h']) },
    note: string(raw.note, 10000), attachments: [], provenance: {}, appliedJobs: [], suggestions: [],
  };
  for (const key of qualificationKeys) if (request[key] !== undefined) draft.request[key] = string(request[key]);
  if (raw.conversationVersion !== undefined) { if (raw.conversationVersion !== 1) throw invalid(); draft.conversationVersion = 1; }
  if (raw.rayQuestions !== undefined) { draft.rayQuestions = array(raw.rayQuestions, 300).map(parseQuestionDecision); unique(draft.rayQuestions.map(q => q.id)); }
  draft.attachments = array(raw.attachments).map(value => {
    const a = object(value); const kind = oneOf(a.kind, ['card', 'voice']);
    const attachment: Attachment = { id: id(a.id), kind, name: string(a.name, 1000), mimeType: string(a.mimeType, 150), bytes: integer(a.bytes, mediaLimit(kind)), sha256: hash(a.sha256), capturedAt: date(a.capturedAt) };
    // Originals are image/audio data only; do not allow imported HTML/SVG documents.
    if (!attachment.bytes || !(kind === 'card' ? /^image\/(?:png|jpeg|jpg|webp|heic|heif|gif|bmp)$/i : /^audio\/(?:webm|ogg|mp4|mpeg|wav|x-wav|aac|m4a)(?:;.*)?$/i).test(attachment.mimeType)) throw invalid();
    if (a.context !== undefined) { if (kind !== 'voice') throw invalid(); attachment.context = parseCaptureContext(a.context); }
    if (a.voiceMode !== undefined) attachment.voiceMode = oneOf(a.voiceMode, ['memo', 'conversation']);
    if (a.consentConfirmed !== undefined) {
      if (typeof a.consentConfirmed !== 'boolean') throw invalid();
      attachment.consentConfirmed = a.consentConfirmed;
    }
    if (attachment.voiceMode === 'conversation' && attachment.consentConfirmed !== true) throw invalid();
    return attachment;
  });
  unique(draft.attachments.map(a => a.id));
  assertBackupSize(draft);
  const source = (attachmentId: unknown, jobId: unknown) => {
    const sourceId = id(attachmentId);
    if (!draft.attachments.some(a => a.id === sourceId) || jobId !== `${draft.id}/${sourceId}`) throw invalid();
    return { attachmentId: sourceId, jobId: `${draft.id}/${sourceId}` };
  };
  for (const [key, value] of Object.entries(object(raw.provenance))) {
    if (![...contactKeys.map(k => `contact.${k}`), ...requestKeys.map(k => `request.${k}`), 'note'].includes(key)) throw invalid();
    const origin = object(value); const at = date(origin.at);
    draft.provenance[key] = origin.source === 'manual' ? { source: 'manual', at }
      : origin.source === 'extraction' ? { source: 'extraction', at, ...source(origin.attachmentId, origin.jobId), ...(origin.reviewedAt === undefined ? {} : { reviewedAt: date(origin.reviewedAt) }) }
      : (() => { throw invalid(); })();
  }
  draft.appliedJobs = unique(array(raw.appliedJobs).map(value => {
    if (!draft.attachments.some(a => value === `${draft.id}/${a.id}`)) throw invalid();
    return string(value, 257);
  }));
  draft.suggestions = array(raw.suggestions, 1000).map(value => {
    const suggestion = object(value);
    return { field: oneOf(suggestion.field, contactKeys), value: string(suggestion.value), ...source(suggestion.attachmentId, suggestion.jobId) };
  });
  if (raw.entries !== undefined) {
    draft.entries = array(raw.entries, 1000).map(value => { const e = object(value); return { id: id(e.id), text: string(e.text, 10000), createdAt: date(e.createdAt) }; });
    unique(draft.entries.map(e => e.id));
  }
  if (raw.followup !== undefined) {
    const f = object(raw.followup);
    draft.followup = { id: id(f.id), state: oneOf(f.state, ['prepared', 'outdated']), recipient: string(f.recipient, 100), message: string(f.message, 10000), preparedAt: date(f.preparedAt) };
  }
  if (raw.ray !== undefined) {
    draft.ray = array(raw.ray, 100).map(parseRayAdvice);
    unique(draft.ray.map(a => a.id));
    if (draft.ray.some(a => a.draftId !== draft.id)) throw invalid();
  }
  for (const a of draft.attachments) if (a.context?.consultationId && !draft.ray?.some(r => r.id === a.context!.consultationId && a.context!.questions.every(q => r.questions.includes(q)))) throw invalid();
  for (const q of draft.rayQuestions ?? []) if (!draft.ray?.some(r => r.id === q.consultationId && r.questions.includes(q.question))) throw invalid();
  if (draft.rayQuestions?.length || draft.attachments.some(a => a.context) || qualificationKeys.some(k => draft.request[k] !== undefined)) draft.conversationVersion = 1;
  const jobs = array(root.jobs).map(value => {
    const j = object(value); const attachment = draft.attachments.find(a => a.id === j.attachmentId);
    if (!attachment) throw invalid();
    const job: ProcessingJob = { ...newJob(draft.id, attachment, integer(j.createdAt)), updatedAt: integer(j.updatedAt), state: 'failed', readyAt: NEVER, error: 'Restored original. Retry processing when ready; this may submit a new transcription.' };
    if (j.result !== undefined) {
      job.result = extraction(j.result);
      if (j.processingComplete !== false) { job.state = 'complete'; job.error = undefined; }
      else job.error = 'Saved text is ready. Retry to finish reading its details.';
    }
    if (j.reviewedAt !== undefined) {
      if (!job.result || job.state !== 'complete' || !draft.appliedJobs.includes(job.id)) throw invalid();
      job.reviewedAt = integer(j.reviewedAt);
    }
    if (draft.appliedJobs.includes(job.id) && job.reviewedAt === undefined) throw invalid();
    return job;
  });
  unique(jobs.map(j => j.id));
  if (jobs.length !== draft.attachments.length) throw invalid();
  return { draft, jobs };
}

export function assertBackupSize(draft: Draft) {
  if (draft.attachments.length > 250 || draft.attachments.reduce((sum, a) => sum + a.bytes, 0) > MAX_BACKUP_BYTES - MAX_MANIFEST_BYTES - HEADER_BYTES) throw new Error('This draft is too large for a 128 MiB backup. Keep its originals on this device.');
}

export function encodeManifest(snapshot: Pick<BackupSnapshot, 'draft' | 'jobs'>): Uint8Array {
  assertBackupSize(snapshot.draft);
  for (const job of snapshot.jobs) {
    if (job.draftId !== snapshot.draft.id || job.id !== `${snapshot.draft.id}/${job.attachmentId}` || !snapshot.draft.attachments.some(a => a.id === job.attachmentId && a.kind === job.kind) || (job.state === 'complete' && !job.result)) throw new Error('A source record is incomplete or belongs to another visitor. Backup was not created.');
  }
  const portable = { format: snapshot.jobs.some(job => job.result?.activeEditId) ? 'pete-backup/v2' : 'pete-backup/v1', draft: snapshot.draft, jobs: snapshot.jobs.map(job => ({
    attachmentId: job.attachmentId, createdAt: job.createdAt, updatedAt: job.updatedAt,
    ...(job.result && (job.state === 'complete' || job.result.activeEditId) ? { result: extraction(job.result), ...(job.state === 'complete' ? { reviewedAt: job.reviewedAt } : { processingComplete: false }) } : {}),
  })) };
  const checked = manifest(portable);
  const metadata = encoder.encode(JSON.stringify({ ...portable, draft: checked.draft }));
  if (metadata.byteLength > MAX_MANIFEST_BYTES) throw new Error('This draft has too much source text for a single backup.');
  return metadata;
}

export function decodeManifest(bytes: Uint8Array): Omit<BackupSnapshot, 'media'> {
  if (bytes.byteLength > MAX_MANIFEST_BYTES) throw invalid();
  return manifest(JSON.parse(decoder.decode(bytes)));
}

export async function encodeBackup(snapshot: BackupSnapshot, digest: Digest): Promise<Uint8Array[]> {
  const metadata = encodeManifest(snapshot);
  const checked = decodeManifest(metadata);
  const header = new Uint8Array(HEADER_BYTES);
  header.set(encoder.encode(JSON.parse(decoder.decode(metadata)).format === 'pete-backup/v2' ? CORRECTED_MAGIC : MAGIC));
  new DataView(header.buffer).setUint32(MAGIC.length, metadata.byteLength);
  header.set(encoder.encode(hash(await digest(metadata))), MAGIC.length + 4);
  const parts: Uint8Array[] = [header, metadata];
  if (snapshot.media.length !== checked.draft.attachments.length) throw new Error('An original file is missing. Backup was not created.');
  for (const attachment of checked.draft.attachments) {
    const bytes = snapshot.media.find(m => m.attachmentId === attachment.id)?.bytes;
    if (!bytes || bytes.byteLength !== attachment.bytes || await digest(bytes) !== attachment.sha256) throw new Error('An original file is missing or damaged. Backup was not created.');
    parts.push(bytes);
  }
  return parts;
}

export async function decodeBackup(bytes: Uint8Array, digest: Digest): Promise<VerifiedBackup> {
  if (bytes.byteLength > MAX_BACKUP_BYTES) throw new Error('Choose a Pete backup smaller than 128 MiB.');
  const magic = [MAGIC, CORRECTED_MAGIC].find(value => encoder.encode(value).every((byte, index) => bytes[index] === byte));
  if (bytes.byteLength < HEADER_BYTES || !magic) throw invalid();
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length);
  if (size > MAX_MANIFEST_BYTES || HEADER_BYTES + size > bytes.byteLength) throw invalid();
  const metadata = bytes.subarray(HEADER_BYTES, HEADER_BYTES + size);
  const fingerprint = hash(String.fromCharCode(...bytes.subarray(MAGIC.length + 4, HEADER_BYTES)));
  if (await digest(metadata) !== fingerprint) throw invalid();
  let parsed: Omit<BackupSnapshot, 'media'>;
  try {
    const value = JSON.parse(decoder.decode(metadata));
    if (value.format !== (magic === MAGIC ? 'pete-backup/v1' : 'pete-backup/v2')) throw invalid();
    parsed = manifest(value);
  } catch { throw invalid(); }
  let offset = HEADER_BYTES + size;
  const media: BackupSnapshot['media'] = [];
  for (const attachment of parsed.draft.attachments) {
    const end = offset + attachment.bytes;
    if (end > bytes.byteLength) throw invalid();
    const original = bytes.subarray(offset, end);
    if (await digest(original) !== attachment.sha256) throw invalid();
    media.push({ attachmentId: attachment.id, bytes: original }); offset = end;
  }
  if (offset !== bytes.byteLength) throw invalid();
  return { ...parsed, media, fingerprint };
}

export function restoredSnapshot(backup: VerifiedBackup): BackupSnapshot {
  const draftId = `restored-${hash(backup.fingerprint)}`;
  const jobId = (original: string) => `${draftId}/${original.slice(backup.draft.id.length + 1)}`;
  const draft: Draft = { ...backup.draft, id: draftId,
    ...(backup.draft.ray ? { ray: backup.draft.ray.map(a => ({ ...a, draftId })) } : {}),
    appliedJobs: backup.draft.appliedJobs.map(jobId),
    suggestions: backup.draft.suggestions.map(s => ({ ...s, jobId: jobId(s.jobId) })),
    provenance: Object.fromEntries(Object.entries(backup.draft.provenance).map(([key, origin]) => [key, { ...origin, ...(origin.jobId ? { jobId: jobId(origin.jobId) } : {}) }])),
    ...(backup.draft.followup ? { followup: { ...backup.draft.followup, state: 'outdated' as const } } : {}),
  };
  return { draft, media: backup.media, jobs: backup.jobs.map(job => ({ ...job, id: jobId(job.id), draftId })) };
}
