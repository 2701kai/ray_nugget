import { useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { type Draft, rfqGaps } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import { Button, Choice, ErrorNotice, Field, Txt } from './primitives';
import { colors } from './theme';
import { VersionHint } from './VersionHint';
import { Icon } from './Icon';
import { sessionEmail, signOutSession } from '../session';

function useSave() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Speichern ist fehlgeschlagen. Versuche es erneut.'); } finally { setBusy(false); }
  }
  return { busy, error, run };
}

export function ContactForm({ draft, workspace, done }: { draft: Draft; workspace: Workspace; done: () => void }) {
  const [edits, setEdits] = useState<Partial<Draft['contact']>>({});
  const contact = { ...draft.contact, ...edits };
  const setContact = (patch: Partial<Draft['contact']>) => setEdits(previous => ({ ...previous, ...patch }));
  const [event, setEvent] = useState<string>();
  const save = useSave();
  return <>
    <Field label="Name" value={contact.name} onChangeText={name => setContact({ name })} placeholder="Wen hast Du getroffen?" autoFocus />
    <Field label="Firma" value={contact.company} onChangeText={company => setContact({ company })} placeholder="Firma oder Organisation" />
    <Field label="Mobilnummer" value={contact.phone} onChangeText={phone => setContact({ phone })} placeholder="+49 …" keyboardType="phone-pad" helper="Mit Ländervorwahl für die Kontaktaufnahme." />
    <Field label="E-Mail" value={contact.email} onChangeText={email => setContact({ email })} placeholder="name@company.com" keyboardType="email-address" autoCapitalize="none" />
    <Field editable={!workspace.teamView.links[draft.id]} label="Besuch oder Event" value={event ?? draft.event} onChangeText={setEvent} placeholder="Wo habt Ihr Euch getroffen?" />
    <Txt style={{ color: colors.muted, fontSize: 16 }}>Du kannst fehlende Angaben später ergänzen.</Txt>
    <ErrorNotice message={save.error} />
    <Button label={save.busy ? 'Wird gespeichert…' : 'Kontakt speichern'} icon="check" disabled={save.busy} onPress={() => save.run(async () => { await workspace.update(draft.id, { type: 'edit', patch: { contact: edits, ...(event === undefined ? {} : { event }) } }); done(); })} />
  </>;
}

export function RequestForm({ draft, workspace, done }: { draft: Draft; workspace: Workspace; done: () => void }) {
  const [edits, setEdits] = useState<Partial<Draft['request']>>({});
  const request = { ...draft.request, ...edits };
  const setRequest = (patch: Partial<Draft['request']>) => setEdits(previous => ({ ...previous, ...patch }));
  const [note, setNote] = useState<string>();
  const save = useSave();
  return <>
    <Choice label="Der Besucher möchte" value={request.intent} options={[{ value: 'buy', label: 'Eine Maschine kaufen' }, { value: 'sell', label: 'Eine Maschine verkaufen' }, { value: 'unspecified', label: 'Noch offen' }]} onChange={intent => setRequest({ intent })} />
    <Field label="Abzufüllendes Produkt" placeholder="z. B. Fruchtsaft, Wasser, Bier" value={request.product} onChangeText={product => setRequest({ product })} />
    <Field label="Behälter / Verpackung" placeholder="z. B. Glasflasche, PET, Karton" value={request.packaging} onChangeText={packaging => setRequest({ packaging })} />
    <Field label="Benötigter Durchsatz" placeholder="z. B. 2400" keyboardType="decimal-pad" value={request.throughput} onChangeText={throughput => setRequest({ throughput })} />
    <Choice label="Einheit" value={request.unit} options={[{ value: 'units/h', label: 'Einheiten / Stunde' }, { value: 'bottles/h', label: 'Flaschen / Stunde' }, { value: 'L/h', label: 'Liter / Stunde' }]} onChange={unit => setRequest({ unit })} />
    <Field label="Gesprächsnotizen" value={note ?? draft.note} onChangeText={setNote} multiline placeholder="Zeitraum, Budget oder genannte Maschine…" />
    <View style={{ backgroundColor: colors.pale, padding: 14, borderRadius: 10 }}><Txt style={{ fontSize: 16, color: colors.green }}>{rfqGaps(request).length ? `Noch offen: ${rfqGaps(request).join(' · ')}. Du kannst bereits speichern.` : 'Die drei Kernangaben sind erfasst. Maschinenabgleich folgt später.'}</Txt></View>
    <ErrorNotice message={save.error} />
    <Button label={save.busy ? 'Wird gespeichert…' : 'Bedarf speichern'} icon="check" disabled={save.busy} onPress={() => save.run(async () => { await workspace.update(draft.id, { type: 'edit', patch: { request: { ...edits, ...(('throughput' in edits || 'unit' in edits) ? { throughput: request.throughput, unit: request.unit } : {}) }, ...(note === undefined ? {} : { note }) } }); done(); })} />
  </>;
}

export function SettingsForm({ workspace, done }: { workspace: Workspace; done: () => void }) {
  const [prefs, setPrefs] = useState({ ...workspace.preferences, sender: { ...workspace.preferences.sender } });
  const save = useSave();
  return <>
    <ErrorNotice message={save.error} />
    {!!sessionEmail() && <View style={{ gap: 10, paddingBottom: 18, borderBottomWidth: 1, borderColor: colors.line }}><Txt style={{ color: colors.muted }}>Angemeldet als</Txt><Txt weight="bold" selectable>{sessionEmail()}</Txt><Button label="Abmelden" kind="secondary" disabled={save.busy} onPress={() => save.run(signOutSession)} /><Txt style={{ fontSize: 16, color: colors.muted }}>{workspace.cloudEnabled ? 'Pete sichert zuerst hier und dann automatisch in Company GCP. Lass Pete bis zum Abschluss geöffnet.' : 'Deine Besucher bleiben auf diesem Gerät verfügbar.'}</Txt></View>}
    <VersionHint />
    <Txt style={{ color: colors.muted }}>Diese Angaben verwendet Pete für Deine Kontaktvorlage.</Txt>
    <Field label="Dein Name" value={prefs.sender.name} onChangeText={name => setPrefs({ ...prefs, sender: { ...prefs.sender, name } })} placeholder="Dein Name" />
    <Field label="Deine Firma" value={prefs.sender.company} onChangeText={company => setPrefs({ ...prefs, sender: { ...prefs.sender, company } })} />
    <Field label="Deine Mobilnummer" value={prefs.sender.phone} onChangeText={phone => setPrefs({ ...prefs, sender: { ...prefs.sender, phone } })} placeholder="+49 …" keyboardType="phone-pad" />
    <Field label="Standard für persönliche Besuche" value={prefs.event} onChangeText={event => setPrefs({ ...prefs, event })} placeholder="Für neue persönliche Besucher" helper="Bestehende Besucher bleiben unverändert. Den Team-Bereich wählst Du auf der Startseite." />
    <Button label={save.busy ? 'Wird gespeichert…' : 'Angaben speichern'} icon="check" disabled={save.busy} onPress={() => save.run(async () => { await workspace.savePreferences(prefs); done(); })} />
  </>;
}

export function FollowupForm({ draft, workspace }: { draft: Draft; workspace: Workspace }) {
  const save = useSave();
  const [copied, setCopied] = useState(false);
  const prepared = draft.followup;
  return <>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: colors.pale, borderRadius: 12 }}><Icon name="phone" color={colors.green} /><View style={{ flex: 1 }}><Txt weight="bold">{draft.contact.name || 'Dieser Besucher'}</Txt><Txt style={{ color: colors.muted }}>{draft.contact.phone || 'Ergänze zuerst die Mobilnummer im Kontakt'}</Txt></View></View>
    <Txt style={{ fontSize: 16, color: colors.muted }}>Bereite eine datierte Nachricht mit Deinen Kontaktdaten vor. Diese Vorschau öffnet WhatsApp nicht und versendet nichts.</Txt>
    {prepared && <View style={{ backgroundColor: colors.sage, borderRadius: 16, borderBottomLeftRadius: 4, padding: 20, gap: 12 }}><Txt selectable style={{ fontSize: 16, lineHeight: 24 }}>{prepared.message}</Txt><Txt weight="semibold" style={{ fontSize: 16, color: prepared.state === 'outdated' ? colors.danger : colors.green }}>{prepared.state === 'outdated' ? 'KONTAKT GEÄNDERT · ERNEUT VORBEREITEN' : 'VORBEREITET · NICHT VERSENDET'}</Txt><Txt style={{ fontSize: 16, color: colors.muted }}>Vorbereitet für {prepared.recipient}</Txt></View>}
    <ErrorNotice message={save.error} />
    <Button label={save.busy ? 'Wird vorbereitet…' : prepared ? 'Kontaktvorlage aktualisieren' : 'Kontaktvorlage erstellen'} icon="spark" disabled={save.busy || !draft.contact.phone.trim()} onPress={() => save.run(async () => { setCopied(false); await workspace.update(draft.id, { type: 'followup', sender: workspace.preferences.sender, operationId: Crypto.randomUUID() }); })} />
    {prepared?.state === 'prepared' && <Button label={copied ? 'In Zwischenablage kopiert' : 'Kontaktvorlage kopieren'} icon={copied ? 'check' : 'copy'} kind="secondary" onPress={() => save.run(async () => { await Clipboard.setStringAsync(prepared.message); setCopied(true); })} />}
    <Txt style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>Automatischer Versand ist nicht verbunden. Die Vorlage wird beim Besucher gespeichert.</Txt>
  </>;
}
