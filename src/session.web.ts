import { initializeApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signOut } from 'firebase/auth';

const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
export const auth = apiKey ? initializeAuth(initializeApp({
  apiKey,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
}), { persistence: [indexedDBLocalPersistence, browserLocalPersistence] }) : undefined;
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
