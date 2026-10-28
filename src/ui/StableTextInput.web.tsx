import { useLayoutEffect, useRef, type ComponentRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

// Let Safari own the editing buffer, selection and dictation composition.
// Background draft/queue renders must not write a controlled value into it.
export function StableTextInput({ value, defaultValue, onChangeText, ...props }: TextInputProps) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const initial = useRef(value ?? defaultValue ?? '');
  useLayoutEffect(() => {
    const node = input.current;
    if ((node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && document.activeElement !== node && value !== undefined && node.value !== value) node.value = value;
  }, [value]);
  return <TextInput {...props} ref={input} defaultValue={initial.current} onChangeText={onChangeText} />;
}
