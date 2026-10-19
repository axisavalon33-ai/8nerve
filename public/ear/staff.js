// Shared PIN login for the staff pages. The PIN is kept only for this browser tab.
(function (global) {
  const Staff = {
    get pin() {
      return sessionStorage.getItem('earPin') || '';
    },
    async login(onOk) {
      const box = document.getElementById('pinBox');
      const input = document.getElementById('pinInput');
      const err = document.getElementById('pinErr');
      const check = async (pin) => {
        const r = await fetch('/api/pin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
        return (await r.json()).ok;
      };
      if (this.pin && (await check(this.pin))) {
        box.classList.add('hidden');
        return onOk();
      }
      box.classList.remove('hidden');
      document.getElementById('pinForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (await check(input.value)) {
          sessionStorage.setItem('earPin', input.value);
          box.classList.add('hidden');
          onOk();
        } else {
          err.textContent = 'Wrong PIN';
          input.value = '';
        }
      });
      input.focus();
    },
    api(url, opts = {}) {
      opts.headers = Object.assign({ 'x-pin': this.pin }, opts.headers || {});
      return fetch(url, opts).then(async (r) => {
        if (!r.ok) throw new Error((await r.text()) || r.statusText);
        return r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
      });
    },
  };
  global.Staff = Staff;
})(window);
