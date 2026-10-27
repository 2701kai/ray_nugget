import { internationalPhone, type Contact } from '../domain/draft';

// These are review candidates, never assertions about the owner of a card.
// Ambiguous phone/email matches stay in the source text instead of being guessed.
export function contactCandidates(text: string): Partial<Contact> {
  const fields: Partial<Contact> = {};
  const emails = [...new Set(text.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi) ?? [])];
  if (emails.length === 1) fields.email = emails[0];
  const phones = [...new Set((text.match(/(?:\+|00)\d[\d ().-]{5,}\d/g) ?? []).flatMap(value => {
    try { return [internationalPhone(value)]; } catch { return []; }
  }))];
  if (phones.length === 1) fields.phone = phones[0];
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const name = lines.find(line => /^(?:name|contact|kontakt)\s*:/i.test(line));
  const company = lines.find(line => /^(?:company|firma|unternehmen)\s*:/i.test(line));
  if (name) fields.name = name.replace(/^[^:]*:\s*/, '').slice(0, 2000);
  if (company) fields.company = company.replace(/^[^:]*:\s*/, '').slice(0, 2000);
  if (!fields.company) fields.company = lines.find(line => /\b(?:GmbH|Ltd\.?|LLC|Inc\.?|AG|KG)\b/.test(line))?.slice(0, 2000);
  // Do not classify an unlabelled personal name from typography alone.
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => !!value));
}
