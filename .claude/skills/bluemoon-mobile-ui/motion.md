# Motion rules for React Native (Reanimated 4)

Distilled from Emil Kowalski's `animate-expo`, `emil-design-eng` and `mobile-native` skills, adapted to this app. Written in our own words; read the originals at github.com/emilkowalski/skill for the full text.

## Decide before you animate

| How often does the user see it? | Do |
|---|---|
| Hundreds of times a day (typing, tab switch, scroll, toggles) | nothing |
| Tens of times a day (press feedback, row selection) | ≤ 150 ms, or none |
| Occasionally (sheet, modal, toast, dialog) | standard 150–250 ms |
| Rarely (success, empty state, first run) | may delight |

Name the purpose in one word: feedback, spatial consistency, state, "prevent a jarring jump", explanation. If you cannot, do not animate.

## Tools, cheapest first

1. Colour or state change: swap the style (`Pressable` pressed callback).
2. Press scale or small transitions: `usePressScale()` (shared value + `withTiming`).
3. Mount / unmount / list reflow: layout animations (`entering`, `exiting`) as in `feedback.tsx` and `add.tsx`.
4. Anything a finger drives: shared value + `Gesture` + `useAnimatedStyle`, with a spring.
5. Screen transitions: the navigator's own options. Never hand-rolled. Tabs do not slide.

## Numbers

- Press-in 100 ms, release 180 ms, scale 0.97 (range 0.95–0.98).
- Toggle / chip / small state change: 150–200 ms.
- Sheet or toast in: 180–240 ms; out: 120 ms.
- Stagger (rare, decorative): 30–80 ms per item, never blocking input.
- Curves: strong ease-out `bezier(0.23, 1, 0.32, 1)`; on-screen movement `bezier(0.77, 0, 0.175, 1)`; iOS-style sheet `bezier(0.32, 0.72, 0, 1)`. Never `Easing.in`.
- Springs (finger involved only): settle `{ duration: 400, dampingRatio: 1 }`; snap back `{ duration: 400, dampingRatio: 0.8, velocity }`; sheet `{ duration: 300, dampingRatio: 0.8, velocity }`. Overshoot only if the gesture had momentum.

## Rules

- Animate `transform` and `opacity` only (exception: a childless absolute progress fill).
- Entrances start at scale 0.9–0.97 with opacity 0, never `scale(0)`. In a transform array put translate before scale.
- Never `setState` from a gesture or scroll handler; drive a shared value. Read and write shared values with `.get()` / `.set()` (React Compiler safe), not during render.
- Dismiss on velocity as well as distance, so a quick flick is enough. Add resistance at boundaries instead of a hard stop.
- Reduced motion: keep opacity and colour changes, remove translation, scale and overshoot. In this app: `useMotion().reduced`.
- Do not animate to fixed heights; font scaling breaks them. Measure with `onLayout` or animate a transform.
- Judge feel only on a release build on the slowest supported phone. Expo Go and emulators lie.

## Haptics (`expo-haptics`)

- `selectionAsync()` for taps on chips, buttons and steps.
- `impactAsync(Light)` for snaps and commits, `Medium` for heavy actions.
- `notificationAsync(Success | Error)` for the result of an operation.
- Fire on the same frame as the visual, once per action, never on scroll or unprompted. Never the only feedback. Always `.catch(() => {})`.

## Patterns worth copying from App Motion

Checkbox tick, selection highlight, delete (item leaves, neighbours close the gap), FAB opening into a sheet, number or state morph, success tick. Keep each under 300 ms and use ease-out.
