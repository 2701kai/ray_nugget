import type { CaptureRecorder, CaptureStatus } from './recorder-types';

// Always collect final data, including a browser/device initiated stop. Expo's
// web stop() installs its data listener only when the user asks it to stop.
export class BrowserRecorder implements CaptureRecorder {
  private media?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  private stopped?: Promise<void>;
  private resolveStop?: () => void;
  private generation = 0;
  private disposed = false;
  private startedAt = 0;
  private elapsed = 0;
  private failure?: string;
  uri: string | null = null;
  constructor(private listener: (status: CaptureStatus) => void) {}
  get isRecording() { return this.media?.state === 'recording'; }
  get durationMillis() { return this.isRecording && this.startedAt ? this.elapsed + performance.now() - this.startedAt : this.elapsed; }
  async prepareToRecordAsync() {
    if (this.disposed || this.isRecording) throw new Error('A recording is already active or closed.');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Recording is unavailable in this browser. Open Pete in Safari or Chrome.');
    const generation = ++this.generation;
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.disposed || generation !== this.generation || document.visibilityState === 'hidden') throw new Error('Recording did not start because Pete was left. Open it and try again.');
      this.stream = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 128000 });
      this.media = recorder; this.chunks = []; this.elapsed = 0; this.startedAt = 0; this.failure = undefined;
      if (this.uri) URL.revokeObjectURL(this.uri);
      this.uri = null;
      this.stopped = new Promise(resolve => { this.resolveStop = resolve; });
      recorder.addEventListener('dataavailable', event => { if (event.data.size) this.chunks.push(event.data); });
      recorder.addEventListener('error', () => {
        this.failure = 'The microphone was interrupted. Pete is keeping the audio captured so far.';
        if (recorder.state !== 'inactive') recorder.stop();
        // MediaRecorder delivers final data and stop after its error event.
      });
      recorder.addEventListener('stop', () => {
        this.elapsed += this.startedAt ? performance.now() - this.startedAt : 0;
        this.startedAt = 0;
        const blob = new Blob(this.chunks, { type: recorder.mimeType || this.chunks[0]?.type || 'audio/webm' });
        this.chunks = [];
        stream!.getTracks().forEach(track => track.stop());
        this.stream = undefined;
        if (blob.size && !this.disposed) this.uri = URL.createObjectURL(blob);
        this.resolveStop?.(); this.resolveStop = undefined;
        if (!this.disposed) this.listener({ url: this.uri, isFinished: true, hasError: !!this.failure || !this.uri, error: this.failure || (!this.uri ? 'No audio was captured. Check your microphone and try again.' : undefined) });
      }, { once: true });
      for (const track of stream.getTracks()) track.addEventListener('ended', () => {
        this.failure = 'The microphone disconnected. Pete is saving the audio captured so far.';
        if (recorder.state !== 'inactive') recorder.stop();
      }, { once: true });
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (error instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError'].includes(error.name)) throw new Error('Microphone access is off. Allow it in device or browser settings, then try again.');
      throw error;
    }
  }
  record() {
    if (!this.media || this.disposed) throw new Error('The microphone is not ready.');
    this.startedAt = performance.now();
    try { this.media.start(1000); }
    catch (error) {
      this.stream?.getTracks().forEach(track => track.stop());
      this.stream = undefined; this.media = undefined; this.startedAt = 0;
      this.resolveStop?.(); this.resolveStop = undefined;
      throw error;
    }
  }
  async stop() {
    if (this.uri) return;
    if (!this.media || !this.stopped) throw new Error('No recording was started.');
    if (this.media.state !== 'inactive') this.media.stop();
    await this.stopped;
  }
  dispose() {
    this.disposed = true; this.generation++;
    if (this.media && this.media.state !== 'inactive') this.media.stop();
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    if (this.uri) URL.revokeObjectURL(this.uri);
    this.uri = null;
  }
}
