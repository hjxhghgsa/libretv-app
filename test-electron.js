process.env.ELECTRON_RUN_AS_NODE = '';
const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 800, height: 600, show: false });
  w.loadURL('data:text/html,<title>ok</title>');
  w.webContents.on('did-finish-load', async () => {
    const gl = await w.webContents.executeJavaScript(`(() => {
      const c = document.createElement('canvas');
      const g = c.getContext('webgl');
      if (!g) return 'no-webgl';
      const d = g.getExtension('WEBGL_debug_renderer_info');
      return (d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown') + ' | float:' + !!g.getExtension('EXT_color_buffer_float');
    })()`);
    console.log('WEBGL:', gl);
    app.quit();
  });
});
setTimeout(() => { console.log('TIMEOUT'); app.quit(); }, 25000);
