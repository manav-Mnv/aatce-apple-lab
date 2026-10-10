# Kiosk setup on the lab iMac (or any Mac)

The kiosk is a native macOS app, **AATCE Kiosk.app**. It needs:

| Requirement | Detail |
|---|---|
| macOS | **13 Ventura or newer** (Intel or Apple silicon) |
| Camera | built-in FaceTime camera or any USB webcam |
| Network | internet access to `script.google.com` (works offline for a while — scans are queued) |
| From [SETUP.md](SETUP.md) | the **web app URL** (`…/exec`) and the **`KIOSK_SECRET`** |
| Face model | `FaceNet` Core ML model — already inside the app if you use option A |

---

## 1. Get the app

### Option A — download the ready-made app (recommended, no tools needed)
1. On GitHub: **Actions → Kiosk release** → open the latest run with a green tick.
   (No run yet? Merge the branch to `master`, or open the workflow and click **Run workflow**.)
2. At the bottom, **Artifacts → `AATCE-Kiosk`** → download. You get `AATCE-Kiosk.zip`, containing another `AATCE-Kiosk.zip` — double-click until you see **AATCE Kiosk.app**.
3. Drag **AATCE Kiosk.app** into **Applications**.
4. First launch — the app is signed for local use but not notarized by Apple, so macOS blocks a plain double-click once:
   - **macOS 13–14:** right-click the app → **Open** → **Open**.
   - **macOS 15+:** double-click it (it is blocked) → **System Settings → Privacy & Security** → scroll down → **Open Anyway** → enter your password.
   - Or, in Terminal, once: `xattr -dr com.apple.quarantine "/Applications/AATCE Kiosk.app"`

### Option B — build it yourself on a Mac
Needs Xcode (or `xcode-select --install`) and Python 3.11.
```bash
git clone https://github.com/manav-Mnv/aatce-apple-lab.git && cd aatce-apple-lab/ml-training
```
```bash
python3.11 -m venv .venv && source .venv/bin/activate && pip install -r requirements-export.txt --extra-index-url https://download.pytorch.org/whl/cpu
```
```bash
python -m src.export_coreml --output FaceNet.mlpackage --check
```
The last line should print `Lowest Core ML vs PyTorch cosine similarity: 1.000000` (≥ 0.999 passes).
```bash
cd ../macos-app && ./scripts/build-app.sh ../ml-training/FaceNet.mlpackage
```
The app is in `macos-app/build/AATCE Kiosk.app` (and zipped next to it).

### Option C — developer run (no app bundle)
```bash
mkdir -p ~/Library/Application\ Support/AATCEKiosk && cp -R ml-training/FaceNet.mlpackage ~/Library/Application\ Support/AATCEKiosk/
```
```bash
cd macos-app && swift run AATCEKiosk
```
Runs in a window (not full screen). The camera permission is asked for Terminal.

---

## 2. First launch
1. **Camera access:** click **OK/Allow**. If you clicked *Don't Allow*: **System Settings → Privacy & Security → Camera → AATCE Kiosk → on**, then restart the app.
2. The screen says **"Kiosk setup needed"** — expected. Press **⌘ ,** (Settings):
   - **Web app URL:** the `…/exec` URL.
   - **Kiosk secret:** paste `KIOSK_SECRET`. It goes into the macOS Keychain and is never shown again (paste a new one to replace it).
   - **Workshop name** (optional): written next to non-member check-ins, e.g. `Intro to SwiftUI`.
   - **Match threshold:** leave **0.65** unless tuning (higher = stricter).
   - **Save.**
3. The kiosk shows **"Look at the camera"** and the status pill bottom-right reads **Online · N faces**.
   `0 faces` is normal until people enroll and/or the first retrain runs.

To try it without real Google resources, run `node backend/dev/server.js` on the same Mac and use
`http://localhost:8787/exec` with secret `dev-kiosk-secret`.

---

## 3. Make the iMac a proper kiosk
1. **Dedicated user:** System Settings → Users & Groups → **Add User** → *Standard* account `Lab Kiosk`. Do the steps below in that account.
2. **Log in automatically:** Users & Groups → **Automatically log in as: Lab Kiosk** (requires FileVault off).
3. **Start the app at login:** System Settings → General → **Login Items** → **+** → AATCE Kiosk.
4. **Never sleep:** System Settings → Displays / Energy (or Lock Screen) → *Turn display off* **Never**, *Prevent automatic sleeping* **on**; Screen Saver → **Never**.
5. **No pop-ups:** turn on a Focus (Do Not Disturb) permanently; turn off software update auto-restarts during lab hours.
6. **Full screen:** the installed app goes full screen by itself. `⌃⌘F` toggles it, `⌘Q` quits, `⌘,` opens Settings.
7. **Camera placement:** at eye level, light in front of the students (not a bright window behind them), about an arm's length away.

---

## 4. Using it
| Who | What happens |
|---|---|
| Enrolled student | Looks at the circle → "Hold still" → "Turn your head slightly" → **"Welcome, Alice · Checked in at 9:41"**. Next scan (after 2 min) → **"See you, Alice · Checked out · 1 h 40 min"**. |
| New student | **Enroll your face** → enrollment number → *Is this you?* (SCC members) or name + email (workshop attendees) → consent → look straight, then turn slightly → **"You're all set"**. Recognised immediately. |
| Not recognised / camera issue | **Enter enrollment number** → check in by number. These are marked *manual* for admins. |
| Network down | "Scan saved — it syncs automatically". The pill shows *N waiting to sync*. Nothing is lost if the Mac restarts. |

**Bulk enrollment day** (the ~150-student backlog): one student at a time at the kiosk takes ~30 s each — about 75 minutes for 150. Run **Actions → Retrain embeddings** afterwards so every kiosk gets everyone.

---

## 5. Updating the app
Download the newer `AATCE-Kiosk` artifact, quit the app (`⌘Q`), replace it in Applications, start it.
Settings, the Keychain secret, queued scans and local enrollments are kept
(they live in `~/Library/Application Support/AATCEKiosk/`).

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| "Face model not found" | You used a build without the model: use option A, or put `FaceNet.mlpackage` in `~/Library/Application Support/AATCEKiosk/` and restart. |
| "Backend URL or kiosk secret is not set" | ⌘, → fill both → Save. URL must start with `https://` (only `http://localhost` is allowed otherwise). |
| "Kiosk not authorised" | Wrong or rotated `KIOSK_SECRET` — paste the current one in Settings. |
| Pill says **Offline** | Check internet; open the web app URL in Safari — you should see a JSON `method_not_allowed` message. |
| Pill orange "needs attention" — *model mismatch* | The published embeddings were made with a different model version. Re-export the model / rebuild the app from the same commit as the pipeline. |
| Black camera circle | Another app is using the camera, or permission is off (see §2.1). |
| Recognises the wrong person | Raise the threshold (e.g. 0.70) in Settings; ask both students to re-enroll in good light. |
| Never recognises someone | Re-enroll them in good light; lower the threshold slightly (not below 0.60); check they appear after the next retrain. |
| "Let's try that again" | They didn't turn their head within 7 s — just a small turn to either side is enough. |
