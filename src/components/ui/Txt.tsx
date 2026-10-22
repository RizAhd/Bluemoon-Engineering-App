import { Platform, Text, type TextProps } from 'react-native';

import { useLang } from '@/i18n';
import { FONT_MAP, fontScaleMax, lineHeight, tracking, type, useColors, useFont, type Palette, type Weight } from '@/theme';

export type TxtVariant = keyof typeof type;

export interface TxtProps extends TextProps {
  variant?: TxtVariant;
  weight?: Weight;
  color?: keyof Palette;
  /** Amounts, counts and dates: Latin digits, equal-width so columns line up, in every UI language. */
  numeric?: boolean;
  center?: boolean;
  /**
   * Small label above a stat, group or card ("TOTAL COST"): caption 13/600 textMuted,
   * uppercase + tracked in English only (Sinhala / Tamil have no case and tracking breaks shaping).
   */
  eyebrow?: boolean;
}

export function Txt({ variant, weight, color, numeric, center, eyebrow, style, maxFontSizeMultiplier, ...rest }: TxtProps) {
  const c = useColors();
  const font = useFont();
  const lang = useLang();
  const v: TxtVariant = variant ?? (eyebrow ? 'caption' : 'body');
  const w: Weight = weight ?? (eyebrow ? 'semibold' : 'regular');
  const col: keyof Palette = color ?? (eyebrow ? 'textMuted' : 'text');
  const size = type[v];
  const latin = numeric || lang === 'en';
  const lh = lineHeight[v][latin ? 'latin' : 'complex'];
  const upper = eyebrow && lang === 'en';
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? fontScaleMax[v]}
      style={[
        {
          color: c[col],
          fontSize: size,
          lineHeight: lh,
          fontFamily: numeric ? FONT_MAP.en[w] : font(w),
          fontVariant: numeric ? ['tabular-nums'] : undefined,
          textAlign: center ? 'center' : undefined,
          textTransform: upper ? 'uppercase' : undefined,
          // Latin only: Sinhala / Tamil must not be tracked or their marks mis-shape.
          letterSpacing: upper ? 0.5 : latin ? tracking[v] : undefined,
          // Sinhala / Tamil keep Android's font padding so marks never clip; Latin numbers may drop it.
          includeFontPadding: numeric && Platform.OS === 'android' ? false : undefined,
        },
        style,
      ]}
    />
  );
}
