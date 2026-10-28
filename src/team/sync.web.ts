import type { DraftRepository } from '../storage/types';
import { decodeManifest, type BackupSnapshot } from '../backup/archive';
import { digest } from '../backup/digest';
import { auth, accessToken, storageName } from '../session.web';
import { gateway, upload } from '../processing/voice.web';
import { openTeamStorage } from './storage.web';
import { manifestText, mergeTeam } from './merge';
import { emptyTeamView, type Team, type TeamCopy, type TeamLink, type TeamStatus, type TeamView } from './types';
const encoder = new TextEncoder();

export function startTeamSync(repo: DraftRepository, changed: (view: TeamView) => void, refresh: () => Promise<void>, canApply: () => boolean = () => true) {
  const uid = auth?.currentUser?.uid;
  const controller = new AbortController();
  let opening: AbortController | undefined;
  let view: TeamView = structuredClone(emptyTeamView), busy = false;
  const ready = uid && gateway ? openTeamStorage(storageName()!) : undefined;
  const decisions = new Map<string, { local: string; remote: string; choices: Record<string, 'local' | 'team'> }>();
  function emit() { if (!controller.signal.aborted) changed({ ...view, states: { ...view.states }, links: { ...view.links } }); }
  function status(id: string, state: TeamStatus) { view.states[id] = state; emit(); }
  async function api(path: string, init: RequestInit = {}) {
    if (controller.signal.aborted || auth?.currentUser?.uid !== uid) throw new Error('Dein angemeldetes Konto hat sich geändert.');
    const response = await fetch(`${gateway}/teams${path}`, { ...init, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000), ...(init.signal ? [init.signal] : [])]), headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}` } });
    if (!response.ok && response.status !== 404) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Der Team-Bereich ist gerade nicht erreichbar. Deine Erfassung bleibt hier gespeichert.');
    }
    return response;
  }
  const post = async (path: string, body: unknown = {}) => (await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  async function metadata(teamId: string, copy: TeamCopy, signal?: AbortSignal) {
    const response = await api(`/${teamId}/drafts/${copy.id}/manifest`, { signal });
    if (!response.ok) throw new Error('Dieser Team-Besucher ist nicht verfügbar.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await digest(bytes) !== copy.fingerprint) throw new Error('Der Team-Stand hat sich geändert. Pete versucht es erneut.');
    const snapshot = decodeManifest(bytes);
    if (snapshot.draft.id !== copy.draftId || await digest(encoder.encode(snapshot.draft.id)) !== copy.id) throw new Error('Die Besucher-Zuordnung stimmt nicht.');
    return { snapshot, text: new TextDecoder().decode(bytes) };
  }
  async function originals(teamId: string, snapshot: Pick<BackupSnapshot, 'draft' | 'jobs'>, signal?: AbortSignal) {
    const result: BackupSnapshot['media'] = [];
    for (const a of snapshot.draft.attachments) {
      if (await repo.media(snapshot.draft.id, a.id)) continue;
      const bytes = new Uint8Array(a.bytes);
      for (let offset = 0; offset < a.bytes; offset += 4 * 1024 * 1024) {
        const response = await api(`/${teamId}/media/${a.sha256}?offset=${offset}`, { signal });
        if (!response.ok) throw new Error('Das Original ist noch nicht verfügbar.');
        const chunk = new Uint8Array(await response.arrayBuffer());
        if (chunk.length !== Math.min(4 * 1024 * 1024, a.bytes - offset)) throw new Error('Der Download wurde unterbrochen. Öffne den Besucher erneut.');
        bytes.set(chunk, offset);
      }
      if (await digest(bytes) !== a.sha256) throw new Error('Ein Original ist unvollständig. Bitte erneut laden.');
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
        if (!bytes || await digest(bytes) !== a.sha256) throw new Error('Ein Original fehlt auf diesem Gerät.');
        await upload(session.uploadUrl, bytes, a.mimeType, controller.signal);
        if (!(await post(`${path}/complete`)).complete) throw new Error('Ein Original wartet noch auf die Cloud.');
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
    if (!navigator.onLine) { report({ state: 'pending' }); return; }
    if (link.base === localText && remote?.fingerprint === link.fingerprint) { report({ state: 'saved' }); return; }
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
              return field === 'throughput' ? `${record.throughput} ${record.unit}`.trim() || '(leer)' : record[field] || '(leer)';
            }
            if (key === 'note' || key === 'event') return snapshot.draft[key] || '(leer)';
            if (section === 'job') return JSON.stringify(snapshot.jobs.find(j => j.id === key.slice(4))?.result ?? '(noch in Verarbeitung)');
            return JSON.stringify(section === 'entry' ? snapshot.draft.entries?.find(e => e.id === key.slice(6)) : snapshot.draft.attachments.find(a => a.id === key.slice(7))) || '(leer)';
          };
          report({ state: 'conflict', conflicts: result.conflicts, comparisons: result.conflicts.map(key => ({ key, local: describe(local, key), team: describe(latest.snapshot, key) })), message: 'Ihr habt dieselben Angaben geändert. Beide Fassungen sind erhalten.' }); return;
        }
        candidate = result.snapshot;
      }
      const media = await originals(link.teamId, candidate);
      if (!canApply()) { report({ state: 'pending' }); return; }
      const applied = await store.apply(candidate, media, localText, { ...link, base: latest.text, fingerprint: remote.fingerprint, author: remote.updatedBy });
      if (!applied) { report({ state: 'pending' }); return; }
      decisions.delete(id); await refresh();
      // Re-read on the next pass. A concurrent edit/processing result never gets
      // replaced by a network response or acknowledged as already uploaded.
      report({ revision: candidate.draft.revision, state: manifestText(candidate) === latest.text ? 'saved' : 'pending' });
      wake(); return;
    }
    if (!remote && link.fingerprint) throw new Error('Der gemeinsame Stand ist nicht erreichbar. Deine Änderungen bleiben hier.');
    const saved = await push(link.teamId, local, remote?.fingerprint ?? null);
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
      if (!response.ok) throw new Error('Der Team-Bereich ist noch nicht verfügbar.');
      const teams: Team[] = await response.json();
      view.teams = teams; view.available = true; view.error = undefined; await store.catalog(teams);
      const copies: TeamView['copies'] = [];
      for (const team of teams) {
        const response = await api(`/${team.id}/drafts`);
        if (!response.ok) throw new Error('Die Team-Besucher konnten nicht geladen werden.');
        const records: TeamCopy[] = await response.json();
        copies.push(...records.map(copy => ({ ...copy, teamId: team.id })));
      }
      view.copies = copies; emit();
      for (const [id, link] of Object.entries(view.links)) {
        try {
          if (!teams.some(t => t.id === link.teamId)) throw new Error('Dein Konto hat aktuell keinen Zugriff auf diesen Team-Bereich.');
          await reconcile(id, link, copies.find(c => c.teamId === link.teamId && c.draftId === id));
        } catch (error) { status(id, { state: navigator.onLine ? 'error' : 'pending', message: error instanceof Error ? error.message : 'Team-Sicherung wartet.' }); }
      }
      view.links = await store.links(); emit();
    } catch (error) { view.error = error instanceof Error ? error.message : 'Der Team-Bereich ist nicht erreichbar.'; emit(); }
    finally { busy = false; }
  }
  let debounce: ReturnType<typeof setTimeout> | undefined;
  function wake() { if (!ready) return; clearTimeout(debounce); debounce = setTimeout(() => { void tick(); }, 800); }
  const timer = ready ? setInterval(() => { void tick(); }, 15_000) : undefined;
  if (ready) {
    window.addEventListener('online', wake);
    void ready.then(async store => { view.teams = await store.teams(); view.links = await store.links(); emit(); wake(); }).catch(() => { view.error = 'Der lokale Team-Stand konnte nicht geöffnet werden.'; emit(); });
  }
  return {
    get view() { return view; }, wake,
    close() { controller.abort(); clearInterval(timer); clearTimeout(debounce); window.removeEventListener('online', wake); void ready?.then(s => s.close()); },
    async share(id: string, teamId: string) {
      const team = view.teams.find(t => t.id === teamId);
      if (!ready || !team) throw new Error('Wähle einen verfügbaren Team-Bereich.');
      const store = await ready; await store.share(id, team); view.links = await store.links(); status(id, { state: 'pending' }); await refresh(); wake();
    },
    cancelOpen() { opening?.abort(); },
    async open(id: string, teamId: string) {
      if (!ready) throw new Error('Der Team-Bereich ist nicht bereit.');
      const store = await ready;
      const existing = await store.read(id);
      if (existing.snapshot) {
        if (existing.link?.teamId === teamId) return;
        throw new Error('Du hast bereits eine persönliche Fassung dieses Besuchers. Öffne sie unter Deinen persönlichen Besuchen und teile sie über Kontakt & Bedarf, um Änderungen abzugleichen.');
      }
      const copy = view.copies.find(c => c.draftId === id && c.teamId === teamId);
      if (!copy) throw new Error('Der Team-Besucher wurde nicht gefunden.');
      opening?.abort(); const download = new AbortController(); opening = download;
      const latest = await metadata(teamId, copy, download.signal);
      const media = await originals(teamId, latest.snapshot, download.signal);
      download.signal.throwIfAborted();
      await store.apply(latest.snapshot, media, null, { teamId, base: latest.text, fingerprint: copy.fingerprint, author: copy.updatedBy });
      view.links = await store.links(); status(id, { state: 'saved', revision: latest.snapshot.draft.revision }); await refresh(); wake();
    },
    async resolve(id: string, choices: Record<string, 'local' | 'team'>) { const current = decisions.get(id); if (current) decisions.set(id, { ...current, choices }); wake(); },
  };
}
