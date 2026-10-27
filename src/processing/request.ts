import type { Request, RequestReview } from '../domain/draft';

type Candidate<T> = { value: T; evidence: string };
export type RequestCandidates = {
  product?: Candidate<string>;
  packaging?: Candidate<string>;
  capacity?: Candidate<NonNullable<RequestReview['capacity']>>;
};

// A small, local suggestion parser, not a general conversation interpreter.
// Read at review time so older transcripts also work without changing stored jobs.
const uncertain = /\b(?:no|not|never|without|kein\w*|nicht|ohne|maybe|perhaps|possibly|could|might|vielleicht|eventuell|unklar|unsicher|about|around|roughly|approximately|circa|ca|etwa|ungefähr|mindestens|höchstens|maximum|minimum|between|zwischen|bis|oder|or|alternatively|statt|instead|currently|existing|previous|bisher|aktuell|bisherig\w*|more|less|over|under|mehr|weniger)\b|\bat least\b|\bup to\b|[-−–—~≈<>]\s*\d|\d[\d., ]*\s+(?:to|and|und)\s+\d/iu;
const need = /\b(?:need\w*|require\w*|fill\w*|want\w*|benötig\w*|brauch\w*|füll\w*|abfüll\w*|suchen|gesucht)\b/iu;
const products = /\b(?:mineral water|mineralwasser|soft drinks?|softdrinks?|fruit juice|fruchtsaft|beer|bier|juice|saft|water|wasser|milk|milch|wine|wein|oil|öl|yoghurt|yogurt|joghurt)\b/giu;
const packaging = /\b(?:(?:glass|pet|plastic|aluminium|aluminum)\s+(?:bottles?|cans?)|glasflaschen?|pet[- ]?flaschen?|kunststoffflaschen?|bottles?|flaschen?|cans|dosen|kegs?|fässer|fässern|kartons?|cartons?)\b/giu;
const rate = /(?<![\p{L}\d.,])([\d][\d.,\u00a0\u202f ]*)\s*(bottles?|flaschen?|units?|einheiten|stück|stk\.?|litres?|liters?|liter|l)\s*(?:\/\s*h\b|per\s+hour\b|an?\s+hour\b|pro\s+stunde\b|je\s+stunde\b)/giu;

function unique<T>(items: Array<Candidate<T> & { blocked: boolean }>): Candidate<T> | undefined {
  if (items.some(item => item.blocked)) return undefined;
  const values = new Map(items.map(item => [JSON.stringify(item.value).toLowerCase(), item]));
  if (values.size !== 1) return undefined;
  const { value, evidence } = [...values.values()][0];
  return { value, evidence };
}

function amount(raw: string, unit: string): string | undefined {
  const value = raw.trim();
  // Accept grouping only in the unit's explicit language. A bare L/h with
  // 1,500 or 1.500 is ambiguous; keep it in the source instead of guessing.
  const german = /^(flasch|einheit|stück|stk|liter$)/iu.test(unit);
  const english = /^(bottle|unit|litre|liters)/iu.test(unit);
  const grouped = german ? /^\d{1,3}(?:\.\d{3})+$/ : english ? /^\d{1,3}(?:,\d{3})+$/ : /$^/;
  let normalized: string;
  if (grouped.test(value) || /^\d{1,3}(?:[ \u00a0\u202f]\d{3})+$/.test(value)) normalized = value.replace(/[., \u00a0\u202f]/g, '');
  else if (/^\d+(?:[.,]\d{1,2})?$/.test(value)) normalized = value.replace(',', '.');
  else return undefined;
  return Number(normalized) > 0 && Number.isFinite(Number(normalized)) ? String(Number(normalized)) : undefined;
}

export function requestCandidates(text: string): RequestCandidates {
  const found: { product: Array<Candidate<string> & { blocked: boolean }>; packaging: Array<Candidate<string> & { blocked: boolean }>; capacity: Array<Candidate<NonNullable<RequestReview['capacity']>> & { blocked: boolean }> } = { product: [], packaging: [], capacity: [] };
  // Do not silently discard a competing rate with a unit we cannot represent.
  let invalidRate = /(?:bottles?|flaschen?|units?|einheiten|stück|litres?|liters?|liter|\bL)\s*(?:\/\s*(?:min|s|sec|d)\b|per\s+(?:minute|second|day)\b|pro\s+(?:minute|sekunde|tag)\b)/iu.test(text);
  // Preserve decimal/grouping dots while separating sentences and labelled lines.
  for (const evidence of text.split(/[!?;\n]+|(?<!\bca)\.(?=\s|$)/iu).map(part => part.trim()).filter(Boolean)) {
    const blocked = uncertain.test(evidence);
    const rates = [...evidence.matchAll(rate)];
    for (const [field, label, vocabulary] of [
      ['product', /^(?:product(?: to fill)?|produkt|füllgut)\s*:\s*(.+)$/iu, products],
      ['packaging', /^(?:container(?:\s*\/\s*packaging)?|packaging|verpackung|gebinde|behälter)\s*:\s*(.+)$/iu, packaging],
    ] as const) {
      const labelled = evidence.match(label)?.[1].trim();
      if (labelled) found[field].push({ value: labelled, evidence, blocked: blocked || labelled.length > 2000 });
      else if (need.test(evidence)) {
        for (const match of evidence.matchAll(vocabulary)) {
          // "bottles" in a rate is its unit, not another packaging candidate.
          if (field === 'packaging' && rates.some(rate => match.index >= rate.index && match.index < rate.index + rate[0].length)) continue;
          found[field].push({ value: match[0], evidence, blocked });
        }
      }
    }
    for (const match of rates) {
      const throughput = amount(match[1], match[2]);
      if (!throughput) { invalidRate = true; continue; }
      const unit: Request['unit'] = /^(?:bottle|flasch)/i.test(match[2]) ? 'bottles/h' : /^(?:l)/i.test(match[2]) ? 'L/h' : 'units/h';
      found.capacity.push({ value: { throughput, unit }, evidence, blocked });
    }
  }
  return { product: unique(found.product), packaging: unique(found.packaging), capacity: invalidRate ? undefined : unique(found.capacity) };
}
