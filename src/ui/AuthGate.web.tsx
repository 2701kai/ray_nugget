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
  if (code === 'auth/network-request-failed') return 'Verbinde Dich zum Anmelden mit dem Internet.';
  if (code === 'auth/too-many-requests') return 'Zu viele Versuche. Warte kurz und versuche es erneut.';
  if (code === 'auth/account-exists-with-different-credential') return 'Für diese E-Mail gibt es bereits ein Konto. BEVMAQ-Support kann die Google-Anmeldung verbinden und Deine Daten erhalten.';
  if (code === 'auth/operation-not-allowed' || code === 'auth/unauthorized-domain') return 'Google-Anmeldung ist gerade nicht erreichbar. Versuche es gleich erneut.';
  return 'Die Anmeldung wurde nicht abgeschlossen. Versuche es mit Deinem BEVMAQ-Konto erneut.';
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
      <Txt accessibilityRole="header" weight="bold" style={{ fontSize: 27, lineHeight: 36 }}>{!ready ? 'Dein Arbeitsbereich wird geöffnet…' : user ? 'Nutze Dein Firmenkonto.' : 'Dein nächstes Gespräch.'}</Txt>
      {!ready ? <View style={{ height: 160, borderRadius: 16, backgroundColor: colors.sage }} /> : <>
        <Txt style={{ color: colors.muted }}>{user ? `${user.email || 'Dieses Google-Konto'} hat keinen Zugriff auf Pete. Wähle Dein Google-Konto von BEVMAQ.` : 'Melde Dich mit Deinem Google-Konto von BEVMAQ an.'}</Txt>
        <Button label={busy ? 'Google wird geöffnet…' : user ? 'Anderes Google-Konto wählen' : 'Mit Google anmelden'} disabled={busy} onPress={() => { void signIn(); }} />
      </>}
      <ErrorNotice message={error} />
      <Txt style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>Für das BEVMAQ-Team. Bereits geöffnete Besucher und Aufnahmen bleiben auf diesem Gerät offline verfügbar.</Txt>
      <VersionHint />
    </View>
  </ScrollView>;
}
