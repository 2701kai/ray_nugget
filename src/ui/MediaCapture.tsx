import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useCaptureRecorder } from '../media/useCaptureRecorder';
import { useUnsavedRecording } from '../media/useUnsavedRecording';
import { saveRecording } from '../media/files';
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
        if (!permission.granted) throw new Error('Kamerazugriff fehlt. Erlaube ihn in den Einstellungen oder wähle ein Foto aus.');
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false, cameraType: ImagePicker.CameraType.back };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_MEDIA_BYTES) throw new Error('Wähle ein Bild unter 15 MB.');
      await workspace.attach(draft.id, asset.uri, { kind: 'card', name: asset.fileName || 'Business card.jpg', mimeType: asset.mimeType || 'image/jpeg' });
      done();
    } catch (e) { setError(e instanceof Error ? e.message : 'Das Foto konnte nicht gespeichert werden. Versuche es erneut.'); }
    finally { active.current = false; setBusy(false); lock(false); }
  }
  return <>
    <View style={{ padding: 32, minHeight: 170, backgroundColor: colors.pale, borderRadius: 16, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 14 }}><Icon name="card" size={42} color={colors.green} /><Txt weight="semibold">Karte aufnehmen, Kontakt ergänzen.</Txt><Txt style={{ color: colors.muted, fontSize: 16, textAlign: 'center' }}>Halte die ganze Karte scharf im Bild.</Txt></View>
    <ErrorNotice message={error} />
    <Button label={busy ? 'Foto wird gespeichert…' : 'Foto aufnehmen'} icon="camera" disabled={busy} onPress={() => pick(true)} />
    <Button label={busy ? 'Foto wird gespeichert…' : 'Kartenfoto auswählen'} icon="card" disabled={busy} onPress={() => pick(false)} kind="secondary" />
    {Platform.OS === 'web' && <Txt style={{ fontSize: 16, color: colors.muted }}>Dein Browser öffnet die Kamera oder die Fotoauswahl.</Txt>}
    <Txt style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>{workspace.cloudEnabled ? 'Das Foto wird hier und in Company Cloud gesichert. Pete liest die Karte lokal; Google ergänzt die Angaben in der EU.' : 'Das Original bleibt auf diesem Gerät. Pete liest die Karte lokal.'}</Txt>
  </>;
}

export function VoiceCapture({ draft, workspace, done, lock, initialMode = 'memo', autoStart = false }: { draft: Draft; workspace: Workspace; done: () => void; lock: (locked: boolean) => void; initialMode?: 'memo' | 'conversation'; autoStart?: boolean }) {
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
      setPhase('idle'); setError(status.error || 'Die Aufnahme wurde unterbrochen. Prüfe das Mikrofon und versuche es erneut.');
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
      if (!(await requestPermission()).granted) throw new Error('Mikrofonzugriff fehlt. Erlaube ihn in den Geräte- oder Browser-Einstellungen.');
      await setRecordingMode(true);
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('recording');
    } catch (e) { setPhase('idle'); lock(false); setError(e instanceof Error ? e.message : 'Die Aufnahme konnte nicht gestartet werden.'); }
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
      if (!pendingUri.current) throw new Error('Es liegt keine Aufnahme vor. Starte eine neue Notiz.');
      await setRecordingMode(false);
      const mimeType = Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
      await workspace.attach(draft.id, pendingUri.current, {
        kind: 'voice', name: mode === 'memo' ? 'Sprachnotiz' : 'Gespräch mit Zustimmung', mimeType,
        voiceMode: mode, consentConfirmed: mode === 'conversation' ? consent : undefined,
      });
      pendingUri.current = null; done();
    } catch (e) { setPhase(pendingUri.current ? 'retry' : 'idle'); setError(e instanceof Error ? e.message : 'Die Aufnahme konnte nicht gespeichert werden.'); }
    finally { active.current = false; lock(!!pendingUri.current); }
  }
  finishRef.current = () => { void finish(); };
  const recording = phase === 'recording';
  return <>
    {phase === 'idle' && <Choice label="Was nimmst Du auf?" value={mode} options={[{ value: 'memo', label: 'Eigene Sprachnotiz' }, { value: 'conversation', label: 'Gespräch' }]} onChange={setMode} />}
    {mode === 'conversation' && phase === 'idle' && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} aria-checked={consent} accessibilityLabel="Die andere Person stimmt der Aufnahme zu" onPress={() => setConsent(!consent)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><View style={{ width: 22, height: 22, borderWidth: 1, borderColor: colors.green, borderRadius: 5, backgroundColor: consent ? colors.green : colors.paper }}>{consent && <Icon name="check" size={20} color={colors.paper} />}</View><Txt style={{ flex: 1, fontSize: 16 }}>Die andere Person stimmt der Aufnahme zu.</Txt></Pressable>}
    <View style={{ alignItems: 'center', gap: 10, padding: 16, borderRadius: 12, backgroundColor: colors.pale }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: recording ? colors.green : colors.sage }}><Icon name={recording ? 'mic' : 'clock'} size={22} color={recording ? colors.paper : colors.green} /></View>
      <Txt weight="semibold" style={{ fontSize: 30, lineHeight: 38, fontVariant: ['tabular-nums'], fontFamily: fonts.medium }}>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</Txt>
      <Txt style={{ fontSize: 16, color: colors.muted }}>{phase === 'saving' ? 'Originalaufnahme wird gespeichert…' : phase === 'preparing' ? 'Mikrofon wird vorbereitet…' : recording ? 'Aufnahme läuft · Stoppen speichert beim Besucher' : phase === 'retry' ? 'Noch nicht gespeichert · lass diese Seite offen' : mode === 'conversation' ? 'Bis zu 30 Minuten. Stoppe zum Speichern.' : 'Deine Zusammenfassung, bis zu 3 Minuten.'}</Txt>
    </View>
    <ErrorNotice message={error} />
    <Button label={recording ? 'Stoppen und speichern' : phase === 'retry' ? 'Aufnahme erneut speichern' : phase === 'saving' ? 'Aufnahme wird gespeichert…' : phase === 'preparing' ? 'Mikrofon wird vorbereitet…' : 'Aufnahme starten'} icon={recording ? 'stop' : 'mic'} disabled={phase === 'saving' || phase === 'preparing' || (mode === 'conversation' && !consent)} onPress={recording || phase === 'retry' ? finish : start} />
    {phase === 'retry' && <>
      <Button label={downloading ? 'Original wird vorbereitet…' : 'Originalaufnahme herunterladen'} kind="secondary" disabled={downloading} icon="download" onPress={async () => {
        if (!pendingUri.current || downloading) return;
        setDownloading(true);
        try { await saveRecording(pendingUri.current, `pete-${draft.id.slice(0, 8)}-${mode}`); }
        catch (e) { setError(e instanceof Error ? e.message : 'Die Aufnahme konnte nicht heruntergeladen werden.'); }
        finally { setDownloading(false); }
      }} />
      {discarding ? <View style={{ gap: 10 }}><Txt>Diese Aufnahme ist noch nicht beim Besucher gespeichert. Beim Verwerfen wird sie entfernt.</Txt><Button label="Aufnahme behalten" kind="secondary" onPress={() => setDiscarding(false)} /><Button label="Ungesicherte Aufnahme verwerfen" kind="danger" disabled={downloading} onPress={() => { pendingUri.current = null; lock(false); done(); }} /></View> : <Button label="Aufnahme verwerfen…" kind="quiet" disabled={downloading} onPress={() => setDiscarding(true)} />}
    </>}
    <Txt style={{ color: colors.muted, fontSize: 16, lineHeight: 24 }}>{workspace.cloudEnabled ? 'Zuerst hier gesichert, dann in Company Cloud. Google transkribiert und ergänzt Angaben in der EU.' : workspace.supportedKinds.includes('voice') ? 'Hier gesichert. Euer Google-Dienst transkribiert und ergänzt Angaben in der EU.' : 'Hier gesichert. Transkription ist auf dieser Plattform nicht eingerichtet.'} Lass Pete bis zum Speichern geöffnet.</Txt>
  </>;
}
