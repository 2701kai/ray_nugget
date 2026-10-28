import { deferredQuestions, parseCaptureContext, type CaptureContext } from './domain/requirements';
import { continuationBlock, canContinue, MAX_AUTOMATIC_CONSULTATIONS, MIN_CONSULTATION_INTERVAL, type ContinuationSession } from './ray/continuation';
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
import { prepareRayInput } from './ray/brief';
import { rayAvailable, requestRay } from './ray/client';
import { useUpdateGuard } from './pwa/updateGuard';

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
  const rayObserved = useRef(new Map<string, string>());
  const raySessions = useRef(new Map<string, ContinuationSession>());
  const [rayEnabled, setRayEnabled] = useState<Record<string, boolean>>({});
  const activeVisitor = useRef(activeDraftId); activeVisitor.current = activeDraftId;
  const rayTick = useRef<() => void>(() => undefined);
  const rayRequests = useRef(new Map<string, AbortController>());
  const [rayStates, setRayStates] = useState<Record<string, { busy: boolean; error?: string; canceled?: boolean }>>({});
  useUpdateGuard(Object.values(rayStates).some(s => s.busy));
  useEffect(() => {
    let alive = true;
    let current: DraftRepository | undefined;
    let currentRunner: ReturnType<typeof startProcessing> | undefined;
    let currentTeam: ReturnType<typeof startTeamSync> | undefined;
    let currentCloud: ReturnType<typeof startCloudSaving> | undefined;
    setLoading(true); setError(''); setProcessingError(''); setRayStates({}); raySessions.current.clear(); rayObserved.current.clear(); setRayEnabled({});
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
    return () => { alive = false; for (const controller of rayRequests.current.values()) controller.abort(); rayRequests.current.clear(); subscription.remove(); currentTeam?.close(); team.current = null; currentCloud?.close(); cloud.current = null; repo.current = null; runner.current = null; void (async () => { await currentRunner?.close(); await current?.close(); })(); };
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
  async function assignLeadOwner(id: string, email: string, expectedVersion: number) {
    if (!team.current) throw new Error('The team workspace is not ready.');
    await team.current.assignOwner(id, email, expectedVersion);
  }
  function captureContext(id: string, answerQuestions: string[] = []): CaptureContext {
    const draft = drafts.find(d => d.id === id);
    if (!draft) return { version: 1, request: {}, questions: [] };
    const latest = [...(draft.ray ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const deferred = deferredQuestions(draft.rayQuestions);
    // General memos/conversations carry known facts, without pretending to answer
    // Ray. An explicit answer carries only the question shown when it was opened.
    const questions = latest?.questions.filter(q => answerQuestions.includes(q) && !deferred.includes(q)) ?? [];
    return parseCaptureContext({ version: 1, request: draft.request, ...(latest && questions.length ? { consultationId: latest.id } : {}), questions });
  }
  function pauseRay(id: string) {
    const session = raySessions.current.get(id);
    if (session) session.enabled = false;
    setRayEnabled(s => ({ ...s, [id]: false }));
  }
  function stopRay(id: string) {
    pauseRay(id);
    const controller = rayRequests.current.get(id);
    controller?.abort();
    // Keep the request slot until its finally block exits; late replies cannot
    // save advice or restart an explicitly stopped session.
    setRayStates(s => ({ ...s, [id]: { busy: false, canceled: true } }));
  }
  async function decideRayQuestion(id: string, consultationId: string, question: string, deferred: boolean) {
    await update(id, { type: 'rayQuestion', decision: { id: Crypto.randomUUID(), consultationId, question, deferred, createdAt: new Date().toISOString() } });
  }
  async function askRay(id: string, automatic = false) {
    if (rayRequests.current.has(id) || !repo.current) return;
    const current = repository();
    let session = raySessions.current.get(id);
    if (!automatic) {
      session = { enabled: true, attempts: 0, lastAt: 0 };
      raySessions.current.set(id, session); setRayEnabled(s => ({ ...s, [id]: true }));
    }
    if (!session?.enabled) return;
    if (automatic && (activeVisitor.current !== id || editingTeam.current || typeof navigator !== 'undefined' && !navigator.onLine || typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    const controller = new AbortController(); rayRequests.current.set(id, controller);
    let started = false;
    if (!automatic) setRayStates(s => ({ ...s, [id]: { busy: true } }));
    try {
      const [records, tasks] = await Promise.all([current.list(), current.jobs()]);
      if (repo.current !== current || controller.signal.aborted) return;
      const draft = records.find(d => d.id === id);
      if (!draft) throw new Error('The visitor is no longer available.');
      if (automatic && (activeVisitor.current !== id || !session.enabled || continuationBlock(draft, tasks))) return;
      const input = await prepareRayInput(draft, tasks, digest);
      if (repo.current !== current || controller.signal.aborted) return;
      if (automatic) {
        const latest = [...(draft.ray ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (latest?.sourceFingerprint === input.sourceFingerprint || !canContinue(session, input.sourceFingerprint, Date.now())) return;
        if (activeVisitor.current !== id || !session.enabled || editingTeam.current) return;
        session.attempts++;
      }
      session.lastSource = input.sourceFingerprint; session.lastAt = Date.now();
      started = true; setRayStates(s => ({ ...s, [id]: { busy: true } }));
      const advice = await requestRay(input, controller.signal);
      if (repo.current !== current || controller.signal.aborted) return;
      // Save on the originating visitor even after navigation. Explicit Stop aborts before this point. The
      // source fingerprint prevents an old response becoming current advice.
      const updated = await current.update(id, { type: 'rayAdvice', advice });
      if (repo.current !== current) return;
      merge(updated); cloud.current?.wake(); team.current?.wake();
      setRayStates(s => ({ ...s, [id]: { busy: false } }));
      if (session.attempts >= MAX_AUTOMATIC_CONSULTATIONS) {
        pauseRay(id); setRayStates(s => ({ ...s, [id]: { busy: false, error: 'Automatic updates paused after 12 replies. Choose Ask Ray when you need more help.' } }));
      }
    } catch (e) {
      if (repo.current === current && !controller.signal.aborted) {
        pauseRay(id);
        setRayStates(s => ({ ...s, [id]: { busy: false, error: e instanceof Error && e.name !== 'TimeoutError' ? e.message : 'Ray took too long. Your visitor stays saved; choose Ask Ray to retry.' } }));
      }
    } finally {
      if (rayRequests.current.get(id) === controller) rayRequests.current.delete(id);
      if (repo.current === current && (!started || controller.signal.aborted)) setRayStates(s => ({ ...s, [id]: { ...s[id], busy: false } }));
    }
  }
  // Assistance belongs to this open app session and the selected visitor. A
  // reload starts paused; opening someone else's shared visitor never starts AI.
  rayTick.current = () => {
    if (!activeDraftId || !rayEnabled[activeDraftId] || rayRequests.current.has(activeDraftId) || editingTeam.current || typeof navigator !== 'undefined' && !navigator.onLine || typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const session = raySessions.current.get(activeDraftId);
    if (!session || Date.now() - session.lastAt < MIN_CONSULTATION_INTERVAL) return;
    const draft = drafts.find(d => d.id === activeDraftId);
    if (!draft) return;
    // Check cheap revision markers first. An idle conversation never rereads all
    // local drafts/media or hashes its transcript history on every timer tick.
    const stamp = `${draft.revision}/${jobs.filter(j => j.draftId === activeDraftId).map(j => `${j.id}:${j.state}:${j.updatedAt}:${j.reviewedAt ?? ''}`).join(',')}`;
    if (rayObserved.current.get(activeDraftId) === stamp) return;
    rayObserved.current.set(activeDraftId, stamp);
    void askRay(activeDraftId, true);
  };
  useEffect(() => {
    const wake = () => { rayObserved.current.clear(); rayTick.current(); };
    const timer = setInterval(() => rayTick.current(), 2000);
    if (typeof window !== 'undefined') window.addEventListener('online', wake);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
    return () => { clearInterval(timer); if (typeof window !== 'undefined') window.removeEventListener('online', wake); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake); };
  }, []);

  return { rayAvailable, rayStates, rayEnabled, pauseRay, stopRay, captureContext, decideRayQuestion, askRay, assignLeadOwner, holdTeamUpdates: (held: boolean) => { editingTeam.current = held; if (!held) { rayObserved.current.clear(); team.current?.wake(); } }, cancelTeamOpen: () => team.current?.cancelOpen(), teamView, scope, selectScope, openTeam, shareTeam, resolveTeam: (id: string, choices: Record<string, 'local' | 'team'>) => team.current?.resolve(id, choices), drafts, activeDraftId, activateDraft, jobs, supportedKinds, preferences, loading, error, processingError, cloudEnabled, cloudStates, cloudCopies, restoreCloud, retryCloud: () => cloud.current?.wake(), retry: () => setGeneration(g => g + 1), create, update, attach, savePreferences, getMedia, retryJob, reviewJob, backup, restore };
}
export type Workspace = ReturnType<typeof useWorkspace>;
