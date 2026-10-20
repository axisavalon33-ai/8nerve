# Media files for the Ear & Balance station

These files are **not stored on GitHub** (they are listed in `.gitignore`). Copy them onto the laptop yourself.

```
media/
└── ear/
    ├── home.mp4                 ← looping background video (muted). H.264 MP4 works on all tablets.
    └── digits/
        ├── en/0.wav … 9.wav     ← English digits   (made with /ear/record)
        ├── ta/0.wav … 9.wav     ← Tamil digits
        └── si/0.wav … 9.wav     ← Sinhala digits
    digits-generated/<lang>/N.wav ← placeholder digits made automatically with espeak-ng
media/vr/voice/<condition>/<lang>.mp3 ← your own spoken VR instructions (uploaded on the host page)
```

A language uses your recordings only when all 10 digits exist; otherwise the generated set is used (never mixed).

- The recording helper (`/ear/record`) saves `N.wav` files automatically.
- You may also drop in your own files called `0.mp3 … 9.mp3` (or `.webm`, `.ogg`, `.m4a`). If several formats exist for one digit,
  the order used is: mp3, wav, webm, ogg, m4a. Saving a new recording in `/ear/record` deletes the older formats of that digit.
- Each digit should be one clear word with little silence around it. Loudness differences between files are corrected
  automatically when the test runs.
- If `home.mp4` is missing, the tablet shows a softly moving teal-blue-violet background instead.
