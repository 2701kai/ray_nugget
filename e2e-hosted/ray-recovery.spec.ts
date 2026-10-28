import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createDraft, reduceDraft } from '../src/domain/draft';
import { manifestText } from '../src/team/merge';
import { installIdentity } from './identity';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

test('a previously stripped team copy recovers cloud advice and keeps earlier listings with their original assessment', async ({ page, context }) => {
  await installIdentity(context);
  const date = '2026-10-28T10:00:00.000Z';
  const base = reduceDraft(createDraft('recovery-visitor', 'request', 'CIBUSTEC', date), { type: 'edit', patch: { contact: { name: 'Synthetic Recovery' }, request: { product: 'juice', packaging: 'glass bottles', throughput: '20000', unit: 'bottles/h' } } }, date);
  const prior = { id: 'a'.repeat(64), draftId: base.id, sourceFingerprint: 'c'.repeat(64), createdAt: date, brief: 'Synthetic requirement.', omitted: 0, pending: 0, text: 'Earlier candidate needs technical confirmation.', questions: [], machines: [{ sku: 'SYNTHETIC-OLD', title: 'Earlier synthetic machine', manufacturer: 'Demo', url: 'https://www.bevmaq.com/machines/synthetic-old/', updated: date }], selectedSkus: [] };
  const remote = reduceDraft(base, { type: 'rayAdvice', advice: prior }, date);
  const local = reduceDraft(base, { type: 'rayAdvice', advice: { ...prior, id: 'b'.repeat(64), createdAt: '2026-10-28T11:00:00.000Z', text: 'Newer advice without a machine.', machines: [] } }, date);
  let text = manifestText({ draft: remote, jobs: [] });
  let pointer = { id: hash(base.id), draftId: base.id, title: base.contact.name, company: '', fingerprint: hash(text), revision: remote.revision, savedAt: date, intakeVersion: 1, rayIds: [prior.id] };
  let pushes = 0;
  await context.route('**/api/teams', route => route.fulfill({ json: [{ id: 'cibustec-2026', name: 'CIBUSTEC', members: ['autofill-test@bevmaq.com'] }] }));
  await context.route('**/api/teams/cibustec-2026/drafts**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'POST') {
      const body = request.postDataJSON(), snapshot = JSON.parse(body.manifest);
      expect(body.expected).toBe(pointer.fingerprint);
      const ids = snapshot.draft.ray.map((a: any) => a.id);
      if (!ids.includes(prior.id)) return route.fulfill({ status: 409, json: { error: 'Missing saved Ray advice' } });
      pushes++; text = body.manifest; pointer = { ...pointer, fingerprint: hash(text), revision: snapshot.draft.revision, rayIds: ids };
      return route.fulfill({ json: pointer });
    }
    return path.endsWith('/manifest') ? route.fulfill({ body: text, contentType: 'application/json' }) : route.fulfill({ json: [pointer] });
  });
  await page.goto('/'); await expect(page.getByRole('button', { name: 'New visitor', exact: true })).toBeVisible();
  await page.evaluate(async ({ local, text, fingerprint }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('pete-user-synthetic-autofill'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction(['drafts', 'settings'], 'readwrite');
    tx.objectStore('drafts').put(local);
    tx.objectStore('settings').put({ activeDraftId: local.id }, 'active-draft');
    tx.objectStore('settings').put({ teamId: 'cibustec-2026', base: text, fingerprint }, `team-link/${local.id}`);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, { local, text, fingerprint: pointer.fingerprint });
  await page.reload();
  await expect(page.getByText('Saved to team', { exact: true })).toBeVisible({ timeout: 35000 });
  expect(pushes).toBe(1); expect(pointer.rayIds.sort()).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  await expect(page.getByText('Newer advice without a machine.', { exact: true })).toBeVisible();
  await expect(page.getByText('Earlier synthetic machine', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Earlier advice (1)', exact: true }).click();
  await expect(page.getByText('Earlier candidate needs technical confirmation.', { exact: true })).toBeVisible();
  await expect(page.getByText('Earlier synthetic machine', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save for visitor', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved for visitor ✓', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('ray-recovered-320.png'), animations: 'disabled' });
});
