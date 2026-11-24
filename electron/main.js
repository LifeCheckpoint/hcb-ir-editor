const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { decodeThumb, decodeSheet } = require('./scan');
const { Worker } = require('node:worker_threads');
const { encodeGbk } = require('./gbk');
const toml = require('@iarna/toml');

// 雏形阶段：仅渲染本地静态界面，不加载任何远端内容。
app.setName('hcb-ir-editor');

const isDev = process.argv.includes('--dev');
const isMac = process.platform === 'darwin';

// 只允许解扫描过的目录里的文件
const roots = new Set();

function scanWorkerPath() {
  if (!app.isPackaged) return path.join(__dirname, 'scan-worker.js');
  const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'scan-worker.js');
  if (fs.existsSync(unpacked)) return unpacked;
  return path.join(process.resourcesPath, 'app', 'electron', 'scan-worker.js');
}
const insideRoots = (file) => {
  const abs = path.resolve(file);
  return [...roots].some((r) => abs === r || abs.startsWith(r + path.sep));
};

ipcMain.handle('res:pick', async () => {
  const r = await dialog.showOpenDialog({ title: '选择游戏目录', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

let scanSeq = 0;
let activeScan = null;

ipcMain.handle('res:scan', (event, dir) => {
  if (typeof dir !== 'string' || !dir) return { error: '目录为空' };
  const seq = ++scanSeq;
  if (activeScan) {
    const old = activeScan;
    activeScan = null;
    old.cancel();
    try {
      old.worker.terminate();
    } catch (_) {
      /* 已经退出 */
    }
  }

  const sender = event.sender;
  const send = (payload) => {
    if (!sender.isDestroyed()) sender.send('res:scan-progress', { scanId: seq, ...payload });
  };
  send({ phase: 'listing', percent: 0, text: '正在读取游戏目录…' });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (activeScan && activeScan.seq === seq) activeScan = null;
      resolve(value);
    };

    let worker;
    try {
      worker = new Worker(scanWorkerPath(), { workerData: { dir } });
    } catch (err) {
      const message = String((err && err.message) || err);
      send({ phase: 'error', text: '读取失败：' + message });
      finish({ error: message });
      return;
    }

    activeScan = {
      seq,
      worker,
      cancel: () => finish({ error: '已取消' }),
    };

    worker.on('message', (msg) => {
      if (seq !== scanSeq || !msg || typeof msg !== 'object') return;
      if (msg.type === 'progress') {
        send(msg.progress || {});
        return;
      }
      if (msg.type === 'done') {
        roots.add(path.resolve(dir));
        send({ phase: 'done', percent: 100, text: '游戏资源读取完成' });
        finish(msg.result);
        return;
      }
      if (msg.type === 'error') {
        const message = String(msg.error || '未知错误');
        send({ phase: 'error', text: '读取失败：' + message });
        finish({ error: message });
      }
    });

    worker.on('error', (err) => {
      if (seq !== scanSeq) return;
      const message = String((err && err.message) || err);
      send({ phase: 'error', text: '读取失败：' + message });
      finish({ error: message });
    });

    worker.on('exit', (code) => {
      if (seq !== scanSeq || settled) return;
      const message = '扫描线程退出（' + code + '）';
      send({ phase: 'error', text: '读取失败：' + message });
      finish({ error: message });
    });
  });
});

ipcMain.handle('res:thumb', (_e, req) => {
  if (!req || typeof req.file !== 'string' || !insideRoots(req.file)) return { error: '未扫描的文件' };
  try {
    return decodeThumb(req.file, req.off, req.size, req.w || 160);
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
});

ipcMain.handle('res:sheet', (_e, req) => {
  if (!req || typeof req.file !== 'string' || !insideRoots(req.file)) return { error: '未扫描的文件' };
  try {
    return decodeSheet(req.file, req.off, req.size, req.w || 420);
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
});

ipcMain.handle('res:audio', (_e, req) => {
  if (!req || typeof req.file !== 'string' || !insideRoots(req.file)) return { error: '未扫描的文件' };
  try {
    const fd = fs.openSync(req.file, 'r');
    const buf = Buffer.alloc(req.size);
    try {
      fs.readSync(fd, buf, 0, req.size, req.off);
    } finally {
      fs.closeSync(fd);
    }
    return { bytes: buf, magic: buf.subarray(0, 4).toString('latin1') };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
});

/* ---------- 项目文件 ---------- */

ipcMain.handle('project:pickOpen', async () => {
  const r = await dialog.showOpenDialog({
    title: '打开项目',
    filters: [{ name: 'hcb-ir-editor 项目', extensions: ['hcbproj', 'json'] }],
    properties: ['openFile'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('project:pickSave', async (_e, name) => {
  const r = await dialog.showSaveDialog({
    title: '保存项目',
    defaultPath: name || 'project.hcbproj',
    filters: [{ name: 'hcb-ir-editor 项目', extensions: ['hcbproj'] }],
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('project:read', (_e, file) => {
  try {
    return { text: fs.readFileSync(file, 'utf8'), path: file };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
});

ipcMain.handle('project:write', (_e, req) => {
  if (!req || typeof req.path !== 'string') return { error: '路径为空' };
  try {
    const file = req.path;
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, req.text, 'utf8');
    fs.renameSync(tmp, file);
    return { path: file, mtime: fs.statSync(file).mtimeMs };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
});

/* ---------- 映射表 ---------- */

const MAPPING_MAX = 4 * 1024 * 1024;

function readMappingFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) return { error: '不是文件' };
  if (stat.size > MAPPING_MAX) return { error: '映射表超过 4 MB' };
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  try {
    return { path: file, name: path.basename(file), raw, data: toml.parse(raw) };
  } catch (err) {
    const line = err && err.line ? '第 ' + err.line + ' 行：' : '';
    return { error: 'TOML 解析失败，' + line + String((err && err.message) || err) };
  }
}

ipcMain.handle('mapping:pick', async () => {
  const r = await dialog.showOpenDialog({
    title: '导入映射表',
    filters: [
      { name: 'TOML 映射表', extensions: ['toml'] },
      { name: '所有文件', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (r.canceled) return null;
  try {
    return readMappingFile(r.filePaths[0]);
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
});

ipcMain.handle('mapping:read', (_e, file) => {
  if (typeof file !== 'string' || !file) return { error: '路径为空' };
  try {
    return readMappingFile(file);
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
});

/* ---------- DSL 脚本 ---------- */

const DSL_MAX = 16 * 1024 * 1024;

ipcMain.handle('dsl:pick', async () => {
  const r = await dialog.showOpenDialog({
    title: '导入 DSL 脚本',
    filters: [
      { name: '脚本', extensions: ['txt', 'hcb', 'dat'] },
      { name: '所有文件', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dsl:pickSave', async (_e, name) => {
  const r = await dialog.showSaveDialog({
    title: '导出 DSL',
    defaultPath: name || 'script.txt',
    filters: [{ name: 'DSL 脚本', extensions: ['txt'] }],
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('dsl:write', (_e, req) => {
  if (!req || typeof req.path !== 'string' || typeof req.text !== 'string') return { error: '参数不对' };
  const { bytes, bad } = encodeGbk(req.text);
  if (bad.length) return { error: 'GBK 里没有这些字符：' + bad.slice(0, 12).join(' ') };
  try {
    const tmp = req.path + '.tmp';
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, req.path);
    return { path: req.path, size: bytes.length };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
});

ipcMain.handle('dsl:read', (_e, file) => {
  if (typeof file !== 'string' || !file) return { error: '路径为空' };
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { error: '不是文件' };
    if (stat.size > DSL_MAX) return { error: '文件超过 16 MB' };
    const buf = fs.readFileSync(file);
    return {
      path: file,
      name: path.basename(file),
      size: stat.size,
      bytes: buf.toString('base64'),
    };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 640,
    show: false,
    backgroundColor: '#f7f6f3',
    title: 'hcb-ir-editor',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 15 } : undefined,
    titleBarOverlay: isMac
      ? undefined
      : { color: '#f7f6f3', symbolColor: '#8f8d87', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      zoomFactor: 1,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  // 雏形里没有任何外链跳转需求，一律拦下，避免误开系统浏览器。
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // 菜单栏被移除后，Electron 不再自带刷新加速键。这里补一条开发期快捷键，
  // 保持 Ctrl/Cmd+R 与 F12 可用，正式版可以整段删掉。
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = isMac ? input.meta : input.control;
    if (mod && input.key.toLowerCase() === 'r') {
      event.preventDefault();
      win.webContents.reload();
    }
    if (input.key === 'F12') {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });

  return win;
}

if (isMac) {
  // macOS 保留系统菜单，复制/粘贴等快捷键才能生效。
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
} else if (isDev) {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'editMenu' }, { role: 'viewMenu' }])
  );
} else {
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
