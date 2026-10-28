import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import type { CaptureStatus } from './recorder-types';
export function useCaptureRecorder(listener: (status: CaptureStatus) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, listener);
  const status = useAudioRecorderState(recorder, 250);
  return { recorder, status, requestPermission: requestRecordingPermissionsAsync, setMode: (allowsRecording: boolean) => setAudioModeAsync({ allowsRecording, playsInSilentMode: true }) };
}
