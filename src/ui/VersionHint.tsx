import { release } from '../release';
import { Txt } from './primitives';
import { colors } from './theme';
export function VersionHint() {
  return <Txt selectable accessibilityLabel={`Pete Version ${release.version}`} style={{ fontSize: 16, lineHeight: 22, color: colors.muted, textAlign: 'center' }}>Version {release.version}</Txt>;
}
