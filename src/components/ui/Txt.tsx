import { Platform, Text, type TextProps } from 'react-native';

import { useLang } from '@/i18n';
import { FONT_MAP, fontScaleMax, lineHeight, tracking, type, useColors, useFont, useTextScale, type Palette, type Weight } from '@/theme';

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

/** Sinhala (U+0D80–0DFF) or Tamil (U+0B80–0BFF) letters. */
const COMPLEX = /[඀-෿஀-௿]/;

/**
 * Text with no Sinhala or Tamil letters in it (a name, "Lanka Hardware", "23 Oct 2026") is drawn in the Latin font
 * even in the Sinhala / Tamil UI: the Sinhala font's Latin letters have far wider word spaces.
 */
export function isLatinText(text: string): boolean {
  return !COMPLEX.test(text);
}

function latinOnly(children: TextProps['children']): boolean {
  if (typeof children === 'string') return !COMPLEX.test(children);
  if (typeof children === 'number') return true;
  if (Array.isArray(children)) return children.every((ch) => typeof ch === 'number' || (typeof ch === 'string' && !COMPLEX.test(ch)));
  return false;
}

export function Txt({ variant, weight, color, numeric, center, eyebrow, style, maxFontSizeMultiplier, ...rest }: TxtProps) {
  const c = useColors();
  const font = useFont();
  const lang = useLang();
  const k = useTextScale();
  const v: TxtVariant = variant ?? (eyebrow ? 'caption' : 'body');
  const w: Weight = weight ?? (eyebrow ? 'semibold' : 'regular');
  const col: keyof Palette = color ?? (eyebrow ? 'textMuted' : 'text');
  const size = type[v];
  const latinRun = !numeric && lang !== 'en' && latinOnly(rest.children);
  const latin = numeric || lang === 'en' || latinRun;
  const lh = lineHeight[v][latin ? 'latin' : 'complex'];
  const upper = eyebrow && lang === 'en';
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? fontScaleMax[v]}
      style={[
        {
          color: c[col],
          fontSize: size * k,
          lineHeight: Math.round(lh * k),
          fontFamily: numeric || latinRun ? FONT_MAP.en[w] : font(w),
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
