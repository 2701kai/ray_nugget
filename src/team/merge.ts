import { decodeManifest, encodeManifest } from '../backup/archive';
import type { Draft } from '../domain/draft';
const text = (x: unknown) => JSON.stringify(x);
const parse = (value: string) => decodeManifest(new TextEncoder().encode(value));
export const manifestText = (snapshot: Parameters<typeof encodeManifest>[0]) => new TextDecoder().decode(encodeManifest(snapshot));

// Three-way merge by source identity. Never resolve conflicting customer values
// by timestamp. Capacity and its unit are one decision; source evidence travels
// with each selected field. Arrays are append-only in the capture domain.
export function mergeTeam(baseText: string | undefined, localText: string, remoteText: string, choices: Record<string, 'local' | 'team'> = {}) {
  const local = parse(localText), remote = parse(remoteText);
  const base = baseText ? parse(baseText) : { draft: { ...local.draft, attachments: [], entries: [] }, jobs: [] };
  if (base.draft.id !== local.draft.id || base.draft.id !== remote.draft.id) throw new Error('The visitor association does not match.');
  const conflicts: string[] = [];
  function pick<T>(key: string, b: T, l: T, r: T): T {
    if (text(l) === text(r) || (baseText && text(r) === text(b))) return l;
    if (baseText && text(l) === text(b)) return r;
    if (choices[key]) return choices[key] === 'local' ? l : r;
    conflicts.push(key); return l;
  }
  const draft: Draft = structuredClone(local.draft);
  for (const section of ['contact', 'request'] as const) {
    for (const field of Object.keys(draft[section])) {
      if (field === 'unit') continue;
      const keys = field === 'throughput' ? ['throughput', 'unit'] : [field];
      const key = `${section}.${field}`;
      const values = (d: Draft) => keys.map(k => (d[section] as Record<string, string>)[k]);
      const selected = pick(key, values(base.draft), values(local.draft), values(remote.draft));
      const source = text(selected) === text(values(local.draft)) ? local.draft : remote.draft;
      for (const k of keys) {
        (draft[section] as Record<string, string>)[k] = (source[section] as Record<string, string>)[k];
        const p = `${section}.${k}`; delete draft.provenance[p];
        if (source.provenance[p]) draft.provenance[p] = source.provenance[p];
      }
    }
  }
  draft.note = pick('note', base.draft.note, local.draft.note, remote.draft.note);
  delete draft.provenance.note;
  const noteSource = draft.note === local.draft.note ? local.draft : remote.draft;
  if (noteSource.provenance.note) draft.provenance.note = noteSource.provenance.note;
  draft.event = pick('event', base.draft.event, local.draft.event, remote.draft.event);
  function union<T>(b: T[], l: T[], r: T[], id: (value: T) => string, prefix: string) {
    const all = new Map<string, T>();
    for (const v of r) all.set(id(v), v);
    for (const v of l) {
      const other = all.get(id(v));
      all.set(id(v), other === undefined ? v : pick(`${prefix}.${id(v)}`, b.find(x => id(x) === id(v)), v, other)!);
    }
    return [...all.values()];
  }
  draft.attachments = union(base.draft.attachments, local.draft.attachments, remote.draft.attachments, x => x.id, 'source');
  draft.entries = union(base.draft.entries ?? [], local.draft.entries ?? [], remote.draft.entries ?? [], x => x.id, 'entry');
  draft.appliedJobs = [...new Set([...local.draft.appliedJobs, ...remote.draft.appliedJobs])];
  draft.suggestions = [...new Map([...local.draft.suggestions, ...remote.draft.suggestions].map(x => [text(x), x])).values()];
  // Follow-up drafts belong to a sender; never claim a merged preview is ready.
  if (draft.followup) draft.followup.state = 'outdated';
  const jobs = union(base.jobs, local.jobs, remote.jobs, x => x.id, 'job').map(job => {
    const l = local.jobs.find(x => x.id === job.id), r = remote.jobs.find(x => x.id === job.id);
    // A complete source result supersedes a portable, paused pending job.
    if (l?.state === 'complete' && r?.state !== 'complete') return l;
    if (r?.state === 'complete' && l?.state !== 'complete') return r;
    return job;
  });
  const jobConflicts = conflicts.filter(k => k.startsWith('job.'));
  for (const k of jobConflicts) {
    const id = k.slice(4), l = local.jobs.find(x => x.id === id), r = remote.jobs.find(x => x.id === id);
    if (l?.state !== r?.state || (text(l?.result) === text(r?.result) && l?.reviewedAt === r?.reviewedAt)) conflicts.splice(conflicts.indexOf(k), 1);
  }
  draft.revision = Math.max(local.draft.revision, remote.draft.revision) + 1;
  draft.updatedAt = new Date().toISOString();
  return { snapshot: { draft, jobs }, conflicts };
}
