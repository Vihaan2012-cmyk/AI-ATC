// Air Traffic Control desktop app.
// - launches the brain (SimConnect + AI + comms) itself, so it's one click
// - on first run / missing prerequisites, shows an install wizard
// - persists window bounds + appearance; writes brain config (.env)
const { app, BrowserWindow, ipcMain, shell, utilityProcess, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Piper } = require('./piper');

let piper = null;
function getPiper() { if (!piper) piper = new Piper(app.getPath('userData')); return piper; }

const PACKAGED = app.isPackaged;
const repoRoot = PACKAGED ? path.join(process.resourcesPath, 'brain') : path.join(__dirname, '..');
const userData = () => app.getPath('userData');
// When packaged, the install dir (resources/brain) is read-only (e.g. Program Files), so the
// user's .env MUST live in the writable userData folder — otherwise the wizard re-appears every
// launch because ensureEnv() can't write it. In dev, keep it next to the source for convenience.
const envPath = PACKAGED ? path.join(userData(), '.env') : path.join(repoRoot, '.env');
const envExamplePath = path.join(repoRoot, '.env.example');
const boundsFile = () => path.join(userData(), 'bounds.json');
const settingsFile = () => path.join(userData(), 'settings.json');
const widgetPath = PACKAGED
  ? path.join(process.resourcesPath, 'widget', 'atc-widget.html')
  : path.join(__dirname, '..', 'widget', 'atc-widget.html');
const wizardPath = path.join(__dirname, 'wizard.html');

const DEFAULT_SETTINGS = { accent: '#6f8cff', opacity: 1, fontScale: 1, alwaysOnTop: true, voiceEnabled: false, voiceRate: 1.05, voiceVol: 1, voicePiper: false };

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, obj) { try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); } catch { /* ignore */ } }
function getSettings() { return { ...DEFAULT_SETTINGS, ...readJson(settingsFile(), {}) }; }

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}
function readEnv() { try { return parseEnv(fs.readFileSync(envPath, 'utf8')); } catch { return {}; } }
function writeEnv(updates) {
  const merged = { ...readEnv() };
  for (const [k, v] of Object.entries(updates)) if (v !== undefined) merged[k] = v;
  const lines = ['# Edited by Air Traffic Control', ''];
  for (const [k, v] of Object.entries(merged)) lines.push(`${k}=${v}`);
  try { fs.mkdirSync(path.dirname(envPath), { recursive: true }); fs.writeFileSync(envPath, lines.join('\n') + '\n'); return true; } catch { return false; }
}
function ensureEnv() {
  if (fs.existsSync(envPath)) return;
  try {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    if (fs.existsSync(envExamplePath)) fs.copyFileSync(envExamplePath, envPath);
    else fs.writeFileSync(envPath, 'LLM_PROVIDER=ollama\nOLLAMA_MODEL=myaimodels/atc-nlu\nNAVDATA_SOURCES=sim\n');
  } catch { /* ignore */ }
}

function ollamaExe() {
  const local = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
  return fs.existsSync(local) ? local : 'ollama';
}
function ollamaHost() { return (readEnv().OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, ''); }
function modelName() { return readEnv().OLLAMA_MODEL || 'myaimodels/atc-nlu'; }

// ---- prerequisites ----
function depsOk() { return fs.existsSync(path.join(repoRoot, 'node_modules')); }
function envOk() { return fs.existsSync(envPath); }
function needsWizard() { return !depsOk() || !envOk(); }

async function ollamaStatus() {
  try {
    const r = await fetch(`${ollamaHost()}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { ollama: false, model: false };
    const j = await r.json();
    const names = (j.models || []).map((m) => m.name || '');
    const want = modelName();
    const has = names.some((n) => n === want || n.split(':')[0] === want.split(':')[0]);
    return { ollama: true, model: has };
  } catch {
    return { ollama: false, model: false };
  }
}

// ---- brain process ----
let brainProc = null;
function startBrain() {
  if (brainProc) return;
  try {
    // The brain reads config from process.env (config.ts). In packaged mode .env lives in
    // userData (not the brain's cwd), so pass it through explicitly as env vars.
    const env = { ...process.env, ...readEnv() };
    if (PACKAGED) {
      brainProc = utilityProcess.fork(path.join(repoRoot, 'dist', 'brain', 'serve.js'), [], { cwd: repoRoot, env });
    } else {
      brainProc = spawn('node', ['--import', 'tsx', 'src/brain/serve.ts'], { cwd: repoRoot, shell: true, windowsHide: true, stdio: 'ignore', env });
      brainProc.on('exit', () => { brainProc = null; });
    }
  } catch (e) { console.error('brain spawn failed:', e); }
}
function stopBrain() { try { if (brainProc) brainProc.kill(); } catch { /* ignore */ } brainProc = null; }

// ---- window ----
let win = null;
let drawerOpen = false;
const DRAWER_W = 340;

function applyWindow(s) {
  if (!win) return;
  win.setOpacity(Math.max(0.3, Math.min(1, Number(s.opacity) || 1)));
  win.setAlwaysOnTop(!!s.alwaysOnTop, 'screen-saver');
}

function createWindow() {
  let b = readJson(boundsFile(), {});
  if (!b.width || b.width < 470) b = {};
  const s = getSettings();
  win = new BrowserWindow({
    width: b.width || 600, height: b.height || 660,
    x: b.x, y: b.y, minWidth: 470, minHeight: 440,
    frame: false, transparent: true, hasShadow: true, resizable: true,
    alwaysOnTop: !!s.alwaysOnTop, backgroundColor: '#00000000', title: 'Air Traffic Control',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(!!s.alwaysOnTop, 'screen-saver');
  win.setOpacity(Math.max(0.3, Math.min(1, Number(s.opacity) || 1)));

  // Allow the widget to use the microphone (push-to-talk speech input).
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'audioCapture');
  });

  if (needsWizard()) {
    win.loadFile(wizardPath);
  } else {
    startBrain();
    win.loadFile(widgetPath);
  }

  const persist = () => { if (!win) return; const bb = win.getBounds(); if (drawerOpen) bb.width -= DRAWER_W; writeJson(boundsFile(), bb); };
  win.on('move', persist);
  win.on('resize', persist);
  win.on('closed', () => { win = null; });
  win.webContents.on('before-input-event', (e, input) => {
    const k = (input.key || '').toLowerCase();
    if (((input.control || input.meta) && k === 'r') || k === 'f5') win.reload();
  });
}

// Identify the app to Windows by the same id as the NSIS appId, so the Start Menu shortcut,
// taskbar grouping, and Windows search ("press Win, type Air Traffic Control") resolve to it.
if (process.platform === 'win32') app.setAppUserModelId('com.msfsaiatc.app');

app.whenReady().then(createWindow).then(registerPtt);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', stopBrain);
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });
app.on('activate', () => { if (!win) createWindow(); });

// Global push-to-talk: CapsLock-free combo (Ctrl+Shift+Space) works even when MSFS is focused,
// so you can key the mic without alt-tabbing. Sends a toggle to the renderer.
function registerPtt() {
  try {
    const accel = 'Control+Shift+Space';
    globalShortcut.register(accel, () => { if (win && !win.isDestroyed()) win.webContents.send('ptt:toggle'); });
  } catch (e) { console.error('PTT shortcut registration failed:', e); }
}

// window controls
ipcMain.on('win:minimize', () => { if (win) win.minimize(); });
ipcMain.on('win:close', () => { if (win) win.close(); });
ipcMain.handle('win:togglePin', () => { if (!win) return true; const p = !win.isAlwaysOnTop(); win.setAlwaysOnTop(p, 'screen-saver'); return p; });
ipcMain.handle('win:drawer', (_e, open) => {
  if (!win) return false;
  const b = win.getBounds();
  if (open && !drawerOpen) { win.setBounds({ x: b.x, y: b.y, width: b.width + DRAWER_W, height: b.height }); drawerOpen = true; }
  else if (!open && drawerOpen) { win.setBounds({ x: b.x, y: b.y, width: Math.max(470, b.width - DRAWER_W), height: b.height }); drawerOpen = false; }
  return drawerOpen;
});

// settings + config
ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:save', (_e, s) => { const m = { ...getSettings(), ...s }; writeJson(settingsFile(), m); applyWindow(m); return m; });
ipcMain.handle('config:get', () => {
  const env = readEnv();
  return {
    SIMBRIEF_USERNAME: env.SIMBRIEF_USERNAME || '', SIMBRIEF_USERID: env.SIMBRIEF_USERID || '',
    HOPPIE_LOGON: env.HOPPIE_LOGON || '', LLM_PROVIDER: env.LLM_PROVIDER || 'ollama',
    LLM_MODEL: env.LLM_MODEL || '', OLLAMA_MODEL: env.OLLAMA_MODEL || 'myaimodels/atc-nlu',
    LLM_DEVICE: env.LLM_DEVICE || 'auto',
    ATC_STRICTNESS: env.ATC_STRICTNESS || 'normal', ATC_CHATTER: env.ATC_CHATTER || 'low',
  };
});
ipcMain.handle('config:save', (_e, cfg) => writeEnv(cfg));
// Restart the brain so config changes (SimBrief ID, model, etc.) take effect without relaunching
// the whole app. Stops the current brain, waits briefly for the port to free, then starts fresh.
ipcMain.handle('brain:restart', async () => {
  try {
    stopBrain();
    await new Promise((r) => setTimeout(r, 1200)); // let the WS port (8742) release
    startBrain();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

// ---- Logbook (persistent flight history) ----
function logbookFile() { return path.join(userData(), 'logbook.json'); }
ipcMain.handle('logbook:get', () => readJson(logbookFile(), []));
ipcMain.handle('logbook:add', (_e, entry) => {
  const log = readJson(logbookFile(), []);
  log.unshift({ ...entry, savedAt: new Date().toISOString() });
  writeJson(logbookFile(), log.slice(0, 200)); // cap history
  return log.length;
});
ipcMain.handle('logbook:clear', () => { writeJson(logbookFile(), []); return true; });

// Open the local flight dashboard (served by the brain) in the default browser.
ipcMain.handle('open:dashboard', () => {
  const port = readEnv().WS_PORT || '8742';
  return shell.openExternal(`http://localhost:${port}/dashboard`);
});

// ---- Piper HD voices ----
const plog = (line) => { if (win) win.webContents.send('piper:log', line); };
ipcMain.handle('piper:status', async () => { try { return await getPiper().status(); } catch (e) { return { error: e.message, binary: false, total: 0, installed: 0, continents: [] }; } });
ipcMain.handle('piper:installBinary', () => getPiper().installBinary(plog));
ipcMain.handle('piper:installVoice', (_e, key) => getPiper().installVoice(key, plog));
ipcMain.handle('piper:installAll', () => getPiper().installAllVoices(plog));
ipcMain.handle('piper:deleteAll', () => getPiper().deleteAllVoices(plog));
ipcMain.handle('piper:synth', async (_e, text, key) => {
  try {
    const wav = await getPiper().synth(String(text || ''), String(key || ''));
    return { ok: true, wav: wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---- install wizard ----
function wlog(line) { if (win) win.webContents.send('wiz:log', line); }
function runStream(cmd, args, opts) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(cmd, args, { shell: true, windowsHide: true, ...opts }); }
    catch (e) { wlog('failed to start: ' + e.message); return resolve(false); }
    p.stdout && p.stdout.on('data', (d) => wlog(String(d).replace(/\s+$/, '')));
    p.stderr && p.stderr.on('data', (d) => wlog(String(d).replace(/\s+$/, '')));
    p.on('close', (code) => { wlog(`-- done (exit ${code}) --`); resolve(code === 0); });
    p.on('error', (e) => { wlog('error: ' + e.message); resolve(false); });
  });
}
ipcMain.handle('wiz:status', async () => ({ deps: depsOk(), env: envOk(), ...(await ollamaStatus()), model_name: modelName() }));
ipcMain.handle('wiz:installDeps', () => runStream('npm', ['install', '--no-audit', '--no-fund'], { cwd: repoRoot }));
ipcMain.handle('wiz:writeEnv', () => { ensureEnv(); return envOk(); });
ipcMain.handle('wiz:pullModel', () => runStream(ollamaExe(), ['pull', modelName()], {}));
ipcMain.handle('wiz:openOllama', () => shell.openExternal('https://ollama.com/download'));
ipcMain.handle('wiz:finish', () => {
  ensureEnv();
  startBrain();
  if (win) win.loadFile(widgetPath);
  return true;
});
ipcMain.handle('wiz:open', () => { if (win) win.loadFile(wizardPath); });
