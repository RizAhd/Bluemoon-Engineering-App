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
    bg: '#F7F8FA',
    card: '#FFFFFF',
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
  },
  dark: {
    bg: '#0B1120',
    card: '#121A2A',
    text: '#EDF1F7',
    textMuted: '#A3AEC2',
    border: '#26304A',
    borderStrong: '#67769F',
    muted: '#253047',
    primary: '#7AA2FF',
    primaryPressed: '#9DBAFF',
    onPrimary: '#0B1120',
    primarySoft: '#1B2A4D',
    slate: '#E6EBF5',
    onSlate: '#0B1120',
    success: '#5BD08A',
    successSoft: '#11291C',
    warning: '#F5B443',
    warningSoft: '#2E2410',
    danger: '#F9847A',
    dangerSoft: '#35191B',
    tabBar: '#121A2A',
    header: '#121A2A',
    headerDeep: '#253047',
    onHeader: '#EDF1F7',
    onHeaderMuted: '#A3AEC2',
    headerSoft: '#1A2334',
    surface2: '#1A2334',
    surface3: '#1F293B',
    divider: '#1F2838',
    placeholder: '#8A96AD',
    focusRing: 'rgba(122,162,255,0.36)',
    shadow: 'rgba(0,0,0,0.45)',
    overlay: 'rgba(0,0,0,0.62)',
    slatePressed: '#D0D5DD',
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
  caption: 13,
  body: 15,
  bodyLg: 17,
  title: 18,
  heading: 22,
  amount: 28,
  amountXl: 36,
} as const;

/** Line height per variant (even numbers, near the 4 pt grid): Latin, and +2 for Sinhala / Tamil so marks never clip. */
export const lineHeight = {
  caption: { latin: 18, complex: 20 },
  body: { latin: 22, complex: 24 },
  bodyLg: { latin: 24, complex: 26 },
  title: { latin: 26, complex: 28 },
  heading: { latin: 30, complex: 32 },
  amount: { latin: 34, complex: 34 },
  amountXl: { latin: 44, complex: 44 },
} as const satisfies Record<keyof typeof type, { latin: number; complex: number }>;

/**
 * Letter spacing in dp, Latin text only (Sinhala / Tamil must stay at 0 or marks mis-shape).
 * Small text opens up slightly (+0.5 to 1 %), large text tightens (-1 % at 17-18, -2 % at 22+).
 */
export const tracking = {
  caption: 0.1,
  body: 0,
  bodyLg: -0.17,
  title: -0.18,
  heading: -0.44,
  amount: -0.56,
  amountXl: -0.72,
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

/** Tab-bar labels are the only text under 13 (the PDF's floor for menu labels is 12). */
export const tabLabel = { size: 12, lineHeight: 16 } as const;

export type Weight = 'regular' | 'semibold' | 'bold';

/**
 * Shared motion timings so the whole app moves the same way. pressScale is for the FAB only;
 * buttons, chips and icon buttons shrink to controlPressScale (motion.md: 0.97 in 100 ms, back in 180 ms).
 */
export const motion = { fast: 100, base: 180, slow: 240, pressScale: 0.96, controlPressScale: 0.97 } as const;

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
