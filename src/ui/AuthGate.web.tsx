import { useEffect, useState, type ReactNode } from 'react';
import { View, ScrollView } from 'react-native';
import { onIdTokenChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, reload, type User } from 'firebase/auth';
import { auth, signOutSession } from '../session.web';
import { Button, ErrorNotice, Field, Txt } from './primitives';
import { PeteMark } from './Icon';
import { colors } from './theme';

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!auth);
  const [verified, setVerified] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => auth ? onIdTokenChanged(auth, value => { setUser(value); setVerified(!!value?.emailVerified); setReady(true); }) : undefined, []);
  if (!auth) return children;
  if (ready && user && verified && user.email?.toLowerCase().endsWith('@bevmaq.com')) return <View key={user.uid} style={{ flex: 1 }}>{children}</View>;
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === 'auth/weak-password' ? 'Choose a stronger password with at least 12 characters.' : code === 'auth/email-already-in-use' ? 'This account already exists. Sign in or reset its password.' : code === 'auth/too-many-requests' ? 'Too many attempts. Wait a little before trying again.' : code === 'auth/network-request-failed' ? 'Connect to the internet to sign in.' : e instanceof Error && !code ? e.message : 'Could not sign in. Check your email and password, then try again.');
    } finally { setBusy(false); }
  }
  const companyEmail = () => {
    const value = email.trim().toLowerCase();
    if (!/^[^@\s]+@bevmaq\.com$/.test(value)) throw new Error('Use your @bevmaq.com work email.');
    return value;
  };
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
    <View style={{ width: '100%', maxWidth: 440, alignSelf: 'center', gap: 20 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><PeteMark size={44} /><Txt weight="extra" style={{ fontSize: 34 }}>pete.</Txt></View>
      <Txt accessibilityRole="header" weight="bold" style={{ fontSize: 27, lineHeight: 36 }}>{!ready ? 'Opening your workspace…' : user ? 'Verify your work email.' : creating ? 'Your field workspace.' : 'Pick up the conversation.'}</Txt>
      {!ready ? <View style={{ height: 160, borderRadius: 16, backgroundColor: colors.sage }} /> : user ? <>
        <Txt style={{ color: colors.muted }}>Open the verification link sent to {user.email}, then come back here.</Txt>
        <Button label={busy ? 'Checking…' : 'I have verified my email'} disabled={busy} onPress={() => { void run(async () => { await reload(user); await user.getIdToken(true); setVerified(user.emailVerified); if (!user.emailVerified) setNotice('The email has not been verified yet. Open the link in your inbox first.'); }); }} />
        <Button label="Resend verification email" kind="secondary" disabled={busy} onPress={() => { void run(async () => { await sendEmailVerification(user); setNotice('Verification email sent.'); }); }} />
        <Button label="Use another account" kind="quiet" disabled={busy} onPress={() => { void run(signOutSession); }} />
      </> : <>
        <Txt style={{ color: colors.muted }}>Sign in with your BEVMAQ email. Your captures stay with your account on this device.</Txt>
        <Field label="Work email" value={email} onChangeText={setEmail} autoComplete="email" autoCapitalize="none" keyboardType="email-address" placeholder="you@bevmaq.com" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={creating ? 'new-password' : 'current-password'} helper={creating ? 'Use at least 12 characters. This is your Pete password.' : undefined} />
        <Button label={busy ? 'Please wait…' : creating ? 'Create Pete account' : 'Sign in'} disabled={busy || !email || !password} onPress={() => { void run(async () => {
          const address = companyEmail();
          if (creating) {
            if (password.length < 12) throw new Error('Use at least 12 characters for your Pete password.');
            const result = await createUserWithEmailAndPassword(auth!, address, password);
            await sendEmailVerification(result.user);
          } else await signInWithEmailAndPassword(auth!, address, password);
          setPassword('');
        }); }} />
        <Button label={creating ? 'Already registered? Sign in' : 'First visit? Create an account'} kind="secondary" disabled={busy} onPress={() => { setCreating(!creating); setError(''); setNotice(''); }} />
        {!creating && <Button label="Reset password" kind="quiet" disabled={busy} onPress={() => { void run(async () => { await sendPasswordResetEmail(auth!, companyEmail()); setNotice('If the account exists, a password reset email is on its way.'); }); }} />}
      </>}
      <ErrorNotice message={error} />
      {!!notice && <Txt accessibilityLiveRegion="polite" style={{ color: colors.green }}>{notice}</Txt>}
      <Txt style={{ fontSize: 12, lineHeight: 20, color: colors.muted }}>For the BEVMAQ team. Once signed in, saved drafts and captures are available offline on this device.</Txt>
    </View>
  </ScrollView>;
}
