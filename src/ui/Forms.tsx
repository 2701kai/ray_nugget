import { useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { type Draft, rfqGaps } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import { Button, Choice, ErrorNotice, Field, Txt } from './primitives';
import { colors } from './theme';
import { Icon } from './Icon';
import { sessionEmail, signOutSession } from '../session';

function useSave() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Please try again.'); } finally { setBusy(false); }
  }
  return { busy, error, run };
}

export function ContactForm({ draft, workspace, done }: { draft: Draft; workspace: Workspace; done: () => void }) {
  const [contact, setContact] = useState({ ...draft.contact });
  const [event, setEvent] = useState(draft.event);
  const [revision] = useState(draft.revision);
  const save = useSave();
  return <>
    <Field label="Full name" value={contact.name} onChangeText={name => setContact({ ...contact, name })} placeholder="Who did you meet?" autoFocus />
    <Field label="Company" value={contact.company} onChangeText={company => setContact({ ...contact, company })} placeholder="Company or organisation" />
    <Field label="Mobile number" value={contact.phone} onChangeText={phone => setContact({ ...contact, phone })} placeholder="+49 …" keyboardType="phone-pad" helper="Include the country code for a WhatsApp introduction." />
    <Field label="Email" value={contact.email} onChangeText={email => setContact({ ...contact, email })} placeholder="name@company.com" keyboardType="email-address" autoCapitalize="none" />
    <Field label="Visit or event" value={event} onChangeText={setEvent} placeholder="Where did you meet?" />
    <Txt style={{ color: colors.muted, fontSize: 12 }}>A name is a start. You can fill in the rest later.</Txt>
    <ErrorNotice message={save.error} />
    <Button label={save.busy ? 'Saving…' : 'Save contact'} icon="check" disabled={save.busy} onPress={() => save.run(async () => { await workspace.update(draft.id, { type: 'edit', patch: { contact, event } }, revision); done(); })} />
  </>;
}

export function RequestForm({ draft, workspace, done }: { draft: Draft; workspace: Workspace; done: () => void }) {
  const [request, setRequest] = useState({ ...draft.request });
  const [note, setNote] = useState(draft.note);
  const [revision] = useState(draft.revision);
  const save = useSave();
  return <>
    <Choice label="This visitor wants to" value={request.intent} options={[{ value: 'buy', label: 'Buy a machine' }, { value: 'sell', label: 'Sell a machine' }, { value: 'unspecified', label: 'Not sure yet' }]} onChange={intent => setRequest({ ...request, intent })} />
    <Field label="Product to fill" placeholder="e.g. fruit juice, water, beer" value={request.product} onChangeText={product => setRequest({ ...request, product })} />
    <Field label="Container / packaging" placeholder="e.g. glass bottle, PET, carton" value={request.packaging} onChangeText={packaging => setRequest({ ...request, packaging })} />
    <Field label="Required throughput" placeholder="e.g. 2400" keyboardType="decimal-pad" value={request.throughput} onChangeText={throughput => setRequest({ ...request, throughput })} />
    <Choice label="Throughput unit" value={request.unit} options={[{ value: 'units/h', label: 'Units / hour' }, { value: 'bottles/h', label: 'Bottles / hour' }, { value: 'L/h', label: 'Litres / hour' }]} onChange={unit => setRequest({ ...request, unit })} />
    <Field label="Conversation notes" value={note} onChangeText={setNote} multiline placeholder="Timing, budget, a machine they mentioned…" />
    <View style={{ backgroundColor: colors.pale, padding: 14, borderRadius: 10 }}><Txt style={{ fontSize: 12, color: colors.green }}>{rfqGaps(request).length ? `Still to ask: ${rfqGaps(request).join(' · ')}. You can save this draft now.` : 'The three filling requirements are captured. Machine matching is a later step.'}</Txt></View>
    <ErrorNotice message={save.error} />
    <Button label={save.busy ? 'Saving…' : 'Save request'} icon="check" disabled={save.busy} onPress={() => save.run(async () => { await workspace.update(draft.id, { type: 'edit', patch: { request, note } }, revision); done(); })} />
  </>;
}

export function SettingsForm({ workspace, done }: { workspace: Workspace; done: () => void }) {
  const [prefs, setPrefs] = useState({ ...workspace.preferences, sender: { ...workspace.preferences.sender } });
  const save = useSave();
  return <>
    <Txt style={{ color: colors.muted }}>These details appear in the introduction you prepare for a visitor.</Txt>
    <Field label="Your name" value={prefs.sender.name} onChangeText={name => setPrefs({ ...prefs, sender: { ...prefs.sender, name } })} placeholder="Your full name" />
    <Field label="Your company" value={prefs.sender.company} onChangeText={company => setPrefs({ ...prefs, sender: { ...prefs.sender, company } })} />
    <Field label="Your mobile number" value={prefs.sender.phone} onChangeText={phone => setPrefs({ ...prefs, sender: { ...prefs.sender, phone } })} placeholder="+49 …" keyboardType="phone-pad" />
    <Field label="Default visit or event" value={prefs.event} onChangeText={event => setPrefs({ ...prefs, event })} placeholder="For new drafts" helper="Changing this leaves existing drafts unchanged." />
    <ErrorNotice message={save.error} />
    <Button label={save.busy ? 'Saving…' : 'Save your details'} icon="check" disabled={save.busy} onPress={() => save.run(async () => { await workspace.savePreferences(prefs); done(); })} />
    {!!sessionEmail() && <><Txt style={{ fontSize: 12, color: colors.muted }}>Signed in as {sessionEmail()}</Txt><Button label="Sign out" kind="quiet" disabled={save.busy} onPress={() => save.run(signOutSession)} /></>}
  </>;
}

export function FollowupForm({ draft, workspace }: { draft: Draft; workspace: Workspace }) {
  const save = useSave();
  const [copied, setCopied] = useState(false);
  const prepared = draft.followup;
  return <>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: colors.pale, borderRadius: 12 }}><Icon name="phone" color={colors.green} /><View style={{ flex: 1 }}><Txt weight="bold">{draft.contact.name || 'This visitor'}</Txt><Txt style={{ color: colors.muted }}>{draft.contact.phone || 'Add a mobile number in Contact first'}</Txt></View></View>
    <Txt style={{ fontSize: 13, color: colors.muted }}>Prepare a dated introduction with your contact details. This preview does not open WhatsApp or send a message.</Txt>
    {prepared && <View style={{ backgroundColor: colors.sage, borderRadius: 16, borderBottomLeftRadius: 4, padding: 20, gap: 12 }}><Txt selectable style={{ fontSize: 13, lineHeight: 23 }}>{prepared.message}</Txt><Txt weight="semibold" style={{ fontSize: 10, color: prepared.state === 'outdated' ? colors.danger : colors.green }}>{prepared.state === 'outdated' ? 'CONTACT CHANGED · PREPARE AGAIN' : 'PREPARED · NOT SENT'}</Txt><Txt style={{ fontSize: 11, color: colors.muted }}>Prepared for {prepared.recipient}</Txt></View>}
    <ErrorNotice message={save.error} />
    <Button label={save.busy ? 'Preparing…' : prepared ? 'Prepare updated introduction' : 'Prepare introduction'} icon="spark" disabled={save.busy || !draft.contact.phone.trim()} onPress={() => save.run(async () => { setCopied(false); await workspace.update(draft.id, { type: 'followup', sender: workspace.preferences.sender, operationId: Crypto.randomUUID() }); })} />
    {prepared?.state === 'prepared' && <Button label={copied ? 'Copied to clipboard' : 'Copy introduction'} icon={copied ? 'check' : 'copy'} kind="secondary" onPress={() => save.run(async () => { await Clipboard.setStringAsync(prepared.message); setCopied(true); })} />}
    <Txt style={{ fontSize: 11, lineHeight: 18, color: colors.muted }}>Automatic sending is not connected. Your draft and this preview stay on this device.</Txt>
  </>;
}
