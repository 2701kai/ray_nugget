import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Manrope_400Regular } from '@expo-google-fonts/manrope/400Regular';
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_600SemiBold } from '@expo-google-fonts/manrope/600SemiBold';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { Manrope_800ExtraBold } from '@expo-google-fonts/manrope/800ExtraBold';
import { useWorkspace } from './src/useWorkspace';
import { usePwa } from './src/usePwa';
import { exportDraft, titleOf, rfqGaps, type CaptureKind, type Draft } from './src/domain/draft';
import { downloadJson } from './src/media/files';
import { colors } from './src/ui/theme';
import { Icon, PeteMark, type IconName } from './src/ui/Icon';
import { Button, ErrorNotice, Eyebrow, Field, Sheet, Txt } from './src/ui/primitives';
import { ContactForm, FollowupForm, RequestForm, SettingsForm } from './src/ui/Forms';
import { CardCapture, VoiceCapture } from './src/ui/MediaCapture';
import { DraftDetail } from './src/ui/DraftDetail';
import { TeamConflict } from './src/ui/TeamConflict';
import { CloudCopies, CloudStatus } from './src/ui/CloudStatus';
import { Conversation } from './src/ui/Conversation';
import { VersionHint } from './src/ui/VersionHint';
import { QuickNote } from './src/ui/QuickNote';
import { AuthGate } from './src/ui/AuthGate';
import { RestoreBackup, SaveBackup } from './src/ui/Backup';

type Kind = CaptureKind | 'settings' | 'followup' | 'note' | 'conversation' | 'backup' | 'restore' | 'cloud' | 'scope';
type Panel = { kind: Kind; draftId?: string };

function WorkspaceScreen() {
  const workspace = useWorkspace();
  const pwa = usePwa();
  const { width } = useWindowDimensions();
  const desktop = width >= 1100;
  const [showLibrary, setShowLibrary] = useState(false);
  const [section, setSection] = useState<'conversation' | 'details'>('conversation');
  const [panel, setPanelState] = useState<Panel | null>(null);
  function setPanel(value: Panel | null) { workspace.holdTeamUpdates(!!value); setPanelState(value); }
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const changing = useRef(false);
  const draft = workspace.drafts.find(record => record.id === workspace.activeDraftId);
  const panelDraft = workspace.drafts.find(record => record.id === panel?.draftId);
  const library = showLibrary || !draft;
  const teamLoading = workspace.cloudEnabled && pwa.online && !workspace.teamView.available && !workspace.teamView.teams.length && !workspace.teamView.error;
  const captureDisabled = workspace.loading || !!workspace.error || busy;
  const disabled = captureDisabled || teamLoading;
  const selectedTeam = workspace.teamView.teams.find(t => t.id === workspace.scope);
  const inScope = (id: string) => selectedTeam ? workspace.teamView.links[id]?.teamId === selectedTeam.id : !workspace.teamView.links[id];
  const remoteCopies = workspace.teamView.copies.filter(c => c.teamId === selectedTeam?.id && !workspace.drafts.some(d => d.id === c.draftId && inScope(d.id)) && `${c.title} ${c.company}`.toLowerCase().includes(query.toLowerCase()));
  const list = workspace.drafts.filter(record => inScope(record.id)).filter(record => `${record.contact.name} ${record.contact.company} ${record.event} ${record.request.product}`.toLowerCase().includes(query.toLowerCase()));

  async function start(kind: CaptureKind | 'note' | 'conversation' | 'visitor', forceNew = false) {
    const createsVisitor = forceNew || !draft || library;
    if (changing.current || (createsVisitor ? disabled : captureDisabled)) return;
    changing.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const entry: CaptureKind = kind === 'conversation' ? 'voice' : kind === 'note' || kind === 'visitor' ? 'contact' : kind;
      const target = forceNew || !draft || library ? await workspace.create(entry) : draft;
      setShowLibrary(false); setSection('conversation');
      setPanel(kind === 'visitor' ? null : { kind, draftId: target.id });
    } catch (e) { setError(e instanceof Error ? e.message : 'Das Gespräch konnte nicht geöffnet werden.'); }
    finally { changing.current = false; setBusy(false); }
  }
  async function openDraft(id: string) {
    if (changing.current) return;
    changing.current = true; setBusy(true); setError('');
    try { const remote = remoteCopies.find(c => c.draftId === id); if (remote) await workspace.openTeam(id, remote.teamId); else await workspace.activateDraft(id); setShowLibrary(false); setSection('conversation'); setNotice(''); }
    catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) setError(e instanceof Error ? e.message : 'Der Besucher konnte nicht geöffnet werden.'); }
    finally { changing.current = false; setBusy(false); }
  }
  function done() { setPanel(null); setLocked(false); setNotice('Hier gespeichert.'); }
  async function exportRecord() {
    if (!draft) return;
    try { await downloadJson(`pete-draft-${draft.id.slice(0, 8)}.json`, { ...exportDraft(draft), processing: workspace.jobs.filter(job => job.draftId === draft.id).map(({ leaseId, ...job }) => job) }); setNotice('Daten und Quelltext exportiert. Originalmedien sind nicht in der JSON-Datei enthalten.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Export failed.'); }
  }
  const details = <DraftDetail draft={draft} workspace={workspace} showMedia={false} edit={kind => draft && setPanel({ kind, draftId: draft.id })} intro={() => draft && setPanel({ kind: 'followup', draftId: draft.id })} backup={() => draft && setPanel({ kind: 'backup', draftId: draft.id })} exportRecord={exportRecord} />;
  const renderRow = (record: Draft) => <Pressable key={record.id} accessibilityRole="button" accessibilityLabel={`Besucher öffnen ${titleOf(record)}`} disabled={busy} onPress={() => openDraft(record.id)} style={({ pressed }) => [styles.draftRow, { backgroundColor: pressed || record.id === draft?.id ? colors.sage : colors.paper }]}>
    <View style={styles.avatar}><Txt weight="bold" style={{ color: colors.green }}>{titleOf(record).charAt(0).toUpperCase()}</Txt></View>
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Txt weight="bold" style={{ fontSize: 16 }} numberOfLines={1}>{titleOf(record)}</Txt><Txt style={{ fontSize: 16, color: colors.muted }} numberOfLines={1}>{record.contact.company || record.event || 'Angaben folgen'}</Txt><Txt style={{ fontSize: 16, color: colors.muted }}>{record.attachments.length} Quellen · {rfqGaps(record.request).length ? 'Bedarf noch offen' : 'Kernbedarf erfasst'}</Txt></View><Icon name="chevron" size={15} color={colors.muted} />
  </Pressable>;

  return <SafeAreaView style={styles.root}>
    <View style={styles.topbar}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><PeteMark size={32} />{width >= 380 && <Txt weight="extra" style={{ fontSize: 25, letterSpacing: -1 }}>pete.</Txt>}{desktop && <Txt style={{ color: colors.muted, fontSize: 16, letterSpacing: 1 }}>BY BEVMAQ</Txt>}</View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {desktop && pwa.installable && <Button label="Pete installieren" kind="quiet" icon="download" onPress={() => { void pwa.install(); }} />}
        {desktop ? <Button label="Deine Angaben" icon="settings" kind="quiet" onPress={() => setPanel({ kind: 'settings' })} /> : <Pressable accessibilityRole="button" accessibilityLabel="Einstellungen" onPress={() => setPanel({ kind: 'settings' })} style={{ minWidth: 44, minHeight: 44, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center' }}><Icon name="settings" size={22} /></Pressable>}
        <Button label="Neuer Besucher" icon="plus" kind="secondary" disabled={disabled} onPress={() => start('visitor', true)} style={{ paddingHorizontal: 12 }} />
      </View>
    </View>
    {library && <Pressable accessibilityRole="button" accessibilityLabel="Event auswählen" onPress={() => setPanel({ kind: 'scope' })} style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><View style={{ flex: 1 }}><Txt style={{ fontSize: 16, color: colors.muted }}>{selectedTeam ? 'BEVMAQ · gemeinsam' : 'Deine persönlichen Besuche'}</Txt><Txt weight="bold" style={{ fontSize: 27, lineHeight: 35, letterSpacing: -0.8 }}>{teamLoading ? 'Bereich wird geladen…' : selectedTeam?.name || workspace.preferences.event || 'Meine Besuche'}</Txt></View><Icon name="chevron" color={colors.green} size={20} /></Pressable>}
    {!!workspace.teamView.error && <View style={styles.banner}><Txt style={{ fontSize: 16 }}>{workspace.teamView.error}</Txt></View>}
    {!pwa.online && <View style={styles.banner}><Txt style={{ fontSize: 16, color: colors.green }}>Offline · Du kannst weiter erfassen. Verarbeitung und Teilen folgen bei Verbindung.</Txt></View>}
    {pwa.updateReady && <View style={styles.banner}><Txt style={{ fontSize: 16, color: colors.muted }}>Ein Update ist bereit. Schließe nach dem Speichern alle Pete-Tabs und öffne Pete erneut.</Txt></View>}
    <ErrorNotice message={error || workspace.error} />
    {!!workspace.error && <Button label="Lokalen Speicher erneut öffnen" onPress={workspace.retry} />}
    {!!workspace.processingError && !workspace.error && <View style={styles.banner}><Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, color: colors.muted }}>{workspace.processingError}</Txt><Button label="Verarbeitung erneut starten" kind="quiet" onPress={workspace.retry} /></View>}
    {workspace.loading ? <View style={{ padding: 24, gap: 16 }}><View style={{ height: 70, backgroundColor: colors.sage, borderRadius: 16 }} /><View style={{ height: 220, backgroundColor: colors.sage, borderRadius: 20 }} /><Txt>Deine Gespräche werden geöffnet…</Txt></View> : <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
      {desktop && !library && <View style={styles.sidebar}><View style={{ padding: 20, gap: 14 }}><Eyebrow>Deine Besucher</Eyebrow><Field label="Besucher finden" placeholder="Name oder Firma" value={query} onChangeText={setQuery} /></View><ScrollView contentContainerStyle={{ paddingHorizontal: 14, gap: 9, paddingBottom: 24 }}>{list.map(renderRow)}</ScrollView><View style={{ padding: 20, gap: 6 }}><Icon name="shield" size={20} color={colors.green} /><Txt style={{ fontSize: 16, color: colors.muted }}>{pwa.offlineReady ? 'Offline verfügbar.' : 'Originale sind auf diesem Gerät gesichert.'}</Txt></View></View>}
      {library ? <View style={{ flex: 1, minHeight: 0 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: desktop ? 32 : 20, paddingBottom: 20, gap: 14, maxWidth: 800, width: '100%', alignSelf: 'center' }}>
          <Field label="Besucher finden" placeholder="Name, Firma oder Bedarf" value={query} onChangeText={setQuery} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Txt weight="semibold" style={{ fontSize: 16 }}>{list.length + remoteCopies.length} Besucher</Txt><Button label="Manuell erfassen" kind="quiet" onPress={() => setManual(!manual)} /></View>
          {manual && <View style={{ flexDirection: 'row', gap: 8 }}><Button label="Kontakt eingeben" icon="contact" kind="secondary" disabled={disabled} onPress={() => start('contact', true)} /><Button label="Anfrage eingeben" icon="request" kind="secondary" disabled={disabled} onPress={() => start('request', true)} /></View>}
          <View style={{ gap: 8 }}>{list.map(renderRow)}{remoteCopies.map(copy => <Pressable key={copy.id} accessibilityRole="button" accessibilityLabel={`Besucher öffnen ${copy.title}`} disabled={busy} onPress={() => openDraft(copy.draftId)} style={styles.draftRow}><View style={styles.avatar}><Txt weight="bold">{copy.title.charAt(0)}</Txt></View><View style={{ flex: 1, gap: 3 }}><Txt weight="bold" style={{ fontSize: 18 }}>{copy.title}</Txt><Txt style={{ fontSize: 16, color: colors.muted }}>{copy.company || selectedTeam?.name}</Txt><Txt style={{ fontSize: 16, color: colors.muted }}>Im Team · {copy.updatedBy?.split('@')[0]}</Txt></View><Icon name="chevron" size={16} /></Pressable>)}</View>
          {!list.length && !remoteCopies.length && <View style={{ paddingVertical: 34, gap: 10 }}><Icon name="mic" size={28} color={colors.green} /><Txt weight="bold" style={{ fontSize: 24, lineHeight: 32 }}>{query ? 'Keine passenden Besucher.' : 'Das Gespräch ist der Anfang.'}</Txt><Txt style={{ color: colors.muted }}>{query ? 'Versuche einen anderen Namen oder Bedarf.' : 'Sprich eine Notiz ein oder fotografiere die Karte. Pete ergänzt Kontakt und Bedarf für Dich.'}</Txt></View>}
          {!!busy && <View style={{ gap: 4 }}><Txt accessibilityLiveRegion="polite">Besucher und Originale werden geöffnet…</Txt><Button label="Öffnen abbrechen" kind="quiet" onPress={workspace.cancelTeamOpen} /></View>}
          {selectedTeam && <Txt style={{ fontSize: 16, color: colors.muted }}>{selectedTeam.members.length} Konten im gemeinsamen Bereich. Geöffnete Besucher bleiben auch offline verfügbar.</Txt>}
        </ScrollView>
        <View style={styles.captureBar}><View style={{ flexDirection: 'row', gap: 10 }}><CaptureAction label="Sprechen" accessibilityLabel="Sprachnotiz aufnehmen" icon="mic" primary disabled={disabled} onPress={() => start('voice', true)} /><CaptureAction label="Karte" accessibilityLabel="Visitenkarte aufnehmen" icon="camera" disabled={disabled} onPress={() => start('card', true)} /></View></View>
      </View> : <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <View style={styles.conversationHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>{<Pressable accessibilityRole="button" accessibilityLabel="Besucher" onPress={() => { setShowLibrary(true); setNotice(''); }} style={{ width: 32, height: 44, alignItems: 'flex-start', justifyContent: 'center' }}><Icon name="back" size={22} /></Pressable>}<View style={{ flex: 1, minWidth: 0, gap: 3 }}>{desktop && <Eyebrow>Aktueller Besucher</Eyebrow>}<Txt weight="bold" accessibilityRole="header" style={{ fontSize: desktop ? 28 : 25, lineHeight: 34, letterSpacing: -0.8 }} numberOfLines={1}>{titleOf(draft!)}</Txt><Txt style={{ fontSize: 16, color: colors.muted }} numberOfLines={1}>{draft!.contact.company || 'Kontaktdaten folgen'}{draft!.event ? ` · ${draft!.event}` : ''}</Txt></View>{desktop && <Button label="Gespräch aufnehmen" icon="mic" kind="secondary" disabled={captureDisabled} onPress={() => start('conversation')} />}</View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><CloudStatus draft={draft!} workspace={workspace} />{!desktop && <Button label="Gespräch aufnehmen" icon="mic" kind="quiet" disabled={captureDisabled} onPress={() => start('conversation')} style={{ paddingHorizontal: 0 }} />}</View>
          {!!notice && notice !== 'Hier gespeichert.' && <Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, lineHeight: 22, color: colors.green }}>{notice}</Txt>}
          {!desktop && <View style={{ flexDirection: 'row', gap: 8 }}><Button label="Gespräch" kind={section === 'conversation' ? 'primary' : 'quiet'} onPress={() => setSection('conversation')} style={{ flex: 1 }} /><Button label="Kontakt & Bedarf" kind={section === 'details' ? 'primary' : 'quiet'} onPress={() => setSection('details')} style={{ flex: 1 }} /></View>}
        </View>
        <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: desktop ? 28 : 14, paddingBottom: 28 }}>
            {desktop || section === 'conversation' ? <View style={{ gap: 14 }}><TeamConflict key={JSON.stringify(workspace.teamView.states[draft!.id]?.comparisons)} id={draft!.id} workspace={workspace} /><Conversation key={draft!.id} draft={draft!} workspace={workspace} /></View> : details}
          </ScrollView>
          {desktop && <ScrollView style={{ width: 320, flexGrow: 0, borderLeftWidth: 1, borderColor: colors.line, backgroundColor: colors.paper }} contentContainerStyle={{ padding: 22 }}>{details}</ScrollView>}
        </View>
        <View style={styles.captureBar}>
          <Txt style={{ fontSize: 16, color: colors.muted, textAlign: 'center' }} numberOfLines={1}>Für {titleOf(draft!)}</Txt>
          <View style={{ flexDirection: 'row', gap: 10 }}><CaptureAction label="Sprachnotiz" accessibilityLabel="Sprachnotiz aufnehmen" icon="mic" primary disabled={captureDisabled} onPress={() => start('voice')} /><CaptureAction label="Karte" accessibilityLabel="Visitenkarte aufnehmen" icon="camera" disabled={captureDisabled} onPress={() => start('card')} /><CaptureAction label="Notiz" accessibilityLabel="Notiz ergänzen" icon="request" disabled={captureDisabled} onPress={() => start('note')} /></View>
        </View>
      </View>}
    </View>}
    <View style={{ paddingVertical: 3, paddingHorizontal: 12, backgroundColor: colors.paper }}><VersionHint /></View>
    {panel && <Sheet title={{ contact: 'Kontakt ergänzen', request: 'Bedarf ergänzen', card: 'Visitenkarte', voice: 'Sprachnotiz', conversation: 'Gespräch aufnehmen', note: 'Notiz ergänzen', settings: 'Dein Konto', followup: 'Kontaktaufnahme vorbereiten', backup: 'Besucher als Datei sichern', restore: 'Backup wiederherstellen', cloud: 'Persönliche Cloud-Sicherungen', scope: 'Event auswählen' }[panel.kind]} subtitle={panelDraft ? `Für ${titleOf(panelDraft)}` : panel.kind === 'restore' ? 'Angaben und Originale zusammen' : 'Konto, Angaben und Sicherungen'} locked={locked} onClose={() => { setPanel(null); setLocked(false); }}>
      {panel.kind === 'scope' ? <><Txt>Neue Besucher landen im gewählten Bereich.</Txt>{workspace.teamView.teams.map(t => <Button key={t.id} label={`${t.name} · Team`} kind={workspace.scope === t.id ? 'primary' : 'secondary'} onPress={() => { void workspace.selectScope(t.id).then(() => { setPanel(null); setShowLibrary(true); }); }} />)}<Button label="Meine persönlichen Besuche" kind={workspace.scope === 'personal' ? 'primary' : 'secondary'} onPress={() => { void workspace.selectScope('personal').then(() => { setPanel(null); setShowLibrary(true); }); }} /><Txt style={{ fontSize: 16, color: colors.muted }}>Deine bisherigen Entwürfe bleiben erhalten. Du kannst sie einzeln im Team teilen.</Txt></> : panel.kind === 'cloud' ? <CloudCopies workspace={workspace} lock={setLocked} done={() => { done(); setShowLibrary(false); setSection('conversation'); }} /> : panel.kind === 'restore' ? <RestoreBackup workspace={workspace} lock={setLocked} done={created => { setPanel(null); setLocked(false); setShowLibrary(false); setSection('conversation'); setNotice(created ? 'Besucher und Originale wurden hier wiederhergestellt.' : 'Die vorhandene Import-Kopie ist geöffnet. Deine Änderungen bleiben erhalten.'); }} /> : panel.kind === 'settings' ? <><SettingsForm workspace={workspace} done={done} />{workspace.cloudEnabled && <Button label="Persönliche Cloud-Sicherungen" icon="folder" kind="secondary" onPress={() => setPanel({ kind: 'cloud' })} />}<Button label="Backup wiederherstellen" kind="secondary" onPress={() => setPanel({ kind: 'restore' })} />{pwa.installable && <Button label="Pete installieren" icon="download" kind="secondary" onPress={() => { void pwa.install(); }} />}{pwa.offlineReady && <Txt style={{ fontSize: 16, color: colors.muted }}>Offline verfügbar. Auf dem iPhone: Safari → Teilen → Zum Home-Bildschirm.</Txt>}</> : panelDraft ? <>
        {panel.kind === 'backup' && <SaveBackup draft={panelDraft} workspace={workspace} lock={setLocked} />}
        {panel.kind === 'contact' && <ContactForm key={panelDraft.id} draft={panelDraft} workspace={workspace} done={done} />}
        {panel.kind === 'request' && <RequestForm key={panelDraft.id} draft={panelDraft} workspace={workspace} done={done} />}
        {panel.kind === 'card' && <CardCapture key={panelDraft.id} draft={panelDraft} workspace={workspace} done={done} lock={setLocked} />}
        {(panel.kind === 'voice' || panel.kind === 'conversation') && <VoiceCapture key={`${panelDraft.id}:${panel.kind}`} draft={panelDraft} workspace={workspace} done={done} lock={setLocked} initialMode={panel.kind === 'conversation' ? 'conversation' : 'memo'} autoStart={panel.kind === 'voice'} />}
        {panel.kind === 'note' && <QuickNote key={panelDraft.id} draft={panelDraft} workspace={workspace} done={done} />}
        {panel.kind === 'followup' && <FollowupForm draft={panelDraft} workspace={workspace} />}
      </> : <Txt>Dieser Besucher ist nicht mehr verfügbar.</Txt>}
    </Sheet>}
  </SafeAreaView>;
}

function CaptureAction({ label, accessibilityLabel, icon, primary, disabled, onPress }: { label: string; accessibilityLabel: string; icon: IconName; primary?: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ flex: primary ? 1.3 : 1, minHeight: 48, borderRadius: 9, backgroundColor: primary ? colors.green : colors.sage, alignItems: 'center', justifyContent: 'center', gap: 4, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 })}><Icon name={icon} color={primary ? colors.paper : colors.green} size={18} /><Txt weight="bold" style={{ fontSize: 16, lineHeight: 20, color: primary ? colors.paper : colors.green }}>{label}</Txt></Pressable>;
}

export default function App() {
  const [loaded, error] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: colors.background, padding: 36 }}><View style={{ height: 230, backgroundColor: colors.sage, borderRadius: 20 }} /></View>;
  return <SafeAreaProvider><AuthGate><WorkspaceScreen /></AuthGate></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  topbar: { minHeight: 56, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sidebar: { width: 270, backgroundColor: colors.paper, borderRightWidth: 1, borderColor: colors.line },
  draftRow: { paddingVertical: 14, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: colors.line, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 35, height: 40, backgroundColor: colors.pale, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  conversationHeader: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8, backgroundColor: colors.paper, borderBottomWidth: 1, borderColor: colors.line, gap: 4 },
  captureBar: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 6, backgroundColor: colors.paper, borderTopWidth: 1, borderColor: colors.line, gap: 7 },
  banner: { paddingHorizontal: 18, paddingVertical: 8, backgroundColor: colors.sage },
});
