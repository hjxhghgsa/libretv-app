/**
 * LibreTV 桌面应用主进程
 *
 * 架构：Electron 只当壳，真正的服务是打包进来的 Next.js standalone 服务器。
 * 这样做的原因：
 *   ① 应用逻辑与 Web 版完全一致（同一份源码、同一份 .env.local）
 *   ② 离线可用 —— 打包后不需要 Node 环境、不需要另开浏览器
 *   ③ WebGL 超分需要 GPU 加速，Electron 内置 Chromium 天然支持
 *
 * 开发模式下连本机的 `next start`（LibreTV 源码目录，可用 LIBRETV_DIR 环境变量指定），打包后用 standalone。
 */
/**
 * ★ 关键：环境里可能预设了 ELECTRON_RUN_AS_NODE=1（某些沙箱/工具链会注入）。
 *   一旦存在，Electron 会退化成普通 Node —— require('electron') 返回的是
 *   **字符串路径**而不是模块对象，于是 app / BrowserWindow 全是 undefined。
 *
 *   运行时改 process.env 无效（Electron 在进程启动时就读了它），
 *   所以由「启动.bat」在拉起 LibreTV.exe 之前清掉。
 *   这里再清一次是双保险：万一用户从命令行直接跑 exe。
 */
if (process.env.ELECTRON_RUN_AS_NODE) {
  process.env.ELECTRON_RUN_AS_NODE = '';
}

const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;

/**
 * ★ 本地服务不该走代理
 *
 * 环境里常设 HTTP_PROXY / HTTPS_PROXY（公司代理、梯子、WorkBuddy 等），
 * 而 NO_PROXY 常常是空的。Chromium 的 fetch 会照代理走，
 * 结果本地 127.0.0.1:8080 的请求也被丢给代理 —— 表现是：
 *   · 登录一直失败（密码框不消失）
 *   · 首页「推荐内容加载失败」
 *   · 播放页拿不到数据
 *
 * 这里显式让 127.0.0.1 与 localhost 绕过代理。
 */
app.commandLine.appendSwitch('proxy-bypass-list', '<local>;127.0.0.1;localhost');
// 也清掉渲染进程会继承的代理环境变量
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;
delete process.env.ALL_PROXY;
delete process.env.all_proxy;

/**
 * ★ GPU 不可用时的降级（必须在 app ready 之前配置）
 *
 * 现象：某些环境（虚拟机、远程桌面、被禁用了显卡驱动的机器）没有可用 GPU，
 * Chromium 的 GPU 进程会反复崩溃重启，最后 FATAL 退出整个应用 ——
 * 表现为「双击图标，进程闪一下就没了」，也就是用户说的「打不开」。
 *
 * 这里做两件事：
 *   ① 启动器预先探测（见 启动LibreTV.bat 的 LIBRETV_FORCE_SOFTWARE_GL）
 *   ② 这里再兜一层：若用户没走启动器，也能在崩溃时自动降级重启
 *
 * 注意：降级后 WebGL 超分仍可用（走 SwiftShader 软件光栅），只是慢。
 */
const FORCE_SOFTWARE_GL = process.env.LIBRETV_FORCE_SOFTWARE_GL === '1';
if (FORCE_SOFTWARE_GL) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch('use-gl', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

// 开发模式指向源码目录，打包模式指向 standalone 产物
const SERVER_DIR = isDev
  ? (process.env.LIBRETV_DIR || path.join(process.cwd(), 'LibreTV'))
  : path.join(process.resourcesPath, 'server');
const PORT = 8080;
const APP_URL = `http://127.0.0.1:${PORT}`;

/**
 * ★ 单实例锁
 *
 * 只允许一个 LibreTV 实例运行。之前开第二个实例时，它会重新拉起内置服务，
 * 结果和第一个实例抢 8080 端口 —— 新实例的 server 起不来、页面加载失败，
 * 渲染进程直接崩溃，用户看到的现象就是「打不开软件」（白屏/闪退）。
 *
 * 现在第二个实例不再拉服务，而是把已有窗口激活到前台然后自己退出。
 */
const gotTheLock = app.requestSingleInstanceLock();

let mainWindow = null;
let serverProc = null;

/**
 * ★ 内置服务的日志文件
 *
 * 之前 `stdio: 'ignore'` 把子进程输出**全丢了**：
 * 服务起不来时（对方机器缺依赖、端口占用、平台不匹配…），
 * 界面上只有白屏，用户和开发者都看不到任何原因，
 * 只能靠猜 —— 「分享给别人却用不了」就是这么变成悬案的。
 *
 * 现在把 stdout/stderr 写进 %APPDATA%/LibreTV/logs/，
 * 失败时弹窗直接给出日志路径，对方把日志发回来就能定位。
 */
let serverLogFile = null;
function getLogDir() {
  const dir = path.join(app.getPath('userData'), 'logs');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 忽略 */ }
  return dir;
}

/** 等待服务就绪：轮询 /api/status */
function waitForServer(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${APP_URL}/api/status`, { timeout: 2000 }, res => {
        res.resume();
        if (res.statusCode < 500) resolve(true);
        else retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error('服务启动超时'));
      else setTimeout(tick, 500);
    };
    tick();
  });
}

/** 启动 Next 服务 */
function startServer() {
  if (isDev) {
    // 开发：复用本机源码目录
    serverProc = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['next', 'start', '-p', String(PORT)],
      {
        cwd: SERVER_DIR,
        detached: false,
        stdio: 'ignore',
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
      }
    );
  } else {
    // ★ 打包：standalone 产物自带 server.js。
    //   **必须用 Node 跑，不能用 process.execPath（那是 electron.exe）**：
    //   Electron 内置的 Node 缺 Next standalone 依赖的模块，且会走 Electron 的
    //   NODE_OPTIONS 校验（会报 "Most NODE_OPTIONs are not supported in packaged apps"）。
    //   优先找系统 node.exe；找不到就用 Electron 自带的 node 模式
    //   （ELECTRON_RUN_AS_NODE=1 让 electron.exe 退化为纯 Node 运行时）。
    const nodeBin = findNodeBinary();
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      NEXT_TELEMETRY_DISABLED: '1',
    };
    // 清掉环境注入的 NODE_OPTIONS（Electron 不接受它）
    delete env.NODE_OPTIONS;

    // ★ 代理内网放行开关：只在启动器显式传了 LIBRETV_ALLOW_PRIVATE=1 时开启
    //   （默认不开 —— 服务器不能变成内网探测跳板）。
    //   自建源 / 局域网 NAS / 本地联调时才需要，见 ssrf.ts 的 allowProxyPrivate()。
    if (process.env.LIBRETV_ALLOW_PRIVATE === '1') {
      env.PROXY_ALLOW_PRIVATE = '1';
    }

    if (nodeBin.kind === 'electron-as-node') {
      env.ELECTRON_RUN_AS_NODE = '1';
    }

    serverLogFile = path.join(getLogDir(), `server-${Date.now()}.log`);
    const logStream = fs.createWriteStream(serverLogFile, { flags: 'a' });
    logStream.write(`[LibreTV] 启动内置服务\n`);
    logStream.write(`  运行时: ${nodeBin.path} (${nodeBin.kind})\n`);
    logStream.write(`  工作目录: ${SERVER_DIR}\n`);
    logStream.write(`  端口: ${PORT}\n\n`);

    serverProc = spawn(nodeBin.path, [path.join(SERVER_DIR, 'server.js')], {
      cwd: SERVER_DIR,
      detached: false,
      // ★ 不能再用 'ignore'：输出全丢，出错时毫无线索
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    serverProc.stdout.on('data', d => logStream.write(d));
    serverProc.stderr.on('data', d => logStream.write(d));
    serverProc.on('exit', (code, signal) => {
      logStream.write(`\n[server exited] code=${code} signal=${signal}\n`);
      logStream.end();
      if (!serverReady) {
        dialog.showErrorBox(
          '内置服务启动失败',
          `服务进程已退出（退出码 ${code}）。\n\n` +
          `日志文件：\n${serverLogFile}\n\n` +
          `请把该日志发给开发者，或点击「诊断信息」查看环境检查结果。`
        );
      }
    });
  }
  serverProc.on('error', (e) => {
    const where = serverLogFile ? `\n\n日志文件：\n${serverLogFile}` : '';
    dialog.showErrorBox('启动失败', `无法启动内置服务：${e.message}${where}`);
  });
}

/** 服务是否已就绪（供 exit 回调判断该不该弹错） */
let serverReady = false;

/**
 * 找一个可用的 Node 运行时。
 *
 * ★ 优先用 **Electron 自带的 Node**（ELECTRON_RUN_AS_NODE=1 让 electron.exe
 *   退化为纯 Node 运行时）。理由：
 *   ① 打包出来的应用要**离线可用** —— 用户机器上不一定装了 Node；
 *   ② Electron 自带的 Node 版本固定，和打包时测试过的环境一致。
 *   只有在 Electron 运行时不可用时，才退到系统 Node。
 */
function findNodeBinary() {
  // Electron 自带 Node：进程自身 + ELECTRON_RUN_AS_NODE
  if (process.execPath && fs.existsSync(process.execPath)) {
    return { kind: 'electron-as-node', path: process.execPath };
  }
  // 系统 Node 兜底
  const candidates = [
    process.env.LIBRETV_NODE_PATH,
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    path.join(process.env.APPDATA || '', 'nvm', 'current', 'node.exe'),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return { kind: 'node', path: c };
    } catch { /* 忽略 */ }
  }
  return { kind: 'electron-as-node', path: process.execPath };
}

/**
 * ★ 诊断信息
 *
 * 「分享给别人却用不了」时，最缺的就是信息。
 * 这个菜单项把环境体检结果 + 日志路径一次性列出来，
 * 对方复制给开发者就能定位，不用来回问。
 */
async function showDiagnostics() {
  const lines = [];
  const add = (k, v) => lines.push(`${k}: ${v}`);

  add('应用版本', app.getVersion());
  add('系统', `${process.platform} ${process.arch} / Electron ${process.versions.electron}`);
  add('Node(内置)', process.versions.node);
  add('可执行文件', process.execPath);
  add('安装目录', path.dirname(process.execPath));
  add('服务目录', SERVER_DIR);
  add('服务目录存在', fs.existsSync(path.join(SERVER_DIR, 'server.js')) ? '是' : '★否（文件缺失）');
  add('端口', String(PORT));

  // 端口是否被别的程序占了
  const portBusy = await new Promise(resolve => {
    const net = require('net');
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.once('listening', () => srv.close(() => resolve(false)));
    srv.listen(PORT, '127.0.0.1');
  });
  add('端口占用', portBusy ? '★被其他程序占用' : '空闲');

  // 服务健康
  const health = await new Promise(resolve => {
    const req = http.get(`${APP_URL}/api/status`, { timeout: 2000 }, res => {
      res.resume();
      resolve(res.statusCode < 500 ? '正常' : `★HTTP ${res.statusCode}`);
    });
    req.on('error', () => resolve('★无响应（服务未运行）'));
    req.on('timeout', () => { req.destroy(); resolve('★超时'); });
  });
  add('服务状态', health);
  add('日志文件', serverLogFile || '（本次未生成）');
  add('日志目录', getLogDir());

  // 图形环境
  try {
    const gpu = await mainWindow.webContents.executeJavaScript(`(function(){
      var c = document.createElement('canvas');
      var g = c.getContext('webgl');
      if (!g) return '★无 WebGL';
      var d = g.getExtension('WEBGL_debug_renderer_info');
      return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
    })()`).catch(() => '未知');
    add('显卡', gpu);
  } catch { /* 窗口还没建 */ }

  const text = lines.join('\n');

  // ★ 打开时直接写进系统剪贴板。
  //   诊断窗口是 data: URL（非安全上下文），navigator.clipboard 不可用，
  //   所以走主进程的 clipboard 模块最稳 —— 对方直接 Ctrl+V 就能发出来。
  try { require('electron').clipboard.writeText(text); } catch { /* 忽略 */ }

  const win = new BrowserWindow({
    width: 640,
    height: 480,
    title: 'LibreTV 诊断信息',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!doctype html><meta charset="utf-8">
    <body style="font:13px/1.7 system-ui;padding:18px;background:#0b101a;color:#e6edf3">
    <div style="margin-bottom:12px;padding:8px 12px;border-radius:6px;background:#12351f;color:#7ee2a8">
      ✓ 已自动复制到剪贴板，直接 Ctrl+V 粘贴发给开发者
    </div>
    <pre style="white-space:pre-wrap;word-break:break-all;margin:0">${esc}</pre>
    </body>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    // ★ 与页面深色底一致：Windows 11 会按窗口背景给 1px 系统边框，
    //   默认白色在深色界面下很扎眼（用户反馈「上面有一条白边」）。
    backgroundColor: '#0b101a',
    title: 'LibreTV 影视工作台',
    icon: path.join(__dirname, 'icon.ico'),
    show: false,
    // ★ 隐藏系统标题栏，只保留自绘深色顶栏（页面 DesktopTitleBar 组件）。
    //   去掉 titleBarOverlay：它在最大化时会被 Windows 撑高，遮住页面内容。
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // WebGL 超分需要 GPU 加速
      backgroundThrottling: false,
      // 允许页面加载本地资源（不涉及安全风险，只是让 WebGL 更快）
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 页面加载完再显示，避免白屏闪烁
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  /**
   * ★ GPU 进程崩溃 → 自动降级到软件渲染并重启。
   * 无 GPU 的环境（虚拟机、远程桌面、部分游戏本）会反复崩 GPU 进程，
   * 结果就是「进程在、窗口不显示」，用户看到的现象是「打不开」。
   * 这里检测到崩溃就带 LIBRETV_FORCE_SOFTWARE_GL=1 重启一次。
   */
  mainWindow.webContents.on('gpu-process-crashed', (_e, details) => {
    console.error('[LibreTV] GPU 进程崩溃:', details?.reason);
    if (process.env.LIBRETV_FORCE_SOFTWARE_GL === '1') return; // 已降级过，不再重启
    dialog.showMessageBox({
      type: 'info',
      title: 'LibreTV',
      message: '检测到显卡加速不可用，正在以兼容模式重启。',
      detail: 'WebGL 超分功能在兼容模式下可能无法使用。',
    });
    app.relaunch();
    app.exit(0);
  });

  // 渲染进程崩溃也要能自愈
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[LibreTV] 渲染进程退出:', details?.reason);
  });

  // 加载失败时给用户明确提示，而不是白屏
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDesc, validatedURL) => {
    if (errorCode === -3) return; // ERR_ABORTED：正常的页面跳转
    console.error('[LibreTV] 页面加载失败:', errorCode, errorDesc, validatedURL);
    dialog.showErrorBox(
      'LibreTV',
      `无法加载内置服务页面。\n\n错误：${errorDesc} (${errorCode})\n地址：${APP_URL}\n\n` +
      '请确认端口 8080 未被其他程序占用，或重启应用。'
    );
  });

  mainWindow.loadURL(APP_URL);

  // 外部链接走系统浏览器，不在应用内开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // 最大化状态变化 → 通知页面切换图标（自绘顶栏用）
  const notifyMax = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', notifyMax);
  mainWindow.on('unmaximize', notifyMax);
}

app.on('second-instance', () => {
  // 用户又点了一次桌面图标：把已有窗口拉到前台，而不是新开一个抢端口
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  // 菜单：给个精简的（默认菜单带一堆英文项，中文环境下不友好）
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.reload(),
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '诊断信息（发给开发者）',
          // ★ 必须带快捷键：窗口用了 titleBarStyle:'hidden'，系统菜单栏
          //   默认不显示，用户点不到这个菜单项。accelerator 与菜单栏可见性无关，
          //   任何时候按 Ctrl+Shift+D 都能唤出诊断窗口。
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => showDiagnostics(),
        },
        {
          label: '打开日志目录',
          click: () => { try { shell.openPath(getLogDir()); } catch { /* 忽略 */ } },
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  // 已有实例在跑（锁没拿到）→ 直接退出，别去抢端口
  if (!gotTheLock) {
    app.quit();
    return;
  }

  startServer();
  try {
    await waitForServer();
    serverReady = true;
  } catch (e) {
    dialog.showErrorBox('启动失败', `${e.message}\n请查看应用目录下的 server.log`);
    app.quit();
    return;
  }
  createWindow();

  /**
   * ★ 窗口可见性看护（不再弹浏览器）。
   *
   * 之前这里有个兜底：窗口连续 3 次检查都不可见，就用系统浏览器打开页面。
   * 用户反馈「关掉软件后网页版会自己弹出来」——那正是这个逻辑干的，
   * 属于超出用户预期的行为，已去掉。
   *
   * 现在只做两件事：
   *   1. 打日志，说明窗口确实没显示出来（便于排查 GPU/驱动问题）；
   *   2. 把窗口重新 show 一次（有时是窗口被最小化/隐藏了）。
   * 绝不擅自打开外部浏览器。
   */
  let invisibleChecks = 0;
  const watchdog = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      invisibleChecks = 0;
      return;
    }
    if (++invisibleChecks < 3) return;
    clearInterval(watchdog);
    console.warn('[LibreTV] 窗口当前不可见（可能是 GPU 合成或驱动问题），已尝试重新显示');
    try {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } catch (e) {
      console.warn('[LibreTV] 重新显示窗口失败:', e && e.message);
    }
  }, 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProc) {
    try { serverProc.kill(); } catch { /* 已退出 */ }
  }
});

// 让页面能拿到版本号（用于「关于」里显示）
ipcMain.handle('app:version', () => app.getVersion());

// —— 桌面版自绘顶栏的窗口控制 ——
// titleBarStyle:'hidden' 隐藏了系统标题栏，页面自己画顶栏，
// 所以最小化/最大化/关闭要通过 IPC 转回来。
ipcMain.handle('window:is-maximized', () =>
  mainWindow ? mainWindow.isMaximized() : false
);

ipcMain.on('window:action', (_e, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  switch (action) {
    case 'min': mainWindow.minimize(); break;
    case 'max':
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
      break;
    case 'close': mainWindow.close(); break;
    default: break;
  }
});
