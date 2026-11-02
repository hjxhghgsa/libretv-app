const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
const BASE = 'http://127.0.0.1:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1400, height: 800, show: true, frame: false, x: 900, y: 60,
    webPreferences: { backgroundThrottling: false } });
  const logs = [];
  w.webContents.on('console-message', (_e, l, m) => { if (l >= 2) logs.push('[' + l + '] ' + m.slice(0, 150)); });

  await w.loadURL(BASE + '/');
  await sleep(2000);
  await w.webContents.executeJavaScript(`(function(){
    var raw = localStorage.getItem('libretv-settings');
    var p = raw ? JSON.parse(raw) : { version: 0, state: {} };
    if (!p.state) p.state = {};
    p.state.autoDetectIntro = true;
    localStorage.setItem('libretv-settings', JSON.stringify(p));
    return 'ok';
  })()`).catch(() => {});

  const V = BASE + '/__t.mp4';
  const url = `${BASE}/watch?source=test&sourceUrl=${encodeURIComponent(V)}&url=${encodeURIComponent(V)}&title=trace`;
  await w.loadURL(url);
  await sleep(6000);

  // 加载后插桩：包住 AudioContext，记录所有关键事件
  await w.webContents.executeJavaScript(`(function(){
    window.__T = { ctx: 0, connected: 0, samples: 0, playErr: null, mediaErr: null, autoDetect: undefined };
    var O = window.AudioContext;
    window.AudioContext = function(){
      window.__T.ctx++;
      var c = new O();
      var oc = c.createMediaElementSource.bind(c);
      c.createMediaElementSource = function(el){ window.__T.connected++; return oc(el); };
      return c;
    };
    var v = document.querySelector('video');
    if (v) {
      v.addEventListener('error', function(){ window.__T.mediaErr = 'code=' + (v.error && v.error.code); });
      v.addEventListener('playing', function(){ window.__T.playing = true; });
      v.addEventListener('durationchange', function(){ window.__T.dur = v.duration; });
      v.play().catch(function(e){ window.__T.playErr = e.message; });
    }
  })()`).catch(e => 'INJ_ERR ' + e.message);

  // 逐段 seek 覆盖 0~140s
  for (const t of [0, 40, 80, 120, 138]) {
    await w.webContents.executeJavaScript(`(function(){
      var v=document.querySelector('video'); if(v){ v.currentTime=${t}; v.play().catch(function(){}); }
    })()`).catch(() => {});
    await sleep(6000);
  }
  await sleep(6000);

  const st = await w.webContents.executeJavaScript(`(function(){
    var v = document.querySelector('video');
    var d = window.__T || {};
    var raw = localStorage.getItem('libretv-settings');
    var auto = raw ? (JSON.parse(raw).state || {}).autoDetectIntro : 'no-key';
    return {
      ctx: d.ctx, connected: d.connected, playing: d.playing,
      playErr: d.playErr, mediaErr: d.mediaErr,
      t: v ? +v.currentTime.toFixed(1) : null, rs: v ? v.readyState : null,
      dur: v ? v.duration : null, autoDetect: auto,
      skipMarks: (function(){
        if (!raw) return 'no-key';
        var s = (JSON.parse(raw).state || {});
        return s.skipMarks && Object.keys(s.skipMarks).length ? JSON.stringify(s.skipMarks).slice(0,300) : 'EMPTY';
      })(),
    };
  })()`).catch(e => ({ err: e.message }));

  console.log('TRACE ' + JSON.stringify(st));
  console.log('LOGS ' + JSON.stringify(logs.slice(0, 4)));
  app.quit();
});
setTimeout(() => { console.log('TIMEOUT'); app.quit(); }, 130000);
