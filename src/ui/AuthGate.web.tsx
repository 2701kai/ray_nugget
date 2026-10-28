import { useEffect, useState, type ReactNode } from 'react';
import { View, ScrollView } from 'react-native';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { auth, finishGoogleSignIn, signInWithGoogle, signOutSession } from '../session.web';
import { Button, ErrorNotice, Txt } from './primitives';
import { PeteMark } from './Icon';
import { VersionHint } from './VersionHint';
import { colors } from './theme';

function signInError(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === 'auth/network-request-failed') return 'Connect to the internet to sign in with Google.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a little before trying again.';
  if (code === 'auth/account-exists-with-different-credential') return 'An account already exists for this email. BEVMAQ support can connect Google sign-in and preserve your data.';
  if (code === 'auth/operation-not-allowed' || code === 'auth/unauthorized-domain') return 'Google sign-in is temporarily unavailable. Please try again shortly.';
  return 'Google sign-in did not finish. Please try again with your BEVMAQ account.';
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!auth);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!auth) return;
    let active = true;
    const restore = () => setBusy(false);
    window.addEventListener('pageshow', restore);
    const unsubscribe = onIdTokenChanged(auth, value => { setUser(value); setReady(true); });
    void finishGoogleSignIn().catch(error => { if (active) setError(signInError(error)); });
    return () => { active = false; unsubscribe(); window.removeEventListener('pageshow', restore); };
  }, []);
  if (!auth) return children;
  if (ready && user?.emailVerified && user.email?.toLowerCase().endsWith('@bevmaq.com')) return <View key={user.uid} style={{ flex: 1 }}>{children}</View>;
  async function signIn() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (user) await signOutSession();
      await signInWithGoogle();
    } catch (error) { setError(signInError(error)); setBusy(false); }
  }
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
    <View style={{ width: '100%', maxWidth: 440, alignSelf: 'center', gap: 20 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><PeteMark size={44} /><Txt weight="extra" style={{ fontSize: 34 }}>pete.</Txt></View>
      <Txt accessibilityRole="header" weight="bold" style={{ fontSize: 27, lineHeight: 36 }}>{!ready ? 'Opening your workspace…' : user ? 'Use your work account.' : 'Your next conversation.'}</Txt>
      {!ready ? <View style={{ height: 160, borderRadius: 16, backgroundColor: colors.sage }} /> : <>
        <Txt style={{ color: colors.muted }}>{user ? `${user.email || 'This Google account'} does not have access to Pete. Choose your BEVMAQ Google account.` : 'Sign in with your BEVMAQ Google account.'}</Txt>
        <Button label={busy ? 'Opening Google…' : user ? 'Use another Google account' : 'Continue with Google'} disabled={busy} onPress={() => { void signIn(); }} />
      </>}
      <ErrorNotice message={error} />
      <Txt style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>For the BEVMAQ team. Previously opened visitors and recordings stay available offline on this device.</Txt>
      <VersionHint />
    </View>
  </ScrollView>;
}
