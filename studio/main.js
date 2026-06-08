// Distill Studio — Electron main process.
//
// Orchestrates the whole distillation pipeline from a single window:
//   1. Teacher LLM (local Ollama) generates a training dataset for ANY domain you type.
//   2. QLoRA fine-tunes a small student model on that data (engine/train_qlora.py via the project .venv).
//   3. The merged student is imported into Ollama, then you chat-test it and compare it to the teacher.
//
// Everything heavy runs as a spawned child process; this file streams stdout/stderr back to the
// renderer over IPC so the dashboard stays live (logs, per-epoch accuracy, GPU/VRAM, ETA, stop).
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');

// ----- paths -----------------------------------------------------------------
// The studio lives in <project>/studio. The proven training stack lives one level up:
//   <project>/.venv            (Python 3.12 + torch/cu121 + peft/trl — already installed)
//   <project>/studio/engine    (our generic generator + trainer wrapper)
//   <project>/studio/runs      (datasets, adapters, merged models, logs per run)
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENGINE_DIR = path.join(__dirname, 'engine');
const RUNS_DIR = path.join(__dirname, 'runs');
const CONFIG_PATH = path.join(app.getPath('userData'), 'distill-studio-config.json');

const VENV_PY = path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

let win = null;
let activeChild = null; // the currently running generate/train child, if any

// ----- config persistence ----------------------------------------------------
const DEFAULT_CONFIG = {
  domain: '',
  systemPrompt: '',
  taskType: 'classification', // 'classification' | 'generation' | 'chat'
  labels: '', // comma-separated, for classification
  teacherModel: 'qwen2.5:14b',
  baseModel: 'Qwen/Qwen2.5-1.5B-Instruct',
  numExamples: 2000,
  epochs: 6,
  learningRate: 0.0002,
  batchSize: 2,
  gradAccum: 8,
  maxLen: 384,
  vramBudget: 5.0,
  patience: 2,
  loraR: 16,
  loraAlpha: 32,
  temperature: 0.0,
  topP: 0.1,
  numPredict: 96,
  outModelName: 'my-student',
  theme: 'light',
};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('saveConfig failed:', e.message);
  }
}

// ----- window ----------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#faf9f5',
    title: 'Distill Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (activeChild) try { activeChild.kill(); } catch {}
  if (process.platform !== 'darwin') app.quit();
});

// ----- small helpers ---------------------------------------------------------
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Minimal Ollama HTTP client (no external deps). Returns parsed JSON.
function ollama(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(OLLAMA_HOST + pathname);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 11434,
        path: url.pathname,
        method,
        headers: data
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve(buf ? JSON.parse(buf) : {});
          } catch (e) {
            reject(new Error(`Ollama parse error: ${e.message} (${buf.slice(0, 200)})`));
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Streaming Ollama generate — calls onToken(text) for each chunk. Used for live chat + compare.
function ollamaGenerateStream(payload, onToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(OLLAMA_HOST + '/api/generate');
    const data = JSON.stringify({ ...payload, stream: true });
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 11434,
        path: url.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      },
      (res) => {
        let acc = '';
        let full = '';
        res.on('data', (chunk) => {
          acc += chunk.toString();
          let nl;
          while ((nl = acc.indexOf('\n')) >= 0) {
            const line = acc.slice(0, nl).trim();
            acc = acc.slice(nl + 1);
            if (!line) continue;
            try {
              const obj = JSON.parse(line);
              if (obj.response) {
                full += obj.response;
                onToken(obj.response);
              }
              if (obj.done) resolve({ full, evalCount: obj.eval_count, evalDuration: obj.eval_duration, totalDuration: obj.total_duration });
            } catch {
              /* partial line, wait for more */
            }
          }
        });
        res.on('end', () => resolve({ full }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Spawn a child, stream its output to the renderer as {channel} log events. Resolves on exit.
function runChild(channel, cmd, args, opts, parseLine) {
  return new Promise((resolve) => {
    if (activeChild) {
      send(channel, { type: 'log', line: 'A job is already running.' });
      return resolve({ code: -1 });
    }
    send(channel, { type: 'log', line: `$ ${cmd} ${args.join(' ')}` });
    const child = spawn(cmd, args, {
      cwd: opts.cwd || PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', ...(opts.env || {}) },
      windowsHide: true,
    });
    activeChild = child;

    const handle = (buf) => {
      const text = buf.toString();
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/\r/g, '');
        if (line === '') continue;
        send(channel, { type: 'log', line });
        if (parseLine) {
          try {
            const evt = parseLine(line);
            if (evt) send(channel, evt);
          } catch {}
        }
      }
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', (e) => {
      send(channel, { type: 'log', line: `[spawn error] ${e.message}` });
    });
    child.on('close', (code) => {
      activeChild = null;
      send(channel, { type: 'done', code });
      resolve({ code });
    });
  });
}

// Parse known progress markers our Python/Node engines print, into structured dashboard events.
function parseTrainLine(line) {
  // "=== Epoch 3: intent accuracy = 97.5% (120 held-out) ==="
  let m = line.match(/Epoch (\d+):\s*(?:intent )?accuracy\s*=\s*([\d.]+)%/i);
  if (m) return { type: 'metric', name: 'accuracy', epoch: Number(m[1]), value: Number(m[2]) };
  // trl/transformers loss line: "{'loss': 0.12, 'epoch': 1.0, ...}" or "loss: 0.12"
  m = line.match(/'loss':\s*([\d.]+).*?'epoch':\s*([\d.]+)/);
  if (m) return { type: 'metric', name: 'loss', value: Number(m[1]), epoch: Number(m[2]) };
  m = line.match(/STEP\s+(\d+)\/(\d+)/);
  if (m) return { type: 'progress', step: Number(m[1]), total: Number(m[2]) };
  // our generator prints: "GEN 1200/2000"
  m = line.match(/GEN\s+(\d+)\/(\d+)/);
  if (m) return { type: 'progress', step: Number(m[1]), total: Number(m[2]) };
  if (/^PHASE\s+/.test(line)) return { type: 'phase', phase: line.replace(/^PHASE\s+/, '') };
  return null;
}

// ----- IPC: config -----------------------------------------------------------
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, cfg) => {
  saveConfig(cfg);
  return true;
});

// ----- IPC: environment / preflight -----------------------------------------
ipcMain.handle('env:check', async () => {
  const result = {
    venvPython: fs.existsSync(VENV_PY) ? VENV_PY : null,
    engineDir: fs.existsSync(ENGINE_DIR),
    ollama: false,
    ollamaModels: [],
    gpu: null,
    torch: null,
  };
  // Ollama reachable + model list
  try {
    const tags = await ollama('GET', '/api/tags');
    result.ollama = true;
    result.ollamaModels = (tags.models || []).map((m) => ({ name: m.name, size: m.size }));
  } catch {}
  // Torch / CUDA check via the venv (quick import)
  if (result.venvPython) {
    try {
      const out = await new Promise((res) => {
        const c = spawn(VENV_PY, ['-c', "import torch;print('TORCH',torch.__version__,'CUDA',torch.cuda.is_available(),torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none')"], { windowsHide: true });
        let s = '';
        c.stdout.on('data', (d) => (s += d));
        c.stderr.on('data', (d) => (s += d));
        c.on('close', () => res(s.trim()));
        c.on('error', () => res(''));
      });
      const m = out.match(/TORCH (\S+) CUDA (True|False) (.+)/);
      if (m) result.torch = { version: m[1], cuda: m[2] === 'True', device: m[3] };
    } catch {}
  }
  return result;
});

// GPU/VRAM poll (nvidia-smi). Returns null if unavailable.
ipcMain.handle('gpu:poll', async () => {
  return new Promise((resolve) => {
    const c = spawn('nvidia-smi', ['--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits'], { windowsHide: true });
    let s = '';
    c.stdout.on('data', (d) => (s += d));
    c.on('close', () => {
      const line = s.trim().split('\n')[0];
      if (!line) return resolve(null);
      const [name, used, total, util, temp] = line.split(',').map((x) => x.trim());
      resolve({ name, usedMB: Number(used), totalMB: Number(total), util: Number(util), temp: Number(temp) });
    });
    c.on('error', () => resolve(null));
  });
});

// ----- IPC: Ollama actions ---------------------------------------------------
ipcMain.handle('ollama:list', async () => {
  try {
    const tags = await ollama('GET', '/api/tags');
    return (tags.models || []).map((m) => ({ name: m.name, size: m.size, family: m.details?.family }));
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('ollama:delete', async (_e, name) => {
  try {
    await ollama('DELETE', '/api/delete', { name });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Streaming chat used by the test + compare panels. id ties tokens back to a UI bubble.
ipcMain.handle('ollama:chat', async (_e, { id, model, prompt, system, options }) => {
  try {
    const t0 = Date.now();
    const r = await ollamaGenerateStream(
      { model, prompt, system: system || undefined, options: options || {} },
      (tok) => send('chat:token', { id, token: tok })
    );
    send('chat:done', { id, ms: Date.now() - t0, evalCount: r.evalCount });
    return { ok: true };
  } catch (e) {
    send('chat:done', { id, error: e.message });
    return { error: e.message };
  }
});

// ----- IPC: pipeline steps ---------------------------------------------------
function runDir(name) {
  return path.join(RUNS_DIR, name.replace(/[^a-z0-9._-]/gi, '_'));
}

// Step 1 — generate dataset with the teacher LLM (generic, any domain).
ipcMain.handle('pipeline:generate', async (_e, cfg) => {
  saveConfig(cfg);
  const dir = runDir(cfg.outModelName);
  fs.mkdirSync(dir, { recursive: true });
  const dataPath = path.join(dir, 'data.jsonl');
  const args = [
    path.join(ENGINE_DIR, 'gen_data.mjs'),
    '--domain', cfg.domain,
    '--task', cfg.taskType,
    '--labels', cfg.labels || '',
    '--system', cfg.systemPrompt || '',
    '--n', String(cfg.numExamples),
    '--teacher', cfg.teacherModel,
    '--out', dataPath,
  ];
  const { code } = await runChild('gen', 'node', args, { cwd: PROJECT_ROOT }, parseTrainLine);
  return { code, dataPath: code === 0 ? dataPath : null };
});

// Step 2 — fine-tune the student (QLoRA), then auto-merge.
ipcMain.handle('pipeline:train', async (_e, cfg) => {
  saveConfig(cfg);
  const dir = runDir(cfg.outModelName);
  const dataPath = path.join(dir, 'data.jsonl');
  if (!fs.existsSync(dataPath)) return { code: -1, error: 'No dataset — run Generate first.' };
  const outDir = path.join(dir, 'adapter');
  const args = [
    path.join(ENGINE_DIR, 'train_qlora.py'),
    '--base', cfg.baseModel,
    '--data', dataPath,
    '--out', outDir,
    '--epochs', String(cfg.epochs),
    '--lr', String(cfg.learningRate),
    '--batch', String(cfg.batchSize),
    '--grad-accum', String(cfg.gradAccum),
    '--max-len', String(cfg.maxLen),
    '--vram-budget', String(cfg.vramBudget),
    '--patience', String(cfg.patience),
    '--lora-r', String(cfg.loraR),
    '--lora-alpha', String(cfg.loraAlpha),
    '--merge-after',
  ];
  const { code } = await runChild('train', VENV_PY, args, { cwd: PROJECT_ROOT }, parseTrainLine);
  const merged = path.join(outDir + '-merged');
  return { code, mergedDir: code === 0 && fs.existsSync(merged) ? merged : null };
});

// Step 3 — import the merged student into Ollama (Modelfile -> ollama create).
ipcMain.handle('pipeline:deploy', async (_e, cfg) => {
  const dir = runDir(cfg.outModelName);
  const merged = path.join(dir, 'adapter-merged');
  if (!fs.existsSync(merged)) return { code: -1, error: 'No merged model — run Train first.' };
  // Write a Modelfile next to the merged dir.
  const modelfile = path.join(dir, 'Modelfile');
  const sys = (cfg.systemPrompt || '').replace(/"""/g, '\\"\\"\\"');
  const content =
    `FROM ${merged}\n` +
    `PARAMETER temperature ${cfg.temperature}\n` +
    `PARAMETER top_p ${cfg.topP}\n` +
    `PARAMETER num_predict ${cfg.numPredict}\n` +
    (sys ? `SYSTEM """${sys}"""\n` : '');
  fs.writeFileSync(modelfile, content);
  const { code } = await runChild('deploy', 'ollama', ['create', cfg.outModelName, '-f', modelfile], { cwd: dir });
  return { code, model: code === 0 ? cfg.outModelName : null };
});

// Stop whatever child is running.
ipcMain.handle('pipeline:stop', () => {
  if (activeChild) {
    try {
      // On Windows, kill the process tree.
      spawn('taskkill', ['/pid', String(activeChild.pid), '/f', '/t'], { windowsHide: true });
    } catch {}
    return { ok: true };
  }
  return { ok: false };
});

// Misc: open a folder, read the dataset preview.
ipcMain.handle('runs:open', (_e, name) => {
  shell.openPath(runDir(name));
  return true;
});
ipcMain.handle('runs:preview', (_e, name) => {
  const p = path.join(runDir(name), 'data.jsonl');
  if (!fs.existsSync(p)) return { lines: [], count: 0 };
  const all = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  return { lines: all.slice(0, 12).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } }), count: all.length };
});
