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
      const mapRes = await window.shell.readMapping(${JSON.stringify(path.join(root, 'mappings', 'sakura.toml'))});
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

      const mapRes = await window.shell.readMapping(${JSON.stringify(path.join(root, 'mappings', 'sakura.toml'))});
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
  } else if (mode === 'sakura-pick') {
    const info = await run(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.DSL.importFile(${JSON.stringify(path.join(root, '.ref', 'Script.txt'))});
      const scan = await window.shell.scanResources(${JSON.stringify(GAME_DIR)});
      window.RES.setScan(scan);
      await wait(700);
      const mapRes = await window.shell.readMapping(${JSON.stringify(path.join(root, 'mappings', 'sakura.toml'))});
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
      const mapRes = await window.shell.readMapping(${JSON.stringify(path.join(root, 'mappings', 'sakura.toml'))});
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
