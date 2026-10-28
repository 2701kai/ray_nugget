export type RayInput = {
  version: 1; draftId: string; sourceFingerprint: string; window: number;
  brief: string; omitted: number; pending: number;
};
export type RayMachine = { sku: string; title: string; manufacturer: string; url: string; updated: string };
export type RayAdvice = {
  id: string; draftId: string; sourceFingerprint: string; createdAt: string;
  brief: string; omitted: number; pending: number; text: string;
  questions: string[]; machines: RayMachine[]; selectedSkus: string[];
};
const fail = () => { throw new Error('Invalid Ray result.'); };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max ? v : fail();
const id = (v: unknown) => /^[a-zA-Z0-9_-]{1,128}$/.test(str(v, 128)) ? v as string : fail();
const hash = (v: unknown) => /^[a-f0-9]{64}$/.test(str(v, 64)) ? v as string : fail();
const count = (v: unknown, max = 100000) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : fail();
const list = (v: unknown, max: number) => Array.isArray(v) && v.length <= max ? v : fail();
export function machineUrl(value: unknown): string {
  const text = str(value, 2000); const url = new URL(text);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'bevmaq.com' || url.hostname.endsWith('.bevmaq.com'))) fail();
  return url.href;
}
export function parseRayInput(value: unknown): RayInput {
  const v = obj(value);
  if (v.version !== 1) fail();
  const brief = str(v.brief, 1450); if (!brief.trim()) fail();
  return { version: 1, draftId: id(v.draftId), sourceFingerprint: hash(v.sourceFingerprint), window: count(v.window, Number.MAX_SAFE_INTEGER), brief, omitted: count(v.omitted), pending: count(v.pending, 250) };
}
export const rayInputText = (value: RayInput) => JSON.stringify(parseRayInput(value));
export function parseRayAdvice(value: unknown): RayAdvice {
  const v = obj(value); const createdAt = str(v.createdAt, 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) fail();
  const machines = list(v.machines, 3).map(raw => {
    const m = obj(raw);
    return { sku: id(m.sku), title: str(m.title, 500), manufacturer: str(m.manufacturer, 200), url: machineUrl(m.url), updated: str(m.updated, 80) };
  });
  const selectedSkus = list(v.selectedSkus, 3).map(id);
  if (new Set(machines.map(m => m.sku)).size !== machines.length || new Set(selectedSkus).size !== selectedSkus.length || selectedSkus.some(sku => !machines.some(m => m.sku === sku))) fail();
  return { id: hash(v.id), draftId: id(v.draftId), sourceFingerprint: hash(v.sourceFingerprint), createdAt,
    brief: str(v.brief, 1450), omitted: count(v.omitted), pending: count(v.pending, 250), text: str(v.text, 12000),
    questions: list(v.questions, 3).map(q => str(q, 500)), machines, selectedSkus };
}
