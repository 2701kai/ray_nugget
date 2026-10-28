import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import type { CaptureStatus } from './recorder-types';
export function useCaptureRecorder(listener: (status: CaptureStatus) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, listener);
  const status = useAudioRecorderState(recorder, 250);
  const setMode = (allowsRecording: boolean) => setAudioModeAsync({ allowsRecording, playsInSilentMode: true });
  const discard = async () => {
    await recorder.stop();
    await setMode(false);
    // Only the recorder's temporary file. Saved originals live in SQLite.
    if (recorder.uri) { const file = new File(recorder.uri); if (file.exists) file.delete(); }
  };
  return { recorder, status, discard, requestPermission: requestRecordingPermissionsAsync, setMode };
}
