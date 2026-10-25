# 8nerve – "Ear & Balance" station (8th cranial nerve)

An offline exhibition station about hearing and balance. **No tablet is needed**:

| Device | Page | Who uses it |
|---|---|---|
| **Monitor** connected to the laptop, with a **mouse** (and keyboard) | `/ear` – the *visitor screen* | The **visitor**: language → menu → hearing-in-noise test, or VR: consent → choose a condition → read about it → "Put on the VR headset" |
| **Laptop screen** | `/ear/host` (PIN) – the *host page* | **You**: **START / STOP** the VR, choose a condition for the visitor, settings, results, uploads, calibration |
| **Android phone in a VR box** + earphones | `/vr` | Shows the camera picture with the balance-disorder effects |
| (optional) | `/ear/record` (PIN) | Record the digits 0–9 for each language |

Everything runs from **one laptop** with Node.js. No internet is needed once it is installed. The phone must be on the same
Wi-Fi as the laptop (a pocket router or a hotspot is fine). Headphones for the **hearing test** go into the **laptop**;
earphones for **VR** go into the **phone**.

> ⚠️ Screening **simulation** for awareness only – not a medical test. Result bands and texts marked `needsReview` must be
> checked before the exhibition (see "Before the exhibition").

---

## 1. Install (one time, needs internet)

1. Install **Node.js LTS** from <https://nodejs.org> (version 18 or newer).
2. Download this project (ZIP of the branch, or `git clone`) and unzip it. Open the inner folder – you should see `package.json`.
3. Open a terminal in that folder (Windows: click the address bar, type `cmd`, press Enter) and type:
   ```
   npm install
   ```
4. **Install espeak-ng** (free offline text-to-speech, makes placeholder digit recordings in English, Tamil and Sinhala):
   - **Windows:** <https://github.com/espeak-ng/espeak-ng/releases> → newest release → *Assets* → the `.msi` file (X64) → install.
   - **Mac:** `brew install espeak-ng` · **Linux:** `sudo apt install espeak-ng`
5. **Windows Firewall:** right-click **`allow-firewall-windows.cmd`** → *Run as administrator* (lets the phone reach the laptop).

**Updating to a new version:** extract the new ZIP, then copy your old **`data`** and **`media`** folders into the new folder
(settings, PIN, results, recordings, pictures), run `npm install` once, then `npm start`.

## 2. Start

```
npm start
```

- The **host page opens by itself** (`https://localhost:8443/ear/host`). First time: *Advanced → Proceed*, PIN **2468**
  (change it under *Settings*).
- The black window must stay open. **Ctrl + C** stops the station.
- If espeak-ng is installed, the first start says *"Made 30 placeholder digit recordings"*.

## 3. Visitor screen on the monitor

1. Connect the monitor (HDMI) and press **⊞ Win + P → Extend**.
2. Host page → *Visitor screen on the monitor* → **🖥 Open visitor screen**.
3. In that window click **⛶ Full screen on the monitor** (bottom left). Allow "window management" if Chrome asks. Or drag the
   window onto the monitor and press **F11**.
4. Put the **mouse** (and keyboard) in front of the visitor's chair. Plug the **hearing-test headphones** into the laptop and set the
   laptop volume to a fixed comfortable level.

## 4. VR phone

1. Host page → **Connect the VR phone** → scan the QR code with the phone's camera → *Advanced → Proceed*.
2. Turn the phone sideways, tap **Tap to start VR**, allow the camera (and motion sensors if asked).
3. Plug **earphones** into the phone, put the phone into the VR box.
4. Host page → VR phone: *Ready Yes, Camera OK, Motion sensors OK*. Tilt the box to the **right** shoulder → *Head tilt* positive
   (otherwise tick *Invert head tilt* in Settings).

### Fit the picture to the VR box (once per phone/box)
Host page → **Headset calibration** → tick **Show test pattern** → look through the box and move the sliders until the two red
crosses join into **one** cross (*Distance between eye centres*, *Vertical position*) and the grid lines look **straight**
(*Distortion*); adjust *Eye circle size*, *Roundness*, *Nose cutout*, *Zoom* as needed. Untick the test pattern. Saved automatically.

---

## 5. Running a visitor

### Hearing test (on the monitor)
Visitor: language → **Test your hearing** → tick the box → **Continue** → set a comfortable volume → **Continue** →
2 practice + 24 test rounds: hear 3 numbers in noise, type them with the **mouse** (big keypad) or the **keyboard** (digits,
Backspace, Enter) → coloured result. You see the dB value on the host page.

### VR (visitor on the monitor, you on the host page)
1. Visitor sits on the chair. Visitor: language → **Experience balance disorders in VR** → reads the warning list, **ticks consent**
   → **Continue**. (Host page shows *Consent: Given ✓*.)
2. The visitor **chooses a condition** on the monitor – or ask them and click it in **VR control** on the host page.
3. The monitor shows the condition's **picture and text** for the *picture time* (host page, − / +), then
   **"Put on the VR headset to experience … – Stay seated. The helper will start the experience"** and
   "If you feel any discomfort, close your eyes or take off the headset".
4. Help the visitor put on the VR box and earphones. Host page shows *ready to start* → press **▶ START**.
   - The phone says the instruction (e.g. "Turn your head slowly towards your right shoulder, and wait").
5. During the experience: watch the visitor. At any sign of discomfort press **■ STOP** (or the **Esc** key) – the view becomes
   calm and still at once. Visitors can also simply close their eyes or take the headset off.
6. When it ends (or after STOP) the phone shows **"Take the headset off slowly"** and the monitor goes **back to the condition
   menu** with "Take the headset off slowly – Sit for a moment" and when to see a doctor.

After 60 s without the mouse being used the visitor screen goes back to the language choice (3 min while reading or waiting
for START; never while VR is running).

---

## 6. Host page – overview
- **VR control:** visitor screen / language / consent / condition / phone state, condition buttons, **START**, **STOP** (Esc), progress.
- **Connect the VR phone:** QR code (+ other laptop addresses and connection tips).
- **Status:** visitor screen and VR phone (camera, sensors, fullscreen, effect strength, frames per second).
- **VR experience – live controls:** effect strength (Low / Medium / High, 10–100 %), length of each condition (10–60 s,
  default 30 s), Ménière's ringing and muffled-sound volumes with **Test sound**, oscillopsia sensitivity.
- **Visitor screen on the monitor:** open it, **looping home video** (upload MP4/WEBM – plays muted behind the language
  buttons and dimmed behind the other screens), *picture time* (5–120 s, default 15 s), **pictures for each condition** per language
  or for all languages (JPG/PNG/WEBP, best 1920 × 1080), **▶ Show on monitor** to check one.
- **Headset calibration** and **Head movement** (live sensor values, warnings).
- **Spoken instructions (VR):** text per condition/language, ▶ on phone, upload your own MP3 (needed where the phone has no
  Tamil/Sinhala voice).
- **Digit audio:** per language and digit: Play, source (Generated / My recording), *Replace with recording*, *Upload MP3*,
  *Reset to generated*; warning if a language is incomplete. A language uses **your recordings only when all 10 exist**,
  otherwise the generated set – never mixed.
- **Calibrate with normal listeners:** *Calibration mode* (or tick *Normal listener* on a result); per language average, SD and
  **suggested bands** (GOOD ≤ average + 2 SD, REFER > that + 3 dB) → *Use for …*. Switch calibration mode OFF before visitors.
- **Hearing results:** counts, last results with dB, CSV download, reset.
- **Settings:** common result bands, idle timeouts, ramp-up, BPPV options, test details, PIN.

Saved data: `data/` (settings, results, certificate). Media: `media/` (recordings, generated digits, pictures, voice MP3s,
home video `media/ear/home.mp4`, uploaded on the host page). Neither is on GitHub.

---

## How the hearing test works
Digits-in-noise screening (inspired by digits-in-noise tests such as hearWHO; no WHO name or logo is used):
volume step → 2 practice triplets (+4 dB SNR) → 24 adaptive triplets (3 random digits, no repeats in a row, in speech-shaped
noise made from the digits' own spectrum). 1-up/1-down: all 3 right → 2 dB harder, otherwise 2 dB easier; overall loudness
constant. **SRT** = mean SNR of trials 5–24. Bands (placeholders until calibrated): good ≤ −10 dB, borderline, refer > −7 dB.
Visitors see a coloured gauge and a sentence, never a number, and always "Screening simulation only — not a diagnosis."

## How the VR effects work
One Three.js shader shows the rear camera (up to 1920×1080, 30 fps) in two lens-shaped eyes with Cardboard-style distortion.
Each condition lasts 30 s by default, starts with a 3 s gentle ramp and fades out; the room's spin always turns back upright
before the end. Default strength **Low**. Hard limits: spin ≤ 90°/s, rotation ±15°, shift 15 % of the view, ringing ≈ −26 dBFS.
**No flashing anywhere.**

| Condition | What the visitor sees / hears |
|---|---|
| **BPPV (right ear)** | Nothing until the head tilts **right** > 30° (left does nothing). After ~2.5 s: torsional spin + up-beating nystagmus that builds up, peaks and fades. Ends by itself if no tilt comes within 30 s. |
| **Vestibular neuritis** | The room slowly turns and keeps drifting to one side and snapping back (horizontal nystagmus, ~2 beats/s). |
| **Ménière's disease** | Spinning attack (the room keeps turning) + in the earphones ringing (tinnitus), muffled sound and ear fullness. |
| **Oscillopsia** | The picture bounces only when the head moves (gyroscope; orientation sensor as fallback). Still head = still picture. |

---

## Testing
```
npm test
```
40 automatic tests: hearing-test rules, staircase, SRT, bands, loudness, noise, trimming/normalising, WAV, espeak-ng digits,
digit sets never mixed, nystagmus, BPPV, spinning (speed limit, ends upright), 10–60 s lengths, oscillopsia bounce, head-tilt
maths, server API and PIN, results, normal-listener calibration and per-language bands, settings limits, uploads, headset
calibration, QR addresses, host START/STOP and condition choice reaching the phone and the visitor screen, translations.

Quick laptop-only test: `npm run dev`, then <http://localhost:8080/ear> and <http://localhost:8080/ear/host>.

## Before the exhibition – please check
- [ ] **Record the digits** for every language you will use (host page → *Digit audio*).
- [ ] **Calibrate the bands** with 10–20 normal-hearing people per language (host page → *Calibrate with normal listeners*) and
      confirm with your ENT / audiology lecturer.
- [ ] Texts marked `"needsReview": true` in `public/shared/translations.json` checked by a native speaker / lecturer.
- [ ] Change the PIN. Fit the headset (calibration). Try every condition yourself at Low strength.
- [ ] Calibration mode **OFF**.

## Project layout
```
server/            Node.js server (Express + Socket.IO, HTTPS certificate, settings, results, media, espeak-ng digits)
public/ear/        visitor screen (index.html, js/app.js), host page, recording helper
public/vr/         VR phone: camera.js, renderer.js (shader), effects.js, sound.js, voice.js
public/shared/     translations.json (all visitor text), fonts, styles, kiosk (fullscreen / keep awake)
media/  data/      your files and saved data (not on GitHub)
test/              automatic tests (npm test)
```

## Troubleshooting
| Problem | Fix |
|---|---|
| Phone cannot open the page | Same Wi-Fi (not a guest network)? Run `allow-firewall-windows.cmd` as administrator. Try the other addresses on the host page. |
| "Not private" warning | Normal: *Advanced → Proceed*. It returns if the laptop's IP address changed. |
| START is greyed out | Host page hint says why: no condition chosen yet, or the VR phone is not ready (tap *Tap to start VR*). |
| Visitor screen is on the laptop, not the monitor | Win + P → Extend; then *⛶ Full screen on the monitor*, or drag the window and press F11. |
| "The number recordings are missing" | Install espeak-ng and restart, or record the digits (host page → *Digit audio*). |
| BPPV never starts | *Head tilt* must go above +30 when tilting right; otherwise tick *Invert head tilt*. |
| Two pictures don't join / lines bent in the headset | Host page → *Headset calibration* with the test pattern. |
| Forgot the PIN | Stop the server, `set EAR_PIN=2468`, `npm start`, then set a new PIN in Settings. |
