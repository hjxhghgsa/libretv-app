const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
const BASE = 'http://127.0.0.1:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1400, height: 800, show: true, frame: false, x: 900, y: 60,
    webPreferences: { backgroundThrottling: false } });
  const logs = [];
  w.webContents.on('console-message', (_e, l, m) => { if (l >= 2) logs.push('[' + l + '] ' + m.slice(0, 170)); });

  const V = BASE + '/__t.mp4';
  const url = `${BASE}/watch?source=test&sourceUrl=${encodeURIComponent(V)}&url=${encodeURIComponent(V)}&title=UI测试`;
  await w.loadURL(url);
  await sleep(6000);

  // 1) 点开「跳过标记」面板（按钮 title 含"标记片头"）
  const opened = await w.webContents.executeJavaScript(`(function(){
    var bs = [].slice.call(document.querySelectorAll('button'));
    for (var i=0;i<bs.length;i++){
      var t = bs[i].title || '';
      if (t.indexOf('标记片头') >= 0 || t.indexOf('本剧已标记') >= 0) { bs[i].click(); return t; }
    }
    return null;
  })()`).catch(e => 'ERR ' + e.message);
  await sleep(1200);

  // 2) 勾选「自动检测片头片尾」
  const checked = await w.webContents.executeJavaScript(`(function(){
    var cbs = [].slice.call(document.querySelectorAll('input[type=checkbox]'));
    for (var i=0;i<cbs.length;i++){
      var lbl = cbs[i].closest('label');
      var txt = lbl ? (lbl.innerText||'') : '';
      if (txt.indexOf('自动检测片头片尾') >= 0) {
        if (!cbs[i].checked) cbs[i].click();
        return 'checked=' + cbs[i].checked;
      }
    }
    return 'not-found(' + cbs.length + ' cbs)';
  })()`).catch(e => 'ERR ' + e.message);
  console.log('面板打开: ' + opened);
  console.log('开关: ' + checked);
  await sleep(1500);

  // 3) 确认 store 里开关真的开了
  const sw = await w.webContents.executeJavaScript(`(function(){
    var raw = localStorage.getItem('libretv-settings');
    if (!raw) return 'no-key';
    return String((JSON.parse(raw).state || {}).autoDetectIntro);
  })()`).catch(e => 'ERR ' + e.message);
  console.log('store autoDetectIntro = ' + sw);

  // 4) 逐段 seek 覆盖采样区 0~140s
  for (const t of [0, 40, 80, 120, 138]) {
    await w.webContents.executeJavaScript(`(function(){
      var v=document.querySelector('video'); if(v){ v.currentTime=${t}; v.play().catch(function(){}); }
    })()`).catch(() => {});
    await sleep(6000);
  }
  await sleep(7000);

  // 5) 读结果
  const res = await w.webContents.executeJavaScript(`(function(){
    var raw = localStorage.getItem('libretv-settings');
    var s = raw ? (JSON.parse(raw).state || {}) : {};
    var marks = (s.skipMarks && Object.keys(s.skipMarks).length) ? JSON.stringify(s.skipMarks).slice(0, 400) : 'EMPTY';
    var v = document.querySelector('video');
    return { marks: marks, t: v ? +v.currentTime.toFixed(1) : null, rs: v ? v.readyState : null,
             hint: (document.querySelector('[class*="hint"]')||{}).innerText || '' };
  })()`).catch(e => ({ err: e.message }));
  console.log('RESULT ' + JSON.stringify(res));
  console.log('LOGS ' + JSON.stringify(logs.filter(l => l.indexOf('检测') >= 0 || l.indexOf('超分') >= 0).slice(0, 3)));
  app.quit();
});
setTimeout(() => { console.log('TIMEOUT'); app.quit(); }, 140000);
