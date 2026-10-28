import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.route('http://127.0.0.1:8091/**', route => route.fulfill({ json: { state: 'complete', text: 'Synthetic inline capture.', engine: 'Browser fixture' }, headers: { 'Access-Control-Allow-Origin': route.request().headers().origin } }));
});

test('inline capture keeps its visitor and recording through navigation attempts and layout changes', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as any).__micStarts = 0;
    navigator.mediaDevices.getUserMedia = options => { (window as any).__micStarts++; return original(options); };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter manually', exact: true }).click();
  await page.getByRole('button', { name: 'Capture contact', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Mara Lind · inline test');
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByLabel('Note', { exact: true }).fill('Synthetic earlier conversation note.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Mara Lind · inline test', exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic earlier conversation note.', { exact: true })).toBeVisible();
  for (const name of ['New visitor', 'Settings', 'Visitors', 'Close', 'Details & request']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  const dock = await page.getByTestId('recording-dock').boundingBox();
  expect(dock!.height).toBeLessThan(230);
  expect(dock!.y + dock!.height).toBeLessThanOrEqual(874);
  await page.screenshot({ path: test.info().outputPath('inline-recording-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('button', { name: 'Stop and save recording', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit contact', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Open visitor Mara Lind · inline test', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 402, height: 874 });
  expect(await page.evaluate(() => (window as any).__micStarts)).toBe(1);
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByTestId('recording-dock')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mara Lind · inline test', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toHaveCount(0);
  const records = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('ray-nugget-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const drafts = await new Promise<any[]>((resolve, reject) => { const r = db.transaction('drafts').objectStore('drafts').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); db.close(); return drafts;
  });
  expect(records).toHaveLength(2);
  expect(records.find(d => d.contact.name === 'Mara Lind · inline test').attachments).toMatchObject([{ kind: 'voice', voiceMode: 'memo' }]);
  expect(records.find(d => !d.contact.name).attachments).toHaveLength(0);
});

test('playback shows actual time, seeks within the recording, and pauses before a new capture', async ({ page }) => {
  // Thirty seconds of synthetic PCM; no customer audio or live processing.
  const sampleRate = 8000, length = sampleRate * 30, wav = Buffer.alloc(44 + length * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) wav.writeInt16LE(Math.round(Math.sin(i / sampleRate * 440 * Math.PI * 2) * 100), 44 + i * 2);
  await page.goto('/');
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await page.evaluate(async ({ base64, sha256 }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('ray-nugget-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const tx = db.transaction(['drafts', 'media'], 'readwrite'), store = tx.objectStore('drafts'), get = store.getAll();
    get.onsuccess = () => {
      const draft = get.result[0], id = 'synthetic-playback';
      draft.attachments.push({ id, kind: 'voice', name: 'Synthetic playback example', mimeType: 'audio/wav', bytes: bytes.length, sha256, capturedAt: draft.createdAt, voiceMode: 'memo' });
      store.put(draft); tx.objectStore('media').put(bytes, `${draft.id}:${id}`);
    };
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, { base64: wav.toString('base64'), sha256: createHash('sha256').update(wav).digest('hex') });
  await page.reload();
  await expect(page.getByLabel('Playback time', { exact: true })).toHaveText('00:00 / 00:30');
  await page.getByRole('button', { name: 'Skip forward 10 seconds', exact: true }).click();
  await expect(page.getByLabel('Playback time', { exact: true })).toHaveText('00:10 / 00:30');
  await page.getByRole('button', { name: 'Skip back 10 seconds', exact: true }).click();
  await expect(page.getByLabel('Playback time', { exact: true })).toHaveText('00:00 / 00:30');
  await expect(page.getByRole('progressbar', { name: 'Recording playback', exact: true })).toHaveAttribute('aria-valuemax', '30');
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('playback-mobile.png') });
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toHaveCount(0);
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toHaveCount(2);
});
