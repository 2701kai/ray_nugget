import type { BrowserContext } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The deployed Firebase web key is public client configuration, not a credential.
// Read the exact build under test; every identity/API request below is intercepted.
const bundleDir = 'dist-hosted/_expo/static/js/web';
const publicKey = readdirSync(bundleDir).filter(file => file.endsWith('.js')).map(file => readFileSync(join(bundleDir, file), 'utf8')).join('\n').match(/AIza[\w-]{35}/)?.[0];
if (!publicKey) throw new Error('Build the hosted app before testing.');

export async function installIdentity(context: BrowserContext, identity = { uid: 'synthetic-autofill', email: 'autofill-test@bevmaq.com' }) {
  await context.route('https://**', route => {
    if (route.request().url().startsWith('https://identitytoolkit.googleapis.com/') && route.request().url().includes('accounts:lookup')) return route.fulfill({ json: { users: [{ localId: identity.uid, email: identity.email, emailVerified: true, providerUserInfo: [{ providerId: 'google.com', rawId: identity.uid, email: identity.email }] }] } });
    return route.abort(); // Never let a fixture reach a live service.
  });
  await context.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Unconfigured synthetic endpoint' } }));
  await context.route('**/api/teams', route => route.fulfill({ json: [] }));
  await context.addInitScript(({ apiKey, identity }) => {
    if (sessionStorage.getItem('fixture-initialized')) return;
    sessionStorage.setItem('fixture-initialized', '1');
    localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({
      uid: identity.uid, email: identity.email, emailVerified: true, isAnonymous: false,
      providerData: [{ providerId: 'google.com', uid: identity.uid, email: identity.email }],
      stsTokenManager: { refreshToken: 'synthetic', accessToken: identity.uid === 'synthetic-autofill' ? 'synthetic' : identity.uid, expirationTime: Date.now() + 3600000 },
      createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey, appName: '[DEFAULT]',
    }));
  }, { apiKey: publicKey, identity });

}
