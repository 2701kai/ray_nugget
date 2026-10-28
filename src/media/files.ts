import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

export async function readUri(uri: string): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  return { bytes: await new File(uri).bytes() };
}
export async function mediaUri(bytes: Uint8Array, mimeType: string, id: string): Promise<string> {
  const extension = mimeType.includes('png') ? 'png' : mimeType.includes('image') ? 'jpg' : mimeType.includes('webm') ? 'webm' : 'm4a';
  const file = new File(Paths.cache, `pete-${id}.${extension}`);
  await file.write(bytes);
  return file.uri;
}
export function releaseUri(_uri: string) { /* The OS manages native playback cache. Originals are in SQLite. */ }
export async function downloadJson(name: string, value: unknown) {
  const file = new File(Paths.cache, name);
  await file.write(JSON.stringify(value, null, 2));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Export draft metadata' });
}

export async function saveBackup(name: string, parts: Uint8Array[]) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Saving files is unavailable on this device.');
  const file = new File(Paths.cache, `${Date.now()}-${name}`);
  try {
    for (let i = 0; i < parts.length; i++) await file.write(parts[i], { append: i > 0 });
  } catch (error) { if (file.exists) file.delete(); throw error; }
  await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', UTI: 'public.data', dialogTitle: 'Save draft backup' });
  // Android's chooser can return before the receiving app has read the file.
  // Leave completed exports in OS-managed cache instead of deleting too early.
}

export async function pickBackup(maxBytes: number): Promise<Uint8Array | undefined> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true });
  if (result.canceled) return undefined;
  const file = new File(result.assets[0].uri);
  try {
    const size = result.assets[0].size ?? file.size;
    if (size === null || size === undefined || size > maxBytes) throw new Error('Choose a Pete backup smaller than 128 MiB.');
    return await file.bytes();
  } finally { if (file.uri.startsWith(Paths.cache.uri) && file.exists) file.delete(); }
}

export async function saveRecording(uri: string, _name: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Saving files is unavailable on this device. Keep this recording open and retry saving.');
  await Sharing.shareAsync(uri, { mimeType: 'audio/mp4', dialogTitle: 'Keep original recording' });
}
