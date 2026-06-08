/*
 * panel-mode.js — undocked / torn-off single-view mode for atc-widget.html.
 *
 * When the widget is opened in a secondary BrowserWindow with a ?view=comms (or ?view=map)
 * query param (see app/windows.js), this script makes the widget show ONLY that one view:
 *   - hides the tab bar (you can't switch views in a torn-off panel)
 *   - activates the requested view's tab/view pair using the SAME tab-click handler the
 *     widget already wires up, so view-specific init (e.g. showMap() for the map) still runs
 *   - tags <body> with data-panel + data-panel-view so CSS can compact the chrome
 *   - rebinds the title-bar close/minimize buttons to act on THIS window, not the main one
 *
 * The widget treats 'map' as an alias for the existing 'plan' view (the moving map lives in
 * PLAN). All other behavior (WebSocket, comms log, HUD) is unchanged and shared.
 *
 * Self-contained: include with <script defer src="panel-mode.js"></script> AFTER the widget's
 * own inline script (defer scripts run in document order, after the DOM is parsed). It reads
 * window.location.search and no-ops entirely when there is no ?view= param (normal docked use).
 */
(function () {
  'use strict';

  // Map the public ?view= value to the widget's internal data-v tab name.
  var VIEW_TO_TAB = { comms: 'comms', map: 'plan', plan: 'plan' };

  function getParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      // Fallback for any environment without URLSearchParams.
      var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search || '');
      return m ? decodeURIComponent(m[1]) : null;
    }
  }

  function activate() {
    var view = getParam('view');
    if (!view) return; // normal docked widget — do nothing.
    var tabName = VIEW_TO_TAB[view] || 'comms';

    document.body.setAttribute('data-panel', '1');
    document.body.setAttribute('data-panel-view', view);

    // Activate the requested view by clicking its tab button. Clicking (rather than just
    // toggling classes) ensures the widget's own per-view init runs (e.g. showMap()).
    var tabBtn = document.querySelector('.tab[data-v="' + tabName + '"]');
    if (tabBtn) {
      tabBtn.click();
    } else {
      // Defensive fallback: directly toggle the view if the tab button isn't found.
      var views = document.querySelectorAll('.view');
      for (var i = 0; i < views.length; i++) views[i].classList.remove('active');
      var target = document.getElementById('v-' + tabName);
      if (target) target.classList.add('active');
    }

    // In a frameless torn-off window the title-bar buttons must control THIS window. The
    // shared atcWin.close()/minimize() target the MAIN window via IPC, so rebind them to a
    // window-scoped path. Prefer dedicated panel IPC if the preload exposes it; otherwise
    // fall back to window.close() (works for the renderer's own BrowserWindow).
    var panelApi = window.atcPanel || null;
    var close = document.getElementById('wcClose');
    var minBtn = document.getElementById('wcMin');
    var winctl = document.getElementById('winctl');
    if (winctl) winctl.style.display = 'flex'; // always show controls in a torn-off panel
    if (close) {
      var clone = close.cloneNode(true); // drop the widget's main-window close listener
      close.parentNode.replaceChild(clone, close);
      clone.addEventListener('click', function () {
        if (panelApi && typeof panelApi.close === 'function') panelApi.close();
        else window.close();
      });
    }
    if (minBtn) {
      var mClone = minBtn.cloneNode(true);
      minBtn.parentNode.replaceChild(mClone, minBtn);
      mClone.addEventListener('click', function () {
        if (panelApi && typeof panelApi.minimize === 'function') panelApi.minimize();
        // No reliable renderer-only minimize fallback; if no panel API, leave as no-op.
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activate);
  } else {
    activate();
  }
})();
