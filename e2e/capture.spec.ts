import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Capture contact', exact: true })).toBeVisible();
}
async function contact(page: Page, name: string, phone = '+12025550182') {
  await page.getByLabel('Full name', { exact: true }).fill(name);
  await page.getByLabel('Company', { exact: true }).fill('Synthetic Beverage Co.');
  await page.getByLabel('Mobile number', { exact: true }).fill(phone);
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Choose a card photo', exact: true }).click();
  await (await chooser).setFiles({ name: 'synthetic-card.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64') });
  await expect(page.getByText('synthetic-card.png', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open draft Untitled visitor', exact: true }).click();
  await expect(page.getByRole('img', { name: 'synthetic-card.png', exact: true })).toBeVisible();
});

test('actual browser microphone recording is saved and playable after reload', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open draft Untitled visitor', exact: true }).click();
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
  await page.getByRole('button', { name: 'WhatsApp introduction', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Prepare introduction', exact: true })).toBeDisabled();
  await expect(page.getByText('Add a mobile number in Contact first', { exact: true })).toBeVisible();
});

test('conversation consent and microphone denial do not produce a saved recording', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  await open(page);
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await page.getByRole('radio', { name: 'A conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'The other person agreed to this recording', exact: true }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByText(/Microphone access is off/)).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toHaveCount(0);
});
