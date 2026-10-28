import { release } from '../release';
import { Txt } from './primitives';
import { colors } from './theme';
export function VersionHint({ full = false }: { full?: boolean }) {
  return <Txt selectable accessibilityLabel={`Pete version ${release.version}, build ${release.build}`} style={{ fontSize: 16, lineHeight: 22, color: colors.muted, textAlign: 'center' }}>v{release.version} · {full ? release.build : release.build.slice(0, 7)}</Txt>;
}
