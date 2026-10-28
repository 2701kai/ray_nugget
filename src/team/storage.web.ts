import { openDB } from 'idb';
import type { BackupSnapshot } from '../backup/archive';
import type { Draft } from '../domain/draft';
import type { ProcessingJob } from '../processing/jobs';
import { manifestText } from './merge';
import type { Team, TeamLink } from './types';

export async function openTeamStorage(name: string) {
  // Existing per-account database; no destructive migration or new origin.
  const db = await openDB(name);
  const key = (id: string) => `team-link/${id}`;
  async function read(id: string) {
    const tx = db.transaction(['drafts', 'jobs', 'settings'], 'readonly');
    const draft: Draft | undefined = await tx.objectStore('drafts').get(id);
    const jobs: ProcessingJob[] = draft ? await Promise.all(draft.attachments.map(a => tx.objectStore('jobs').get(`${id}/${a.id}`))) : [];
    const link: TeamLink | undefined = await tx.objectStore('settings').get(key(id));
    await tx.done;
    return { snapshot: draft ? { draft, jobs } : undefined, link };
  }
  return {
    read,
    async links(): Promise<Record<string, TeamLink>> {
      const tx = db.transaction('settings'); const store = tx.objectStore('settings');
      const range = IDBKeyRange.bound('team-link/', 'team-link/\uffff');
      const [keys, values] = await Promise.all([store.getAllKeys(range), store.getAll(range)]); await tx.done;
      return Object.fromEntries(keys.map((k, i) => [String(k).slice(10), values[i]]));
    },
    async teams(): Promise<Team[]> { return (await db.get('settings', 'team-catalog')) ?? []; },
    async catalog(teams: Team[]) { await db.put('settings', teams, 'team-catalog'); },
    async share(id: string, team: Team) {
      const tx = db.transaction(['drafts', 'settings'], 'readwrite');
      const draft: Draft | undefined = await tx.objectStore('drafts').get(id);
      if (!draft) throw new Error('Der Besucher ist nicht mehr vorhanden.');
      const existing: TeamLink | undefined = await tx.objectStore('settings').get(key(id));
      if (existing && existing.teamId !== team.id) throw new Error('Dieser Besucher gehört bereits zu einem Team-Bereich.');
      if (!existing) {
        await tx.objectStore('drafts').put({ ...draft, event: team.name, revision: draft.revision + 1, updatedAt: new Date().toISOString() });
        await tx.objectStore('settings').put({ teamId: team.id }, key(id));
      }
      await tx.done;
    },
    async apply(snapshot: Pick<BackupSnapshot, 'draft' | 'jobs'>, originals: BackupSnapshot['media'], expected: string | null, link: TeamLink) {
      const tx = db.transaction(['drafts', 'media', 'jobs', 'settings'], 'readwrite');
      void tx.done.catch(() => undefined);
      try {
        const current: Draft | undefined = await tx.objectStore('drafts').get(snapshot.draft.id);
        const jobs: ProcessingJob[] = current ? await Promise.all(current.attachments.map(a => tx.objectStore('jobs').get(`${current.id}/${a.id}`))) : [];
        if ((current ? manifestText({ draft: current, jobs }) : null) !== expected) { await tx.done; return false; }
        for (const a of snapshot.draft.attachments) {
          const original = originals.find(m => m.attachmentId === a.id);
          const mediaKey = `${snapshot.draft.id}:${a.id}`;
          if (original) await tx.objectStore('media').put(original.bytes.slice(), mediaKey);
          else if (!(await tx.objectStore('media').get(mediaKey))) throw new Error('Ein Original fehlt. Dein bisheriger Stand bleibt erhalten.');
        }
        await tx.objectStore('drafts').put(snapshot.draft);
        for (const job of snapshot.jobs) {
          const local = jobs.find(j => j.id === job.id);
          // Portable unfinished jobs stay paused on other devices. The source
          // device retains its durable processing lease and pending work.
          await tx.objectStore('jobs').put(local && job.state !== 'complete' ? local : job);
        }
        await tx.objectStore('settings').put(link, key(snapshot.draft.id));
        await tx.done; return true;
      } catch (error) { try { tx.abort(); } catch {} await tx.done.catch(() => undefined); throw error; }
    },
    async acknowledge(id: string, expected: string, link: TeamLink) {
      const { snapshot } = await read(id);
      return snapshot ? this.apply(snapshot, [], expected, link) : false;
    },
    close() { db.close(); },
  };
}
