# Bluemoon Site

Site management app for **Bluemoon Engineering (Pvt) Ltd**, Welimada. It works
fully offline on the phone: no server, no internet needed on site, no running
cost.

> Owner's guide (plain language, daily routine, backups): [docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md)
> Full product and engineering plan (roadmap, architecture, backend, security, costs, handover): [docs/PLAN.md](docs/PLAN.md)
> Design system and screen flows: [design-system/bluemoon-site/](design-system/bluemoon-site/)

## What it does

Everything is **per project**. The project selector in the header scopes every tab.

- **Projects** tab: all sites with status, cost and contract progress; a hub per project
- **Workers per project**: each site has its own roster and daily rates
- **Today's work & pay**: tick who worked (½ / 1 / 1½ / 2 days), pay the same day, fix yesterday
- **Expenses** per project, with photos of bills and receipts
- **Tools**: issue and return per project, who has what, with photo proof
- **Site notes**: daily notes, weather and photos
- **Project cost summary**: totals by category, labour, contract progress
- **Friendly errors**: every failure is logged, shown in the user's language, and shareable (Menu → Report a problem)
- **Sinhala, English and Tamil**, bright light theme and a true dark theme

## How the data stays safe

- All data lives in a SQLite database on the phone. Every save is a
  transaction, every change goes into an audit log, and nothing is ever
  hard-deleted.
- **Backup** writes all records and photos to `.zip` files (each checked with
  SHA-256) that you save to Google Drive from the share sheet. **Restore**
  merges and never deletes, so it is always safe to run.
- The Today screen warns when there has been no backup for 3 days.

## Sharing a project with a second phone (no internet needed)

1. Phone A: open a project, tap **Export PDF**, send it (WhatsApp as a
   *Document*, Bluetooth or Nearby Share).
2. Phone B: open the PDF with **Share → Bluemoon Site** or **More → Import PDF**.

The PDF is a normal report anyone can read. The full project data and photos are
embedded inside it as file attachments with a checksum, so the import is exact,
and importing the same PDF twice changes nothing.

## Development

```bash
npm install
npx expo run:android      # development build on a phone or emulator
npx tsc --noEmit          # typecheck
npx eslint src            # lint
```

Build an installable APK (no Play Store needed):

```bash
npx eas-cli@latest build -p android --profile preview
```

## Project layout

```
src/app/         screens (Expo Router)
src/components/  UI building blocks and design system
src/db/          SQLite schema, migrations, the single write path, validation
src/lib/         money, dates, photos, PDF hand-off, backup
src/i18n/        English, Sinhala, Tamil
src/theme/       colour, type and spacing tokens
```

The Sinhala and Tamil text are drafts. Have a native speaker check them
before rollout.
