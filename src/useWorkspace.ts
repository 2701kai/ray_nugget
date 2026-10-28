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
import { startTeamSync } from './team/sync';
import { emptyTeamView, type TeamView } from './team/types';
import { startCloudSaving, type CloudStatus } from './cloud/saving';

export function useWorkspace() {
  const editingTeam = useRef(false);
  const [teamView, setTeamView] = useState<TeamView>(emptyTeamView);
  const team = useRef<ReturnType<typeof startTeamSync> | null>(null);
  const repo = useRef<DraftRepository | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string>();
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const runner = useRef<ReturnType<typeof startProcessing> | null>(null);
  const cloud = useRef<ReturnType<typeof startCloudSaving> | null>(null);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudStates, setCloudStates] = useState<Record<string, CloudStatus>>({});
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [processingError, setProcessingError] = useState('');
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let alive = true;
    let current: DraftRepository | undefined;
    let currentRunner: ReturnType<typeof startProcessing> | undefined;
    let currentTeam: ReturnType<typeof startTeamSync> | undefined;
    let currentCloud: ReturnType<typeof startCloudSaving> | undefined;
    setLoading(true); setError(''); setProcessingError('');
    openRepository(storageName()).then(async repository => {
      current = repository;
      const [records, prefs, tasks, selected] = await Promise.all([repository.list(), repository.preferences(), repository.jobs(), repository.activeDraft()]);
      if (!alive) return repository.close();
      repo.current = repository; setDrafts(records); setJobs(tasks); setPreferences(prefs); setActiveDraftId(records.some(d => d.id === selected) ? selected : undefined); setLoading(false);
      currentTeam = startTeamSync(repository, view => { if (alive) setTeamView(view); }, async () => {
        const [records, tasks] = await Promise.all([repository.list(), repository.jobs()]);
        if (alive) { setDrafts(records); setJobs(tasks); cloud.current?.wake(); team.current?.wake(); }
      }, () => !editingTeam.current);
      team.current = currentTeam;
      currentCloud = startCloudSaving(repository, states => { if (alive) setCloudStates(states); });
      cloud.current = currentCloud; setCloudEnabled(currentCloud.enabled);
      currentRunner = startProcessing(repository, createProcessor(), async () => {
        const [tasks, records] = await Promise.all([repository.jobs(), repository.list()]);
        if (alive) {
          setJobs(tasks);
          cloud.current?.wake(); team.current?.wake();
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
    return () => { alive = false; subscription.remove(); currentTeam?.close(); team.current = null; currentCloud?.close(); cloud.current = null; repo.current = null; runner.current = null; void (async () => { await currentRunner?.close(); await current?.close(); })(); };
  }, [generation]);

  const repository = () => { if (!repo.current) throw new Error('Local storage is not ready.'); return repo.current; };
  const merge = useCallback((next: Draft) => setDrafts(records => {
    const current = records.find(d => d.id === next.id);
    if (current && current.revision > next.revision) return records;
    return [next, ...records.filter(d => d.id !== next.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }), []);
  const scope = preferences.workspaceScope ?? teamView.teams[0]?.id ?? 'personal';
  async function create(entry: CaptureKind) {
    const selectedTeam = teamView.teams.find(t => t.id === scope);
    const draft = createDraft(Crypto.randomUUID(), entry, selectedTeam?.name ?? preferences.event, new Date().toISOString());
    await repository().create(draft, true); merge(draft); cloud.current?.wake(); team.current?.wake(); setActiveDraftId(draft.id); if (selectedTeam) await team.current?.share(draft.id, selectedTeam.id); return draft;
  }
  async function update(id: string, action: DraftAction, revision?: number) {
    const draft = await repository().update(id, action, revision); merge(draft); cloud.current?.wake(); team.current?.wake(); return draft;
  }
  async function attach(id: string, uri: string, details: Omit<Attachment, 'id' | 'bytes' | 'sha256' | 'capturedAt'>) {
    const { bytes, mimeType } = await readUri(uri);
    if (bytes.byteLength <= 0 || bytes.byteLength > mediaLimit(details.kind)) throw new Error(`Choose a non-empty file smaller than ${mediaLimit(details.kind) / 1024 / 1024} MiB.`);
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes));
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const attachment: Attachment = { ...details, mimeType: mimeType || details.mimeType, id: Crypto.randomUUID(), bytes: bytes.byteLength, sha256, capturedAt: new Date().toISOString() };
    const draft = await repository().update(id, { type: 'attach', attachment }, undefined, bytes); merge(draft);
    setJobs(await repository().jobs()); runner.current?.wake(); cloud.current?.wake(); team.current?.wake(); return draft;
  }
  async function savePreferences(value: Preferences) { await repository().savePreferences(value); setPreferences(value); }
  async function getMedia(draftId: string, attachmentId: string) { return repository().media(draftId, attachmentId); }
  async function activateDraft(id?: string) { await repository().activateDraft(id); setActiveDraftId(id); }
  async function retryJob(id: string) { await repository().retryJob(id); setJobs(await repository().jobs()); runner.current?.wake(); }
  async function reviewJob(id: string, fields: Partial<Contact>, revision: number, options: ReviewOptions = {}) {
    const draft = await repository().reviewJob(id, fields, revision, options); merge(draft); setJobs(await repository().jobs()); cloud.current?.wake(); team.current?.wake();
  }
  async function backup(id: string) { return encodeBackup(await repository().snapshot(id), digest); }
  async function restore(backup: VerifiedBackup) {
    const current = repository();
    const result = await current.restore(backup);
    if (repo.current !== current) throw new Error('The signed-in account changed. Reopen Pete to see the restored draft.');
    merge(result.draft); setJobs(await current.jobs()); setActiveDraftId(result.draft.id); cloud.current?.wake(); team.current?.wake(); return result;
  }
  async function cloudCopies() { if (!cloud.current) throw new Error('Cloud storage is not ready.'); return cloud.current.list(); }
  async function restoreCloud(id: string) { if (!cloud.current) throw new Error('Cloud storage is not ready.'); return restore(await cloud.current.restore(id)); }
  async function selectScope(value: string) { await savePreferences({ ...preferences, workspaceScope: value }); }
  async function openTeam(id: string, teamId: string) { await team.current?.open(id, teamId); await activateDraft(id); }
  async function shareTeam(id: string, teamId: string) { await team.current?.share(id, teamId); }
  return { holdTeamUpdates: (held: boolean) => { editingTeam.current = held; if (!held) team.current?.wake(); }, cancelTeamOpen: () => team.current?.cancelOpen(), teamView, scope, selectScope, openTeam, shareTeam, resolveTeam: (id: string, choices: Record<string, 'local' | 'team'>) => team.current?.resolve(id, choices), drafts, activeDraftId, activateDraft, jobs, supportedKinds, preferences, loading, error, processingError, cloudEnabled, cloudStates, cloudCopies, restoreCloud, retryCloud: () => cloud.current?.wake(), retry: () => setGeneration(g => g + 1), create, update, attach, savePreferences, getMedia, retryJob, reviewJob, backup, restore };
}
export type Workspace = ReturnType<typeof useWorkspace>;
