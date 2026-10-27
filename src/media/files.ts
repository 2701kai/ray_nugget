import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function readUri(uri: string): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  return { bytes: await new File(uri).bytes() };
}
export async function mediaUri(bytes: Uint8Array, mimeType: string, id: string): Promise<string> {
  const extension = mimeType.includes('png') ? 'png' : mimeType.includes('image') ? 'jpg' : mimeType.includes('webm') ? 'webm' : 'm4a';
  const file = new File(Paths.cache, `pete-${id}.${extension}`);
  file.write(bytes);
  return file.uri;
}
export function releaseUri(_uri: string) { /* The OS manages native playback cache. Originals are in SQLite. */ }
export async function downloadJson(name: string, value: unknown) {
  const file = new File(Paths.cache, name);
  file.write(JSON.stringify(value, null, 2));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Export draft metadata' });
}
