import type { Extraction } from './jobs';

export type SourceEdit = { id: string; text: string; createdAt: string };
export function sourceText(result?: Extraction): string {
  return result?.sourceEdits?.find(e => e.id === result.activeEditId)?.text ?? result?.text ?? '';
}
export function validateSourceEdits(result: Extraction) {
  if (result.sourceEngine !== undefined && (typeof result.sourceEngine !== 'string' || !result.sourceEngine || result.sourceEngine.length > 100)) throw new Error('Invalid source engine.');
  if (result.sourceEdits === undefined && result.activeEditId === undefined) return;
  if (!Array.isArray(result.sourceEdits) || !result.sourceEdits.length || result.sourceEdits.length > 50
    || result.sourceEdits.some(e => !e || typeof e.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(e.id)
      || typeof e.text !== 'string' || !e.text.trim() || e.text.length > 50_000
      || typeof e.createdAt !== 'string' || !Number.isFinite(Date.parse(e.createdAt)))
    || new Set(result.sourceEdits.map(e => e.id)).size !== result.sourceEdits.length
    || !result.sourceEdits.some(e => e.id === result.activeEditId)) throw new Error('Invalid transcript correction.');
}

export function sourceAttribution(result?: Extraction) {
  if (!result) return '';
  // Legacy hosted results retained only the extraction engine. Do not invent
  // the lost transcription/OCR metadata.
  const source = result.sourceEngine ?? (/gemini/i.test(result.engine) ? undefined : result.engine);
  return source ? source : 'Original transcription engine was not retained';
}
