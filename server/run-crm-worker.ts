import { GoogleAuth } from 'google-auth-library';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { initializeFirestore } from 'firebase-admin/firestore';
import { crmDelivery } from './crm-delivery';
import { crmWorker, firestoreCrmDue } from './crm-worker';
import { firestoreStore } from './hosted-store';
import { hostedStorage } from './hosted-storage';

/** Explicit Cloud Run Job entry point. No scheduler or production configuration
 * is installed by adding this file. Missing enablement never touches GCP. */
export async function runConfiguredCrmWorker(env: Record<string, string | undefined>) {
  if (env.PETE_CRM_DELIVERY_ENABLED !== 'true') throw new Error('CRM delivery is disabled.');
  const required = ['PETE_GCP_PROJECT', 'PETE_FIRESTORE_DATABASE', 'PETE_BACKUP_BUCKET', 'PETE_CRM_ENDPOINT', 'PETE_CRM_AUDIENCE'] as const;
  for (const name of required) if (!env[name]) throw new Error(`Set ${name} explicitly before running the CRM worker.`);
  const project = env.PETE_GCP_PROJECT!, audience = env.PETE_CRM_AUDIENCE!;
  const limit = Number(env.PETE_CRM_BATCH_SIZE || '20');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('CRM batch size must be from 1 to 100.');
  // Validate the target before initializing Google credentials or storage.
  const auth = new GoogleAuth({ projectId: project });
  const transport = crmDelivery({ endpoint: env.PETE_CRM_ENDPOINT!, audience, token: async () => {
    const client = await auth.getIdTokenClient(audience);
    const header = (await client.getRequestHeaders()).get('authorization');
    if (!header?.startsWith('Bearer ')) throw new Error('Service identity unavailable.');
    return header.slice(7);
  } });
  const app = initializeApp({ credential: applicationDefault(), projectId: project }, `pete-crm-job-${crypto.randomUUID()}`);
  const db = initializeFirestore(app, { preferRest: true }, env.PETE_FIRESTORE_DATABASE!);
  try {
    const storage = hostedStorage(project, env.PETE_BACKUP_BUCKET!);
    const worker = crmWorker({ store: firestoreStore(db), transport, due: firestoreCrmDue(db, transport.destinationId),
      readSource: async path => (await storage.read(path))?.text() });
    const results = await worker.drain(limit);
    // Operational counts only. Never print tokens, visitor IDs or source text.
    return results.reduce<Record<string, number>>((counts, item) => { counts[item.outcome] = (counts[item.outcome] ?? 0) + 1; return counts; }, {});
  } finally { await db.terminate(); await deleteApp(app); }
}

if (import.meta.main) {
  try { console.log(JSON.stringify({ crmWorker: 'complete', outcomes: await runConfiguredCrmWorker(process.env) })); }
  catch { console.error('CRM worker did not complete. Check its explicit configuration and stored queue state.'); process.exitCode = 1; }
}
