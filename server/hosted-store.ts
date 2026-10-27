import type { Firestore } from 'firebase-admin/firestore';

export type RecordValue = Record<string, unknown>;
export interface AtomicStore {
  read<T>(key: string): Promise<T | undefined>;
  atomic<T>(keys: string[], run: (records: Record<string, RecordValue | undefined>) => { result: T; writes?: Record<string, RecordValue> }): Promise<T>;
}

export function firestoreStore(db: Firestore): AtomicStore {
  return {
    async read<T>(key: string) { const snapshot = await db.doc(key).get(); return snapshot.exists ? snapshot.data() as T : undefined; },
    async atomic(keys, run) {
      return db.runTransaction(async transaction => {
        const snapshots = await transaction.getAll(...keys.map(key => db.doc(key)));
        const records = Object.fromEntries(snapshots.map((snapshot, i) => [keys[i], snapshot.exists ? snapshot.data() : undefined]));
        const { result, writes } = run(records);
        for (const [key, value] of Object.entries(writes ?? {})) transaction.set(db.doc(key), JSON.parse(JSON.stringify(value)));
        return result;
      });
    },
  };
}
