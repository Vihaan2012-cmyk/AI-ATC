// Multi-monitor / undocked panels.
//
// Lets the user "tear off" a single view of the widget (COMMS or MAP) into its own
// always-on-top BrowserWindow that can live on a second monitor. Each secondary window
// loads the SAME atc-widget.html but with a ?view=comms or ?view=map query param; the
// widget itself reads that param and renders only that view (chrome-less, no tabs).
//
// This module is self-contained and owns nothing from main.js except the path to the
// widget HTML and the renderer settings. It keeps its own registry of open panels so a
// given view is only torn off once (calling open again just focuses the existing one).
//
// Wiring (see bottom of file / returned instructions): require this from main.js, pass it
// the resolved widgetPath + a getSettings() getter, and register the two IPC handlers.

const { BrowserWindow, screen } = require('electron');
const path = require('path');

// Views that can be undocked. Keys map 1:1 to the ?view= param the widget understands.
//  - 'comms' -> the COMMS view (radio log + composer)
//  - 'map'   -> the PLAN view's moving map (the widget treats 'map' as an alias for 'plan')
const PANEL_VIEWS = Object.freeze({
  comms: { title: 'ATC — Comms', width: 460, height: 620, minWidth: 360, minHeight: 360 },
  map: { title: 'ATC — Map', width: 720, height: 560, minWidth: 420, minHeight: 320 },
});

// Open panels keyed by view name. Each value is a BrowserWindow (or absent once closed).
const panels = new Map();

function isValidView(view) {
  return typeof view === 'string' && Object.prototype.hasOwnProperty.call(PANEL_VIEWS, view);
}

// Clamp opacity the same way main.js does, so torn-off panels match the main window.
function clampOpacity(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.3, Math.min(1, n));
}

// Pick a sensible spawn position: prefer a monitor that is NOT the one holding the main
// window (the whole point is to move the panel to a second screen). Falls back to a small
// offset on the primary display when only one monitor is present.
function placementFor(spec, ownerWindow) {
  const displays = screen.getAllDisplays();
  let target = screen.getPrimaryDisplay();
  if (displays.length > 1 && ownerWindow && !ownerWindow.isDestroyed()) {
    const ownerBounds = ownerWindow.getBounds();
    const ownerDisplay = screen.getDisplayMatching(ownerBounds);
    const other = displays.find((d) => d.id !== ownerDisplay.id);
    if (other) target = other;
  }
  const wa = target.workArea;
  const x = Math.round(wa.x + Math.max(0, (wa.width - spec.width) / 2));
  const y = Math.round(wa.y + Math.max(0, (wa.height - spec.height) / 3));
  return { x, y };
}

/**
 * Open (or focus) a torn-off panel for a single view.
 * @param {string} view - 'comms' | 'map'
 * @param {object} opts
 * @param {string} opts.widgetPath - absolute path to atc-widget.html
 * @param {object} [opts.settings] - renderer settings ({ accent, opacity, alwaysOnTop, ... })
 * @param {BrowserWindow} [opts.ownerWindow] - the main window, used for monitor placement + preload reuse
 * @returns {{ ok: boolean, view?: string, error?: string }}
 */
function openPanel(view, opts) {
  const options = opts || {};
  const { widgetPath, settings, ownerWindow } = options;
  if (!isValidView(view)) return { ok: false, error: `unknown view: ${String(view)}` };
  if (!widgetPath) return { ok: false, error: 'widgetPath is required' };

  // Already open -> just bring it forward.
  const existing = panels.get(view);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return { ok: true, view };
  }

  const spec = PANEL_VIEWS[view];
  const s = settings || {};
  const onTop = s.alwaysOnTop !== false; // default to always-on-top, like the main widget
  const pos = placementFor(spec, ownerWindow);

  const winw = new BrowserWindow({
    width: spec.width,
    height: spec.height,
    x: pos.x,
    y: pos.y,
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: true,
    alwaysOnTop: onTop,
    backgroundColor: '#00000000',
    title: spec.title,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (onTop) winw.setAlwaysOnTop(true, 'screen-saver');
  winw.setOpacity(clampOpacity(s.opacity));

  // Allow the microphone in torn-off COMMS panels too (push-to-talk lives in COMMS).
  winw.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'audioCapture');
  });

  // Load the widget with ?view=<view>. The widget reads location.search and renders only
  // that view (hiding the title bar's tabs). loadFile's `query` builds the search string.
  winw.loadFile(widgetPath, { query: { view, panel: '1' } });

  // Dev-friendly reload (matches main window behavior).
  winw.webContents.on('before-input-event', (e, input) => {
    const k = (input.key || '').toLowerCase();
    if (((input.control || input.meta) && k === 'r') || k === 'f5') winw.reload();
  });

  winw.on('closed', () => {
    if (panels.get(view) === winw) panels.delete(view);
  });

  panels.set(view, winw);
  return { ok: true, view };
}

/**
 * Close a torn-off panel for a view (no-op if not open).
 * @param {string} view
 * @returns {{ ok: boolean, view?: string }}
 */
function closePanel(view) {
  const w = panels.get(view);
  if (w && !w.isDestroyed()) w.close();
  panels.delete(view);
  return { ok: true, view };
}

/** Close every torn-off panel (call on app quit). */
function closeAllPanels() {
  for (const w of panels.values()) {
    try { if (w && !w.isDestroyed()) w.destroy(); } catch { /* ignore */ }
  }
  panels.clear();
}

/** Names of currently-open panels, e.g. ['comms']. */
function openPanelViews() {
  const out = [];
  for (const [view, w] of panels.entries()) if (w && !w.isDestroyed()) out.push(view);
  return out;
}

/**
 * Re-apply renderer settings (opacity, always-on-top) to all open panels. Call this from
 * main.js's settings:save handler so torn-off panels track the main window's appearance.
 * @param {object} settings
 */
function applySettingsToPanels(settings) {
  const s = settings || {};
  const onTop = s.alwaysOnTop !== false;
  for (const w of panels.values()) {
    if (!w || w.isDestroyed()) continue;
    w.setOpacity(clampOpacity(s.opacity));
    w.setAlwaysOnTop(onTop, 'screen-saver');
  }
}

module.exports = {
  PANEL_VIEWS,
  openPanel,
  closePanel,
  closeAllPanels,
  openPanelViews,
  applySettingsToPanels,
};
