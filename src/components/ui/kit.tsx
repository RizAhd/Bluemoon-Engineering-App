/**
 * Tamagui components, dressed in Bluemoon tokens.
 *
 *   Toggle       on / off switch (Tamagui Switch), animated thumb, 48 dp hit area, haptic tick
 *   ToggleRow    a settings row: icon, title, hint, and the switch; the whole row toggles
 *   ProgressBar  how much of something is done (Tamagui Progress), colour by tone
 *   Initials     a round badge with the first letters of a name (Tamagui Avatar)
 *
 * Every piece works with or without the root TamaguiProvider: screens rendered on their own
 * (tests, previews) get a provider of their own, in the app's current light / dark theme.
 */
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { createContext, useContext, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Avatar, Progress, Switch, TamaguiProvider } from 'tamagui';

import { avatarTones, radius, space, touch, useColors, useScheme } from '@/theme';
import { tamaguiConfig } from '@/theme/tamagui.config';

import { Txt } from './Txt';

const Provided = createContext(false);

/** Mark the tree under the app's root provider, so the pieces below do not add their own. */
export function TamaguiScope({ children }: { children: ReactNode }) {
  const scheme = useScheme();
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
      <Provided.Provider value>{children}</Provided.Provider>
    </TamaguiProvider>
  );
}

function Ensure({ children }: { children: ReactNode }) {
  return useContext(Provided) ? children : <TamaguiScope>{children}</TamaguiScope>;
}

// ---------------------------------------------------------------- Toggle

const TRACK_W = 52;
const TRACK_H = 32;

export interface ToggleProps {
  value: boolean;
  onChange: (next: boolean) => void;
  /** What a screen reader says. */
  label: string;
  disabled?: boolean;
}

/** 52 × 32 switch: grey track when off, primary when on, a white thumb that slides across. */
export function Toggle({ value, onChange, label, disabled }: ToggleProps) {
  return (
    <Ensure>
      <Switch
        checked={value}
        disabled={disabled}
        onCheckedChange={(next: boolean) => {
          Haptics.selectionAsync().catch(() => {});
          onChange(next);
        }}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled: !!disabled }}
        hitSlop={8}
        // No padding or border on the track: Tamagui moves the thumb by (track width - thumb width), so anything
        // inside the track would push the thumb past its end. The 4 dp ring of the thumb is drawn in the track colour instead.
        width={TRACK_W}
        height={TRACK_H}
        borderRadius={TRACK_H / 2}
        padding={0}
        borderWidth={0}
        backgroundColor={disabled ? 'border' : value ? 'primary' : 'borderStrong'}>
        <Switch.Thumb
          transition="quick"
          width={TRACK_H}
          height={TRACK_H}
          borderRadius={TRACK_H / 2}
          borderWidth={4}
          borderColor={disabled ? 'border' : value ? 'primary' : 'borderStrong'}
          // white in both schemes: it reads on the grey (off) and the blue (on) track alike
          backgroundColor={(disabled ? '#E4E7EC' : '#FFFFFF') as never}
        />
      </Switch>
    </Ensure>
  );
}

/** A full-width settings row with a switch at the end. Tapping anywhere on the row flips it. */
export function ToggleRow({
  icon: Icon,
  title,
  hint,
  value,
  onChange,
  disabled,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={hint ? `${title}. ${hint}` : title}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onChange(!value);
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: touch + 8,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        backgroundColor: pressed ? c.muted : 'transparent',
      })}>
      {Icon ? (
        <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={21} color={c.primary} strokeWidth={1.9} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt weight="semibold" numberOfLines={2}>
          {title}
        </Txt>
        {hint ? (
          <Txt variant="caption" color="textMuted" numberOfLines={3}>
            {hint}
          </Txt>
        ) : null}
      </View>
      {/* The row owns the tap and the role; the switch is only the picture of the state. */}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Toggle value={value} onChange={onChange} label={title} disabled={disabled} />
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------- ProgressBar

export type ProgressTone = 'primary' | 'success' | 'warning' | 'danger';

/** 8 dp bar, rounded, filled 0–100 % in the tone's colour; the fill eases to a new value. */
export function ProgressBar({ value, tone = 'primary', label, height = 8 }: { value: number; tone?: ProgressTone; label: string; height?: number }) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const fill = { primary: 'primary', success: 'success', warning: 'warning', danger: 'danger' } as const;
  return (
    <Ensure>
      <Progress
        value={pct}
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
        height={height}
        borderRadius={height / 2}
        backgroundColor="surface2"
        overflow="hidden">
        <Progress.Indicator transition="medium" backgroundColor={fill[tone]} borderRadius={height / 2} />
      </Progress>
    </Ensure>
  );
}

// ---------------------------------------------------------------- Initials

/**
 * "Nimal Perera" → "NP", "Kamal" → "K": the first letter of the first two words.
 * Sinhala / Tamil names keep only the first letter, whole, so a vowel sign is never cut from its consonant.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (/^[A-Za-z0-9]/.test(words[0])) return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  // The first letter with the vowel signs, virama and joiner that belong to it (Sinhala U+0DCA–0DDF, Tamil U+0BBE–0BCD).
  const chars = Array.from(words[0]);
  let out = chars[0];
  for (let i = 1; i < chars.length && /[්-ෟா-்‍]/.test(chars[i]); i++) out += chars[i];
  return out;
}

/** The same soft colour for the same name, every time (a small string hash into `avatarTones`). */
function toneOf(name: string, scheme: 'light' | 'dark'): readonly [string, string] {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tones = avatarTones[scheme];
  return tones[h % tones.length];
}

/**
 * Round initials badge (Tamagui Avatar with a text fallback). Blueprint: each name has its own soft colour
 * (`neutral`, the default); `primary` where the circle is the thing to tap.
 */
export function Initials({ name, size = 44, tone = 'neutral' }: { name: string; size?: number; tone?: 'neutral' | 'primary' }) {
  const c = useColors();
  const scheme = useScheme();
  const [bg, fg] = tone === 'primary' ? [c.primarySoft2, c.primary] : toneOf(name, scheme);
  return (
    <Ensure>
      <Avatar circular size={size} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Avatar.Fallback backgroundColor={bg as never} alignItems="center" justifyContent="center">
          <Txt weight="bold" numeric style={{ color: fg, fontSize: Math.max(13, Math.round(size * 0.36)) }} numberOfLines={1}>
            {initialsOf(name)}
          </Txt>
        </Avatar.Fallback>
      </Avatar>
    </Ensure>
  );
}
