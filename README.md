# Bluemoon Site

Site management app for **Bluemoon Engineering (Pvt) Ltd**, Welimada. It works
fully offline on the phone: no server, no internet needed on site, no running
cost.

## What it does

- **Expenses** per project, with photos of bills and receipts
- **Workers**: daily wages, advances and payments, with the balance owed
- **Tools**: issue and return, who has what and where, with photo proof
- **Site notes**: daily notes, weather and photos
- **Project cost summary**: totals by category, labour, contract progress
- **Sinhala, English and Tamil**, light and dark themes

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
