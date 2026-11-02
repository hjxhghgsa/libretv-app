const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
const BASE = 'http://127.0.0.1:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1200, height: 700, show: true, frame: false, x: 900, y: 60,
    webPreferences: { backgroundThrottling: false } });
  // 最裸的验证：直接放一个 <video> 指向 mp4
  await w.loadURL(BASE + '/');
  await sleep(1500);
  const r = await w.webContents.executeJavaScript(`(function(){
    return new Promise(function(res){
      var v = document.createElement('video');
      v.src = '/__t.mp4'; v.crossOrigin = 'anonymous'; v.muted = false;
      v.style.cssText = 'position:fixed;left:0;top:0;width:200px;z-index:99999';
      document.body.appendChild(v);
      var out = { events: [] };
      ['loadstart','loadedmetadata','canplay','playing','error','stalled'].forEach(function(ev){
        v.addEventListener(ev, function(){ out.events.push(ev + (v.error ? ':' + v.error.code : '')); });
      });
      v.play().then(function(){ out.playOK = true; }).catch(function(e){ out.playErr = e.message; });
      setTimeout(function(){
        out.t = +v.currentTime.toFixed(1); out.rs = v.readyState; out.dur = v.duration;
        out.muted = v.muted;
        res(out);
      }, 8000);
    });
  })()`).catch(e => ({ err: e.message }));
  console.log('MP4 ' + JSON.stringify(r));
  app.quit();
});
setTimeout(() => { console.log('TIMEOUT'); app.quit(); }, 40000);
