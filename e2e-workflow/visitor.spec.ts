import { test, expect, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('ray-nugget-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const read = (s: string) => new Promise<any[]>((resolve, reject) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const [drafts, jobs] = await Promise.all([read('drafts'), read('jobs')]); db.close(); return { drafts, jobs };
  });
}
async function note(page: Page, text: string) {
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByLabel('Note', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
}
async function answer(route: Route, text: string, questions: string[] = []) {
  const input = route.request().postDataJSON();
  await route.fulfill({ json: { state: 'complete', result: { ...input, id: createHash('sha256').update(route.request().postData()!).digest('hex'), createdAt: new Date().toISOString(), text, questions, machines: [], selectedSkus: [] } } });
}
test.beforeEach(async ({ page }) => {
  // Every model boundary is intercepted; browser acceptance uses synthetic data.
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Synthetic service unavailable' } }));
});

test('one tap starts a consented conversation; captures stay newest first on desktop and mobile', async ({ page }) => {
  await page.route('**/transcriptions/*', route => route.fulfill({ json: { state: 'complete', text: 'Fruit juice, glass bottles, 20000 bottles per hour.', engine: 'Google Speech-to-Text V2 · synthetic fixture' } }));
  await page.route('**/extractions/*', route => route.fulfill({ json: { state: 'complete', engine: 'Synthetic details fixture', result: { fields: {}, request: { product: 'Fruit juice', packaging: 'glass bottles', capacity: { throughput: '20000', unit: 'bottles/h' } }, questions: [] } } }));
  await page.goto('/'); await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await note(page, 'Earlier note: visitor needs a juice filler.');
  await page.getByRole('button', { name: 'Record conversation', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toHaveCount(0);
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New visitor', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Stop and save recording', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Correct transcript', exact: true })).toBeEnabled();
  await expect(page.getByTestId('capture-entry').first()).toContainText('Fruit juice');
  const data = await records(page);
  expect(data.drafts[0].attachments[0]).toMatchObject({ voiceMode: 'conversation', consentConfirmed: true });
  expect(data.drafts[0].request.product).toBe('Fruit juice');
  await note(page, 'Newest note: delivery in spring.');
  await expect(page.getByTestId('capture-entry').first()).toContainText('Newest note:');
  await expect(page.getByRole('button', { name: 'Download backup file', exact: true })).toHaveCount(0);
  await expect(page.getByText('CRM transfer is not connected yet.', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('visitor-mobile.png'), fullPage: true });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Record conversation', exact: true })).toBeVisible();
  }
  await page.screenshot({ path: test.info().outputPath('visitor-desktop.png'), fullPage: true });
  await page.reload(); await expect(page.getByTestId('capture-entry').first()).toContainText('Newest note:');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download backup file', exact: true })).toBeVisible();
});

test('correcting a misheard answer retains its original and resumes Ray with 1 mm, without asking twice', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const inputs: any[] = []; let pending: Route | undefined;
  await page.route('**/ray/*', async route => { inputs.push(route.request().postDataJSON()); await answer(route, inputs.length === 1 ? 'What is the maximum particle size in mm?' : 'The maximum particle size is 1 mm. Check a particle-capable filler.', inputs.length === 1 ? ['What is the maximum particle size in mm?'] : []); });
  await page.route('**/transcriptions/*', route => route.fulfill({ json: { state: 'complete', text: 'Frühstück mm', engine: 'Google Speech-to-Text V2 · synthetic fixture' } }));
  await page.route('**/extractions/*', async route => {
    if (route.request().postDataJSON().text.includes('Fruchtstücke')) pending = route;
    else await route.fulfill({ json: { state: 'complete', engine: 'Synthetic details fixture', result: { fields: {}, questions: ['The particle value is unclear.'] } } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await note(page, 'Fruit juice in 0.5 L glass bottles, 20000 bottles/h. Cold fill and downstream pasteurization; screw caps.');
  await page.getByRole('button', { name: 'Ask Ray', exact: true }).click();
  await page.getByRole('button', { name: 'Answer by voice', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Correct transcript', exact: true })).toBeEnabled();
  expect(inputs).toHaveLength(1);
  await page.getByRole('button', { name: 'Correct transcript', exact: true }).click();
  await page.getByLabel('Correct transcript', { exact: true }).fill('Fruchtstücke, maximal 1 mm.');
  await expect(page.getByRole('button', { name: 'New visitor', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect.poll(() => !!pending).toBe(true);
  expect(inputs).toHaveLength(1); // Ray waits until correction processing finishes.
  await pending!.fulfill({ json: { state: 'complete', engine: 'Synthetic details fixture', result: { fields: {}, request: { particleSize: '1 mm', productProperties: 'Fruchtstücke' }, questions: [] } } });
  await expect.poll(() => inputs.length, { timeout: 20000 }).toBe(2);
  expect(inputs[1].brief).toContain('1 mm'); expect(inputs[1].brief).not.toContain('Frühstück');
  expect((await records(page)).drafts[0].request.particleSize).toBe('1 mm');
  await expect(page.getByTestId('ray-advice-text')).toContainText('maximum particle size is 1 mm');
  await page.screenshot({ path: test.info().outputPath('ray-correction-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Read transcript', exact: true }).click();
  await expect(page.getByTestId('source-reader-text')).toHaveText('Fruchtstücke, maximal 1 mm.');
  await page.getByRole('button', { name: 'Original transcript', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Frühstück mm', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Google Speech-to-Text V2 · synthetic fixture', { exact: true })).toBeVisible();
});

test('slow and failed Ray replies never interrupt capture or cross visitors', async ({ page }) => {
  let pending: Route | undefined;
  await page.route('**/ray/*', route => { pending = route; });
  await page.goto('/'); await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await note(page, 'First visitor needs a juice filler.');
  const first = (await records(page)).drafts[0].id;
  await page.getByRole('button', { name: 'Ask Ray', exact: true }).click();
  await expect.poll(() => !!pending).toBe(true);
  await expect(page.getByRole('button', { name: 'Record conversation', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await note(page, 'Second visitor needs a labeler.');
  await answer(pending!, 'Advice for the first visitor only.');
  await expect.poll(async () => (await records(page)).drafts.find(d => d.id === first)?.ray?.length).toBe(1);
  await expect(page.getByText('Advice for the first visitor only.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ask Ray', exact: true }).click();
  await expect.poll(() => pending?.request().postDataJSON().draftId !== first).toBe(true);
  await pending!.fulfill({ status: 503, json: { error: 'Synthetic Ray unavailable. Your visitor is saved.' } });
  await expect(page.getByText('Synthetic Ray unavailable. Your visitor is saved.', { exact: true })).toBeVisible();
  await note(page, 'Second visitor also needs delivery in May.');
  await expect(page.getByTestId('capture-entry').first()).toContainText('delivery in May');
  expect((await records(page)).drafts.find(d => d.id !== first).entries).toHaveLength(2);
});
