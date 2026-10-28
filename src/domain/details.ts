import { requestTextKeys, parseCaptureContext, type CaptureContext } from './requirements';
import type { Contact, Request, RequestReview } from './draft';

export const DETAILS_VERSION = 'pete-details-v1';
export function detailsSource(kind: 'card' | 'voice', text: string, context?: CaptureContext) {
  return context ? `pete-details-v2\n${kind}\n${text}\n${JSON.stringify(parseCaptureContext(context))}` : `${DETAILS_VERSION}\n${kind}\n${text}`;
}
export const detailKeys = ['contact.name', 'contact.company', 'contact.email', 'contact.phone', 'request.intent', ...requestTextKeys.map(k => `request.${k}` as const), 'request.throughput', 'request.unit'] as const;
export type DetailKey = typeof detailKeys[number];
export type CapturedDetails = { fields: Partial<Contact>; request?: RequestReview; evidence?: Partial<Record<DetailKey, string>>; questions?: string[] };

export function requestFields(request: RequestReview): Partial<Request> {
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !['intent', ...requestTextKeys, 'capacity'].includes(key))) throw new Error('Invalid captured request.');
  const { capacity, ...details } = request;
  if (details.intent !== undefined && !['buy', 'sell', 'unspecified'].includes(details.intent)) throw new Error('Invalid request intent.');
  if (capacity !== undefined && (!capacity || typeof capacity !== 'object' || Array.isArray(capacity) || Object.keys(capacity).some(key => !['throughput', 'unit'].includes(key)) || typeof capacity.throughput !== 'string' || capacity.throughput.length > 2000 || !/^\d+(?:[.,]\d+)?$/.test(capacity.throughput.trim()) || !Number.isFinite(Number(capacity.throughput.replace(',', '.'))) || Number(capacity.throughput.replace(',', '.')) <= 0 || !['units/h', 'bottles/h', 'L/h'].includes(capacity.unit))) throw new Error('Use a positive throughput and select its unit.');
  const fields = { ...details, ...(capacity ? { throughput: capacity.throughput, unit: capacity.unit } : {}) };
  for (const value of Object.values(fields)) if (typeof value !== 'string' || value.length > 2000) throw new Error('Invalid captured request field.');
  return fields;
}

function sourcePhone(evidence: string, value: string) {
  const source = evidence.replace(/\bplus\s+/gi, '+').replace(/\bdouble zero\s+/gi, '00');
  return [...source.matchAll(/(?:\+|00)\d[\d ().-]{5,}\d/g)].some(match => match[0].replace(/^00/, '+').replace(/[ ().-]/g, '') === value);
}
const unknownAnswer = /\b(?:do not know|don't know|unknown|not known|not sure|not decided|weiß nicht|wissen (?:wir )?nicht|noch (?:nicht bekannt|offen)|unbekannt)\b/iu;
const normalized = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
export function parseCapturedDetails(raw: unknown, text: string, kind: 'card' | 'voice'): CapturedDetails {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid detail extraction.');
  const data = raw as { candidates?: unknown; questions?: unknown };
  if (!Array.isArray(data.candidates) || data.candidates.length > 32 || !Array.isArray(data.questions) || data.questions.length > 6) throw new Error('Invalid detail extraction.');
  const questions = data.questions.flatMap(item => {
    if (!item || typeof item !== 'object') throw new Error('Invalid clarification.');
    const { question, evidence } = item as { question: string; evidence: string };
    if (typeof question !== 'string' || question.length > 300 || typeof evidence !== 'string' || evidence.length > 1000) throw new Error('Invalid clarification.');
    // Missing/ungrounded questions do not invalidate otherwise usable source
    // facts. An explicit unknown is a valid answer to defer, not a form error.
    if (!evidence.trim() || !normalized(text).includes(normalized(evidence)) || unknownAnswer.test(evidence)) return [];
    return [question];
  });
  const candidates = new Map<DetailKey, { value: string; evidence: string }>();
  const conflicted = new Set<DetailKey>();
  for (const item of data.candidates) {
    if (!item || typeof item !== 'object') throw new Error('Invalid captured field.');
    let { field, value, evidence, uncertain } = item as { field: DetailKey; value: string; evidence: string; uncertain: boolean };
    if (!detailKeys.includes(field) || typeof value !== 'string' || !value.trim() || value.length > 2000 || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 1000 || typeof uncertain !== 'boolean') throw new Error('Invalid captured field.');
    if (!normalized(text).includes(normalized(evidence))) throw new Error('Captured detail has no matching source.');
    if (kind === 'card' && field.startsWith('request.')) continue;
    if (unknownAnswer.test(evidence)) continue;
    if (uncertain || (candidates.has(field) && candidates.get(field)!.value !== value.trim())) { conflicted.add(field); continue; }
    if (['contact.name', 'contact.company', ...requestTextKeys.map(k => `request.${k}`)].includes(field) && !normalized(evidence).includes(normalized(value))) { conflicted.add(field); continue; }
    if (field === 'contact.email' && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || !normalized(evidence).replace(/\s+(?:at|ät|klammeraffe)\s+/g, '@').replace(/\s+(?:dot|punkt)\s+/g, '.').replace(/\s/g, '').includes(value.toLowerCase()))) { conflicted.add(field); continue; }
    if (field === 'contact.phone') value = value.trim().replace(/^00/, '+').replace(/[ ().-]/g, '');
    if (field === 'contact.phone' && (!/^\+[1-9]\d{6,14}$/.test(value) || !sourcePhone(evidence, value))) { conflicted.add(field); continue; }
    if (field === 'request.intent' && !['buy', 'sell'].includes(value)) { conflicted.add(field); continue; }
    if (field === 'request.unit' && !['units/h', 'bottles/h', 'L/h'].includes(value)) { conflicted.add(field); continue; }
    if ((field === 'request.throughput' || field === 'request.unit') && /\b(?:about|around|approximately|maybe|between|mindestens|höchstens|ungefähr|etwa|zwischen|bis|vielleicht)\b|\d\s*[-–—]\s*\d/i.test(evidence)) { conflicted.add(field); continue; }
    candidates.set(field, { value: value.trim(), evidence });
  }
  for (const field of conflicted) candidates.delete(field);
  if (conflicted.size) questions.push('Some details are unclear. Add a short voice note to clarify them.');
  const result: CapturedDetails = { fields: {}, evidence: {}, questions: [...new Set(questions)].slice(0, 6) };
  const request: RequestReview = {};
  for (const [key, candidate] of candidates) {
    if (key.startsWith('contact.')) { result.fields[key.slice(8) as keyof Contact] = candidate.value; result.evidence![key] = candidate.evidence; }
    else if (['request.intent', ...requestTextKeys.map(k => `request.${k}`)].includes(key)) { Object.assign(request, { [key.slice(8)]: candidate.value }); result.evidence![key] = candidate.evidence; }
  }
  const throughput = candidates.get('request.throughput'); const unit = candidates.get('request.unit');
  if (throughput && unit) {
    try {
      const capacity = { throughput: throughput.value, unit: unit.value as Request['unit'] };
      requestFields({ capacity }); request.capacity = capacity;
      result.evidence!['request.throughput'] = throughput.evidence; result.evidence!['request.unit'] = unit.evidence;
    } catch { result.questions!.push('Please say the required throughput and its unit again.'); }
  }
  if (Object.keys(request).length) result.request = request;
  result.questions = result.questions!.filter(Boolean).slice(0, 6);
  return result;
}
