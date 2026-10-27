import { openDB, type DBSchema } from 'idb';
import { checkRevision, reduceDraft, type Draft } from '../domain/draft';
import { defaultPreferences, type DraftRepository, type Preferences } from './types';

interface PeteDatabase extends DBSchema {
  drafts: { key: string; value: Draft };
  media: { key: string; value: Uint8Array };
  settings: { key: string; value: Preferences };
}

// Keep the initial storage key so the Pete rename preserves existing local drafts.
export async function openRepository(name = 'ray-nugget-v1'): Promise<DraftRepository> {
  const db = await openDB<PeteDatabase>(name, 1, {
    upgrade(db) {
      db.createObjectStore('drafts', { keyPath: 'id' });
      db.createObjectStore('media');
      db.createObjectStore('settings');
    },
    blocking() { db.close(); },
  });
  return {
    async list() { return (await db.getAll('drafts')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async create(draft) { await db.add('drafts', draft); },
    async update(id, action, expectedRevision, media) {
      const tx = db.transaction(['drafts', 'media'], 'readwrite');
      try {
        const current = await tx.objectStore('drafts').get(id);
        checkRevision(current, expectedRevision);
        const next = reduceDraft(current, action, new Date().toISOString());
        if (next !== current) {
          if (action.type === 'attach') {
            if (!media || media.byteLength !== action.attachment.bytes) throw new Error('The complete file could not be saved. Please try again.');
            await tx.objectStore('media').add(media, `${id}:${action.attachment.id}`);
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
