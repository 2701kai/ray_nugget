import { resolve, sep } from 'node:path';

const root = resolve(process.env.PETE_WEB_OUTPUT || 'dist');
if (!(await Bun.file(resolve(root, 'sw.js')).exists())) throw new Error('Run bun run build:web before preview.');
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PETE_PREVIEW_PORT || 8081),
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    let path: string;
    try { path = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response('Invalid path', { status: 400 }); }
    const absolute = resolve(root, `.${path}`);
    if (absolute !== root && !absolute.startsWith(root + sep)) return new Response('Not found', { status: 404 });
    let file = Bun.file(absolute === root ? resolve(root, 'index.html') : absolute);
    if (!(await file.exists())) {
      if (path.includes('.') || !request.headers.get('accept')?.includes('text/html')) return new Response('Not found', { status: 404 });
      file = Bun.file(resolve(root, 'index.html'));
    }
    return new Response(request.method === 'HEAD' ? null : file, { headers: {
      'Content-Type': path.endsWith('.webmanifest') ? 'application/manifest+json' : file.type,
      'Cache-Control': path.startsWith('/_expo/') || path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    } });
  },
});
console.log(`Pete production preview: http://localhost:${server.port}`);
