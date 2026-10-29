import { createHash } from 'node:crypto';
import config from '../app.json';
import { pwaWorker } from './pwa-worker';

// Run after Expo's production export. Dev/HMR never registers a worker.
const output = process.env.PETE_WEB_OUTPUT || 'dist';
const htmlFile = Bun.file(`${output}/index.html`);
let html = await htmlFile.text();
html = html.replace(/<html[^>]*>/, '<html lang="en-US">');
html = html.replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
html = html.replace('</head>', `<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/pete-glow.ico" sizes="16x16 32x32 48x48" type="image/x-icon">
<link rel="icon" href="/icons/pete-glow-16.png" sizes="16x16" type="image/png">
<link rel="icon" href="/icons/pete-glow-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/icons/pete-glow-180.png" sizes="180x180">
<meta name="theme-color" content="#365C49">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Pete">
<style>html,body,#root{height:100%;height:100dvh;overflow:hidden}body{overscroll-behavior:none;position:fixed;width:100%;inset:0}</style>
</head>`);
await Bun.write(htmlFile, html);
const paths = (await Array.fromAsync(new Bun.Glob('**/*').scan({ cwd: output, onlyFiles: true })))
  .filter(path => path === 'index.html' || path === 'manifest.webmanifest' || path.startsWith('icons/') || /^(?:assets|_expo)\/.*\.(?:js|wasm|ttf|woff2?|png|jpg|svg)$/.test(path)).sort();
const hash = createHash('sha256');
for (const path of paths) { hash.update(path); hash.update(await Bun.file(`${output}/${path}`).bytes()); }
const version = hash.digest('hex').slice(0, 16);
// Hash the exported resources before adding derived metadata (avoids a hash cycle).
// This document and its assets are cached together, keeping the visible hint honest.
html = html.replace('</head>', `<meta name="pete-version" content="${config.expo.version}">\n<meta name="pete-build" content="${version}">\n</head>`);
await Bun.write(htmlFile, html);
const worker = pwaWorker(version, paths.map(path => `/${path}`));
await Bun.write(`${output}/sw.js`, worker);
console.log(`PWA shell ${version}: ${paths.length} public resources; OCR loads on demand.`);
