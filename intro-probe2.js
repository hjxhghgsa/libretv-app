const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
const BASE = 'http://127.0.0.1:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const w = new BrowserWindow({
    width: 1400, height: 800, show: true, frame: false, x: 900, y: 60,
    webPreferences: { backgroundThrottling: false },
  });

  // 1) 先在首页把开关写进 persist（zustand 结构 {state, version}）
  await w.loadURL(BASE + '/');
  await sleep(2000);
  await w.webContents.executeJavaScript(`(function(){
    var raw = localStorage.getItem('libretv-settings');
    var p = raw ? JSON.parse(raw) : { version: 0, state: {} };
    if (!p.state) p.state = {};
    p.state.autoDetectIntro = true;
    localStorage.setItem('libretv-settings', JSON.stringify(p));
    return 'written';
  })()`).catch(e => 'ERR ' + e.message);

  // 2) 进播放页（导航会清 window，插桩要在加载后再做）
  const V = BASE + '/__t.mp4';
  const url = `${BASE}/watch?source=test&sourceUrl=${encodeURIComponent(V)}&url=${encodeURIComponent(V)}&title=probe2`;
  await w.loadURL(url);
  await sleep(5000);

  // 3) 加载后插桩 + 主动播放
  const r1 = await w.webContents.executeJavaScript(`(function(){
    window.__dbg = { ctx: 0, connected: 0, errs: [] };
    var OrigCtx = window.AudioContext;
    window.AudioContext = function(){
      window.__dbg.ctx++;
      var c = new OrigCtx();
      var oc = c.createMediaElementSource.bind(c);
      c.createMediaElementSource = function(el){ window.__dbg.connected++; return oc(el); };
      return c;
    };
    window.addEventListener('error', function(e){ window.__dbg.errs.push(String(e.message).slice(0,120)); });
    var v = document.querySelector('video');
    if (v) v.play().catch(function(e){ window.__dbg.errs.push('play:' + e.message); });
    return 'injected';
  })()`).catch(e => 'ERR ' + e.message);

  await sleep(8000);

  const st = await w.webContents.executeJavaScript(`(function(){
    var v = document.querySelector('video');
    var d = window.__dbg || {};
    return {
      injected: !!Object.keys(d).length,
      ctx: d.ctx, connected: d.connected,
      errs: (d.errs || []).slice(0, 3),
      t: v ? +v.currentTime.toFixed(1) : null,
      rs: v ? v.readyState : null,
      paused: v ? v.paused : null,
      dur: v ? v.duration : null,
      autoDetect: (function(){
        var raw = localStorage.getItem('libretv-settings');
        if (!raw) return 'no-key';
        return (JSON.parse(raw).state || {}).autoDetectIntro;
      })(),
    };
  })()`).catch(e => ({ err: e.message }));

  console.log('R1=' + r1);
  console.log('PROBE ' + JSON.stringify(st));
  app.quit();
});
setTimeout(() => { console.log('TIMEOUT'); app.quit(); }, 60000);
