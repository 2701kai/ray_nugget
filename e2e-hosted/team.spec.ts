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
test('two members share originals, merge offline notes and explicitly resolve competing edits', async ({ context, page, browser }) => {
  const store = new MemoryStore(), files = new Map<string, { bytes: Buffer; mimeType: string }>();
  const sessions = new Map<string, { name: string; mimeType: string }>();
  let dataUploads = 0, interrupt = false;
  const service = cloudBackups(store, {
    async begin(name, mimeType) { const url = `https://storage.googleapis.com/cloud-fixture/${sessions.size}`; sessions.set(url, { name, mimeType }); return url; },
    async inspect(name) { const file = files.get(name); return file && { bytes: file.bytes.length, mimeType: file.mimeType, sha256: createHash('sha256').update(file.bytes).digest('hex') }; },
    async put(name, bytes) { files.set(name, { bytes: Buffer.from(bytes), mimeType: 'application/json' }); },
    async read(name, range) { const file = files.get(name); return file && new Response(range ? file.bytes.subarray(range.start, range.end + 1) : file.bytes, { headers: { 'Content-Type': file.mimeType } }); },
  }, async owner => [...store.records].filter(([key]) => key.startsWith(`cloudOwners/${owner}/drafts/`)).map(([, value]) => value as any));
  const handler = hostedHandler({} as ReturnType<typeof hostedJobs>, async token => ({ uid: token, email: `${token}@bevmaq.com`, email_verified: true }), ['http://localhost:8085'], 'synthetic', undefined, service, [{ id: 'cibustec-2026', name: 'CIBUSTEC', members: ['alpha@bevmaq.com', 'beta@bevmaq.com'] }]);
  async function routes(context: import('@playwright/test').BrowserContext) {
  await context.route('https://storage.googleapis.com/cloud-fixture/**', async route => {
    const request = route.request(), session = sessions.get(request.url())!;
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Range' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'Content-Type, Content-Range' } });
    if (request.headers()['content-range']?.startsWith('bytes */')) return route.fulfill({ status: files.has(session.name) ? 200 : 308, headers: cors });
    dataUploads++; files.set(session.name, { bytes: request.postDataBuffer()!, mimeType: session.mimeType });
    if (interrupt) { interrupt = false; return route.fulfill({ status: 503, headers: cors }); }
    return route.fulfill({ status: 200, headers: cors });
  });
  await context.route(/\/api\/(?:cloud|teams)(?:\/|$)/, async route => {
    const request = route.request();
    const result = await handler(new Request(request.url(), { method: request.method(), headers: request.headers(), ...(request.postData() ? { body: request.postData()! } : {}) }));
    await route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: Buffer.from(await result.arrayBuffer()) });
  });
  await context.route('**/api/transcriptions/**', route => route.fulfill({ json: { state: 'complete', text: 'Synthetic cloud visitor needs juice.', engine: 'Synthetic speech' } }));
  await context.route('**/api/extractions/**', route => route.fulfill({ json: { state: 'complete', engine: 'Synthetic details', result: { fields: { name: 'Cloud Visitor' }, request: { product: 'juice' }, questions: [] } } }));

  }

  test.setTimeout(120000);
  const alpha = page;
  const other = await browser.newContext({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block', permissions: ['microphone'] });
  try {
    await installIdentity(context, {uid:'alpha',email:'alpha@bevmaq.com'}); await routes(context);
    await installIdentity(other, {uid:'beta',email:'beta@bevmaq.com'}); await routes(other);
    const beta = await other.newPage();
    await alpha.setViewportSize({width:402,height:874});
    await alpha.goto('/'); await beta.goto('http://localhost:8085');
    await expect(alpha.getByText('CIBUSTEC',{exact:true})).toBeVisible();
    await alpha.getByRole('button',{name:'New visitor',exact:true}).click();
    await alpha.getByRole('button',{name:'Capture a voice note',exact:true}).click();
    await expect(alpha.getByText(/^00:0[1-3]$/)).toBeVisible();
    await alpha.getByRole('button',{name:'Stop and save recording',exact:true}).click();
    await expect(alpha.getByRole('heading',{name:'Cloud Visitor',exact:true})).toBeVisible();
    await expect(alpha.getByText('Saved to team',{exact:true})).toBeVisible({timeout:30000});
    await expect(beta.getByRole('button',{name:'Open visitor Cloud Visitor',exact:true})).toBeVisible({timeout:30000});
    await beta.getByRole('button',{name:'Open visitor Cloud Visitor',exact:true}).click();
    await expect(beta.getByRole('heading',{name:'Cloud Visitor',exact:true})).toBeVisible();
    await beta.getByRole('button',{name:'Play recording',exact:true}).click();
    await expect(beta.getByRole('button',{name:'Pause recording',exact:true})).toBeVisible();
    await beta.getByRole('button',{name:'Pause recording',exact:true}).click();
    // Different offline notes must converge on the same visitor, keeping both sources.
    await context.setOffline(true);
    async function note(p: typeof page, text: string) {
      await p.getByRole('button',{name:'Add note',exact:true}).click();
      await p.getByLabel('Note',{exact:true}).fill(text);
      await p.getByRole('button',{name:'Save note',exact:true}).click();
    }
    await note(alpha, 'Synthetic offline alpha note');
    await note(beta, 'Synthetic beta note');
    await expect(beta.getByText('Saved to team',{exact:true})).toBeVisible({timeout:30000});
    await context.setOffline(false);
    await expect(alpha.getByText('Synthetic beta note',{exact:true})).toBeVisible({timeout:30000});
    await expect(beta.getByText('Synthetic offline alpha note',{exact:true})).toBeVisible({timeout:30000});
    // Both edit the same field from the same base. No last-write-wins overwrite.
    await expect(alpha.getByText('Saved to team',{exact:true})).toBeVisible({timeout:30000});
    async function editName(p: typeof page, name: string) {
      await p.getByRole('button',{name:'Details & request',exact:true}).click();
      await p.getByRole('button',{name:'Edit contact',exact:true}).click();
      await p.getByLabel('Name',{exact:true}).fill(name);
      await p.getByRole('button',{name:'Save contact',exact:true}).click();
      await p.getByRole('button',{name:'Conversation',exact:true}).click();
    }
    await alpha.getByRole('button',{name:'Details & request',exact:true}).click();
    await alpha.getByRole('button',{name:'Edit contact',exact:true}).click();
    await alpha.getByLabel('Name',{exact:true}).fill('Alpha corrected name');
    await editName(beta,'Beta corrected name');
    await expect(beta.getByText('Saved to team',{exact:true})).toBeVisible({timeout:30000});
    // Incoming team snapshots wait while a capture/edit panel owns the visitor.
    // Otherwise a background pull could advance the merge baseline underneath
    // the user's unsaved field buffer and hide a genuine competing edit.
    await alpha.waitForTimeout(16000);
    await expect(alpha.getByLabel('Name',{exact:true})).toHaveValue('Alpha corrected name');
    await alpha.getByRole('button',{name:'Save contact',exact:true}).click();
    await alpha.getByRole('button',{name:'Conversation',exact:true}).click();
    await expect(alpha.getByText('Review shared changes',{exact:true}).first()).toBeVisible({timeout:30000});
    await expect(alpha.getByText('On your device: Alpha corrected name',{exact:true})).toBeVisible();
    await expect(alpha.getByText('In the team: Beta corrected name',{exact:true})).toBeVisible();
    await alpha.getByRole('button',{name:'Team version',exact:true}).click();
    await alpha.getByRole('button',{name:'Merge selected details',exact:true}).click();
    await expect(alpha.getByRole('heading',{name:'Beta corrected name',exact:true})).toBeVisible({timeout:30000});
    await expect(alpha.getByText('Synthetic offline alpha note',{exact:true})).toBeVisible();
    await alpha.reload();
    await expect(alpha.getByRole('heading',{name:'Beta corrected name',exact:true})).toBeVisible();
    expect(await alpha.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await alpha.getByRole('button',{name:'New visitor',exact:true}).boundingBox())!.y).toBeGreaterThanOrEqual(0);
    await alpha.screenshot({path:test.info().outputPath('shared-mobile-conversation.png'),animations:'disabled'});
    await alpha.getByRole('button',{name:'Visitors',exact:true}).click();
    await alpha.screenshot({path:test.info().outputPath('shared-mobile-event.png'),animations:'disabled'});
  } finally { await other.close(); }

});
