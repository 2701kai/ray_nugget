import { GoogleAuth } from 'google-auth-library';
import target from '../deploy/target.json';

// Only Firebase's public client configuration enters the web build.
const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
const { data } = await client.request<{ apiKey: string; projectId: string; appId: string }>({ url: `https://firebase.googleapis.com/v1beta1/projects/${target.project}/webApps/${target.webApp}/config` });
if (data.projectId !== target.project || data.appId !== target.webApp) throw new Error('Firebase app does not match the reviewed deployment target.');
const env = { ...process.env, EXPO_NO_DOTENV: '1', NODE_ENV: 'production', PETE_WEB_OUTPUT: 'dist-hosted',
  EXPO_PUBLIC_PROCESSING_URL: '/api', EXPO_PUBLIC_FIREBASE_API_KEY: data.apiKey, EXPO_PUBLIC_FIREBASE_PROJECT_ID: data.projectId,
  EXPO_PUBLIC_FIREBASE_APP_ID: data.appId, EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: `${target.site}.firebaseapp.com`,
};
for (const command of [['bun', 'scripts/prepare-ocr.ts'], ['bunx', '--no-install', 'expo', 'export', '--platform', 'web', '--output-dir', 'dist-hosted'], ['bun', 'scripts/prepare-pwa.ts']]) {
  const child = Bun.spawn(command, { env, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error('Hosted build failed.');
}
