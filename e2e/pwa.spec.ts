import { expect, test } from '@playwright/test';

test('installed shell reopens offline, keeps the selected visitor, and queues audio until reconnect', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let transcriptions = 0;
  await page.route('http://127.0.0.1:8091/**', route => {
    transcriptions++;
    return route.fulfill({ json: { state: 'complete', text: 'Offline synthetic note.', engine: 'Browser fixture' }, headers: { 'Access-Control-Allow-Origin': 'http://localhost:8082' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Capture contact', exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Offline visitor');
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Offline visitor', exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href)).json());
  expect(manifest.display).toBe('standalone');
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(r => new URL(r.url).pathname)))).flat());
  expect(cached).toContain('/index.html');
  expect(cached.some(path => path.startsWith('/ocr/'))).toBe(false);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Offline visitor', exact: true })).toBeVisible();
  await expect(page.getByText(/^Offline · capture continues/)).toBeVisible();
  await page.getByRole('button', { name: 'Add quick note', exact: true }).click();
  await page.getByLabel('Quick note', { exact: true }).fill('Needs a glass bottle filler.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByText('Needs a glass bottle filler.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
  const jobs = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('ray-nugget-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const result = await new Promise<any[]>((resolve, reject) => { const r = db.transaction('jobs').objectStore('jobs').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close(); return result;
  });
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ state: 'queued', attempts: 0 });
  expect(transcriptions).toBe(0);
  await page.reload();
  await expect(page.getByText('Needs a glass bottle filler.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Review extracted text', exact: true })).toBeVisible();
  expect(transcriptions).toBeGreaterThan(0);
  const allCached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(r => r.url)))).flat());
  expect(allCached.some(url => url.includes(':8091') || url.includes('transcriptions'))).toBe(false);
  await page.screenshot({ path: test.info().outputPath('offline-mobile-conversation.png') });
});
