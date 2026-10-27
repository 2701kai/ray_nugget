import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { createDraft, mediaLimit, type Attachment, type CaptureKind, type Draft, type DraftAction } from './domain/draft';
import { openRepository } from './storage/repository';
import { defaultPreferences, type DraftRepository, type Preferences } from './storage/types';
import { readUri } from './media/files';
import { createProcessor, supportedKinds } from './processing/processor';
import { startProcessing } from './processing/runner';
import type { ProcessingJob, ReviewOptions } from './processing/jobs';
import type { Contact } from './domain/draft';
import { storageName } from './session';
import { encodeBackup, type VerifiedBackup } from './backup/archive';
import { digest } from './backup/digest';

export function useWorkspace() {
  const repo = useRef<DraftRepository | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string>();
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const runner = useRef<ReturnType<typeof startProcessing> | null>(null);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [processingError, setProcessingError] = useState('');
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let alive = true;
    let current: DraftRepository | undefined;
    let currentRunner: ReturnType<typeof startProcessing> | undefined;
    setLoading(true); setError(''); setProcessingError('');
    openRepository(storageName()).then(async repository => {
      current = repository;
      const [records, prefs, tasks, selected] = await Promise.all([repository.list(), repository.preferences(), repository.jobs(), repository.activeDraft()]);
      if (!alive) return repository.close();
      repo.current = repository; setDrafts(records); setJobs(tasks); setPreferences(prefs); setActiveDraftId(records.some(d => d.id === selected) ? selected : undefined); setLoading(false);
      currentRunner = startProcessing(repository, createProcessor(), async () => {
        const [tasks, records] = await Promise.all([repository.jobs(), repository.list()]);
        if (alive) {
          setJobs(tasks);
          setDrafts(previous => [...previous.filter(d => !records.some(record => record.id === d.id)), ...records.map(record => {
            const newer = previous.find(d => d.id === record.id);
            return newer && newer.revision > record.revision ? newer : record;
          })].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        }
      }, message => { if (alive) setProcessingError(message ? 'Background processing is paused. You can keep capturing; Pete will retry.' : ''); }, Crypto.randomUUID);
      runner.current = currentRunner;
    }).catch(error => { if (alive) { setError(error instanceof Error ? error.message : 'Local storage is unavailable.'); setLoading(false); } });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && repo.current) Promise.all([repo.current.list(), repo.current.jobs()]).then(([records, tasks]) => {
        if (alive) { setDrafts(previous => records.map(record => { const newer = previous.find(d => d.id === record.id); return newer && newer.revision > record.revision ? newer : record; })); setJobs(tasks); runner.current?.wake(); }
      }).catch(() => { if (alive) setError('Could not refresh local drafts.'); });
    });
    return () => { alive = false; subscription.remove(); repo.current = null; runner.current = null; void (async () => { await currentRunner?.close(); await current?.close(); })(); };
  }, [generation]);

  const repository = () => { if (!repo.current) throw new Error('Local storage is not ready.'); return repo.current; };
  const merge = useCallback((next: Draft) => setDrafts(records => {
    const current = records.find(d => d.id === next.id);
    if (current && current.revision > next.revision) return records;
    return [next, ...records.filter(d => d.id !== next.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }), []);
  async function create(entry: CaptureKind) {
    const draft = createDraft(Crypto.randomUUID(), entry, preferences.event, new Date().toISOString());
    await repository().create(draft, true); merge(draft); setActiveDraftId(draft.id); return draft;
  }
  async function update(id: string, action: DraftAction, revision?: number) {
    const draft = await repository().update(id, action, revision); merge(draft); return draft;
  }
  async function attach(id: string, uri: string, details: Omit<Attachment, 'id' | 'bytes' | 'sha256' | 'capturedAt'>) {
    const { bytes, mimeType } = await readUri(uri);
    if (bytes.byteLength <= 0 || bytes.byteLength > mediaLimit(details.kind)) throw new Error(`Choose a non-empty file smaller than ${mediaLimit(details.kind) / 1024 / 1024} MiB.`);
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes));
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const attachment: Attachment = { ...details, mimeType: mimeType || details.mimeType, id: Crypto.randomUUID(), bytes: bytes.byteLength, sha256, capturedAt: new Date().toISOString() };
    const draft = await repository().update(id, { type: 'attach', attachment }, undefined, bytes); merge(draft);
    setJobs(await repository().jobs()); runner.current?.wake(); return draft;
  }
  async function savePreferences(value: Preferences) { await repository().savePreferences(value); setPreferences(value); }
  async function getMedia(draftId: string, attachmentId: string) { return repository().media(draftId, attachmentId); }
  async function activateDraft(id?: string) { await repository().activateDraft(id); setActiveDraftId(id); }
  async function retryJob(id: string) { await repository().retryJob(id); setJobs(await repository().jobs()); runner.current?.wake(); }
  async function reviewJob(id: string, fields: Partial<Contact>, revision: number, options: ReviewOptions = {}) {
    const draft = await repository().reviewJob(id, fields, revision, options); merge(draft); setJobs(await repository().jobs());
  }
  async function backup(id: string) { return encodeBackup(await repository().snapshot(id), digest); }
  async function restore(backup: VerifiedBackup) {
    const current = repository();
    const result = await current.restore(backup);
    if (repo.current !== current) throw new Error('The signed-in account changed. Reopen Pete to see the restored draft.');
    merge(result.draft); setJobs(await current.jobs()); setActiveDraftId(result.draft.id); return result;
  }
  return { drafts, activeDraftId, activateDraft, jobs, supportedKinds, preferences, loading, error, processingError, retry: () => setGeneration(g => g + 1), create, update, attach, savePreferences, getMedia, retryJob, reviewJob, backup, restore };
}
export type Workspace = ReturnType<typeof useWorkspace>;
