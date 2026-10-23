/**
 * Bluemoon design tokens — "a white ledger with one blue".
 * Tuned for reading outdoors in sunlight. Every text/background pair meets
 * WCAG AA (4.5:1) and every UI edge meets 3:1 in both schemes (MASTER §2.2).
 * Components use these names, never raw hex values.
 *
 * Colour rule: blue = you can act here / you are here · slate (ink) = you chose
 * this · green / amber / red = good / at risk / bad, always next to a word or
 * icon · everything else is neutral.
 */

export const palette = {
  light: {
    bg: '#F3F5F8',
    card: '#FFFFFF',
    /** Text-field fill: white wells on the grey page, lifted by a soft shadow (elevation.field). */
    field: '#FFFFFF',
    text: '#101828',
    textMuted: '#475467',
    border: '#E4E7EC',
    borderStrong: '#7D8799',
    /** Pressed background of rows, tiles, chips, cards; Android ripple colour. */
    muted: '#E9ECF1',
    primary: '#1D4ED8',
    primaryPressed: '#1E40AF',
    onPrimary: '#FFFFFF',
    primarySoft: '#E3ECFF',
    /** Solid primary buttons and the FAB (light: the primary itself). */
    fill: '#1D4ED8',
    fillPressed: '#1E40AF',
    onFill: '#FFFFFF',
    /** Ink: selected chip/segment/checkbox fill, toast bg, progress fill. */
    slate: '#344054',
    onSlate: '#FFFFFF',
    success: '#067647',
    successSoft: '#E3F7EC',
    warning: '#93370D',
    warningSoft: '#FEF0C7',
    danger: '#B42318',
    dangerSoft: '#FEE4E2',
    tabBar: '#FFFFFF',
    header: '#FFFFFF',
    /** Pressed header icon button / pressed project pill. */
    headerDeep: '#E9ECF1',
    onHeader: '#101828',
    onHeaderMuted: '#475467',
    /** Project pill resting bg. */
    headerSoft: '#F2F4F7',
    /** Icon slots, segmented track, slate-badge bg, disabled input/button bg, empty-state tile. */
    surface2: '#F2F4F7',
    /** Bottom sheets and dialogs. */
    surface3: '#FFFFFF',
    /** Hairline inside a card. */
    divider: '#EEF0F3',
    placeholder: '#667085',
    focusRing: 'rgba(29,78,216,0.28)',
    shadow: 'rgba(16,24,40,0.18)',
    overlay: 'rgba(16,24,40,0.55)',
    slatePressed: '#1D2939',
    /** Toasts: the inverse of the page (dark on light, light on dark). */
    inverse: '#1D2939',
    onInverse: '#FFFFFF',
  },
  dark: {
    bg: '#0B1120',
    card: '#141E31',
    /** Dark text-field fill: a step lighter than the cards, so an input never melts into its card. */
    field: '#1A2439',
    text: '#EDF1F7',
    textMuted: '#A3AEC2',
    border: '#2A3552',
    borderStrong: '#67769F',
    muted: '#253047',
    primary: '#7AA2FF',
    primaryPressed: '#9DBAFF',
    onPrimary: '#0B1120',
    primarySoft: '#1B2A4D',
    /** Dark: a deep, saturated blue with white text. The light `primary` above is for links and icons only (a pale fill reads as disabled). */
    fill: '#2563EB',
    fillPressed: '#1D4ED8',
    onFill: '#FFFFFF',
    /** Dark: selected chips and segments are a calm blue, not a glaring white block. */
    slate: '#3D5A99',
    onSlate: '#FFFFFF',
    success: '#5BD08A',
    successSoft: '#11291C',
    warning: '#F5B443',
    warningSoft: '#2E2410',
    danger: '#F9847A',
    dangerSoft: '#35191B',
    tabBar: '#141E31',
    header: '#141E31',
    headerDeep: '#253047',
    onHeader: '#EDF1F7',
    onHeaderMuted: '#A3AEC2',
    headerSoft: '#1C2740',
    surface2: '#1C2740',
    surface3: '#1F293B',
    divider: '#1F2838',
    placeholder: '#8A96AD',
    focusRing: 'rgba(122,162,255,0.36)',
    shadow: 'rgba(0,0,0,0.45)',
    overlay: 'rgba(0,0,0,0.62)',
    slatePressed: '#34508C',
    inverse: '#E6EBF5',
    onInverse: '#0B1120',
  },
} as const;

export type Palette = { [K in keyof typeof palette.light]: string };

/** The FAB's edge in dark mode (the one translucent white allowed outside the photo viewer). */
export const fabEdgeDark = 'rgba(255,255,255,0.10)';

/** Full-screen photo viewer chrome: always black behind a photo, in both schemes. */
export const photoChrome = { bg: '#000000', fg: '#FFFFFF', control: 'rgba(255,255,255,0.92)' } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40 } as const;
export const radius = { sm: 6, md: 10, lg: 12, xl: 16, pill: 999 } as const;

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

export const type = {
  caption: 12,
  body: 14,
  bodyLg: 15.5,
  title: 17,
  heading: 20.5,
  amount: 26.5,
  amountXl: 34,
} as const;

/** Line height per variant (even numbers, near the 4 pt grid): Latin, and +2 for Sinhala / Tamil so marks never clip. */
export const lineHeight = {
  caption: { latin: 16, complex: 18 },
  body: { latin: 20, complex: 22 },
  bodyLg: { latin: 22, complex: 24 },
  title: { latin: 24, complex: 26 },
  heading: { latin: 28, complex: 30 },
  amount: { latin: 32, complex: 32 },
  amountXl: { latin: 42, complex: 42 },
} as const satisfies Record<keyof typeof type, { latin: number; complex: number }>;

/**
 * Letter spacing in dp, Latin text only (Sinhala / Tamil must stay at 0 or marks mis-shape).
 * Small text opens up slightly (+0.5 to 1 %), large text tightens (-1 % at 17-18, -2 % at 22+).
 */
export const tracking = {
  caption: 0.1,
  body: 0,
  bodyLg: -0.15,
  title: -0.16,
  heading: -0.38,
  amount: -0.48,
  amountXl: -0.62,
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

/** Tab-bar labels are the smallest text in the app (the PDF's floor for menu labels is 12). */
export const tabLabel = { size: 11, lineHeight: 14 } as const;

export type Weight = 'regular' | 'semibold' | 'bold';

/**
 * Shared motion timings so the whole app moves the same way. pressScale is for the FAB only;
 * buttons, chips and icon buttons shrink to controlPressScale (motion.md: 0.97 in 100 ms, back in 180 ms).
 */
export const motion = { fast: 100, base: 180, slow: 240, pressScale: 0.96, controlPressScale: 0.97 } as const;

/**
 * Depth. Light: soft shadows lift white surfaces off the grey page. Dark: shadows do not read, so depth there
 * comes from lighter surfaces (card → field → sheet) and these return nothing.
 */
export const elevation = {
  field: { shadowColor: '#101828', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  card: { shadowColor: '#101828', shadowOpacity: 0.05, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  raised: { shadowColor: '#101828', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
} as const;

/** Sizes that recur across components, so screens don't invent their own. */
export const sizes = {
  iconSlot: 40,
  headerButton: 44,
  tabBar: 64,
  fab: 56,
  thumb: 96,
  /** Scroll padding under tab screens: FAB 56 + 16 + 24. */
  tabScrollBottom: 96,
} as const;
