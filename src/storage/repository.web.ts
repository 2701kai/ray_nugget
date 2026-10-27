import { openDB, type DBSchema } from 'idb';
import { checkRevision, reduceDraft, type Draft } from '../domain/draft';
import { defaultPreferences, type DraftRepository, type Preferences } from './types';
import { newJob, processingRepository, type ProcessingJob, type JobTransaction } from '../processing/jobs';
import { assertBackupSize, restoredSnapshot, type BackupSnapshot } from '../backup/archive';

interface PeteDatabase extends DBSchema {
  drafts: { key: string; value: Draft };
  media: { key: string; value: Uint8Array };
  settings: { key: string; value: Preferences | { activeDraftId?: string } };
  jobs: { key: string; value: ProcessingJob; indexes: { due: [string, number] } };
}

// Keep the initial storage key so the Pete rename preserves existing local drafts.
export async function openRepository(name = 'ray-nugget-v1'): Promise<DraftRepository> {
  const db = await openDB<PeteDatabase>(name, 2, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('drafts', { keyPath: 'id' });
        db.createObjectStore('media');
        db.createObjectStore('settings');
      }
      const jobs = db.createObjectStore('jobs', { keyPath: 'id' });
      jobs.createIndex('due', ['kind', 'readyAt']);
      let cursor = await tx.objectStore('drafts').openCursor();
      while (cursor) {
        for (const attachment of cursor.value.attachments) await jobs.add(newJob(cursor.value.id, attachment));
        cursor = await cursor.continue();
      }
    },
    blocking() { db.close(); },
  });
  let scanDueJobs = false;
  const processing = processingRepository({
    list: () => db.getAll('jobs'),
    async atomic(run) {
      for (;;) {
        const useScan = scanDueJobs;
        const tx = db.transaction(['drafts', 'jobs'], 'readwrite');
        void tx.done.catch(() => undefined);
        const jobs = tx.objectStore('jobs');
        const adapter: JobTransaction = {
          job: id => jobs.get(id), putJob: async job => { await jobs.put(job); },
          draft: id => tx.objectStore('drafts').get(id), putDraft: async draft => { await tx.objectStore('drafts').put(draft); },
          async next(kinds, now) {
            if (useScan) {
              // WebKit can report a missing backing transaction from index.get.
              // Keep the claim atomic using a fresh transaction and store cursor;
              // only affected connections pay for this slower compatibility path.
              let next: ProcessingJob | undefined;
              let cursor = await jobs.openCursor();
              while (cursor) {
                const job = cursor.value;
                if (kinds.includes(job.kind) && job.readyAt <= now && (!next || job.readyAt < next.readyAt)) next = job;
                cursor = await cursor.continue();
              }
              return next;
            }
            const candidates = (await Promise.all(kinds.map(kind => jobs.index('due').get(IDBKeyRange.bound([kind, 0], [kind, now]))))).filter((job): job is ProcessingJob => !!job);
            return candidates.sort((a, b) => a.readyAt - b.readyAt)[0];
          },
        };
        try { const result = await run(adapter); await tx.done; return result; }
        catch (error) {
          try { tx.abort(); } catch {} await tx.done.catch(() => undefined);
          if (!useScan && error instanceof Error && error.name === 'UnknownError' && /get an index record.*without an in-progress transaction/i.test(error.message)) {
            scanDueJobs = true;
            continue; // The failed transaction is fully rolled back before retry.
          }
          throw error;
        }
      }
    },
  });
  return {
    ...processing,
    async list() { return (await db.getAll('drafts')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async create(draft, activate = false) {
      const tx = db.transaction(['drafts', 'settings'], 'readwrite');
      await tx.objectStore('drafts').add(draft);
      if (activate) await tx.objectStore('settings').put({ activeDraftId: draft.id }, 'active-draft');
      await tx.done;
    },
    async activeDraft() { const value = await db.get('settings', 'active-draft'); return value && 'activeDraftId' in value ? value.activeDraftId : undefined; },
    async activateDraft(id) {
      const tx = db.transaction(['drafts', 'settings'], 'readwrite');
      if (id && !(await tx.objectStore('drafts').get(id))) { await tx.done; throw new Error('This visitor draft no longer exists.'); }
      await tx.objectStore('settings').put({ activeDraftId: id }, 'active-draft'); await tx.done;
    },
    async update(id, action, expectedRevision, media) {
      const tx = db.transaction(['drafts', 'media', 'jobs'], 'readwrite');
      try {
        const current = await tx.objectStore('drafts').get(id);
        checkRevision(current, expectedRevision);
        const next = reduceDraft(current, action, new Date().toISOString());
        if (next !== current) {
          if (action.type === 'attach') {
            if (!media || media.byteLength !== action.attachment.bytes) throw new Error('The complete file could not be saved. Please try again.');
            await tx.objectStore('media').add(media, `${id}:${action.attachment.id}`);
            await tx.objectStore('jobs').add(newJob(id, action.attachment));
          }
          await tx.objectStore('drafts').put(next);
        }
        await tx.done;
        return next;
      } catch (error) {
        try { tx.abort(); } catch { /* Transaction may already have aborted. */ }
        await tx.done.catch(() => undefined);
        throw error;
      }
    },
    media: (draftId, attachmentId) => db.get('media', `${draftId}:${attachmentId}`),
    async snapshot(id) {
      const tx = db.transaction(['drafts', 'media', 'jobs'], 'readonly');
      try {
        const draft = await tx.objectStore('drafts').get(id); checkRevision(draft);
        assertBackupSize(draft);
        const media: BackupSnapshot['media'] = [];
        const jobs: ProcessingJob[] = [];
        for (const attachment of draft.attachments) {
          const bytes = await tx.objectStore('media').get(`${id}:${attachment.id}`);
          const job = await tx.objectStore('jobs').get(`${id}/${attachment.id}`);
          if (!bytes || !job) throw new Error('An original file or its source record is missing. Backup was not created.');
          media.push({ attachmentId: attachment.id, bytes }); jobs.push(job);
        }
        await tx.done; return { draft, media, jobs };
      } catch (error) { try { tx.abort(); } catch {} await tx.done.catch(() => undefined); throw error; }
    },
    async restore(backup) {
      const { draft, media, jobs } = restoredSnapshot(backup);
      const tx = db.transaction(['drafts', 'media', 'jobs', 'settings'], 'readwrite');
      // A failed request can reject tx.done before the request's own rejection is
      // observed. Handle it immediately; the catch below still reports failure.
      void tx.done.catch(() => undefined);
      try {
        const existing = await tx.objectStore('drafts').get(draft.id);
        if (!existing) {
          await tx.objectStore('drafts').add(draft);
          // Copy the view so IndexedDB does not serialize the entire archive's
          // backing buffer once for every attachment.
          for (const original of media) await tx.objectStore('media').add(original.bytes.slice(), `${draft.id}:${original.attachmentId}`);
          for (const job of jobs) await tx.objectStore('jobs').add(job);
        }
        await tx.objectStore('settings').put({ activeDraftId: draft.id }, 'active-draft');
        await tx.done; return { draft: existing ?? draft, created: !existing };
      } catch (error) { try { tx.abort(); } catch {} await tx.done.catch(() => undefined); throw error; }
    },
    async preferences() { return (await db.get('settings', 'preferences')) as Preferences ?? structuredClone(defaultPreferences); },
    async savePreferences(value) { await db.put('settings', value, 'preferences'); },
    async close() { db.close(); },
  };
}
