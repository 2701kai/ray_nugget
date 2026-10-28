import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.PETE_E2E_PRODUCTION !== '1', 'Backup offline roundtrip uses the production service worker.');

async function readDrafts(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('ray-nugget-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const rows = await new Promise<any[]>((resolve, reject) => { const request = db.transaction('drafts').objectStore('drafts').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    db.close(); return rows;
  });
}
async function chooseBackup(page: Page, buffer: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Choose (?:another backup|backup file)/ }).click();
  await (await chooser).setFiles({ name: 'synthetic-backup.pete', mimeType: 'application/octet-stream', buffer });
}

test('offline backup transfers original photos and playable audio to a fresh device without overwrites or automatic transcription', async ({ page, context, browser }) => {
  test.setTimeout(90000);
  await page.route('http://127.0.0.1:8091/**', route => route.abort());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole('button', { name: 'Capture contact', exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Backup Test Visitor');
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backup Test Visitor', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Capture business card', exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 200, 100);
    ctx.fillStyle = '#294b39'; ctx.font = '20px sans-serif'; ctx.fillText('Synthetic card', 12, 50);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const photo = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a card photo', exact: true }).click();
  await (await photo).setFiles({ name: 'backup-card.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('img', { name: 'backup-card.png', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Details & request', exact: true }).click();
  await page.getByRole('button', { name: 'Download backup file', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save backup file', exact: true }).click();
  const file = await downloading; expect(file.suggestedFilename()).toMatch(/\.pete$/);
  const stream = await file.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 15).toString()).toBe('PETE_BACKUP_V1\n');
  const original = (await readDrafts(page))[0];

  const target = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const targetPage = await target.newPage(); let transcriptions = 0;
  await targetPage.route('http://127.0.0.1:8091/**', route => {
    transcriptions++;
    return route.fulfill({ json: { state: 'complete', text: 'Synthetic restored recording. We need juice in glass bottles at 2400 bottles/h.', engine: 'Synthetic backup test processor' }, headers: { 'Access-Control-Allow-Origin': 'http://localhost:8082' } });
  });
  try {
    await targetPage.goto('/');
    await targetPage.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => targetPage.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await target.setOffline(true);
    await targetPage.getByRole('button', { name: 'Restore a backup', exact: true }).click();
    const damaged = Buffer.from(bytes); damaged[damaged.length - 1] ^= 255;
    await chooseBackup(targetPage, damaged);
    await expect(targetPage.getByText(/This backup is incomplete, damaged/)).toBeVisible();
    expect(await readDrafts(targetPage)).toHaveLength(0);
    await chooseBackup(targetPage, bytes);
    await expect(targetPage.getByText(/1 card photo · 1 recording/)).toBeVisible();
    expect(await targetPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await targetPage.screenshot({ path: test.info().outputPath('backup-restore-mobile.png'), animations: 'disabled' });
    await targetPage.getByRole('button', { name: 'Restore draft', exact: true }).click();
    await expect(targetPage.getByText('Restored draft and originals on this device.', { exact: true })).toBeVisible();
    await expect(targetPage.getByRole('img', { name: 'backup-card.png', exact: true })).toBeVisible();
    await expect.poll(() => targetPage.getByRole('img', { name: 'backup-card.png', exact: true }).evaluate(root => {
      const image = root instanceof HTMLImageElement ? root : root.querySelector('img');
      return image?.naturalWidth;
    })).toBe(200);
    await targetPage.getByRole('button', { name: 'Play recording', exact: true }).click();
    await expect(targetPage.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
    const restored = (await readDrafts(targetPage))[0];
    expect(restored.id).not.toBe(original.id);
    expect(restored.attachments).toEqual(original.attachments);
    await targetPage.reload();
    await expect(targetPage.getByRole('heading', { name: 'Backup Test Visitor', exact: true })).toBeVisible();
    await expect(targetPage.getByText('Processing paused · retry when ready', { exact: true })).toHaveCount(2);
    expect(transcriptions).toBe(0);

    await targetPage.getByRole('button', { name: 'Details & request', exact: true }).click();
    await targetPage.getByRole('button', { name: 'Edit contact', exact: true }).click();
    await targetPage.getByLabel('Full name', { exact: true }).fill('Edited after restore');
    await targetPage.getByRole('button', { name: 'Save contact', exact: true }).click();
    await expect(targetPage.getByRole('heading', { name: 'Edited after restore', exact: true })).toBeVisible();
    await targetPage.getByRole('button', { name: 'Settings', exact: true }).click();
    await targetPage.getByRole('button', { name: 'Restore a backup', exact: true }).click();
    await chooseBackup(targetPage, bytes);
    await targetPage.getByRole('button', { name: 'Restore draft', exact: true }).click();
    await expect(targetPage.getByText('Opened the existing restored draft. Your edits are kept.', { exact: true })).toBeVisible();
    expect(await readDrafts(targetPage)).toHaveLength(1);
    expect((await readDrafts(targetPage))[0].contact.name).toBe('Edited after restore');
    expect((await readDrafts(page))[0].contact.name).toBe('Backup Test Visitor');
    await target.setOffline(false);
    await expect(targetPage.getByText(/^Offline ·/)).toHaveCount(0);
    await expect(targetPage.getByText('Processing paused · retry when ready', { exact: true })).toHaveCount(2);
    expect(transcriptions).toBe(0);
    await targetPage.getByRole('button', { name: 'Retry processing', exact: true }).last().click();
    await expect(targetPage.getByRole('button', { name: 'Review extracted text', exact: true })).toBeVisible();
    expect(transcriptions).toBeGreaterThan(0);
    await expect(targetPage.getByText(/Synthetic restored recording/)).toBeVisible();
  } finally { await target.close(); }
});
