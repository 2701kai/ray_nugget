import { expect, test, type Page } from '@playwright/test';

// Synthetic Chromium microphone only; processing is intercepted locally.
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('http://127.0.0.1:8091/**', route => route.fulfill({ json: { state: 'complete', text: 'Synthetic kept recording.', engine: 'Browser fixture' }, headers: { 'Access-Control-Allow-Origin': route.request().headers().origin } }));
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as any).__audioStreams = [];
    (window as any).__micDelay = false;
    (window as any).__micDenied = false;
    navigator.mediaDevices.getUserMedia = async options => {
      if ((window as any).__micDenied) { (window as any).__micDenied = false; throw new DOMException('Synthetic denial', 'NotAllowedError'); }
      const stream = await original(options);
      (window as any).__audioStreams.push(stream);
      if ((window as any).__micDelay) await new Promise<void>(resolve => { (window as any).__releaseMic = resolve; });
      return stream;
    };
    const stop = MediaRecorder.prototype.stop;
    MediaRecorder.prototype.stop = function () {
      if ((window as any).__failStop) { (window as any).__failStop = false; throw new Error('Synthetic microphone stop failure'); }
      return stop.call(this);
    };
    const now = performance.now.bind(performance);
    performance.now = () => now() + ((window as any).__elapsedOffset || 0);
  });
});

async function begin(page: Page) {
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('ray-nugget-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const read = (store: string) => new Promise<any[]>((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const [drafts, jobs, media] = await Promise.all([read('drafts'), read('jobs'), read('media')]); db.close();
    return { drafts, jobs, hashes: await Promise.all(media.map(async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join(''))) };
  });
}
async function micStopped(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).__audioStreams.every((stream: MediaStream) => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
}
async function hidden(page: Page) {
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
}

test('active discard needs confirmation, keeps the visitor locked, saves nothing, and permits another recording', async ({ page }) => {
  let processingRequests = 0;
  page.on('request', request => { if (request.url().startsWith('http://127.0.0.1:8091/')) processingRequests++; });
  await page.goto('/'); await begin(page);
  await expect(page.getByRole('button', { name: 'Discard recording', exact: true })).toBeVisible();
  const dock = await page.getByTestId('recording-dock').boundingBox(); expect(dock!.height).toBeLessThan(230);
  await page.screenshot({ path: test.info().outputPath('active-recording-discard-mobile.png') });
  await page.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await expect(page.getByText('Discard this recording? It won’t be saved.', { exact: true })).toBeVisible();
  for (const name of ['New visitor', 'Visitors', 'Close', 'Settings']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  await page.getByRole('button', { name: 'Keep recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop and save recording', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__audioStreams[0].getAudioTracks()[0].readyState)).toBe('live');
  await page.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 568 });
  const confirmation = await page.getByTestId('recording-dock').boundingBox();
  expect(confirmation!.y + confirmation!.height).toBeLessThanOrEqual(568);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('confirm-recording-discard-small-mobile.png') });
  // Repeated confirmation and a foreground event must not start a save.
  await page.getByRole('button', { name: 'Confirm discard recording', exact: true }).evaluate(element => { (element as HTMLElement).click(); (element as HTMLElement).click(); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByTestId('recording-dock')).toHaveCount(0); await micStopped(page);
  await expect(page.getByText('Recording discarded.', { exact: true })).toBeVisible();
  const empty = await stored(page); expect(empty.hashes).toEqual([]); expect(empty.jobs).toEqual([]); expect(empty.drafts[0].attachments).toEqual([]);
  expect(processingRequests).toBe(0);
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  await begin(page); await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible(); await micStopped(page);
  const saved = await stored(page); expect(saved.hashes).toHaveLength(1); expect(saved.jobs).toHaveLength(1); expect(saved.jobs[0].draftId).toBe(empty.drafts[0].id);
});

test('discarding a later recording preserves saved originals and visitor association after reload', async ({ page }) => {
  await page.goto('/'); await begin(page);
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
  const original = await stored(page);
  await begin(page);
  await page.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm discard recording', exact: true }).click();
  await expect(page.getByTestId('recording-dock')).toHaveCount(0); await micStopped(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toHaveCount(0);
  const after = await stored(page); expect(after.hashes).toEqual(original.hashes); expect(after.jobs).toHaveLength(1);
  expect(after.drafts.find(draft => draft.id === original.drafts[0].id).attachments).toEqual(original.drafts[0].attachments);
  expect(after.drafts.find(draft => draft.id !== original.drafts[0].id).attachments).toEqual([]);
});

for (const keep of [false, true]) test(`background stop during confirmation waits for ${keep ? 'keep and save' : 'discard'}`, async ({ page }) => {
  await page.goto('/'); await begin(page);
  await page.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await hidden(page);
  await expect(page.getByRole('button', { name: 'Keep & save', exact: true })).toBeEnabled(); await micStopped(page);
  const pending = await stored(page); expect(pending.hashes).toEqual([]); expect(pending.jobs).toEqual([]);
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  await page.getByRole('button', { name: keep ? 'Keep & save' : 'Confirm discard recording', exact: true }).click();
  await expect(page.getByTestId('recording-dock')).toHaveCount(0);
  const result = await stored(page); expect(result.hashes).toHaveLength(keep ? 1 : 0); expect(result.jobs).toHaveLength(keep ? 1 : 0);
  if (keep) expect(result.jobs[0].draftId).toBe(pending.drafts[0].id);
});

test('the recording limit stops the mic but does not save while discard confirmation is open', async ({ page }) => {
  await page.goto('/'); await begin(page);
  await page.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await page.evaluate(() => { (window as any).__elapsedOffset = 180_000; });
  await expect(page.getByRole('button', { name: 'Keep & save', exact: true })).toBeEnabled(); await micStopped(page);
  expect((await stored(page)).hashes).toEqual([]);
  await page.getByRole('button', { name: 'Confirm discard recording', exact: true }).click();
  await expect(page.getByTestId('recording-dock')).toHaveCount(0);
  expect((await stored(page)).jobs).toEqual([]);
});

test('cancel during microphone preparation prevents late recording and releases an eventual permission stream', async ({ page }) => {
  await page.goto('/'); await page.evaluate(() => { (window as any).__micDelay = true; });
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseMic)).toBe('function');
  await page.getByRole('button', { name: 'Cancel microphone preparation', exact: true }).click();
  await expect(page.getByText('Canceling microphone…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).__micDelay = false; (window as any).__releaseMic(); });
  await expect(page.getByTestId('recording-dock')).toHaveCount(0); await micStopped(page);
  await expect(page.getByText('Recording canceled.', { exact: true })).toBeVisible();
  expect((await stored(page)).hashes).toEqual([]); expect((await stored(page)).jobs).toEqual([]);
  await begin(page);
  await page.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm discard recording', exact: true }).click();
  await expect(page.getByTestId('recording-dock')).toHaveCount(0); await micStopped(page);
});

test('permission denial unlocks the capture, then allows a recording to be discarded', async ({ page }) => {
  await page.goto('/'); await page.evaluate(() => { (window as any).__micDenied = true; });
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByText('Microphone access is off. Allow it in device or browser settings, then try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm discard recording', exact: true }).click();
  await expect(page.getByTestId('recording-dock')).toHaveCount(0); await micStopped(page);
});

test('a failed discard keeps the capture guarded and recoverable until retry succeeds', async ({ page }) => {
  await page.goto('/'); await begin(page);
  await page.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await page.evaluate(() => { (window as any).__failStop = true; });
  await page.getByRole('button', { name: 'Confirm discard recording', exact: true }).click();
  await expect(page.getByText('Synthetic microphone stop failure', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep recording', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  expect((await stored(page)).jobs).toEqual([]);
  await page.getByRole('button', { name: 'Confirm discard recording', exact: true }).click();
  await expect(page.getByTestId('recording-dock')).toHaveCount(0); await micStopped(page);
  expect((await stored(page)).hashes).toEqual([]);
});

test('failed-save recovery can discard its temporary copy without creating media or jobs', async ({ page }) => {
  await page.addInitScript(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'media') throw new DOMException('Synthetic full storage', 'QuotaExceededError');
      return add.apply(this, args as [any, IDBValidKey?]);
    };
  });
  await page.goto('/'); await begin(page);
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saving recording', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download original recording', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm discard recording', exact: true }).click();
  await expect(page.getByTestId('recording-dock')).toHaveCount(0); await micStopped(page);
  const result = await stored(page); expect(result.hashes).toEqual([]); expect(result.jobs).toEqual([]);
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
});

test('a save already in progress cannot race a discard or a second automatic save', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      if (typeof args[0] === 'string' && args[0].startsWith('blob:')) await new Promise<void>(resolve => { (window as any).__resumeAudioRead = resolve; });
      return original(...args);
    };
  });
  await page.goto('/'); await begin(page);
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__resumeAudioRead)).toBe('function');
  await expect(page.getByRole('button', { name: 'Saving recording…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Discard recording', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await hidden(page);
  await page.evaluate(() => { (window as any).__resumeAudioRead(); });
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible(); await micStopped(page);
  const result = await stored(page); expect(result.hashes).toHaveLength(1); expect(result.jobs).toHaveLength(1);
});

test('consented conversations support discard after consent and leave no attachment', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await page.getByRole('button', { name: 'Record conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Discard recording', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'The other person agreed to this recording', exact: true }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await expect(page.getByText('Recording · 30 min maximum', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm discard recording', exact: true }).click();
  await expect(page.getByTestId('recording-dock')).toHaveCount(0); await micStopped(page);
  const result = await stored(page); expect(result.hashes).toEqual([]); expect(result.jobs).toEqual([]); expect(result.drafts[0].attachments).toEqual([]);
});
