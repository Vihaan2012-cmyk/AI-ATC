// Piper HD neural TTS manager (runs in the Electron main process).
// - downloads the Piper binary + voice models on demand into userData/piper/
// - synthesizes speech to a WAV buffer the renderer plays via Web Audio
//
// The full voice catalog is driven by the official rhasspy/piper-voices manifest
// (voices.json), grouped by continent. Nothing is bundled or redistributed: the binary
// and voices are fetched from the official releases + HuggingFace at the user's request.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PIPER_VERSION = '2023.11.14-2';
const PIPER_WIN_URL =
  `https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_windows_amd64.zip`;
const VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
const MANIFEST_URL = 'https://huggingface.co/rhasspy/piper-voices/raw/main/voices.json';

// Map a language region/family to a continent bucket for grouping in the UI.
const CONTINENT_BY_REGION = {
  // North America
  US: 'North America', MX: 'North America', CA: 'North America',
  // South America
  AR: 'South America', BR: 'South America',
  // Europe
  GB: 'Europe', IE: 'Europe', FR: 'Europe', DE: 'Europe', ES: 'Europe', PT: 'Europe',
  IT: 'Europe', NL: 'Europe', BE: 'Europe', LU: 'Europe', DK: 'Europe', NO: 'Europe',
  SE: 'Europe', FI: 'Europe', IS: 'Europe', PL: 'Europe', CZ: 'Europe', SK: 'Europe',
  HU: 'Europe', RO: 'Europe', BG: 'Europe', GR: 'Europe', RU: 'Europe', UA: 'Europe',
  SI: 'Europe', RS: 'Europe', AL: 'Europe', LV: 'Europe', GE: 'Europe',
  // Asia
  JO: 'Asia', IR: 'Asia', IN: 'Asia', PK: 'Asia', CN: 'Asia', VN: 'Asia', ID: 'Asia',
  KZ: 'Asia', NP: 'Asia', TR: 'Asia',
  // Africa
  CD: 'Africa', EG: 'Africa', ZA: 'Africa',
  // Oceania
  AU: 'Oceania', NZ: 'Oceania',
};
function continentFor(region, family) {
  if (CONTINENT_BY_REGION[region]) return CONTINENT_BY_REGION[region];
  if (family === 'ar' || family === 'fa' || family === 'zh') return 'Asia';
  if (family === 'sw') return 'Africa';
  return 'Other';
}

class Piper {
  constructor(userDataDir) {
    this.root = path.join(userDataDir, 'piper');
    this.binDir = path.join(this.root, 'bin');
    this.voicesDir = path.join(this.root, 'voices');
    this.exe = path.join(this.binDir, 'piper', 'piper.exe');
    this.manifestPath = path.join(this.root, 'voices.json');
    this._catalog = null;
  }

  binaryInstalled() { return fs.existsSync(this.exe); }

  /** Load (cached) the voices manifest and build a flat catalog grouped by continent. */
  async catalog() {
    if (this._catalog) return this._catalog;
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8')); } catch { /* fetch below */ }
    if (!manifest) {
      const r = await fetch(MANIFEST_URL, { redirect: 'follow' });
      if (!r.ok) throw new Error(`voices manifest fetch failed (${r.status})`);
      manifest = await r.json();
      try { fs.mkdirSync(this.root, { recursive: true }); fs.writeFileSync(this.manifestPath, JSON.stringify(manifest)); } catch { /* ignore */ }
    }
    const out = [];
    for (const key of Object.keys(manifest)) {
      const v = manifest[key];
      const onnx = Object.keys(v.files || {}).find((f) => f.endsWith('.onnx'));
      const json = Object.keys(v.files || {}).find((f) => f.endsWith('.onnx.json'));
      if (!onnx || !json) continue;
      const region = v.language?.region || '';
      const family = v.language?.family || '';
      const sizeMb = Math.round((v.files[onnx].size_bytes || 0) / 1e6);
      out.push({
        key,
        name: v.name,
        quality: v.quality,
        lang: v.language?.code || '',
        langName: v.language?.name_english || '',
        country: v.language?.country_english || region,
        continent: continentFor(region, family),
        sizeMb,
        label: `${v.name} — ${v.language?.name_english || ''}${region ? ' (' + region + ')' : ''} · ${v.quality}`,
        files: { onnx, json },
      });
    }
    out.sort((a, b) => a.continent.localeCompare(b.continent) || a.langName.localeCompare(b.langName) || a.name.localeCompare(b.name));
    this._catalog = out;
    return out;
  }

  voiceLocalPath(entry) { return path.join(this.voicesDir, `${entry.key}.onnx`); }
  voiceInstalledByKey(key) {
    const p = path.join(this.voicesDir, `${key}.onnx`);
    return fs.existsSync(p) && fs.existsSync(p + '.json');
  }

  /** Status for the UI: binary, totals, and the catalog grouped by continent. */
  async status() {
    const cat = await this.catalog();
    const groups = {};
    let installed = 0;
    for (const e of cat) {
      const inst = this.voiceInstalledByKey(e.key);
      if (inst) installed++;
      (groups[e.continent] = groups[e.continent] || []).push({
        key: e.key, label: e.label, sizeMb: e.sizeMb, installed: inst,
      });
    }
    const continents = Object.keys(groups).sort().map((name) => ({
      name,
      voices: groups[name],
      installed: groups[name].filter((v) => v.installed).length,
      total: groups[name].length,
    }));
    return { version: PIPER_VERSION, binary: this.binaryInstalled(), total: cat.length, installed, continents };
  }

  async _download(url, dest, onProgress) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status}) ${url}`);
    const total = Number(res.headers.get('content-length') || 0);
    let got = 0;
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      out.write(Buffer.from(value));
      if (onProgress && total) onProgress(got / total);
    }
    await new Promise((r) => out.end(r));
    fs.renameSync(tmp, dest);
  }

  /** Download + extract the Piper Windows binary. */
  async installBinary(onLog = () => {}) {
    if (this.binaryInstalled()) { onLog('Piper binary already installed.'); return true; }
    const zip = path.join(this.root, 'piper_windows_amd64.zip');
    onLog('Downloading Piper engine…');
    await this._download(PIPER_WIN_URL, zip, (p) => onLog(`  engine ${(p * 100).toFixed(0)}%`));
    onLog('Extracting…');
    fs.mkdirSync(this.binDir, { recursive: true });
    const extract = require('extract-zip');
    await extract(zip, { dir: this.binDir });
    try { fs.unlinkSync(zip); } catch { /* ignore */ }
    const ok = this.binaryInstalled();
    onLog(ok ? 'Piper engine ready.' : 'Engine install failed (piper.exe not found).');
    return ok;
  }

  /** Download a single voice model (.onnx + .onnx.json) by manifest key. */
  async installVoice(key, onLog = () => {}) {
    const cat = await this.catalog();
    const e = cat.find((c) => c.key === key);
    if (!e) throw new Error(`unknown voice ${key}`);
    if (this.voiceInstalledByKey(key)) { onLog(`${e.name} already installed.`); return true; }
    const model = this.voiceLocalPath(e);
    onLog(`Downloading ${e.label}…`);
    await this._download(`${VOICES_BASE}/${e.files.onnx}`, model, (p) => onLog(`  ${e.name} ${(p * 100).toFixed(0)}%`));
    await this._download(`${VOICES_BASE}/${e.files.json}`, model + '.json');
    const ok = this.voiceInstalledByKey(key);
    if (!ok) onLog(`${e.name} failed.`);
    return ok;
  }

  /** Master download: every voice not already present. Reports running progress. */
  async installAllVoices(onLog = () => {}) {
    const cat = await this.catalog();
    const pending = cat.filter((e) => !this.voiceInstalledByKey(e.key));
    const totalMb = pending.reduce((s, e) => s + e.sizeMb, 0);
    onLog(`Master download: ${pending.length} voices, ~${totalMb} MB total. This will take a while…`);
    let done = 0;
    for (const e of pending) {
      try {
        await this.installVoice(e.key, () => {});
        done++;
        if (done % 5 === 0 || done === pending.length) onLog(`  ${done}/${pending.length} voices…`);
      } catch (err) {
        onLog(`  skipped ${e.name}: ${err.message}`);
      }
    }
    onLog(`Master download complete: ${done}/${pending.length} added.`);
    return { added: done, total: pending.length };
  }

  /** Delete every downloaded voice model (keeps the engine + manifest). */
  deleteAllVoices(onLog = () => {}) {
    let removed = 0;
    try {
      if (fs.existsSync(this.voicesDir)) {
        for (const f of fs.readdirSync(this.voicesDir)) {
          fs.rmSync(path.join(this.voicesDir, f), { force: true });
          if (f.endsWith('.onnx')) removed++;
        }
      }
    } catch (e) { onLog(`delete error: ${e.message}`); }
    onLog(`Deleted ${removed} voices.`);
    return { removed };
  }

  /** Synthesize `text` with the voice `key`. Returns a WAV Buffer. */
  synth(text, key) {
    return new Promise((resolve, reject) => {
      if (!this.binaryInstalled()) return reject(new Error('piper engine not installed'));
      if (!this.voiceInstalledByKey(key)) return reject(new Error(`voice ${key} not installed`));
      const model = path.join(this.voicesDir, `${key}.onnx`);
      const args = ['--model', model, '--output_file', '-'];
      const p = spawn(this.exe, args, { cwd: path.dirname(this.exe), windowsHide: true });
      const chunks = [];
      const errs = [];
      p.stdout.on('data', (d) => chunks.push(d));
      p.stderr.on('data', (d) => errs.push(d));
      p.on('error', reject);
      p.on('close', (code) => {
        if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
        else reject(new Error(`piper exited ${code}: ${Buffer.concat(errs).toString().slice(0, 300)}`));
      });
      p.stdin.write(text);
      p.stdin.end();
    });
  }
}

module.exports = { Piper };
