import type { BrowserContext } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The deployed Firebase web key is public client configuration, not a credential.
// Read the exact build under test; every identity/API request below is intercepted.
const bundleDir = 'dist-hosted/_expo/static/js/web';
const publicKey = readdirSync(bundleDir).filter(file => file.endsWith('.js')).map(file => readFileSync(join(bundleDir, file), 'utf8')).join('\n').match(/AIza[\w-]{35}/)?.[0];
if (!publicKey) throw new Error('Build the hosted app before testing.');

export async function installIdentity(context: BrowserContext) {
  await context.route('https://**', route => {
    if (route.request().url().startsWith('https://identitytoolkit.googleapis.com/') && route.request().url().includes('accounts:lookup')) return route.fulfill({ json: { users: [{ localId: 'synthetic-autofill', email: 'autofill-test@bevmaq.com', emailVerified: true, providerUserInfo: [{ providerId: 'google.com', rawId: 'synthetic-autofill', email: 'autofill-test@bevmaq.com' }] }] } });
    return route.abort(); // Never let a fixture reach a live service.
  });
  await context.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Unconfigured synthetic endpoint' } }));
  await context.addInitScript(apiKey => {
    if (sessionStorage.getItem('fixture-initialized')) return;
    sessionStorage.setItem('fixture-initialized', '1');
    localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({
      uid: 'synthetic-autofill', email: 'autofill-test@bevmaq.com', emailVerified: true, isAnonymous: false,
      providerData: [{ providerId: 'google.com', uid: 'synthetic-autofill', email: 'autofill-test@bevmaq.com' }],
      stsTokenManager: { refreshToken: 'synthetic', accessToken: 'synthetic', expirationTime: Date.now() + 3600000 },
      createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey, appName: '[DEFAULT]',
    }));
  }, publicKey);

}
