/**
 * 后台视觉核验：离屏渲染的隐藏窗口，可模拟交互后截图，不占用桌面。
 * 用法：electron tools/capture.cjs shot.png [default|hover|select|menu|palette|smoke]
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { scanDirectory, decodeThumb, decodeSheet } = require('../electron/scan');
const { encodeGbk } = require('../electron/gbk');
const toml = require('@iarna/toml');

const out = process.argv[2] || 'shot.png';
const mode = process.argv[3] || 'default';
const root = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const GAME_DIR = process.env.GAME_DIR || '';
const FIXTURE = path.join(root, 'tests', 'fixture.txt');
const SAMPLE_MAP = path.join(root, 'mappings', 'sample.toml');
const SAKURA_MAP = path.join(root, 'mappings', 'sakura.toml');
const MAP_FILE = process.env.MAP_FILE || SAKURA_MAP;

// 和 electron/main.js 一样的通道，方便离屏测试扫描
ipcMain.handle('res:scan', (_e, dir) => scanDirectory(dir));
ipcMain.handle('res:thumb', (_e, req) => decodeThumb(req.file, req.off, req.size, req.w));
ipcMain.handle('res:sheet', (_e, req) => decodeSheet(req.file, req.off, req.size, req.w));
ipcMain.handle('res:audio', (_e, req) => {
  const fd = fs.openSync(req.file, 'r');
  const buf = Buffer.alloc(req.size);
  try {
    fs.readSync(fd, buf, 0, req.size, req.off);
  } finally {
    fs.closeSync(fd);
  }
  return { bytes: buf, magic: buf.subarray(0, 4).toString('latin1') };
});

ipcMain.handle('project:pickOpen', async () => null);
ipcMain.handle('project:pickSave', async () => null);
ipcMain.handle('project:read', (_e, file) => {
  try {
    return { text: fs.readFileSync(file, 'utf8'), path: file };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});
ipcMain.handle('project:write', (_e, req) => {
  try {
    fs.writeFileSync(req.path, req.text, 'utf8');
    return { path: req.path, mtime: fs.statSync(req.path).mtimeMs };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});
ipcMain.handle('res:pick', async () => null);
ipcMain.handle('mapping:pick', async () => {
  const file = path.join(root, 'mappings', 'sample.toml');
  const raw = fs.readFileSync(file, 'utf8');
  return { path: file, name: path.basename(file), raw, data: toml.parse(raw) };
});
ipcMain.handle('mapping:read', (_e, file) => {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return { path: file, name: path.basename(file), raw, data: toml.parse(raw) };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});
ipcMain.handle('dsl:pick', async () => null);
ipcMain.handle('dsl:pickSave', async () => path.join(root, 'shots', 'export.txt'));
ipcMain.handle('dsl:write', (_e, req) => {
  try {
    const { bytes, bad } = encodeGbk(req.text);
    if (bad.length) return { error: 'GBK 里没有这些字符：' + bad.slice(0, 12).join(' ') };
    fs.writeFileSync(req.path, bytes);
    return { path: req.path, size: bytes.length };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});
ipcMain.handle('dsl:read', (_e, file) => {
  try {
    const stat = fs.statSync(file);
    return { path: file, name: path.basename(file), size: stat.size, bytes: fs.readFileSync(file).toString('base64') };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    backgroundColor: '#f7f6f3',
    webPreferences: {
      preload: path.join(root, 'electron', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      offscreen: true,
      backgroundThrottling: false,
      partition: 'capture',
    },
  });
  win.webContents.setFrameRate(30);

  const errors = [];
  let latest = null;
  win.webContents.on('paint', (_e, _dirty, image) => {
    latest = image;
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });

  await win.loadFile(path.join(root, 'src', 'index.html'));
  await wait(600);

  const run = (code) => win.webContents.executeJavaScript(code, true);

  const forceHover = async (selector) => {
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('DOM.enable');
    await win.webContents.debugger.sendCommand('CSS.enable');
    const doc = await win.webContents.debugger.sendCommand('DOM.getDocument');
    const node = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
    await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId: node.nodeId, forcedPseudoClasses: ['hover'] });
    await wait(220);
  };

  const CONTENT_MODES = new Set(['hover', 'measure', 'select', 'menu', 'blockmenu', 'palette', 'primitives', 'bs', 'sprites', 'scansprites']);
  if (CONTENT_MODES.has(mode)) {
    await run('window.DSL.importFile(' + JSON.stringify(FIXTURE) + ')');
    await wait(350);
  }

  if (mode === 'resource') {
    await run(`document.querySelector('.workspace-switch__btn[data-workspace="resource"]').click()`);
    await wait(400);
  } else if (mode === 'resbg') {
    await run(`document.querySelector('.workspace-switch__btn[data-workspace="resource"]').click()`);
    await wait(250);
    await run(`document.querySelectorAll('[data-archive]')[1].click()`);
    await wait(350);
  } else if (mode === 'resvoice') {
    await run(`document.querySelector('.workspace-switch__btn[data-workspace="resource"]').click()`);
    await wait(250);
    await run(`document.querySelector('[data-archive="7"]').click()`);
    await wait(350);
  } else if (mode === 'hover') {
    await forceHover('.block[data-type="bg"]');
  } else if (mode === 'measure') {
    await forceHover('.block[data-type="bg"]');
    const m = await run(`(() => {
      const b = document.querySelector('.block[data-type="bg"]');
      const btn = b.querySelector('.block__add');
      const ic = btn.querySelector('svg');
      const head = b.querySelector('.block__head');
      const r = (n) => { const x = n.getBoundingClientRect(); return { x: +x.x.toFixed(2), y: +x.y.toFixed(2), w: +x.width.toFixed(2), h: +x.height.toFixed(2), cx: +(x.x + x.width / 2).toFixed(2), cy: +(x.y + x.height / 2).toFixed(2) }; };
      return { block: r(b), btn: r(btn), icon: r(ic), head: r(head) };
    })()`);
    console.log(JSON.stringify(m, null, 2));
    app.quit();
    return;
  } else if (mode === 'select') {
    await run(`document.querySelector('.block[data-type="bg"]').click()`);
    await wait(150);
    await run(`document.querySelector('.select-trigger').click()`);
    await wait(450);
  } else if (mode === 'menu') {
    await run(`(() => {
      const n = document.querySelector('.chapter');
      const r = n.getBoundingClientRect();
      n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 60, clientY: r.top + 12 }));
    })()`);
    await wait(450);
  } else if (mode === 'menubar') {
    await run(`document.querySelector('.menu-btn[data-menu="file"]').click()`);
    await wait(400);
  } else if (mode === 'blockmenu') {
    await run(`(() => {
      const n = document.querySelectorAll('.block')[2];
      const r = n.getBoundingClientRect();
      n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 260, clientY: r.top + 22 }));
    })()`);
    await wait(450);
  } else if (mode === 'palette') {
    await run(`document.querySelector('.add-row').click()`);
    await wait(450);
  } else if (mode === 'primitives') {
    await run(`document.querySelector('.block[data-type="sel"]').click()`);
    await wait(250);
  } else if (mode === 'bs') {
    await run(`document.querySelector('.block[data-type="bs"]').click()`);
    await wait(250);
  } else if (mode === 'bindings') {
    await run(`(async () => {
      const res = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
      window.RES.setScan(res);
      document.querySelector('.workspace-switch__btn[data-workspace="resource"]').click();
    })()`);
    await wait(700);
    await run(`document.querySelector('[data-view="bindings"]').click()`);
    await wait(400);
  } else if (mode === 'scan' || mode === 'scanbs' || mode === 'scanbg' || mode === 'scanaudio') {
    await run(`(async () => {
      const res = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
      window.RES.setScan(res);
      document.querySelector('.workspace-switch__btn[data-workspace="resource"]').click();
    })()`);
    await wait(900);
    const idx = mode === 'scanbs' ? 3 : mode === 'scanbg' ? 2 : mode === 'scanaudio' ? 0 : -1;
    if (idx >= 0) {
      await run(`document.querySelectorAll('[data-archive]')[${idx}].click()`);
      await wait(300);
      await run(`document.querySelector('.res-table tbody tr').click()`);
      await wait(2600);
    }
  } else if (mode === 'scansprites') {
    await run(`(async () => {
      const res = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
      window.RES.setScan(res);
    })()`);
    await wait(600);
    await run(`document.querySelector('.block[data-type="bs"]').click()`);
    await wait(200);
    await run(`document.querySelector('.sprite-pick').click()`);
    await wait(7000);
  } else if (mode === 'sprites') {
    await run(`document.querySelector('.block[data-type="bs"]').click()`);
    await wait(150);
    await run(`document.querySelector('.sprite-pick').click()`);
    await wait(450);
  } else if (mode === 'dsl') {
    await run('window.DSL.importFile(' + JSON.stringify(FIXTURE) + ')');
    await wait(500);
    await run('window.DSL.open({ path: ' + JSON.stringify(FIXTURE) + ' })');
    await wait(700);
    await run("document.querySelectorAll('.imp__target .segmented__item')[1].click()");
    await wait(350);
  } else if (mode === 'dslreal') {
    const t0 = Date.now();
    const res = await run('window.DSL.importFile(' + JSON.stringify(path.join(root, '.ref', 'Script.txt')) + ')');
    const ms = Date.now() - t0;
    const info = await run(`(() => ({
      blocks: document.querySelectorAll('.block').length,
      scenes: document.querySelectorAll('.scene-item').length,
      chapters: document.querySelectorAll('.chapter').length,
      firstBg: document.querySelector('.block[data-type="bg"] .block__text')?.textContent,
      inspectorCode: document.querySelector('.inspector-code')?.textContent,
    }))()`);
    const exportInfo = await run(`(() => {
      const text = window.DSL.exportText();
      const p = window.HCB_DSL.parse(text, { split: false });
      const pb = window.PROJECT.chapters().reduce((n, ch) => n + ch.scenes.reduce((m, sc) => m + sc.blocks.length, 0), 0);
      return { chars: text.length, blocks: p.stats.blocks, projectBlocks: pb, match: p.stats.blocks === pb };
    })()`);
    await run(`(() => {
      const d = document.querySelectorAll('.block[data-type="dia"]')[0];
      if (d) { d.click(); d.scrollIntoView({ block: 'center' }); }
    })()`);
    await wait(450);
    const extraInfo = await run(`(() => {
      const ch = window.PROJECT.serialize().story.chapters[0];
      const all = ch.scenes.flatMap((s) => s.blocks);
      const b = all.find((x) => x.type === 'dia' && x.extra);
      if (b) document.querySelector('[data-block-id="' + b.id + '"]').click();
      const sizeField = [...document.querySelectorAll('#inspector .field')].find((f) => f.textContent.includes('字号'));
      const custom = all.find((x) => x.type === 'custom');
      return {
        extraData: b ? b.data : null,
        extraTail: b ? b.extra : null,
        extraCode: b ? document.querySelector('.inspector-code').textContent : null,
        extraSize: sizeField ? sizeField.querySelector('input').value : null,
        customLine: custom ? custom.data.line : null,
        customText: custom ? document.querySelector('[data-block-id="' + custom.id + '"] .block__text').textContent : null,
      };
    })()`);
    console.log(JSON.stringify({ imported: !!res, ms, ...info, exportInfo, extraInfo }, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'encoding') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.PROJECT.newProject();
      await window.DSL.open({ path: ${JSON.stringify(path.join(root, '.ref', 'Script.txt'))} });
      await wait(700);
      const q = (s) => document.querySelector(s);
      const out = {
        autoStats: q('.imp__stats')?.textContent.replace(/\s+/g, ' ').trim(),
        autoOk: !q('.imp__ok').disabled,
        encNote: q('.imp__encnote')?.textContent,
      };
      q('.imp__enc .select-trigger').click();
      await wait(120);
      [...document.querySelectorAll('.select-option')].find((n) => n.textContent.trim() === 'UTF-8').click();
      await wait(250);
      out.utf8Error = q('.imp__err')?.textContent;
      out.utf8Ok = !q('.imp__ok').disabled;
      q('.imp__enc .select-trigger').click();
      await wait(120);
      [...document.querySelectorAll('.select-option')].find((n) => n.textContent.trim() === 'GBK / GB18030').click();
      await wait(300);
      out.gbkStats = q('.imp__stats')?.textContent.replace(/\s+/g, ' ').trim();
      out.gbkOk = !q('.imp__ok').disabled;
      q('.imp__enc .select-trigger').click();
      await wait(120);
      [...document.querySelectorAll('.select-option')].find((n) => n.textContent.trim().startsWith('自动')).click();
      await wait(300);
      out.autoOkAgain = !q('.imp__ok').disabled;
      out.chapterOptions = (() => {
        document.querySelectorAll('.imp__target .segmented__item')[1].click();
        return document.querySelector('.imp__chapter .select-trigger__label')?.textContent;
      })();
      window.DSL.close();
      return out;
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
    app.quit();
    return;
  } else if (mode === 'dslapply') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(FIXTURE)});
      const flat = (ch) => ch.scenes.reduce((n, sc) => n + sc.blocks.length, 0);
      const before = window.PROJECT.serialize().story.chapters[0];
      const out = { scenesBefore: before.scenes.length, blocksBefore: flat(before) };

      await window.DSL.open({ path: ${JSON.stringify(FIXTURE)} });
      await wait(700);
      document.querySelectorAll('.imp__target .segmented__item')[1].click();
      await wait(250);
      out.chapterOkEnabled = !document.querySelector('.imp__ok').disabled;
      document.querySelector('.imp__ok').click();
      await wait(500);
      out.closedAfterChapter = !document.querySelector('.imp');
      const mid = window.PROJECT.serialize().story.chapters[0];
      out.scenesAfterChapter = mid.scenes.length;
      out.blocksAfterChapter = flat(mid);

      await window.DSL.open({ path: ${JSON.stringify(FIXTURE)} });
      await wait(700);
      document.querySelectorAll('.imp__target .segmented__item')[2].click();
      await wait(300);
      out.sceneOkEnabled = !document.querySelector('.imp__ok').disabled;
      document.querySelector('.imp__ok').click();
      await wait(500);
      out.closedAfterScene = !document.querySelector('.imp');
      const after = window.PROJECT.serialize().story.chapters[0];
      out.scenesAfterScene = after.scenes.length;
      out.blocksAfterScene = flat(after);
      out.firstSceneBlocks = after.scenes[0].blocks.length;
      return out;
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
    app.quit();
    return;
  } else if (mode === 'reload') {
    const first = await run(`(async () => {
      await window.DSL.importFile(${JSON.stringify(FIXTURE)});
      return await window.PROJECT.saveTo(${JSON.stringify(path.join(root, 'shots', 'reload.hcbproj'))});
    })()`);
    win.webContents.reload();
    await wait(1500);
    const after = await run(`({
      name: document.querySelector('.titlebar__project').textContent,
      chapters: document.querySelectorAll('.chapter').length,
      scenes: document.querySelectorAll('.scene-item').length,
      blocks: document.querySelectorAll('.block').length,
      path: window.PROJECT.path(),
      dirty: window.PROJECT.isDirty(),
      last: localStorage.getItem('hcb.lastProject'),
      start: !!document.querySelector('.start'),
    })`);
    // 记录的项目文件被删掉后，启动应回到空状态
    fs.unlinkSync(path.join(root, 'shots', 'reload.hcbproj'));
    win.webContents.reload();
    await wait(1400);
    const missing = await run(`({
      start: !!document.querySelector('.start'),
      chapters: document.querySelectorAll('.chapter').length,
      last: localStorage.getItem('hcb.lastProject'),
      name: document.querySelector('.titlebar__project').textContent,
    })`);
    console.log(JSON.stringify({ saved: !!first, ...after, missing }, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
    app.quit();
    return;
  } else if (mode === 'empty') {
    await run('window.PROJECT.newProject()');
    await wait(250);
  } else if (mode === 'broken') {
    await run('window.DSL.importFile(' + JSON.stringify(FIXTURE) + ')');
    await wait(300);
    await run('(async () => { const res = await window.shell.scanResources(' + JSON.stringify(GAME_DIR) + '); window.RES.setScan(res); })()');
    await wait(1000);
    await run("(() => { const n = [...document.querySelectorAll('.block[data-type=\"bg\"]')].find((x) => x.textContent.includes('校门')); if (n) n.click(); })()");
    await wait(600);
  } else if (mode === 'copy') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(FIXTURE)});
      await wait(400);
      document.querySelector('.block[data-type="bs"]').click();
      await wait(200);
      const code = document.querySelector('.inspector-code');
      const block = document.querySelector('.block[data-type="bs"]');
      const bc = block.querySelector('.block__code');
      const sel = window.getSelection();
      const pick = (node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        sel.removeAllRanges();
        sel.addRange(range);
        return sel.toString();
      };
      return {
        userSelect: getComputedStyle(code).userSelect,
        inspectorSel: pick(code),
        blockSel: pick(bc),
        afterClick: (bc.click(), sel.toString()),
        same: (bc.click(), sel.toString()) === pick(bc),
      };
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
    app.quit();
    return;
  } else if (mode === 'custom') {
    await run('window.DSL.importFile(' + JSON.stringify(FIXTURE) + ')');
    await wait(400);
    await run("document.querySelector('.block[data-type=\"custom\"]').click()");
    await wait(350);
  } else if (mode === 'comments') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.DSL.importText('[start]\\n[msg,boxin]\\n# [msg,boxout]\\n[bg,500]\\n', { target: 'new', name: 'comments', split: false });
      await wait(350);
      const out = {};
      const clickType = (type) => {
        const node = [...document.querySelectorAll('.block')].find((n) => n.dataset.type === type);
        if (node) node.click();
        return node;
      };
      clickType('msg');
      await wait(80);
      out.before = window.DSL.exportText();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', ctrlKey: true, bubbles: true }));
      await wait(250);
      out.afterComment = window.DSL.exportText();
      out.noteData = [...document.querySelectorAll('.block[data-type="note"]')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim());
      clickType('note');
      await wait(80);
      out.sourceBeforeRestore = !!(selectedBlocks()[0] && selectedBlocks()[0].block.commentSource);
      toggleSelectedComments();
      await wait(250);
      out.afterRestore = window.DSL.exportText();
      out.restoredType = [...document.querySelectorAll('.block')].some((n) => n.dataset.type === 'msg' && n.textContent.includes('boxin'));
      const hit = listOfBlock(state.blockId);
      const bad = { id: nid(), type: 'note', data: { text: '这不是一条指令' } };
      hit.list.push(bad);
      selectBlock(bad.id);
      await wait(120);
      toggleSelectedComments();
      await wait(150);
      const banner = document.querySelector('.banner--error');
      out.invalidKeptNote = !![...document.querySelectorAll('.block[data-type="note"]')].find((n) => n.textContent.includes('这不是一条指令'));
      out.invalidBanner = banner ? banner.textContent.trim() : '';
      out.invalidBannerClass = banner ? banner.className : '';
      await wait(2800);
      out.invalidBannerGone = !document.querySelector('.banner--error');
      return out;
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
    app.quit();
    return;
  } else if (mode === 'wire') {
    await run('window.DSL.importFile(' + JSON.stringify(FIXTURE) + ')');
    await wait(300);
    await run('(async () => { const res = await window.shell.scanResources(' + JSON.stringify(GAME_DIR) + '); window.RES.setScan(res); })()');
    await wait(1000);
    await run("(() => { const n = [...document.querySelectorAll('.block[data-type=\"bg\"]')].find((x) => x.textContent.includes('67')); if (n) n.click(); })()");
    await wait(2600);
  } else if (mode === 'nomap') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(path.join(root, 'tests', 'fixture.txt'))});
      await wait(500);
      const out = { mapping: window.MAPPING.has(), path: window.MAPPING.path() };
      const bs = document.querySelector('.block[data-type="bs"]');
      if (bs) bs.click();
      await wait(300);
      out.bsNumbers = document.querySelectorAll('.sprite-numbers input[type="number"]').length;
      out.bsPicker = !!document.querySelector('.sprite-pick');
      out.bsField = document.querySelector('.sprite-pick') ? 'picker' : document.querySelector('.sprite-numbers') ? 'numbers' : 'none';
      out.bsText = bs ? bs.textContent.replace(/\s+/g, ' ').trim() : null;
      const bg = document.querySelector('.block[data-type="bg"]');
      if (bg) bg.click();
      await wait(300);
      out.bgNumbers = document.querySelectorAll('#inspector input[type="number"]').length;
      out.bgSelect = document.querySelectorAll('#inspector .select').length;
      out.bgText = bg ? bg.textContent.replace(/\s+/g, ' ').trim() : null;
      const cha = document.querySelector('.block[data-type="cha"]');
      if (cha) cha.click();
      await wait(300);
      out.chaSelect = document.querySelectorAll('#inspector .select').length;
      out.chaText = cha ? cha.textContent.replace(/\s+/g, ' ').trim() : null;
      const move = document.querySelector('.block[data-type="bs_move"]');
      if (move) move.click();
      await wait(250);
      out.moveNumbers = document.querySelectorAll('#inspector input[type="number"]').length;
      out.moveSelect = document.querySelectorAll('#inspector .select').length;
      if (bs) bs.click();
      await wait(200);
      out.serializedPath = window.PROJECT.serialize().mapping ? window.PROJECT.serialize().mapping.path : null;
      return out;
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'bg501') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(path.join(root, '.ref', 'Script.txt'))});
      const scan = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
      window.RES.setScan(scan);
      await wait(700);
      const mapRes = await window.shell.readMapping(${JSON.stringify(MAP_FILE)});
      window.MAPPING.load(mapRes);
      window.PROJECT.mappingChanged();
      await wait(600);
      const bg = [...document.querySelectorAll('.block[data-type="bg"]')].find((n) => n.textContent.includes('501'));
      if (!bg) return { error: 'no bg 501 block' };
      bg.click();
      await wait(500);
      return {
        text: bg.textContent.replace(/\s+/g, ' ').trim(),
        wire: document.querySelector('.wire__text')?.textContent,
        mappingRow: window.MAPPING.bg(501),
        blockFile: window.WIRING.bgFile(501),
      };
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'multi') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(FIXTURE)});
      await wait(500);
      const dias = () => [...document.querySelectorAll('.block[data-type="dia"]')];
      const total = () => window.PROJECT.serialize().story.chapters[0].scenes.reduce((n, sc) => n + sc.blocks.reduce(function walk(m, b) { return m + 1 + (b.children ? b.children.reduce(walk, 0) : 0); }, 0), 0);
      const selectedTexts = () => state.selectedIds.map((id) => {
        const hit = listOfBlock(id);
        const b = hit && hit.list.find((x) => x.id === id);
        return b && b.data ? b.data.text : null;
      });
      let d = dias();
      d[0].click();
      await wait(150);
      d = dias();
      d[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      await wait(250);
      const out = {
        selected: state.selectedIds.length,
        title: document.querySelector('.inspector-title')?.textContent,
        hasTextarea: !!document.querySelector('#inspector textarea.control'),
      };
      // 结构操作也要能撤销
      const totalBefore = total();
      dias()[0].click();
      await wait(150);
      document.querySelector('.inspector-foot .btn-ghost:last-child').click();
      await wait(250);
      out.deletedTotal = total();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      await wait(300);
      out.restoreTotal = total();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
      await wait(300);
      out.redoDeleteTotal = total();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      await wait(300);
      out.restoreAgain = total();
      out.totalBefore = totalBefore;

      let dd = dias();
      dd[0].click();
      await wait(150);
      dd = dias();
      dd[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      await wait(250);
      out.selectedAfterStruct = state.selectedIds.length;
      out.titleAfterStruct = document.querySelector('.inspector-title')?.textContent;

      const ta = document.querySelector('#inspector textarea.control');
      out.before = selectedTexts();
      out.selectedTypes = state.selectedIds.map((id) => { const h = listOfBlock(id); const b = h && h.list.find((x) => x.id === id); return b && b.type; });
      out.inspectorHtml = document.querySelector('.inspector-body')?.innerHTML.slice(0, 500);
      if (!ta) return out;
      ta.value = '批量修改的台词';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(300);
      out.after = selectedTexts();
      out.undo = window.HISTORY.canUndo();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      await wait(300);
      out.undoText = selectedTexts();
      out.undoSelected = state.selectedIds.length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
      await wait(300);
      out.redoText = selectedTexts();

      const dia = dias()[0];
      dia.click();
      await wait(150);
      document.querySelector('.block[data-type="bg"]').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      await wait(250);
      out.mixedTitle = document.querySelector('.inspector-title')?.textContent;
      out.mixedNote = document.querySelector('.inspector-body .note-line')?.textContent;

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
      await wait(250);
      out.allSelected = state.selectedIds.length;
      out.allBlocks = orderedChapterBlocks().length;

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      await wait(300);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(150);
      d = dias();
      d[0].click();
      await wait(150);
      d = dias();
      d[d.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      await wait(250);
      out.shiftSelected = state.selectedIds.length;
      out.shiftPrimary = state.blockId;
      d = dias();
      d[0].click();
      await wait(150);
      d = dias();
      d[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      await wait(300);
      out.finalTitle = document.querySelector('.inspector-title')?.textContent;
      out.finalPlaceholder = document.querySelector('#inspector textarea.control')?.placeholder;
      out.finalSelected = state.selectedIds.length;

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(150);
      let bss = [...document.querySelectorAll('.block[data-type="bs"]')];
      bss[0].click();
      await wait(150);
      bss = [...document.querySelectorAll('.block[data-type="bs"]')];
      bss[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      await wait(300);
      out.bsTitle = document.querySelector('.inspector-title')?.textContent;
      out.bsSelected = state.selectedIds.length;
      out.bsSelects = document.querySelectorAll('#inspector .select').length;
      out.bsSegments = document.querySelectorAll('#inspector .segmented').length;
      out.bsVectorInputs = document.querySelectorAll('#inspector .field__vector input').length;
      out.bsNumbers = document.querySelectorAll('#inspector input[type="number"]').length;
      out.bsLabels = [...document.querySelectorAll('#inspector .field__label')].map((n) => n.textContent.trim());
      const firstHit = listOfBlock(state.selectedIds[0]);
      const firstBlock = firstHit && firstHit.list.find((x) => x.id === state.selectedIds[0]);
      if (firstBlock) { firstBlock.data.pos = 'l'; firstBlock.data.l = '0'; }
      renderInspector();
      await wait(200);
      out.mixedSegmented = !!document.querySelector('#inspector .segmented-wrap');

      const mapRes = await window.shell.readMapping(${JSON.stringify(MAP_FILE)});
      window.MAPPING.load(mapRes);
      window.PROJECT.mappingChanged();
      await wait(500);
      out.mappedBsPicker = !!document.querySelector('.sprite-pick');
      out.mappedBsSelects = document.querySelectorAll('#inspector .select').length;
      out.mappedBsSegments = document.querySelectorAll('#inspector .segmented').length;
      out.mappedBsVectorInputs = document.querySelectorAll('#inspector .field__vector input').length;
      out.mappedBsLabels = [...document.querySelectorAll('#inspector .field__label')].map((n) => n.textContent.trim());
      return out;
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'multifields') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(FIXTURE)});
      await wait(500);
      const ch = currentChapter();
      const list = ch.scenes[0].blocks;
      const types = Object.keys(TYPES).filter((t) => TYPES[t] && TYPES[t].fields && TYPES[t].fields.length);
      types.forEach((t) => { list.push(makeBlock(t)); list.push(makeBlock(t)); });
      renderAll();
      const missing = [];
      const summaries = [];
      for (const t of types) {
        const nodes = [...document.querySelectorAll('.block[data-type="' + t + '"]')];
        if (nodes.length < 2) { missing.push({ type: t, reason: 'nodes ' + nodes.length }); continue; }
        const a = nodes[nodes.length - 2];
        const b = nodes[nodes.length - 1];
        state.selectedIds = [a.dataset.blockId, b.dataset.blockId];
        state.blockId = b.dataset.blockId;
        state.anchorId = b.dataset.blockId;
        renderMain();
        renderInspector();
        const fields = [...document.querySelectorAll('#inspector .field')];
        const bad = fields.filter((f) => !f.querySelector('input,textarea,select,button,.segmented,.field__note,.sprite-numbers,.sprite-pick')).map((f) => f.querySelector('.field__label')?.textContent || '?');
        if (bad.length) missing.push({ type: t, bad });
        summaries.push({ type: t, fields: fields.length, bad: bad.length, title: document.querySelector('.inspector-title')?.textContent });
      }
      return { missing, summaries };
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'ctxmulti') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(FIXTURE)});
      await wait(500);
      const total = () => window.PROJECT.serialize().story.chapters[0].scenes.reduce((n, sc) => n + sc.blocks.reduce(function walk(m, b) { return m + 1 + (b.children ? b.children.reduce(walk, 0) : 0); }, 0), 0);
      const dias = () => [...document.querySelectorAll('.block[data-type="dia"]')];
      const openMenuOn = async (node) => {
        const r = node.getBoundingClientRect();
        node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 20 }));
        await wait(200);
        return [...document.querySelectorAll('.menu__item')].map((n) => n.textContent.trim());
      };
      let d = dias();
      d[0].click();
      await wait(150);
      d = dias();
      d[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      await wait(250);
      const out = { selected: state.selectedIds.length, total: total() };
      out.menu = await openMenuOn(dias()[1]);
      out.deleteMenu = out.menu.includes('删除 2 个块');
      [...document.querySelectorAll('.menu__item')].find((n) => n.textContent.includes('删除 2 个块')).click();
      await wait(300);
      out.afterDelete = total();
      out.selAfterDelete = state.selectedIds.length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      await wait(300);
      out.undoDelete = total();

      d = dias();
      d[0].click();
      await wait(150);
      d = dias();
      d[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      await wait(250);
      out.copyMenu = await openMenuOn(dias()[1]);
      out.copyMenuHas = out.copyMenu.includes('创建 2 个副本');
      [...document.querySelectorAll('.menu__item')].find((n) => n.textContent.includes('创建 2 个副本')).click();
      await wait(300);
      out.afterCopy = total();
      out.copySelected = state.selectedIds.length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      await wait(300);
      out.undoCopy = total();

      // 右键未选中的块：应该只选它，菜单回到单块
      d = dias();
      d[0].click();
      await wait(150);
      d = dias();
      d[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      await wait(250);
      const other = document.querySelector('.block[data-type="bg"]');
      const r = other.getBoundingClientRect();
      other.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 20 }));
      await wait(200);
      out.outsideMenu = [...document.querySelectorAll('.menu__item')].map((n) => n.textContent.trim());
      out.outsideSelected = state.selectedIds.length;
      return out;
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'focus') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(FIXTURE)});
      await wait(500);
      const out = { total: document.querySelectorAll('.block').length };
      const waits = [...document.querySelectorAll('.block[data-type="wait"]')];
      if (waits[0]) waits[0].click();
      await wait(150);
      document.querySelector('.menu-btn[data-menu="view"]').click();
      await wait(180);
      out.viewMenu = [...document.querySelectorAll('.menubar__drop .menu-item')].map((n) => n.textContent.trim());
      [...document.querySelectorAll('.menubar__drop .menu-item')].find((n) => n.textContent.includes('聚焦模式')).click();
      await wait(250);
      out.dialogTypes = document.querySelectorAll('.focus-type').length;
      document.querySelector('.focus-type[data-type="dia"]').click();
      document.querySelector('.focus-type[data-type="bg"]').click();
      out.countText = document.querySelector('.focus__count')?.textContent;
      document.querySelector('.focus .btn-primary').click();
      await wait(350);
      out.focusTypes = state.focusTypes;
      out.selectedAfterFocus = state.selectedIds.length;
      out.focusedBlocks = document.querySelectorAll('.block[data-type="dia"],.block[data-type="bg"]').length;
      out.otherBlocks = [...document.querySelectorAll('.block')].filter((n) => n.dataset.type !== 'dia' && n.dataset.type !== 'bg').length;
      out.gaps = [...document.querySelectorAll('.focus-gap')].map((n) => n.dataset.count);
      out.gapText = document.querySelector('.focus-gap')?.textContent;
      out.inspectorTitle = document.querySelector('.inspector-title')?.textContent || '';
      const gap = document.querySelector('.focus-gap');
      if (gap) {
        gap.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
        await wait(150);
      }
      out.menuAfterGap = document.querySelectorAll('.menu').length;
      selectAllBlocks();
      await wait(200);
      out.allSelected = state.selectedIds.length;
      out.focusedCount = [...document.querySelectorAll('.block')].length;
      try {
        const block = document.querySelector('.block[data-type="dia"]');
        const gap = [...document.querySelectorAll('.focus-gap')][1] || document.querySelector('.focus-gap');
        const dt = new DataTransfer();
        block.querySelector('.block__handle').dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        gap.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: gap.getBoundingClientRect().left + 8, clientY: gap.getBoundingClientRect().top + 2 }));
        gap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        await wait(300);
        out.gapDrop = 'ok';
      } catch (err) {
        out.gapDrop = String(err && err.message || err);
      }
      clearFocusTypes();
      await wait(250);
      out.afterClearGaps = document.querySelectorAll('.focus-gap').length;
      out.afterClearBlocks = document.querySelectorAll('.block').length;
      out.afterClearFocus = state.focusTypes.length;
      applyFocusTypes(['dia', 'bg']);
      await wait(250);
      return out;
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'focusdialog') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(FIXTURE)});
      await wait(450);
      openFocusDialog();
      await wait(250);
      document.querySelector('.focus-type[data-type="dia"]').click();
      document.querySelector('.focus-type[data-type="bg"]').click();
      await wait(200);
      return {
        types: document.querySelectorAll('.focus-type').length,
        selected: document.querySelectorAll('.focus-type.is-on').length,
        count: document.querySelector('.focus__count')?.textContent,
        panelHeight: document.querySelector('.focus').getBoundingClientRect().height,
        bodyScroll: document.querySelector('.focus__body').scrollHeight,
        bodyClient: document.querySelector('.focus__body').clientHeight,
      };
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'neighbor') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(FIXTURE)});
      await wait(500);
      const ch = currentChapter();
      const sc = ch.scenes.find((x) => x.blocks.some((b) => b.type === 'bg'));
      const list = sc.blocks;
      const marker = { id: nid(), type: 'bg', data: { id: '999', diff: '7' } };
      list.push(marker);
      const next = makeBlock('bg', { sc, list, index: list.length });
      const other = makeBlock('fog', { sc, list, index: list.length });
      const scenes = ch.scenes;
      let nextScene = null;
      for (let i = 0; i < scenes.length; i += 1) {
        if (scenes[i] === sc && scenes[i + 1]) nextScene = scenes[i + 1];
      }
      const atStart = nextScene ? makeBlock('bg', { sc: nextScene, list: nextScene.blocks, index: 0 }) : null;
      const anchor = { getBoundingClientRect: () => ({ left: 200, right: 200, top: 200, bottom: 200, width: 0, height: 0 }) };
      openPalette(anchor, sc, list, list.length);
      await wait(180);
      document.querySelector('.palette-item[data-type="bg"]').click();
      await wait(250);
      const inserted = list[list.length - 1];
      const paletteOk = inserted && inserted.type === 'bg' && JSON.stringify(inserted.data) === JSON.stringify(marker.data);
      return {
        paletteOk,
        sameScene: next.data,
        marker: marker.data,
        sameSceneOk: JSON.stringify(next.data) === JSON.stringify(marker.data),
        fallback: other.data,
        fallbackOk: JSON.stringify(other.data) === '{}',
        nextScene: atStart ? atStart.data : null,
        nextSceneOk: atStart ? JSON.stringify(atStart.data) === JSON.stringify(marker.data) : null,
      };
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'scanui') {
    win.webContents.send('res:scan-progress', { scanId: 1, phase: 'list', percent: 0, text: '正在读取游戏目录…' });
    await wait(200);
    win.webContents.send('res:scan-progress', {
      scanId: 1,
      phase: 'scan',
      completed: 3,
      total: 12,
      percent: 25,
      file: 'graph_bs.bin',
      text: '正在读取 graph_bs.bin',
    });
    await wait(300);
    const info = await run(`(() => ({
      hidden: document.getElementById('scan-progress').hidden,
      text: document.querySelector('.scan-progress__text').textContent,
      meta: document.querySelector('.scan-progress__meta').textContent,
      width: document.querySelector('.scan-progress__fill').style.width,
    }))()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'shortcuts') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(FIXTURE)});
      await wait(500);
      const total = () => window.PROJECT.serialize().story.chapters[0].scenes.reduce((n, sc) => n + sc.blocks.reduce(function walk(m, b) { return m + 1 + (b.children ? b.children.reduce(walk, 0) : 0); }, 0), 0);
      const key = (k, opts) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {})));
      const nodes = (t) => [...document.querySelectorAll('.block[data-type="' + t + '"]')];
      const pick = async (t) => { const list = nodes(t); list[0].click(); await wait(150); return list[0]; };
      const blockOfSelected = () => { const hit = listOfBlock(state.blockId); return hit && hit.list.find((b) => b.id === state.blockId); };
      const out = { total: total() };

      await pick('bg');
      const src = blockOfSelected();
      const srcData = JSON.parse(JSON.stringify(src.data));
      key('c', { ctrlKey: true });
      await wait(100);
      out.clipboard = hasBlockClipboard();
      const bgNodes = nodes('bg');
      bgNodes[bgNodes.length - 1].click();
      await wait(150);
      key('v', { ctrlKey: true });
      await wait(300);
      out.afterPaste = total();
      out.pasteSelected = state.selectedIds.length;
      const pasted = blockOfSelected();
      out.pasteType = pasted && pasted.type;
      out.pasteSame = pasted && JSON.stringify(pasted.data) === JSON.stringify(srcData);
      key('z', { ctrlKey: true });
      await wait(300);
      out.pasteUndo = total();

      let ds = nodes('dia');
      ds[0].click();
      await wait(150);
      ds = nodes('dia');
      ds[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      await wait(200);
      key('c', { ctrlKey: true });
      await wait(100);
      await pick('bg');
      key('v', { ctrlKey: true });
      await wait(300);
      out.multiPaste = total();
      out.multiPasteSelected = state.selectedIds.length;
      key('z', { ctrlKey: true });
      await wait(300);
      out.multiPasteUndo = total();

      await pick('wait');
      key('x', { ctrlKey: true });
      await wait(300);
      out.afterCut = total();
      out.cutClipboard = hasBlockClipboard();
      key('z', { ctrlKey: true });
      await wait(300);
      out.cutUndo = total();

      await pick('wait');
      key('Delete');
      await wait(300);
      out.afterDelete = total();
      key('z', { ctrlKey: true });
      await wait(300);
      out.deleteUndo = total();

      await pick('wait');
      key('k', { ctrlKey: true, shiftKey: true });
      await wait(300);
      out.afterShiftK = total();
      key('z', { ctrlKey: true });
      await wait(300);
      out.shiftKUndo = total();

      await pick('bs');
      const bsBefore = blockOfSelected();
      const bsData = JSON.parse(JSON.stringify(bsBefore.data));
      key('Enter', { ctrlKey: true });
      await wait(300);
      const below = blockOfSelected();
      out.afterNewBelow = total();
      out.newBelowType = below && below.type;
      out.newBelowSame = below && JSON.stringify(below.data) === JSON.stringify(bsData);
      key('z', { ctrlKey: true });
      await wait(300);
      out.newBelowUndo = total();

      await pick('bs');
      const bsAbove = blockOfSelected();
      const aboveData = JSON.parse(JSON.stringify(bsAbove.data));
      key('Enter', { ctrlKey: true, shiftKey: true });
      await wait(300);
      const above = blockOfSelected();
      out.afterNewAbove = total();
      out.newAboveSame = above && JSON.stringify(above.data) === JSON.stringify(aboveData);
      key('z', { ctrlKey: true });
      await wait(300);
      out.newAboveUndo = total();

      const bgMove = nodes('bg')[0];
      bgMove.click();
      await wait(150);
      const order = () => flatten(currentChapter().scenes.flatMap((sc) => sc.blocks));
      const beforeIndex = order().findIndex((b) => b.id === state.blockId);
      key('ArrowDown', { altKey: true });
      await wait(300);
      const afterIndex = order().findIndex((b) => b.id === state.blockId);
      out.moved = afterIndex > beforeIndex;
      key('z', { ctrlKey: true });
      await wait(300);

      document.querySelector('.menu-btn[data-menu="settings"]').click();
      await wait(200);
      const menu = [...document.querySelectorAll('.menubar__drop .menu-item')].map((n) => n.textContent.trim());
      [...document.querySelectorAll('.menubar__drop .menu-item')].find((n) => n.textContent.includes('键盘快捷键')).click();
      await wait(250);
      out.shortcutModal = !!document.querySelector('.shortcuts');
      out.shortcutRows = document.querySelectorAll('.shortcut-row').length;
      out.shortcutGroups = [...document.querySelectorAll('.shortcut-group__title')].map((n) => n.textContent);
      key('Escape');
      await wait(200);
      out.shortcutClosed = !document.querySelector('.shortcuts');
      key('k', { ctrlKey: true });
      await wait(250);
      out.ctrlK = !!document.querySelector('.shortcuts');
      out.menu = menu;
      return out;
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'loose') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const scan = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
      window.RES.setScan(scan);
      const archives = window.RES.archives();
      const voice = archives.find((a) => a.file === 'voice.bin');
      const index = archives.indexOf(voice);
      document.querySelector('.workspace-switch__btn[data-workspace="resource"]').click();
      await wait(250);
      document.querySelector('[data-archive="' + index + '"]').click();
      await wait(250);
      return {
        scanArchives: scan.archives.length,
        voice: voice && { count: voice.count, loose: voice.loose, looseCount: voice.looseCount, looseOnly: voice.looseOnly, magic: voice.magic },
        navText: document.querySelector('[data-archive="' + index + '"]')?.textContent,
        title: document.querySelector('.res-title')?.textContent,
        rows: document.querySelectorAll('.res-table tbody tr').length,
        firstRows: [...document.querySelectorAll('.res-table tbody tr')].slice(0, 5).map((tr) => tr.textContent.trim()),
      };
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'previewtest') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        await window.DSL.importFile(${JSON.stringify(FIXTURE)});
        await wait(500);
        const black = [...document.querySelectorAll('.block')].find((n) => n.dataset.type === 'black');
        black.click();
        await wait(300);
        const preview = document.getElementById('preview');
        const out = {
          preview: !!preview,
          inspectorStage: !!document.querySelector('#inspector .stage'),
          stage: !!preview?.querySelector('.stage'),
          screenText: preview?.querySelector('.stage__screen')?.textContent || '',
          bgLabel: !!preview?.querySelector('.stage__bgname'),
          audioLabel: !!preview?.querySelector('.stage__audio'),
          toolbar: preview?.querySelectorAll('.preview__btn').length,
          block: state.blockId,
        };
        preview.querySelector('[data-preview-min]').click();
        await wait(250);
        out.minClass = preview.classList.contains('is-min');
        out.minWidth = preview.offsetWidth;
        preview.querySelector('[data-preview-bubble]').click();
        await wait(250);
        out.expanded = !preview.classList.contains('is-min');
        out.expandedWidth = preview.offsetWidth;
        const before = state.blockId;
        preview.querySelector('[data-preview-body]').click();
        await wait(300);
        out.nextChanged = state.blockId !== before;
        return out;
      } catch (err) {
        return { error: String(err && err.message || err), stack: err && err.stack };
      }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'previewaudio') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        await window.DSL.importFile(${JSON.stringify(FIXTURE)});
        const scan = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
        window.RES.setScan(scan);
        const mapRes = await window.shell.readMapping(${JSON.stringify(SAKURA_MAP)});
        window.MAPPING.load(mapRes);
        window.PROJECT.mappingChanged();
        await wait(500);
        document.querySelector('.block[data-type="bgm"]').click();
        await wait(900);
        const preview = document.getElementById('preview');
        const btn = preview?.querySelector('[data-preview-audio]');
        const out = { preview: !!preview, button: !!btn, disabled: btn?.disabled, title: btn?.title };
        if (btn) { btn.click(); await wait(250); out.titleAfter = btn.title; }
        return out;
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'dialogue') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.DSL.importText('[bg,500]\\n[dia,旁白甲]\\n[cha,其他角色/落叶,1003]\\n[dia,对话一]\\n[dia,对话二]\\n[bg,67]\\n[dia,旁白乙]', { target: 'new', name: 'dialog test' });
        await wait(400);
        return [...document.querySelectorAll('.block[data-type="dia"]')].map((n) => {
          const hit = listOfBlock(n.dataset.blockId);
          const b = hit && hit.list.find((x) => x.id === n.dataset.blockId);
          return {
            text: b?.data?.text,
            viewSpeaker: b ? viewOf(b).speaker : null,
            stageSpeaker: b ? stageState(hit.scene, b).speaker : null,
          };
        });
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'previewdia') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.DSL.importText('[bg,500]\\n[dia,旁白甲]\\n[cha,其他角色/落叶,1003]\\n[dia,对话一]\\n[dia,对话二]', { target: 'new', name: 'dialog test' });
        await wait(400);
        const dia = [...document.querySelectorAll('.block[data-type="dia"]')].find((n) => n.textContent.includes('对话一'));
        dia.click();
        await wait(300);
        const box = document.querySelector('#preview .stage__box');
        const txt = document.querySelector('#preview .stage__text');
        const speaker = document.querySelector('#preview .stage__speaker');
        const cs = box ? getComputedStyle(box) : null;
        const ts = txt ? getComputedStyle(txt) : null;
        return {
          box: !!box,
          z: cs?.zIndex,
          background: cs?.backgroundColor,
          text: txt?.textContent,
          color: ts?.color,
          stroke: ts?.webkitTextStroke,
          speaker: speaker?.textContent,
          speakerColor: speaker ? getComputedStyle(speaker).color : null,
        };
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'previewmin') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(FIXTURE)});
      await wait(400);
      document.querySelector('.block[data-type="bg"]').click();
      await wait(250);
      const p = document.getElementById('preview');
      const left = p.style.left;
      p.querySelector('[data-preview-min]').click();
      await wait(400);
      const cs = getComputedStyle(p);
      return { beforeLeft: left, afterLeft: p.style.left, width: p.offsetWidth, height: p.offsetHeight, radius: cs.borderRadius, min: p.classList.contains('is-min') };
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'richtext') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.DSL.importText('[cha,其他角色/落叶,1003]\\n[dia,你好abc~第二行[A|园][B|区]]', { target: 'new', name: 'rich' });
        await wait(400);
        document.querySelector('.block[data-type="dia"]').click();
        await wait(300);
        const t = document.querySelector('#preview .stage__text');
        return {
          text: t?.textContent,
          html: t?.innerHTML,
          ruby: t?.querySelectorAll('ruby').length,
          rt: t?.querySelector('rt')?.textContent,
          br: t?.querySelectorAll('br').length,
        };
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'emphasis') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.DSL.importText('[dia,你好abc]', { target: 'new', name: 'em' });
        await wait(400);
        document.querySelector('.block[data-type="dia"]').click();
        await wait(250);
        const ta = document.querySelector('#inspector textarea');
        ta.focus();
        ta.setSelectionRange(0, 5);
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
        await wait(250);
        const marked = ta.value;
        ta.focus();
        ta.setSelectionRange(0, marked.length);
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
        await wait(250);
        return { marked, plain: ta.value, selection: [ta.selectionStart, ta.selectionEnd] };
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'previewdrag') {
    await run(`window.DSL.importFile(${JSON.stringify(FIXTURE)})`);
    await wait(400);
    await run(`document.querySelector('.block[data-type="bg"]').click()`);
    await wait(250);
    await run(`document.querySelector('[data-preview-min]').click()`);
    await wait(350);
    const before = await run(`(() => {
      const p = document.getElementById('preview');
      const r = p.querySelector('[data-preview-bubble]').getBoundingClientRect();
      return { left: p.style.left, top: p.style.top, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), min: p.classList.contains('is-min') };
    })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: before.x, y: before.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: before.x + 40, y: before.y + 20, button: 'left' });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: before.x + 40, y: before.y + 20, button: 'left', clickCount: 1 });
    await wait(350);
    const after = await run(`(() => {
      const p = document.getElementById('preview');
      return { left: p.style.left, top: p.style.top, min: p.classList.contains('is-min'), width: p.offsetWidth };
    })()`);
    console.log(JSON.stringify({ before, after }, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'bgafter') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.DSL.importText('[cha,其他角色/落叶,1003]\\n[dia,测试台词]\\n[bg,500]', { target: 'new', name: 'bgafter' });
        await wait(400);
        [...document.querySelectorAll('.block[data-type="bg"]')].pop().click();
        await wait(300);
        const box = document.querySelector('#preview .stage__box');
        return {
          box: !!box,
          speaker: box?.querySelector('.stage__speaker')?.textContent || '',
          text: box?.querySelector('.stage__text')?.textContent || '',
          html: box?.querySelector('.stage__text')?.innerHTML || '',
        };
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'startwrite') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.DSL.importText('[wait,1]', { target: 'new', name: 'startwrite' });
        await wait(300);
        const data = window.PROJECT.serialize();
        data.ui.workspace = 'resource';
        window.PROJECT.apply(data);
        await wait(300);
        return {
          writeHidden: document.getElementById('workspace-write').hidden,
          resourceHidden: document.getElementById('workspace-resource').hidden,
          active: document.querySelector('.workspace-switch__btn.is-on')?.dataset.workspace,
        };
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'spriteface') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.DSL.importText('[bs,2,1,0,1]', { target: 'new', name: 'spriteface' });
        const scan = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
        window.RES.setScan(scan);
        const mapRes = await window.shell.readMapping(${JSON.stringify(MAP_FILE)});
        window.MAPPING.load(mapRes);
        window.PROJECT.mappingChanged();
        await wait(700);
        document.querySelector('.block[data-type="bs"]').click();
        await wait(500);
        const thumb = document.querySelector('.sprite-pick__thumb');
        const thumbInfo = { src: !!thumb?.src, natural: thumb?.naturalWidth || 0 };
        document.querySelector('.sprite-pick')?.click();
        await wait(1000);
        const pick = document.querySelector('.spk');
        const faces = [...pick.querySelectorAll('.spk-face:not(.is-empty)')];
        faces[4]?.click();
        await wait(1000);
        const canvas = pick.querySelector('.spk__canvas');
        let painted = 0;
        if (canvas) {
          const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          for (let i = 3; i < d.length; i += 4) if (d[i]) painted += 1;
        }
        pick.querySelector('.spk__ok')?.click();
        await wait(1200);
        const stageCanvas = document.querySelector('#preview .stage__sprite-canvas');
        let stagePainted = 0;
        if (stageCanvas) {
          const d = stageCanvas.getContext('2d').getImageData(0, 0, stageCanvas.width, stageCanvas.height).data;
          for (let i = 3; i < d.length; i += 4) if (d[i]) stagePainted += 1;
        }
        return {
          thumbInfo,
          faces: faces.length,
          canvas: canvas ? { w: canvas.width, h: canvas.height, painted } : null,
          stageCanvas: stageCanvas ? { w: stageCanvas.width, h: stageCanvas.height, painted: stagePainted } : null,
          side: pick.querySelector('.spk__meta')?.textContent.replace(/\s+/g, ' ').trim(),
        };
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'selcache') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        await window.DSL.importFile(${JSON.stringify(FIXTURE)});
        await wait(400);
        const blocks = [...document.querySelectorAll('#main .block')];
        blocks[1]?.click();
        await wait(300);
        const firstId = state.blockId;
        const firstNode = document.querySelector('#main .block[data-block-id="' + firstId + '"]');
        const sentinel = document.querySelector('#main .doc-title');
        const nextId = blocks[2]?.dataset.blockId;
        selectBlock(nextId);
        await wait(300);
        const nextNode = document.querySelector('#main .block[data-block-id="' + nextId + '"]');
        const hit = listOfBlock(nextId);
        const st1 = stageState(hit.scene, hit.list.find((b) => b.id === nextId));
        const st2 = stageState(hit.scene, hit.list.find((b) => b.id === nextId));
        return {
          firstNodeConnected: !!firstNode?.isConnected,
          sameMainTree: sentinel === document.querySelector('#main .doc-title'),
          selected: document.querySelectorAll('#main .block.is-selected').length,
          activeChapter: document.querySelector('.chapter.is-active')?.dataset.chapterId || '',
          currentScene: document.querySelector('.scene-item.is-current')?.dataset.sceneId || '',
          stageCacheHit: st1 === st2,
        };
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'v3dtest') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.DSL.importText('[bs,2,1,0,1,1,m,1000,0,0,1]\\n[v3d,0,0,400]', { target: 'new', name: 'v3d' });
        const scan = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
        window.RES.setScan(scan);
        const mapRes = await window.shell.readMapping(${JSON.stringify(MAP_FILE)});
        window.MAPPING.load(mapRes);
        window.PROJECT.mappingChanged();
        await wait(800);
        const target = document.querySelector('.block[data-type="v3d"]');
        if (!target) return { error: 'no v3d block' };
        target.click();
        await wait(900);
        const canvas = document.querySelector('.stage__sprite-canvas');
        return { canvasStyle: canvas ? canvas.getAttribute('style') : null, stage: !!document.querySelector('.stage') };
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'projsettings') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const click = (n) => { n.click(); };
        document.querySelector('.menu-btn[data-menu="file"]').click();
        await wait(150);
        const item = [...document.querySelectorAll('.menubar__drop .menu-item')].find((n) => n.textContent.includes('项目设置'));
        if (!item) return { error: 'no project settings item' };
        click(item);
        await wait(300);
        const panel = document.querySelector('.project-settings');
        const values = () => [...panel.querySelectorAll('input[data-setting]')].reduce((o, n) => (o[n.dataset.setting] = n.value, o), {});
        const before = values();
        const set = (key, value) => { const n = panel.querySelector('input[data-setting="' + key + '"]'); n.value = value; n.dispatchEvent(new Event('input', { bubbles: true })); };
        set('stage.width', 1920); set('stage.height', 1080); set('stage.bottom', 10);
        set('stage.l', 480); set('stage.m', 960); set('stage.r', 1440);
        set('depth.sprite', 1200); set('depth.background', 1300); set('depth.cg', 1400);
        set('sprite.height', 80); set('sprite.maxWidth', 40);
        const apply = [...panel.querySelectorAll('button')].find((n) => n.textContent.trim() === '应用');
        click(apply);
        await wait(500);
        const serialized = window.PROJECT.serialize();
        window.PROJECT.apply(JSON.parse(JSON.stringify(serialized)));
        const loaded = window.PROJECT.settings();
        const old = JSON.parse(JSON.stringify(serialized));
        old.version = 1;
        delete old.settings;
        window.PROJECT.apply(old);
        const migrated = window.PROJECT.settings();
        return { before, closed: !document.querySelector('.project-settings'), settings: serialized.settings, loaded, migrated, version: serialized.version, dirty: window.PROJECT.isDirty() };
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'spritevariant') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.DSL.importText('[bs,2,1,0,1,1,m,1000,0,0,1]', { target: 'new', name: 'variant' });
        const scan = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
        window.RES.setScan(scan);
        const mapRes = await window.shell.readMapping(${JSON.stringify(MAP_FILE)});
        window.MAPPING.load(mapRes);
        window.PROJECT.mappingChanged();
        await wait(700);
        document.querySelector('.block[data-type="bs"]').click();
        await wait(700);
        const thumb = document.querySelector('.sprite-pick__thumb');
        const text = document.querySelector('.sprite-pick__text')?.textContent.replace(/\s+/g, ' ').trim();
        return { text, thumbW: thumb?.naturalWidth || 0, thumbH: thumb?.naturalHeight || 0 };
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'spritegeom') {
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.DSL.importText('[bs,2,1,0,1]\\n[dia,四参]\\n[bs,2,1,0,1,1,m,1600,0,0,1]\\n[dia,全参]\\n[bs,2,1,0,2]\\n[dia,四参更新]', { target: 'new', name: 'geom' });
        const scan = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
        window.RES.setScan(scan);
        const mapRes = await window.shell.readMapping(${JSON.stringify(MAP_FILE)});
        window.MAPPING.load(mapRes);
        window.PROJECT.mappingChanged();
        await wait(800);
        const blocks = [...document.querySelectorAll('.block[data-type="bs"]')];
        if (blocks.length < 2) return { error: 'need two bs blocks', count: blocks.length };
        const debug = (n) => {
          const id = n.dataset.blockId;
          const hit = listOfBlock(id);
          const b = hit && hit.list.find((x) => x.id === id);
          const pick = b && spritePick(b);
          return {
            id,
            data: b && b.data,
            pick: pick ? { name: pick.ch.name, key: pick.key, lv: pick.lv, body: pick.body && pick.body.entry && pick.body.entry.name, sheet: pick.sheet && pick.sheet.entry && pick.sheet.entry.name } : null,
          };
        };
        const snap = () => {
          const stage = document.querySelector('#preview .stage');
          const canvas = document.querySelector('#preview .stage__sprite-canvas');
          let painted = 0;
          if (canvas) {
            const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 3; i < d.length; i += 4) if (d[i]) painted += 1;
          }
          return {
            canvas: canvas ? { style: canvas.getAttribute('style'), w: canvas.width, h: canvas.height, painted, spec: canvas.dataset.sprite ? JSON.parse(canvas.dataset.sprite) : null } : null,
            stageSprites: document.querySelectorAll('#preview .stage__sprite-img').length,
            stage: !!stage,
          };
        };
        blocks[0].click();
        await wait(700);
        const four = snap();
        blocks[1].click();
        await wait(1000);
        const full = snap();
        let update = null;
        if (blocks[2]) {
          blocks[2].click();
          await wait(700);
          update = snap();
        }
        return { four, full, update, debugFour: debug(blocks[0]), debugFull: debug(blocks[1]) };
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'previewscene') {
    const script = process.env.PREVIEW_SCRIPT || '[bg,500]\\n[bs,3,1,0,12,1,m,1600,0,0,1]\\n[dia,preview]';
    const info = await run(`(async () => {
      try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.DSL.importText(${JSON.stringify(script)}, { target: 'new', name: 'preview' });
        const scan = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
        window.RES.setScan(scan);
        const mapRes = await window.shell.readMapping(${JSON.stringify(MAP_FILE)});
        window.MAPPING.load(mapRes);
        window.PROJECT.mappingChanged();
        await wait(800);
        const bs = [...document.querySelectorAll('.block')];
        const wanted = ${JSON.stringify(process.env.PREVIEW_TARGET || 'bs')};
        const target = bs.filter((n) => n.dataset.type === wanted).pop() || bs[bs.length - 1];
        if (!target) return { error: 'no target block' };
        target.click();
        await wait(1200);
        const stage = document.querySelector('#preview .stage');
        const r = stage ? stage.getBoundingClientRect() : null;
        const canvas = document.querySelector('#preview .stage__sprite-canvas');
        const bg = document.querySelector('#preview .stage__bg-img');
        return {
          rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
          canvas: canvas ? { style: canvas.getAttribute('style'), w: canvas.width, h: canvas.height, spec: canvas.dataset.sprite ? JSON.parse(canvas.dataset.sprite) : null } : null,
          bg: bg ? { style: bg.getAttribute('style'), src: !!bg.src } : null,
          sprites: document.querySelectorAll('#preview .stage__sprite-img').length,
        };
      } catch (err) { return { error: String(err && err.message || err), stack: err && err.stack }; }
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'sakura-pick') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(path.join(root, '.ref', 'Script.txt'))});
      const scan = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
      window.RES.setScan(scan);
      await wait(700);
      const mapRes = await window.shell.readMapping(${JSON.stringify(MAP_FILE)});
      window.MAPPING.load(mapRes);
      window.PROJECT.mappingChanged();
      await wait(700);
      const bs = [...document.querySelectorAll('.block[data-type="bs"]')].find((n) => n.textContent.includes('表情 12'));
      if (!bs) return { error: 'no bs block' };
      bs.click();
      await wait(400);
      document.querySelector('.sprite-pick')?.click();
      await wait(700);
      const pick = document.querySelector('.spk');
      if (!pick) return { error: 'no picker' };
      const charOn = pick.querySelector('.spk-char.is-on .spk-char__name')?.textContent;
      const cloths = [...pick.querySelectorAll('.spk-cloth')].map((n) => n.textContent.replace(/\s+/g, ' ').trim());
      const faces = pick.querySelectorAll('.spk-face:not(.is-empty)').length;
      const faceLabel = pick.querySelector('.spk__faces-wrap .spk__label')?.textContent.replace(/\s+/g, ' ').trim();
      const side = pick.querySelector('.spk__meta')?.textContent.replace(/\s+/g, ' ').trim();
      return { charOn, cloths, faces, faceLabel, side };
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'sakura') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(path.join(root, '.ref', 'Script.txt'))});
      const scan = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
      window.RES.setScan(scan);
      await wait(700);
      const mapRes = await window.shell.readMapping(${JSON.stringify(MAP_FILE)});
      window.MAPPING.load(mapRes);
      window.PROJECT.mappingChanged();
      await wait(700);
      const out = {
        stats: window.MAPPING.stats(),
        path: window.MAPPING.path(),
        sprite14: window.MAPPING.sprite(14, 1, 0) && window.MAPPING.sprite(14, 1, 0).body,
        sprite3: window.MAPPING.sprite(3, 1, 0) && window.MAPPING.sprite(3, 1, 0).body,
        bg67_2: window.MAPPING.bgFile(67, 2),
        bg67_3: window.MAPPING.bgFile(67, 3),
        chars: window.RES.spriteChars().length,
      };
      const bs = [...document.querySelectorAll('.block[data-type="bs"]')].find((n) => n.textContent.includes('表情 12'));
      if (bs) bs.click();
      await wait(500);
      out.bsText = bs ? bs.textContent.replace(/\s+/g, ' ').trim() : null;
      out.wire = document.querySelector('.wire__text')?.textContent;
      const bg501 = [...document.querySelectorAll('.block[data-type="bg"]')].find((n) => n.textContent.includes('501'));
      if (bg501) { bg501.click(); await wait(300); }
      out.bg501Wire = bg501 ? document.querySelector('.wire__text')?.textContent : null;
      document.querySelector('.workspace-switch__btn[data-workspace="resource"]').click();
      await wait(200);
      document.querySelector('[data-view="mapping"]').click();
      await wait(500);
      return out;
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'mapping') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(FIXTURE)});
      const scan = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
      window.RES.setScan(scan);
      await wait(500);
      document.querySelector('.workspace-switch__btn[data-workspace="resource"]').click();
      await wait(200);
      document.querySelector('[data-view="mapping"]').click();
      await wait(150);
      document.querySelector('[data-mapping-import]').click();
      await wait(900);
      const rel = document.querySelector('[data-mapping-reload]');
      if (rel) { rel.click(); await wait(350); }
      const out = { stats: window.MAPPING.stats(), path: window.MAPPING.path(), reloadTotal: window.MAPPING.stats().total, reloadPath: window.MAPPING.path(), bgVariant: window.WIRING.bgFile('67', '2') };
      const ch = window.RES.spriteChars().find((c) => Number(c.cha) === 3);
      out.charName = ch && ch.name;
      out.body = ch && ch.bodies['1|0'] ? ch.bodies['1|0'].entry.name : null;
      document.querySelector('.workspace-switch__btn[data-workspace="write"]').click();
      await wait(200);
      const bs = [...document.querySelectorAll('.block[data-type="bs"]')].find((n) => n.textContent.includes('千和'));
      if (bs) bs.click();
      await wait(350);
      out.bsText = bs ? bs.textContent.replace(/\s+/g, ' ').trim() : null;
      out.wire = document.querySelector('.wire__text')?.textContent;
      const pickBtn = document.querySelector('.sprite-pick');
      out.picker = !!pickBtn;
      if (pickBtn) {
        pickBtn.click();
        await wait(800);
        out.faces = document.querySelectorAll('.spk-face').length;
        document.querySelector('.spk__cancel')?.click();
        await wait(250);
      }
      document.querySelector('.workspace-switch__btn[data-workspace="resource"]').click();
      await wait(200);
      document.querySelector('[data-view="mapping"]').click();
      await wait(250);
      return out;
    })()`);
    console.log(JSON.stringify(info, null, 2));
    console.log('console errors:', errors.length ? errors : 'none');
  } else if (mode === 'smoke') {
    const result = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};

      // 资源全部来自扫描；冒烟先扫一遍真实目录
      const scanned = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
      window.RES.setScan(scanned);
      await wait(600);
      out.scanArchives = scanned.archives ? scanned.archives.length : -1;

      // 项目内容全部来自导入：先导入覆盖全部原语的 fixture
      out.imported = !!(await window.DSL.importFile(${JSON.stringify(FIXTURE)}));
      await wait(400);
      out.importChapters = document.querySelectorAll('.chapter').length;
      out.importScenes = document.querySelectorAll('.scene-item').length;
      out.importKinds = [...new Set([...document.querySelectorAll('.block')].map((n) => n.dataset.type))].length;
      out.customBlocks = document.querySelectorAll('.block[data-type="custom"]').length;
      out.titleName = document.querySelector('.titlebar__project').textContent;
      out.bgEntry = window.WIRING && window.WIRING.bgEntry('67') ? window.WIRING.bgEntry('67').name : null;
      out.bgFile = window.WIRING ? window.WIRING.bgFile('67') : null;
      out.bgMissing = window.WIRING ? window.WIRING.bgFile('500') : null;
      out.cgEntry = window.WIRING && window.WIRING.cgEntry('KURO_e011a1') ? window.WIRING.cgEntry('KURO_e011a1').name : null;

      // 映射表：导入示例，手工把 cha=3 pose=1 cloth=1 接到千和的图上
      const mapRes = await window.shell.readMapping(${JSON.stringify(path.join(root, 'mappings', 'sample.toml'))});
      out.mappingLoaded = !!(mapRes && !mapRes.error);
      if (out.mappingLoaded) {
        window.MAPPING.load(mapRes);
        window.PROJECT.mappingChanged();
        await wait(350);
      }
      out.mappingTotal = window.MAPPING ? window.MAPPING.stats().total : 0;
      out.mappingBgVariant = window.WIRING ? window.WIRING.bgFile('67', '2') : null;
      out.mappingBody = (() => {
        const ch = window.RES.spriteChars().find((c) => Number(c.cha) === 3);
        return ch && ch.bodies['1|0'] ? ch.bodies['1|0'].entry.name : null;
      })();

      // 导出 DSL：应该能被自己的解析器重新读成同样多的块
      const exportText = window.DSL.exportText();
      const exportParsed = window.HCB_DSL.parse(exportText, { split: false });
      const projectBlocks = window.PROJECT.chapters().reduce(
        (n, ch) => n + ch.scenes.reduce((m, sc) => m + sc.blocks.length, 0),
        0
      );
      out.exportLines = exportText.split('\\n').filter(Boolean).length;
      out.exportBlocks = exportParsed.stats.blocks;
      out.exportMatch = exportParsed.stats.blocks === projectBlocks;
      out.exportHead = exportText.split('\\n').slice(0, 4);
      out.exportSaved = !!(await window.DSL.exportFile(${JSON.stringify(path.join(root, 'shots', 'export-smoke.txt'))}));

      window.BINDINGS.add([{ name: '展望広場', call: '[bg,67]', note: '' }]);
      window.BINDINGS.refresh();

      // 先选中一个背景块，让右栏出现下拉
      document.querySelector('.block[data-type="bg"]').click();
      await wait(120);
      document.querySelector('.select-trigger').click();
      await wait(80);
      out.selectOpen = !!document.querySelector('.select-menu.is-open');
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await wait(220);
      out.selectClosed = !document.querySelector('.select-menu.is-open');

      // 插入面板：原语数量、分组、按组着色
      document.querySelector('.add-row').click();
      await wait(120);
      out.paletteCount = document.querySelectorAll('.palette-item').length;
      out.paletteGroups = [...document.querySelectorAll('.palette__group')].map((n) => n.textContent);
      out.swatchColors = new Set(
        [...document.querySelectorAll('.palette-item__swatch')].map((n) => getComputedStyle(n).backgroundColor)
      ).size;
      out.paletteSearch = (() => {
        const input = document.querySelector('.palette__input');
        input.value = 'bgm';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return [...document.querySelectorAll('.palette-item')].filter((n) => !n.hidden).map((n) => n.dataset.type);
      })();
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await wait(200);
      out.paletteClosed = !document.querySelector('.popover.palette');

      // 块上的 DSL 原文
      out.blockKinds = [...new Set([...document.querySelectorAll('.block')].map((n) => n.dataset.type))];
      out.codeCount = document.querySelectorAll('.block__code').length;
      out.codeSample = document.querySelector('.block[data-type="bg"] .block__code').textContent;
      out.inspectorCode = document.querySelector('.inspector-code').textContent;

      // 标签：界面只有名字，:: 只出现在 DSL 调用里
      document.querySelector('.block[data-type="label"]').click();
      await wait(120);
      out.labelTitle = document.querySelector('.inspector-title').textContent;
      out.labelFieldValue = document.querySelector('.field input').value;
      out.labelCode = document.querySelector('.inspector-code').textContent;
      out.labelBlockText = document.querySelector('.block[data-type="label"] .block__text').textContent;

      // 立绘：10 个入参压成 6 行，构图不再是占位符
      document.querySelector('.block[data-type="bs"]').click();
      await wait(120);
      out.bsRows = document.querySelectorAll('.field--row').length;
      out.bsVectorInputs = document.querySelectorAll('.field__vector .control').length;
      out.bsSelectText = document.querySelector('.field--row .select-trigger__label')?.textContent;

      // 舞台示意：站位一改，立绘位置跟着动
      out.stageBg = document.querySelector('.stage__bgname')?.textContent;
      out.stageSprites = document.querySelectorAll('.stage__sprite, .stage__sprite-img').length;
      out.stageSpriteName = document.querySelector('.stage__sprite b')?.textContent;
      out.spriteLeftBefore = document.querySelector('.stage__sprite-img')?.style.left;
      [...document.querySelectorAll('.segmented__item')].find((n) => n.textContent === '右').click();
      await wait(150);
      out.spriteLeftAfter = document.querySelector('.stage__sprite-img')?.style.left;

      // 立绘选择器：真图网格 + 表情表
      document.querySelector('.sprite-pick').click();
      await wait(250);
      out.pickChars = document.querySelectorAll('.spk-char').length;
      out.pickCloths = document.querySelectorAll('.spk-cloth').length;
      out.pickFaces = document.querySelectorAll('.spk-face').length;
      out.pickSheet = !!document.querySelector('.spk__faces').style;
      document.querySelectorAll('.spk-face')[2].click();
      await wait(80);
      document.querySelector('.spk__ok').click();
      await wait(250);
      out.bsCodeAfterPick = document.querySelector('.inspector-code').textContent;
      out.stageImg = !!document.querySelector('.stage__sprite-img');

      // 立绘移动这类只引用角色，用带小图的下拉，不是编号
      document.querySelector('.block[data-type="bs_move"]').click();
      await wait(150);
      out.moveCha = document.querySelector('.cha-pick .select-trigger__label')?.textContent;
      out.moveThumb = !!document.querySelector('.cha-pick__thumb');

      // CG：沿用当前设定时，位置与缩放自动收起
      document.querySelector('.block[data-type="cg"]').click();
      await wait(120);
      out.cgRowsBefore = document.querySelectorAll('.field--row').length;
      document.querySelector('.switch').click();
      await wait(150);
      out.cgRowsAfter = document.querySelectorAll('.field--row').length;
      out.cgCodeAfter = document.querySelector('.inspector-code').textContent;

      // 场景折叠：验证动画不重建文档，结束后才 hidden
      const docTitleNode = document.querySelector('.doc-title');
      out.visibleBodiesBefore = document.querySelectorAll('.scene-group__body:not([hidden])').length;
      const firstToggle = document.querySelector('.scene-group__toggle');
      firstToggle.click();
      await wait(40);
      out.docRebuilt = docTitleNode !== document.querySelector('.doc-title');
      out.midAnimationHeight = document.querySelector('.scene-group__body').getBoundingClientRect().height.toFixed(1);
      await wait(320);
      out.visibleBodiesAfter = document.querySelectorAll('.scene-group__body:not([hidden])').length;
      out.toggleExpanded = firstToggle.getAttribute('aria-expanded');
      out.bodyHidden = document.querySelector('.scene-group__body').hidden;
      firstToggle.click();
      await wait(360);
      out.visibleBodiesRestored = document.querySelectorAll('.scene-group__body:not([hidden])').length;
      out.restoredHeight = document.querySelector('.scene-group__body').style.height;

      const ids = () => [...document.querySelectorAll('.block')].map((n) => n.dataset.blockId);
      out.orderBefore = ids();
      const blocks = [...document.querySelectorAll('.block')];
      const dt = new DataTransfer();
      blocks[0].querySelector('.block__handle').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const r = blocks[2].getBoundingClientRect();
      blocks[2].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + r.height - 2 }));
      blocks[2].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await wait(120);
      out.orderAfter = ids();

      out.scenesBefore = document.querySelectorAll('.scene-item').length;
      document.querySelector('.scene-add').click();
      await wait(80);
      out.scenesAfter = document.querySelectorAll('.scene-item').length;

      out.chaptersBefore = document.querySelectorAll('.chapter').length;
      document.querySelector('.rail-label__action').click();
      await wait(80);
      out.chaptersAfter = document.querySelectorAll('.chapter').length;
      out.newChapterTitle = document.querySelector('.chapter.is-active .chapter__title')?.textContent;

      const active = document.querySelector('.chapter.is-active');
      const rr = active.getBoundingClientRect();
      active.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rr.left + 40, clientY: rr.top + 12 }));
      await wait(80);
      out.menuItems = [...document.querySelectorAll('.menu__item')].map((n) => n.textContent.trim());

      // 资源工作区状态机
      document.querySelector('.workspace-switch__btn[data-workspace="resource"]').click();
      await wait(150);
      out.resArchives = document.querySelectorAll('[data-archive]').length;
      out.resDefaultTitle = document.querySelector('.res-title').textContent;
      out.resDefaultRows = document.querySelectorAll('.res-table tbody tr').length;
      out.resLayers = document.querySelectorAll('.layer-row').length;

      document.querySelector('[data-archive="1"]').click();
      await wait(150);
      out.resBgTitle = document.querySelector('.res-title').textContent;
      out.resBgRows = document.querySelectorAll('.res-table tbody tr').length;
      out.resVariants = document.querySelectorAll('.variant').length;

      document.querySelector('[data-tab="overview"]').click();
      await wait(120);
      out.resMetaRows = document.querySelectorAll('.res-meta__row').length;

      // 绑定表：未扫到的背景编号应显示「未接」，其余已解析
      document.querySelector('[data-view="bindings"]').click();
      await wait(200);
      out.bindingRows = document.querySelectorAll('.res-table tbody tr').length;
      out.bindingResolved = [...document.querySelectorAll('.res-table .res-status')].filter((n) => n.classList.contains('res-status--resolved')).length;
      out.bindingUnknown = [...document.querySelectorAll('.res-table .res-status')].filter((n) => n.classList.contains('res-status--unknown')).length;
      out.bindingNames = [...document.querySelectorAll('.res-table tbody tr')].slice(0, 2).map((tr) => tr.cells[0].textContent);

      // 导入到已有章节 / 小节
      const ch = window.PROJECT.serialize().story.chapters[0];
      const sc = ch.scenes[0];
      out.appendScene = !!window.DSL.importText('[wait,1]', { target: 'scene', chapterId: ch.id, sceneId: sc.id });
      out.appendChapter = !!window.DSL.importText('[wait,2]', { target: 'chapter', chapterId: ch.id });
      out.appendSceneCount = window.PROJECT.serialize().story.chapters[0].scenes.length;
      out.appendBlockCount = window.PROJECT.serialize().story.chapters[0].scenes[0].blocks.length;

      // 保存 → 重开：块尾参数、raw 行、绑定都要还在
      const savePath = ${JSON.stringify(path.join(root, 'shots', 'smoke.hcbproj'))};
      out.saved = await window.PROJECT.saveTo(savePath);
      out.reopened = !!(await window.PROJECT.openFrom(savePath));
      const after = window.PROJECT.serialize();
      const flatBlocks = (chapters) => chapters.flatMap((c) => c.scenes.flatMap((sc) => sc.blocks));
      out.persistChapters = after.story.chapters.length;
      out.persistBindings = window.BINDINGS.count();
      out.persistMapping = window.MAPPING ? window.MAPPING.stats().total : 0;
      out.persistMappingPath = window.MAPPING ? window.MAPPING.path() : '';
      out.persistExtra = (flatBlocks(after.story.chapters).find((b) => b.type === 'dia' && b.extra) || {}).extra || null;
      out.persistCustom = flatBlocks(after.story.chapters).filter((b) => b.type === 'custom').length;

      // 标题栏导出按钮：写盘后应留下文件
      document.getElementById('export-dsl').click();
      await wait(500);

      // 新建项目回到文件驱动的空状态
      window.PROJECT.newProject();
      await wait(150);
      out.startPage = !!document.querySelector('.start');
      out.emptyChapters = document.querySelectorAll('.chapter').length;
      out.emptyBindings = window.BINDINGS.count();

      return out;
    })()`);
    console.log(JSON.stringify(result, null, 2));
    const btnFile = path.join(root, 'shots', 'export.txt');
    console.log('export button file:', fs.existsSync(btnFile) ? fs.statSync(btnFile).size + ' bytes' : 'missing');
    console.log('console errors:', errors.length ? errors : 'none');
    app.quit();
    return;
  }

  await wait(450);
  const img = latest || (await win.webContents.capturePage());
  fs.writeFileSync(path.join(root, out), img.toPNG());
  console.log('wrote', out, img.getSize(), 'errors:', errors.length ? errors : 'none');
  app.quit();
}).catch((err) => {
  console.error('capture failed:', (err && err.stack) || err);
  app.quit();
});
