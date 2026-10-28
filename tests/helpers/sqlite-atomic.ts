import { Database } from 'bun:sqlite';
import type { AtomicStore, RecordValue } from '../../server/hosted-store';

/** Durable isolated test store. Production uses the existing Firestore adapter. */
export function sqliteAtomic(path = ':memory:') {
  const db = new Database(path);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const read = db.query<{ value: string }, [string]>('SELECT value FROM records WHERE key = ?');
  const write = db.query('INSERT INTO records (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const store: AtomicStore = {
    async read<T>(key: string) { const row = read.get(key); return row ? JSON.parse(row.value) as T : undefined; },
    async atomic(keys, run) {
      return db.transaction(() => {
        const rows = Object.fromEntries(keys.map(key => { const row = read.get(key); return [key, row ? JSON.parse(row.value) : undefined]; }));
        const { result, writes } = run(rows);
        for (const [key, value] of Object.entries(writes ?? {})) write.run(key, JSON.stringify(value));
        return result;
      })();
    },
  };
  return { db, store, close: () => db.close(),
    entries: () => db.query<{ key: string; value: string }, []>('SELECT key, value FROM records ORDER BY key').all().map(row => [row.key, JSON.parse(row.value)] as [string, RecordValue]),
  };
}
