// An isolated origin and no Firebase configuration keep pilot visitors untouched.
const env = { ...process.env, EXPO_NO_DOTENV: '1', NODE_ENV: 'production', PETE_WEB_OUTPUT: 'dist-preview', EXPO_PUBLIC_PROCESSING_URL: '/api', EXPO_PUBLIC_WORKFLOW_PREVIEW: '1' };
for (const key of Object.keys(env)) if (key.startsWith('EXPO_PUBLIC_FIREBASE_')) delete (env as Record<string, string | undefined>)[key];
for (const command of [['bun', 'scripts/prepare-ocr.ts'], ['bunx', '--no-install', 'expo', 'export', '--platform', 'web', '--output-dir', 'dist-preview'], ['bun', 'scripts/prepare-pwa.ts']]) {
  const child = Bun.spawn(command, { env, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited !== 0) throw new Error('Workflow preview build failed.');
}
