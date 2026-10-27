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

export async function saveBackup(name: string, parts: Uint8Array[]) {
  const url = URL.createObjectURL(new Blob(parts.map(part => part.buffer instanceof ArrayBuffer ? new Uint8Array(part.buffer, part.byteOffset, part.byteLength) : new Uint8Array(part)), { type: 'application/octet-stream' }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function pickBackup(maxBytes: number): Promise<Uint8Array | undefined> {
  const file = await new Promise<File | undefined>(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.pete,application/octet-stream'; input.style.display = 'none';
    const finish = (file?: File) => { input.remove(); resolve(file); };
    input.onchange = () => finish(input.files?.[0]); input.oncancel = () => finish();
    document.body.appendChild(input); input.click();
  });
  if (!file) return undefined;
  if (file.size > maxBytes) throw new Error('Choose a Pete backup smaller than 128 MiB.');
  return new Uint8Array(await file.arrayBuffer());
}
