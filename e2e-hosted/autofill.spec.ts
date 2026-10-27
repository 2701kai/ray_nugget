import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The deployed Firebase web key is public client configuration, not a credential.
// Read the exact build under test; every identity/API request below is intercepted.
const bundleDir = 'dist-hosted/_expo/static/js/web';
const publicKey = readdirSync(bundleDir).filter(file => file.endsWith('.js')).map(file => readFileSync(join(bundleDir, file), 'utf8')).join('\n').match(/AIza[\w-]{35}/)?.[0];
if (!publicKey) throw new Error('Build the hosted app before testing.');

test.beforeEach(async ({ context }) => {
  await context.route('https://**', route => {
    if (route.request().url().startsWith('https://identitytoolkit.googleapis.com/') && route.request().url().includes('accounts:lookup')) return route.fulfill({ json: { users: [{ localId: 'synthetic-autofill', email: 'autofill-test@bevmaq.com', emailVerified: true, providerUserInfo: [{ providerId: 'google.com', rawId: 'synthetic-autofill', email: 'autofill-test@bevmaq.com' }] }] } });
    return route.abort(); // Never let a fixture reach a live service.
  });
  await context.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Unconfigured synthetic endpoint' } }));
  await context.addInitScript(apiKey => {
    if (sessionStorage.getItem('fixture-initialized')) return;
    sessionStorage.setItem('fixture-initialized', '1');
    localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({
      uid: 'synthetic-autofill', email: 'autofill-test@bevmaq.com', emailVerified: true, isAnonymous: false,
      providerData: [{ providerId: 'google.com', uid: 'synthetic-autofill', email: 'autofill-test@bevmaq.com' }],
      stsTokenManager: { refreshToken: 'synthetic', accessToken: 'synthetic', expirationTime: Date.now() + 3600000 },
      createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey, appName: '[DEFAULT]',
    }));
  }, publicKey);
});
async function record(page: Page) {
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
}

test('card and speech fill one visitor without typing or a required review; reload retains source and fields', async ({ page }) => {
  let cards = 0, voices = 0;
  await page.route('**/api/transcriptions/**', route => route.fulfill({ json: { state: 'complete', text: 'Sie brauchen Apfelsaft in Glasflaschen mit 2400 Flaschen pro Stunde.', engine: 'Synthetic speech' } }));
  await page.route('**/api/extractions/**', route => {
    expect(route.request().headers().authorization).toBe('Bearer synthetic');
    const source = route.request().postDataJSON();
    if (source.kind === 'card') {
      cards++; expect(source.text).toContain('Mara Lind');
      return route.fulfill({ json: { state: 'complete', engine: 'Synthetic details', result: { fields: { name: 'Mara Lind', company: 'Synthetic Bottling GmbH', email: 'mara@example.test' }, evidence: { 'contact.name': 'Mara Lind' }, questions: [] } } });
    }
    voices++; expect(source.text).toContain('Apfelsaft');
    return route.fulfill({ json: { state: 'complete', engine: 'Synthetic details', result: { fields: {}, request: { intent: 'buy', product: 'Apfelsaft', packaging: 'Glasflaschen', capacity: { throughput: '2400', unit: 'bottles/h' } }, evidence: { 'request.product': 'Apfelsaft' }, questions: [] } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Untitled visitor', exact: true })).toBeVisible();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 420;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1200, 420); ctx.fillStyle = '#111'; ctx.font = '40px Arial';
    ['Mara Lind', 'Synthetic Bottling GmbH', 'mara@example.test'].forEach((line, i) => ctx.fillText(line, 50, 100 + i * 100));
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'Capture business card', exact: true }).click();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Choose a card photo', exact: true }).click();
  await (await chooser).setFiles({ name: 'synthetic-card.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('heading', { name: 'Mara Lind', exact: true })).toBeVisible({ timeout: 45000 });
  await expect(page.getByText('Details added automatically', { exact: true })).toBeVisible();
  await record(page);
  await expect(page.getByText('Details added automatically', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Details & request', exact: true }).click();
  for (const value of ['mara@example.test', 'Apfelsaft', 'Glasflaschen', '2400 bottles/h']) await expect(page.getByText(value, { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('automatic-details-mobile.png'), animations: 'disabled' });
  await page.reload();
  await page.getByRole('button', { name: 'Review extracted text', exact: true }).first().click();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText('mara@example.test', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit details manually', exact: true }).click();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Mara Lind');
  expect(cards).toBe(1); expect(voices).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('interrupted extraction reuses saved transcript and fills the original visitor while a new one is active', async ({ page }) => {
  let transcripts = 0, extractions = 0;
  await page.route('**/api/transcriptions/**', route => { transcripts++; return route.fulfill({ json: { state: 'complete', text: 'Visitor Mara Lind needs juice.', engine: 'Synthetic speech' } }); });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/extractions/**', async route => {
    extractions++;
    if (extractions === 1) return route.fulfill({ status: 503, json: { error: 'Temporary synthetic interruption' } });
    await gate;
    return route.fulfill({ json: { state: 'complete', engine: 'Synthetic details', result: { fields: { name: 'Mara Lind' }, request: { product: 'juice' }, evidence: { 'contact.name': 'Mara Lind' }, questions: [] } } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'New visitor', exact: true }).click(); await record(page);
  await expect(page.getByText('Temporary synthetic interruption', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await expect.poll(() => extractions, { timeout: 20000 }).toBe(2); release();
  await expect(page.getByRole('heading', { name: 'Untitled visitor', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Drafts', exact: true }).click();
  await page.getByRole('button', { name: 'Open draft Mara Lind', exact: true }).click();
  await expect(page.getByText('Details added automatically', { exact: true })).toBeVisible();
  expect(transcripts).toBe(1); expect(extractions).toBe(2);
  await page.getByRole('button', { name: 'Details & request', exact: true }).click(); await expect(page.getByText('juice', { exact: true })).toBeVisible();
});
