import * as SQLite from 'expo-sqlite';
import { checkRevision, reduceDraft, type Draft } from '../domain/draft';
import { defaultPreferences, type DraftRepository, type Preferences } from './types';

// Metro resolves repository.web.ts in the browser. Native metadata and original
// media share one SQLite transaction, so an attachment cannot appear saved alone.
// Keep the initial storage filename so the Pete rename preserves existing local drafts.
export async function openRepository(name = 'ray-nugget-v1.db'): Promise<DraftRepository> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, updatedAt TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS media (draftId TEXT NOT NULL REFERENCES drafts(id), id TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(draftId, id));
    CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    PRAGMA user_version = 1;
  `);
  return {
    async list() { return (await db.getAllAsync<{ json: string }>('SELECT json FROM drafts ORDER BY updatedAt DESC')).map(row => JSON.parse(row.json) as Draft); },
    async create(draft) { await db.runAsync('INSERT INTO drafts VALUES (?, ?, ?)', draft.id, draft.updatedAt, JSON.stringify(draft)); },
    async update(id, action, expectedRevision, media) {
      let result: Draft | undefined;
      await db.withExclusiveTransactionAsync(async tx => {
        const row = await tx.getFirstAsync<{ json: string }>('SELECT json FROM drafts WHERE id = ?', id);
        const current: Draft | undefined = row ? JSON.parse(row.json) : undefined;
        checkRevision(current, expectedRevision);
        const next = reduceDraft(current, action, new Date().toISOString());
        if (next !== current) {
          if (action.type === 'attach') {
            if (!media || media.byteLength !== action.attachment.bytes) throw new Error('The complete file could not be saved. Please try again.');
            await tx.runAsync('INSERT INTO media VALUES (?, ?, ?)', id, action.attachment.id, media);
          }
          await tx.runAsync('UPDATE drafts SET updatedAt = ?, json = ? WHERE id = ?', next.updatedAt, JSON.stringify(next), id);
        }
        result = next;
      });
      if (!result) throw new Error('The draft could not be saved.');
      return result;
    },
    async media(draftId, attachmentId) { return (await db.getFirstAsync<{ bytes: Uint8Array }>('SELECT bytes FROM media WHERE draftId = ? AND id = ?', draftId, attachmentId))?.bytes; },
    async preferences() {
      const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM settings WHERE id = ?', 'preferences');
      return row ? JSON.parse(row.json) as Preferences : { ...defaultPreferences, sender: { ...defaultPreferences.sender } };
    },
    async savePreferences(value) { await db.runAsync('INSERT OR REPLACE INTO settings VALUES (?, ?)', 'preferences', JSON.stringify(value)); },
    async close() { await db.closeAsync(); },
  };
}
