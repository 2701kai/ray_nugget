import { release } from '../release';
import { Txt } from './primitives';
import { colors } from './theme';
export function VersionHint() {
  return <Txt selectable accessibilityLabel={`Pete Version ${release.version}`} style={{ fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center' }}>{process.env.EXPO_PUBLIC_WORKFLOW_PREVIEW === '1' ? `Preview · Version ${release.version} · Local visitors` : `Version ${release.version}`}</Txt>;
}
