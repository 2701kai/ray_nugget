import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { installIdentity } from '../e2e-hosted/identity';
import { pwaWorker } from '../scripts/pwa-worker';

// Two genuine service-worker releases on one isolated origin. Only synthetic
// visitor data; identity and processing never reach live Google/company APIs.
async function releases() {
  const root = resolve('dist-hosted');
  const html = await readFile(`${root}/index.html`, 'utf8');
  const worker = await readFile(`${root}/sw.js`, 'utf8');
  const assets = JSON.parse(worker.match(/const ASSETS = (.*);/)![1]) as string[];
  let version = 1, failAsset = false;
  const build = () => String(version).repeat(16);
  const sentinel = () => `/assets/update-fixture-${version}.txt`;
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/sw.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(pwaWorker(build(), [...assets, sentinel()])); }
    if (path === '/legacy.html') { res.setHeader('Content-Type', 'text/html'); return res.end('<p>Older tab without update support</p>'); }
    if (path === '/' || path === '/index.html') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(html.replace(/name="pete-build" content="[^"]+"/, `name="pete-build" content="${build()}"`).replace(/name="pete-version" content="[^"]+"/, `name="pete-version" content="8.0.${version}"`));
    }
    if (path.startsWith('/assets/update-fixture-')) { res.statusCode = path === sentinel() && !failAsset ? 200 : 503; return res.end(`Public asset for release ${version}`); }
    const file = resolve(root, `.${path}`);
    if (!file.startsWith(root + '/')) { res.statusCode = 404; return res.end(); }
    try {
      const body = await readFile(file);
      const mime: Record<string, string> = { js: 'application/javascript', ttf: 'font/ttf', png: 'image/png', webmanifest: 'application/manifest+json' };
      res.setHeader('Content-Type', mime[path.split('.').pop()!] || 'application/octet-stream'); res.end(body);
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { origin, next: () => { version++; }, fail: (value: boolean) => { failAsset = value; }, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
async function ready(page: Page) {
  await page.bringToFront();
  await expect(page.getByText('Version 8.0.1', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}
async function checkUpdate(page: Page) {
  await page.bringToFront();
  // The same foreground event used when returning to Pete on a phone.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}
async function visitor(page: Page) {
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await page.getByRole('button', { name: 'Details & request', exact: true }).click();
  await page.getByRole('button', { name: 'Edit contact', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Synthetic Update Visitor');
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
}
test.beforeEach(async ({ context }) => {
  await installIdentity(context);
  await context.route('**/api/transcriptions/**', route => route.fulfill({ json: { state: 'complete', text: 'Synthetic update voice memo.', engine: 'Synthetic' } }));
  await context.route('**/api/extractions/**', route => route.fulfill({ json: { state: 'complete', result: { fields: {}, request: {}, questions: [] }, engine: 'Synthetic' } }));
});

test('update keeps an unsaved form, then reloads with the same signed-in account, visitor and offline shell', async ({ page }) => {
  const site = await releases();
  try {
    await page.goto(site.origin); await ready(page); await visitor(page);
    await page.getByRole('button', { name: 'Edit contact', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Synthetic Edited Visitor');
    await page.getByLabel('Name', { exact: true }).blur();
    site.next(); await checkUpdate(page);
    await expect(page.getByText(/New version ready/)).toBeAttached();
    await page.waitForTimeout(6500);
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Synthetic Edited Visitor');
    await expect(page.getByText('Version 8.0.1', { exact: true })).toBeAttached();
    await page.bringToFront();
    await page.getByRole('button', { name: 'Save contact', exact: true }).click();
    await expect(page.getByText('Version 8.0.2', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Synthetic Edited Visitor', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByText('autofill-test@bevmaq.com', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await page.evaluate(async () => !!(await (await caches.open('pete-shell-2222222222222222')).match('/index.html')))).toBe(true);
    await page.context().setOffline(true); await page.reload();
    await expect(page.getByText('Version 8.0.2', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Synthetic Edited Visitor', exact: true })).toBeVisible();
  } finally { await page.context().setOffline(false); await site.close(); }
});

test('idle tab updates independently while another tab edits; older assets survive until the edit is saved', async ({ page, context }) => {
  const site = await releases();
  try {
    await page.goto(site.origin); await ready(page); await visitor(page);
    await page.getByRole('button', { name: 'Edit contact', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Synthetic Two Tab Visitor');
    const idle = await context.newPage(); await idle.goto(site.origin); await ready(idle);
    site.next(); await checkUpdate(idle);
    await expect(idle.getByText('Version 8.0.2', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Synthetic Two Tab Visitor');
    await expect(page.getByText('Version 8.0.1', { exact: true })).toBeAttached();
    expect(await page.evaluate(async () => (await fetch('/assets/update-fixture-1.txt')).status)).toBe(200);
    expect(await page.evaluate(async () => (await caches.keys()).includes('pete-shell-1111111111111111'))).toBe(true);
    await page.bringToFront();
    await page.getByRole('button', { name: 'Save contact', exact: true }).click();
    await expect(page.getByText('Version 8.0.2', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Synthetic Two Tab Visitor', exact: true })).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.controller?.postMessage({ type: 'PETE_CLIENT_READY' }));
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).includes('pete-shell-1111111111111111'))).toBe(false);
    await idle.close();
  } finally { await site.close(); }
});

test('a running voice capture is not interrupted by activation and its original survives automatic refresh', async ({ page }) => {
  const site = await releases();
  try {
    await page.goto(site.origin); await ready(page); await visitor(page);
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
    await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
    site.next(); await checkUpdate(page);
    await expect(page.getByText(/New version ready/)).toBeAttached();
    await page.waitForTimeout(6500);
    await expect(page.getByRole('button', { name: 'Stop and save recording', exact: true })).toBeVisible();
    await expect(page.getByText('Version 8.0.1', { exact: true })).toBeAttached();
    await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
    await expect(page.getByText('Version 8.0.2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Play recording', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
  } finally { await site.close(); }
});

test('failed update installation keeps the current app; retry updates even with an older nonresponding tab open', async ({ page, context }) => {
  const site = await releases();
  try {
    const legacy = await context.newPage(); await legacy.goto(`${site.origin}/legacy.html`);
    await expect(legacy.getByText('Older tab without update support')).toBeVisible();
    await page.goto(site.origin); await ready(page);
    site.next(); site.fail(true); await checkUpdate(page);
    await page.waitForTimeout(6500);
    await expect(page.getByText('Version 8.0.1', { exact: true })).toBeVisible();
    expect(await page.evaluate(async () => (await caches.keys()).includes('pete-shell-1111111111111111'))).toBe(true);
    site.fail(false); await checkUpdate(page);
    await expect(page.getByText('Version 8.0.2', { exact: true })).toBeVisible();
    await expect(legacy.getByText('Older tab without update support')).toBeVisible();
    expect(await legacy.evaluate(async () => (await fetch('/assets/update-fixture-1.txt')).status)).toBe(200);
    await legacy.close();
  } finally { await site.close(); }
});
