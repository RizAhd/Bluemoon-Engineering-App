# Bluemoon Site — visual system (MASTER)

Single source of truth for the app's look. Final values only. FLOWS.md says what each screen contains; this file says how every piece looks and behaves. Where this file and existing code disagree, this file wins.

Units are dp (RN logical pixels). Fonts: Noto Sans / Noto Sans Sinhala / Noto Sans Tamil at 400 / 600 / 700 (already loaded). Icons: `lucide-react-native` only.

## 1. Concept

**A white ledger with one blue.** Every screen is a bright white sheet on a faint neutral page, divided by 1 dp hairlines on an 8 dp rhythm. Blue appears only where the supervisor can act or where he *is*: the primary button, the FAB, the active tab, the "current project" mark, links and focus. Choices he has made (a chip, a segment, a checkbox) are shown in **ink** (`slate`), solid and dark, so they stay visible in direct sun. Money is the hero: large, near-black, tabular Latin digits; everything else steps back in grey and weight.

Base: Direction 1 ("Enterprise clarity") for its discipline — one hairline, constant border widths, strict weight ladder, elevation-by-surface dark theme. Grafted from Direction 3: minimum text size 14, ink selection, extended FAB with a label, brand blue `#1D4ED8` kept. Grafted from Direction 2: snackbar with an action (Undo / Retry), sheet grabber, list-style quick-add sheet, status bar follows the scheme.

The colour rule in one line: **blue = you can act here / you are here · ink = you chose this · green/amber/red = good / at risk / bad, always next to a word or icon · everything else is neutral.**

## 2. Tokens

### 2.1 Palette — `src/theme/tokens.ts`

All existing keys keep their names. **New keys (8): `surface2`, `surface3`, `divider`, `placeholder`, `focusRing`, `shadow`, `overlay`, `slatePressed`** — add to both schemes or `Palette` and `tsc` break. Meaning changes: `slate` is now the ink/selection colour (also toast bg and progress fill); `muted` now means *pressed*; `headerDeep` now means *pressed header control*; `header` is white.

| Key | Light | Dark | Use |
|---|---|---|---|
| bg | `#F7F8FA` | `#0B1120` | page behind cards |
| card | `#FFFFFF` | `#121A2A` | cards, list groups, inputs, header, tab bar |
| text | `#101828` | `#EDF1F7` | primary text, meaningful icons |
| textMuted | `#475467` | `#A3AEC2` | secondary text, labels, inactive tab, default icons |
| border | `#E4E7EC` | `#26304A` | the hairline: card edges, row dividers, header/tab-bar edge, progress track |
| borderStrong | `#7D8799` | `#67769F` | input / select / chip / secondary-button resting edge (≥ 3:1) |
| muted | `#E9ECF1` | `#253047` | pressed background of rows, tiles, chips, cards; Android ripple colour |
| primary | `#1D4ED8` | `#7AA2FF` | filled button, FAB, active tab, links, focus, "current" mark |
| primaryPressed | `#1E40AF` | `#9DBAFF` | pressed primary (lighter in dark, never darker) |
| onPrimary | `#FFFFFF` | `#0B1120` | text/icon on primary |
| primarySoft | `#E3ECFF` | `#1B2A4D` | active-tab pill, selected picker row, "Current" badge, action-entry icon slot |
| slate | `#344054` | `#E6EBF5` | ink: selected chip/segment/checkbox fill, toast bg, progress fill |
| onSlate | `#FFFFFF` | `#0B1120` | text/icon on ink |
| success | `#067647` | `#5BD08A` | settled, in store, backup ok |
| successSoft | `#E3F7EC` | `#11291C` | success badge / card bg |
| warning | `#93370D` | `#F5B443` | worker owes, tool out, > 85 % of contract |
| warningSoft | `#FEF0C7` | `#2E2410` | warning badge / card bg |
| danger | `#B42318` | `#F9847A` | we owe, over contract, delete, errors |
| dangerSoft | `#FEE4E2` | `#35191B` | danger badge / card / error toast bg |
| tabBar | `#FFFFFF` | `#121A2A` | tab bar |
| header | `#FFFFFF` | `#121A2A` | tab-screen and stack-screen header |
| headerDeep | `#E9ECF1` | `#253047` | pressed header icon button / pressed project pill |
| onHeader | `#101828` | `#EDF1F7` | header title, header icons |
| onHeaderMuted | `#475467` | `#A3AEC2` | header subtitle (date) |
| headerSoft | `#F2F4F7` | `#1A2334` | project pill resting bg |
| **surface2** | `#F2F4F7` | `#1A2334` | icon slots, segmented track, slate-badge bg, disabled input/button bg, empty-state tile |
| **surface3** | `#FFFFFF` | `#1F293B` | bottom sheets and dialogs (lighter than card in dark) |
| **divider** | `#EEF0F3` | `#1F2838` | hairline *inside* a card (between label rows) |
| **placeholder** | `#667085` | `#8A96AD` | input placeholder, disabled label text |
| **focusRing** | `rgba(29,78,216,0.28)` | `rgba(122,162,255,0.36)` | 2 dp ring outside a focused input/button |
| **shadow** | `rgba(16,24,40,0.18)` | `rgba(0,0,0,0.45)` | FAB shadow colour only (dark: unused, FAB gets a border) |
| **overlay** | `rgba(16,24,40,0.55)` | `rgba(0,0,0,0.62)` | scrim behind sheets |
| **slatePressed** | `#1D2939` | `#D0D5DD` | pressed selected chip/segment |

### 2.2 Contrast (WCAG 2.x, computed by `scratchpad/design/contrast-master.py`; re-run after any token edit)

Required: text ≥ 4.5:1, UI edges/fills ≥ 3:1. All pairs pass in both themes.

| Pair | Light | Dark |
|---|---|---|
| text / bg · text / card | 16.70 · 17.75 | 16.61 · 15.35 |
| text / surface2 · text / muted · text / surface3 · text / headerSoft | 16.11 · 14.99 · 17.75 · 16.11 | 13.89 · 11.63 · 12.88 · 13.89 |
| textMuted / card · bg · surface2 · muted · surface3 | 7.69 · 7.23 · 6.98 · 6.49 · 7.69 | 7.78 · 8.42 · 7.04 · 5.90 · 6.53 |
| placeholder / card · placeholder / surface2 | 4.97 · 4.51 | 5.84 · 5.28 |
| primary / card · bg · surface3 (links, active tab) | 6.70 · 6.31 · 6.70 | 6.99 · 7.57 · 5.87 |
| primary / primarySoft (Current badge, tab pill) · primary / headerSoft | 5.65 · 6.08 | 5.68 · 6.33 |
| onPrimary / primary · onPrimary / primaryPressed | 6.70 · 8.72 | 7.57 · 9.77 |
| onHeader / header · onHeaderMuted / header · onHeader / headerDeep | 17.75 · 7.69 · 14.99 | 15.35 · 7.78 · 11.63 |
| onSlate / slate (ink chip, toast) · onSlate / slatePressed | 10.46 · 14.70 | 15.75 · 12.77 |
| success / successSoft · warning / warningSoft · danger / dangerSoft (badges, alert cards) | 5.09 · 6.62 · 5.45 | 7.98 · 8.35 · 6.59 |
| success / card · warning / card · danger / card · danger / bg | 5.69 · 7.52 · 6.57 · 6.19 | 8.98 · 9.52 · 7.13 · 7.72 |
| textMuted / tabBar (inactive) · primary / tabBar (active) | 7.69 · 6.70 | 7.78 · 6.99 |
| UI borderStrong / card · bg · surface3 | 3.62 · 3.41 · 3.62 | 3.87 · 4.19 · 3.25 |
| UI progress fill on `border` track: slate · warning · danger | 8.44 · 6.07 · 5.30 | 10.95 · 7.16 · 5.37 |
| UI primary / bg (FAB edge) · slate / card (checkbox edge) | 6.31 · 10.46 | 7.57 · 14.55 |
| info only: card / bg · border / card · divider / card · surface3 / bg | 1.06 · 1.24 · 1.14 · 1.06 | 1.08 · 1.33 · 1.18 · 1.29 |

### 2.3 Other tokens (same file)

```ts
space  = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40 }        // xxxl is new
radius = { sm: 6, md: 10, lg: 12, xl: 16, pill: 999 }                        // was 8/12/16/24
touch  = 56            // primary actions, inputs, FAB
touchMin = 48          // new: every other tappable thing (icon buttons, chips, checkboxes)
type   = { caption: 14, body: 16, bodyLg: 18, title: 20, heading: 24, amount: 30, amountXl: 40 }  // caption was 13
motion = { fast: 100, base: 180, slow: 240, pressScale: 0.96 }               // pressScale: FAB only
```

## 3. Type scale

| Variant | Size | Weight | LH Latin | LH si/ta | Where |
|---|---|---|---|---|---|
| caption | 14 | 400; 600 for labels, badges, eyebrows | 20 | 22 | field labels, subtitles, badges, group labels, helper/error text, tab-bar caption rows |
| body | 16 | 400; 600 for names/titles | 24 | 26 | row titles (600), paragraphs, chip labels, row values (600 numeric), compact button labels (600) |
| bodyLg | 18 | 400; 600 | 26 | 28 | input text (400), button labels (600), section titles (600), stack header title (600) |
| title | 20 | 600; 700 numeric | 28 | 30 | sheet titles, stat values (700 numeric), empty-state titles |
| heading | 24 | 600 | 30 | 34 | tab-screen title only |
| amount | 30 | 700 | 36 | — (Latin) | amount input digits, the one hero number on Today, worker balance card |
| amountXl | 40 | 700 | 46 | — (Latin) | project cost-summary hero only; `letterSpacing -0.5` |

Tab-bar labels: 13 / 600, LH 18 (set in `tabBarLabelStyle`, not a Txt variant). Nothing else is smaller than 14.

**`Txt` implementation (`src/components/ui/Txt.tsx`)**
- Replace `lineHeight: Math.round(size * 1.5)` with a lookup `LINE_HEIGHT[variant][script]` where `script = numeric || lang === 'en' ? 'latin' : 'complex'` using the table above.
- `maxFontSizeMultiplier`: 1.6 for caption/body/bodyLg, 1.3 for title/heading, 1.2 for amount/amountXl. Tab labels and header titles 1.3.
- New prop `eyebrow?: boolean`: caption 14/600 `textMuted`; when `lang === 'en'` adds `textTransform: 'uppercase'` + `letterSpacing: 0.5`; for si/ta no transform, no tracking (they have no case and tracking breaks shaping). Used for stat-tile labels, group labels, card eyebrows ("TOTAL COST").
- `numeric` (existing): `FONT_MAP.en[weight]` + `fontVariant: ['tabular-nums']` + Latin line-heights, in every UI language. All amounts, counts and dates are `numeric`.
- Android `includeFontPadding` stays default for si/ta text; may be `false` only on `numeric` Latin runs.

**Weights.** 700 = money and hero numbers only (amounts, stat values). 600 = anything that names or acts (row title, label, button, chip when selected, section title, tab title). 400 = descriptive text. Never 700 on grey text. Never weight 300.

**Amounts.** `formatLKR` gives "Rs 12,500" (no decimals unless cents ≠ 0). In the amount input the "Rs" prefix is a separate `Txt` bodyLg/600 `textMuted` on the digits' baseline (`alignItems: 'baseline'`). One hero number per screen. Hero amounts use `adjustsFontSizeToFit` + `minimumFontScale 0.7`; row values never shrink — the title column is `flex: 1` and wraps, the value is `flexShrink: 0`. Negative money is never colour-only: show the word ("To pay", "Advance over", "Over contract") in a badge beside the number.

**Sinhala / Tamil.** Same sizes in all three languages; +2 line-height at every size (table). No uppercase, no letter-spacing, ever. Button and chip labels may wrap to 2 lines; never shrink text below the variant size except hero amounts.

## 4. Spacing, radius, layout

- **Gutter** 16; 24 when window width ≥ 600. Content max width 640 centred on tablets.
- **Vertical rhythm**: 8 inside a component · 12 between related items (stacked cards, two tiles) · 16 card padding · 24 between sections · 32 before a new topic. Everything on the 4 dp grid.
- **Alignment grid**: text inside cards starts at 32 from the screen edge (16 + 16); list-row text at 68 with an icon slot (16 + 40 + 12), 32 without; all values end at width − 32; header title at 16, flush with card edges.
- **Tab-screen header** (`TabHeader`): `paddingTop insets.top + 8`; row 1 = 44 tall: title heading 24/600 `onHeader` left, right slot = up to one screen action `IconButton` 44 + the **menu** `IconButton` 44 (always last); optional subtitle caption 14/600 `onHeaderMuted` under the title (gap 2, row grows to 64); 8 gap; row 2 = project pill 44 tall (omitted when `showProject={false}`); `paddingBottom 12`; 1 dp `border` bottom; **no corner radius, no margin below**. Height: `insets.top + 64` (no pill) / `+ 116` (pill) / + 20 with a subtitle.
- **Stack-screen header** (native, `_layout.tsx`): `headerStyle.backgroundColor = c.header`, `headerTintColor = c.text`, `headerTitleStyle = { fontFamily: font('semibold'), fontSize: 18, color: c.onHeader }`, `headerShadowVisible: false`, `headerBackButtonDisplayMode: 'minimal'`. Because a native header cannot draw a hairline, `Screen` renders a 1 dp `border` line as its first child (`hairlineTop`, default true; tab screens pass false).
- **Tab bar**: 64 + `insets.bottom`; 1 dp top `border`, `elevation 0`; five items; icon 24 inside a 56 × 32 pill (`primarySoft` when focused, transparent otherwise); label 13/600 4 below; active icon + label `primary`, inactive `textMuted`; ripple `muted`.
- **FAB**: extended — height 56, radius xl 16, padding 0 20, `Plus` 24 stroke 2.5 + label body 16/600 `onPrimary`, 8 gap; icon-only 56 × 56 radius 16 when window width < 360; right 16, bottom = tab-bar top + 16; light: shadow colour `shadow`, radius 8, offset y 4, elevation 4; dark: no shadow, 1 dp border `rgba(255,255,255,0.10)`. Hidden while the keyboard is open.
- **List rows**: min height 56 (one line) / 64 (title + subtitle) / 72 (+ badge); padding 12 vertical, 16 horizontal.
- **Forms**: label → 6 → field 56 → 6 → helper; 20 between fields; 24 before a new group (Photos, Note); multiline min 112; amount field 72. Sticky footer: `card` bg, 1 dp top `border`, padding 16, bottom `max(insets.bottom, 16)`, one primary 56 button.
- **Scroll padding**: tab screens `paddingBottom 96` (56 FAB + 16 + 24); stack screens with a footer 24; `Screen` default gap 16.
- **Hairlines are always 1 dp.** Never `StyleSheet.hairlineWidth` (0.5 vanishes in sun).

## 5. Components

States are written default / pressed / disabled / focus / error. Press feedback is a colour change (+ `android_ripple={{ color: c.muted }}` on rows and tabs); **no scale transform anywhere except the FAB** (0.96). Border widths never change on press or focus (focus is a ring *outside* the shape), so nothing shifts under the finger. Every `Pressable` has `accessibilityRole`; icon-only controls have `accessibilityLabel`.

**Header decision — white, for tab screens and stack screens alike.** Near-black on white is 17.8:1 against 6.7:1 for white-on-blue; dark status-bar icons on white are what Android 12+ system apps do; blue stays an accent, not wallpaper. `_layout.tsx`: `<StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />`; Android navigation bar colour = `tabBar`. The brand still shows: the pill's building icon, the active tab, the FAB and the primary button are brand blue.

**Project pill** (`ProjectPill`, extracted from `TabHeader` so `wage/today` and the Today chooser can reuse it): 44 tall (hitSlop 2 vertical → 48), `alignSelf: 'flex-start'`, `maxWidth: '100%'`, radius pill, bg `headerSoft`, 1 dp `border`, padding 0 14, gap 8; `Building2` 20 `primary` (`LayoutGrid` 20 `textMuted` for "All projects"); name body 16/600 `text`, 1 line ellipsis; `ChevronDown` 20 `textMuted`; pressed bg `headerDeep`; focus ring. `accessibilityLabel = "${t('chooseProject')}: ${name}"`. Opens `PickerSheet` (title `chooseProject`, items: "All projects" when `allowAll`, then projects with "location · status" subtitles; footer secondary `newProject`).

**IconButton** (`Button.tsx`): 48 × 48 (44 inside headers — `HeaderButton` becomes `IconButton size={44}` with `onHeader` icon and `headerDeep` pressed bg), radius half, icon 24 stroke 2 `text`; pressed bg `muted`; `hitSlop 4`; label required.

**Buttons** (`Button.tsx`): height 56 (`compact` 48), radius md 10, padding 0 20 (16 compact), 1 dp border always (transparent for primary/ghost), label bodyLg 18/600 (body 16/600 compact), icon 22 (20 compact) leading, gap 8, `numberOfLines 2`. Loading: label `opacity 0` + `ActivityIndicator` absolutely centred (width kept), `accessibilityState.busy`. Disabled never uses opacity.
- Primary: bg `primary`, label `onPrimary` / pressed `primaryPressed` / disabled bg `surface2`, label `placeholder` / focus ring 2 dp `focusRing`.
- Secondary: bg `card`, border `borderStrong`, label `text` / pressed bg `muted` / disabled border `border`, label `placeholder`.
- Ghost: bg transparent, label `primary` 600 / pressed bg `primarySoft` / disabled label `placeholder`. Compact when inline.
- Danger: bg `card`, border `danger`, label + icon `danger` / pressed bg `dangerSoft` / disabled border `border`, label `placeholder`. Confirmations stay native `Alert`; the destructive Alert button is last.
- Haptics: `selectionAsync` on press (existing).

**Inputs** (`Field`): label caption 14/600 `text` (stays `text` on error), optional marker " (optional)" caption 400 `textMuted`. Ring wrapper: `padding 2, radius 12, borderWidth 2, borderColor transparent`. Box: 56 tall, radius md, bg `card`, 1 dp `borderStrong`, padding 0 16, text bodyLg 18/400 `text`, `placeholderTextColor c.placeholder`. Focus: ring `focusRing` + box border `primary`. Error: box border `danger` + helper caption 14/600 `danger` with `AlertCircle` 16, `accessibilityLiveRegion="polite"`. Disabled: bg `surface2`, text `textMuted`, border `border`. Multiline: min 112, padding 12 16, `textAlignVertical: 'top'`. Hint: caption 400 `textMuted`. Validate on submit, never per keystroke.

**Amount input** (`AmountField`): same ring/box, height 72, padding 0 16; "Rs" bodyLg 18/600 `textMuted` baseline-aligned, gap 8; digits amount 30/700 `FONT_MAP.en.bold` tabular, `decimal-pad`, placeholder "0" `placeholder`; strips everything except `0-9.,` while typing; on blur re-formats with thousands separators (`formatAmount(parseCents(v))`) when valid; optional computed hint under the box (caption `textMuted`, e.g. "1 × Rs 3,500"); `compact` variant: 48 tall, no label, "Rs" body 16/600, digits bodyLg 18/700 (used in the work & pay rows). Error/focus/disabled as inputs. `autoFocus` only on new records.

**Chips** (`Chips`, single choice, wrap): 48 tall, radius pill, padding 0 16, 1 dp border, gap 8 both ways, `accessibilityRole="radio"` + `checked`. Default bg `card`, border `borderStrong`, label body 16/400 `text` / pressed bg `muted` / **selected bg `slate`, border `slate`, label 16/600 `onSlate`, `Check` 18 `onSlate` leading** / selected + pressed bg `slatePressed` / disabled label `placeholder`, border `border` (used for zero-count filters) / group error: helper caption `danger` under the group, chips unchanged. Options may carry a count: label "Out 3".

**Segmented** (new, `form.tsx`; 2–4 short options only, otherwise Chips): track 48 tall, bg `surface2`, radius md, padding 3; segments `flex: 1`, 42 tall, radius sm, label 16/600 (`numberOfLines 1`, `adjustsFontSizeToFit`, min scale 0.85); selected bg `slate` label `onSlate`; unselected label `text`, pressed bg `muted`; role radio.

**Checkbox** (new, `form.tsx`): 28 × 28 box, radius sm, 2 dp `borderStrong`, bg `card`; checked bg `slate`, border `slate`, `Check` 20 `onSlate` stroke 3; 48 × 48 hit area; `accessibilityRole="checkbox"` + `checked`; label is the row text beside it.

**Select field** (`SelectField`): Field box; value bodyLg 18/400 `text` or placeholder `placeholder`; trailing `ChevronDown` 20 `textMuted`; pressed bg `muted`; error/focus/disabled as inputs; opens `PickerSheet`.

**Search field** (new, `form.tsx`): 48 tall Field box, `Search` 20 `textMuted` leading, text body 16, clear `X` 20 button (44 hit) when non-empty, `returnKeyType="search"`, no label.

**Cards** (`Card`): bg `card`, radius lg 12, 1 dp `border`, padding 16, gap 12, no shadow in either theme. Tone cards (`tone="dangerSoft" | "warningSoft" | "successSoft"`): no border, icon 24 + text body 16/600 in the tone colour, at most one button (primary for danger, secondary otherwise). Tappable card: pressed bg `muted`. Card eyebrow: `Txt eyebrow`.

**List rows** (`ListRow`): sizes per §4. Icon slot 40 × 40, radius md, bg `surface2`, icon 22 `textMuted`; `iconTone` only when it means something: `warning` (tool out, slot bg `warningSoft`), `success` (slot `successSoft`), `danger`, or `primary` with slot `primarySoft` for an *action entry* row ("Today's work & pay", "New expense" in the quick-add sheet). Title body 16/600 `text` (2 lines); subtitle caption 14/400 `textMuted` (1 line, " · " separators); badge on its own line 4 below. Trailing: value body 16/600 numeric `text` (tone `danger`/`warning`/`success` only together with a badge) or `ChevronRight` 20 `textMuted` when there is no value. Pressed bg `muted` + ripple. Selected (pickers): bg `primarySoft` + `Check` 22 `primary`. Inactive worker: title `textMuted` + "Inactive" badge, full opacity. Avatar variant for workers: 40 circle `surface2` with initials caption 14/600 `textMuted` instead of an icon.

**ListCard**: radius lg 12, 1 dp `border`, bg `card`, `overflow: hidden`; 1 dp `border` dividers between rows inset to the text start (`inset` prop: 68 when rows have icons/avatars, 16 otherwise). 12 gap between ListCards; a group label (below) sits above each.

**Stat tiles** (`Stat`): bg `card`, 1 dp `border`, radius lg 12, padding 16, gap 4, min height 84; label `eyebrow`; value title 20/700 numeric, `adjustsFontSizeToFit`, tone `text` / `danger` / `success` / `warning`; optional second caption line (e.g. "6 workers"); tappable tiles show `ChevronRight` 16 `textMuted` at the top-right of the label row and press to bg `muted`; `accessibilityLabel = "label value"`. Two per row, gap 12, equal flex; three per row only for Earned / Advances / Paid; stack when width < 340.

**Badges** (`Badge`): height 24, radius sm 6, padding 0 8, caption 14/600, icon 16 stroke 2.4 gap 4, `alignSelf: 'flex-start'`. slate: bg `surface2`, text `textMuted` · primary: bg `primarySoft`, text `primary` (reserved for "current") · success / warning / danger: soft bg + tone text. Always text, never icon-only, never a pill.

**Progress bars** (`ContractBar`, `CategoryBars`): track 10 tall, radius 5, bg `border`; fill `slate`; `warning` above 85 %; `danger` at/over 100 % (fill clamps at 100 %, the "%" label turns `danger` 600, e.g. "112 %"); label row caption 14/600 numeric: "%" left, "Contract Rs …" right in `textMuted`. Category bars: 8 tall, fill `slate`, label body 16/400 left, value body 16/600 numeric right.

**Empty states** (`EmptyState`): 56 × 56 tile radius lg 12 bg `surface2` with icon 28 `textMuted`; title title 20/600 centred; hint body 16/400 `textMuted` centred, max width 320; one primary button 56 full width (16 gap); padding 40 vertical, 16 horizontal. `compact` prop (inside cards/sections): padding 24, tile 48 with icon 24, title bodyLg 18/600, button compact secondary. Never two blue buttons on screen: when a tab screen's empty state shows its own primary button, that button does exactly what the FAB does.

**Toast** (`ToastHost`; API `toast(text, opts?: { action?: { label: string; onPress: () => void }; tone?: 'neutral' | 'danger'; sticky?: boolean })`): bg `slate`, text body 16/600 `onSlate`, leading `CheckCircle2` 20 `onSlate`, radius md 10, min height 48, padding 12 16, max width width − 32, centred; action: label body 16/700 `onSlate` as a 44-tall Pressable, 16 gap from the text; danger tone: bg `dangerSoft`, 1 dp `danger` border, `AlertTriangle` 20 + text `danger`, action label `danger` 700, plus a 44 close `X`; bottom = `insets.bottom + 148` (clears tab bar + FAB; above form footers); enter `FadeInDown 180`, exit 120; durations: neutral 2500, with action 6000, `sticky` (danger + Retry) until tapped or closed; one at a time (new replaces old); `accessibilityLiveRegion="polite"`, never steals focus.

**Bottom sheets** (`PickerSheet`, `/add`): bg `surface3`, top radius xl 16, 1 dp top `border`, grabber 36 × 4 radius 2 `borderStrong` centred 8 from the top; header row 56: title title 20/600 + close `IconButton` 44; optional search field (shown when > 8 items); rows 56 (list-row spec, inset dividers; selected = `primarySoft` + `Check`); footer: padding 16, bottom `insets.bottom + 16`; scrim `overlay`; max height 75 %; scrim tap, swipe-down and the back button dismiss; a sheet with unsaved input confirms before dismissing (`Alert`, cancel first). Enter `SlideInDown 240` with scrim `FadeIn 150`; exit 160. No shadow in either theme.

**Date field** (`DateField`): label; one wrapping chip row: [Today] [Yesterday] [`Calendar` 18 + `formatDay(value)` numeric] — chip spec with ink selection; the calendar chip is selected when a custom date is chosen; tapping it opens the native picker. Future dates are allowed only where the screen says so (never in work & pay).

**Section titles** (`SectionTitle`): bodyLg 18/600 `text`, `accessibilityRole="header"`, marginTop 24 (0 when first), marginBottom 8; optional right action = compact ghost button or `IconButton` 44. **Group labels** (day headers in Expenses, "OUT (3)" in Tools, "ACTIVE (2)" in Projects): `Txt eyebrow`, paddingTop 20, paddingBottom 8, with the group total right-aligned (eyebrow, numeric); not sticky.

**Dividers**: 1 dp `border` between rows, under headers, above footers; 1 dp `divider` inside a card (e.g. between the hero amount and the contract bar). Never between cards (use 12 gap).

**Icons**: lucide only; stroke 2 (2.4 in badges, 2.5 FAB plus, 3 checkbox tick); sizes 24 tab bar / header / empty state, 22 buttons and row slots, 20 chevrons, chip and pill icons, 18 chip check, 16 badges and tile chevrons. An icon never carries status alone: it sits beside a word (badge, label or row text). Icon-only controls always have `accessibilityLabel`. Fixed vocabulary: Today `Sun` · Projects `Building2` · Expenses `Receipt` · Workers `HardHat` · Tools `Hammer` · Notes `NotebookPen` · work & pay `ClipboardCheck` · pay `Banknote` · advance `HandCoins` · work `CalendarCheck` · issue `ArrowUpFromLine` · return `ArrowDownToLine` · backup `ShieldCheck` · problem `Bug` · menu `Menu` · add worker `UserPlus` · all projects `LayoutGrid` · search `Search` · edit `Pencil` · delete `Trash2`.

**Photo strip** (`PhotoStrip`): label caption 14/600; thumbnails 96, radius md, 1 dp `border`, bg `surface2`, gap 8; two compact secondary buttons side by side (Take photo / Gallery); the full-screen viewer stays `#000` (photo chrome, the one allowed literal).

**Switch**: `trackColor { true: c.primary, false: c.borderStrong }`, `thumbColor c.card`; always in a 48-tall row with a 16/600 label on the left.

**Error screen** (`ErrorScreen`, new in `feedback.tsx`): full screen bg `bg`, padding 24, centred: 56 tile `surface2` with `AlertTriangle` 28 `danger`; title title 20/600 (`appCrashed`); body body 16/400 `textMuted` (`appCrashedBody`); buttons stacked, 12 gap: primary `tryAgain`, secondary `shareLog`, ghost `goHome`.

**Loading**: none for lists — `useQuery` is synchronous, so empty states may render immediately and there are no skeletons. Long operations (PDF, backup, photo copy) show the button's loading state and keep the screen interactive.

## 6. Dark theme rules

1. Never pure black. Elevation is expressed by lighter surfaces, not shadows: `bg #0B1120` < `card #121A2A` < `surface2 #1A2334` < `surface3 #1F293B` (sheets) < `muted #253047` (pressed). Pressed is always one step **lighter**.
2. Shadows are dropped (`elevation 0`, `shadowOpacity 0`); every edge is a 1 dp border: `border` on cards, `borderStrong` on inputs, `rgba(255,255,255,0.10)` on the FAB.
3. Accent lightened: `primary #7AA2FF` with **dark** text/icon (`onPrimary #0B1120`, 7.6:1) on filled buttons and the FAB. White on medium blue would fail. `primaryPressed #9DBAFF` is lighter, not darker.
4. Ink inverts: `slate #E6EBF5` with dark `onSlate`, so selected chips and the toast remain the highest-contrast elements on screen.
5. Text is off-white (`#EDF1F7`), muted `#A3AEC2`, placeholder `#8A96AD` — never `#FFFFFF`, never opacity-greys. Semantic colours are the lightened tints on deep soft tints listed in §2.1.
6. Photos keep their 1 dp border so white receipts do not glow; the viewer stays black.
7. Status bar light icons; Android navigation bar `tabBar`. Theme follows the system unless set in More (`theme_system | light | dark`).
8. No component hard-codes a hex. The theme flips only through `useScheme()`. Test every state in both themes; §2.2 is the gate.

## 7. Motion

- Tokens: `fast 100` (press colour, ripple), `base 180` (chip/checkbox change, toast in, divider fade), `slow 240` (screen push, sheet in); exits are 0.7 × enter (sheet 160, toast 120). `pressScale 0.96` is used by the FAB only.
- Easing: `Easing.out(Easing.cubic)` on enter, `Easing.in(Easing.cubic)` on exit, `Easing.inOut` for progress-bar width (`base`), linear nowhere else. No bounces or springs on content.
- Navigation: pushes `slide_from_right` 240 (existing); `wage/today` `slide_from_bottom` 240; `/add` fade + `SlideInDown 220`; tab switches are instant.
- Haptics: `selectionAsync` on button press and chip/checkbox change, `impactAsync(Medium)` on the FAB, `notificationAsync(Success)` after a save. Nothing on scroll or rows.
- Reduced motion (`AccessibilityInfo.isReduceMotionEnabled`): entering/exiting animations become 120 ms fades, press scale 1.
- Lists render immediately; no stagger, no shimmer, no blur. Only `opacity` and `transform` animate.

## 8. Do not

- No blue bands, blue page tints, blue card backgrounds, blue section titles, blue data bars, blue decorative icon slots. Blue = action/current only.
- No pale tint as the only sign of selection; selected = ink fill. No colour-only status; always a word or icon beside the colour.
- No opacity for disabled or inactive (`opacity: 0.45` / `0.6` vanish in sun). Use the tokens.
- No shadows under cards, no gradients, no glass/blur, no emoji, no filled-and-outline icon mixing.
- No border width that changes on press or focus; no scale transforms on rows, buttons, chips, tiles.
- No text under 14 except tab labels (13). No 0.5 dp hairlines. No uppercase or letter-spacing on Sinhala/Tamil.
- No radius above 16 except chips and the project pill (999). Badges are radius 6, never pills.
- No two filled blue buttons on one screen. No disabled primary button sitting on screen for long — hide or relabel it.
- No `Alert` for routine confirmations ("Saved"): use the toast. No toast under 2.5 s. No error text without a remedy.
- No hard-coded hex in components (except the photo viewer's `#000`/`#fff`).

## 9. Implementation map (who edits what)

1. `src/theme/tokens.ts`: palette values and the 8 new keys; `radius` 6/10/12/16/pill; `type.caption 14`; `space.xxxl 40`; `touchMin 48`; `motion` as §2.3.
2. `src/components/ui/Txt.tsx`: line-height table, `eyebrow`, per-variant `maxFontSizeMultiplier`.
3. `src/app/_layout.tsx`: status bar by scheme, white stack headers (18/600), routes in FLOWS §0, `ErrorScreen` boundary.
4. `src/app/(tabs)/_layout.tsx`: five tabs, 64 bar with pill, extended FAB with per-tab label/target, keyboard-hide.
5. `src/components/ProjectSwitcher.tsx`: white `TabHeader` with menu button + extracted `ProjectPill`.
6. `Button.tsx`, `form.tsx` (ring wrapper, ink chips, `Segmented`, `Checkbox`, `SearchField`, compact `AmountField`, sheet grabber on `surface3`), `layout.tsx` (`Screen hairlineTop`, `ListCard inset`, row sizes, `SectionTitle`/group label), `feedback.tsx` (`EmptyState` tile + `compact`, `Badge` radius 6, toast API, `ErrorScreen`), `Stats.tsx` (tile chevron, 10 dp track on `border`, slate fills).
7. Screens: `paddingBottom 96`; group labels; remove coloured borders, opacity hacks, scale transforms; delete moves to the header trash icon on forms.
8. After any token edit run `python -I scratchpad/design/contrast-master.py` and paste the table into §2.2.
