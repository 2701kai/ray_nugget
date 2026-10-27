import * as SQLite from 'expo-sqlite';
import { checkRevision, reduceDraft, type Draft } from '../domain/draft';
import { defaultPreferences, type DraftRepository, type Preferences } from './types';
import { newJob, processingRepository, type ProcessingJob, type JobTransaction } from '../processing/jobs';

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
  `);
  await db.withExclusiveTransactionAsync(async tx => {
    const version = (await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
    if (version > 2) throw new Error('This database needs a newer version of Pete.');
    await tx.execAsync(`CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, draftId TEXT NOT NULL REFERENCES drafts(id), kind TEXT NOT NULL, readyAt INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS jobs_due ON jobs(kind, readyAt);`);
    if (version < 2) {
      for (const row of await tx.getAllAsync<{ json: string }>('SELECT json FROM drafts')) {
        const draft: Draft = JSON.parse(row.json);
        for (const attachment of draft.attachments) {
          const job = newJob(draft.id, attachment);
          await tx.runAsync('INSERT OR IGNORE INTO jobs VALUES (?, ?, ?, ?, ?)', job.id, job.draftId, job.kind, job.readyAt, JSON.stringify(job));
        }
      }
      await tx.execAsync('PRAGMA user_version = 2;');
    }
  });
  const processing = processingRepository({
    async list() { return (await db.getAllAsync<{ json: string }>('SELECT json FROM jobs')).map(row => JSON.parse(row.json) as ProcessingJob); },
    async atomic(run) {
      let result: Awaited<ReturnType<typeof run>> | undefined;
      await db.withExclusiveTransactionAsync(async tx => {
        const adapter: JobTransaction = {
          async job(id) { const row = await tx.getFirstAsync<{ json: string }>('SELECT json FROM jobs WHERE id = ?', id); return row ? JSON.parse(row.json) : undefined; },
          async putJob(job) { await tx.runAsync('INSERT OR REPLACE INTO jobs VALUES (?, ?, ?, ?, ?)', job.id, job.draftId, job.kind, job.readyAt, JSON.stringify(job)); },
          async draft(id) { const row = await tx.getFirstAsync<{ json: string }>('SELECT json FROM drafts WHERE id = ?', id); return row ? JSON.parse(row.json) : undefined; },
          async putDraft(draft) { await tx.runAsync('UPDATE drafts SET updatedAt = ?, json = ? WHERE id = ?', draft.updatedAt, JSON.stringify(draft), draft.id); },
          async next(kinds, now) {
            if (!kinds.length) return undefined;
            const row = await tx.getFirstAsync<{ json: string }>(`SELECT json FROM jobs WHERE kind IN (${kinds.map(() => '?').join(',')}) AND readyAt <= ? ORDER BY readyAt, id LIMIT 1`, ...kinds, now);
            return row ? JSON.parse(row.json) : undefined;
          },
        };
        result = await run(adapter);
      });
      return result as Awaited<ReturnType<typeof run>>;
    },
  });
  return {
    ...processing,
    async list() { return (await db.getAllAsync<{ json: string }>('SELECT json FROM drafts ORDER BY updatedAt DESC')).map(row => JSON.parse(row.json) as Draft); },
    async create(draft, activate = false) {
      await db.withExclusiveTransactionAsync(async tx => {
        await tx.runAsync('INSERT INTO drafts VALUES (?, ?, ?)', draft.id, draft.updatedAt, JSON.stringify(draft));
        if (activate) await tx.runAsync('INSERT OR REPLACE INTO settings VALUES (?, ?)', 'active-draft', JSON.stringify({ activeDraftId: draft.id }));
      });
    },
    async activeDraft() { const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM settings WHERE id = ?', 'active-draft'); return row ? JSON.parse(row.json).activeDraftId as string | undefined : undefined; },
    async activateDraft(id) {
      await db.withExclusiveTransactionAsync(async tx => {
        if (id && !(await tx.getFirstAsync('SELECT id FROM drafts WHERE id = ?', id))) throw new Error('This visitor draft no longer exists.');
        await tx.runAsync('INSERT OR REPLACE INTO settings VALUES (?, ?)', 'active-draft', JSON.stringify({ activeDraftId: id }));
      });
    },
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
            const job = newJob(id, action.attachment);
            await tx.runAsync('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)', job.id, job.draftId, job.kind, job.readyAt, JSON.stringify(job));
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
