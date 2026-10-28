import { View } from 'react-native';
import type { Draft } from '../domain/draft';
import { Txt } from './primitives';
import { colors } from './theme';

export function NeedSummary({ draft }: { draft: Draft }) {
  const r = draft.request;
  const core = [r.product, [r.containerSize, r.packaging].filter(Boolean).join(' '),
    r.throughput && r.unit ? `${r.throughput} ${r.unit}` : ''].filter(Boolean);
  const details = [r.fillingProcess, r.productProperties, r.particleSize, r.closure].filter(Boolean);
  return <View testID="need-summary" style={{ gap: 3 }}>
    <Txt numberOfLines={2} style={{ fontSize: 16, lineHeight: 24, color: core.length ? colors.ink : colors.muted }}>
      {r.intent === 'sell' ? 'Selling · ' : ''}{core.join(' · ') || 'Start with their need or their business card.'}
    </Txt>
    {!!details.length && <Txt numberOfLines={1} style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{details.join(' · ')}</Txt>}
  </View>;
}
