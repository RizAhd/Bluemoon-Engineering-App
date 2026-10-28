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
| See today's, this week's or this month's spending | **Today** tab → *Summary* → Day / Week / Month (‹ › for earlier) |
| See what needs paying | **Today** tab → *Wages to pay* |
| Make a price quotation for a client | ⚙ Settings → **Estimates** |
| Send a project to another phone | Project → *Export PDF* |

**Everything is per project.** The name at the top of each screen is the site you are working on.
Tap it to change site. "All projects" shows everything together.

## 2. First time

1. **Backups first** (2 minutes, once): ⚙ Settings → **Backup** → *Where copies are kept* → choose a **folder on
   this phone**, then **Connect Google Drive** with your Gmail. From then on copies are made by themselves.
2. ⚙ Settings → **Company and bank details**: check the company details and add the bank name and account
   number (they are printed on estimates). Optional: turn on **App lock** (PIN).
3. Open **Projects** → *New project*. Enter the name, the client, and the contract value.
4. Open **Workers** → *Add worker to project*. Pick someone or create a new worker, and set their daily rate **for this site**. The same person can have a different rate on another site.
5. That is all. From now on use **Workers → Today's work & pay** each day.

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
| Copy of all records | **Every day**, automatically (again the same day if you add records) | Inside the app, last **25 days** |
| The same copy | Right after it is made | The **folder on this phone** you chose (stays even if the app is removed), last 30 |
| The same copy | Right after it is made, when there is internet | Your **Google Drive**, folder *Bluemoon Site Backups*, last 30 |
| Records copied to your Google account | About once a day, by Android | Google (needs Wi-Fi + charging) |
| Photos | Stay on the phone | See "Weekly photo backup" below |

**Backup → Run now** makes the copy straight away and sends it to the folder and Google Drive.

The **Today** screen tells you the state:
- green line **Records backed up today**: all good.
- amber card: photos have not been saved to Google Drive for 7 days. Do the weekly backup.
- red card: today's backup failed. Open the card and tap **Run now**. If it keeps failing, tell the developer.

### Weekly photo backup (2 minutes, every Monday)
**⚙ Settings → Backup → Back up now**. This saves records **and photos**. With a folder and Google Drive set up
it goes to both by itself; otherwise choose **Google Drive** in the share sheet. Turn on **Protect with a
password** to lock the file (write the password down: nobody can open the file without it).
Keep the file. If a phone is lost, this file brings everything back.

### Phone lost, broken, or replaced
1. Install the app on the new phone and sign in to the same Google account.
2. If the app opens empty: **⚙ Settings → Backup → Restore from backup** and choose the newest backup file from Google Drive.
3. Restoring never deletes anything. It only adds what is missing.

## 5. Two phones (for example owner and supervisor)

On the first phone: open the project → **Export PDF** → send it on WhatsApp **as a Document** (not as a photo).
Under the button there are two tick boxes. **Include photos** puts the bill and site photos inside the PDF, so the other phone gets them too (the file gets bigger). **On company letterhead** prints the report on the Bluemoon letterhead; leave it off for a plain report. Either way the other phone can import the PDF.
On the second phone: open the PDF in WhatsApp → **Share → Bluemoon Site**, or **⚙ Settings → Import PDF**.
It shows what will be added. Tap **Import now**. Importing the same PDF twice changes nothing.
A PDF made by another program (a supplier bill, a drawing) can be *attached* to a project, but its numbers are not read automatically.

## 6. If something goes wrong

- **A message says "Something went wrong"**: your records are safe. Tap **Try again**.
- **The app shows "The app hit a problem"**: tap **Try again**. If it happens again, tap **Share error log** and send it to the developer on WhatsApp.
- **Anytime**: ⚙ Settings → **Report a problem** → **Share error log**.
- **A number looks wrong**: open the worker or the project and check the history. Every change is recorded, and nothing is ever really deleted.

## 7. Languages and look

⚙ Settings → **Language**: English, සිංහල, தமிழ். **Appearance**: Light, Dark, or Automatic.
**Text size**: Small, Medium or Large (for everyone who finds the text too small or too big).
The Sinhala and Tamil words are a first version. Ask a Sinhala/Tamil speaker on site to read them and note anything that sounds wrong.

## 8. Good habits

- Enter things the same day. A photo of the receipt is the best proof.
- Never uninstall the app before taking a **full backup** (section 4). This also applies when a new build is signed with a different key: Android then asks you to uninstall first, and uninstalling deletes the phone's data.
- Keep about 1 GB of free space on the phone. Photos need room.
- Do not change the phone's date and time by hand: backups are named by date.
