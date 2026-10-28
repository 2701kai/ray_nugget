import { qualificationKeys, requestLabels } from '../domain/requirements';
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
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Please try again.'); } finally { setBusy(false); }
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
    <Field label="Name" value={contact.name} onChangeText={name => setContact({ name })} placeholder="Who did you meet?" autoFocus />
    <Field label="Company" value={contact.company} onChangeText={company => setContact({ company })} placeholder="Company or organization" />
    <Field label="Mobile number" value={contact.phone} onChangeText={phone => setContact({ phone })} placeholder="+49 …" keyboardType="phone-pad" helper="Include the country code for a WhatsApp introduction." />
    <Field label="Email" value={contact.email} onChangeText={email => setContact({ email })} placeholder="name@company.com" keyboardType="email-address" autoCapitalize="none" />
    <Field editable={!workspace.teamView.links[draft.id]} label="Visit or event" value={event ?? draft.event} onChangeText={setEvent} placeholder="Where did you meet?" />
    <Txt style={{ color: colors.muted, fontSize: 16 }}>A name is a start. You can fill in the rest later.</Txt>
    <ErrorNotice message={save.error} />
    <Button label={save.busy ? 'Saving…' : 'Save contact'} icon="check" disabled={save.busy} onPress={() => save.run(async () => { await workspace.update(draft.id, { type: 'edit', patch: { contact: edits, ...(event === undefined ? {} : { event }) } }); done(); })} />
  </>;
}

export function RequestForm({ draft, workspace, done }: { draft: Draft; workspace: Workspace; done: () => void }) {
  const [edits, setEdits] = useState<Partial<Draft['request']>>({});
  const request = { ...draft.request, ...edits };
  const [qualifications, setQualifications] = useState(false);
  const setRequest = (patch: Partial<Draft['request']>) => setEdits(previous => ({ ...previous, ...patch }));
  const [note, setNote] = useState<string>();
  const save = useSave();
  return <>
    <Choice label="This visitor wants to" value={request.intent} options={[{ value: 'buy', label: 'Buy a machine' }, { value: 'sell', label: 'Sell a machine' }, { value: 'unspecified', label: 'Still needed' }]} onChange={intent => setRequest({ intent })} />
    <Field label="Product to fill" placeholder="e.g. fruit juice, water, beer" value={request.product} onChangeText={product => setRequest({ product })} />
    <Field label="Container / packaging" placeholder="e.g. glass bottle, PET, carton" value={request.packaging} onChangeText={packaging => setRequest({ packaging })} />
    <Field label="Required throughput" placeholder="e.g. 2400" keyboardType="decimal-pad" value={request.throughput} onChangeText={throughput => setRequest({ throughput })} />
    <Choice label="Unit" value={request.unit} options={[{ value: 'units/h', label: 'Units / hour' }, { value: 'bottles/h', label: 'Bottles / hour' }, { value: 'L/h', label: 'Liters / hour' }]} onChange={unit => setRequest({ unit })} />
    <Button label={qualifications ? 'Hide additional requirements' : 'Additional requirements'} kind="quiet" onPress={() => setQualifications(!qualifications)} />
    {qualifications && qualificationKeys.map(key => <Field key={key} label={requestLabels[key]} value={request[key] ?? ''} onChangeText={value => setRequest({ [key]: value })} />)}
    <Field label="Conversation notes" value={note ?? draft.note} onChangeText={setNote} multiline placeholder="Timing, budget, a machine they mentioned…" />
    <View style={{ backgroundColor: colors.pale, padding: 14, borderRadius: 10 }}><Txt style={{ fontSize: 16, color: colors.green }}>{rfqGaps(request).length ? `Still needed: ${rfqGaps(request).join(' · ')}. You can save now.` : 'The three filling requirements are captured. Ray can help qualify the technical fit.'}</Txt></View>
    <ErrorNotice message={save.error} />
    <Button label={save.busy ? 'Saving…' : 'Save request'} icon="check" disabled={save.busy} onPress={() => save.run(async () => { await workspace.update(draft.id, { type: 'edit', patch: { request: { ...edits, ...(('throughput' in edits || 'unit' in edits) ? { throughput: request.throughput, unit: request.unit } : {}) }, ...(note === undefined ? {} : { note }) } }); done(); })} />
  </>;
}

export function SettingsForm({ workspace, done }: { workspace: Workspace; done: () => void }) {
  const [prefs, setPrefs] = useState({ ...workspace.preferences, sender: { ...workspace.preferences.sender } });
  const save = useSave();
  return <>
    <ErrorNotice message={save.error} />
    {!!sessionEmail() && <View style={{ gap: 10, paddingBottom: 18, borderBottomWidth: 1, borderColor: colors.line }}><Txt style={{ color: colors.muted }}>Signed in as</Txt><Txt weight="bold" selectable>{sessionEmail()}</Txt><Button label="Sign out" kind="secondary" disabled={save.busy} onPress={() => save.run(signOutSession)} /><Txt style={{ fontSize: 16, color: colors.muted }}>{workspace.cloudEnabled ? 'Captures save here first, then automatically to company cloud. Keep Pete open until cloud saving finishes.' : 'Your drafts stay on this device.'}</Txt></View>}
    <VersionHint />
    <Txt style={{ color: colors.muted }}>These details appear in the introduction you prepare for a visitor.</Txt>
    <Field label="Your full name" value={prefs.sender.name} onChangeText={name => setPrefs({ ...prefs, sender: { ...prefs.sender, name } })} placeholder="Your full name" />
    <Field label="Your company" value={prefs.sender.company} onChangeText={company => setPrefs({ ...prefs, sender: { ...prefs.sender, company } })} />
    <Field label="Your mobile number" value={prefs.sender.phone} onChangeText={phone => setPrefs({ ...prefs, sender: { ...prefs.sender, phone } })} placeholder="+49 …" keyboardType="phone-pad" />
    <Field label="Default visit or event" value={prefs.event} onChangeText={event => setPrefs({ ...prefs, event })} placeholder="For new drafts" helper="Changing this leaves existing drafts unchanged." />
    <Button label={save.busy ? 'Saving…' : 'Save your details'} icon="check" disabled={save.busy} onPress={() => save.run(async () => { await workspace.savePreferences(prefs); done(); })} />
  </>;
}

export function FollowupForm({ draft, workspace }: { draft: Draft; workspace: Workspace }) {
  const save = useSave();
  const [copied, setCopied] = useState(false);
  const prepared = draft.followup;
  return <>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: colors.pale, borderRadius: 12 }}><Icon name="phone" color={colors.green} /><View style={{ flex: 1 }}><Txt weight="bold">{draft.contact.name || 'This visitor'}</Txt><Txt style={{ color: colors.muted }}>{draft.contact.phone || 'Add a mobile number in Contact first'}</Txt></View></View>
    <Txt style={{ fontSize: 16, color: colors.muted }}>Prepare a dated introduction with your contact details. This preview does not open WhatsApp or send a message.</Txt>
    {prepared && <View style={{ backgroundColor: colors.sage, borderRadius: 16, borderBottomLeftRadius: 4, padding: 20, gap: 12 }}><Txt selectable style={{ fontSize: 16, lineHeight: 24 }}>{prepared.message}</Txt><Txt weight="semibold" style={{ fontSize: 16, color: prepared.state === 'outdated' ? colors.danger : colors.green }}>{prepared.state === 'outdated' ? 'CONTACT CHANGED · PREPARE AGAIN' : 'PREPARED · NOT SENT'}</Txt><Txt style={{ fontSize: 16, color: colors.muted }}>Prepared for {prepared.recipient}</Txt></View>}
    <ErrorNotice message={save.error} />
    <Button label={save.busy ? 'Preparing…' : prepared ? 'Prepare updated introduction' : 'Prepare introduction'} icon="spark" disabled={save.busy || !draft.contact.phone.trim()} onPress={() => save.run(async () => { setCopied(false); await workspace.update(draft.id, { type: 'followup', sender: workspace.preferences.sender, operationId: Crypto.randomUUID() }); })} />
    {prepared?.state === 'prepared' && <Button label={copied ? 'Copied to clipboard' : 'Copy introduction'} icon={copied ? 'check' : 'copy'} kind="secondary" onPress={() => save.run(async () => { await Clipboard.setStringAsync(prepared.message); setCopied(true); })} />}
    <Txt style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>Automatic sending is not connected. This preview is saved with your visitor.</Txt>
  </>;
}
