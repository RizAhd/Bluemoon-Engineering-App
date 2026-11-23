/**
 * Bluemoon design tokens — "Blueprint": a bright blue hero over cool white, navy ink.
 * Tuned for reading outdoors in sunlight. Every text/background pair meets
 * WCAG AA (4.5:1) and every UI edge meets 3:1 in both schemes (MASTER §2.2).
 * Components use these names, never raw hex values.
 *
 * Colour rule: blue = you can act here / you are here · navy (slate) = you chose
 * this · green / amber / red = good / at risk / bad, always next to a word or
 * icon · everything else is neutral.
 */

export const palette = {
  light: {
    bg: '#F4F6FB',
    card: '#FFFFFF',
    /** Text-field fill: white wells on the cool page, lifted by a soft shadow (elevation.field). */
    field: '#FFFFFF',
    text: '#0B1533',
    textMuted: '#5A6782',
    border: '#E6EBF3',
    borderStrong: '#7D8799',
    /** Pressed background of rows, tiles, chips, cards; Android ripple colour. */
    muted: '#EDF1F8',
    primary: '#2457F5',
    primaryPressed: '#1E4CDC',
    onPrimary: '#FFFFFF',
    /** Primary 50: icon slots, soft buttons, selected rows. */
    primarySoft: '#EEF3FF',
    /** Primary 100: avatar circles, a pressed soft button, quiet bar segments. */
    primarySoft2: '#DCE6FF',
    /** Solid primary buttons and the centre "+" (light: the primary itself). */
    fill: '#2457F5',
    fillPressed: '#1E4CDC',
    onFill: '#FFFFFF',
    /** Navy: selected chips, checkboxes, navy buttons. */
    slate: '#0A1B4D',
    onSlate: '#FFFFFF',
    success: '#0A7A47',
    successSoft: '#E3F5EB',
    warning: '#9A5500',
    warningSoft: '#FFF1DC',
    /** Amber: "out on site" bars and dots (decoration beside words, never text). */
    amber: '#F2A33A',
    danger: '#C93A2E',
    dangerSoft: '#FDECEA',
    /** The floating tab bar (navy in both schemes). */
    tabBar: '#0A1B4D',
    onTabBar: '#FFFFFF',
    onTabBarMuted: '#A9B6D9',
    /** Blueprint hero: bright blue with a faint site grid and a rounded bottom (gradient header → headerEnd). */
    header: '#1E4CDC',
    headerEnd: '#3466FF',
    /** Pressed icon button / pressed project pill on the hero. */
    headerDeep: 'rgba(255,255,255,0.26)',
    onHeader: '#FFFFFF',
    onHeaderMuted: 'rgba(255,255,255,0.82)',
    /** Translucent white boxes on the hero (project pill, chips, the second button). */
    headerSoft: 'rgba(255,255,255,0.14)',
    headerLine: 'rgba(255,255,255,0.24)',
    /** The hero is blue in both schemes, so what sits on it keeps one look: the white button and tiles, their navy words, the red chip. */
    heroWhite: '#FFFFFF',
    heroWhitePressed: '#DCE6FF',
    onHeroWhite: '#0A1B4D',
    heroDanger: '#C93A2E',
    heroDangerSoft: '#FDECEA',
    /** Icon slots, segmented track, slate-badge bg, disabled input/button bg, empty-state tile. */
    surface2: '#EEF1F7',
    /** Bottom sheets and dialogs. */
    surface3: '#FFFFFF',
    /** Hairline inside a card. */
    divider: '#EEF1F6',
    placeholder: '#6B778F',
    focusRing: 'rgba(36,87,245,0.28)',
    shadow: 'rgba(11,21,51,0.16)',
    overlay: 'rgba(10,27,77,0.55)',
    slatePressed: '#13286B',
    /** Toasts: the inverse of the page (dark on light, light on dark). */
    inverse: '#0A1B4D',
    onInverse: '#FFFFFF',
  },
  dark: {
    bg: '#070D1F',
    card: '#101A33',
    /** Dark text-field fill: a step lighter than the cards, so an input never melts into its card. */
    field: '#16223F',
    text: '#EAF0FF',
    textMuted: '#A1AFCC',
    border: '#23305A',
    borderStrong: '#6A7BA8',
    muted: '#1C2950',
    primary: '#82A4FF',
    primaryPressed: '#A3BCFF',
    onPrimary: '#070D1F',
    primarySoft: '#162450',
    primarySoft2: '#22357A',
    /** Dark: a deep, saturated blue with white text. The light `primary` above is for links and icons only. */
    fill: '#2F62FF',
    fillPressed: '#2457F5',
    onFill: '#FFFFFF',
    slate: '#2C4799',
    onSlate: '#FFFFFF',
    success: '#5BD08A',
    successSoft: '#11291C',
    warning: '#F5B443',
    warningSoft: '#2E2410',
    amber: '#F2A33A',
    danger: '#F9847A',
    dangerSoft: '#35191B',
    tabBar: '#0E1838',
    onTabBar: '#FFFFFF',
    onTabBarMuted: '#8C9CC4',
    header: '#1A3FB8',
    headerEnd: '#2550E0',
    headerDeep: 'rgba(255,255,255,0.22)',
    onHeader: '#FFFFFF',
    onHeaderMuted: 'rgba(255,255,255,0.80)',
    headerSoft: 'rgba(255,255,255,0.12)',
    headerLine: 'rgba(255,255,255,0.20)',
    /** The hero is blue in both schemes, so what sits on it keeps one look: the white button and tiles, their navy words, the red chip. */
    heroWhite: '#FFFFFF',
    heroWhitePressed: '#DCE6FF',
    onHeroWhite: '#0A1B4D',
    heroDanger: '#C93A2E',
    heroDangerSoft: '#FDECEA',
    surface2: '#18244A',
    surface3: '#131E3B',
    divider: '#1C2847',
    placeholder: '#8A98B8',
    focusRing: 'rgba(130,164,255,0.36)',
    shadow: 'rgba(0,0,0,0.45)',
    overlay: 'rgba(0,0,0,0.62)',
    slatePressed: '#34508C',
    inverse: '#E6EBF5',
    onInverse: '#070D1F',
  },
} as const;

export type Palette = { [K in keyof typeof palette.light]: string };

/** The FAB's edge in dark mode (the one translucent white allowed outside the photo viewer and the hero). */
export const fabEdgeDark = 'rgba(255,255,255,0.10)';

/** Full-screen photo viewer chrome: always black behind a photo, in both schemes. */
export const photoChrome = { bg: '#000000', fg: '#FFFFFF', control: 'rgba(255,255,255,0.92)' } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40 } as const;
/** sm: badges · md: buttons, fields, icon slots (14) · lg: cards (20) · xl: sheets and the hero's bottom (28). */
export const radius = { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/** Primary actions, inputs, FAB. */
export const touch = 56;
/** Every other tappable thing: icon buttons, chips, checkboxes, rows. */
export const touchMin = 48;

/** Hairlines are always 1 dp — 0.5 vanishes in sun. */
export const hairline = 1;

/** Screen gutter: 16, or 24 when the window is at least 600 wide. */
export const gutter = { base: 16, wide: 24, wideFrom: 600, contentMax: 640 } as const;

/**
 * Android window size classes (dp): compact under 600, medium 600 to 839, expanded from 840.
 * A window under `shortBelow` tall (landscape phone, split screen) lets sticky footers scroll with the content.
 */
export const windowClass = { mediumFrom: 600, expandedFrom: 840, shortBelow: 480 } as const;

/** FlatList / SectionList settings for lists that can grow (reactnative.dev "Optimizing FlatList configuration"). */
export const listTuning = { initialNumToRender: 12, maxToRenderPerBatch: 8, windowSize: 9 } as const;

/** Blueprint type scale: Meta 13 · Body 15 · Section 18 · Title 26 · Amount 28 / 40 (hero). */
export const type = {
  caption: 12.5,
  body: 14.5,
  bodyLg: 15.5,
  title: 18,
  heading: 26,
  amount: 28,
  amountXl: 40,
} as const;

/** Line height per variant: Latin, and taller for Sinhala / Tamil so marks never clip. */
export const lineHeight = {
  caption: { latin: 17, complex: 19 },
  body: { latin: 20, complex: 22 },
  bodyLg: { latin: 22, complex: 24 },
  title: { latin: 24, complex: 28 },
  heading: { latin: 32, complex: 36 },
  amount: { latin: 34, complex: 34 },
  amountXl: { latin: 48, complex: 48 },
} as const satisfies Record<keyof typeof type, { latin: number; complex: number }>;

/**
 * Letter spacing in dp, Latin text only (Sinhala / Tamil must stay at 0 or marks mis-shape).
 * Manrope is set tight at display sizes, as in the design.
 */
export const tracking = {
  caption: 0,
  body: 0,
  bodyLg: -0.15,
  title: -0.3,
  heading: -0.6,
  amount: -0.6,
  amountXl: -1,
} as const satisfies Record<keyof typeof type, number>;

/** How far system font scaling may enlarge each variant. */
export const fontScaleMax = {
  caption: 1.6,
  body: 1.6,
  bodyLg: 1.6,
  title: 1.3,
  heading: 1.3,
  amount: 1.2,
  amountXl: 1.2,
} as const satisfies Record<keyof typeof type, number>;

/** Tab-bar labels are the smallest text in the app. */
export const tabLabel = { size: 11.5, lineHeight: 14 } as const;

/** regular = Manrope 500 · semibold = 700 · bold = 800 (Noto 400 / 600 / 700 for Sinhala and Tamil). */
export type Weight = 'regular' | 'semibold' | 'bold';

/**
 * Shared motion timings so the whole app moves the same way. pressScale is for the FAB only;
 * buttons, chips and icon buttons shrink to controlPressScale (motion.md: 0.97 in 100 ms, back in 180 ms).
 */
export const motion = { fast: 100, base: 180, slow: 240, pressScale: 0.94, controlPressScale: 0.97 } as const;

/**
 * Depth. Light: soft, wide shadows lift white cards off the cool page. Dark: shadows do not read, so depth there
 * comes from lighter surfaces (card → field → sheet) and these return nothing.
 */
export const elevation = {
  field: { shadowColor: '#0B1533', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  card: { shadowColor: '#0B1533', shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  raised: { shadowColor: '#0B1533', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
} as const;

/** Sizes that recur across components, so screens don't invent their own. */
export const sizes = {
  iconSlot: 44,
  headerButton: 44,
  tabBar: 68,
  fab: 64,
  thumb: 96,
  /** Scroll padding under tab screens: the floating tab bar sits over the end of the list. */
  tabScrollBottom: 120,
  /** How far the first card overlaps the hero's rounded bottom. */
  heroOverlap: 40,
} as const;

/** Avatar circles: each name always gets the same soft colour (bg, fg), as in the Blueprint worker lists. */
export const avatarTones = {
  light: [
    ['#DCE6FF', '#1E4CDC'],
    ['#DDF3E8', '#0A7A47'],
    ['#ECE6FF', '#5B3BC4'],
    ['#FFE7D9', '#A84A12'],
    ['#DDEEF8', '#1D5F8C'],
  ],
  dark: [
    ['#22357A', '#C9D7FF'],
    ['#11291C', '#7FE0A8'],
    ['#2B2257', '#CFC2FF'],
    ['#3A2414', '#FFC9A6'],
    ['#132D40', '#A9D6F2'],
  ],
} as const;
