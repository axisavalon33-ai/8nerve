// Fullscreen + keep the screen awake (+ landscape on the phone).
// Browsers only allow fullscreen after a tap, so the first tap on the page turns it on.
// If fullscreen is left (e.g. by a swipe), a small "Tap to return to fullscreen" button appears.
(function (global) {
  const Kiosk = {
    landscape: false,
    entered: false,
    suppressed: false,
    wakeLock: null,
    label: () => 'Tap to return to fullscreen',
    btn: null,

    // opts: { landscape, auto (enter on the first tap anywhere, default true), label: () => text }
    init(opts = {}) {
      this.landscape = !!opts.landscape;
      if (opts.label) this.label = opts.label;
      this.btn = document.createElement('button');
      this.btn.type = 'button';
      this.btn.className = 'kiosk-return';
      this.btn.hidden = true;
      this.btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.enter();
      });
      document.body.appendChild(this.btn);
      const style = document.createElement('style');
      style.textContent = `.kiosk-return{position:fixed;left:14px;top:14px;z-index:1000;padding:12px 20px;border:none;border-radius:999px;
        font:700 18px 'Noto Sans','Noto Sans Tamil','Noto Sans Sinhala',sans-serif;color:#fff;background:rgba(18,35,61,.82);
        box-shadow:0 6px 18px rgba(0,0,0,.25)}.kiosk-return[hidden]{display:none}`;
      document.head.appendChild(style);

      // Only on touch screens (tablet / phone): a laptop running the host or recording page is left alone.
      const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (opts.auto !== false && touch) {
        // 'click' counts as a user gesture for touch screens (pointerdown does not).
        const first = () => {
          if (!this.entered) this.enter();
        };
        document.addEventListener('click', first, { capture: true });
      }
      document.addEventListener('fullscreenchange', () => this.update());
      document.addEventListener('webkitfullscreenchange', () => this.update());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.entered) {
          this.keepAwake();
          this.update();
        }
      });
    },

    supported() {
      const el = document.documentElement;
      return !!(el.requestFullscreen || el.webkitRequestFullscreen);
    },
    isFullscreen() {
      return !!(document.fullscreenElement || document.webkitFullscreenElement);
    },

    async enter() {
      this.entered = true;
      const el = document.documentElement;
      try {
        if (!this.isFullscreen()) {
          if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
          else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        }
      } catch {
        /* refused – the return button stays */
      }
      if (this.landscape) {
        try {
          await screen.orientation.lock('landscape');
        } catch {
          /* not supported */
        }
      }
      await this.keepAwake();
      this.update();
    },

    async keepAwake() {
      try {
        if ('wakeLock' in navigator && (!this.wakeLock || this.wakeLock.released)) {
          this.wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch {
        /* not allowed right now – tried again when the page is visible */
      }
    },

    // Hide the return button (e.g. while the VR setup screen is shown).
    suppress(on) {
      this.suppressed = on;
      this.update();
    },

    update() {
      if (!this.btn) return;
      this.btn.textContent = this.label();
      this.btn.hidden = !(this.entered && this.supported() && !this.isFullscreen() && !this.suppressed);
    },
  };
  global.Kiosk = Kiosk;
})(window);
