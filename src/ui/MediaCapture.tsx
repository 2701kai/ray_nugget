import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useCaptureRecorder } from '../media/useCaptureRecorder';
import { useUnsavedRecording } from '../media/useUnsavedRecording';
import { saveRecording } from '../media/files';
import { MAX_MEDIA_BYTES, MAX_RECORDING_SECONDS, MAX_CONVERSATION_SECONDS, titleOf, type Draft } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import { Button, Choice, ErrorNotice, Txt } from './primitives';
import { colors, fonts } from './theme';
import { Icon } from './Icon';

export function CardCapture({ draft, workspace, done, lock }: { draft: Draft; workspace: Workspace; done: () => void; lock: (locked: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  async function pick(camera: boolean) {
    if (active.current) return;
    active.current = true; setError(''); setBusy(true); lock(true);
    try {
      if (camera && Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Camera access is off. Allow it in device settings or choose a photo instead.');
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false, cameraType: ImagePicker.CameraType.back };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_MEDIA_BYTES) throw new Error('Choose an image smaller than 15 MB.');
      await workspace.attach(draft.id, asset.uri, { kind: 'card', name: asset.fileName || 'Business card.jpg', mimeType: asset.mimeType || 'image/jpeg' });
      done();
    } catch (e) { setError(e instanceof Error ? e.message : 'The photo could not be saved. Please try again.'); }
    finally { active.current = false; setBusy(false); lock(false); }
  }
  return <>
    <View style={{ padding: 32, minHeight: 170, backgroundColor: colors.pale, borderRadius: 16, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 14 }}><Icon name="card" size={42} color={colors.green} /><Txt weight="semibold">One card. Keep the connection.</Txt><Txt style={{ color: colors.muted, fontSize: 16, textAlign: 'center' }}>Keep the card in frame and the text in focus.</Txt></View>
    <ErrorNotice message={error} />
    <Button label={busy ? 'Saving photo…' : 'Take a photo'} icon="camera" disabled={busy} onPress={() => pick(true)} />
    <Button label={busy ? 'Saving photo…' : 'Choose a card photo'} icon="card" disabled={busy} onPress={() => pick(false)} kind="secondary" />
    {Platform.OS === 'web' && <Txt style={{ fontSize: 16, color: colors.muted }}>On a phone, Take a photo requests the rear camera. Your browser may offer a camera or file chooser.</Txt>}
    <Txt style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>{workspace.cloudEnabled ? 'Photo saved here and backed up automatically to company cloud. Pete reads the text on this device; Google in the EU fills the details from it.' : 'The original photo stays on this device. Pete reads the text locally.'}</Txt>
  </>;
}

export function VoiceCapture({ draft, workspace, done, lock, initialMode = 'memo', autoStart = false, compact = false, onClose }: { draft: Draft; workspace: Workspace; done: () => void; lock: (locked: boolean) => void; initialMode?: 'memo' | 'conversation'; autoStart?: boolean; compact?: boolean; onClose?: () => void }) {
  const [mode, setMode] = useState<'memo' | 'conversation'>(initialMode);
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'recording' | 'saving' | 'retry'>('idle');
  const [error, setError] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const pendingUri = useRef<string | null>(null);
  const active = useRef(false);
  const finishRef = useRef<() => void>(() => undefined);
  const { recorder, status, requestPermission, setMode: setRecordingMode } = useCaptureRecorder(status => {
    if (status.url) {
      pendingUri.current = status.url;
      if (!active.current) finishRef.current();
    } else if (status.hasError || status.mediaServicesDidReset) {
      setPhase('idle'); setError(status.error || 'Recording was interrupted. Check the microphone and try again.');
      if (!active.current) lock(false);
    }
  });
  useUnsavedRecording(phase !== 'idle');
  const seconds = Math.floor(status.durationMillis / 1000);
  const limit = mode === 'conversation' ? MAX_CONVERSATION_SECONDS : MAX_RECORDING_SECONDS;
  useEffect(() => {
    if (phase === 'recording' && seconds >= limit) finishRef.current();
  }, [seconds, phase, limit]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state !== 'active' && recorder.isRecording) finishRef.current(); });
    return () => { sub.remove(); lock(false); };
  }, [recorder]);

  async function start() {
    if (active.current || (mode === 'conversation' && !consent)) return;
    active.current = true; setPhase('preparing'); setError(''); lock(true);
    try {
      if (!(await requestPermission()).granted) throw new Error('Microphone access is off. Allow it in device or browser settings, then try again.');
      await setRecordingMode(true);
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('recording');
    } catch (e) { setPhase('idle'); lock(false); setError(e instanceof Error ? e.message : 'Recording could not start.'); }
    finally { active.current = false; }
  }
  useEffect(() => { if (autoStart && initialMode === 'memo') void start(); }, []);
  async function finish() {
    if (active.current) return;
    active.current = true; setError(''); setPhase('saving'); lock(true);
    try {
      if (!pendingUri.current) {
        await recorder.stop();
        pendingUri.current = recorder.uri;
      }
      if (!pendingUri.current) throw new Error('No recording was returned. Please start a new note.');
      await setRecordingMode(false);
      const mimeType = Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
      await workspace.attach(draft.id, pendingUri.current, {
        kind: 'voice', name: mode === 'memo' ? 'Voice note' : 'Consented conversation', mimeType,
        voiceMode: mode, consentConfirmed: mode === 'conversation' ? consent : undefined,
      });
      pendingUri.current = null; done();
    } catch (e) { setPhase(pendingUri.current ? 'retry' : 'idle'); setError(e instanceof Error ? e.message : 'The recording could not be saved.'); }
    finally { active.current = false; lock(!!pendingUri.current); }
  }
  finishRef.current = () => { void finish(); };
  const recording = phase === 'recording';
  const action = recording ? 'Stop and save recording' : phase === 'retry' ? 'Retry saving recording' : phase === 'saving' ? 'Saving recording…' : phase === 'preparing' ? 'Preparing microphone…' : 'Start recording';
  const feedback = phase === 'saving' ? 'Saving the original recording…' : phase === 'preparing' ? 'Preparing microphone…' : recording ? 'Recording · stop to save to this visitor' : phase === 'retry' ? 'Not saved yet · keep this page open' : mode === 'conversation' ? 'Up to 30 minutes. Stop and save when you are done.' : 'A short note is all you need. Up to 3 minutes.';
  const timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return <>
    {compact && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}><Txt weight="bold" style={{ fontSize: 16, lineHeight: 22 }}>{mode === 'memo' ? 'Voice note' : 'Conversation recording'}</Txt><Txt numberOfLines={1} style={{ fontSize: 16, lineHeight: 22, color: colors.muted }}>For {titleOf(draft)}</Txt></View>
      <Txt style={{ fontSize: 22, lineHeight: 30, fontVariant: ['tabular-nums'], fontFamily: fonts.semibold }}>{timer}</Txt>
      <Button label="" accessibilityLabel="Close" icon="close" kind="quiet" onPress={() => { if (phase === 'idle') onClose?.(); }} disabled={phase !== 'idle'} style={{ width: 44, paddingHorizontal: 0 }} />
    </View>}
    {!compact && phase === 'idle' && <Choice label="What are you recording?" value={mode} options={[{ value: 'memo', label: 'My own voice memo' }, { value: 'conversation', label: 'Conversation' }]} onChange={setMode} />}
    {mode === 'conversation' && phase === 'idle' && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} aria-checked={consent} accessibilityLabel="The other person agreed to this recording" onPress={() => setConsent(!consent)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><View style={{ width: 22, height: 22, borderWidth: 1, borderColor: colors.green, borderRadius: 5, backgroundColor: consent ? colors.green : colors.paper }}>{consent && <Icon name="check" size={20} color={colors.paper} />}</View><Txt style={{ flex: 1, fontSize: 16 }}>The other person agreed to this recording.</Txt></Pressable>}
    {compact ? <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: recording ? colors.danger : colors.muted }} /><Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, lineHeight: 22, color: colors.muted, flex: 1 }}>{recording ? `Recording · ${limit / 60} min maximum` : feedback}</Txt></View> : <View style={{ alignItems: 'center', gap: 10, padding: 16, borderRadius: 12, backgroundColor: colors.pale }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: recording ? colors.green : colors.sage }}><Icon name={recording ? 'mic' : 'clock'} size={22} color={recording ? colors.paper : colors.green} /></View>
      <Txt weight="semibold" style={{ fontSize: 30, lineHeight: 38, fontVariant: ['tabular-nums'], fontFamily: fonts.medium }}>{timer}</Txt>
      <Txt style={{ fontSize: 16, color: colors.muted }}>{feedback}</Txt>
    </View>}
    <ErrorNotice message={error} />
    <Button label={compact && recording ? 'Stop & save' : action} accessibilityLabel={action} icon={recording ? 'stop' : 'mic'} disabled={phase === 'saving' || phase === 'preparing' || (mode === 'conversation' && !consent)} onPress={recording || phase === 'retry' ? finish : start} />
    {compact && recording && <Txt style={{ fontSize: 16, lineHeight: 22, color: colors.muted }}>Keep Pete open until saved.</Txt>}
    {phase === 'retry' && <>
      <Button label={downloading ? 'Preparing original…' : 'Download original recording'} kind="secondary" disabled={downloading} icon="download" onPress={async () => {
        if (!pendingUri.current || downloading) return;
        setDownloading(true);
        try { await saveRecording(pendingUri.current, `pete-${draft.id.slice(0, 8)}-${mode}`); }
        catch (e) { setError(e instanceof Error ? e.message : 'Could not download the recording.'); }
        finally { setDownloading(false); }
      }} />
      {discarding ? <View style={{ gap: 10 }}><Txt>This recording has not been saved to the visitor. Discarding removes this unsaved copy.</Txt><Button label="Keep this recording" kind="secondary" onPress={() => setDiscarding(false)} /><Button label="Discard unsaved recording" kind="danger" disabled={downloading} onPress={() => { pendingUri.current = null; lock(false); done(); }} /></View> : <Button label="Discard recording…" kind="quiet" disabled={downloading} onPress={() => setDiscarding(true)} />}
    </>}
    {!compact && <Txt style={{ color: colors.muted, fontSize: 16, lineHeight: 24 }}>{workspace.cloudEnabled ? 'Saved here first, then backed up to company cloud. Google in the EU transcribes and fills the draft.' : workspace.supportedKinds.includes('voice') ? 'Saved on this device. Your company’s Google service in the EU transcribes and fills the draft.' : 'Saved on this device. Transcription is not configured on this platform.'} Keep Pete open until saving finishes.</Txt>}
  </>;
}
