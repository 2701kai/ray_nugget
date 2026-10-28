import { expect, test, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';

async function note(page: Page, text: string) {
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByLabel('Note', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
}
async function visitors(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('ray-nugget-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const rows = await new Promise<any[]>((resolve, reject) => { const r = db.transaction('drafts').objectStore('drafts').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); db.close(); return rows;
  });
}
async function answer(route: Route, text = 'Which container and hourly output does the visitor need?') {
  const input = route.request().postDataJSON();
  await route.fulfill({ json: { state: 'complete', result: { ...input, id: createHash('sha256').update(route.request().postData()!).digest('hex'), createdAt: new Date().toISOString(), text, questions: text.endsWith('?') ? [text] : [], machines: [{ sku: 'SYNTHETIC-1', title: 'Synthetic filling machine', manufacturer: 'Test maker', url: 'https://www.bevmaq.com/machines/synthetic/', updated: '2026-10-28' }], selectedSkus: [] } }, headers: { 'Access-Control-Allow-Origin': route.request().headers().origin } });
}
test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 402, height: 874 }); });

test('Ask Ray saves advice and machine choices, restores offline, and detects later corrections', async ({ page, context }) => {
  let calls = 0;
  await page.route('**/ray/*', async route => { calls++; await answer(route); });
  await page.goto('/'); await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Find machines', exact: true })).toBeDisabled();
  await note(page, 'We need a filler for peach nectar. Krones preferred; container and capacity unknown.');
  await page.getByRole('button', { name: 'Find machines', exact: true }).click();
  await expect(page.getByText('Which container and hourly output does the visitor need?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save for visitor', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved for visitor ✓', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('ray-mobile-402.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('ray-mobile-320.png') });
  await page.reload(); await expect(page.getByRole('button', { name: 'Saved for visitor ✓', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Find machines', exact: true }).click();
  await expect(page.getByText('Ask Ray when you are online. Recording and saving on this device still work.', { exact: true })).toBeVisible();
  expect(calls).toBe(1); await context.setOffline(false);
  await note(page, 'The visitor confirmed glass bottles and 3000 bottles per hour.');
  await expect(page.getByText('Earlier advice · Find machines to include new details', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Find machines', exact: true }).click();
  await expect.poll(async () => (await visitors(page))[0].ray.length).toBe(2);
  expect((await visitors(page))[0].ray[0].selectedSkus).toEqual(['SYNTHETIC-1']);
  await expect(page.getByText('Earlier advice · Find machines to include new details', { exact: true })).toHaveCount(0);
});

test('pending Ray response stays with its original visitor and never blocks a new capture', async ({ page }) => {
  let pending: Route | undefined;
  await page.route('**/ray/*', async route => { pending = route; });
  await page.goto('/'); await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await note(page, 'First visitor needs a juice filler.');
  const firstId = (await visitors(page))[0].id;
  await page.getByRole('button', { name: 'Find machines', exact: true }).click();
  await expect(page.getByText(/^Checking machines for /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Capture a voice note', exact: true })).toBeEnabled();
  await expect.poll(() => !!pending).toBe(true);
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await note(page, 'Second visitor wants a labeling machine.');
  await answer(pending!, 'Advice for the first visitor only.');
  await expect.poll(async () => (await visitors(page)).find(d => d.id === firstId)?.ray?.length).toBe(1);
  await expect(page.getByText('Advice for the first visitor only.', { exact: true })).toHaveCount(0);
  expect((await visitors(page)).find(d => d.id !== firstId)?.ray).toBeUndefined();
});

test('Ray failure leaves notes intact; voice answer uses the same visitor and recording guards', async ({ page }) => {
  let fail = true;
  await page.route('**/ray/*', async route => {
    if (fail) await route.fulfill({ status: 429, json: { error: 'Ray is busy. Please retry shortly.' }, headers: { 'Access-Control-Allow-Origin': route.request().headers().origin } });
    else await answer(route);
  });
  await page.route('**/transcriptions/**', route => route.fulfill({ json: { state: 'complete', text: 'Glass bottles, 3000 bottles per hour.', engine: 'Synthetic voice fixture' }, headers: { 'Access-Control-Allow-Origin': route.request().headers().origin } }));
  await page.goto('/'); await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await note(page, 'Synthetic visitor needs a filler.');
  await page.getByRole('button', { name: 'Find machines', exact: true }).click();
  await expect(page.getByText('Ray is busy. Please retry shortly.', { exact: true })).toBeVisible();
  const before = (await visitors(page))[0]; expect(before.entries[0].text).toBe('Synthetic visitor needs a filler.');
  fail = false; await page.getByRole('button', { name: 'Find machines', exact: true }).click();
  await page.getByRole('button', { name: 'Answer by voice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop and save recording', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop Ray', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect.poll(async () => (await visitors(page))[0].attachments.length).toBe(1);
  expect((await visitors(page))[0].id).toBe(before.id);
  await expect.poll(async () => (await visitors(page))[0].ray?.length, { timeout: 20000 }).toBe(2);
});
