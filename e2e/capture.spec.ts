import { expect, test, type Page } from '@playwright/test';

// Never send automated browser fixtures to the live company transcription service.
test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:8091/**', route => route.fulfill({ json: { state: 'complete', text: 'Synthetic conversation. We need glass bottles at 2400 bottles per hour.', engine: 'Synthetic browser test processor' }, headers: { 'Access-Control-Allow-Origin': new URL(route.request().headers().origin || 'http://localhost:8081').origin } }));
});

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Manuell erfassen', exact: true })).toBeVisible();
}
async function contact(page: Page, name: string, phone = '+12025550182') {
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Firma', { exact: true }).fill('Synthetic Beverage Co.');
  await page.getByLabel('Mobilnummer', { exact: true }).fill(phone);
  await page.getByRole('button', { name: 'Kontakt speichern', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toBeHidden();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('visitor and RFQ drafts survive reload and remain separate', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Manuell erfassen', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt eingeben', exact: true }).click();
  await contact(page, 'Mara Lind · test');
  await page.getByRole('button', { name: 'Bedarf bearbeiten', exact: true }).click();
  await page.getByRole('radio', { name: 'Eine Maschine kaufen', exact: true }).click();
  await page.getByLabel('Abzufüllendes Produkt', { exact: true }).fill('Synthetic juice');
  await page.getByLabel('Behälter / Verpackung', { exact: true }).fill('Glass bottle');
  await page.getByLabel('Benötigter Durchsatz', { exact: true }).fill('2400');
  await page.getByRole('radio', { name: 'Flaschen / Stunde', exact: true }).click();
  await page.getByRole('button', { name: 'Bedarf speichern', exact: true }).click();
  await expect(page.getByText('Kernbedarf erfasst', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Neuer Besucher', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt bearbeiten', exact: true }).click();
  await contact(page, 'Ivo Berg · test', '+12025550183');
  await expect(page.getByText('3 Kernangaben noch offen', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Besucher öffnen Mara Lind · test', exact: true }).click();
  await expect(page.getByText('Synthetic juice', { exact: true })).toBeVisible();
  await expect(page.getByText('2400 bottles/h', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Daten als JSON exportieren', exact: true }).click();
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
  await page.getByRole('button', { name: 'Visitenkarte aufnehmen', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Foto aufnehmen', exact: true }).click();
  const camera = await chooser;
  expect(await camera.element().getAttribute('capture')).toBe('environment');
  await camera.setFiles({ name: 'synthetic-card.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64') });
  await expect(page.getByText('synthetic-card.png', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: 'synthetic-card.png', exact: true })).toBeVisible();
});

test('actual browser microphone recording is saved and playable after reload', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Sprachnotiz aufnehmen', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stoppen und speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aufnahme abspielen', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Aufnahme abspielen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aufnahme pausieren', exact: true })).toBeVisible();
});

test('WhatsApp remains a preview and a corrected number invalidates the old recipient', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Deine Angaben', exact: true }).last().click();
  await page.getByLabel('Dein Name', { exact: true }).fill('Test Salesperson');
  await page.getByLabel('Deine Mobilnummer', { exact: true }).fill('+12025550181');
  await page.getByRole('button', { name: 'Angaben speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Manuell erfassen', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt eingeben', exact: true }).click();
  await contact(page, 'Mara Lind · test');
  await page.getByRole('button', { name: 'Kontaktvorlage', exact: true }).click();
  await page.getByRole('button', { name: 'Kontaktvorlage erstellen', exact: true }).click();
  await expect(page.getByText('VORBEREITET · NICHT VERSENDET', { exact: true })).toBeVisible();
  await expect(page.getByText('Vorbereitet für +12025550182', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt bearbeiten', exact: true }).click();
  await page.getByLabel('Mobilnummer', { exact: true }).fill('+12025550183');
  await page.getByRole('button', { name: 'Kontakt speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Kontaktvorlage', exact: true }).click();
  await expect(page.getByText('KONTAKT GEÄNDERT · ERNEUT VORBEREITEN', { exact: true })).toBeVisible();
  await expect(page.getByText('Vorbereitet für +12025550182', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kontaktvorlage kopieren', exact: true })).toHaveCount(0);
});

test('mobile layout has no horizontal overflow and missing numbers cannot prepare a message', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Manuell erfassen', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt eingeben', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Test Visitor');
  await page.getByRole('button', { name: 'Kontakt speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt & Bedarf', exact: true }).click();
  await page.getByRole('button', { name: 'Kontaktvorlage', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kontaktvorlage erstellen', exact: true })).toBeDisabled();
  await expect(page.getByText('Ergänze zuerst die Mobilnummer im Kontakt', { exact: true })).toBeVisible();
});

test('conversation consent and microphone denial do not produce a saved recording', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  await open(page);
  await page.getByRole('button', { name: 'Neuer Besucher', exact: true }).click();
  await expect(page.getByRole('textbox')).toHaveCount(1); // Only the library search; no capture form.
  await page.getByRole('button', { name: 'Gespräch aufnehmen', exact: true }).click();
  await expect(page.getByText('Bis zu 30 Minuten. Stoppe zum Speichern.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aufnahme starten', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Die andere Person stimmt der Aufnahme zu', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Die andere Person stimmt der Aufnahme zu', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Aufnahme starten', exact: true }).click();
  await expect(page.getByText(/Mikrofonzugriff fehlt/)).toBeVisible();
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aufnahme abspielen', exact: true })).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Manuell erfassen', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt eingeben', exact: true }).click();
  await contact(page, 'Manually corrected visitor');
  await page.getByRole('button', { name: 'Visitenkarte aufnehmen', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Kartenfoto auswählen', exact: true }).click();
  await (await chooser).setFiles({ name: 'synthetic-readable-card.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('button', { name: /^(Erkannten Text prüfen|Änderungsvorschläge prüfen)$/ })).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: /^(Erkannten Text prüfen|Änderungsvorschläge prüfen)$/ }).click();
  const chooseFields = page.getByRole('button', { name: 'Quelle und Feldauswahl öffnen', exact: true });
  if (await chooseFields.isVisible()) await chooseFields.click();
  await page.getByRole('button', { name: 'Angaben manuell bearbeiten', exact: true }).click();
  await expect(page.getByLabel('E-Mail', { exact: true })).toHaveValue('mara@example.test');
  await expect(page.getByRole('checkbox', { name: 'Firma übernehmen', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Name übernehmen', exact: true })).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('ocr-review-mobile.png'), animations: 'disabled' });
  await page.getByRole('checkbox', { name: 'E-Mail übernehmen', exact: true }).setChecked(true);
  await page.getByRole('button', { name: 'Ausgewählte Angaben übernehmen', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt & Bedarf', exact: true }).click();
  await expect(page.getByText('mara@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('Manually corrected visitor', { exact: true }).last()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Geprüft · Quelltext bleibt erhalten', { exact: true })).toBeVisible();
});

test('a returned transcript is reviewed before being appended to conversation notes', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Sprachnotiz aufnehmen', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stoppen und speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: /^(Erkannten Text prüfen|Änderungsvorschläge prüfen)$/ })).toBeVisible();
  await page.getByRole('button', { name: /^(Erkannten Text prüfen|Änderungsvorschläge prüfen)$/ }).click();
  const chooseFields = page.getByRole('button', { name: 'Quelle und Feldauswahl öffnen', exact: true });
  if (await chooseFields.isVisible()) await chooseFields.click();
  await page.getByRole('button', { name: 'Angaben manuell bearbeiten', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Transkript zu den Gesprächsnotizen hinzufügen', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Behälter / Verpackung übernehmen', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Durchsatz und Einheit übernehmen', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Ausgewählte Angaben übernehmen', exact: true }).click();
  await page.getByRole('button', { name: 'Bedarf bearbeiten', exact: true }).click();
  await expect(page.getByLabel('Gesprächsnotizen', { exact: true })).toHaveValue('Synthetic conversation. We need glass bottles at 2400 bottles per hour.');
});

test('mobile RFQ review protects corrected and cleared fields while applying selected source details', async ({ page }) => {
  const transcript = 'We need to fill juice into glass bottles at 2400 bottles per hour.';
  await page.route('http://127.0.0.1:8091/**', route => route.fulfill({ json: { state: 'complete', text: transcript, engine: 'Synthetic browser test processor' }, headers: { 'Access-Control-Allow-Origin': route.request().headers().origin } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole('button', { name: 'Manuell erfassen', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt eingeben', exact: true }).click();
  await contact(page, 'RFQ visitor');
  await page.getByRole('button', { name: 'Kontakt & Bedarf', exact: true }).click();
  await page.getByRole('button', { name: 'Bedarf bearbeiten', exact: true }).click();
  await page.getByLabel('Abzufüllendes Produkt', { exact: true }).fill('Manually corrected juice');
  await page.getByLabel('Behälter / Verpackung', { exact: true }).fill('Temporary packaging');
  await page.getByLabel('Behälter / Verpackung', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Bedarf speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Gespräch', exact: true }).click();
  await page.getByRole('button', { name: 'Sprachnotiz aufnehmen', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stoppen und speichern', exact: true }).click();
  await page.getByRole('button', { name: /^(Erkannten Text prüfen|Änderungsvorschläge prüfen)$/ }).click();
  const chooseFields = page.getByRole('button', { name: 'Quelle und Feldauswahl öffnen', exact: true });
  if (await chooseFields.isVisible()) await chooseFields.click();
  await page.getByRole('button', { name: 'Angaben manuell bearbeiten', exact: true }).click();
  await expect(page.getByLabel('Abzufüllendes Produkt', { exact: true })).toHaveValue('juice');
  await expect(page.getByRole('checkbox', { name: 'Produkt übernehmen', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Behälter / Verpackung übernehmen', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Durchsatz und Einheit übernehmen', exact: true })).toBeChecked();
  await expect(page.getByText('Aktuell: Manually corrected juice', { exact: true })).toBeVisible();
  await page.getByLabel('Behälter / Verpackung', { exact: true }).fill('500 ml glass bottles');
  await expect(page.getByRole('checkbox', { name: 'Behälter / Verpackung übernehmen', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Durchsatz und Einheit übernehmen', exact: true }).setChecked(true);
  await page.getByLabel('Benötigter Durchsatz', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel('Benötigter Durchsatz', { exact: true })).toHaveValue('2400');
  await expect(page.getByRole('radio', { name: 'Flaschen / Stunde', exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('rfq-review-mobile.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Ausgewählte Angaben übernehmen', exact: true }).click();
  await expect(page.getByText('Geprüft · Quelltext bleibt erhalten', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Kontakt & Bedarf', exact: true }).click();
  await expect(page.getByText('Manually corrected juice', { exact: true })).toBeVisible();
  await expect(page.getByText('500 ml glass bottles', { exact: true })).toBeVisible();
  await expect(page.getByText('2400 bottles/h', { exact: true })).toBeVisible();
  await expect(page.getByText('Kernbedarf erfasst', { exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Manuell erfassen', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt eingeben', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Visitor A');
  await page.getByRole('button', { name: 'Kontakt speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Sprachnotiz aufnehmen', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stoppen und speichern', exact: true }).click();
  await processing;
  await page.getByRole('button', { name: 'Neuer Besucher', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt & Bedarf', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt bearbeiten', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Visitor B');
  await page.getByRole('button', { name: 'Kontakt speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Notiz ergänzen', exact: true }).click();
  await page.getByLabel('Notiz', { exact: true }).fill('Only visitor B wants a canning line.');
  await page.getByRole('button', { name: 'Notiz speichern', exact: true }).click();
  release();
  await expect(page.getByRole('heading', { name: 'Visitor B', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aufnahme abspielen', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Besucher', exact: true }).click();
  await page.getByRole('button', { name: 'Besucher öffnen Visitor A', exact: true }).click();
  await expect(page.getByRole('button', { name: /^(Erkannten Text prüfen|Änderungsvorschläge prüfen)$/ })).toBeVisible();
  await expect(page.getByText('Visitor A requires a bottle filler.', { exact: true })).toBeVisible();
  await expect(page.getByText('Only visitor B wants a canning line.', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Visitor A', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dock = await page.getByRole('button', { name: 'Sprachnotiz aufnehmen', exact: true }).boundingBox();
  expect(dock!.y + dock!.height).toBeLessThanOrEqual(568);
  await page.screenshot({ path: test.info().outputPath('small-mobile-conversation.png') });
});
