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
   This downloads the libraries the station needs (Express, Socket.IO, selfsigned, Three.js, qrcode). They are stored in the
   `node_modules` folder on the laptop. The fonts (Noto Sans, Noto Sans Tamil,
   Noto Sans Sinhala) are already inside the project in `public/fonts/`, so nothing is loaded from the internet later.

5. **Install espeak-ng** (free, offline text-to-speech – makes placeholder digit recordings in English, Tamil and Sinhala):
   - **Windows:** open <https://github.com/espeak-ng/espeak-ng/releases>, download **`espeak-ng.msi`** (the newest
     release, under *Assets*), double-click it and accept the defaults.
   - **Mac:** `brew install espeak-ng`  ·  **Linux:** `sudo apt install espeak-ng`
   - The next `npm start` makes the 30 placeholder digits by itself (it says *"Made 30 placeholder digit recordings"*).
     If espeak-ng is installed somewhere unusual: `set ESPEAK_PATH=C:\path\to\espeak-ng.exe` before `npm start`.

## 2. Copy the media files

Media files are **not** on GitHub. Put them here (see `media/ear/README.md`):

```
media/ear/home.mp4          looping background video
media/ear/digits/en/0..9    MY digit recordings (made with /ear/record or uploaded on the host page)
media/ear/digits/ta/0..9
media/ear/digits/si/0..9
media/ear/digits-generated/  placeholder digits – made automatically with espeak-ng
media/vr/voice/<condition>/<lang>.mp3   my spoken VR instructions (uploaded on the host page)
```

## Fullscreen and "Add to Home screen"

- The tablet (`/ear`) and the phone (`/vr`) go **fullscreen on the first tap** (language button / *Tap to start VR*) and keep the
  screen awake; the phone also locks to landscape. If fullscreen is left (e.g. by a swipe), a small
  **"Tap to return to fullscreen"** button appears at the top left.
- Both pages have a web-app manifest (`display: fullscreen`). In Chrome: ⋮ → **Add to Home screen**. Note: with the station's
  self-signed certificate Chrome may add a plain shortcut that still opens with the browser bar – the first-tap fullscreen then
  takes over.

## 3. Start the server

```
npm start
```

- The **host page opens by itself** in the laptop's browser (`https://localhost:8443/ear/host`).
  The first time, click **Advanced → Proceed** and enter the PIN (default **2468**).
- At the top of the host page are **QR codes** for the **Tablet** and the **VR phone**. On each device, open the Camera app
  (or Google Lens), point it at its QR code and tap the link. No typing needed.
- The black window also shows a QR code and the addresses.

Leave the black window open. Press **Ctrl + C** to stop the server.

- **Windows firewall:** the first time, Windows asks whether Node.js may use the network – tick **Private networks** and click **Allow**.
  If the tablet still cannot open the page, right-click **`allow-firewall-windows.cmd`** in the project folder →
  **Run as administrator**. It opens ports 8443 and 8080 for the station.
- If the QR code does not work, open *"QR codes not working? Try another address"* on the host page – laptops often have extra
  virtual network adapters (WSL, VirtualBox, VPN); the real Wi-Fi address is listed first. You can also force one with
  `set EAR_HOST_IP=192.168.1.20` before `npm start`.
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
- The host page shows the camera resolution (e.g. *Camera: OK (1920×1080)*). If the camera stops or fails, both eyes show
  "Camera not working — trying again…" and the phone retries every 4 seconds by itself.

### Fit the picture to your VR box (calibration – do this once)
1. On the tablet, **press and hold the top-right corner of the screen for 3 seconds** (it is hidden so visitors don't find it).
   The *Headset calibration* panel opens.
2. Tick **Show test pattern** – the phone shows a grid, a red cross in the middle and an amber ring at the edge of each eye.
3. Put the phone in the VR box and look through it. Move the sliders until:
   - the two red crosses join into **one** cross (*Distance between eye centres*, *Vertical position*);
   - the grid lines look **straight**, not bent (*Distortion*);
   - each eye fills the lens nicely (*Eye circle size*, *Roundness*, *Zoom*);
   - the dark notch fits the box's nose gap (*Nose cutout width / height*).
4. Tap **Close** (the test pattern turns off). The values change on the phone immediately and are saved on the laptop,
   so you only do this again with a different phone or VR box. *Reset to defaults* puts all sliders back.

| Setting | Range | Default |
|---|---|---|
| Distortion | 0–1 | 0.25 |
| Zoom | 0.4–2.5 | 1.0 |
| Distance between eye centres (fraction of screen width) | 0.30–0.70 | 0.50 |
| Vertical position (fraction of screen height) | −0.25–0.25 | 0 |
| Eye circle size (fraction of screen height) | 0.4–1.3 | 0.92 |
| Roundness (1 = circle) | 0–1 | 1.0 |
| Nose cutout width / height | 0–0.4 / 0–0.6 | 0.12 / 0.22 |
| Divider width | 0–0.06 | 0.006 |
| Picture size in screen mode (the text panels shown inside the headset) | 0.8–2.2 | 1.6 |

## 6. Digit audio: generated placeholders and my recordings

Each language always uses **one complete set** of 10 digits, never a mix:
- **My recordings** – used only when **all 10** digits of that language are recorded (or uploaded);
- otherwise the **generated** set (espeak-ng computer voice, made automatically).

Both are trimmed and loudness-normalised the same way, so test levels stay consistent. The host page section
**Digit audio** shows every digit with **▶ Play**, its source (*Generated* / *My recording*), **Replace with recording**
(opens the recording helper at that digit), **Upload MP3**, and **Reset to generated** per language. A warning appears when a
language is incomplete.

To record on the tablet:

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
- **VR experience – live controls** (saved at once, used from the next START):
  - **Length** of each condition with **− / +** (5 s steps, 10–60 s, default **30 s**);
  - **Tinnitus / ringing** volume (default 30 %) and **Muffled hearing + fullness** volume, each with **▶ Test sound**
    (3 s on the phone's earphones). Both are made in code, fade in gently and can never go above a safe maximum;
  - **Oscillopsia sensitivity** (how strongly the picture follows head movement, ×0–×3).
- **Head movement:** live values from the phone's motion sensors (tilt, turn, nod, roll) and a clear warning if there are none.
- **Spoken instructions (VR):** for each condition and language – the text, **▶ On phone** (to hear it), **Upload MP3** to use
  your own recording, **Use phone voice** to go back. Without an MP3 the phone's text-to-speech reads the text (placeholder);
  if the phone has no voice for Tamil or Sinhala it stays silent – upload an MP3 for that language.
- **Digit audio:** see step 6.
- **Settings:** result bands, idle timeout (default 60 s → HOME), VR intensity (default **Low**), ramp-up (default 3 s),
  BPPV tilt angle / delay, test details, PIN. *Restore defaults* resets everything except the PIN and the headset calibration.

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

The phone draws everything with one Three.js shader (`public/vr/renderer.js`): the rear camera (centre square of the
picture, up to 1920×1080 at 30 fps, continuous focus/exposure/white balance, zoom 1.0) is shown in two lens-shaped eyes with
Cardboard-style barrel distortion, at the phone's full screen resolution and with unchanged colours. The effects are applied
in the same lens space, so they are distorted correctly. **No flashing, strobing or brightness changes** anywhere; text
inside the headset fades in slowly. Each condition lasts **30 s** by default (10–60 s on the host page), starts with a
**3 s gentle ramp** and fades out at the end; the global intensity is **Low** by default (Low 0.35 / Medium 0.6 / High 0.85 of the
maximum). Hard limits: rotation ±15°, shift 15 % of the view, ringing tone ≈ −26 dBFS and muffled sound at most 30 % (then a
compressor and a master limit). At the start the phone says a short instruction in the visitor's language.

| Condition | What the visitor sees / hears |
|---|---|
| **BPPV (right ear)** | Nothing until the head tilts **right** > 30°. Tilting left does nothing. After 2.5 s: torsional rotation + up-beating nystagmus that builds up, peaks and fades over the set length (default 30 s). If no tilt comes within 30 s, it ends by itself. |
| **Vestibular neuritis** | Steady horizontal nystagmus: slow drift (0.4 s) then fast snap back (0.08 s) with slight motion blur, about 2 beats per second. |
| **Ménière's disease** | Spinning episode (faster nystagmus + slow swaying rotation) and, in the earphones, ringing (tinnitus), muffled "through a wall" sound and a deep pressure rumble (fullness). |
| **Oscillopsia** | The picture only moves when the head moves: each turn/nod throws the picture along with it and it bounces back (spring). Still head = still picture. Uses the gyroscope; phones without one use the orientation sensor instead. |

**STOP** (tablet or host) sets the phone **instantly** to the plain, still camera view, switches the sound and voice off and shows
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
36 tests check: the triplet rules, scoring, the 1-up/1-down staircase, the SRT (trials 5–24), the bands, constant loudness,
the noise generator, silence trimming/normalising, the WAV file, the nystagmus timing, BPPV (right tilt only, delay, build-up and
fade, ends by itself), the 20 s limit and ramp, oscillopsia (still head = still picture), the head-tilt maths, the server API, the
PIN protection, anonymous result saving, settings limits, digit upload, STOP from tablet → phone, headset calibration (limits,
saving, live to the phone), that Three.js is served locally, the QR-code addresses, the 10–60 s lengths, the
oscillopsia bounce, digit sets never being mixed, espeak-ng placeholder digits (trimmed and normalised), spoken-instruction
uploads, and that every translation key
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
public/vr/         VR phone page: camera.js (camera), renderer.js (headset shader), effects.js (effect maths)
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
| Phone says "Camera permission refused" | In Chrome: lock icon → Permissions → Camera → Allow, then reload. The page must be `https://`. |
| Two pictures don't join / lines look bent in the headset | Calibrate: hold the tablet's top-right corner for 3 s (see step 5). |
| BPPV never starts | Host page → *Head tilt* must become positive (> 30) when tilting right. Otherwise tick *Invert head tilt*. |
| Devices cannot open the page | Same Wi-Fi (not a guest network)? Run `allow-firewall-windows.cmd` as administrator. Try the other addresses on the host page. |
| "Your connection is not private" again | The laptop's IP address changed – accept the certificate again, or give the laptop a fixed IP. |
