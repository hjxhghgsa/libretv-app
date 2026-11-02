const { app, BrowserWindow } = require('electron');
const path = require('path');

// 模拟打包后的启动流程，但把关键状态打印出来
process.env.ELECTRON_RUN_AS_NODE = '';

app.whenReady().then(() => {
  console.log('[TEST] app ready');
  const w = new BrowserWindow({
    width: 800, height: 600, show: false,
    webPreferences: { backgroundThrottling: false },
  });
  console.log('[TEST] window created, id=', w.id);

  w.once('ready-to-show', () => {
    console.log('[TEST] ready-to-show fired');
    w.show();
    console.log('[TEST] shown, isVisible=', w.isVisible());
  });

  w.webContents.on('gpu-process-crashed', (e, d) => {
    console.log('[TEST] GPU CRASHED:', JSON.stringify(d));
  });
  w.webContents.on('did-fail-load', (e, code, desc) => {
    console.log('[TEST] did-fail-load:', code, desc);
  });
  w.webContents.on('render-process-gone', (e, d) => {
    console.log('[TEST] render-process-gone:', JSON.stringify(d));
  });

  w.loadURL('data:text/html,<title>t</title><h1>hello</h1>');

  setTimeout(() => {
    console.log('[TEST] 5s: visible=', w.isVisible(), 'destroyed=', w.isDestroyed());
    app.quit();
  }, 5000);
});

setTimeout(() => { console.log('[TEST] TIMEOUT - app hung'); process.exit(3); }, 25000);
