// Optional additions keep existing v1 drafts readable without a destructive migration.
export const qualificationKeys = ['containerSize', 'fillingProcess', 'productProperties', 'closure', 'equipmentScope', 'brandPreference', 'timing', 'particleSize', 'particleConcentration', 'viscosity', 'closureMaterial', 'closureSize', 'neckFinish', 'downstreamEquipment'] as const;
export type QualificationKey = typeof qualificationKeys[number];
export const requestTextKeys = ['product', 'packaging', ...qualificationKeys] as const;
export const requestKeys = ['intent', ...requestTextKeys, 'throughput', 'unit'] as const;
export const requestLabels = {
  product: 'Product to fill', packaging: 'Container / packaging', containerSize: 'Container size',
  fillingProcess: 'Filling process', productProperties: 'Product properties / particles', closure: 'Closure',
  equipmentScope: 'Equipment needed', brandPreference: 'Preferred manufacturer', timing: 'Timing',
  particleSize: 'Particle size', particleConcentration: 'Particle concentration', viscosity: 'Viscosity',
  closureMaterial: 'Closure material', closureSize: 'Closure size', neckFinish: 'Bottle neck finish', downstreamEquipment: 'Downstream equipment',
} as const;

const normalized = (value: string) => value.toLowerCase().trim().replace(/[‐‑–-]/g, ' ').replace(/\s+/g, ' ');
// Deliberately narrow equivalences. Nectar, individual flavors, bottle sizes,
// material changes and qualified requirements must remain distinct.
const equivalents = [
  ['juice', 'juices', 'saft', 'säfte'], ['fruit juice', 'fruit juices', 'fruchtsaft', 'fruchtsäfte'],
  ['glass bottle', 'glass bottles', 'glasflasche', 'glasflaschen'], ['pet bottle', 'pet bottles', 'pet flasche', 'pet flaschen'],
  ['screw cap', 'screw caps', 'schraubverschluss', 'schraubverschlüsse'],
];
export function sameRequirement(a: string | undefined, b: string | undefined) {
  const x = normalized(a ?? ''), y = normalized(b ?? '');
  return x === y || equivalents.some(group => group.includes(x) && group.includes(y));
}

export type CaptureContext = { version: 1; request: Partial<Record<typeof requestKeys[number], string>>; consultationId?: string; questions: string[] };
export function parseCaptureContext(raw: unknown): CaptureContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid capture context.');
  const v = raw as CaptureContext;
  if (v.version !== 1 || !v.request || typeof v.request !== 'object' || Array.isArray(v.request) || !Array.isArray(v.questions) || v.questions.length > 3 || v.questions.some(q => typeof q !== 'string' || !q.trim() || q.length > 500) || (v.consultationId !== undefined && !/^[a-f0-9]{64}$/.test(v.consultationId))) throw new Error('Invalid capture context.');
  if (Object.keys(v.request).some(k => !requestKeys.includes(k as typeof requestKeys[number]))) throw new Error('Invalid capture context.');
  const request: CaptureContext['request'] = {};
  for (const k of requestKeys) if (v.request[k] !== undefined) {
    if (typeof v.request[k] !== 'string' || v.request[k]!.length > 2000) throw new Error('Invalid capture context.');
    request[k] = v.request[k];
  }
  return { version: 1, request, ...(v.consultationId ? { consultationId: v.consultationId } : {}), questions: [...v.questions] };
}

export type QuestionDecision = { id: string; consultationId: string; question: string; deferred: boolean; createdAt: string };
export function parseQuestionDecision(raw: unknown): QuestionDecision {
  const v = raw as QuestionDecision;
  if (!v || typeof v !== 'object' || typeof v.id !== 'string' || typeof v.consultationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(v.id) || !/^[a-f0-9]{64}$/.test(v.consultationId) || typeof v.question !== 'string' || !v.question.trim() || v.question.length > 500 || typeof v.deferred !== 'boolean' || typeof v.createdAt !== 'string' || v.createdAt.length > 40 || !/^\d{4}-\d\d-\d\dT/.test(v.createdAt) || !Number.isFinite(Date.parse(v.createdAt))) throw new Error('Invalid question decision.');
  return { id: v.id, consultationId: v.consultationId, question: v.question, deferred: v.deferred, createdAt: v.createdAt };
}
export function deferredQuestions(decisions: QuestionDecision[] = []) {
  const latest = new Map<string, QuestionDecision>();
  for (const d of [...decisions].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) latest.set(normalized(d.question), d);
  return [...latest.values()].filter(d => d.deferred).map(d => d.question);
}
