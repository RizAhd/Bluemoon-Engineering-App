"""Drive the Bluemoon Site app on a USB-connected Android phone, for manual audits (adb + uiautomator).

Setup: USB debugging on, phone unlocked, `adb devices` shows it. Optional env vars:
  ADB             full path to adb (default: $ANDROID_HOME/platform-tools/adb, else `adb` on PATH)
  ANDROID_SERIAL  the phone's serial when more than one device is attached
  SHOTS_DIR       where screenshots go (default: ./shots)

usage: python phone.py list [filter]          elements on screen with bounds (* = clickable)
       python phone.py tap "Label" [index]     tap the n-th element whose text / accessibility label contains Label
       python phone.py tapxy X Y               tap full-resolution pixel coordinates
       python phone.py type "text"             type ASCII text into the focused field
       python phone.py key CODE                send a key event (4 back, 66 enter, 67 delete)
       python phone.py shot NAME               screenshot -> SHOTS_DIR/NAME.png (+ NAME.s.png, 720 wide, if Pillow is installed)
       python phone.py front                   print which window is in front

Input is refused unless Bluemoon (or a system screen it opened: file / folder picker, Google sign-in) is in
front, so a script can never type into WhatsApp or the owner's other apps by mistake.

Gotcha: `key 66` injects a hardware Enter that bypasses the on-screen keyboard. Android then does not open
the number keypad when Next moves from a letters field into an amount field. Tap the keyboard's own Next
key (bottom right) to test what a real user sees.
"""
import os
import re
import shutil
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")

PACKAGE = "lk.bluemoonengineering.site"
ALLOWED_FRONT = (PACKAGE, "documentsui", "com.google.android.gms", "PopupWindow")


def adb_path() -> str:
    if os.environ.get("ADB"):
        return os.environ["ADB"]
    home = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if home:
        exe = os.path.join(home, "platform-tools", "adb.exe" if os.name == "nt" else "adb")
        if os.path.exists(exe):
            return exe
    return shutil.which("adb") or "adb"


ADB = adb_path()
SERIAL = os.environ.get("ANDROID_SERIAL")


def adb(*args: str, text: bool = True):
    cmd = [ADB, *(["-s", SERIAL] if SERIAL else []), *args]
    res = subprocess.run(cmd, capture_output=True, text=text, encoding="utf-8" if text else None, errors="replace" if text else None)
    return res.stdout


def front() -> str:
    return next((l.strip() for l in adb("shell", "dumpsys", "window").splitlines() if "mCurrentFocus" in l), "")


def guard() -> None:
    f = front()
    if not any(a in f for a in ALLOWED_FRONT):
        raise SystemExit(f"refusing input: Bluemoon is not in front ({f})")


NODE = re.compile(r'<node [^>]*?text="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?clickable="(true|false)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')


def nodes():
    for _ in range(3):
        adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
        xml = adb("exec-out", "cat", "/sdcard/ui.xml")
        if "<hierarchy" in xml:
            break
        time.sleep(1)
    else:
        raise SystemExit("could not read the screen (is the phone unlocked?)")
    out = []
    for m in NODE.finditer(xml):
        t, d, c, x1, y1, x2, y2 = m.groups()
        out.append((t, d, c == "true", int(x1), int(y1), int(x2), int(y2)))
    return out


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "list":
        f = args[0].lower() if args else ""
        for t, d, c, x1, y1, x2, y2 in nodes():
            label = t or d
            if label and f in label.lower():
                print(f"{'*' if c else ' '} [{x1},{y1}][{x2},{y2}] {label[:70]!r}")
    elif cmd == "tap":
        guard()
        want, idx = args[0].lower(), int(args[1]) if len(args) > 1 else 0
        hits = [n for n in nodes() if want in (n[0] or n[1]).lower()]
        if len(hits) <= idx:
            raise SystemExit(f"not found: {args[0]!r} (found {len(hits)})")
        t, d, _, x1, y1, x2, y2 = hits[idx]
        x, y = (x1 + x2) // 2, (y1 + y2) // 2
        adb("shell", "input", "tap", str(x), str(y))
        print(f"tapped {t or d!r} at {x},{y}")
    elif cmd == "tapxy":
        guard()
        adb("shell", "input", "tap", args[0], args[1])
    elif cmd == "type":
        guard()
        adb("shell", "input", "text", args[0].replace(" ", "%s"))
    elif cmd == "key":
        guard()
        adb("shell", "input", "keyevent", args[0])
    elif cmd == "shot":
        folder = os.environ.get("SHOTS_DIR", "shots")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{args[0]}.png")
        with open(path, "wb") as fh:
            fh.write(adb("exec-out", "screencap", "-p", text=False))
        try:
            from PIL import Image

            im = Image.open(path)
            w, h = im.size
            small = os.path.join(folder, f"{args[0]}.s.png")
            im.convert("RGB").resize((720, int(h * 720 / w))).save(small)
            print(small, f"(full size {w}x{h}; multiply its coordinates by {w / 720:g})")
        except ImportError:
            print(path)
    elif cmd == "front":
        print(front())
    else:
        raise SystemExit(__doc__)


main()
