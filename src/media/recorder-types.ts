export type CaptureStatus = { url: string | null; hasError: boolean; error?: string | null; isFinished?: boolean; mediaServicesDidReset?: boolean };
export interface CaptureRecorder {
  readonly isRecording: boolean;
  readonly uri: string | null;
  prepareToRecordAsync(): Promise<void>;
  record(): void;
  stop(): Promise<void>;
}
