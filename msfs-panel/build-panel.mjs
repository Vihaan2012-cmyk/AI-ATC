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

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`[build-panel] generated ${OUT} from ${SRC} (${html.length} bytes)`);
