import { openDB, type DBSchema } from 'idb';
import { checkRevision, reduceDraft, type Draft } from '../domain/draft';
import { defaultPreferences, type DraftRepository, type Preferences } from './types';
import { newJob, processingRepository, type ProcessingJob, type JobTransaction } from '../processing/jobs';

interface PeteDatabase extends DBSchema {
  drafts: { key: string; value: Draft };
  media: { key: string; value: Uint8Array };
  settings: { key: string; value: Preferences };
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
  const processing = processingRepository({
    list: () => db.getAll('jobs'),
    async atomic(run) {
      const tx = db.transaction(['drafts', 'jobs'], 'readwrite');
      const jobs = tx.objectStore('jobs');
      const adapter: JobTransaction = {
        job: id => jobs.get(id), putJob: async job => { await jobs.put(job); },
        draft: id => tx.objectStore('drafts').get(id), putDraft: async draft => { await tx.objectStore('drafts').put(draft); },
        async next(kinds, now) {
          const candidates = (await Promise.all(kinds.map(kind => jobs.index('due').get(IDBKeyRange.bound([kind, 0], [kind, now]))))).filter((job): job is ProcessingJob => !!job);
          return candidates.sort((a, b) => a.readyAt - b.readyAt)[0];
        },
      };
      try { const result = await run(adapter); await tx.done; return result; }
      catch (error) { try { tx.abort(); } catch {} await tx.done.catch(() => undefined); throw error; }
    },
  });
  return {
    ...processing,
    async list() { return (await db.getAll('drafts')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async create(draft) { await db.add('drafts', draft); },
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
    async preferences() { return (await db.get('settings', 'preferences')) ?? structuredClone(defaultPreferences); },
    async savePreferences(value) { await db.put('settings', value, 'preferences'); },
    async close() { db.close(); },
  };
}
