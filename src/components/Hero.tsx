/**
 * The Blueprint hero: the bright blue header with a faint site grid and a rounded bottom that opens most screens.
 *
 *   <Hero title="Expenses" actions={<HeroAction icon={Share2} … />} project card={<Card>…</Card>}>
 *     <HeroAmount label="All expenses" value={formatLKR(total)} />
 *     <HeroChips>…</HeroChips>
 *     <HeroButtons>…</HeroButtons>
 *   </Hero>
 *
 * Place it as the first child of a `Screen` (or a `CardList` header): it bleeds out of the screen's gutter and top
 * padding by itself. `card` is drawn half over the blue, half below it, as in the design. On a stack screen pass
 * `back` (a glass back button and a small centred title); tab screens get a large title on the left.
 * The status bar turns light while a hero screen is in front.
 */
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { setStatusBarStyle } from 'expo-status-bar';
import { ArrowLeft, type LucideIcon } from 'lucide-react-native';
import { Children, useCallback, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/Brand';
import { setHeroFocused } from '@/components/HeroStatusStrip';
import { ProjectPill } from '@/components/ProjectSwitcher';
import { IconButton } from '@/components/ui/Button';
import { SplitAmount } from '@/components/ui/SplitAmount';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { radius, sizes, space, useColors, useLayout, useScheme } from '@/theme';

/** The site grid: one faint line every 28 dp. */
const GRID = 28;
const GRID_LINES = 24;

export interface HeroProps {
  /** Large title on a tab screen; a small centred title next to the back button on a stack screen. */
  title?: string;
  /** Caption under a large title (today's date, "Your sites in one place"). */
  subtitle?: string;
  /** Stack screen: a glass back button on the left and the title centred. */
  back?: boolean;
  /** The Bluemoon mark in a white tile before the title (Today). */
  brand?: boolean;
  /** Glass icon buttons on the right of the title row (`HeroAction`). */
  actions?: ReactNode;
  /** The glass current-project bar under the title; `allowAll` offers "All projects". */
  project?: boolean | { allowAll?: boolean };
  /** A card that sits half over the blue (the first card of the screen). */
  card?: ReactNode;
  /** Centre the content (lock screen, backup). */
  center?: boolean;
  children?: ReactNode;
  /** Standalone above a list or screen (not inside the screen's padded scroll content): no bleed margins. */
  flush?: boolean;
}

export function Hero({ title, subtitle, back, brand, actions, project, card, center, children, flush }: HeroProps) {
  const c = useColors();
  const t = useT();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const { gutter, maxWidth } = useLayout();
  const [cardH, setCardH] = useState(0);

  // light status-bar icons over the blue while this screen is in front; back to the scheme's own when it leaves
  useFocusEffect(
    useCallback(() => {
      // set on the next frame: moving from one hero screen to another, the old screen's clean-up (dark) runs after this
      let shown = false;
      const id = setTimeout(() => {
        shown = true;
        setStatusBarStyle('light');
        setHeroFocused(true);
      }, 0);
      return () => {
        clearTimeout(id);
        if (shown) setHeroFocused(false);
        setStatusBarStyle(scheme === 'dark' ? 'light' : 'dark');
      };
    }, [scheme]),
  );


  // the blue reaches down to the middle of the overlapping card
  const blueBottom = card ? Math.max(0, cardH - sizes.heroOverlap) : 0;
  const hasBody = Children.toArray(children).length > 0;
  const allowAll = typeof project === 'object' ? project.allowAll !== false : true;

  const titleRow = back ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: sizes.headerButton, gap: space.md }}>
      <IconButton icon={ArrowLeft} label={t('back')} size={sizes.headerButton} tone="onHeader" shape="glass" pressedBg="headerDeep" onPress={() => router.back()} />
      <Txt variant="bodyLg" weight="bold" color="onHeader" accessibilityRole="header" numberOfLines={1} center style={{ flex: 1 }}>
        {title ?? ''}
      </Txt>
      {/* the actions, or an empty box the size of the back button, so the title stays centred */}
      <View style={{ minWidth: sizes.headerButton, flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm }}>{actions}</View>
    </View>
  ) : title != null || brand || actions ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: sizes.headerButton, gap: space.md }}>
      {brand ? (
        <View style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: c.heroWhite, alignItems: 'center', justifyContent: 'center' }}>
          <BrandMark size={36} scheme="light" />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {title != null ? (
          <Txt
            variant={brand ? 'title' : 'heading'}
            weight="bold"
            color="onHeader"
            accessibilityRole="header"
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={brand ? { fontSize: 19, lineHeight: 25 } : undefined}>
            {title}
          </Txt>
        ) : null}
        {subtitle ? (
          <Txt variant="caption" weight="semibold" color="onHeaderMuted" numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {actions ? <View style={{ flexDirection: 'row', gap: space.sm }}>{actions}</View> : null}
    </View>
  ) : null;

  return (
    <View style={flush ? undefined : { marginHorizontal: -gutter, marginTop: -space.lg }}>
      {/* the blue: gradient, grid, rounded bottom; it stops halfway down the overlapping card */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: blueBottom,
          borderBottomLeftRadius: radius.xl + 4,
          borderBottomRightRadius: radius.xl + 4,
          overflow: 'hidden',
          backgroundColor: c.header,
        }}>
        <LinearGradient colors={[c.header, c.headerEnd]} start={{ x: 0.1, y: 1 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <Grid />
      </View>

      <View
        style={{
          paddingTop: insets.top + space.md,
          paddingHorizontal: gutter,
          paddingBottom: card ? space.lg : space.xl + space.sm,
          gap: space.lg,
          width: '100%',
          maxWidth: maxWidth ? maxWidth + gutter * 2 : undefined,
          alignSelf: 'center',
          alignItems: center ? 'center' : undefined,
        }}>
        {titleRow}
        {project ? <ProjectPill allowAll={allowAll} variant="hero" /> : null}
        {hasBody ? <View style={{ gap: space.md, alignSelf: 'stretch', alignItems: center ? 'center' : undefined }}>{children}</View> : null}
      </View>

      {card ? (
        <View
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (h !== cardH) setCardH(h);
          }}
          style={{ paddingHorizontal: gutter, width: '100%', maxWidth: maxWidth ? maxWidth + gutter * 2 : undefined, alignSelf: 'center' }}>
          {card}
        </View>
      ) : null}
    </View>
  );
}

/** Faint white lines every 28 dp across the hero (plain views: no SVG needed, and cheap to draw). */
function Grid() {
  const lines = Array.from({ length: GRID_LINES }, (_, i) => (i + 1) * GRID);
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.07 }}>
      {lines.map((x) => (
        <View key={`v${x}`} style={{ position: 'absolute', top: 0, bottom: 0, left: x, width: 1, backgroundColor: '#FFFFFF' }} />
      ))}
      {lines.map((y) => (
        <View key={`h${y}`} style={{ position: 'absolute', left: 0, right: 0, top: y, height: 1, backgroundColor: '#FFFFFF' }} />
      ))}
    </View>
  );
}

/** A glass icon button for the hero's title row. */
export function HeroAction({ icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  return <IconButton icon={icon} label={label} size={sizes.headerButton} tone="onHeader" shape="glass" pressedBg="headerDeep" onPress={onPress} />;
}

/**
 * The big number of the hero: a small label, then "Rs" small and the amount large, side by side on one baseline.
 * Two texts, not one nested text: Android measures a nested line from its first (small) span and cuts the digits.
 * The row is one element for a screen reader ("Rs 570,450"). `value` is a formatted amount ("Rs 570,450",
 * "−Rs 4,200") or any figure ("2").
 */
export function HeroAmount({ label, value, caption, center }: { label?: string; value: string; caption?: string; center?: boolean }) {
  return (
    <View style={{ gap: 2, alignItems: center ? 'center' : 'flex-start', alignSelf: 'stretch' }}>
      {label ? (
        <Txt variant="body" weight="semibold" color="onHeaderMuted" numberOfLines={2} center={center}>
          {label}
        </Txt>
      ) : null}
      <SplitAmount value={value} size={40} color="onHeader" rsColor="onHeaderMuted" style={center ? { alignSelf: 'center' } : undefined} />
      {caption ? (
        <Txt variant="caption" weight="semibold" color="onHeaderMuted" center={center}>
          {caption}
        </Txt>
      ) : null}
    </View>
  );
}

/** A row of small glass chips under the amount ("3% of contract", "9 bills"). */
export function HeroChips({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{children}</View>;
}

export function HeroChip({ icon: Icon, label, tone }: { icon?: LucideIcon; label: string; tone?: 'danger' }) {
  const c = useColors();
  const danger = tone === 'danger';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 30,
        maxWidth: '100%',
        flexShrink: 1,
        paddingHorizontal: space.md - 2,
        borderRadius: radius.sm,
        backgroundColor: danger ? c.heroDangerSoft : c.headerSoft,
        borderWidth: danger ? 0 : 1,
        borderColor: c.headerLine,
      }}>
      {Icon ? <Icon size={14} color={danger ? c.heroDanger : c.onHeader} strokeWidth={2.2} /> : null}
      <Txt variant="caption" weight="semibold" numeric style={{ color: danger ? c.heroDanger : c.onHeader, flexShrink: 1 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </Txt>
    </View>
  );
}

/** Two buttons side by side on the hero: the first white (`kind="hero"`), the second glass (`kind="heroSoft"`). */
export function HeroButtons({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', gap: space.md, marginTop: space.xs }, style]}>
      {Children.toArray(children).map((ch, i) => (
        <View key={i} style={{ flex: 1 }}>
          {ch}
        </View>
      ))}
    </View>
  );
}

/** Glass number tiles on the hero (Projects: Active · Completed · On hold; Tools: In store · Out on site). */
export function HeroTiles({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: space.md }}>{children}</View>;
}

export function HeroTile({ label, value, caption, dot }: { label: string; value: string; caption?: string; dot?: string }) {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityLabel={`${label} ${value}${caption ? ` ${caption}` : ''}`}
      style={{ flex: 1, minWidth: 0, gap: 4, padding: space.md + 2, borderRadius: radius.md + 2, backgroundColor: c.headerSoft, borderWidth: 1, borderColor: c.headerLine }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {dot ? <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: dot }} /> : null}
        <Txt variant="caption" weight="semibold" color="onHeader" numberOfLines={1} style={{ flexShrink: 1 }}>
          {label}
        </Txt>
      </View>
      <Txt variant="heading" weight="bold" color="onHeader" numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Txt>
      {caption ? (
        <Txt variant="caption" color="onHeaderMuted" numberOfLines={1}>
          {caption}
        </Txt>
      ) : null}
    </View>
  );
}
