import * as Haptics from 'expo-haptics';
import { Minus, Plus } from 'lucide-react-native';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { HelperText, Label } from '@/components/ui/form';
import { Txt } from '@/components/ui/Txt';
import { formatQty, parseQty } from '@/lib/estimate';
import { FONT_MAP, hairline, radius, space, touch, type, useColors, useElevation, useTextScale } from '@/theme';

/**
 * "How many?" as the Blueprint stepper: − and + in soft blue squares either side of a typed number.
 * The box stays a text field (whole pieces or a decimal for materials); the buttons step by one and never below 1.
 * A label on the right of the title (`aside`, e.g. "2 in store") and the hint / error under the box.
 */
export function QtyStepper({
  label,
  value,
  onChange,
  decimal,
  hint,
  aside,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  decimal?: boolean;
  hint?: string;
  aside?: string;
  error?: string | null;
  placeholder?: string;
}) {
  const c = useColors();
  const k = useTextScale();
  const lift = useElevation('field');
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  const [focus, setFocus] = useState(false);

  const step = (by: number) => {
    const now = parseQty(value);
    // a count stored in thousandths: one step is one whole piece / unit
    const next = Math.max(1000, (now ?? 0) + by * 1000);
    Haptics.selectionAsync().catch(() => {});
    onChange(formatQty(next));
  };
  const now = parseQty(value);
  const atMin = now != null && now <= 1000;

  const edge = error ? c.danger : focus ? c.primary : c.border;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
        <Label text={label} onPress={() => ref.current?.focus()} />
        {aside ? (
          <Txt variant="caption" weight="semibold" color="textMuted" numeric>
            {aside}
          </Txt>
        ) : null}
      </View>
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: touch + 4,
            padding: space.xs + 2,
            gap: space.sm,
            borderRadius: radius.md,
            borderWidth: focus || error ? 1.5 : hairline,
            borderColor: edge,
            backgroundColor: c.field,
          },
          lift,
          error ? { shadowColor: c.danger, shadowOpacity: 0.18, shadowRadius: 6 } : null,
        ]}>
        <StepButton icon="minus" label={`${label} −1`} disabled={atMin} onPress={() => step(-1)} />
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
          placeholder={placeholder}
          placeholderTextColor={c.placeholder}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          maxFontSizeMultiplier={1.2}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: touch - 8,
            textAlign: 'center',
            paddingVertical: 0,
            color: c.text,
            fontSize: (value ? type.title + 2 : type.body) * k,
            fontFamily: value ? FONT_MAP.en.bold : FONT_MAP.en.regular,
            fontVariant: ['tabular-nums'],
          }}
        />
        <StepButton icon="plus" label={`${label} +1`} onPress={() => step(1)} />
      </View>
      <HelperText error={error} hint={hint} />
    </View>
  );
}

function StepButton({ icon, label, onPress, disabled }: { icon: 'minus' | 'plus'; label: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  const Icon = icon === 'minus' ? Minus : Plus;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.md - 4,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: disabled ? c.surface2 : pressed ? c.primarySoft2 : c.primarySoft,
      })}>
      <Icon size={20} color={disabled ? c.placeholder : c.primary} strokeWidth={2.4} />
    </Pressable>
  );
}
