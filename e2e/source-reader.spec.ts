import { expect, test, type Page } from '@playwright/test';

async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('ray-nugget-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction(['drafts', 'jobs']);
    const read = (store: string) => new Promise<any[]>((resolve, reject) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const [drafts, jobs] = await Promise.all([read('drafts'), read('jobs')]); db.close(); return { drafts, jobs };
  });
}

test('full transcript stays readable during paused processing without reviewing or changing either visitor', async ({ page, context }) => {
  const transcript = ['Synthetic conversation with Mara Lind.', ...Array.from({ length: 18 }, (_, i) => `Topic ${i + 1}: The visitor describes the filling line and asks us to retain the original details for a later discussion.`), 'Final detail: follow up after the equipment review.'].join('\n\n');
  await page.setViewportSize({ width: 402, height: 874 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('http://127.0.0.1:8091/**', route => route.fulfill({ json: { state: 'complete', text: transcript, engine: 'Synthetic source fixture' }, headers: { 'Access-Control-Allow-Origin': route.request().headers().origin } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'New visitor', exact: true }).click();
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByText(/^00:0[1-3]$/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Read transcript', exact: true })).toBeVisible();
  await expect.poll(async () => (await records(page)).jobs[0]?.state).toBe('complete');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('ray-nugget-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction(['drafts', 'jobs'], 'readwrite');
    const get = tx.objectStore('drafts').getAll();
    get.onsuccess = () => {
      const draft = get.result[0];
      draft.contact.name = 'Mara Lind'; draft.event = 'Synthetic fair';
      draft.provenance['contact.name'] = { source: 'manual', at: draft.updatedAt };
      tx.objectStore('drafts').put(draft);
      // Deliberately reuse the attachment ID in another visitor: association
      // must always include the draft ID, never just the media ID.
      tx.objectStore('drafts').put({ ...draft, id: 'other-visitor', contact: { ...draft.contact, name: 'Other visitor' } });
      const job = tx.objectStore('jobs').get(`${draft.id}/${draft.attachments[0].id}`);
      job.onsuccess = () => {
        const paused = { ...job.result, state: 'failed', readyAt: Number.MAX_SAFE_INTEGER, error: 'Synthetic extraction paused', reviewedAt: undefined };
        tx.objectStore('jobs').put(paused);
        tx.objectStore('jobs').put({ ...paused, id: '000-foreign-job', draftId: 'other-visitor', result: { fields: {}, text: 'UNRELATED VISITOR SOURCE', engine: 'Synthetic source fixture' } });
      };
    };
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  });
  await page.reload();
  await expect(page.getByText('Processing paused · retry when ready', { exact: true })).toBeVisible();
  const before = await records(page);
  await page.getByRole('button', { name: 'Read transcript', exact: true }).click();
  const reader = page.getByRole('dialog');
  await expect(reader.getByText('Mara Lind · Synthetic fair', { exact: true })).toBeVisible();
  await expect(reader.getByTestId('source-reader-text')).toHaveText(transcript);
  await expect(reader.getByText('UNRELATED VISITOR SOURCE', { exact: true })).toHaveCount(0);
  await expect(reader.getByRole('textbox')).toHaveCount(0);
  await expect(reader.getByRole('button', { name: /Apply|Keep existing|Use this/ })).toHaveCount(0);
  await reader.getByRole('button', { name: 'Copy text', exact: true }).click();
  await expect(reader.getByRole('button', { name: 'Text copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(transcript);
  await page.screenshot({ path: test.info().outputPath('source-reader-mobile.png') });
  const endVisible = await reader.getByTestId('source-reader-text').evaluate(el => {
    let scroller = el.parentElement;
    while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!scroller) return false;
    scroller.scrollTop = scroller.scrollHeight;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last: Text | undefined;
    while (walker.nextNode()) last = walker.currentNode as Text;
    if (!last) return false;
    const range = document.createRange(); range.setStart(last, Math.max(0, last.length - 10)); range.setEnd(last, last.length);
    const end = range.getBoundingClientRect(), viewport = scroller.getBoundingClientRect();
    return scroller.scrollTop > 0 && end.top >= viewport.top && end.bottom <= viewport.bottom;
  });
  expect(endVisible).toBe(true);
  await reader.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await records(page)).toEqual(before);
  await page.getByRole('button', { name: 'Capture a voice note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Read transcript', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop and save recording', exact: true }).click();
});
