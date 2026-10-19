# 8nerve – "Ear & Balance" station (8th cranial nerve)

An offline exhibition station with two parts:

| Device | Address | What it does |
|---|---|---|
| **Tablet** | `/ear` | Language choice → menu → hearing-in-noise screening test, or control of the VR experience (with a big red **STOP**) |
| **Android phone in a VR box** | `/vr` | Rear camera shown twice (left/right eye) with balance-disorder effects |
| **Host (you)** | `/ear/host` (PIN) | Live status of tablet + phone, settings, anonymous result counts, STOP, reset |
| **Recording helper** | `/ear/record` (PIN) | Record the digits 0–9 for each language with the tablet microphone |

Everything runs from **one laptop** with Node.js. No internet is needed once it is installed. The laptop, the tablet and the phone
only need to be on the same Wi-Fi (a pocket router or the laptop's own hotspot is fine).

> ⚠️ Screening **simulation** for awareness only – not a medical test. Result bands and the texts marked `needsReview` must be
> checked before the exhibition (see "Before the exhibition" below).

---

## 1. Install (one time, needs internet)

1. Install **Node.js LTS** from <https://nodejs.org> (version 18 or newer). Accept all the defaults.
2. Get this project onto the laptop – either
   - `git clone https://github.com/axisavalon33-ai/8nerve.git`, or
   - on GitHub click **Code → Download ZIP** and unzip it.
3. Open a terminal **in the project folder**
   (Windows: open the folder in File Explorer, click the address bar, type `cmd`, press Enter.
   Mac: right-click the folder → *New Terminal at Folder*).
4. Type:
   ```
   npm install
   ```
   This downloads the three libraries the server needs (Express, Socket.IO, selfsigned). The fonts (Noto Sans, Noto Sans Tamil,
   Noto Sans Sinhala) are already inside the project in `public/fonts/`, so nothing is loaded from the internet later.

## 2. Copy the media files

Media files are **not** on GitHub. Put them here (see `media/ear/README.md`):

```
media/ear/home.mp4          looping background video
media/ear/digits/en/0..9    digit recordings (make them with /ear/record, step 6)
media/ear/digits/ta/0..9
media/ear/digits/si/0..9
```

## 3. Start the server

```
npm start
```

You will see something like:

```
Ear & Balance is running. Open these addresses:
  Tablet:   https://192.168.1.20:8443/ear
  VR phone: https://192.168.1.20:8443/vr
  Host:     https://192.168.1.20:8443/ear/host
  Record:   https://192.168.1.20:8443/ear/record
```

Leave this window open. Press **Ctrl + C** to stop the server.

- **Windows firewall:** the first time, Windows asks whether Node.js may use the network – tick **Private networks** and click **Allow**.
- **Use a fixed IP address** for the laptop if you can (in the router settings: "DHCP reservation"). If the address changes,
  a new certificate is made automatically and you must accept it again on each device (step 4).

## 4. Accept the security certificate (once per device)

The camera, microphone and motion sensors only work over **HTTPS**. The server makes its own ("self-signed") certificate
the first time it starts (saved in `data/certs/`). Browsers do not know this certificate, so you must accept it once on every device:

**Android tablet / phone (Chrome):**
1. Open Chrome and type the address exactly as printed, e.g. `https://192.168.1.20:8443/ear` (on the phone: `/vr`).
2. You will see *"Your connection is not private"*. Tap **Advanced** → **Proceed to 192.168.1.20 (unsafe)**.
   (It is safe – it is your own laptop.)
3. The page opens. Chrome remembers your choice.
4. If you typed `http://…:8080/…` by mistake, it is forwarded to the HTTPS address automatically.

**Laptop browser** (for the host page): the same – *Advanced → Proceed* (Chrome/Edge) or *Advanced → Accept the risk* (Firefox).

Tips for the exhibition:
- On the tablet use Chrome's menu → **Add to Home screen**, then open it from there – it runs full-screen.
- Turn on Android **App pinning** (Settings → Security → App pinning) so visitors cannot leave the app.
- Set the tablet's **media volume** to a fixed comfortable level before opening (the app has its own volume step for each visitor).

## 5. Set up the VR phone

1. On the phone open `https://<laptop-ip>:8443/vr` and accept the certificate (step 4).
2. Turn the phone **sideways (landscape)**, tap **"Tap to start VR"**, and **Allow** the camera.
   The page goes full-screen, keeps the screen awake and shows the camera twice.
3. Plug the visitor's **earphones into the phone** (the Ménière's sounds play from the phone).
4. Put the phone into the VR box (camera hole must be clear).
5. Open the **host page** and check: *VR phone – Ready: Yes, Camera: OK, Motion sensors: OK*.
   Tilt the headset towards your **right** shoulder – *Head tilt* should show a **positive** number (e.g. `+35°`).
   If it shows a negative number, tick **Invert head tilt** in the settings and save.
- The small `⋯` button at the top middle of the phone screen brings back the setup screen.
- If the camera cannot start, a calm drawn room is shown instead (host shows "Camera: Not available").

## 6. Record the digits (once per language)

1. On the tablet open `https://<laptop-ip>:8443/ear/record`, enter the PIN (default **2468**).
2. Choose the language, allow the microphone.
3. For each number 0–9: tap **Record**, say the number once clearly, it stops after 3 s (or tap **Stop**).
   The silence is trimmed and the loudness is evened out automatically. Listen (**Play**), then **Save**.
4. **Play all saved digits** to check that they sound alike. Use the same speaker for all ten digits of a language.

Files are saved as `media/ear/digits/<lang>/<N>.wav`. (The browser cannot make MP3 files offline, and WAV keeps the trimmed,
normalised sound exactly; you can still copy in your own `N.mp3` files if you prefer.)

## 7. Host page and settings

Open `https://<laptop-ip>:8443/ear/host` (on the laptop or your own phone). Default PIN **2468** – **change it** in the settings.

- **Status:** tablet screen and language; phone ready / camera / sensors / state / condition / head tilt / frames per second.
- **STOP VR:** the same as the red STOP on the tablet.
- **Results:** counts (total, today, by band, by language) and the last 30 results **with the SRT in dB** (visitors never see dB).
  *Download CSV* for your own analysis, *Reset results* to empty the list.
- **Settings:** result bands, idle timeout (default 60 s → HOME), VR intensity (default **Low**), length of each condition
  (max 20 s), ramp-up (default 3 s), BPPV tilt angle / delay, Ménière's sound volume, test details, PIN.
  *Restore defaults* resets everything except the PIN.

Saved data lives in the `data/` folder on the laptop (not on GitHub):
`data/ear_results.json` (time, language, SRT, band – **no names**), `data/settings.json`, `data/certs/`.

---

## How the hearing test works

Digits-in-noise screening (inspired by digits-in-noise phone tests; no WHO name or logo is used).

1. **Volume step:** a sample of digits in noise plays; the visitor sets a comfortable level with big − / + buttons, then *Continue*.
   After that the volume is locked (no control on later screens).
2. **2 practice triplets** (not scored, at an easier +4 dB SNR), then **24 test triplets**.
3. Each triplet = 3 random digits (0–9, no digit twice in a row), ~0.5 s apart, in **speech-shaped steady noise**. The noise is
   made in the browser with the Web Audio API from the average spectrum of that language's own digit recordings.
4. **Adaptive 1-up/1-down:** start at 0 dB SNR; all 3 digits right → 2 dB harder; otherwise 2 dB easier.
   Speech and noise are changed together so the **overall loudness stays the same**.
5. **SRT** (speech reception threshold) = mean SNR of trials 5–24.
6. Bands (placeholders): **good** ≤ −10 dB, **borderline** −10 to −7 dB, **refer** > −7 dB. The visitor sees a coloured gauge and a
   sentence, never a number. The footer "Screening simulation only — not a diagnosis." is always shown.

## How the VR effects work (`public/vr/effects.js`)

All effects are drawn on the camera image with canvas transforms. **No flashing, strobing or brightness changes** anywhere; text
inside the headset fades in slowly. Every condition is limited to **20 s**, starts with a **3 s gentle ramp**, and the global
intensity is **Low** by default (Low 0.35 / Medium 0.6 / High 0.85 of the maximum). Hard limits: rotation ±15°, shift 15 % of the
view, Ménière's sound capped at 25 % of full volume.

| Condition | What the visitor sees / hears |
|---|---|
| **BPPV (right ear)** | Nothing until the head tilts **right** > 30°. Tilting left does nothing. After 2.5 s: torsional rotation + up-beating nystagmus that builds up, peaks and fades over the set length (default 18 s). If no tilt comes within 30 s, it ends by itself. |
| **Vestibular neuritis** | Steady horizontal nystagmus: slow drift (0.4 s) then fast snap back (0.08 s) with slight motion blur, about 2 beats per second. |
| **Ménière's disease** | Spinning episode (faster nystagmus + slow swaying rotation) and, in the earphones, a muffled low roar plus a soft ringing tone. |
| **Oscillopsia** | The picture only moves when the head moves: it is shifted in proportion to head rotation speed and bounces back. Still head = still picture. |

**STOP** (tablet or host) sets the phone **instantly** to the plain, still camera view, switches the sound off and shows
"Take the headset off slowly". After each condition the tablet shows "Take the headset off slowly" and a short explanation
(what happens in the inner ear, when to see a doctor).

Head tilt is measured from the phone's gravity sensor (`devicemotion`), which is more reliable than `deviceorientation`
when the phone is held sideways in a VR box.

---

## Testing

### Automatic tests (no tablet needed)
```
npm test
```
28 tests check: the triplet rules, scoring, the 1-up/1-down staircase, the SRT (trials 5–24), the bands, constant loudness,
the noise generator, silence trimming/normalising, the WAV file, the nystagmus timing, BPPV (right tilt only, delay, build-up and
fade, ends by itself), the 20 s limit and ramp, oscillopsia (still head = still picture), the head-tilt maths, the server API, the
PIN protection, anonymous result saving, settings limits, digit upload, STOP from tablet → phone, and that every translation key
exists in EN/TA/SI with your exact texts.

### Quick test on the laptop only
```
npm run dev
```
Then open <http://localhost:8080/ear> in Chrome on the laptop (camera and microphone are allowed on `localhost` without HTTPS).
You can open `/vr` in a second window to try the VR page with the laptop camera.

### Full test checklist (with the real devices)
1. `npm start`, accept the certificate on tablet, phone and laptop.
2. Host page: tablet and phone both show **Connected**.
3. Tablet: HOME shows the video, the three-language title and the language bar at the bottom. Tap **தமிழ்** → menu in Tamil.
4. Leave the menu alone for 60 s → it goes back to HOME by itself.
5. **Test your hearing** → Continue is grey until the box is ticked → volume step → practice → 24 triplets → coloured result.
   The host page shows the new result with its dB value.
6. **VR** → tick → choose **BPPV** → START. Tilt the headset left (nothing happens), then right (after ~2.5 s the view rotates and
   jerks, then fades). Press **STOP** on the tablet – the phone becomes calm and still immediately.
7. Try the other three conditions; check the Ménière's sounds are soft in the earphones.
8. Try all three languages on every screen.

---

## Before the exhibition – please check

- [ ] **Result bands** (−10 / −7 dB) are placeholders: confirm with your ENT / audiology lecturer and by testing normal-hearing
      classmates (look at their SRTs on the host page).
- [ ] Texts marked `"needsReview": true` in `public/shared/translations.json` were written by the developer (Tamil and Sinhala
      included) – ask a native speaker / lecturer to check them. Your own texts are used word for word.
- [ ] Change the PIN (host page → Settings).
- [ ] Record the digits for all three languages (host page shows "10/10 ✓" for each).

## Project layout

```
server/            Node.js server (Express + Socket.IO, HTTPS certificate, settings, results)
public/ear/        tablet app, host page, recording helper
public/vr/         VR phone page and effect maths
public/shared/     translations.json (all visitor text), fonts.css, i18n.js, style.css
public/fonts/      bundled Noto fonts (SIL Open Font License)
media/             your videos and recordings (not on GitHub)
data/              results, settings, certificate (created when running, not on GitHub)
test/              automatic tests (npm test)
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Tablet says "The number recordings are missing" | Record the digits for that language in `/ear/record` (all 10 needed). |
| START is grey, "The VR phone is not ready" | On the phone, open `/vr` and tap *Tap to start VR*. Check the host page. |
| Phone shows a drawn room instead of the camera | Camera permission was refused or the page is not HTTPS. In Chrome: lock icon → Permissions → Camera → Allow, then reload. |
| BPPV never starts | Host page → *Head tilt* must become positive (> 30) when tilting right. Otherwise tick *Invert head tilt*. |
| Devices cannot open the page | Same Wi-Fi? Correct IP (look at the `npm start` window)? Windows firewall allowed? |
| "Your connection is not private" again | The laptop's IP address changed – accept the certificate again, or give the laptop a fixed IP. |
