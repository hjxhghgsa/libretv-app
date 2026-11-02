delete process.env.ELECTRON_RUN_AS_NODE;
const { app, BrowserWindow } = require('electron');
let restarted = false;
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 600, height: 400, show: false });
  w.webContents.on('gpu-process-crashed', (e, d) => {
    console.log('[TEST] gpu-process-crashed 事件触发:', JSON.stringify(d));
    if (restarted) { console.log('[TEST] 已降级过，不再重启'); app.quit(); return; }
    restarted = true;
    console.log('[TEST] 模拟降级重启');
    app.relaunch();
    app.exit(0);
  });
  w.loadURL('data:text/html,<h1>x</h1>');
});
setTimeout(() => { console.log('[TEST] timeout'); process.exit(3); }, 20000);
