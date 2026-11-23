import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { Palette } from '@/theme';

import { Txt } from './Txt';

/**
 * A Blueprint amount: "Rs" small and the figure large, side by side on one baseline ("Rs 570,450").
 *
 * Two texts in a row, never one nested text: Android measures a nested line from its first (small) span and cuts
 * off the bottom of the large digits (a comma then reads as a full stop). The row is one element to a screen
 * reader, with the whole amount as its label. The figure's size steps down with its length instead of
 * adjustsFontSizeToFit, which with a line height also cuts digits on Android.
 *
 * `value` is a formatted amount ("Rs 570,450", "−Rs 4,200") or any figure ("2", "8 pcs").
 */
export function SplitAmount({
  value,
  size = 40,
  color = 'text',
  rsColor = 'textMuted',
  style,
}: {
  value: string;
  /** Size of the figure in dp for a short amount; longer amounts step down from it. */
  size?: number;
  color?: keyof Palette;
  rsColor?: keyof Palette;
  style?: StyleProp<ViewStyle>;
}) {
  const m = /^(−|-)?Rs\s?(.*)$/.exec(value);
  const figure = m ? m[2] : value;
  const fit = figure.length > 13 ? size * 0.7 : figure.length > 10 ? size * 0.8 : size;
  const fontSize = Math.round(fit);
  return (
    <View accessible accessibilityLabel={value} style={[{ flexDirection: 'row', alignItems: 'baseline', gap: Math.max(3, Math.round(size / 8)), maxWidth: '100%' }, style]}>
      {m ? (
        <Txt weight="bold" color={rsColor} numeric style={{ fontSize: Math.max(11, Math.round(fontSize * 0.45)), lineHeight: Math.round(fontSize * 1.25) }}>
          {`${m[1] ?? ''}Rs`}
        </Txt>
      ) : null}
      <Txt weight="bold" color={color} numeric numberOfLines={1} style={{ flexShrink: 1, fontSize, lineHeight: Math.round(fontSize * 1.25) }}>
        {figure}
      </Txt>
    </View>
  );
}
