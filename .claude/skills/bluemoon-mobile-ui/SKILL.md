---
name: bluemoon-mobile-ui
description: Mobile UI rules for the Bluemoon Site app (Expo / React Native). Use whenever you build, restyle, polish or review any screen, component, typography, spacing, motion or touch behaviour in this repo. Covers the type scale, 4 pt grid, touch targets, press feedback, animation rules, Sinhala/Tamil constraints and a pre-merge checklist.
---

# Bluemoon Mobile UI

Rules for every screen in this app. They come from five sources and are already mapped onto the tokens in `src/theme/tokens.ts`, so **use the tokens, never raw numbers or hex values**.

| Source | What we took from it |
|---|---|
| "Mastering Mobile UI" (Marcin G.) — the PDF in the project folder | type scale, line height, letter spacing, 4 pt grid, margins/gutters, 360×800 base frame |
| Impeccable (impeccable.style) | anti-pattern checks: one primary action, no nested cards, contrast ≥ 4.5:1, short feedback, small-target detector |
| Taste Skill (tasteskill.dev) | audit the screen first, keep what works, dual light/dark by default, no generic "template" look |
| Emil Kowalski's skills (emilkowal.ski/skill) | the animation frequency gate, durations, easing, press scale, spring and haptics rules (`animate-expo`) |
| App Motion (appmotion.design) and Uizze (uizze.com) | reference galleries only: checkbox, selection, delete, FAB, opening and morph patterns; screen/flow examples. They publish no rules, so copy the *feel*, not the pixels |

Brand: blue `#1D4ED8` on white (dark: `#7AA2FF` on `#0B1120`). Do not import another product's palette or fonts.

## 1. Type (Noto Sans / Sinhala / Tamil)

Use `<Txt variant=…>`; it already applies size, line height and tracking.

| Variant | Size / line | Tracking (Latin only) | Use |
|---|---|---|---|
| caption | 13 / 18 (20 Sinhala/Tamil) | +0.1 | labels, helper text, dates |
| body | 15 / 22 (24) | 0 | default text, rows, inputs |
| bodyLg | 17 / 24 (26) | −0.17 (−1 %) | section titles, button labels, input text |
| title | 18 / 26 (28) | −0.18 (−1 %) | card titles, stat values |
| heading | 22 / 30 (32) | −0.44 (−2 %) | screen titles |
| amount | 28 / 34 (34) | −0.56 (−2 %) | money |
| amountXl | 36 / 44 (44) | −0.72 (−2 %) | the one hero number |

- Headlines 1.2–1.4× line height, body 1.4–1.6×, captions 1.3–1.4×. Line heights are even numbers, on or next to the 4 pt grid.
- Nothing below 13 except tab labels (12 / 16). The PDF's floor for menu labels is 12. Native stack header titles use bodyLg (17).
- Icon sizes follow the text: 14 beside captions, 16–18 beside body, 20 in a 40 icon slot, 22 in icon buttons and the tab bar.
- Small text gets slightly *more* tracking, large text slightly *less*.
- **Sinhala and Tamil: no letter-spacing, no uppercase, +2 line height.** Tracking breaks conjunct shaping and clips stacked marks. `Txt` handles this; never set `letterSpacing` by hand.
- Money and counts use `numeric` (Latin tabular digits) in every language.

## 2. Grid and spacing

- 4 pt grid: `space.xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32 · xxxl 40`. Every margin, gap and size is a multiple of 4.
- Screen margin 16 (24 from 600 wide). Gap between cards 12–16. Gap inside a card 8–12.
- Design and check at **360 × 800** first (small Android), then grow.
- Group related things closer than unrelated things (proximity beats borders). One level of card only; never a card inside a card.

## 3. Touch

- Primary actions, inputs, FAB: 56. Everything else tappable: 48 minimum. Header icon buttons 44 with `hitSlop`.
- Leave 8 between neighbouring targets.
- One primary action per screen. Destructive actions are never primary-coloured and always confirm.
- Press feedback appears on press-in (colour change plus the small scale below) and the action commits on release.

## 4. Colour

- Blue means "you can act here / you are here". Slate means "you chose this". Green, amber and red mean good, at risk and bad, and always sit next to a word or icon.
- Text pairs ≥ 4.5:1, UI edges ≥ 3:1, in both schemes. No gradients as decoration. No opacity-based disabled states; use the disabled tokens.
- Dark mode is its own palette, not an inverted one.

## 5. Motion

Full detail in [motion.md](motion.md). The short version:

1. **Frequency gate first.** Tab switches, typing, toggles used all day: no animation. Press feedback: ≤ 150 ms. Sheets, toasts, dialogs: 150–250 ms. Success and empty states are the only place for a flourish.
2. Animate `transform` and `opacity` only. Never width, height, margin or top.
3. Ease-out for things that enter or leave (`Easing.bezier(0.23, 1, 0.32, 1)`), never ease-in. Exits are faster than entrances.
4. Press scale `0.97`, in 100 ms, release 180 ms. Use `usePressScale()` from `src/components/ui/PressScale.tsx`. List rows change colour instead of scaling.
5. Entrances start at 0.95–0.97 scale with opacity 0, never from scale 0.
6. Respect reduced motion: `useMotion().reduced` turns movement into a plain fade.
7. Haptics: selection tick on taps, success/error notification on results, once per action, never as the only feedback.

## 6. Pre-merge checklist

- [ ] Every number comes from a token; every colour from `useColors()`.
- [ ] Looks right at 360 × 800, at font scale 1.3, in light and dark, in English, Sinhala and Tamil.
- [ ] Long names and big amounts truncate or wrap without pushing neighbours (`numberOfLines`, `flexShrink`).
- [ ] Empty, loading, error and "too much data" states exist and say what to do next.
- [ ] Targets ≥ 48; labels for screen readers on icon-only buttons.
- [ ] Nothing animates that the user triggers dozens of times a day, beyond the press scale.
- [ ] `npm run check` and `npm test` pass.
