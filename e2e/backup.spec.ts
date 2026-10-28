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
  await page.getByRole('button', { name: /(?:Anderes Backup wählen|Backup-Datei wählen)/ }).click();
  await (await chooser).setFiles({ name: 'synthetic-backup.pete', mimeType: 'application/octet-stream', buffer });
}

test('offline backup transfers original photos and playable audio to a fresh device without overwrites or automatic transcription', async ({ page, context, browser }) => {
  test.setTimeout(90000);
  await page.route('http://127.0.0.1:8091/**', route => route.abort());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole('button', { name: 'Manuell erfassen', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt eingeben', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Backup Test Visitor');
  await page.getByRole('button', { name: 'Kontakt speichern', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backup Test Visitor', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Visitenkarte aufnehmen', exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 200, 100);
    ctx.fillStyle = '#294b39'; ctx.font = '20px sans-serif'; ctx.fillText('Synthetic card', 12, 50);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const photo = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Kartenfoto auswählen', exact: true }).click();
  await (await photo).setFiles({ name: 'backup-card.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('img', { name: 'backup-card.png', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sprachnotiz aufnehmen', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stoppen und speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aufnahme abspielen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Kontakt & Bedarf', exact: true }).click();
  await page.getByRole('button', { name: 'Besucher als .pete-Datei exportieren', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup-Datei speichern', exact: true }).click();
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
    await targetPage.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await targetPage.getByRole('button', { name: 'Backup wiederherstellen', exact: true }).click();
    const damaged = Buffer.from(bytes); damaged[damaged.length - 1] ^= 255;
    await chooseBackup(targetPage, damaged);
    await expect(targetPage.getByText(/This backup is incomplete, damaged/)).toBeVisible();
    expect(await readDrafts(targetPage)).toHaveLength(0);
    await chooseBackup(targetPage, bytes);
    await expect(targetPage.getByText(/Kartenfotos: 1 · Aufnahmen: 1/)).toBeVisible();
    expect(await targetPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await targetPage.screenshot({ path: test.info().outputPath('backup-restore-mobile.png'), animations: 'disabled' });
    await targetPage.getByRole('button', { name: 'Besucher wiederherstellen', exact: true }).click();
    await expect(targetPage.getByText('Besucher und Originale wurden hier wiederhergestellt.', { exact: true })).toBeVisible();
    await expect(targetPage.getByRole('img', { name: 'backup-card.png', exact: true })).toBeVisible();
    await expect.poll(() => targetPage.getByRole('img', { name: 'backup-card.png', exact: true }).evaluate(root => {
      const image = root instanceof HTMLImageElement ? root : root.querySelector('img');
      return image?.naturalWidth;
    })).toBe(200);
    await targetPage.getByRole('button', { name: 'Aufnahme abspielen', exact: true }).click();
    await expect(targetPage.getByRole('button', { name: 'Aufnahme pausieren', exact: true })).toBeVisible();
    const restored = (await readDrafts(targetPage))[0];
    expect(restored.id).not.toBe(original.id);
    expect(restored.attachments).toEqual(original.attachments);
    await targetPage.reload();
    await expect(targetPage.getByRole('heading', { name: 'Backup Test Visitor', exact: true })).toBeVisible();
    await expect(targetPage.getByText('Verarbeitung pausiert · Du kannst sie erneut starten', { exact: true })).toHaveCount(2);
    expect(transcriptions).toBe(0);

    await targetPage.getByRole('button', { name: 'Kontakt & Bedarf', exact: true }).click();
    await targetPage.getByRole('button', { name: 'Kontakt bearbeiten', exact: true }).click();
    await targetPage.getByLabel('Name', { exact: true }).fill('Edited after restore');
    await targetPage.getByRole('button', { name: 'Kontakt speichern', exact: true }).click();
    await expect(targetPage.getByRole('heading', { name: 'Edited after restore', exact: true })).toBeVisible();
    await targetPage.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await targetPage.getByRole('button', { name: 'Backup wiederherstellen', exact: true }).click();
    await chooseBackup(targetPage, bytes);
    await targetPage.getByRole('button', { name: 'Besucher wiederherstellen', exact: true }).click();
    await expect(targetPage.getByText('Die vorhandene Import-Kopie ist geöffnet. Deine Änderungen bleiben erhalten.', { exact: true })).toBeVisible();
    expect(await readDrafts(targetPage)).toHaveLength(1);
    expect((await readDrafts(targetPage))[0].contact.name).toBe('Edited after restore');
    expect((await readDrafts(page))[0].contact.name).toBe('Backup Test Visitor');
    await target.setOffline(false);
    await expect(targetPage.getByText(/^Offline ·/)).toHaveCount(0);
    await expect(targetPage.getByText('Verarbeitung pausiert · Du kannst sie erneut starten', { exact: true })).toHaveCount(2);
    expect(transcriptions).toBe(0);
    await targetPage.getByRole('button', { name: 'Verarbeitung wiederholen', exact: true }).last().click();
    await expect(targetPage.getByRole('button', { name: 'Erkannten Text prüfen', exact: true })).toBeVisible();
    expect(transcriptions).toBeGreaterThan(0);
    await expect(targetPage.getByText(/Synthetic restored recording/)).toBeVisible();
  } finally { await target.close(); }
});
