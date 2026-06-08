// Generate the in-sim ATC panel from the real widget, so the panel is a faithful FULL mirror
// (all tabs: COMMS / PLAN / GROUND / SCHOOL / SETUP) and never drifts from the widget.
//
// What it changes for the in-sim / standalone-browser context:
//  - Hardcodes the brain endpoints to absolute localhost (the panel is loaded from file://, not
//    served by the brain, so relative ws://location.host / http://location won't resolve).
//  - Leaves the Electron `EL` bridge null (the widget already guards every EL.* call), so
//    Electron-only features (window controls, Piper, profiles IPC) simply no-op in-sim.
//  - Keeps the Leaflet CDN <script> (CoherentGT may block it; the PLAN map degrades to "no map"
//    via the existing `typeof L==='undefined'` guard in the widget).
//
// Run: node msfs-panel/build-panel.mjs   (also wired as part of the app build if desired)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const SRC = join(repoRoot, 'widget', 'atc-widget.html');
const OUT = join(here, 'html_ui', 'InGamePanels', 'ATCPanel', 'ATCPanel.html');

let html = readFileSync(SRC, 'utf8');

// 1) Force absolute localhost endpoints (panel runs from file://, so location.host is empty).
//    Widget line: var WS_URL = (location.protocol.indexOf('http') === 0) ? ('ws://' + location.host) : 'ws://localhost:8742';
//    That ternary already falls back to ws://localhost:8742 for non-http, which is what we want —
//    but make it unconditional to be safe in CoherentGT where protocol checks are unreliable.
html = html.replace(
  /var WS_URL = [^;]+;/,
  "var WS_URL = 'ws://localhost:8742';",
);
// httpBase() in the widget derives from WS_URL, so it becomes http://localhost:8742 automatically.

// 2) Tag the document so it's identifiable as the in-sim panel build (and lets CSS tweak if needed).
html = html.replace('<title>', '<!-- GENERATED in-sim panel — do not edit; edit widget/atc-widget.html + rerun build-panel.mjs -->\n<title>ATC Panel — ');

// 3) Panel-fit CSS. In MSFS CoherentGT the panel iframe does NOT give the body the full panel
//    height the way a browser does, so the widget's `.shell{position:fixed;inset:0}` collapses and
//    everything below the tab bar is clipped (only header + tabs show). Force the root chain to the
//    real panel viewport with vw/vh units and make .shell use the panel size explicitly. Injected
//    last so it wins the cascade. Also kill the rounded border/radius (panel already has a frame).
const PANEL_FIT_CSS = `
<style id="panel-fit">
  html, body { height: 100vh !important; width: 100vw !important; overflow: hidden !important; }
  .shell {
    position: absolute !important; top: 0 !important; left: 0 !important;
    width: 100vw !important; height: 100vh !important; inset: auto !important;
    border: 0 !important; border-radius: 0 !important;
  }
  /* let the main column own all vertical space and scroll its content, not the window */
  .mainpanel { height: 100vh !important; min-height: 0 !important; }
  .views { min-height: 0 !important; }
  /* CoherentGT can mis-size flex children; belt-and-suspenders so content areas scroll */
  #log, .gpanel, .setup, .school, .drawerbody { min-height: 0 !important; }
</style>`;
html = html.replace('</head>', PANEL_FIT_CSS + '\n</head>');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`[build-panel] generated ${OUT} from ${SRC} (${html.length} bytes)`);

// 2b) Copy the widget add-on modules the panel references (<script src="...">) into the panel dir,
//     so they resolve in-sim. These are the v1.1 self-contained UI modules loaded after the main script.
const ADDONS = ['metar-hud.js', 'handoff-cue.js', 'cpdlc-panel.js', 'voice-input.js', 'panel-mode.js', 'panel-mode.css'];
for (const file of ADDONS) {
  const from = join(repoRoot, 'widget', file);
  try {
    const { copyFileSync, existsSync } = await import('node:fs');
    if (existsSync(from)) { copyFileSync(from, join(dirname(OUT), file)); }
    else console.log(`[build-panel] NOTE: add-on ${file} not found in widget/ — skipped`);
  } catch (e) { console.log(`[build-panel] add-on copy failed for ${file}:`, e.message); }
}
console.log(`[build-panel] copied ${ADDONS.length} add-on module(s) into the panel`);

// Regenerate layout.json (the MSFS package file index) if MSFSLayoutGenerator.exe is available.
// MSFS won't load the package without a current layout.json. Point it at our layout.json so it
// re-indexes every file in msfs-panel/. Falls back with a clear note if the tool isn't found.
try {
  const { existsSync } = await import('node:fs');
  const candidates = [
    join(process.env.USERPROFILE || '', 'Downloads', 'MSFSLayoutGenerator.exe'),
    join(process.env.USERPROFILE || '', 'Downloads', 'MSFSLayoutGenerator (1).exe'),
  ];
  const gen = candidates.find((p) => existsSync(p));
  const layout = join(here, 'layout.json');
  if (!existsSync(layout)) writeFileSync(layout, JSON.stringify({ content: [] }, null, 2));
  if (gen) {
    const { spawnSync } = await import('node:child_process');
    spawnSync(gen, [layout], { stdio: 'ignore' });
    console.log(`[build-panel] regenerated layout.json via ${gen}`);
  } else {
    console.log('[build-panel] NOTE: MSFSLayoutGenerator.exe not found in Downloads — run it on msfs-panel/layout.json before packaging.');
  }
} catch (e) {
  console.log('[build-panel] layout regen skipped:', e.message);
}
