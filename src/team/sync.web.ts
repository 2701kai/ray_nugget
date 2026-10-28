import type { DraftRepository } from '../storage/types';
import { decodeManifest, type BackupSnapshot } from '../backup/archive';
import { digest } from '../backup/digest';
import { auth, accessToken, storageName } from '../session.web';
import { gateway, upload } from '../processing/voice.web';
import { openTeamStorage } from './storage.web';
import { manifestText, mergeTeam } from './merge';
import { holdUpdate } from '../pwa/updateGuard.web';
import { emptyTeamView, type Team, type TeamCopy, type TeamLink, type TeamStatus, type TeamView } from './types';
const encoder = new TextEncoder();

export function startTeamSync(repo: DraftRepository, changed: (view: TeamView) => void, refresh: () => Promise<void>, canApply: () => boolean = () => true) {
  const uid = auth?.currentUser?.uid;
  const controller = new AbortController();
  let opening: AbortController | undefined;
  let view: TeamView = structuredClone(emptyTeamView), busy = false;
  const ready = uid && gateway ? openTeamStorage(storageName()!) : undefined;
  const decisions = new Map<string, { local: string; remote: string; choices: Record<string, 'local' | 'team'> }>();
  const pendingDecisions = new Map<string, () => void>();
  function emit() { if (!controller.signal.aborted) changed({ ...view, states: { ...view.states }, links: { ...view.links } }); }
  function status(id: string, state: TeamStatus) { view.states[id] = state; emit(); }
  async function api(path: string, init: RequestInit = {}) {
    if (controller.signal.aborted || auth?.currentUser?.uid !== uid) throw new Error('Your signed-in account has changed.');
    const response = await fetch(`${gateway}/teams${path}`, { ...init, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000), ...(init.signal ? [init.signal] : [])]), headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}` } });
    if (!response.ok && (response.status !== 404 || init.method === 'POST')) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'The team workspace is unavailable right now. Your capture stays saved here.');
    }
    return response;
  }
  const post = async (path: string, body: unknown = {}) => (await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  async function metadata(teamId: string, copy: TeamCopy, signal?: AbortSignal) {
    const response = await api(`/${teamId}/drafts/${copy.id}/manifest`, { signal });
    if (!response.ok) throw new Error('This shared visitor is unavailable.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await digest(bytes) !== copy.fingerprint) throw new Error('The shared version has changed. Pete will retry.');
    const snapshot = decodeManifest(bytes);
    if (snapshot.draft.id !== copy.draftId || await digest(encoder.encode(snapshot.draft.id)) !== copy.id) throw new Error('The visitor association does not match.');
    return { snapshot, text: new TextDecoder().decode(bytes) };
  }
  async function originals(teamId: string, snapshot: Pick<BackupSnapshot, 'draft' | 'jobs'>, signal?: AbortSignal) {
    const result: BackupSnapshot['media'] = [];
    for (const a of snapshot.draft.attachments) {
      if (await repo.media(snapshot.draft.id, a.id)) continue;
      const bytes = new Uint8Array(a.bytes);
      for (let offset = 0; offset < a.bytes; offset += 4 * 1024 * 1024) {
        const response = await api(`/${teamId}/media/${a.sha256}?offset=${offset}`, { signal });
        if (!response.ok) throw new Error('The original file is not available yet.');
        const chunk = new Uint8Array(await response.arrayBuffer());
        if (chunk.length !== Math.min(4 * 1024 * 1024, a.bytes - offset)) throw new Error('The download was interrupted. Open the visitor again.');
        bytes.set(chunk, offset);
      }
      if (await digest(bytes) !== a.sha256) throw new Error('An original file is incomplete. Please download it again.');
      result.push({ attachmentId: a.id, bytes });
    }
    return result;
  }
  async function push(teamId: string, snapshot: Pick<BackupSnapshot, 'draft' | 'jobs'>, expected: string | null) {
    for (const a of snapshot.draft.attachments) {
      const path = `/${teamId}/media/${a.sha256}`;
      const session = await post(`${path}/upload`, { bytes: a.bytes, mimeType: a.mimeType });
      if (!session.complete && !(await post(`${path}/complete`)).complete) {
        const bytes = await repo.media(snapshot.draft.id, a.id);
        if (!bytes || await digest(bytes) !== a.sha256) throw new Error('An original file is missing on this device.');
        await upload(session.uploadUrl, bytes, a.mimeType, controller.signal);
        if (!(await post(`${path}/complete`)).complete) throw new Error('An original is still waiting to reach company storage.');
      }
    }
    const id = await digest(encoder.encode(snapshot.draft.id));
    return await post(`/${teamId}/drafts/${id}`, { manifest: manifestText(snapshot), expected }) as TeamCopy;
  }
  async function reconcile(id: string, link: TeamLink, remote?: TeamCopy) {
    const store = await ready!;
    const local = (await store.read(id)).snapshot;
    if (!local) return;
    const report = (state: TeamStatus) => status(id, { revision: local.draft.revision, ...state });
    const localText = manifestText(local);
    const previousDecision = decisions.get(id);
    if (previousDecision && (previousDecision.local !== localText || previousDecision.remote !== remote?.fingerprint)) {
      decisions.delete(id); pendingDecisions.get(id)?.(); pendingDecisions.delete(id);
    }
    if (!navigator.onLine) { report({ state: 'pending' }); return; }
    if (link.base === localText && remote?.fingerprint === link.fingerprint && remote?.intakeVersion === 1) { report({ state: 'saved' }); return; }
    report({ state: 'saving' });
    if (remote && remote.fingerprint !== link.fingerprint) {
      if (!canApply()) { report({ state: 'pending' }); return; }
      const latest = await metadata(link.teamId, remote);
      let candidate = latest.snapshot;
      if (localText !== link.base && localText !== latest.text) {
        const decision = decisions.get(id);
        const choices = decision?.local === localText && decision.remote === remote.fingerprint ? decision.choices : undefined;
        const result = mergeTeam(link.base, localText, latest.text, choices);
        if (result.conflicts.length) {
          decisions.set(id, { local: localText, remote: remote.fingerprint, choices: {} });
          const describe = (snapshot: typeof local, key: string): string => {
            const [section, field] = key.split('.');
            if (section === 'contact' || section === 'request') {
              const record = snapshot.draft[section] as Record<string, string>;
              return field === 'throughput' ? `${record.throughput} ${record.unit}`.trim() || '(empty)' : record[field] || '(empty)';
            }
            if (key === 'note' || key === 'event') return snapshot.draft[key] || '(empty)';
            if (section === 'job') return JSON.stringify(snapshot.jobs.find(j => j.id === key.slice(4))?.result ?? '(still processing)');
            if (section === 'ray') return `Saved machines: ${snapshot.draft.ray?.find(a => a.id === key.slice(4))?.selectedSkus.join(', ') || 'None'}`;
            return JSON.stringify(section === 'entry' ? snapshot.draft.entries?.find(e => e.id === key.slice(6)) : snapshot.draft.attachments.find(a => a.id === key.slice(7))) || '(empty)';
          };
          report({ state: 'conflict', conflicts: result.conflicts, comparisons: result.conflicts.map(key => ({ key, local: describe(local, key), team: describe(latest.snapshot, key) })), message: 'You both changed the same details. Both versions are kept.' }); return;
        }
        candidate = result.snapshot;
      }
      const media = await originals(link.teamId, candidate);
      if (!canApply()) { report({ state: 'pending' }); return; }
      const applied = await store.apply(candidate, media, localText, { ...link, base: latest.text, fingerprint: remote.fingerprint, author: remote.updatedBy });
      if (!applied) { report({ state: 'pending' }); return; }
      decisions.delete(id); pendingDecisions.get(id)?.(); pendingDecisions.delete(id); await refresh();
      // Re-read on the next pass. A concurrent edit/processing result never gets
      // replaced by a network response or acknowledged as already uploaded.
      report({ revision: candidate.draft.revision, state: manifestText(candidate) === latest.text ? 'saved' : 'pending' });
      wake(); return;
    }
    if (!remote && link.fingerprint) throw new Error('The shared version is unavailable. Your changes stay saved here.');
    const saved = await push(link.teamId, local, remote?.fingerprint ?? null);
    view.copies = [...view.copies.filter(c => c.teamId !== link.teamId || c.draftId !== id), { ...saved, teamId: link.teamId }];
    const acknowledged = await store.acknowledge(id, localText, { ...link, fingerprint: saved.fingerprint, base: localText, author: saved.updatedBy });
    report({ state: acknowledged ? 'saved' : 'pending' });
  }
  async function tick() {
    if (!ready || busy || controller.signal.aborted) return;
    busy = true;
    try {
      const store = await ready;
      view.links = await store.links();
      if (!navigator.onLine) { for (const id of Object.keys(view.links)) status(id, { state: 'pending' }); return; }
      const response = await api('');
      if (!response.ok) throw new Error('The team workspace is not available yet.');
      const teams: Team[] = await response.json();
      view.teams = teams; view.available = true; view.error = undefined; await store.catalog(teams);
      const copies: TeamView['copies'] = [];
      for (const team of teams) {
        const response = await api(`/${team.id}/drafts`);
        if (!response.ok) throw new Error('Shared visitors could not be loaded.');
        const records: TeamCopy[] = await response.json();
        copies.push(...records.map(copy => ({ ...copy, teamId: team.id })));
      }
      view.copies = copies; emit();
      for (const [id, link] of Object.entries(view.links)) {
        try {
          if (!teams.some(t => t.id === link.teamId)) throw new Error('Your account does not currently have access to this team workspace.');
          await reconcile(id, link, copies.find(c => c.teamId === link.teamId && c.draftId === id));
        } catch (error) { status(id, { state: navigator.onLine ? 'error' : 'pending', message: error instanceof Error ? error.message : 'Team saving is pending.' }); }
      }
      view.links = await store.links(); emit();
    } catch (error) { view.error = error instanceof Error ? error.message : 'The team workspace is unavailable.'; emit(); }
    finally { busy = false; }
  }
  let debounce: ReturnType<typeof setTimeout> | undefined;
  function wake() { if (!ready) return; clearTimeout(debounce); debounce = setTimeout(() => { void tick(); }, 800); }
  const timer = ready ? setInterval(() => { void tick(); }, 15_000) : undefined;
  if (ready) {
    window.addEventListener('online', wake);
    void ready.then(async store => { view.teams = await store.teams(); view.links = await store.links(); emit(); wake(); }).catch(() => { view.error = 'The local team workspace could not be opened.'; emit(); });
  }
  return {
    get view() { return view; }, wake,
    async assignOwner(id: string, email: string, expectedVersion: number) {
      const link = view.links[id];
      if (!ready || !link || !navigator.onLine) throw new Error('Reconnect to change the lead owner.');
      const copyId = await digest(encoder.encode(id));
      try {
        const copy: TeamCopy = await post(`/${link.teamId}/drafts/${copyId}/owner`, { ownerEmail: email, expectedVersion });
        view.copies = [...view.copies.filter(c => c.teamId !== link.teamId || c.draftId !== id), { ...copy, teamId: link.teamId }];
        emit();
      } finally { wake(); }
    },
    close() { controller.abort(); clearInterval(timer); clearTimeout(debounce); window.removeEventListener('online', wake); for (const release of pendingDecisions.values()) release(); pendingDecisions.clear(); void ready?.then(s => s.close()); },
    async share(id: string, teamId: string) {
      const team = view.teams.find(t => t.id === teamId);
      if (!ready || !team) throw new Error('Choose an available team workspace.');
      const store = await ready; await store.share(id, team); view.links = await store.links(); status(id, { state: 'pending' }); await refresh(); wake();
    },
    cancelOpen() { opening?.abort(); },
    async open(id: string, teamId: string) {
      if (!ready) throw new Error('The team workspace is not ready.');
      const store = await ready;
      const existing = await store.read(id);
      if (existing.snapshot) {
        if (existing.link?.teamId === teamId) return;
        throw new Error('You already have a personal copy of this visitor. Open it under My personal visits and share it from Details & request to reconcile changes.');
      }
      const copy = view.copies.find(c => c.draftId === id && c.teamId === teamId);
      if (!copy) throw new Error('The shared visitor could not be found.');
      opening?.abort(); const download = new AbortController(); opening = download;
      const latest = await metadata(teamId, copy, download.signal);
      const media = await originals(teamId, latest.snapshot, download.signal);
      download.signal.throwIfAborted();
      await store.apply(latest.snapshot, media, null, { teamId, base: latest.text, fingerprint: copy.fingerprint, author: copy.updatedBy });
      view.links = await store.links(); status(id, { state: 'saved', revision: latest.snapshot.draft.revision }); await refresh(); wake();
    },
    async resolve(id: string, choices: Record<string, 'local' | 'team'>) {
      const current = decisions.get(id);
      if (current) {
        decisions.set(id, { ...current, choices });
        if (!pendingDecisions.has(id)) pendingDecisions.set(id, holdUpdate());
      }
      wake();
    },
  };
}
