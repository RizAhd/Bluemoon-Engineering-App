# Bluemoon Site — owner's guide

For the owner and site supervisors. No technical knowledge needed.
The developer's plan is in [PLAN.md](PLAN.md).

## 1. What the app does

One app for every site. Everything is saved **on the phone**, so it works with no signal.

| You want to… | Where |
|---|---|
| See all sites and what each has cost | **Projects** tab |
| Record a bill or receipt, with a photo | **+ Add** button → *New expense* |
| Mark who worked today and pay them | **Workers** tab → *Today's work & pay* |
| Give an advance, pay wages, see what is owed | **Workers** tab → tap a worker |
| Hand out or take back a tool, with a photo | **Tools** tab |
| Write what happened on site today | **+ Add** button → *New site note* |
| See today's spending and what needs paying | **Today** tab |
| Send a project to another phone | Project → *Export PDF* |

**Everything is per project.** The name at the top of each screen is the site you are working on.
Tap it to change site. "All projects" shows everything together.

## 2. First time

1. Open **Projects** → *New project*. Enter the name, the client, and the contract value.
2. Open **Workers** → *Add worker to project*. Pick someone or create a new worker, and set their daily rate **for this site**. The same person can have a different rate on another site.
3. That is all. From now on use **Workers → Today's work & pay** each day.

## 3. Every day (about 2 minutes)

**Today's work & pay** (Workers tab):
1. Tap each worker who worked today. Choose ½, 1, 1½ or 2 days. It is saved the moment you tap, so going back or changing the date never loses it.
2. The wage is filled in from the daily rate. Change it if needed.
3. To pay: type the amount in *Pay now* (the amount owed is shown under the box) and tap **Pay now** beside the name, or tap **Pay all · Rs …** to pay everyone what they are owed today. The app lists each name and amount and asks you to confirm before it records any money.
4. Tap **Save today** when you are done. You can open the sheet again later today, or pick yesterday, and fix a mistake. Nothing is entered twice. A worker you have marked as *left* is not ticked automatically.

Receipts: **+ Add → New expense** → take the photo → type the amount → pick the category → Save.

## 4. Your data is safe — what happens automatically

| What | How often | Where it is kept |
|---|---|---|
| Copy of all records | **Every day**, automatically | On the phone, last **25 days** (older ones are deleted for you) |
| Records copied to your Google account | About once a day, by Android | Google (needs Wi-Fi + charging) |
| Photos | Stay on the phone | See "Weekly photo backup" below |

The **Today** screen tells you the state:
- green line **Records backed up today**: all good.
- amber card: photos have not been saved to Google Drive for 7 days. Do the weekly backup.
- red card: today's backup failed. Open the card and tap **Run now**. If it keeps failing, tell the developer.

### Weekly photo backup (2 minutes, every Monday)
**Menu (top right) → Backup → Back up now** → choose **Google Drive**. This saves records **and photos** in one file.
Keep the file. If a phone is lost, this file brings everything back.

### Phone lost, broken, or replaced
1. Install the app on the new phone and sign in to the same Google account.
2. If the app opens empty: **Menu → Backup → Restore** and choose the newest backup file from Google Drive.
3. Restoring never deletes anything. It only adds what is missing.

## 5. Two phones (for example owner and supervisor)

On the first phone: open the project → **Export PDF** → send it on WhatsApp **as a Document** (not as a photo).
Under the button there are two tick boxes. **Include photos** puts the bill and site photos inside the PDF, so the other phone gets them too (the file gets bigger). **On company letterhead** prints the report on the Bluemoon letterhead; leave it off for a plain report. Either way the other phone can import the PDF.
On the second phone: open the PDF in WhatsApp → **Share → Bluemoon Site**, or **Menu → Import PDF**.
It shows what will be added. Tap **Import now**. Importing the same PDF twice changes nothing.
A PDF made by another program (a supplier bill, a drawing) can be *attached* to a project, but its numbers are not read automatically.

## 6. If something goes wrong

- **A message says "Something went wrong"**: your records are safe. Tap **Try again**.
- **The app shows "The app hit a problem"**: tap **Try again**. If it happens again, tap **Share error log** and send it to the developer on WhatsApp.
- **Anytime**: Menu → **Report a problem** → **Share error log**.
- **A number looks wrong**: open the worker or the project and check the history. Every change is recorded, and nothing is ever really deleted.

## 7. Languages and look

Menu → **Language**: English, සිංහල, தமிழ். Menu → **Appearance**: Light, Dark, or Automatic.
The Sinhala and Tamil words are a first version. Ask a Sinhala/Tamil speaker on site to read them and note anything that sounds wrong.

## 8. Good habits

- Enter things the same day. A photo of the receipt is the best proof.
- Never uninstall the app before taking a **full backup** (section 4). This also applies when a new build is signed with a different key: Android then asks you to uninstall first, and uninstalling deletes the phone's data.
- Keep about 1 GB of free space on the phone. Photos need room.
- Do not change the phone's date and time by hand: backups are named by date.
