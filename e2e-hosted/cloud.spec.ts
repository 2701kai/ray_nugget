import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { installIdentity } from './identity';
import { cloudBackups } from '../server/cloud-backups';
import { hostedHandler } from '../server/hosted-api';
import type { hostedJobs } from '../server/hosted-jobs';
import type { AtomicStore, RecordValue } from '../server/hosted-store';

class MemoryStore implements AtomicStore {
  records = new Map<string, RecordValue>();
  async read<T>(key: string) { return structuredClone(this.records.get(key)) as T | undefined; }
  async atomic<T>(keys: string[], run: (records: Record<string, RecordValue | undefined>) => { result: T; writes?: Record<string, RecordValue> }) {
    const { result, writes } = run(Object.fromEntries(keys.map(key => [key, structuredClone(this.records.get(key))])));
    for (const [key, value] of Object.entries(writes ?? {})) this.records.set(key, structuredClone(value));
    return result;
  }
}
test('capture saves automatically to company cloud, recovers a lost upload response, reconnects and restores originals', async ({ context, page }) => {
  await installIdentity(context);
  const store = new MemoryStore(), files = new Map<string, { bytes: Buffer; mimeType: string }>();
  const sessions = new Map<string, { name: string; mimeType: string }>();
  let dataUploads = 0, interrupt = true;
  const service = cloudBackups(store, {
    async begin(name, mimeType) { const url = `https://storage.googleapis.com/cloud-fixture/${sessions.size}`; sessions.set(url, { name, mimeType }); return url; },
    async inspect(name) { const file = files.get(name); return file && { bytes: file.bytes.length, mimeType: file.mimeType, sha256: createHash('sha256').update(file.bytes).digest('hex') }; },
    async put(name, bytes) { files.set(name, { bytes: Buffer.from(bytes), mimeType: 'application/json' }); },
    async read(name, range) { const file = files.get(name); return file && new Response(range ? file.bytes.subarray(range.start, range.end + 1) : file.bytes, { headers: { 'Content-Type': file.mimeType } }); },
  }, async owner => [...store.records].filter(([key]) => key.startsWith(`cloudOwners/${owner}/drafts/`)).map(([, value]) => value as any));
  const handler = hostedHandler({} as ReturnType<typeof hostedJobs>, async () => ({ uid: 'synthetic-autofill', email: 'autofill-test@bevmaq.com', email_verified: true }), ['http://localhost:8085'], 'synthetic', undefined, service);
  await context.route('https://storage.googleapis.com/cloud-fixture/**', async route => {
    const request = route.request(), session = sessions.get(request.url())!;
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Range' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'Content-Type, Content-Range' } });
    if (request.headers()['content-range']?.startsWith('bytes */')) return route.fulfill({ status: files.has(session.name) ? 200 : 308, headers: cors });
    dataUploads++; files.set(session.name, { bytes: request.postDataBuffer()!, mimeType: session.mimeType });
    if (interrupt) { interrupt = false; return route.fulfill({ status: 503, headers: cors }); }
    return route.fulfill({ status: 200, headers: cors });
  });
  await context.route('**/api/cloud/**', async route => {
    const request = route.request();
    const result = await handler(new Request(request.url(), { method: request.method(), headers: request.headers(), ...(request.postData() ? { body: request.postData()! } : {}) }));
    await route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: Buffer.from(await result.arrayBuffer()) });
  });
  await context.route('**/api/transcriptions/**', route => route.fulfill({ json: { state: 'complete', text: 'Synthetic cloud visitor needs juice.', engine: 'Synthetic speech' } }));
  await context.route('**/api/extractions/**', route => route.fulfill({ json: { state: 'complete', engine: 'Synthetic details', result: { fields: { name: 'Cloud Visitor' }, request: { product: 'juice' }, questions: [] } } }));
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto('/'); await page.getByRole('button', { name: 'Neuer Besucher', exact: true }).click();
  await page.getByRole('button', { name: 'Sprachnotiz aufnehmen', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stoppen und speichern', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cloud Visitor', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cloud-Sicherung wiederholen', exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('In Company Cloud gesichert', { exact: true })).toBeVisible();
  expect(dataUploads).toBe(1);
  // An unchanged saved visitor must recover its status after an offline tick.
  await context.setOffline(true);
  await expect(page.getByText('Hier gesichert · Cloud folgt bei Verbindung', { exact: true })).toBeVisible({ timeout: 15000 });
  await context.setOffline(false);
  await expect(page.getByText('In Company Cloud gesichert', { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Notiz ergänzen', exact: true }).click();
  await page.getByLabel('Notiz', { exact: true }).fill('A synthetic offline follow-up.');
  await page.getByRole('button', { name: 'Notiz speichern', exact: true }).click();
  await expect(page.getByText('Hier gesichert · Cloud folgt bei Verbindung', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('In Company Cloud gesichert', { exact: true })).toBeVisible();
  expect(dataUploads).toBe(1);
  await page.reload();
  await expect(page.getByText('In Company Cloud gesichert', { exact: true })).toBeVisible();
  const voice = page.getByRole('button', { name: 'Sprachnotiz aufnehmen', exact: true });
  expect((await voice.boundingBox())!.height).toBeLessThanOrEqual(50);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('compact-cloud-mobile.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('button', { name: 'Persönliche Cloud-Sicherungen', exact: true }).click();
  await page.getByRole('button', { name: 'Cloud-Kopie öffnen: Cloud Visitor', exact: true }).click();
  await expect(page.getByText('A synthetic offline follow-up.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Aufnahme abspielen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aufnahme pausieren', exact: true })).toBeVisible();
  expect(dataUploads).toBe(1);
});

test('dictation editing buffer and focus survive keyboard resize and background filling; save merges only edited fields', async ({ context, page }) => {
  await installIdentity(context);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/transcriptions/**', route => route.fulfill({ json: { state: 'complete', text: 'Synthetic company and request.', engine: 'Synthetic speech' } }));
  await page.route('**/api/extractions/**', async route => { await gate; await route.fulfill({ json: { state: 'complete', engine: 'Synthetic details', result: { fields: { company: 'Synthetic Bottling' }, request: { product: 'juice' }, questions: [] } } }); });
  await page.goto('/'); await page.getByRole('button', { name: 'Neuer Besucher', exact: true }).click();
  await page.getByRole('button', { name: 'Sprachnotiz aufnehmen', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible(); await page.getByRole('button', { name: 'Stoppen und speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt & Bedarf', exact: true }).click();
  await page.getByRole('button', { name: 'Kontakt bearbeiten', exact: true }).click();
  const input = page.getByLabel('Name', { exact: true }); await input.focus();
  await input.evaluate((node: HTMLInputElement) => {
    (window as any).__dictationNode = node;
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, 'Synthetic dictated visitor');
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'Synthetic dictated visitor', isComposing: true }));
    node.setSelectionRange(9, 9);
  });
  await page.setViewportSize({ width: 402, height: 510 });
  release();
  await expect(page.getByLabel('Firma', { exact: true })).toHaveValue('Synthetic Bottling');
  expect(await input.evaluate(node => node === (window as any).__dictationNode && node === document.activeElement && (node as HTMLInputElement).selectionStart === 9)).toBe(true);
  await expect(input).toHaveValue('Synthetic dictated visitor');
  await input.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'Synthetic dictated visitor' })));
  await page.getByRole('button', { name: 'Kontakt speichern', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic dictated visitor', exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic Bottling', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('juice', { exact: true })).toBeVisible();
});
