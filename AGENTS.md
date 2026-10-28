# Bluemoon Site — instructions for coding agents and developers

Offline-first Expo / React Native app (Android) for Bluemoon Engineering (Pvt) Ltd: projects, expenses,
workers and wages, tools, site notes, estimates, backups. All data is in SQLite on the phone; no server.

## Start here

1. **[docs/HANDOVER.md](docs/HANDOVER.md)** — current state, code map, data rules, backups, how to build and
   test, the audit history and what is still open. Read it before changing anything.
2. [README.md](README.md) — short overview. [docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md) — how the owner uses it.
   [docs/PLAN.md](docs/PLAN.md) — roadmap and decision log. [docs/ESTIMATES.md](docs/ESTIMATES.md) — estimates.
3. Before touching any screen: [.claude/skills/bluemoon-mobile-ui/SKILL.md](.claude/skills/bluemoon-mobile-ui/SKILL.md)
   and [design-system/bluemoon-site/MASTER.md](design-system/bluemoon-site/MASTER.md).

## Project rules (do not skip)

- **Commits:** author is the developer, Riflan Mohamed, only. Do not add `Co-Authored-By` or any AI attribution
  to commits or PR descriptions. Push to `main` on github.com/RizAhd/Bluemoon-Engineering-App.
- **CI workflow:** do not edit `.github/workflows/android-apk.yml` unless the owner asks. An APK is built by
  pushing a tag `apk-<n>`; the result lands on the `ci-result` branch (HANDOVER.md section 7).
- **Signing:** builds use the debug key (SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`),
  which is registered for Google Drive sign-in. A different key cannot install over existing phones without
  wiping their data, and needs its own SHA-1 in Google Cloud.
- **Never ask for or print tokens or the git credential.**
- **Done means:** `npm run check` clean, the affected Jest files passing, and anything about keyboards, the
  "Discard changes?" prompt, sharing or native dialogs checked on a real phone (Jest mocks those).
- **Phone testing:** only send input while Bluemoon is in front (`scripts/device/phone.py` enforces it); never use
  the owner's personal photos; put back any display-size or font-scale setting you change.
- **Audits:** list every issue first, then fix them all, then build one APK and re-check. Do not build after each fix.
- **Strings:** every user-facing text in English, Sinhala and Tamil (`src/i18n/*.ts`).
- **Data:** money in integer cents, days as local `yyyy-mm-dd`, writes only through `src/db/repo.ts`, no hard deletes.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json` (SDK 58 at handover).
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

```bash
npx expo install <package>  # ALWAYS use instead of npm add — resolves SDK-compatible versions
npm run check               # tsc --noEmit && eslint src
npx jest                    # full suite, ~15 min; rerun a failing file alone before trusting the failure
npx jest <file> -t "<name>" # one file / one test
npx expo-doctor             # diagnose dependency and config issues
```

Do not run Prettier over whole files: the repo has no Prettier config, and it rewrites quotes and layout.

## Navigation & Routing

- **Expo Router**: routes live in `src/app/`; every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code outside `src/app/`.
- Import `Link`, `router`, `usePreventRemove` and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building

- **Use the tag workflow** (above). Local Gradle builds fail on the Windows PC (260-character path limit).
- EAS is the alternative: `npx eas-cli@latest login`, then `npm run build:apk`.
- The web build is not supported: SQLite, secure store, the file system and Google sign-in are native only.

## Native rules

- `android/` and `ios/` are generated (Continuous Native Generation). Never edit them; use `app.json` and the
  config plugins in `plugins/` (what each one does: HANDOVER.md section 9).
- Expo Go only includes its bundled native modules; this app needs a real build (APK) for Google sign-in,
  sharing into the app, background backup and Android Auto Backup.
- Prefer Expo modules over third-party libraries. Docs: https://docs.expo.dev/versions/latest/index.md
