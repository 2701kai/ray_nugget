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
import { exportDraft, titleOf, type CaptureKind } from './src/domain/draft';
import { downloadJson } from './src/media/files';
import { colors } from './src/ui/theme';
import { Icon, PeteMark } from './src/ui/Icon';
import { Button, ErrorNotice, Eyebrow, Field, Sheet, Txt } from './src/ui/primitives';
import { ContactForm, FollowupForm, RequestForm, SettingsForm } from './src/ui/Forms';
import { CardCapture, VoiceCapture } from './src/ui/MediaCapture';
import { DraftDetail } from './src/ui/DraftDetail';

type Panel = CaptureKind | 'settings' | 'followup' | 'detail' | null;

function WorkspaceScreen() {
  const workspace = useWorkspace();
  const { width } = useWindowDimensions();
  const desktop = width >= 1100;
  const [page, setPage] = useState<'capture' | 'drafts'>('capture');
  const [selectedId, setSelectedId] = useState<string>();
  const [panel, setPanel] = useState<Panel>(null);
  const [locked, setLocked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const creatingRef = useRef(false);
  const draft = workspace.drafts.find(record => record.id === selectedId);
  const disabled = workspace.loading || !!workspace.error || creating;

  async function start(kind: CaptureKind, forceNew = false) {
    if (creatingRef.current || disabled) return;
    creatingRef.current = true; setCreating(true); setError(''); setNotice('');
    try {
      const next = forceNew || !draft ? await workspace.create(kind) : draft;
      setSelectedId(next.id); setPanel(kind); setPage('capture');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start this draft.'); }
    finally { creatingRef.current = false; setCreating(false); }
  }
  function done() { setPanel(null); setLocked(false); setNotice('Saved on this device.'); }
  async function exportRecord() {
    if (!draft) return;
    try { await downloadJson(`pete-draft-${draft.id.slice(0, 8)}.json`, exportDraft(draft)); setNotice('Exported draft metadata. Original media stays on this device.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Export failed.'); }
  }
  const list = workspace.drafts.filter(record => `${record.contact.name} ${record.contact.company} ${record.event} ${record.request.product}`.toLowerCase().includes(query.toLowerCase()));
  const detail = <DraftDetail draft={draft} workspace={workspace} edit={kind => setPanel(kind)} intro={() => setPanel('followup')} exportRecord={exportRecord} />;

  return <SafeAreaView style={styles.root}>
    {desktop && <View style={styles.sidebar}>
      <View style={styles.brand}><PeteMark /><View><Txt weight="extra" style={{ fontSize: 27, lineHeight: 31, letterSpacing: -1.5 }}>pete.</Txt><Txt style={{ fontSize: 9, color: colors.muted, letterSpacing: 1.5 }}>BY BEVMAQ</Txt></View></View>
      <View style={{ marginTop: 46, gap: 8 }}><Eyebrow>YOUR WORKSPACE</Eyebrow>{([{ key: 'capture', label: 'Capture', icon: 'spark' }, { key: 'drafts', label: 'Drafts', icon: 'folder' }] as const).map(item => <Pressable accessibilityRole="button" key={item.key} onPress={() => setPage(item.key)} style={[styles.navItem, page === item.key && { backgroundColor: colors.sage }]}><Icon name={item.icon} size={19} color={page === item.key ? colors.green : colors.muted} /><Txt weight={page === item.key ? 'bold' : 'medium'} style={{ flex: 1, fontSize: 12, color: page === item.key ? colors.green : colors.muted }}>{item.label}</Txt>{item.key === 'drafts' && <Txt style={{ fontSize: 10, color: colors.muted }}>{workspace.drafts.length}</Txt>}</Pressable>)}</View>
      <View style={{ flex: 1 }} />
      <View style={{ padding: 16, backgroundColor: colors.pale, borderRadius: 12, gap: 8 }}><Icon name="shield" size={20} color={colors.green} /><Txt weight="semibold" style={{ fontSize: 11 }}>Yours to keep.</Txt><Txt style={{ fontSize: 10, lineHeight: 17, color: colors.muted }}>Originals are saved on this device. Review extracted details before using them.</Txt></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Your details" onPress={() => setPanel('settings')} style={[styles.navItem, { marginTop: 18 }]}><View style={styles.avatar}><Txt weight="bold" style={{ color: colors.green, fontSize: 12 }}>{workspace.preferences.sender.name.charAt(0).toUpperCase() || 'Y'}</Txt></View><View style={{ flex: 1 }}><Txt weight="semibold" style={{ fontSize: 11 }}>{workspace.preferences.sender.name || 'Your details'}</Txt><Txt style={{ fontSize: 9, color: colors.muted }}>Sales workspace</Txt></View><Icon name="settings" size={16} color={colors.muted} /></Pressable>
    </View>}
    <View style={{ flex: 1 }}>
      <View style={[styles.topbar, { paddingHorizontal: desktop ? 36 : 20 }]}>
        {!desktop ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><PeteMark size={30} /><Txt weight="extra" style={{ fontSize: 22, letterSpacing: -1 }}>pete.</Txt></View> : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ width: 6, height: 6, backgroundColor: colors.green, borderRadius: 3 }} /><Txt style={{ fontSize: 11, color: colors.muted }}>Field workspace</Txt></View>}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Pressable accessibilityRole="button" accessibilityLabel="Set visit or event" onPress={() => setPanel('settings')} style={styles.event}><Icon name="flag" size={14} color={colors.muted} /><Txt style={{ fontSize: 10, color: colors.muted }} numberOfLines={1}>{workspace.preferences.event || 'Set visit or event'}</Txt></Pressable><Button label={desktop ? 'Your details' : 'Settings'} icon="settings" kind="quiet" onPress={() => setPanel('settings')} style={{ paddingHorizontal: 4 }} /></View>
      </View>
      <ScrollView contentContainerStyle={{ padding: desktop ? 36 : 20, gap: 26, maxWidth: 1500, width: '100%', alignSelf: 'center', paddingBottom: 70 }} keyboardShouldPersistTaps="handled">
        {!desktop && <View style={{ flexDirection: 'row', gap: 8 }}><Button label="Capture" icon="spark" kind={page === 'capture' ? 'primary' : 'secondary'} onPress={() => setPage('capture')} /><Button label={`Drafts (${workspace.drafts.length})`} icon="folder" kind={page === 'drafts' ? 'primary' : 'secondary'} onPress={() => setPage('drafts')} /></View>}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <View style={{ gap: 8 }}><Eyebrow>{!desktop ? 'FIELD WORKSPACE' : page === 'capture' ? 'MAKE EVERY CONVERSATION COUNT' : 'YOUR CONVERSATIONS, COLLECTED'}</Eyebrow><Txt weight="bold" accessibilityRole="header" style={{ fontSize: desktop ? 34 : 28, lineHeight: desktop ? 44 : 36, letterSpacing: -1.4 }}>{!desktop ? page === 'capture' ? 'Capture.' : 'Your drafts.' : page === 'capture' ? 'A good conversation.\nNothing left behind.' : 'Pick up where you left off.'}</Txt></View>
          <Button label="New visitor" icon="plus" kind="secondary" disabled={disabled} onPress={() => start('contact', true)} />
        </View>
        <ErrorNotice message={error || workspace.error} />
        {!!workspace.error && <Button label="Retry local storage" onPress={workspace.retry} />}
        {!!notice && <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon name="check" size={14} color={colors.green} /><Txt style={{ fontSize: 11, color: colors.green }}>{notice}</Txt></View>}
        {workspace.loading ? <View style={{ gap: 16 }}><View style={{ height: 220, backgroundColor: colors.sage, borderRadius: 22 }} /><View style={{ height: 110, backgroundColor: colors.pale, borderRadius: 16 }} /><Txt style={{ color: colors.muted }}>Opening your local drafts…</Txt></View> :
          <View style={{ flexDirection: desktop ? 'row' : 'column', alignItems: 'stretch', gap: 26 }}>
            <View style={{ flex: 1, minWidth: 0, gap: 22 }}>
              {page === 'capture' ? <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: colors.sage, justifyContent: 'center', alignItems: 'center' }}><Icon name="contact" size={14} color={colors.green} /></View><Txt style={{ flex: 1, fontSize: 11, color: colors.muted }} numberOfLines={1}>{draft ? `Adding to ${titleOf(draft)}` : 'Your next capture starts a new visitor draft'}</Txt>{draft && !desktop && <Button label="View draft" kind="quiet" onPress={() => setPanel('detail')} style={{ paddingHorizontal: 0 }} />}{draft && desktop && <Pressable accessibilityRole="button" onPress={() => { setSelectedId(undefined); setNotice(''); }}><Txt weight="bold" style={{ fontSize: 11, color: colors.green }}>Start fresh</Txt></Pressable>}</View>
                <Pressable accessibilityRole="button" accessibilityLabel="Capture a voice note" disabled={disabled} onPress={() => start('voice')} style={({ pressed }) => [styles.voiceCard, !desktop && { minHeight: 210, padding: 22 }, { opacity: pressed ? 0.9 : 1 }]}>
                  <View style={{ gap: 12, flex: 1 }}><View style={{ alignSelf: 'flex-start', borderWidth: 1, borderColor: '#64806B', borderRadius: 6, paddingHorizontal: 9, paddingVertical: 2 }}><Txt weight="semibold" style={{ color: colors.accent, fontSize: 9, letterSpacing: 1 }}>SPEAK. SAVE. KEEP MOVING.</Txt></View><Txt weight="semibold" style={{ color: colors.paper, fontSize: 27, lineHeight: 36, letterSpacing: -0.7 }}>Capture a{desktop ? '\n' : ' '}voice note.</Txt><Txt style={{ color: '#C4D4C8', fontSize: 12, lineHeight: 21, maxWidth: 240 }}>The details are fresh. Get them down in your own words.</Txt><View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 7 }}><Txt weight="bold" style={{ color: colors.accent, fontSize: 12 }}>Start recording</Txt><Icon name="arrow" size={16} color={colors.accent} /></View></View>
                  <View style={[styles.micRing, { width: desktop ? 130 : 82, height: desktop ? 130 : 82, borderRadius: 80 }]}><View style={{ width: desktop ? 90 : 64, height: desktop ? 90 : 64, backgroundColor: colors.accent, borderRadius: 50, alignItems: 'center', justifyContent: 'center' }}><Icon name="mic" size={desktop ? 36 : 27} color={colors.green} /></View></View>
                </Pressable>
                <View style={{ gap: 13 }}><Txt weight="semibold" style={{ fontSize: 13 }}>Or start with what you have.</Txt><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{([
                  { kind: 'contact', icon: 'contact', label: 'Contact', detail: 'A name. A connection.' },
                  { kind: 'card', icon: 'card', label: 'Business card', detail: 'Keep the original.' },
                  { kind: 'request', icon: 'request', label: 'Request', detail: 'What are they looking for?' },
                ] as const).map(item => <Pressable key={item.kind} accessibilityRole="button" accessibilityLabel={`Capture ${item.label.toLowerCase()}`} disabled={disabled} onPress={() => start(item.kind)} style={({ pressed }) => [styles.captureTile, !desktop && { minWidth: 88, padding: 12, gap: 12 }, { backgroundColor: pressed ? colors.sage : colors.paper }]}><View style={styles.tileIcon}><Icon name={item.icon} color={colors.green} /></View><View style={{ gap: 4 }}><Txt weight="bold" style={{ fontSize: 12 }}>{item.label}</Txt><Txt style={{ fontSize: 10, color: colors.muted, lineHeight: 17 }}>{item.detail}</Txt></View><View style={{ alignSelf: 'flex-end', marginTop: 6 }}><Icon name="arrow" size={15} color={colors.muted} /></View></Pressable>)}</View></View>
                <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 22, gap: 14 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Eyebrow>RECENT DRAFTS</Eyebrow><Button label="View all" kind="quiet" icon="arrow" onPress={() => setPage('drafts')} style={{ minHeight: 24, paddingHorizontal: 0 }} /></View>{workspace.drafts.length ? workspace.drafts.slice(0, 3).map(record => <DraftRow key={record.id} title={titleOf(record)} company={record.contact.company || record.event || 'Details to follow'} selected={record.id === selectedId} count={record.attachments.length} onPress={() => { setSelectedId(record.id); setNotice(''); }} />) : <View style={{ paddingVertical: 14, gap: 5 }}><Txt weight="semibold" style={{ fontSize: 12 }}>A fresh page for your next connection.</Txt><Txt style={{ fontSize: 11, color: colors.muted }}>Your first capture will appear here.</Txt></View>}</View>
              </> : <>
                <Field label="Find a draft" placeholder="Name, company, event, product…" value={query} onChangeText={setQuery} />
                {list.length ? list.map(record => <DraftRow key={record.id} title={titleOf(record)} company={record.contact.company || record.event || 'Details to follow'} selected={record.id === selectedId} count={record.attachments.length} onPress={() => { setSelectedId(record.id); setNotice(''); }} />) : <View style={{ padding: 32, gap: 12, alignItems: 'center' }}><Icon name="folder" size={36} color={colors.muted} /><Txt weight="semibold">{query ? 'No matching drafts' : 'No drafts yet'}</Txt><Txt style={{ fontSize: 12, color: colors.muted }}>Start with any capture to create one.</Txt><Button label="Go to capture" onPress={() => setPage('capture')} kind="secondary" /></View>}
              </>}
            </View>
            <View style={[styles.detail, { width: desktop ? 330 : '100%' }]}>{detail}</View>
          </View>}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderColor: colors.line, paddingTop: 18, gap: 12 }}><Txt style={{ fontSize: 10, color: colors.muted }}>Built for the conversation, not the paperwork.</Txt><Txt weight="bold" style={{ fontSize: 9, color: colors.muted, letterSpacing: 1.4 }}>PETE · PREVIEW</Txt></View>
      </ScrollView>
    </View>
    {panel && <Sheet title={{ contact: 'A new connection.', request: 'What do they need?', card: 'Keep their card.', voice: 'Say it while it’s fresh.', settings: 'Your details.', followup: 'Keep the conversation going.', detail: 'Visitor draft.' }[panel]} subtitle={panel === 'settings' ? 'Your identity and default visit context' : draft ? `For ${titleOf(draft)}` : undefined} locked={locked} onClose={() => { setPanel(null); setLocked(false); }}>
      {panel === 'settings' ? <SettingsForm workspace={workspace} done={done} /> : draft ? <>
        {panel === 'contact' && <ContactForm draft={draft} workspace={workspace} done={done} />}
        {panel === 'request' && <RequestForm draft={draft} workspace={workspace} done={done} />}
        {panel === 'card' && <CardCapture draft={draft} workspace={workspace} done={done} lock={setLocked} />}
        {panel === 'voice' && <VoiceCapture draft={draft} workspace={workspace} done={done} lock={setLocked} />}
        {panel === 'followup' && <FollowupForm draft={draft} workspace={workspace} />}
        {panel === 'detail' && detail}
      </> : <Txt>Select a visitor draft first.</Txt>}
    </Sheet>}
  </SafeAreaView>;
}

function DraftRow({ title, company, count, selected, onPress }: { title: string; company: string; count: number; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open draft ${title}`} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, backgroundColor: selected ? colors.sage : colors.paper, borderWidth: 1, borderColor: selected ? '#BFCFBB' : colors.line }}><View style={{ width: 34, height: 38, borderRadius: 8, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }}><Txt weight="bold" style={{ color: colors.green, fontSize: 14 }}>{title.charAt(0).toUpperCase()}</Txt></View><View style={{ flex: 1 }}><Txt weight="semibold" style={{ fontSize: 12 }} numberOfLines={1}>{title}</Txt><Txt style={{ fontSize: 10, color: colors.muted }} numberOfLines={1}>{company}</Txt></View>{count > 0 && <Txt style={{ fontSize: 10, color: colors.muted }}>{count} file{count === 1 ? '' : 's'}</Txt>}<Icon name="chevron" size={14} color={colors.muted} /></Pressable>;
}

export default function App() {
  const [loaded, error] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: colors.background, padding: 36, gap: 20 }}><View style={{ height: 60, width: 180, borderRadius: 10, backgroundColor: colors.sage }} /><View style={{ height: 230, backgroundColor: colors.sage, borderRadius: 20 }} /></View>;
  return <SafeAreaProvider><WorkspaceScreen /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  sidebar: { width: 208, padding: 22, backgroundColor: colors.paper, borderRightWidth: 1, borderColor: colors.line, gap: 10 },
  brand: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingTop: 5 },
  navItem: { padding: 11, borderRadius: 9, flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 44 },
  avatar: { backgroundColor: colors.sage, height: 32, width: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  topbar: { minHeight: 73, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  event: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.background, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 7, maxWidth: 220 },
  voiceCard: { borderRadius: 20, backgroundColor: colors.green, padding: 28, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 250, overflow: 'hidden' },
  micRing: { borderWidth: 1, borderColor: '#65816A', alignItems: 'center', justifyContent: 'center' },
  captureTile: { flex: 1, minWidth: 125, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 17, gap: 18 },
  tileIcon: { width: 37, height: 37, borderRadius: 10, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' },
  detail: { borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.paper, padding: 23, alignSelf: 'flex-start' },
});
