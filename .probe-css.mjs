const urls = ['/', '/src/css/app.css', '/node_modules/@quasar/extras/material-icons/material-icons.css', '/node_modules/@quasar/extras/roboto-font/roboto-font.css', '/src/App.vue', '/src/layouts/MainLayout.vue', '/src/stores/cycle.ts', '/src/pages/DayBoardPage.vue'];
const withTimeout = (u) => Promise.race([fetch('http://127.0.0.1:9000' + u), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 20s')), 20000))]);
(async () => {
  let bad = 0;
  for (const u of urls) {
    try {
      const r = await withTimeout(u); const t = await r.text();
      const err = r.status !== 200 || /Internal server error|Failed to load PostCSS|Pre-transform error|not found|ERR_/.test(t);
      if (err) { bad++; console.log('FAIL', r.status, u, '::', t.replace(/\s+/g,' ').slice(0, 200)); }
      else console.log('OK  ', r.status, u, t.length + 'B');
    } catch (e) { bad++; console.log('ERR ', u, e.message); }
  }
  console.log(bad === 0 ? 'CSS + JS PIPELINE OK' : bad + ' FAILURES');
})();
