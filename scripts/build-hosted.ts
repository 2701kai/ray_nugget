import target from '../deploy/target.json';

// Only Firebase's public client configuration enters the web build.
const response = await fetch(`https://${target.site}.web.app/__/firebase/init.json`);
if (!response.ok) throw new Error('Could not read the public Firebase app configuration.');
const data = await response.json() as { apiKey: string; projectId: string; appId: string };
if (typeof data.apiKey !== 'string' || !data.apiKey) throw new Error('Firebase public configuration is incomplete.');
if (data.projectId !== target.project || data.appId !== target.webApp) throw new Error('Firebase app does not match the reviewed deployment target.');
const env = { ...process.env, EXPO_NO_DOTENV: '1', NODE_ENV: 'production', PETE_WEB_OUTPUT: 'dist-hosted',
  EXPO_PUBLIC_PROCESSING_URL: '/api', EXPO_PUBLIC_FIREBASE_API_KEY: data.apiKey, EXPO_PUBLIC_FIREBASE_PROJECT_ID: data.projectId,
  EXPO_PUBLIC_FIREBASE_APP_ID: data.appId, EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: `${target.site}.firebaseapp.com`,
  EXPO_PUBLIC_FIREBASE_HOSTED_DOMAINS: `${target.site}.web.app,${target.site}.firebaseapp.com,${target.domain}`,
};
for (const command of [['bun', 'scripts/prepare-ocr.ts'], ['bunx', '--no-install', 'expo', 'export', '--platform', 'web', '--output-dir', 'dist-hosted'], ['bun', 'scripts/prepare-pwa.ts']]) {
  const child = Bun.spawn(command, { env, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error('Hosted build failed.');
}
