# Responsive, smooth, every Android phone

The app must look right and feel quick on every Android phone the site staff carry: a 5-inch budget phone at 320 dp wide, a large 430 dp phone, a phone with the display size set small or large, a foldable, and a 10-inch tablet in the site office. Sources: Android window size classes (developer.android.com, adaptive layouts), React Native FlatList performance guidance (reactnative.dev "Optimizing FlatList configuration"), Android UX pathway (edge-to-edge, predictive back), Emil Kowalski's motion rules (motion.md).

## 1. Sizes to design for

| Width class | dp | What changes |
|---|---|---|
| compact | < 600 | one column; this is the main design. Check 320, 360, 393 and 430 wide |
| medium | 600 to 839 | content column centred, max 640 wide, gutter 24; stat tiles stay in one row |
| expanded | 840 and up | same centred column (max 640) or two columns side by side where a list and its detail both make sense; never stretch rows across 1200 dp |

Height: under 480 dp (landscape phone, split screen) the sticky footers and big totals must still leave room for the list: footers scroll with the content when the window is that short.

Use `useLayout()` from `src/theme` for every decision (`gutter`, `maxWidth`, `narrow`, `stackTiles`, width class). Never read `Dimensions` directly; it does not update on rotation, folding or split screen.

## 2. Rules that keep layouts from breaking

- Flex, not fixed widths. A row is `flexDirection: 'row'` with one `flex: 1` child that may shrink (`flexShrink: 1`, `minWidth: 0`) and fixed-size neighbours.
- Every text that can be long (names, project titles, amounts in Sinhala/Tamil) has `numberOfLines` and a plan: wrap to 2 lines, truncate with an ellipsis, or shrink amounts with `adjustsFontSizeToFit` (minimum scale 0.7).
- Font scale: the phone's text size setting goes up to 2x. `Txt` caps each variant (`fontScaleMax`); test at 1.3 and 2.0. Nothing may overlap or be cut at 1.3.
- Display size: phones set to "small" display size (high density override, for example 352 instead of 440) get more dp per screen; phones set to "large" get fewer. Test 320 dp wide.
- Edge-to-edge: content goes behind the status and navigation bars. Use safe-area insets for padding and never assume the bottom inset is non-zero: full-screen-gesture phones (most Redmi / Xiaomi) report 0, so bottom bars keep a minimum of 12 dp.
- Keyboard: forms sit in the `Screen` keyboard-avoiding shell; the focused field and the Save button stay visible; long forms scroll.
- Touch: 48 dp minimum everywhere, 56 for primary actions, 8 dp between targets, at every width.

## 3. Smooth on slow phones

- Long lists use `FlatList` / `SectionList` (never `map` inside a ScrollView for lists that can grow past ~30 rows). Stable `keyExtractor`, memoised row components (`React.memo` / React Compiler), `renderItem` stable, `initialNumToRender` about 12, `windowSize` about 7 to 11, `maxToRenderPerBatch` about 8, `removeClippedSubviews` on Android, `getItemLayout` when rows have a fixed height.
- Queries do the work: filtering, sorting, sums and limits happen in SQL (`WHERE`, `ORDER BY`, `LIMIT`), not in JavaScript over all rows.
- Images: `expo-image` with fixed dimensions and caching; thumbnails, never full photos, in lists.
- Animate only transform and opacity, on the UI thread (Reanimated). No `setState` per frame.
- Heavy work (PDF, backup, import) shows a busy state at once and never freezes the screen; the button is disabled while it runs.
- Judge smoothness only in the release APK on a low-end phone. Expo Go and debug builds are slower.

## 4. Interaction that feels native

- Every tap answers within 100 ms: colour change plus the 0.97 press scale (buttons, chips), ripple or highlight on rows.
- Haptics: selection tick on taps, success or error notification after saves that move money; never on scroll.
- Saves say "Saved on phone" in a toast; deletes offer Undo where the data allows it.
- Back (button, gesture, predictive back) always works and never loses typed data without asking.
- Pull to refresh only where data can change outside the screen (import, backup); local lists update by themselves.
- Empty, loading and error states for every list; loading is usually instant (local database), so no skeletons unless something really takes time.
- Bottom sheets for choices and filters (one hand, thumb zone); destructive actions confirm and are never the primary colour.
