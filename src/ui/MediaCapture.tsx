import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { MAX_MEDIA_BYTES, MAX_RECORDING_SECONDS, MAX_CONVERSATION_SECONDS, type Draft } from '../domain/draft';
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
    <View style={{ padding: 32, minHeight: 170, backgroundColor: colors.pale, borderRadius: 16, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 14 }}><Icon name="card" size={42} color={colors.green} /><Txt weight="semibold">One card. Keep the connection.</Txt><Txt style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>Keep the card in frame and the text in focus.</Txt></View>
    <ErrorNotice message={error} />
    <Button label={busy ? 'Saving photo…' : 'Take a photo'} icon="camera" disabled={busy} onPress={() => pick(true)} />
    <Button label={busy ? 'Saving photo…' : 'Choose a card photo'} icon="card" disabled={busy} onPress={() => pick(false)} kind="secondary" />
    {Platform.OS === 'web' && <Txt style={{ fontSize: 11, color: colors.muted }}>On a phone, Take a photo requests the rear camera. Your browser may offer a camera or file chooser.</Txt>}
    <Txt style={{ fontSize: 12, lineHeight: 20, color: colors.muted }}>The original photo is saved first. In the browser preview, Pete reads the card on this device, then lets you review the text and contact suggestions.</Txt>
  </>;
}

export function VoiceCapture({ draft, workspace, done, lock, initialMode = 'memo', autoStart = false }: { draft: Draft; workspace: Workspace; done: () => void; lock: (locked: boolean) => void; initialMode?: 'memo' | 'conversation'; autoStart?: boolean }) {
  const [mode, setMode] = useState<'memo' | 'conversation'>(initialMode);
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'recording' | 'saving' | 'retry'>('idle');
  const [error, setError] = useState('');
  const pendingUri = useRef<string | null>(null);
  const active = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, status => {
    if (status.hasError || status.mediaServicesDidReset) {
      pendingUri.current = status.url;
      setPhase(status.url ? 'retry' : 'idle');
      setError(status.error || 'Recording was interrupted. Check the microphone and try again.');
      active.current = false;
      lock(false);
    }
  });
  const status = useAudioRecorderState(recorder, 250);
  const finishRef = useRef<() => void>(() => undefined);
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
      if (!(await requestRecordingPermissionsAsync()).granted) throw new Error('Microphone access is off. Allow it in device or browser settings, then try again.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
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
      await setAudioModeAsync({ allowsRecording: false });
      const mimeType = Platform.OS === 'web' ? RecordingPresets.HIGH_QUALITY.web.mimeType || 'audio/webm' : 'audio/mp4';
      await workspace.attach(draft.id, pendingUri.current, {
        kind: 'voice', name: mode === 'memo' ? 'Voice memo' : 'Consented conversation', mimeType,
        voiceMode: mode, consentConfirmed: mode === 'conversation' ? consent : undefined,
      });
      pendingUri.current = null; done();
    } catch (e) { setPhase(pendingUri.current ? 'retry' : 'idle'); setError(e instanceof Error ? e.message : 'The recording could not be saved.'); }
    finally { active.current = false; lock(false); }
  }
  finishRef.current = () => { void finish(); };
  const recording = phase === 'recording';
  return <>
    {phase === 'idle' && <Choice label="What are you recording?" value={mode} options={[{ value: 'memo', label: 'My own voice memo' }, { value: 'conversation', label: 'A conversation' }]} onChange={setMode} />}
    {mode === 'conversation' && phase === 'idle' && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} accessibilityLabel="The other person agreed to this recording" onPress={() => setConsent(!consent)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><View style={{ width: 22, height: 22, borderWidth: 1, borderColor: colors.green, borderRadius: 5, backgroundColor: consent ? colors.green : colors.paper }}>{consent && <Icon name="check" size={20} color={colors.paper} />}</View><Txt style={{ flex: 1, fontSize: 12 }}>The other person agreed to this recording.</Txt></Pressable>}
    <View style={{ alignItems: 'center', gap: 16, padding: 28, borderRadius: 20, backgroundColor: colors.pale }}>
      <View style={{ width: 74, height: 74, borderRadius: 37, alignItems: 'center', justifyContent: 'center', backgroundColor: recording ? colors.green : colors.sage }}><Icon name={recording ? 'mic' : 'clock'} size={30} color={recording ? colors.paper : colors.green} /></View>
      <Txt weight="semibold" style={{ fontSize: 36, lineHeight: 44, fontVariant: ['tabular-nums'], fontFamily: fonts.medium }}>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</Txt>
      <Txt style={{ fontSize: 12, color: colors.muted }}>{phase === 'saving' ? 'Saving the original recording…' : phase === 'preparing' ? 'Preparing microphone…' : recording ? 'Recording · stop to save to this visitor' : phase === 'retry' ? 'Recording kept here · retry saving' : mode === 'conversation' ? 'Up to 30 minutes. Stop and save when you are done.' : 'A short note is all you need. Up to 3 minutes.'}</Txt>
    </View>
    <ErrorNotice message={error} />
    <Button label={recording ? 'Stop and save recording' : phase === 'retry' ? 'Retry saving recording' : phase === 'saving' ? 'Saving recording…' : phase === 'preparing' ? 'Preparing microphone…' : 'Start recording'} icon={recording ? 'stop' : 'mic'} disabled={phase === 'saving' || phase === 'preparing' || (mode === 'conversation' && !consent)} onPress={recording || phase === 'retry' ? finish : start} />
    <Txt style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>{workspace.supportedKinds.includes('voice') ? 'The original stays on this device. A copy is sent to your company’s Google Cloud Speech service in the EU for transcription. Review the result before using it.' : 'The original stays on this device. Transcription is not configured on this platform.'} Leaving the app stops and attempts to save the recording; keep the app open until saving finishes.</Txt>
  </>;
}
