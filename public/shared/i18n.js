// Tiny translation helper. All visitor text lives in /shared/translations.json.
(function (global) {
  const I18n = {
    data: {},
    lang: 'en',
    async load() {
      const res = await fetch('/shared/translations.json', { cache: 'no-cache' });
      this.data = await res.json();
    },
    // t('din.progress', { n: 3, total: 24 })
    t(key, vars, lang) {
      const entry = this.data[key];
      const l = lang || this.lang;
      if (!entry) {
        console.warn('Missing translation key', key);
        return key;
      }
      let s = entry[l] !== undefined ? entry[l] : entry.en;
      if (typeof s === 'string' && vars) {
        s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
      }
      return s;
    },
    // Fill every element that has data-i18n="key" (text) inside root.
    apply(root = document) {
      root.querySelectorAll('[data-i18n]').forEach((el) => {
        const v = this.t(el.dataset.i18n, null, el.dataset.lang);
        if (Array.isArray(v)) {
          el.innerHTML = '';
          for (const item of v) {
            const li = document.createElement('li');
            li.textContent = item;
            el.appendChild(li);
          }
        } else {
          el.textContent = v;
        }
      });
      document.documentElement.lang = this.lang;
    },
  };
  global.I18n = I18n;
})(window);
