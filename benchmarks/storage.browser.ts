import { openDB, deleteDB } from 'idb';
import { createDraft, type Attachment } from '../src/domain/draft';
import { NEVER, type ProcessingJob } from '../src/processing/jobs';
import { openRepository } from '../src/storage/repository.web';

// Only bundled by the benchmark command, never by the application.
export async function measureStorage(visitors: number, fallback: boolean, samples: number) {
  const name = `pete-benchmark-${crypto.randomUUID()}`;
  const repo = await openRepository(name);
  const now = new Date().toISOString();
  const seed = await openDB(name);
  try {
    const tx = seed.transaction(['drafts', 'jobs', 'media'], 'readwrite');
    for (let index = 0; index < visitors; index++) {
      const draft = createDraft(`visitor-${index}`, 'contact', 'Synthetic benchmark', now);
      draft.contact.name = `Synthetic visitor ${index}`;
      for (let capture = 0; capture < 2; capture++) {
        const attachment: Attachment = { id: `history-${capture}`, kind: capture ? 'voice' : 'card', name: 'synthetic-history.bin', mimeType: 'application/octet-stream', bytes: 3, sha256: `synthetic-history-${capture}`, capturedAt: now };
        draft.attachments.push(attachment);
        await tx.objectStore('media').put(new Uint8Array([1, 2, capture]), `${draft.id}:${attachment.id}`);
        const job: ProcessingJob = {
          id: `${draft.id}/history-${capture}`, draftId: draft.id, attachmentId: `history-${capture}`,
          kind: capture ? 'voice' : 'card', state: 'complete', attempts: 1,
          readyAt: NEVER, createdAt: Date.now(), updatedAt: Date.now(),
          result: { text: 'Synthetic completed source. '.repeat(80), fields: {}, engine: 'Benchmark fixture' },
        };
        await tx.objectStore('jobs').put(job);
      }
      await tx.objectStore('drafts').put(draft);
    }
    await tx.done;
    if (fallback) {
      const get = IDBIndex.prototype.get;
      IDBIndex.prototype.get = () => { throw new DOMException('Attempt to get an index record from database without an in-progress transaction', 'UnknownError'); };
      try { await repo.claimJob(['card'], 'activate-fallback'); }
      finally { IDBIndex.prototype.get = get; }
    }
    const idle: number[] = [];
    for (let sample = 0; sample < samples; sample++) {
      const start = performance.now();
      await repo.claimJob(['card'], `idle-${sample}`);
      idle.push(performance.now() - start);
    }
    const save: number[] = [];
    const original = new Uint8Array(1024 * 1024);
    for (let sample = 0; sample < samples; sample++) {
      original[0] = sample;
      const start = performance.now();
      // Same hashing, atomic original/metadata/job commit and queue refresh used
      // by useWorkspace.attach. Excludes file picking, image decode and UI paint.
      const digest = await crypto.subtle.digest('SHA-256', original);
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      const attachment: Attachment = { id: `sample-${sample}`, kind: 'card', name: 'synthetic.bin', mimeType: 'application/octet-stream', bytes: original.length, sha256, capturedAt: now };
      // Compete with an idle voice queue lookup as the background runner does.
      const polling = repo.claimJob(['voice'], `poll-${sample}`);
      await repo.update('visitor-0', { type: 'attach', attachment }, undefined, original);
      await repo.jobs();
      save.push(performance.now() - start);
      await polling;
    }
    await repo.close();
    const reopened = await openRepository(name);
    try {
      const drafts = await reopened.list();
      const target = drafts.find(draft => draft.id === 'visitor-0');
      if (target?.attachments.length !== samples + 2) throw new Error('Capture count did not survive reopening.');
      if (drafts.some(draft => draft.id !== 'visitor-0' && draft.attachments.length !== 2)) throw new Error('Capture moved to another visitor.');
      for (let sample = 0; sample < samples; sample++) {
        const bytes = await reopened.media('visitor-0', `sample-${sample}`);
        if (bytes?.length !== original.length || bytes[0] !== sample) throw new Error('Original bytes did not survive reopening.');
        const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
        const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
        if (sha256 !== target.attachments.find(attachment => attachment.id === `sample-${sample}`)?.sha256) throw new Error('Original integrity check failed after reopening.');
      }
    } finally { await reopened.close(); }
    const stats = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { p50: sorted[Math.ceil(sorted.length * 0.5) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1), samples: values };
    };
    return { visitors, historyJobs: visitors * 2, fallback, samples, mediaBytes: original.length, idleMs: stats(idle), saveMs: stats(save), originalsVerified: true };
  } finally { await repo.close(); seed.close(); await deleteDB(name); }
}

Object.assign(window, { peteBenchmark: measureStorage });
