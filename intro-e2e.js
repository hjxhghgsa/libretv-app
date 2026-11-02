const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
const BASE = 'http://127.0.0.1:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const w = new BrowserWindow({
    width: 1400, height: 800, show: true, frame: false, x: 900, y: 60,
    webPreferences: { backgroundThrottling: false },
  });
  const V = BASE + '/__t.mp4';

  // 先开「自动检测」开关
  await w.loadURL(BASE + '/');
  await sleep(2000);
  // ★ zustand persist 的结构是 { state: {...}, version: N }，
  //   直接写扁平对象 store 读不到，必须包在 state 里
  await w.webContents.executeJavaScript(`(function(){
    var raw = localStorage.getItem('libretv-settings');
    var parsed = raw ? JSON.parse(raw) : { version: 0, state: {} };
    if (!parsed.state) parsed.state = {};
    parsed.state.autoDetectIntro = true;
    localStorage.setItem('libretv-settings', JSON.stringify(parsed));
  })()`).catch(() => {});

  const url = `${BASE}/watch?source=test&sourceUrl=${encodeURIComponent(V)}&url=${encodeURIComponent(V)}&title=OPED测试`;
  await w.loadURL(url);
  const hints = [];
  w.webContents.on('console-message', (_e, l, m) => {
    if (m.indexOf('检测到') >= 0) hints.push(m.slice(0, 200));
  });

  // 播到 140s（越过采停比例 0.35×400=140s），期间快进确保覆盖
  // 采样需要覆盖 0~140s（0.35×400）。mp4 直链可以秒 seek，逐段跳加快进度
  for (const t of [0, 40, 80, 120, 138]) {
    await w.webContents.executeJavaScript(`(function(){
      var v=document.querySelector('video'); if(v){ v.currentTime=${t}; v.play().catch(function(){}); }
    })()`).catch(() => {});
    await sleep(7000);
  }
  await sleep(8000);

  // 读 store 里是否写入了跳过标记
  const marks = await w.webContents.executeJavaScript(`(function(){
    var raw = localStorage.getItem('libretv-settings');
    if (!raw) return 'no-settings';
    var parsed = JSON.parse(raw);
    var s = parsed.state || parsed;
    return JSON.stringify((s.skipMarks && Object.keys(s.skipMarks).length)
      ? s.skipMarks : 'EMPTY');
  })()`).catch(e => 'ERR ' + e.message);

  const hint = await w.webContents.executeJavaScript(`(function(){
    var el = document.querySelector('[class*="hint"]');
    return el ? el.innerText.slice(0,200) : '(无提示元素)';
  })()`).catch(() => '?');

  console.log('提示条: ' + hint);
  console.log('console 命中: ' + (hints.length ? hints.join(' | ') : '(无)'));
  console.log('skipMarks: ' + String(marks).slice(0, 400));
  app.quit();
});
setTimeout(() => { console.log('TIMEOUT'); app.quit(); }, 120000);
