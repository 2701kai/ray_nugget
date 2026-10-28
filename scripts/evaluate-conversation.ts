// Explicit live evaluation, synthetic text only. Uses the configured company ADC.
import { googleClient } from './google-client';
import { googleDetails } from '../server/details';
import { parseCapturedDetails } from '../src/domain/details';
import { sameRequirement, type CaptureContext } from '../src/domain/requirements';
const model = googleDetails('bevmaq-platform', 'gemini-3.1-flash-lite', await googleClient('bevmaq-platform'));
const context: CaptureContext = { version: 1, request: { product: 'fruit juice', packaging: 'glass bottles', containerSize: '0.5 L', throughput: '18000', unit: 'bottles/h' }, questions: ['Which filling process?', 'Does the juice contain particles?', 'Which closure?'] };
const cases = [
  { name: 'process properties and closure', text: 'Cold fill with downstream pasteurization, containing particles. Schraubverschluss.', context, expected: { fillingProcess: 'Cold fill with downstream pasteurization', productProperties: 'containing particles', closure: 'Schraubverschluss' }, absent: ['product', 'packaging', 'throughput', 'name'] },
  { name: 'short answer with question context', text: 'Screw caps.', context: { ...context, questions: ['Which closure will the bottles use?'] }, expected: { closure: 'Screw caps' }, absent: ['product', 'packaging', 'name'] },
  { name: 'equivalent German product', text: 'Ja, Fruchtsaft.', context, expected: {}, equivalent: ['product'], absent: ['packaging', 'name'] },
  { name: 'unknown technical detail', text: 'We do not know the particle size yet.', context, expected: {}, absent: ['product', 'packaging', 'productProperties', 'name'] },
  { name: 'explicit changed capacity', text: 'Correction: we now need 22000 bottles per hour.', context, expected: { throughput: '22000', unit: 'bottles/h' }, absent: ['product', 'packaging', 'name'] },
  { name: 'technical refinements preserve earlier facts', text: 'The maximum particle size is 2 mm. The screw cap is aluminum, 28 mm. The pasteurizer is already installed.', context: { ...context, request: { ...context.request, closure: 'screw cap', productProperties: 'particles', fillingProcess: 'cold fill' } }, expected: { particleSize: '2 mm', closureMaterial: 'aluminum', closureSize: '28 mm', downstreamEquipment: 'pasteurizer is already installed' }, absent: ['product', 'packaging', 'closure', 'productProperties'] },
  { name: 'scope brand and timing', text: 'Only a filler, not the whole line. Krones preferred. Delivery next summer.', context, expected: { equipmentScope: 'filler', brandPreference: 'Krones', timing: 'next summer' }, absent: ['product', 'packaging', 'name'] },
] as const;
let failures = 0;
for (const c of cases.filter(c => !process.argv.slice(2).length || process.argv.slice(2).includes(c.name))) {
  const start = Date.now();
  try {
    const result = parseCapturedDetails(await model.extract(c.text, 'voice', c.context as CaptureContext), c.text, 'voice');
    const fields: Record<string, unknown> = { ...result.fields, ...result.request, ...result.request?.capacity };
    const errors: string[] = [];
    for (const [key, expected] of Object.entries(c.expected)) if (!String(fields[key] ?? '').toLowerCase().replace(/\.$/, '').includes(expected.toLowerCase())) errors.push(`${key}: expected ${expected}, got ${fields[key]}`);
    for (const key of c.absent) if (fields[key] !== undefined) errors.push(`${key} should be absent`);
    if ('equivalent' in c) for (const key of c.equivalent) if (fields[key] !== undefined && !sameRequirement(String(fields[key]), c.context.request[key as keyof typeof c.context.request])) errors.push(`${key} would conflict with the established fact`);
    if (result.questions?.length) errors.push('No clarification modal should be needed');
    if (errors.length) failures++;
    console.log(JSON.stringify({ case: c.name, passed: !errors.length, errors, milliseconds: Date.now() - start, result }));
  } catch (e) { failures++; console.log(JSON.stringify({ case: c.name, passed: false, error: e instanceof Error ? e.message : 'failed', providerError: (e as { response?: { data?: unknown } })?.response?.data })); }
}
if (failures) process.exitCode = 1;
