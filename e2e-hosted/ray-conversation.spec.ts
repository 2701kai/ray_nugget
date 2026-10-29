import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { installIdentity } from './identity';
test.beforeEach(async ({ context }) => installIdentity(context));
async function drafts(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('pete-user-synthetic-autofill'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const rows = await new Promise<any[]>((resolve, reject) => { const r = db.transaction('drafts').objectStore('drafts').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); db.close(); return rows;
  });
}
async function record(page: Page, answer = false) {
  await page.getByRole('button', { name: answer ? 'Answer by voice' : 'Capture a voice note', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
}
test('one activation continues saved answers, separates details, defers questions and respects Pause and reload', async ({ page }) => {
  test.setTimeout(120000);
  let capture = 0, calls = 0; const inputs: any[] = [], contexts: any[] = [];
  const texts = ['We need fruit juice in 0.5 L glass bottles, 18000 bottles per hour.', 'Cold fill with downstream pasteurization, containing particles. Schraubverschluss.', 'Delivery next spring.'];
  const results = [
    { product: 'fruit juice', packaging: 'glass bottles', containerSize: '0.5 L', capacity: { throughput: '18000', unit: 'bottles/h' } },
    { fillingProcess: 'Cold fill with downstream pasteurization', productProperties: 'containing particles', closure: 'Schraubverschluss' },
    { timing: 'next spring' },
  ];
  await page.route('**/api/transcriptions/**', route => route.fulfill({ json: { state: 'complete', text: texts[capture++], engine: 'Synthetic speech' } }));
  await page.route('**/api/extractions/**', route => {
    const body = route.request().postDataJSON(); contexts.push(body.context);
    const index = texts.indexOf(body.text); expect(index).toBeGreaterThanOrEqual(0);
    return route.fulfill({ json: { state: 'complete', engine: 'Synthetic details', result: { fields: {}, request: results[index], evidence: {}, questions: [] } } });
  });
  await page.route('**/api/ray/*', route => {
    const body = route.request().postDataJSON(); inputs.push(body); calls++;
    const questions = calls === 1 ? ['Which filling process?', 'Does the juice contain particles?', 'Which closure?'] : calls === 2 ? ['What is the particle size?'] : [];
    return route.fulfill({ json: { state: 'complete', result: { ...body, id: createHash('sha256').update(route.request().postData()!).digest('hex'), createdAt: new Date().toISOString(), text: calls === 1 ? 'The filling process will narrow the choice.' : 'Consider a particle-capable filler. Technical fit still needs confirmation.', questions, machines: [], selectedSkus: [] } } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await record(page); await expect(page.getByText('Details added automatically', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ask Ray', exact: true }).click();
  await expect(page.getByText('Which filling process?', { exact: true })).toBeVisible();
  await expect(page.getByText('Does the juice contain particles?', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '2 more questions', exact: true }).click();
  await page.getByRole('button', { name: 'Which closure?', exact: true }).click();
  await record(page, true);
  await expect.poll(() => calls, { timeout: 25000 }).toBe(2);
  await expect(page.getByText('What is the particle size?', { exact: true })).toBeVisible();
  expect(contexts[1].questions).toEqual(['Which closure?']);
  expect(inputs[1].history[0].role).toBe('assistant'); expect(inputs[1].history[1].text).toBe(texts[1]);
  expect((await drafts(page))[0].request).toMatchObject({ product: 'fruit juice', packaging: 'glass bottles', containerSize: '0.5 L', throughput: '18000', unit: 'bottles/h', closure: 'Schraubverschluss', fillingProcess: 'Cold fill with downstream pasteurization', productProperties: 'containing particles' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Not known yet', exact: true }).click();
  await expect.poll(() => calls, { timeout: 25000 }).toBe(3);
  expect(inputs[2].history.at(-1).text).toContain('unknown for now');
  await expect(page.getByRole('button', { name: 'Stop Ray', exact: true })).toHaveCount(0);
  await expect(page.getByText(/^Advice saved · /)).toBeVisible();
  await page.getByRole('button', { name: 'Pause automatic updates', exact: true }).click();
  await record(page, true);
  await expect.poll(async () => (await drafts(page))[0].request.timing).toBe('next spring');
  // Advance beyond the normal scheduler interval: Pause must prevent a request.
  await page.waitForTimeout(11000); expect(calls).toBe(3);
  await page.getByRole('button', { name: 'Ask Ray', exact: true }).click();
  await expect.poll(() => calls).toBe(4);
  await page.screenshot({ path: test.info().outputPath('ray-assisted-390.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('ray-assisted-320.png'), animations: 'disabled' });
  await page.reload(); await expect(page.getByRole('button', { name: 'Ask Ray', exact: true })).toBeVisible();
  expect((await drafts(page))[0].rayQuestions[0].deferred).toBe(true);
  expect(calls).toBe(4);
});

test('completed advice needs no Stop; consented conversation and a general memo both update it, including while hidden', async ({ page }) => {
  test.setTimeout(90000);
  let calls = 0, capture = 0;
  const contexts: any[] = [];
  await page.route('**/api/transcriptions/**', route => route.fulfill({ json: { state: 'complete', text: ++capture === 1 ? 'The juice contains particles.' : 'Screw caps.', engine: 'Synthetic speech' } }));
  await page.route('**/api/extractions/**', route => {
    contexts.push(route.request().postDataJSON().context);
    return route.fulfill({ json: { state: 'complete', engine: 'Synthetic details', result: { fields: {}, request: capture === 1 ? { productProperties: 'contains particles' } : { closure: 'Screw caps' }, evidence: {}, questions: [] } } });
  });
  await page.route('**/api/ray/*', route => {
    const body = route.request().postDataJSON(); calls++;
    return route.fulfill({ json: { state: 'complete', result: {
      ...body, id: createHash('sha256').update(route.request().postData()!).digest('hex'), createdAt: new Date().toISOString(),
      text: calls === 1 ? 'The synthetic filler is ruled out: its output is too low. Which filling process is needed?' : 'The previous listing is unsuitable. Confirm particle handling before selecting equipment.',
      questions: ['Which filling process?'], machines: calls === 1 ? [{ sku: 'SYNTHETIC-REJECTED', title: 'Synthetic low-output filler', manufacturer: 'Demo', url: 'https://www.bevmaq.com/machines/synthetic-rejected/', updated: '2026-10-28' }] : [], selectedSkus: [],
    } } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByLabel('Note', { exact: true }).fill('Fruit juice in 0.5 L glass bottles at 20000 bottles/h.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.getByRole('button', { name: 'Ask Ray', exact: true }).click();
  const assessment = page.getByTestId('ray-advice-text');
  await expect(assessment).toContainText('ruled out');
  await expect(assessment).toBeInViewport();
  expect((await assessment.boundingBox())!.y).toBeLessThan((await page.getByText('Synthetic low-output filler', { exact: true }).boundingBox())!.y);
  await expect(page.getByRole('button', { name: 'Cancel request', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop Ray', exact: true })).toHaveCount(0);
  await page.waitForTimeout(10000); expect(calls).toBe(1);
  await page.screenshot({ path: test.info().outputPath('advice-before-listings-390.png') });

  await page.getByRole('button', { name: 'Record conversation', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toHaveCount(0);
  await expect(page.getByText('Recording · 30 min maximum', { exact: true })).toBeVisible();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  expect(capture).toBe(0); expect(calls).toBe(1);
  await page.screenshot({ path: test.info().outputPath('conversation-recording-390.png') });
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  expect(contexts[0].questions).toEqual([]);
  expect(contexts[0].consultationId).toBeUndefined();
  const saved = (await drafts(page))[0];
  expect(saved.attachments[0]).toMatchObject({ voiceMode: 'conversation', consentConfirmed: true, name: 'Consented conversation' });
  await expect(page.getByText('Synthetic low-output filler', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Earlier advice (1)', exact: true }).click();
  await expect(page.getByText('Synthetic low-output filler', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide earlier advice', exact: true }).click();

  await page.getByRole('button', { name: 'Hide Ray', exact: true }).click();
  await expect(page.getByText('Automatic updates on', { exact: true })).toBeVisible();
  await record(page);
  await expect.poll(() => calls).toBe(3);
  expect(contexts[1].questions).toEqual([]);
  await page.getByRole('button', { name: 'Show Ray', exact: true }).click();
  await expect(page.getByText(/^Advice saved · /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask Ray', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('restored-advice-320.png') });
});

test('Ray waits for a genuine correction and continues automatically after one confirmation', async ({ page }) => {
  let capture = 0, calls = 0;
  await page.route('**/api/transcriptions/**', route => route.fulfill({ json: { state: 'complete', text: ++capture === 1 ? 'We need juice in glass bottles at 18000 bottles per hour.' : 'Correction: we need 22000 bottles per hour.', engine: 'Synthetic speech' } }));
  await page.route('**/api/extractions/**', route => route.fulfill({ json: { state: 'complete', engine: 'Synthetic details', result: { fields: {}, request: capture === 1 ? { product: 'juice', packaging: 'glass bottles', capacity: { throughput: '18000', unit: 'bottles/h' } } : { capacity: { throughput: '22000', unit: 'bottles/h' } }, evidence: {}, questions: [] } } }));
  await page.route('**/api/ray/*', route => {
    const body = route.request().postDataJSON(); calls++;
    if (calls === 2) expect(body.brief).toContain('22000 bottles/h');
    return route.fulfill({ json: { state: 'complete', result: { ...body, id: createHash('sha256').update(route.request().postData()!).digest('hex'), createdAt: new Date().toISOString(), text: 'Technical suitability needs confirmation.', questions: ['Which filling process?'], machines: [], selectedSkus: [] } } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await record(page); await expect(page.getByText('Details added automatically', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ask Ray', exact: true }).click();
  await expect(page.getByText('Which filling process?', { exact: true })).toBeVisible();
  await record(page, true); await expect(page.getByRole('button', { name: 'Check this detail', exact: true })).toBeVisible();
  await page.waitForTimeout(11000); expect(calls).toBe(1);
  expect((await drafts(page))[0].request.throughput).toBe('18000');
  await page.getByRole('button', { name: 'Check this detail', exact: true }).click();
  await page.getByRole('button', { name: 'Use this change', exact: true }).click();
  await expect.poll(() => calls, { timeout: 20000 }).toBe(2);
  expect((await drafts(page))[0].request.throughput).toBe('22000');
});

test('Cancel request ignores a late result; hiding and showing advice preserves saved work without restarting Ray', async ({ page }) => {
  let calls = 0; let pending: import('@playwright/test').Route | undefined;
  await page.route('**/api/ray/*', route => { calls++; pending = route; });
  await page.goto('/'); await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByLabel('Note', { exact: true }).fill('Synthetic visitor needs juice in glass bottles, 20000 bottles/h.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.getByRole('button', { name: 'Ask Ray', exact: true }).click();
  await expect(page.getByText(/^Asking Ray for /)).toBeVisible();
  await expect.poll(() => !!pending).toBe(true);
  await page.getByRole('button', { name: 'Cancel request', exact: true }).click();
  await expect(page.getByText('Request canceled · your visitor stays saved', { exact: true })).toBeVisible();
  const body = pending!.request().postDataJSON();
  await pending!.fulfill({ json: { state: 'complete', result: { ...body, id: createHash('sha256').update(pending!.request().postData()!).digest('hex'), createdAt: new Date().toISOString(), text: 'Late result must not be saved.', questions: [], machines: [], selectedSkus: [] } } }).catch(() => {});
  await page.getByRole('button', { name: 'Hide Ray', exact: true }).click();
  await expect(page.getByTestId('ray-closed')).toBeVisible();
  await page.getByRole('button', { name: 'Show Ray', exact: true }).click();
  await expect(page.getByText('Request canceled · your visitor stays saved', { exact: true })).toBeVisible();
  await page.waitForTimeout(4000); expect(calls).toBe(1);
  expect((await drafts(page))[0].ray ?? []).toHaveLength(0);
  expect((await drafts(page))[0].entries).toHaveLength(1);
  await expect(page.getByTestId('recording-dock')).toHaveCount(0);
});
