import { Text, type TextProps } from 'react-native';

import { FONT_MAP, type, useColors, useFont, type Palette, type Weight } from '@/theme';

type Variant = keyof typeof type;

export interface TxtProps extends TextProps {
  variant?: Variant;
  weight?: Weight;
  color?: keyof Palette;
  /** Amounts and counts: Latin digits, equal-width so columns line up. */
  numeric?: boolean;
  center?: boolean;
}

export function Txt({ variant = 'body', weight = 'regular', color = 'text', numeric, center, style, ...rest }: TxtProps) {
  const c = useColors();
  const font = useFont();
  const size = type[variant];
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={1.6}
      style={[
        {
          color: c[color],
          fontSize: size,
          // Sinhala and Tamil need extra line height so marks above and below don't clip.
          lineHeight: Math.round(size * 1.5),
          fontFamily: numeric ? FONT_MAP.en[weight] : font(weight),
          fontVariant: numeric ? ['tabular-nums'] : undefined,
          textAlign: center ? 'center' : undefined,
        },
        style,
      ]}
    />
  );
}
