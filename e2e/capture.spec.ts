import { expect, test, type Page } from '@playwright/test';

// Never send automated browser fixtures to the live company transcription service.
test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:8091/**', route => route.fulfill({ json: { state: 'complete', text: 'Synthetic conversation. We need glass bottles at 2400 bottles per hour.', engine: 'Synthetic browser test processor' }, headers: { 'Access-Control-Allow-Origin': new URL(route.request().headers().origin || 'http://localhost:8081').origin } }));
});

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Capture contact', exact: true })).toBeVisible();
}
async function contact(page: Page, name: string, phone = '+12025550182') {
  await page.getByLabel('Full name', { exact: true }).fill(name);
  await page.getByLabel('Company', { exact: true }).fill('Synthetic Beverage Co.');
  await page.getByLabel('Mobile number', { exact: true }).fill(phone);
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await expect(page.getByLabel('Full name', { exact: true })).toBeHidden();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('visitor and RFQ drafts survive reload and remain separate', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Capture contact', exact: true }).click();
  await contact(page, 'Mara Lind · test');
  await page.getByRole('button', { name: 'Edit request', exact: true }).click();
  await page.getByRole('radio', { name: 'Buy a machine', exact: true }).click();
  await page.getByLabel('Product to fill', { exact: true }).fill('Synthetic juice');
  await page.getByLabel('Container / packaging', { exact: true }).fill('Glass bottle');
  await page.getByLabel('Required throughput', { exact: true }).fill('2400');
  await page.getByRole('radio', { name: 'Bottles / hour', exact: true }).click();
  await page.getByRole('button', { name: 'Save request', exact: true }).click();
  await expect(page.getByText('Filling requirements captured', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await page.getByRole('button', { name: 'Edit contact', exact: true }).click();
  await contact(page, 'Ivo Berg · test', '+12025550183');
  await expect(page.getByText('3 filling requirements still to ask', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open draft Mara Lind · test', exact: true }).click();
  await expect(page.getByText('Synthetic juice', { exact: true })).toBeVisible();
  await expect(page.getByText('2400 bottles/h', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export draft metadata', exact: true }).click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const data = JSON.parse(Buffer.concat(chunks).toString());
  expect(data.format).toBe('pete-draft/v1');
  expect(data.draft.contact.name).toBe('Mara Lind · test');
  expect(data.qualification.complete).toBe(true);
});

test('business-card original is persisted and displayed after reload', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Capture business card', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Take a photo', exact: true }).click();
  const camera = await chooser;
  expect(await camera.element().getAttribute('capture')).toBe('environment');
  await camera.setFiles({ name: 'synthetic-card.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64') });
  await expect(page.getByText('synthetic-card.png', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: 'synthetic-card.png', exact: true })).toBeVisible();
});

test('actual browser microphone recording is saved and playable after reload', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
});

test('WhatsApp remains a preview and a corrected number invalidates the old recipient', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Your details', exact: true }).last().click();
  await page.getByLabel('Your name', { exact: true }).fill('Test Salesperson');
  await page.getByLabel('Your mobile number', { exact: true }).fill('+12025550181');
  await page.getByRole('button', { name: 'Save your details', exact: true }).click();
  await page.getByRole('button', { name: 'Capture contact', exact: true }).click();
  await contact(page, 'Mara Lind · test');
  await page.getByRole('button', { name: 'WhatsApp introduction', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare introduction', exact: true }).click();
  await expect(page.getByText('PREPARED · NOT SENT', { exact: true })).toBeVisible();
  await expect(page.getByText('Prepared for +12025550182', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Edit contact', exact: true }).click();
  await page.getByLabel('Mobile number', { exact: true }).fill('+12025550183');
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await page.getByRole('button', { name: 'WhatsApp introduction', exact: true }).click();
  await expect(page.getByText('CONTACT CHANGED · PREPARE AGAIN', { exact: true })).toBeVisible();
  await expect(page.getByText('Prepared for +12025550182', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy introduction', exact: true })).toHaveCount(0);
});

test('mobile layout has no horizontal overflow and missing numbers cannot prepare a message', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Capture contact', exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Test Visitor');
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await page.getByRole('button', { name: 'Details & request', exact: true }).click();
  await page.getByRole('button', { name: 'WhatsApp introduction', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Prepare introduction', exact: true })).toBeDisabled();
  await expect(page.getByText('Add a mobile number in Contact first', { exact: true })).toBeVisible();
});

test('conversation consent and microphone denial do not produce a saved recording', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  await open(page);
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await expect(page.getByRole('textbox')).toHaveCount(1); // Only the library search; no capture form.
  await page.getByRole('button', { name: 'Record conversation', exact: true }).click();
  await expect(page.getByText('Up to 30 minutes. Stop and save when you are done.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'The other person agreed to this recording', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'The other person agreed to this recording', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByText(/Microphone access is off/)).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toHaveCount(0);
});

test('real local OCR produces reviewable fields without replacing an existing visitor', async ({ page }) => {
  test.setTimeout(90000);
  await open(page);
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 520;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111'; context.font = '38px Arial';
    ['Name: Mara Lind', 'Company: Synthetic Bottling GmbH', 'mara@example.test', '+1 202 555 0182'].forEach((line, index) => context.fillText(line, 60, 100 + index * 100));
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'Capture contact', exact: true }).click();
  await contact(page, 'Manually corrected visitor');
  await page.getByRole('button', { name: 'Capture business card', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a card photo', exact: true }).click();
  await (await chooser).setFiles({ name: 'synthetic-readable-card.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('button', { name: /^(Review extracted text|Check suggested changes)$/ })).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: /^(Review extracted text|Check suggested changes)$/ }).click();
  const chooseFields = page.getByRole('button', { name: 'View source and choose fields', exact: true });
  if (await chooseFields.isVisible()) await chooseFields.click();
  await page.getByRole('button', { name: 'Edit details manually', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('mara@example.test');
  await expect(page.getByRole('checkbox', { name: 'Use company', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Use full name', exact: true })).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('ocr-review-mobile.png'), animations: 'disabled' });
  await page.getByRole('checkbox', { name: 'Use email', exact: true }).click();
  await page.getByRole('button', { name: 'Apply selected details', exact: true }).click();
  await page.getByRole('button', { name: 'Details & request', exact: true }).click();
  await expect(page.getByText('mara@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('Manually corrected visitor', { exact: true }).last()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Reviewed · source text kept', { exact: true })).toBeVisible();
});

test('a returned transcript is reviewed before being appended to conversation notes', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByRole('button', { name: /^(Review extracted text|Check suggested changes)$/ })).toBeVisible();
  await page.getByRole('button', { name: /^(Review extracted text|Check suggested changes)$/ }).click();
  const chooseFields = page.getByRole('button', { name: 'View source and choose fields', exact: true });
  if (await chooseFields.isVisible()) await chooseFields.click();
  await page.getByRole('button', { name: 'Edit details manually', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Append transcript to conversation notes', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Use container / packaging', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Use throughput and unit', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Apply selected details', exact: true }).click();
  await page.getByRole('button', { name: 'Edit request', exact: true }).click();
  await expect(page.getByLabel('Conversation notes', { exact: true })).toHaveValue('Synthetic conversation. We need glass bottles at 2400 bottles per hour.');
});

test('mobile RFQ review protects corrected and cleared fields while applying selected source details', async ({ page }) => {
  const transcript = 'We need to fill juice into glass bottles at 2400 bottles per hour.';
  await page.route('http://127.0.0.1:8091/**', route => route.fulfill({ json: { state: 'complete', text: transcript, engine: 'Synthetic browser test processor' }, headers: { 'Access-Control-Allow-Origin': route.request().headers().origin } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole('button', { name: 'Capture contact', exact: true }).click();
  await contact(page, 'RFQ visitor');
  await page.getByRole('button', { name: 'Details & request', exact: true }).click();
  await page.getByRole('button', { name: 'Edit request', exact: true }).click();
  await page.getByLabel('Product to fill', { exact: true }).fill('Manually corrected juice');
  await page.getByLabel('Container / packaging', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save request', exact: true }).click();
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await page.getByRole('button', { name: /^(Review extracted text|Check suggested changes)$/ }).click();
  const chooseFields = page.getByRole('button', { name: 'View source and choose fields', exact: true });
  if (await chooseFields.isVisible()) await chooseFields.click();
  await page.getByRole('button', { name: 'Edit details manually', exact: true }).click();
  await expect(page.getByLabel('Product to fill', { exact: true })).toHaveValue('juice');
  await expect(page.getByRole('checkbox', { name: 'Use product', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Use container / packaging', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Use throughput and unit', exact: true })).not.toBeChecked();
  await expect(page.getByText('Currently: Manually corrected juice', { exact: true })).toBeVisible();
  await page.getByLabel('Container / packaging', { exact: true }).fill('500 ml glass bottles');
  await expect(page.getByRole('checkbox', { name: 'Use container / packaging', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Use throughput and unit', exact: true }).click();
  await page.getByLabel('Required throughput', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel('Required throughput', { exact: true })).toHaveValue('2400');
  await expect(page.getByRole('radio', { name: 'Bottles / hour', exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('rfq-review-mobile.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Apply selected details', exact: true }).click();
  await expect(page.getByText('Reviewed · source text kept', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Details & request', exact: true }).click();
  await expect(page.getByText('Manually corrected juice', { exact: true })).toBeVisible();
  await expect(page.getByText('500 ml glass bottles', { exact: true })).toBeVisible();
  await expect(page.getByText('2400 bottles/h', { exact: true })).toBeVisible();
  await expect(page.getByText('Filling requirements captured', { exact: true })).toBeVisible();
});

test('late transcription stays with its original visitor while another conversation is active', async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const processing = new Promise<void>(resolve => { started = resolve; });
  await page.route('http://127.0.0.1:8091/**', async route => {
    started(); await ready;
    await route.fulfill({ json: { state: 'complete', text: 'Visitor A requires a bottle filler.', engine: 'Delayed synthetic processor' }, headers: { 'Access-Control-Allow-Origin': route.request().headers().origin } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole('button', { name: 'Capture contact', exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Visitor A');
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await processing;
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await page.getByRole('button', { name: 'Details & request', exact: true }).click();
  await page.getByRole('button', { name: 'Edit contact', exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Visitor B');
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await page.getByRole('button', { name: 'Add quick note', exact: true }).click();
  await page.getByLabel('Quick note', { exact: true }).fill('Only visitor B wants a canning line.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  release();
  await expect(page.getByRole('heading', { name: 'Visitor B', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Drafts', exact: true }).click();
  await page.getByRole('button', { name: 'Open draft Visitor A', exact: true }).click();
  await expect(page.getByRole('button', { name: /^(Review extracted text|Check suggested changes)$/ })).toBeVisible();
  await expect(page.getByText('Visitor A requires a bottle filler.', { exact: true })).toBeVisible();
  await expect(page.getByText('Only visitor B wants a canning line.', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Visitor A', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dock = await page.getByRole('button', { name: 'Capture a voice note', exact: true }).boundingBox();
  expect(dock!.y + dock!.height).toBeLessThanOrEqual(568);
  await page.screenshot({ path: test.info().outputPath('small-mobile-conversation.png') });
});
