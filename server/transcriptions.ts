import { Database } from 'bun:sqlite';
import { CloudError, transcriptOf, type SpeechCloud } from './google-speech';

export type Transcription = { id: string; state: 'uploading' | 'submitting' | 'submitted' | 'complete' | 'failed' | 'uncertain'; objectName: string; operation?: string; text?: string; error?: string; updatedAt: number; cleanupPending?: boolean };

export function transcriptions(db: Database, cloud: SpeechCloud) {
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS transcriptions (id TEXT PRIMARY KEY, json TEXT NOT NULL);');
  const get = (id: string) => {
    const row = db.query<{ json: string }, [string]>('SELECT json FROM transcriptions WHERE id=?').get(id);
    return row ? JSON.parse(row.json) as Transcription : undefined;
  };
  const list = () => db.query<{ json: string }, []>('SELECT json FROM transcriptions').all().map(row => JSON.parse(row.json) as Transcription);
  const put = (job: Transcription) => db.query('INSERT OR REPLACE INTO transcriptions VALUES (?, ?)').run(job.id, JSON.stringify({ ...job, updatedAt: Date.now() }));
  const active = new Set<string>();
  for (const job of list()) {
    if (job.state === 'uploading') put({ ...job, state: 'failed', error: 'The gateway restarted during upload. Retry this recording.' });
    if (job.state === 'submitting') put({ ...job, state: 'uncertain', error: 'The gateway restarted while submitting to Google. Check the operation before resubmitting.' });
  }
  async function cleanup(job: Transcription) {
    try { await cloud.remove(job.objectName); put({ ...get(job.id)!, cleanupPending: false }); }
    catch { /* Retry on the next maintenance pass; bucket lifecycle is the fallback. */ }
  }
  async function poll(id: string) {
    const job = get(id);
    if (!job || active.has(id)) return;
    active.add(id);
    try {
      if (job.cleanupPending && ['complete', 'failed'].includes(job.state)) await cleanup(job);
      else if (job.state === 'submitted' && job.operation) {
        const operation = await cloud.operation(job.operation);
        if (operation.done) {
          try { put({ ...job, state: 'complete', text: transcriptOf(operation), error: undefined, cleanupPending: true }); }
          catch (error) { put({ ...job, state: 'failed', error: error instanceof Error ? error.message : 'Transcription failed.', cleanupPending: true }); }
          await cleanup(get(id)!);
        }
      }
    } finally { active.delete(id); }
  }
  function submit(id: string, bytes: Uint8Array, mimeType: string, retry = false) {
    const existing = get(id);
    if ((existing && !(existing.state === 'failed' && retry)) || active.has(id)) return existing;
    if (list().filter(job => ['uploading', 'submitting', 'submitted'].includes(job.state)).length >= 2) throw new Error('The transcription gateway is busy. Please retry shortly.');
    const job: Transcription = { id, state: 'uploading', objectName: `pete/${id}.audio`, updatedAt: Date.now() };
    put(job); active.add(id);
    void (async () => {
      try {
        await cloud.upload(job.objectName, bytes, mimeType);
        put({ ...job, state: 'submitting' });
        const operation = await cloud.submit(job.objectName);
        put({ ...job, state: 'submitted', operation });
      } catch (error) {
        const submitting = get(id)?.state === 'submitting';
        const uncertain = submitting && (!(error instanceof CloudError) || !error.definitive);
        put({ ...job, state: uncertain ? 'uncertain' : 'failed', error: error instanceof Error ? error.message : 'Transcription request failed.', cleanupPending: !uncertain });
      } finally { active.delete(id); }
    })();
    return job;
  }
  async function maintain() { for (const job of list()) await poll(job.id).catch(() => undefined); }
  return { get, submit, poll, maintain };
}
