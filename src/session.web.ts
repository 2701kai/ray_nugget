import { initializeApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver, GoogleAuthProvider, getRedirectResult, signInWithRedirect, signOut } from 'firebase/auth';

const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
// Keep redirects on the app's Hosting domain for browsers that partition storage.
const hostedDomains = (process.env.EXPO_PUBLIC_FIREBASE_HOSTED_DOMAINS || '').split(',');
const authDomain = typeof window !== 'undefined' && hostedDomains.includes(window.location.hostname)
  ? window.location.hostname : process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN;
export const auth = apiKey ? initializeAuth(initializeApp({
  apiKey,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  authDomain,
}), { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver }) : undefined;
export async function signInWithGoogle() {
  if (!auth) return;
  const provider = new GoogleAuthProvider();
  // Account-picker hint only. UI and API still enforce the company domain.
  // Firebase 13 does not forward languageCode into Google's redirect parameters.
  provider.setCustomParameters({ hd: 'bevmaq.com', prompt: 'select_account', hl: 'en-US' });
  auth.languageCode = 'en-US';
  await signInWithRedirect(auth, provider);
}
export const finishGoogleSignIn = async () => { if (auth) await getRedirectResult(auth); };
export const sessionEmail = () => auth?.currentUser?.email ?? undefined;
export function storageName() {
  if (!auth) return undefined; // Keep the original local-preview database untouched.
  if (!auth.currentUser?.emailVerified) throw new Error('Sign in with your verified BEVMAQ account.');
  return `pete-user-${auth.currentUser.uid}`;
}
export async function accessToken() {
  if (!auth) return undefined;
  if (!auth.currentUser?.emailVerified) throw new Error('Sign in to Pete to process this recording.');
  return auth.currentUser.getIdToken();
}
export const signOutSession = async () => { if (auth) await signOut(auth); };
