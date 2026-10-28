import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

// Replay the reported WebKit backend error on real IDB requests. The requests
// still abort real browser transactions, exercising rollback and the worker/UI.
async function injectFailure(page: Page, mode: 'index' | 'all' | 'off') {
  await page.addInitScript(mode => {
    const probe = { mode, failures: 0, scanReads: 0 }; (window as any).__storageFault = probe;
    const indexGet = IDBIndex.prototype.get;
    IDBIndex.prototype.get = function (...args) {
      const request = indexGet.apply(this, args);
      if (this.name === 'due' && probe.mode !== 'off') {
        probe.failures++;
        const transaction = this.objectStore.transaction;
        Object.defineProperty(request, 'error', { get: () => new DOMException('Attempt to get an index record from database without an in-progress transaction', 'UnknownError') });
        queueMicrotask(() => transaction.abort());
      }
      return request;
    };
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) {
      const request = getAll.apply(this, args);
      if (this.name === 'jobs' && this.transaction.mode === 'readwrite') {
        probe.scanReads++;
        if (probe.mode === 'all') {
          probe.failures++;
          const transaction = this.transaction;
          Object.defineProperty(request, 'error', { get: () => new DOMException('Synthetic temporary queue read failure', 'UnknownError') });
          queueMicrotask(() => transaction.abort());
        }
      }
      return request;
    };
  }, mode);
}

async function newVisitor(page: Page) {
  await page.getByRole('button', { name: 'Enter manually', exact: true }).click();
  await page.getByRole('button', { name: 'Capture contact', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Safari recovery visitor');
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Safari recovery visitor', exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:8091/**', route => route.abort());
});

test('reported index failure falls back without blocking capture and keeps originals through reload', async ({ page }) => {
  await injectFailure(page, 'index');
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window as any).__storageFault.failures)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Retry local storage', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New visitor', exact: true })).toBeEnabled();
  await newVisitor(page);
  await page.getByRole('button', { name: 'Capture business card', exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 250;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 250);
    ctx.fillStyle = 'black'; ctx.font = '40px Arial'; ctx.fillText('safari@example.test', 40, 120);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a card photo', exact: true }).click();
  await (await chooser).setFiles({ name: 'safari-card.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('button', { name: /^(Review extracted text|Check suggested changes)$/ })).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: /^(Review extracted text|Check suggested changes)$/ }).click();
  const chooseFields = page.getByRole('button', { name: 'View source and choose fields', exact: true });
  if (await chooseFields.isVisible()) await chooseFields.click();
  await expect(page.getByText('safari@example.test', { exact: true }).last()).toBeVisible();
  await page.getByRole('checkbox', { name: 'Use Email', exact: true }).check();
  await page.getByRole('button', { name: 'Apply selected details', exact: true }).click();
  await expect(page.getByText('Reviewed · source text kept', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__storageFault.scanReads)).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Safari recovery visitor', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'safari-card.png', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Details & request', exact: true }).click();
  await expect(page.getByText('safari@example.test', { exact: true }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry local storage', exact: true })).toHaveCount(0);
});

test('ongoing background queue errors leave capture usable and clear automatically after recovery', async ({ page }) => {
  await injectFailure(page, 'off');
  await page.goto('/'); await newVisitor(page);
  await page.evaluate(() => { (window as any).__storageFault.mode = 'all'; });
  await expect(page.getByText('Background processing is paused. You can keep capturing; Pete will retry.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry local storage', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New visitor', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByLabel('Note', { exact: true }).fill('Saved while queue reads were unavailable.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByText('Saved while queue reads were unavailable.', { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__storageFault.mode = 'off'; });
  await expect(page.getByText('Background processing is paused. You can keep capturing; Pete will retry.', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Saved while queue reads were unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry local storage', exact: true })).toHaveCount(0);
});
