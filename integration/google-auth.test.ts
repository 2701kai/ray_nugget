import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithCredential, signOut, deleteUser } from 'firebase/auth';
import { ownerOf } from '../server/hosted-api';
import { openRepository } from '../src/storage/repository.web';
import { createDraft } from '../src/domain/draft';

// Never exercise fabricated Google credentials against a real Firebase project.
const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (host && host !== '127.0.0.1:9099') throw new Error('Run bun run test:auth with the isolated local Auth emulator.');
const authTest = host ? test : test.skip;
const projectId = 'demo-pete-sso';
function session() {
  const app = initializeApp({ apiKey: 'fake-emulator-key', projectId }, crypto.randomUUID());
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  connectAuthEmulator(auth, `http://${host}`, { disableWarnings: true });
  return { app, auth };
}
const google = (email: string, verified = true) => GoogleAuthProvider.credential(JSON.stringify({ sub: crypto.randomUUID(), email, email_verified: verified, hd: 'bevmaq.com' }));

authTest.each([false, true])('Google sign-in keeps the password account UID and drafts (previously verified: %s)', async verified => {
  const { app, auth } = session();
  const admin = initializeAdminApp({ projectId }, crypto.randomUUID());
  let repository: Awaited<ReturnType<typeof openRepository>> | undefined;
  try {
    const email = `migration-${crypto.randomUUID()}@bevmaq.com`;
    const original = await createUserWithEmailAndPassword(auth, email, crypto.randomUUID());
    const uid = original.user.uid;
    if (verified) await adminAuth(admin).updateUser(uid, { emailVerified: true });
    repository = await openRepository(`pete-user-${uid}`);
    const draft = createDraft('saved-before-google', 'contact', 'Synthetic fair', new Date().toISOString());
    await repository.create(draft, true);
    await repository.close(); repository = undefined;
    await signOut(auth);
    const signedIn = await signInWithCredential(auth, google(email));
    expect(signedIn.user.uid).toBe(uid);
    expect(signedIn.user.emailVerified).toBe(true);
    expect((await signedIn.user.getIdTokenResult()).signInProvider).toBe('google.com');
    repository = await openRepository(`pete-user-${signedIn.user.uid}`);
    expect(await repository.activeDraft()).toBe(draft.id);
    expect((await repository.list())[0].event).toBe('Synthetic fair');
  } finally {
    await repository?.close();
    if (auth.currentUser) await deleteUser(auth.currentUser);
    await deleteApp(app);
    await deleteAdminApp(admin);
  }
});

authTest('Google account-picker hints do not grant outsiders or unverified users API access', async () => {
  for (const [domain, verified] of [['example.test', true], ['bevmaq.com.evil.test', true], ['bevmaq.com', false], ['bevmaq.com', true]] as const) {
    const { app, auth } = session();
    try {
      const { user } = await signInWithCredential(auth, google(`test-${crypto.randomUUID()}@${domain}`, verified));
      const claims = (await user.getIdTokenResult()).claims;
      const identity = { uid: user.uid, email: claims.email as string, email_verified: claims.email_verified as boolean };
      if (domain === 'bevmaq.com' && verified) expect(ownerOf(identity)).toHaveLength(64);
      else expect(() => ownerOf(identity)).toThrow('Use a verified BEVMAQ email account.');
    } finally {
      if (auth.currentUser) await deleteUser(auth.currentUser);
      await deleteApp(app);
    }
  }
});
