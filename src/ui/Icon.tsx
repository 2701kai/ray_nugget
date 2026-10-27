import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { colors } from './theme';

const paths = {
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  card: 'M3 5h18v14H3zM6 14h5M6 16h3M14 9h4M14 12h4',
  contact: 'M5 21v-3a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v3M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  request: 'M7 3h10l3 3v15H4V3h3M8 8h8M8 12h8M8 16h5',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  chevron: 'm9 5 7 7-7 7',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  folder: 'M3 6h7l2 3h9v11H3zM3 6V4h7l2 2h7v3',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  phone: 'm7 3-4 2c0 9 7 16 16 16l2-4-5-3-2 2-6-6 2-2z',
  copy: 'M9 8h12v13H9zM5 16H3V3h12v2',
  play: 'm8 4 12 8-12 8z',
  pause: 'M8 5v14M16 5v14',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
  camera: 'M3 7h4l2-3h6l2 3h4v14H3zM12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
  stop: 'M6 6h12v12H6z',
  clock: 'M12 8v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  flag: 'M5 22V3h13l-2 5 2 5H5',
  shield: 'm12 3 8 3v6c0 5-8 10-8 10S4 17 4 12V6z',
};
export type IconName = keyof typeof paths;
export function Icon({ name, size = 22, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><Path d={paths[name]} /></Svg>;
}
export function PeteMark({ size = 36, light = false }: { size?: number; light?: boolean }) {
  const fill = light ? colors.accent : colors.green;
  return <Svg width={size} height={size} viewBox="0 0 40 40"><Rect x="2" y="2" width="36" height="36" rx="12" fill={fill} /><Path fillRule="evenodd" d="M13 29V11h9a7 7 0 0 1 0 14h-4v4h-5Zm5-9h4a2 2 0 0 0 0-4h-4v4Z" fill={light ? colors.green : colors.paper} /><Circle cx="28" cy="29" r="2.5" fill={light ? colors.green : colors.accent} /></Svg>;
}
