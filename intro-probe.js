const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
const BASE = 'http://127.0.0.1:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const w = new BrowserWindow({
    width: 1400, height: 800, show: true, frame: false, x: 900, y: 60,
    webPreferences: { backgroundThrottling: false },
  });
  const errs = [];
  w.webContents.on('console-message', (_e, l, m) => { if (l >= 2) errs.push('[' + l + '] ' + m.slice(0, 180)); });

  const V = BASE + '/__t.mp4';
  await w.loadURL(BASE + '/');
  await sleep(2000);
  await w.webContents.executeJavaScript(`(function(){
    var raw = localStorage.getItem('libretv-settings');
    var p = raw ? JSON.parse(raw) : { version: 0, state: {} };
    if (!p.state) p.state = {};
    p.state.autoDetectIntro = true;
    localStorage.setItem('libretv-settings', JSON.stringify(p));
  })()`).catch(() => {});

  // 插桩：记录 AudioContext 创建与 analyser 读数
  await w.webContents.executeJavaScript(`(function(){
    window.__dbg = { ctxCreated: 0, srcConnected: 0, rmsSamples: [], errors: [] };
    var OrigCtx = window.AudioContext;
    window.AudioContext = function(){
      window.__dbg.ctxCreated++;
      var c = new OrigCtx();
      var origCreate = c.createMediaElementSource.bind(c);
      c.createMediaElementSource = function(el){
        window.__dbg.srcConnected++;
        return origCreate(el);
      };
      return c;
    };
    window.addEventListener('error', function(e){ window.__dbg.errors.push(String(e.message)); });
  })()`).catch(() => {});

  const url = `${BASE}/watch?source=test&sourceUrl=${encodeURIComponent(V)}&url=${encodeURIComponent(V)}&title=probe`;
  await w.loadURL(url);
  await sleep(6000);

  const st = await w.webContents.executeJavaScript(`(function(){
    var v = document.querySelector('video');
    var d = window.__dbg || {};
    return {
      ctx: d.ctxCreated, connected: d.srcConnected,
      errs: (d.errors || []).slice(0, 3),
      videoTime: v ? +v.currentTime.toFixed(1) : null,
      readyState: v ? v.readyState : null,
      paused: v ? v.paused : null,
      muted: v ? v.muted : null,
      duration: v ? v.duration : null,
      autoDetect: (function(){
        var raw = localStorage.getItem('libretv-settings');
        if (!raw) return 'no-key';
        var p = JSON.parse(raw);
        return (p.state || p).autoDetectIntro;
      })(),
    };
  })()`).catch(e => ({ err: e.message }));

  console.log('PROBE ' + JSON.stringify(st));
  console.log('CONSOLE_ERR ' + JSON.stringify(errs.slice(0, 4)));
  app.quit();
});
setTimeout(() => { console.log('TIMEOUT'); app.quit(); }, 60000);
