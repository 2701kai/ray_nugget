import type { Draft } from '../domain/draft';
import type { ProcessingJob } from '../processing/jobs';
import type { Digest } from '../backup/archive';
import type { RayInput } from './types';

// Full local source identity is hashed, not transmitted. Advice/selections never
// change this identity; new media, source text and corrections do.
export function raySource(draft: Draft, jobs: ProcessingJob[]) {
  return JSON.stringify({ request: draft.request, provenance: Object.fromEntries(Object.entries(draft.provenance).filter(([k]) => k.startsWith('request.'))),
    note: draft.note, entries: draft.entries ?? [],
    voice: draft.attachments.filter(a => a.kind === 'voice').map(a => ({ id: a.id, sha256: a.sha256,
      text: jobs.find(j => j.draftId === draft.id && j.attachmentId === a.id)?.result?.text ?? '' })) });
}
function redact(text: string, draft: Draft) {
  for (const value of Object.values(draft.contact).filter(v => v.trim().length >= 2).sort((a, b) => b.length - a.length)) text = text.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[contact]');
  return text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]').replace(/(?:\+|00)\d[\d ().-]{6,}\d/g, '[phone]').trim();
}
export async function prepareRayInput(draft: Draft, jobs: ProcessingJob[], digest: Digest, now = Date.now()): Promise<RayInput> {
  if (draft.request.intent === 'sell') throw new Error('Ray currently helps find equipment to buy. This seller lead stays saved for the team.');
  const sourceFingerprint = await digest(new TextEncoder().encode(raySource(draft, jobs)));
  const voice = draft.attachments.filter(a => a.kind === 'voice').map(a => ({ at: a.capturedAt, text: jobs.find(j => j.draftId === draft.id && j.attachmentId === a.id)?.result?.text ?? '' }));
  const pending = voice.filter(v => !v.text).length;
  const sources = [...voice, ...(draft.entries ?? []).map(e => ({ at: e.createdAt, text: e.text })), ...(draft.note ? [{ at: draft.provenance.note?.at ?? draft.createdAt, text: draft.note }] : [])].sort((a, b) => b.at.localeCompare(a.at));
  const lines: string[] = [];
  const labels = { product: 'Product', packaging: 'Container / packaging', throughput: 'Required output', unit: 'Output unit' };
  let omitted = 0;
  for (const field of Object.keys(labels) as Array<keyof typeof labels>) {
    if (!draft.request[field]) continue;
    const value = redact(draft.request[field], draft);
    const line = `${labels[field]} (${draft.provenance[`request.${field}`]?.source === 'manual' || draft.provenance[`request.${field}`]?.reviewedAt ? 'confirmed' : 'unreviewed'}): ${value}`;
    // Preserve a capacity and its unit together, exclusively in text. Ray's scalar
    // filter cannot represent arbitrary units and must never get a guessed value.
    if (field === 'throughput' || field === 'unit') continue;
    if (line.length <= 350) lines.push(line); else omitted++;
  }
  if (draft.request.throughput && draft.request.unit) {
    const output = `Required output: ${draft.request.throughput} ${draft.request.unit}`;
    if (output.length <= 250) lines.push(output); else omitted++;
  }
  // Split at sentence whitespace, never inside decimals such as 0.5 L or 2.400.
  const sentences = sources.flatMap(s => redact(s.text, draft).split(/(?<=[.!?])\s+|\n+/u).map(t => t.trim()).filter(Boolean));
  const seen = new Set<string>();
  const excerpts: string[] = [];
  for (const sentence of sentences) {
    if (seen.has(sentence)) continue;
    seen.add(sentence);
    // Whole excerpts only, newest sources first. Show omitted count in the UI;
    // never silently cut a source mid-sentence to fit the upstream contract.
    if (lines.join('\n').length + excerpts.join('\n').length + sentence.length + 110 <= 1450) excerpts.push(sentence); else omitted++;
  }
  if (!lines.length && !excerpts.length) throw new Error(omitted ? 'This source is too long for one Ray request. Add a short voice summary of the equipment need.' : pending ? 'The recording is still being transcribed. Ask Ray once its text is ready.' : 'Add the equipment need in a voice note or note first.');
  const brief = [...lines, ...(excerpts.length ? ['Source excerpts (newest capture first; confirmed fields override older statements):', ...excerpts] : [])].join('\n');
  return { version: 1, draftId: draft.id, sourceFingerprint, window: Math.floor(now / 900000), brief, omitted, pending };
}
