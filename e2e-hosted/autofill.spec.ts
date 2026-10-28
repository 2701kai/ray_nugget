import { expect, test, type Page } from '@playwright/test';
import { installIdentity } from './identity';
test.beforeEach(async ({ context }) => installIdentity(context));
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
  await expect(page.getByRole('heading', { name: 'New visitor', exact: true })).toBeVisible();
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
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Mara Lind');
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
  await expect(page.getByRole('heading', { name: 'New visitor', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Visitors', exact: true }).click();
  await page.getByRole('button', { name: 'Open visitor Mara Lind', exact: true }).click();
  await expect(page.getByText('Details added automatically', { exact: true })).toBeVisible();
  expect(transcripts).toBe(1); expect(extractions).toBe(2);
  await page.getByRole('button', { name: 'Details & request', exact: true }).click(); await expect(page.getByText('juice', { exact: true })).toBeVisible();
});

test('spoken follow-ups fill missing details and a correction needs only a tap, without stale warnings', async ({ page }) => {
  let captures = 0;
  const texts = ['Mara Lind needs juice at 2400 bottles per hour.', 'The container is a glass bottle.', 'Correction: we need 3000 bottles per hour.', 'We need milk.'];
  const results = [
    { fields: { name: 'Mara Lind' }, request: { product: 'juice', capacity: { throughput: '2400', unit: 'bottles/h' } } },
    { fields: {}, request: { packaging: 'glass bottle' } },
    { fields: {}, request: { capacity: { throughput: '3000', unit: 'bottles/h' } } },
    { fields: {}, request: { product: 'milk' } },
  ];
  await page.route('**/api/transcriptions/**', route => route.fulfill({ json: { state: 'complete', text: texts[captures++], engine: 'Synthetic speech' } }));
  await page.route('**/api/extractions/**', route => {
    const index = texts.indexOf(route.request().postDataJSON().text);
    expect(index).toBeGreaterThanOrEqual(0);
    return route.fulfill({ json: { state: 'complete', engine: 'Synthetic details', result: { ...results[index], evidence: index === 2 ? { 'request.throughput': texts[index] } : {}, questions: index === 3 ? ['Which company is this visitor from?'] : [] } } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await record(page); await expect(page.getByRole('heading', { name: 'Mara Lind', exact: true })).toBeVisible();
  await record(page); await expect(page.getByText('Details added automatically', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Details & request', exact: true }).click();
  await expect(page.getByText('glass bottle', { exact: true })).toBeVisible();
  await expect(page.getByText('2400 bottles/h', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await record(page);
  await page.getByRole('button', { name: 'Check suggested changes', exact: true }).click();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText('2400 bottles/h', { exact: true })).toBeVisible();
  await expect(page.getByText('3000 bottles/h', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use this change', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('spoken-correction-mobile.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Use this change', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('spoken-correction-320.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Use this change', exact: true }).click();
  await expect(page.getByText('Earlier details · newer values kept', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check suggested changes', exact: true })).toHaveCount(0);
  // An existing visitor remains capturable while the team catalog reconnects.
  let releaseTeams!: () => void;
  const teamsReady = new Promise<void>(resolve => { releaseTeams = resolve; });
  await page.route('**/api/teams', async route => { await teamsReady; await route.fulfill({ json: [] }); });
  await page.reload();
  await page.getByRole('button', { name: 'Details & request', exact: true }).click();
  await expect(page.getByText('3000 bottles/h', { exact: true })).toBeVisible();
  await expect(page.getByText('juice', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  try { await record(page); } finally { releaseTeams(); }
  await page.getByRole('button', { name: 'Check suggested changes', exact: true }).click();
  await expect(page.getByText('Which company is this visitor from?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep saved details', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check suggested changes', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Details & request', exact: true }).click();
  await expect(page.getByText('juice', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(captures).toBe(4);
});
