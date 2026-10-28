# Bluemoon Site

Site management app for **Bluemoon Engineering (Pvt) Ltd**, Welimada. It works
fully offline on the phone: no server, no internet needed on site, no running
cost.

> **New developer or coding agent? Start with [docs/HANDOVER.md](docs/HANDOVER.md)** (current state, code map,
> build and test, audit history, open items) and [AGENTS.md](AGENTS.md) (rules).
>
> Owner's guide (plain language, daily routine, backups): [docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md)
> Roadmap, architecture and decision log: [docs/PLAN.md](docs/PLAN.md) · Estimates: [docs/ESTIMATES.md](docs/ESTIMATES.md)
> Design system and screen flows: [design-system/bluemoon-site/](design-system/bluemoon-site/)

## What it does

Everything is **per project**. The project selector in the header scopes every tab; "All projects" shows them together.

- **Today**: a summary for the day, week or month (expenses, labour, total, per project), with ‹ › to go back
  to earlier periods; wages to pay, tools out, project cost, quick actions, recent activity
- **Projects**: all sites with status, cost and contract progress; a hub per project; PDF report
- **Workers per project**: each site has its own roster and daily rates; balance shows *To pay* or *Paid ahead*
- **Today's work & pay**: tick who worked (½ / 1 / 1½ / 2 days), pay the same day, fix yesterday
- **Expenses** per project, with photos of bills and receipts
- **Tools**: issue and return per project, who has what, with photo proof
- **Site notes**: daily notes, weather and photos
- **Estimates**: quotations with items, discount and tax, payment schedule, bank details, PDF on the company letterhead
- **Backups**: daily, to a folder on the phone and to Google Drive, plus a password-protected full backup
- **Sinhala, English and Tamil**, light and dark themes, Small / Medium / Large text, optional PIN lock
- **Friendly errors**: every failure is logged, shown in the user's language, and shareable (Settings → Report a problem)

## How the data stays safe

- All data lives in a SQLite database on the phone. Every save is a
  transaction, every change goes into an audit log, and nothing is ever
  hard-deleted.
- A **daily snapshot** of all records is made automatically (kept 25 days) and copied to a **folder on the
  phone** the owner chooses (survives uninstalling) and to the owner's **Google Drive** (30 kept in each).
- **Full backup** (records and photos, optionally password-locked) goes to the same places. **Restore**
  merges and never deletes, so it is always safe to run.
- The Today screen shows the backup state in green, amber or red.

## Sharing a project with a second phone (no internet needed)

1. Phone A: open a project, tap **Export PDF**, send it (WhatsApp as a
   *Document*, Bluetooth or Nearby Share).
2. Phone B: open the PDF with **Share → Bluemoon Site** or **Settings → Import PDF**.

The PDF is a normal report anyone can read. The full project data and photos are
embedded inside it as file attachments with a checksum, so the import is exact,
and importing the same PDF twice changes nothing.

## Development

```bash
npm install
npm run check        # typecheck + lint
npx jest             # tests (~15 minutes for the full suite)
```

### Getting an installable APK

Push a tag named `apk-<n>` (`git tag apk-15 && git push origin apk-15`). GitHub Actions builds the APK in
about 15 minutes and also puts it, with a `status.txt`, on the `ci-result` branch. Details and the signing
caveat: [docs/HANDOVER.md](docs/HANDOVER.md#7-building-an-apk). The workflow is
[.github/workflows/android-apk.yml](.github/workflows/android-apk.yml); EAS (`npm run build:apk`) also works.

The test builds are signed with the standard Android debug key. A later build signed with another key cannot be
installed over them: Android refuses, and the phone would have to uninstall first, which deletes its data. Take
a full backup first.

### UI rules

Screens follow [.claude/skills/bluemoon-mobile-ui](.claude/skills/bluemoon-mobile-ui/SKILL.md):
type scale, 4 pt grid, touch sizes and motion. Read it before changing any screen.

## Project layout

```
src/app/         screens (Expo Router)
src/components/  UI building blocks and design system
src/db/          SQLite schema, migrations, the single write path, validation
src/hooks/       data queries, form helpers, today's date
src/lib/         money, dates, wages, backup, Drive, phone folder, PDF, sharing, errors
src/i18n/        English, Sinhala, Tamil
src/theme/       colour, type and spacing tokens
plugins/         Expo config plugins (native settings)
scripts/         letterhead embedding, phone-testing helper
```

The Sinhala and Tamil text are drafts. Have a native speaker check them
before rollout.
