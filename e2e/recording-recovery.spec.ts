import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('http://127.0.0.1:8091/**', route => route.fulfill({ json: { state: 'complete', text: 'Synthetic saved note.', engine: 'Browser fixture' }, headers: { 'Access-Control-Allow-Origin': route.request().headers().origin } }));
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as any).__audioStreams = [];
    navigator.mediaDevices.getUserMedia = async options => { const stream = await original(options); (window as any).__audioStreams.push(stream); return stream; };
  });
});
async function begin(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
}
async function originals(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('ray-nugget-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const read = (name: string) => new Promise<any[]>((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const [drafts, jobs, media] = await Promise.all([read('drafts'), read('jobs'), read('media')]); db.close();
    return { drafts, jobs, sizes: media.map(bytes => bytes.length), hashes: await Promise.all(media.map(async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join(''))) };
  });
}
async function micStopped(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).__audioStreams.every((stream: MediaStream) => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
}

test('a disconnected microphone preserves final audio and releases the microphone', async ({ page }) => {
  await begin(page);
  await page.evaluate(() => { for (const stream of (window as any).__audioStreams as MediaStream[]) for (const track of stream.getTracks()) { track.stop(); track.dispatchEvent(new Event('ended')); } });
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
  await micStopped(page);
  const saved = await originals(page);
  expect(saved.sizes).toHaveLength(1); expect(saved.sizes[0]).toBeGreaterThan(0);
  expect(saved.jobs[0].draftId).toBe(saved.drafts[0].id);
  expect(saved.hashes[0]).toBe(saved.drafts[0].attachments[0].sha256);
  await page.reload(); await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
});

test('leaving the visible app saves once and keeps the capture with its visitor', async ({ page }) => {
  await begin(page);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
  await micStopped(page);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  const saved = await originals(page);
  expect(saved.jobs).toHaveLength(1); expect(saved.sizes).toHaveLength(1);
  expect(saved.jobs[0].attachmentId).toBe(saved.drafts[0].attachments[0].id);
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toHaveCount(0);
  expect((await originals(page)).sizes).toHaveLength(1);
});

test('failed storage save keeps the original for download and retry; Close cannot silently discard it', async ({ page }) => {
  await page.addInitScript(() => {
    const add = IDBObjectStore.prototype.add;
    (window as any).__rejectAudioSave = true;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'media' && (window as any).__rejectAudioSave) throw new DOMException('Synthetic storage full', 'QuotaExceededError');
      return add.apply(this, args as [any, IDBValidKey?]);
    };
  });
  await begin(page); await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saving recording', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await expect(page.getByText('Not saved yet · keep this page open', { exact: true })).toBeVisible();
  expect((await originals(page)).jobs).toHaveLength(0); await micStopped(page);
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download original recording', exact: true }).click();
  const file = await download; const chunks: Buffer[] = [];
  for await (const chunk of (await file.createReadStream())!) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks); expect(bytes.length).toBeGreaterThan(0);
  expect(file.suggestedFilename()).toMatch(/^pete-.*-memo\.webm$/);
  await page.screenshot({ path: test.info().outputPath('recover-unsaved-recording.png'), animations: 'disabled' });
  await page.evaluate(() => { (window as any).__rejectAudioSave = false; });
  await page.getByRole('button', { name: 'Retry saving recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
  const saved = await originals(page);
  expect(saved.jobs).toHaveLength(1); expect(saved.sizes).toEqual([bytes.length]);
  expect(saved.hashes).toEqual([createHash('sha256').update(bytes).digest('hex')]);
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  await page.reload(); await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
});
