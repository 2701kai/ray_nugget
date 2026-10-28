import { useEffect, useRef, useState } from 'react';
import { BrowserRecorder } from './browser-recorder';
import type { CaptureStatus } from './recorder-types';
export function useCaptureRecorder(listener: (status: CaptureStatus) => void) {
  const callback = useRef(listener); callback.current = listener;
  const [recorder] = useState(() => new BrowserRecorder(status => callback.current(status)));
  const [durationMillis, setDuration] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setDuration(recorder.durationMillis), 250);
    return () => { clearInterval(interval); recorder.dispose(); };
  }, [recorder]);
  return { recorder, status: { durationMillis }, discard: () => recorder.discard(), requestPermission: async () => ({ granted: true }), setMode: async (_recording: boolean) => undefined };
}
