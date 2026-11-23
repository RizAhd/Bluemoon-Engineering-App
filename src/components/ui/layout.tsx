import type { LucideIcon } from 'lucide-react-native';
import { Check, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react-native';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hairline, radius, sizes, space, touch, useColors, useElevation, useLayout, useScheme, type Palette } from '@/theme';

import { FocusChainProvider } from './focusChain';
import { Initials, initialsOf } from './kit';
import { Txt } from './Txt';

// ---------------------------------------------------------------- Screen

export interface ScreenProps {
  children: ReactNode;
  /** Wrap the body in a ScrollView (default). Pass false for FlatList / SectionList screens. */
  scroll?: boolean;
  /** Sticky footer: card bg, 1 dp top border, padding 16, bottom max(insets.bottom, 16). */
  footer?: ReactNode;
  padTop?: boolean;
  /** 1 dp hairline under the native header (stack screens). Tab screens pass false (TabHeader draws its own). */
  hairlineTop?: boolean;
  /** Scroll padding at the bottom. Default 24 with a footer, 96 (room for the FAB) without. */
  paddingBottom?: number;
  /** Extra scroll view props (refreshControl, onScroll, …). */
  scrollProps?: Omit<ScrollViewProps, 'children' | 'contentContainerStyle'>;
  /** Overrides the scroll content container. */
  contentStyle?: StyleProp<ViewStyle>;
  /** Vertical gap between children. Default 16. */
  gap?: number;
}

/**
 * Page shell: bg, gutter, safe padding, keyboard room, optional sticky footer.
 * On a window under 480 dp tall (landscape phone, split screen) a scrolling screen's footer moves to the end of
 * the content, so it scrolls with it instead of covering half the list. A `scroll={false}` screen places
 * `footer` itself when `useLayout().short` (see StickyFooter).
 */
export function Screen({ children, scroll = true, footer, padTop = true, hairlineTop = true, paddingBottom, scrollProps, contentStyle, gap = space.lg }: ScreenProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { gutter, column, short } = useLayout();
  const box = useRef<ComponentRef<typeof View>>(null);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  // where the list is scrolled to, so a focused field can be brought into view from its place on the screen
  const offset = useRef(0);
  const keyboard = useKeyboardInset(box, scroll ? scroller : undefined, offset);
  const inlineFooter = !!footer && scroll && short;
  const bottom = paddingBottom ?? (footer ? space.xl : sizes.tabScrollBottom);
  const body = scroll ? (
    <ScrollView
      ref={scroller}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      scrollEventThrottle={32}
      {...scrollProps}
      onScroll={(e) => {
        offset.current = e.nativeEvent.contentOffset.y;
        scrollProps?.onScroll?.(e);
      }}
      contentContainerStyle={[
        column,
        {
          paddingHorizontal: gutter,
          paddingTop: padTop ? space.lg : 0,
          gap,
          // with the keyboard up, extra room under the last field lets any field scroll clear of the footer
          paddingBottom: (inlineFooter ? Math.max(insets.bottom, space.lg) : bottom) + (keyboard > 0 ? space.xxxl * 3 : 0),
        },
        contentStyle,
      ]}>
      {children}
      {inlineFooter ? <View style={{ gap: space.sm, paddingTop: space.sm }}>{footer}</View> : null}
    </ScrollView>
  ) : (
    <View style={{ flex: 1 }}>{children}</View>
  );
  return (
    <FocusChainProvider reveal={() => revealFocused(scroller.current, offset.current)}>
      <View ref={box} collapsable={false} style={{ flex: 1, backgroundColor: c.bg, paddingBottom: keyboard }}>
        {hairlineTop ? <View style={{ height: hairline, backgroundColor: c.border }} /> : null}
        {body}
        {footer && !inlineFooter ? <StickyFooter keyboardOpen={keyboard > 0}>{footer}</StickyFooter> : null}
      </View>
    </FocusChainProvider>
  );
}

/**
 * How far the on-screen keyboard covers `box`, in dp (0 while it is closed). Edge-to-edge Android no longer
 * resizes the window for the keyboard, so screens lift their own content: the box is measured on the
 * display and only the part the keyboard really covers is given back as padding (a header above, a tab
 * bar below or a sheet all come out right). With `scroller`, the focused field is then scrolled into view.
 */
export function useKeyboardInset(
  box: RefObject<ComponentRef<typeof View> | null>,
  scroller?: RefObject<ComponentRef<typeof ScrollView> | null>,
  offset?: RefObject<number>,
): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => {
      const top = e.endCoordinates.screenY;
      const node = box.current;
      if (!node?.measureInWindow) return;
      node.measureInWindow((_x, y, _w, h) => {
        // measured without the padding this hook already added
        const covered = Math.max(0, Math.round(y + h - top));
        setInset((was) => (Math.abs(covered - was) < 1 ? was : covered));
        // after the new padding is laid out, or the field is scrolled against the old, taller viewport
        if (scroller) setTimeout(() => revealFocused(scroller.current, offset?.current ?? 0), 120);
      });
    });
    const hide = Keyboard.addListener(hideEvent, () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [box, scroller, offset]);
  return inset;
}

/**
 * Scroll so the focused text field sits well inside the visible part of `scroller` (about 100 dp under its
 * top, so its label shows above it and its hint and the next field below), when it is hidden or tight against
 * an edge. Both are measured on the screen, so it works whatever the field is nested in.
 */
function revealFocused(scroller: ComponentRef<typeof ScrollView> | null, scrolledTo: number) {
  const field = TextInput.State.currentlyFocusedInput?.() as unknown as ComponentRef<typeof View> | null;
  if (!scroller || !field?.measureInWindow) return;
  try {
    scroller.measureInWindow((_sx, sy, _sw, sh) => {
      field.measureInWindow((_x, y, _w, h) => {
        const room = space.xxxl + space.xl; // under the field: its hint and the start of the next one
        if (y >= sy + space.lg && y + h + room <= sy + sh) return; // already comfortably in view
        scroller.scrollTo({ y: Math.max(0, scrolledTo + y - sy - space.xxxl * 2.5), animated: true });
      });
    });
  } catch {
    // a field that is not on screen any more: nothing to do
  }
}

/** The sticky footer box of a Screen: card bg, 1 dp top border, padding 16, bottom max(insets.bottom, 16), content in the centred column. */
export function StickyFooter({ children, keyboardOpen }: { children: ReactNode; keyboardOpen?: boolean }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { gutter, column } = useLayout();
  return (
    <View
      style={{
        paddingHorizontal: gutter,
        paddingTop: keyboardOpen ? space.sm : space.lg,
        // above the keyboard the gesture area is not under the footer, so no safe-area padding there
        paddingBottom: keyboardOpen ? space.sm : Math.max(insets.bottom, space.lg),
        borderTopWidth: hairline,
        borderTopColor: c.border,
        backgroundColor: c.card,
        gap: space.sm,
      }}>
      <View style={[column, { gap: space.sm }]}>{children}</View>
    </View>
  );
}

// ---------------------------------------------------------------- Card

export type CardTone = 'dangerSoft' | 'warningSoft' | 'successSoft';

export interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Soft-tinted alert card: no border; pair the colour with an icon and words inside. */
  tone?: keyof Palette;
  /** Makes the whole card tappable (pressed bg `muted`). */
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Default 16. */
  padding?: number;
  /** Default 12. */
  gap?: number;
}

export function Card({ children, style, tone, onPress, accessibilityLabel, padding = space.lg + 2, gap = space.md }: CardProps) {
  const c = useColors();
  const lift = useElevation('card');
  const dark = useScheme() === 'dark';
  // Blueprint cards: white, 20 radius, a soft wide shadow and no edge in light; a 1 dp edge in dark, where shadows do not read.
  const base: ViewStyle = {
    backgroundColor: tone ? c[tone] : c.card,
    borderRadius: radius.lg,
    borderWidth: dark && !tone ? hairline : 0,
    borderColor: c.border,
    padding,
    gap,
    ...(tone ? null : lift),
  };
  if (onPress)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        android_ripple={{ color: c.muted }}
        style={({ pressed }) => [base, pressed ? { backgroundColor: c.muted } : null, style]}>
        {children}
      </Pressable>
    );
  return <View style={[base, style]}>{children}</View>;
}

/** 1 dp line. Inside a card use the default (`divider`); between rows use `strong` (`border`). */
export function Divider({ strong, inset = 0, style }: { strong?: boolean; inset?: number; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ height: hairline, backgroundColor: strong ? c.border : c.divider, marginLeft: inset }, style]} />;
}

// ---------------------------------------------------------------- titles

/** Section heading 18/800 with an optional count chip and a right action (compact ghost Button or IconButton 44). */
export function SectionTitle({ title, action, first, count }: { title: string; action?: ReactNode; first?: boolean; count?: number }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginTop: first ? 0 : space.sm, minHeight: 32 }}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Txt variant="title" weight="bold" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {title}
        </Txt>
        {count != null ? (
          <View style={{ minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: radius.sm, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Txt variant="caption" weight="semibold" color="textMuted" numeric>
              {count}
            </Txt>
          </View>
        ) : null}
      </View>
      {action}
    </View>
  );
}

/** Eyebrow label above a ListCard group ("ACTIVE (2)"), with an optional right-aligned numeric total. Not sticky. */
export function GroupLabel({ label, value, first }: { label: string; value?: string; first?: boolean }) {
  return (
    <View
      accessibilityRole="header"
      style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.sm, paddingTop: first ? 0 : space.xs, paddingBottom: 0 }}>
      <Txt eyebrow style={{ flexShrink: 1 }}>
        {label}
      </Txt>
      {value ? (
        // Same look as the eyebrow but never upper-cased: "Rs 704,750", not "RS 704,750".
        <Txt variant="caption" weight="semibold" color="textMuted" numeric>
          {value}
        </Txt>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- ListRow

export type IconTone = 'slate' | 'primary' | 'warning' | 'success' | 'danger';

function slotColors(c: Palette, tone: keyof Palette | undefined) {
  switch (tone) {
    case 'primary':
      return { bg: c.primarySoft, fg: c.primary };
    case 'warning':
      return { bg: c.warningSoft, fg: c.warning };
    case 'success':
      return { bg: c.successSoft, fg: c.success };
    case 'danger':
      return { bg: c.dangerSoft, fg: c.danger };
    // Blueprint: an icon slot is soft blue with a blue icon unless the row asks for another tone.
    case undefined:
      return { bg: c.primarySoft, fg: c.primary };
    case 'slate':
    case 'text':
    case 'textMuted':
      return { bg: c.surface2, fg: c.textMuted };
    default:
      return { bg: c.surface2, fg: c[tone] };
  }
}

/** Initials for an avatar circle: first letters of the first two words (a Sinhala / Tamil letter stays whole). */
export const initials = initialsOf;

export interface ListRowProps {
  icon?: LucideIcon;
  /** Only when it means something: `warning` (tool out), `success`, `danger`, `primary` (action entry). Anything else = neutral slot. */
  iconTone?: keyof Palette;
  /** Worker rows: 40 circle with these initials instead of an icon (pass the name; initials are computed). */
  avatar?: string;
  /** Anything else on the left (e.g. a Checkbox). */
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  /** Trailing numeric value (body 15/600). */
  value?: string;
  /** Only together with a badge that says why. */
  valueTone?: keyof Palette;
  /** Rendered on its own line under the subtitle. */
  badge?: ReactNode;
  /** Replaces the value / chevron on the right. */
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Picker rows: `primarySoft` bg + Check. */
  selected?: boolean;
  /** Inactive items: title in textMuted (never opacity). */
  muted?: boolean;
  disabled?: boolean;
  /** Hide the chevron on tappable rows without a value. */
  noChevron?: boolean;
  /** Collapsible group header: shows a chevron up (true) / down (false) after the value, and sets the expanded a11y state. */
  expanded?: boolean;
  accessibilityLabel?: string;
  /** Content below the row's main line (expanded rows). */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Tappable list row: icon slot or avatar, title + subtitle (+ badge), value or chevron on the right. */
export function ListRow({
  icon: Icon,
  iconTone,
  avatar,
  leading,
  title,
  subtitle,
  value,
  valueTone = 'text',
  badge,
  trailing,
  onPress,
  onLongPress,
  selected,
  muted,
  disabled,
  noChevron,
  expanded,
  accessibilityLabel,
  children,
  style,
  testID,
}: ListRowProps) {
  const c = useColors();
  const slot = slotColors(c, iconTone);
  const tappable = !!onPress || !!onLongPress;
  const collapsible = expanded != null;
  const ExpandIcon = expanded ? ChevronUp : ChevronDown;
  return (
    <Pressable
      testID={testID}
      disabled={!tappable || disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole={tappable ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: !!selected, disabled: !!disabled, ...(collapsible ? { expanded: !!expanded } : {}) }}
      android_ripple={tappable ? { color: c.muted } : undefined}
      style={({ pressed }) => [
        {
          minHeight: touch + 8,
          paddingVertical: space.md + 2,
          paddingHorizontal: space.lg,
          backgroundColor: pressed && tappable ? c.muted : selected ? c.primarySoft : c.card,
        },
        style,
      ]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        {leading}
        {avatar != null ? (
          <Initials name={avatar} size={sizes.iconSlot} />
        ) : Icon ? (
          <View style={{ width: sizes.iconSlot, height: sizes.iconSlot, borderRadius: radius.md, backgroundColor: slot.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={21} color={slot.fg} strokeWidth={1.9} />
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt variant="bodyLg" weight="semibold" numberOfLines={2} color={muted || disabled ? 'textMuted' : 'text'}>
            {title}
          </Txt>
          {subtitle ? (
            <Txt variant="caption" color="textMuted" numberOfLines={1}>
              {subtitle}
            </Txt>
          ) : null}
          {badge ? <View style={{ marginTop: 2 }}>{badge}</View> : null}
        </View>
        {trailing ??
          (collapsible ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 0, maxWidth: '55%' }}>
              {value ? (
                <Txt weight="semibold" numeric color={valueTone} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ flexShrink: 1 }}>
                  {value}
                </Txt>
              ) : null}
              <ExpandIcon size={18} color={c.textMuted} strokeWidth={2} />
            </View>
          ) : value ? (
            // A big amount never pushes the title out: it keeps at most about half the row and shrinks (to 70 %) before it would be cut.
            <Txt variant="bodyLg" weight="bold" numeric color={valueTone} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ flexShrink: 0, maxWidth: '55%' }}>
              {value}
            </Txt>
          ) : selected ? (
            <Check size={20} color={c.primary} strokeWidth={2.4} />
          ) : tappable && !noChevron ? (
            <ChevronRight size={18} color={c.textMuted} strokeWidth={2} />
          ) : null)}
      </View>
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------- ListCard

export interface ListCardProps {
  children: ReactNode;
  /**
   * Divider inset from the left: `true` = 68 (rows have icons/avatars), a number for custom,
   * default 16 (text-only rows). `false` hides dividers.
   */
  inset?: boolean | number;
  style?: StyleProp<ViewStyle>;
}

/** Groups list rows in one rounded card (20 radius, soft shadow) with 1 dp dividers inset to the text start. */
export function ListCard({ children, inset, style }: ListCardProps) {
  const c = useColors();
  const lift = useElevation('card');
  const dark = useScheme() === 'dark';
  const items = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  const left = inset === true ? 72 : inset === false ? -1 : typeof inset === 'number' ? inset : space.lg;
  return (
    // the shadow sits on the outer box: the inner one clips the rows to the rounded corners
    <View style={[{ borderRadius: radius.lg, backgroundColor: c.card }, lift, style]}>
      <View style={{ borderRadius: radius.lg, borderWidth: dark ? hairline : 0, borderColor: c.border, overflow: 'hidden', backgroundColor: c.card }}>
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 && left >= 0 ? <View style={{ height: hairline, backgroundColor: c.divider, marginLeft: left, marginRight: space.lg }} /> : null}
            {child}
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- Row

export function Row({ children, gap = space.sm, style, wrap = true }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

/** A caption-sized info line with a leading icon (backup status, "day already recorded", …). */
export function InfoLine({
  icon: Icon,
  text,
  tone = 'textMuted',
  onPress,
  accessibilityLabel,
}: {
  icon: LucideIcon;
  text: string;
  tone?: 'textMuted' | 'success' | 'warning' | 'danger';
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? text}
      // 44 tall to sit quietly in a list of cards; the hit area reaches 48
      hitSlop={{ top: 2, bottom: 2 }}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.xs,
        borderRadius: radius.sm,
        backgroundColor: pressed ? c.muted : 'transparent',
      })}>
      <Icon size={16} color={c[tone]} strokeWidth={2} />
      <Txt variant="caption" color={tone} style={{ flex: 1 }}>
        {text}
      </Txt>
      {onPress ? <ChevronRight size={14} color={c.textMuted} strokeWidth={2} /> : null}
    </Pressable>
  );
}
