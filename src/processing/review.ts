import { requestTextKeys, requestLabels, sameRequirement } from '../domain/requirements';
import type { Contact, Draft, RequestReview } from '../domain/draft';
import type { ProcessingJob } from './jobs';
import { requestCandidates } from './request';

export type ReviewChange = {
  key: `contact.${keyof Contact}` | 'request.intent' | `request.${typeof requestTextKeys[number]}` | 'request.capacity';
  label: string;
  saved: string;
  proposed: string;
  evidence?: string;
  fields?: Partial<Contact>;
  request?: RequestReview;
  superseded: boolean;
};
const contactLabels = { name: 'Name', company: 'Company', email: 'Email', phone: 'Mobile number' };

// Compare a capture to the latest source/human decision, not processing completion
// order: an older recording can finish after a newer correction was accepted.
function newerDecision(draft: Draft, job: ProcessingJob, key: string) {
  const origin = draft.provenance[key];
  if (!origin || origin.jobId === job.id) return false;
  const capturedAt = draft.attachments.find(a => a.id === job.attachmentId)?.capturedAt;
  if (!capturedAt) return false;
  const decisionAt = origin.source === 'manual' ? origin.at : origin.reviewedAt;
  const sourceAt = draft.attachments.find(a => a.id === origin.attachmentId)?.capturedAt;
  return !!((decisionAt && Date.parse(decisionAt) > Date.parse(capturedAt)) || (sourceAt && Date.parse(sourceAt) > Date.parse(capturedAt)));
}

export function reviewChanges(draft: Draft, job: ProcessingJob): ReviewChange[] {
  if (job.draftId !== draft.id || job.state !== 'complete' || !job.result || job.reviewedAt !== undefined || !draft.attachments.some(a => a.id === job.attachmentId && a.kind === job.kind)) return [];
  const result = job.result;
  const changes: ReviewChange[] = [];
  for (const field of Object.keys(contactLabels) as Array<keyof Contact>) {
    const value = result.fields[field];
    if (!value || value === draft.contact[field]) continue;
    const key = `contact.${field}` as const;
    changes.push({ key, label: contactLabels[field], saved: draft.contact[field] || (draft.provenance[key] ? 'Left blank intentionally' : 'Not added yet'), proposed: value, evidence: result.evidence?.[key], fields: { [field]: value }, superseded: newerDecision(draft, job, key) });
  }
  if (job.kind !== 'voice') return changes;
  const legacy = !result.request && !result.evidence ? requestCandidates(result.text) : undefined;
  const request = result.request || { product: legacy?.product?.value, packaging: legacy?.packaging?.value, capacity: legacy?.capacity?.value };
  for (const field of ['intent', ...requestTextKeys] as const) {
    const value = request[field];
    if (!value || sameRequirement(value, draft.request[field])) continue;
    const key = `request.${field}` as const;
    const display = (v: string) => field === 'intent' ? v === 'buy' ? 'Buying' : v === 'sell' ? 'Selling' : 'Still needed' : v;
    changes.push({ key, label: { intent: 'Buying or selling', ...requestLabels }[field], saved: display(draft.request[field] ?? '') || (draft.provenance[key] ? 'Left blank intentionally' : 'Not added yet'), proposed: display(value), evidence: result.evidence?.[key] || (field === 'product' || field === 'packaging' ? legacy?.[field]?.evidence : undefined), request: { [field]: value }, superseded: newerDecision(draft, job, key) });
  }
  const capacity = request.capacity;
  if (capacity && (capacity.throughput !== draft.request.throughput || capacity.unit !== draft.request.unit)) {
    changes.push({ key: 'request.capacity', label: 'Throughput', saved: `${draft.request.throughput} ${draft.request.unit}`.trim() || (draft.provenance['request.throughput'] || draft.provenance['request.unit'] ? 'Left blank intentionally' : 'Not added yet'), proposed: `${capacity.throughput} ${capacity.unit}`, evidence: result.evidence?.['request.throughput'] || legacy?.capacity?.evidence, request: { capacity }, superseded: newerDecision(draft, job, 'request.throughput') || newerDecision(draft, job, 'request.unit') });
  }
  return changes;
}

export function changedDetails(changes: ReviewChange[]) {
  const fields: Partial<Contact> = {};
  const request: RequestReview = {};
  for (const change of changes) {
    if (change.superseded) continue;
    Object.assign(fields, change.fields);
    Object.assign(request, change.request);
  }
  return { fields, request: Object.keys(request).length ? request : undefined };
}
