import { googleClient } from './google-client';
import { createHash } from 'node:crypto';
import target from '../deploy/target.json';

const client = await googleClient();
const api = 'https://firebasehosting.googleapis.com/v1beta1';
async function request<T>(path: string, method: 'GET' | 'POST' | 'PATCH', data?: unknown) {
  return (await client.request<T>({ url: api + path, method, data })).data;
}
const site = await request<{ name: string; appId: string }>(`/projects/${target.project}/sites/${target.site}`, 'GET');
if (site.appId !== target.webApp) throw new Error('Hosting site does not match the reviewed Firebase app.');
const hashes: Record<string, string> = {};
const compressed = new Map<string, Uint8Array>();
for await (const path of new Bun.Glob('**/*').scan({ cwd: 'dist-hosted', onlyFiles: true })) {
  if (!/^(?:index\.html|manifest\.webmanifest|metadata\.json|sw\.js|(?:assets|_expo|icons|ocr)\/[^\s]+)$/.test(path)) throw new Error(`Unexpected deployment file: ${path}`);
  const bytes = Bun.gzipSync(await Bun.file(`dist-hosted/${path}`).bytes());
  const hash = createHash('sha256').update(bytes).digest('hex');
  hashes[`/${path}`] = hash; compressed.set(hash, bytes);
}
if (!hashes['/sw.js'] || !hashes['/index.html']) throw new Error('Run bun run build:hosted first.');
const version = await request<{ name: string }>(`/sites/${target.site}/versions`, 'POST', { config: {
  headers: [
    { glob: '**', headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache', 'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()' } },
    { glob: '/_expo/**', headers: { 'Cache-Control': 'public,max-age=31536000,immutable' } },
    { glob: '/assets/**', headers: { 'Cache-Control': 'public,max-age=31536000,immutable' } },
  ],
  rewrites: [{ glob: '/api/**', run: { serviceId: target.service, region: target.region } }, { glob: '**', path: '/index.html' }],
} });
const upload = await request<{ uploadUrl: string; uploadRequiredHashes?: string[] }>(`/${version.name}:populateFiles`, 'POST', { files: hashes });
const queue = [...(upload.uploadRequiredHashes ?? [])];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let hash = queue.pop(); hash; hash = queue.pop()) await client.request({ url: `${upload.uploadUrl}/${hash}`, method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, data: Buffer.from(compressed.get(hash)!) });
}));
await request(`/${version.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' });
const release = await request<{ name: string }>(`/sites/${target.site}/releases?versionName=${encodeURIComponent(version.name)}`, 'POST', { message: 'Pete authenticated PWA release' });
await Bun.write('.cache/pete-release.json', JSON.stringify({ version: version.name, release: release.name, target, at: new Date().toISOString() }, null, 2));
console.log(`Released https://${target.site}.web.app (${version.name})`);
