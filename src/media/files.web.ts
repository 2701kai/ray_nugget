export async function readUri(uri: string): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('The selected file could not be read.');
  return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType: response.headers.get('content-type') || undefined };
}
export async function mediaUri(bytes: Uint8Array, mimeType: string, _id: string): Promise<string> {
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
}
export function releaseUri(uri: string) { URL.revokeObjectURL(uri); }
export async function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
