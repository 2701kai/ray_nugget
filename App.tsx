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
import { Conversation } from './src/ui/Conversation';
import { QuickNote } from './src/ui/QuickNote';
import { AuthGate } from './src/ui/AuthGate';
import { RestoreBackup, SaveBackup } from './src/ui/Backup';

type Kind = CaptureKind | 'settings' | 'followup' | 'note' | 'conversation' | 'backup' | 'restore';
type Panel = { kind: Kind; draftId?: string };

function WorkspaceScreen() {
  const workspace = useWorkspace();
  const pwa = usePwa();
  const { width } = useWindowDimensions();
  const desktop = width >= 1100;
  const [showLibrary, setShowLibrary] = useState(false);
  const [section, setSection] = useState<'conversation' | 'details'>('conversation');
  const [panel, setPanel] = useState<Panel | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const changing = useRef(false);
  const draft = workspace.drafts.find(record => record.id === workspace.activeDraftId);
  const panelDraft = workspace.drafts.find(record => record.id === panel?.draftId);
  const library = showLibrary || !draft;
  const disabled = workspace.loading || !!workspace.error || busy;
  const list = workspace.drafts.filter(record => `${record.contact.name} ${record.contact.company} ${record.event} ${record.request.product}`.toLowerCase().includes(query.toLowerCase()));

  async function start(kind: CaptureKind | 'note' | 'conversation', forceNew = false) {
    if (changing.current || disabled) return;
    changing.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const entry: CaptureKind = kind === 'conversation' ? 'voice' : kind === 'note' ? 'contact' : kind;
      const target = forceNew || !draft || library ? await workspace.create(entry) : draft;
      setShowLibrary(false); setSection('conversation');
      setPanel({ kind, draftId: target.id });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the conversation.'); }
    finally { changing.current = false; setBusy(false); }
  }
  async function openDraft(id: string) {
    if (changing.current) return;
    changing.current = true; setBusy(true); setError('');
    try { await workspace.activateDraft(id); setShowLibrary(false); setSection('conversation'); setNotice(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open this draft.'); }
    finally { changing.current = false; setBusy(false); }
  }
  function done() { setPanel(null); setLocked(false); setNotice('Saved on this device.'); }
  async function exportRecord() {
    if (!draft) return;
    try { await downloadJson(`pete-draft-${draft.id.slice(0, 8)}.json`, { ...exportDraft(draft), processing: workspace.jobs.filter(job => job.draftId === draft.id).map(({ leaseId, ...job }) => job) }); setNotice('Exported draft and source text. Original media stays on this device.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Export failed.'); }
  }
  const details = <DraftDetail draft={draft} workspace={workspace} showMedia={false} edit={kind => draft && setPanel({ kind, draftId: draft.id })} intro={() => draft && setPanel({ kind: 'followup', draftId: draft.id })} backup={() => draft && setPanel({ kind: 'backup', draftId: draft.id })} exportRecord={exportRecord} />;
  const renderRow = (record: Draft) => <Pressable key={record.id} accessibilityRole="button" accessibilityLabel={`Open draft ${titleOf(record)}`} disabled={busy} onPress={() => openDraft(record.id)} style={({ pressed }) => [styles.draftRow, { backgroundColor: pressed || record.id === draft?.id ? colors.sage : colors.paper }]}>
    <View style={styles.avatar}><Txt weight="bold" style={{ color: colors.green }}>{titleOf(record).charAt(0).toUpperCase()}</Txt></View>
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Txt weight="bold" style={{ fontSize: 13 }} numberOfLines={1}>{titleOf(record)}</Txt><Txt style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>{record.contact.company || record.event || 'Details to follow'}</Txt><Txt style={{ fontSize: 10, color: colors.muted }}>{record.attachments.length} captures · {rfqGaps(record.request).length ? 'Request to complete' : 'Request captured'}</Txt></View><Icon name="chevron" size={15} color={colors.muted} />
  </Pressable>;

  return <SafeAreaView style={styles.root}>
    <View style={styles.topbar}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><PeteMark size={32} /><Txt weight="extra" style={{ fontSize: 25, letterSpacing: -1 }}>pete.</Txt>{desktop && <Txt style={{ color: colors.muted, fontSize: 10, letterSpacing: 1 }}>BY BEVMAQ</Txt>}</View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {desktop && pwa.installable && <Button label="Install Pete" kind="quiet" icon="download" onPress={() => { void pwa.install(); }} />}
        {desktop ? <Button label="Your details" icon="settings" kind="quiet" onPress={() => setPanel({ kind: 'settings' })} /> : <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => setPanel({ kind: 'settings' })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="settings" /></Pressable>}
        <Button label="New visitor" icon="plus" kind="secondary" disabled={disabled} onPress={() => start('contact', true)} style={{ paddingHorizontal: 12 }} />
      </View>
    </View>
    {!pwa.online && <View style={styles.banner}><Txt style={{ fontSize: 12, color: colors.green }}>Offline · capture continues on this device. Processing resumes when connected.</Txt></View>}
    {pwa.updateReady && <View style={styles.banner}><Txt style={{ fontSize: 11, color: colors.muted }}>An update is ready. After saving, close Pete’s tabs and reopen the app.</Txt></View>}
    <ErrorNotice message={error || workspace.error} />
    {!!workspace.error && <Button label="Retry local storage" onPress={workspace.retry} />}
    {workspace.loading ? <View style={{ padding: 24, gap: 16 }}><View style={{ height: 70, backgroundColor: colors.sage, borderRadius: 16 }} /><View style={{ height: 220, backgroundColor: colors.sage, borderRadius: 20 }} /><Txt>Opening your conversations…</Txt></View> : <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
      {desktop && <View style={styles.sidebar}><View style={{ padding: 20, gap: 14 }}><Eyebrow>YOUR CONVERSATIONS</Eyebrow><Field label="Find a draft" placeholder="Name, company…" value={query} onChangeText={setQuery} /></View><ScrollView contentContainerStyle={{ paddingHorizontal: 14, gap: 9, paddingBottom: 24 }}>{list.map(renderRow)}</ScrollView><View style={{ padding: 20, gap: 6 }}><Icon name="shield" size={20} color={colors.green} /><Txt style={{ fontSize: 11, color: colors.muted }}>{pwa.offlineReady ? 'Ready to reopen offline.' : 'Originals saved on this device.'}</Txt></View></View>}
      {library ? <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: desktop ? 42 : 20, gap: 25, maxWidth: 800, width: '100%', alignSelf: 'center' }}>
        <View style={{ gap: 8 }}><Eyebrow>YOUR FIELD WORKSPACE</Eyebrow><Txt weight="bold" style={{ fontSize: 30, lineHeight: 38, letterSpacing: -1 }}>Every visitor. One conversation.</Txt><Txt style={{ color: colors.muted }}>Open a draft to pick up where you left off, or start with what you have.</Txt></View>
        <View style={{ gap: 10 }}>
          <Button label="Capture a voice note" icon="mic" disabled={disabled} onPress={() => start('voice', true)} />
          <View style={{ flexDirection: 'row', gap: 10 }}><Button label="Capture business card" icon="camera" kind="secondary" disabled={disabled} onPress={() => start('card', true)} style={{ flex: 1 }} /><Button label="Capture contact" icon="contact" kind="secondary" disabled={disabled} onPress={() => start('contact', true)} style={{ flex: 1 }} /></View>
          <Button label="Capture request" icon="request" kind="quiet" disabled={disabled} onPress={() => start('request', true)} />
        </View>
        {!desktop && <><Field label="Find a draft" placeholder="Name, company, event…" value={query} onChangeText={setQuery} /><View style={{ gap: 10 }}>{list.map(renderRow)}</View></>}
        {!list.length && <View style={{ paddingVertical: 20, gap: 8 }}><Icon name="folder" color={colors.muted} /><Txt weight="semibold">{query ? 'No matching conversations.' : 'Your first connection starts here.'}</Txt><Txt style={{ color: colors.muted, fontSize: 12 }}>Voice, card, contact, or request—all four can start a draft.</Txt></View>}
        <Txt style={{ color: colors.muted, fontSize: 11 }}>{pwa.offlineReady ? 'Pete is ready to reopen offline.' : 'Saved drafts and original captures stay on this device.'}</Txt>
        <Button label="Restore a backup" kind="quiet" disabled={disabled} onPress={() => setPanel({ kind: 'restore' })} />
      </ScrollView> : <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <View style={styles.conversationHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>{!desktop && <Pressable accessibilityRole="button" accessibilityLabel="Drafts" onPress={() => { setShowLibrary(true); setNotice(''); }} style={{ width: 32, height: 44, alignItems: 'flex-start', justifyContent: 'center' }}><Icon name="back" size={22} /></Pressable>}<View style={{ flex: 1, minWidth: 0, gap: 3 }}>{desktop && <Eyebrow>CURRENT VISITOR</Eyebrow>}<Txt weight="bold" accessibilityRole="header" style={{ fontSize: desktop ? 28 : 25, lineHeight: 34, letterSpacing: -0.8 }} numberOfLines={1}>{titleOf(draft!)}</Txt><Txt style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>{draft!.contact.company || 'Contact details to follow'}{draft!.event ? ` · ${draft!.event}` : ''}</Txt></View>{desktop && <Button label="Record conversation" icon="mic" kind="secondary" onPress={() => start('conversation')} />}</View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><Txt accessibilityLiveRegion="polite" style={{ fontSize: 11, color: colors.green }}>{notice || 'Saved locally'}</Txt>{!desktop && <Button label="Record conversation" icon="mic" kind="quiet" onPress={() => start('conversation')} style={{ paddingHorizontal: 0, minHeight: 32 }} />}</View>
          {!desktop && <View style={{ flexDirection: 'row', gap: 8 }}><Button label="Conversation" kind={section === 'conversation' ? 'primary' : 'quiet'} onPress={() => setSection('conversation')} style={{ flex: 1, minHeight: 35 }} /><Button label="Details & request" kind={section === 'details' ? 'primary' : 'quiet'} onPress={() => setSection('details')} style={{ flex: 1, minHeight: 35 }} /></View>}
        </View>
        <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: desktop ? 28 : 20, paddingBottom: 28 }}>
            {desktop || section === 'conversation' ? <Conversation key={draft!.id} draft={draft!} workspace={workspace} /> : details}
          </ScrollView>
          {desktop && <ScrollView style={{ width: 320, flexGrow: 0, borderLeftWidth: 1, borderColor: colors.line, backgroundColor: colors.paper }} contentContainerStyle={{ padding: 22 }}>{details}</ScrollView>}
        </View>
        <View style={styles.captureBar}>
          <Txt style={{ fontSize: 10, color: colors.muted, textAlign: 'center' }} numberOfLines={1}>Adding to {titleOf(draft!)}</Txt>
          <View style={{ flexDirection: 'row', gap: 10 }}><CaptureAction label="Voice note" accessibilityLabel="Capture a voice note" icon="mic" primary onPress={() => start('voice')} /><CaptureAction label="Card photo" accessibilityLabel="Capture business card" icon="camera" onPress={() => start('card')} /><CaptureAction label="Quick note" accessibilityLabel="Add quick note" icon="request" onPress={() => start('note')} /></View>
        </View>
      </View>}
    </View>}
    {panel && <Sheet title={{ contact: 'A new connection.', request: 'What do they need?', card: 'Keep their card.', voice: 'Voice note.', conversation: 'Record the conversation.', note: 'A detail worth keeping.', settings: 'Your details.', followup: 'Keep the conversation going.', backup: 'Keep a backup.', restore: 'Recover a conversation.' }[panel.kind]} subtitle={panelDraft ? `For ${titleOf(panelDraft)}` : panel.kind === 'restore' ? 'Draft and original files, together' : 'Your identity and visit context'} locked={locked} onClose={() => { setPanel(null); setLocked(false); }}>
      {panel.kind === 'restore' ? <RestoreBackup workspace={workspace} lock={setLocked} done={created => { setPanel(null); setLocked(false); setShowLibrary(false); setSection('conversation'); setNotice(created ? 'Restored draft and originals on this device.' : 'Opened the existing restored draft. Your edits are kept.'); }} /> : panel.kind === 'settings' ? <><SettingsForm workspace={workspace} done={done} /><Button label="Restore a backup" kind="secondary" onPress={() => setPanel({ kind: 'restore' })} />{pwa.installable && <Button label="Install Pete" icon="download" kind="secondary" onPress={() => { void pwa.install(); }} />}{pwa.offlineReady && <Txt style={{ fontSize: 12, color: colors.muted }}>Ready to reopen offline. On iPhone, use Safari’s Share menu → Add to Home Screen.</Txt>}</> : panelDraft ? <>
        {panel.kind === 'backup' && <SaveBackup draft={panelDraft} workspace={workspace} lock={setLocked} />}
        {panel.kind === 'contact' && <ContactForm key={panelDraft.id} draft={panelDraft} workspace={workspace} done={done} />}
        {panel.kind === 'request' && <RequestForm key={panelDraft.id} draft={panelDraft} workspace={workspace} done={done} />}
        {panel.kind === 'card' && <CardCapture key={panelDraft.id} draft={panelDraft} workspace={workspace} done={done} lock={setLocked} />}
        {(panel.kind === 'voice' || panel.kind === 'conversation') && <VoiceCapture key={`${panelDraft.id}:${panel.kind}`} draft={panelDraft} workspace={workspace} done={done} lock={setLocked} initialMode={panel.kind === 'conversation' ? 'conversation' : 'memo'} autoStart={panel.kind === 'voice'} />}
        {panel.kind === 'note' && <QuickNote key={panelDraft.id} draft={panelDraft} workspace={workspace} done={done} />}
        {panel.kind === 'followup' && <FollowupForm draft={panelDraft} workspace={workspace} />}
      </> : <Txt>This visitor draft is no longer available.</Txt>}
    </Sheet>}
  </SafeAreaView>;
}

function CaptureAction({ label, accessibilityLabel, icon, primary, onPress }: { label: string; accessibilityLabel: string; icon: IconName; primary?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => ({ flex: primary ? 1.3 : 1, minHeight: 64, borderRadius: 15, backgroundColor: primary ? colors.green : colors.sage, alignItems: 'center', justifyContent: 'center', gap: 4, opacity: pressed ? 0.75 : 1 })}><Icon name={icon} color={primary ? colors.paper : colors.green} size={24} /><Txt weight="bold" style={{ fontSize: 11, color: primary ? colors.paper : colors.green }}>{label}</Txt></Pressable>;
}

export default function App() {
  const [loaded, error] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: colors.background, padding: 36 }}><View style={{ height: 230, backgroundColor: colors.sage, borderRadius: 20 }} /></View>;
  return <SafeAreaProvider><AuthGate><WorkspaceScreen /></AuthGate></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  topbar: { minHeight: 68, paddingHorizontal: 18, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sidebar: { width: 270, backgroundColor: colors.paper, borderRightWidth: 1, borderColor: colors.line },
  draftRow: { padding: 13, borderWidth: 1, borderColor: colors.line, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 35, height: 40, backgroundColor: colors.pale, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  conversationHeader: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12, backgroundColor: colors.paper, borderBottomWidth: 1, borderColor: colors.line, gap: 9 },
  captureBar: { paddingHorizontal: 18, paddingTop: 9, paddingBottom: 12, backgroundColor: colors.paper, borderTopWidth: 1, borderColor: colors.line, gap: 7 },
  banner: { paddingHorizontal: 18, paddingVertical: 8, backgroundColor: colors.sage },
});
