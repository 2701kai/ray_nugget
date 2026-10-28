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

export function VoiceCapture({ draft, workspace, done, lock, initialMode = 'memo', autoStart = false, compact = false, answerQuestions, onClose }: { draft: Draft; workspace: Workspace; done: (outcome?: 'discarded' | 'canceled') => void; lock: (locked: boolean) => void; initialMode?: 'memo' | 'conversation'; autoStart?: boolean; compact?: boolean; answerQuestions?: string[]; onClose?: () => void }) {
  const [mode, setMode] = useState<'memo' | 'conversation'>(initialMode);
  const [consent, setConsent] = useState(false);
  type Phase = 'idle' | 'preparing' | 'recording' | 'saving' | 'retry' | 'stopping' | 'discarding';
  const [phase, renderPhase] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const setPhase = (next: Phase) => { phaseRef.current = next; renderPhase(next); };
  const [error, setError] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const discardPrompt = useRef(false);
  const cancelStart = useRef(false);
  const closed = useRef(false);
  const downloadActive = useRef(false);
  const sourceDraftId = useRef(draft.id).current;
  const captureContext = useRef(workspace.captureContext(draft.id, answerQuestions)).current;
  const pendingUri = useRef<string | null>(null);
  const active = useRef(false);
  const finishRef = useRef<() => void>(() => undefined);
  const { recorder, status, discard: discardRecorder, requestPermission, setMode: setRecordingMode } = useCaptureRecorder(status => {
    if (closed.current || cancelStart.current || !['recording', 'saving', 'stopping'].includes(phaseRef.current)) return;
    if (status.url) {
      pendingUri.current = status.url;
      if (!active.current) finishRef.current();
    } else if (!active.current && (status.hasError || status.mediaServicesDidReset)) {
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
    return () => { closed.current = true; sub.remove(); lock(false); };
  }, [recorder]);

  async function start() {
    if (closed.current || active.current || phaseRef.current !== 'idle' || (mode === 'conversation' && !consent)) return;
    active.current = true; cancelStart.current = false; pendingUri.current = null; setPhase('preparing'); setError(''); lock(true);
    let preparationAttempted = false;
    let started = false;
    try {
      const permission = await requestPermission();
      if (cancelStart.current || closed.current) return;
      if (!permission.granted) throw new Error('Microphone access is off. Allow it in device or browser settings, then try again.');
      await setRecordingMode(true);
      if (cancelStart.current || closed.current) return;
      preparationAttempted = true;
      await recorder.prepareToRecordAsync();
      if (cancelStart.current || closed.current) return;
      recorder.record();
      started = true;
      setPhase('recording');
    } catch (e) { if (!cancelStart.current && !closed.current) setError(e instanceof Error ? e.message : 'Recording could not start.'); }
    finally {
      if (cancelStart.current || closed.current || !started) {
        try {
          if (preparationAttempted) await discardRecorder();
          else await setRecordingMode(false);
          if (cancelStart.current && !closed.current) { closed.current = true; done('canceled'); }
          setPhase('idle');
        } catch (e) {
          // Keep the panel and update guard until cleanup can be retried.
          pendingUri.current = recorder.uri;
          setPhase('retry'); discardPrompt.current = true; setDiscarding(true);
          setError(e instanceof Error ? e.message : 'Could not release the microphone. Try discarding again.');
        }
        cancelStart.current = false;
      }
      active.current = false; lock(phaseRef.current !== 'idle' && !closed.current);
    }
  }
  useEffect(() => { if (autoStart && initialMode === 'memo') void start(); }, []);
  async function finish() {
    if (closed.current || active.current || downloadActive.current || !['recording', 'retry'].includes(phaseRef.current)) return;
    active.current = true; setError(''); setPhase(discardPrompt.current ? 'stopping' : 'saving'); lock(true);
    try {
      if (!pendingUri.current) {
        await recorder.stop();
        pendingUri.current = recorder.uri;
      }
      if (!pendingUri.current) throw new Error('No recording was returned. Please start a new note.');
      await setRecordingMode(false);
      // A limit, background event or device stop can race the confirmation.
      // Keep the stopped original here until the user chooses keep or discard.
      if (discardPrompt.current) { setPhase('retry'); return; }
      const mimeType = Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
      await workspace.attach(sourceDraftId, pendingUri.current, {
        kind: 'voice', name: mode === 'memo' ? 'Voice note' : 'Consented conversation', mimeType,
        context: captureContext, voiceMode: mode, consentConfirmed: mode === 'conversation' ? consent : undefined,
      });
      pendingUri.current = null; closed.current = true; setPhase('idle'); done();
    } catch (e) { setPhase(recorder.isRecording ? 'recording' : pendingUri.current || discardPrompt.current ? 'retry' : 'idle'); setError(e instanceof Error ? e.message : 'The recording could not be saved.'); }
    finally { active.current = false; lock(phaseRef.current !== 'idle' && !closed.current); }
  }
  finishRef.current = () => { void finish(); };
  function askToDiscard() {
    if (closed.current || active.current || downloadActive.current || !['recording', 'retry'].includes(phaseRef.current)) return;
    discardPrompt.current = true; setDiscarding(true);
  }
  function keepRecording() {
    if (active.current || downloadActive.current) return;
    discardPrompt.current = false; setDiscarding(false);
    if (phaseRef.current === 'retry') void finish();
  }
  async function discard() {
    if (closed.current || active.current || downloadActive.current || !discardPrompt.current) return;
    active.current = true; setPhase('discarding'); setError(''); lock(true);
    try {
      await discardRecorder();
      pendingUri.current = null; closed.current = true; setPhase('idle'); lock(false); done('discarded');
    } catch (e) {
      pendingUri.current = recorder.uri;
      setPhase(recorder.isRecording ? 'recording' : 'retry');
      setError(e instanceof Error ? e.message : 'Could not discard this recording. Keep this page open and try again.');
    } finally { active.current = false; }
  }
  const recording = phase === 'recording';
  const busy = ['saving', 'preparing', 'stopping', 'discarding'].includes(phase);
  const action = recording ? 'Stop and save recording' : phase === 'retry' ? 'Retry saving recording' : phase === 'saving' ? 'Saving recording…' : phase === 'discarding' ? 'Canceling microphone…' : phase === 'preparing' ? 'Preparing microphone…' : 'Start recording';
  const feedback = phase === 'discarding' ? (cancelStart.current ? 'Canceling microphone…' : 'Discarding recording…') : phase === 'stopping' ? 'Stopping · keeping your recording until you choose' : phase === 'saving' ? 'Saving the original recording…' : phase === 'preparing' ? 'Preparing microphone…' : recording ? 'Recording · stop to save to this visitor' : phase === 'retry' ? 'Not saved yet · keep this page open' : mode === 'conversation' ? 'Up to 30 minutes. Stop and save when you are done.' : 'A short note is all you need. Up to 3 minutes.';
  const timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return <>
    {compact && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}><Txt weight="bold" style={{ fontSize: 16, lineHeight: 22 }}>{answerQuestions ? 'Record an answer for Ray' : mode === 'memo' ? 'Voice note' : 'Conversation recording'}</Txt><Txt numberOfLines={1} style={{ fontSize: 16, lineHeight: 22, color: colors.muted }}>For {titleOf(draft)}</Txt></View>
      <Txt style={{ fontSize: 22, lineHeight: 30, fontVariant: ['tabular-nums'], fontFamily: fonts.semibold }}>{timer}</Txt>
      <Button label="" accessibilityLabel="Close" icon="close" kind="quiet" onPress={() => { if (phase === 'idle') onClose?.(); }} disabled={phase !== 'idle'} style={{ width: 44, paddingHorizontal: 0 }} />
    </View>}
    {!!captureContext.questions.length && <Txt style={{ fontSize: 16, lineHeight: 22 }}>{captureContext.questions.join('\n')}</Txt>}
    {(answerQuestions || workspace.rayEnabled[draft.id]) && <Txt style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{workspace.rayEnabled[draft.id] ? 'After saving and processing, Ray updates the advice automatically.' : 'Automatic updates are paused. Choose Ask Ray after saving.'}</Txt>}
    {!compact && phase === 'idle' && <Choice label="What are you recording?" value={mode} options={[{ value: 'memo', label: 'My own voice memo' }, { value: 'conversation', label: 'Conversation' }]} onChange={setMode} />}
    {mode === 'conversation' && phase === 'idle' && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} aria-checked={consent} accessibilityLabel="The other person agreed to this recording" onPress={() => setConsent(!consent)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><View style={{ width: 22, height: 22, borderWidth: 1, borderColor: colors.green, borderRadius: 5, backgroundColor: consent ? colors.green : colors.paper }}>{consent && <Icon name="check" size={20} color={colors.paper} />}</View><Txt style={{ flex: 1, fontSize: 16 }}>The other person agreed to this recording.</Txt></Pressable>}
    {compact ? <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: recording ? colors.danger : colors.muted }} /><Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, lineHeight: 22, color: colors.muted, flex: 1 }}>{recording ? `Recording · ${limit / 60} min maximum` : feedback}</Txt></View> : <View style={{ alignItems: 'center', gap: 10, padding: 16, borderRadius: 12, backgroundColor: colors.pale }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: recording ? colors.green : colors.sage }}><Icon name={recording ? 'mic' : 'clock'} size={22} color={recording ? colors.paper : colors.green} /></View>
      <Txt weight="semibold" style={{ fontSize: 30, lineHeight: 38, fontVariant: ['tabular-nums'], fontFamily: fonts.medium }}>{timer}</Txt>
      <Txt style={{ fontSize: 16, color: colors.muted }}>{feedback}</Txt>
    </View>}
    <ErrorNotice message={error} />
    {discarding ? <View style={{ gap: 8 }}>
      <Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, lineHeight: 22 }}>Discard this recording? It won’t be saved.</Txt>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label={recording ? 'Keep recording' : 'Keep & save'} kind="secondary" disabled={busy || downloading || (!recording && !pendingUri.current)} onPress={keepRecording} style={{ flex: 1 }} />
        <Button label={phase === 'discarding' ? 'Discarding…' : 'Discard'} accessibilityLabel="Confirm discard recording" kind="danger" disabled={busy || downloading} onPress={discard} style={{ flex: 1 }} />
      </View>
    </View> : <View style={{ flexDirection: 'row', gap: 8 }}>
      <Button label={compact && recording ? 'Stop & save' : phase === 'discarding' ? 'Canceling…' : action} accessibilityLabel={action} icon={recording ? 'stop' : 'mic'} disabled={busy || downloading || (mode === 'conversation' && !consent)} onPress={recording || phase === 'retry' ? finish : start} style={{ flex: 1 }} />
      {(recording || phase === 'retry') && <Button label="Discard" accessibilityLabel="Discard recording" kind="quiet" disabled={downloading} onPress={askToDiscard} />}
      {phase === 'preparing' && <Button label="Cancel" accessibilityLabel="Cancel microphone preparation" kind="quiet" onPress={() => { cancelStart.current = true; setPhase('discarding'); }} />}
    </View>}
    {compact && recording && !discarding && <Txt style={{ fontSize: 16, lineHeight: 22, color: colors.muted }}>Keep Pete open until saved.</Txt>}
    {phase === 'retry' && pendingUri.current && <>
      <Button label={downloading ? 'Preparing original…' : 'Download original recording'} kind="secondary" disabled={downloading} icon="download" onPress={async () => {
        if (!pendingUri.current || active.current || downloadActive.current) return;
        downloadActive.current = true; setDownloading(true);
        try { await saveRecording(pendingUri.current, `pete-${sourceDraftId.slice(0, 8)}-${mode}`); }
        catch (e) { setError(e instanceof Error ? e.message : 'Could not download the recording.'); }
        finally { downloadActive.current = false; setDownloading(false); }
      }} />
    </>}
    {!compact && <Txt style={{ color: colors.muted, fontSize: 16, lineHeight: 24 }}>{workspace.cloudEnabled ? 'Saved here first, then backed up to company cloud. Google in the EU transcribes and fills the draft.' : workspace.supportedKinds.includes('voice') ? 'Saved on this device. Your company’s Google service in the EU transcribes and fills the draft.' : 'Saved on this device. Transcription is not configured on this platform.'} Keep Pete open until saving finishes.</Txt>}
  </>;
}
