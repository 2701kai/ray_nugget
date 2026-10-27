import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type TextProps, type ViewStyle, useWindowDimensions } from 'react-native';
import { colors, fonts } from './theme';
import { Icon, type IconName } from './Icon';

export function Txt({ children, style, weight = 'regular', ...props }: TextProps & { weight?: keyof typeof fonts }) {
  return <Text {...props} style={[{ fontFamily: fonts[weight], color: colors.ink, fontSize: 14, lineHeight: 22 }, style]}>{children}</Text>;
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return <Txt weight="bold" style={{ fontSize: 10, letterSpacing: 1.8, color: colors.muted }}>{children}</Txt>;
}
export function Button({ label, onPress, icon, kind = 'primary', disabled, style, testID }: { label: string; onPress: () => void; icon?: IconName; kind?: 'primary' | 'secondary' | 'quiet' | 'danger'; disabled?: boolean; style?: ViewStyle; testID?: string }) {
  const dark = kind === 'primary';
  const color = kind === 'danger' ? colors.danger : dark ? colors.paper : colors.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} testID={testID} onPress={onPress} disabled={disabled} style={({ pressed }) => [s.button, { backgroundColor: dark ? colors.green : kind === 'secondary' ? colors.sage : 'transparent', opacity: disabled ? 0.4 : pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}>
    {icon && <Icon name={icon} size={18} color={color} />}<Txt weight="semibold" style={{ color, fontSize: 12 }}>{label}</Txt>
  </Pressable>;
}
export function Field({ label, helper, ...props }: TextInputProps & { label: string; helper?: string }) {
  return <View style={{ gap: 6, flex: 1 }}><Txt weight="semibold" style={{ fontSize: 12 }}>{label}</Txt><TextInput accessibilityLabel={label} placeholderTextColor="#9CA69C" {...props} style={[s.input, props.multiline && { minHeight: 90, textAlignVertical: 'top' }, props.style]} />{helper && <Txt style={{ fontSize: 11, lineHeight: 17, color: colors.muted }}>{helper}</Txt>}</View>;
}
export function ErrorNotice({ message }: { message?: string }) {
  return message ? <View accessibilityRole="alert" style={{ backgroundColor: colors.dangerBg, padding: 12, borderRadius: 10 }}><Txt style={{ color: colors.danger, fontSize: 12 }}>{message}</Txt></View> : null;
}
export function Sheet({ title, subtitle, children, onClose, locked = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; locked?: boolean }) {
  const { width } = useWindowDimensions();
  return <Modal transparent animationType="fade" visible onRequestClose={() => { if (!locked) onClose(); }}>
    <View style={s.overlay} accessibilityViewIsModal>
      <View style={[s.sheet, { width: Math.min(width - 24, 560) }]}>
        <View style={{ padding: 24, paddingBottom: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}><View style={{ flex: 1 }}><Txt weight="bold" style={{ fontSize: 23, lineHeight: 30 }}>{title}</Txt>{subtitle && <Txt style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{subtitle}</Txt>}</View><Button label="Close" icon="close" kind="quiet" onPress={onClose} disabled={locked} style={{ minWidth: 44, paddingHorizontal: 4 }} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, paddingTop: 4, gap: 18 }}>{children}</ScrollView>
      </View>
    </View>
  </Modal>;
}
export function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return <View style={{ gap: 6 }}><Txt weight="semibold" style={{ fontSize: 12 }}>{label}</Txt><View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>{options.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: value === option.value }} aria-checked={value === option.value} accessibilityLabel={option.label} onPress={() => onChange(option.value)} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: value === option.value ? colors.green : colors.line, backgroundColor: value === option.value ? colors.sage : colors.paper }}><Txt style={{ fontSize: 12 }} weight={value === option.value ? 'bold' : 'regular'}>{option.label}</Txt></Pressable>)}</View></View>;
}
export const s = StyleSheet.create({
  button: { minHeight: 42, paddingHorizontal: 16, borderRadius: 10, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: fonts.regular, color: colors.ink, backgroundColor: colors.background, minHeight: 46 },
  overlay: { flex: 1, backgroundColor: 'rgba(26,43,34,0.38)', justifyContent: 'center', alignItems: 'center', paddingVertical: 24 },
  sheet: { maxHeight: '95%', backgroundColor: colors.paper, borderRadius: 22, overflow: 'hidden', boxShadow: '0 20px 70px rgba(26,43,34,0.16)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
