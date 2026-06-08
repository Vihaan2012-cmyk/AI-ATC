/*
 * metar-hud.js — compact METAR (wind / altimeter / visibility) chips for the HUD strip.
 *
 * Self-contained, vanilla JS. No build step, no dependencies. Loaded by atc-widget.html
 * via a single <script src="metar-hud.js"></script> (see wiring notes in the PR).
 *
 * Data sources (in priority order):
 *   1. GET /api/metar?icao=XXXX  — preferred. Returns { icao, raw, parsed?, age? }.
 *      (Wire this endpoint in src/brain/comms/server.ts — see wiring notes.)
 *   2. The existing 'fpinfo' WebSocket message, which already carries
 *      { weather: { origin, dest } } as raw METAR strings. The widget pushes those
 *      to us via MetarHud.setRawFromFpinfo(...) so the chips work even before the
 *      /api/metar endpoint exists.
 *
 * Everything is best-effort and deterministic: we never invent weather. If we have no
 * raw METAR we render an em-dash. The deterministic engine still owns the real facts.
 *
 * Public API (window.MetarHud):
 *   MetarHud.init({ httpBase, getActiveIcao })  — call once after the DOM/HUD exists.
 *   MetarHud.setRawFromFpinfo(fpinfo)           — feed raw METAR from the 'fpinfo' WS msg.
 *   MetarHud.setActiveIcao(icao)                — switch which field's wx is shown.
 *   MetarHud.refresh()                          — force an /api/metar fetch now.
 *   MetarHud.renderRaw(icao, raw)               — render directly from a raw METAR string.
 */
(function () {
  'use strict';

  var SKY = { FEW: 'FEW', SCT: 'SCT', BKN: 'BKN', OVC: 'OVC' };

  // ---- styles -------------------------------------------------------------
  // Injected once. Reuses the HUD strip's look (.hudc / .hk / .hv) and adds a
  // few wx-specific accents (flight-category color + gust/crosswind warnings).
  var CSS = [
    '.hudc.wx-chip { gap: 1px; }',
    '.hud .hv.wx-vfr  { color: #5fd38a; }',   /* VFR  — green  */
    '.hud .hv.wx-mvfr { color: #57b6ff; }',   /* MVFR — blue   */
    '.hud .hv.wx-ifr  { color: #ff6b6b; }',   /* IFR  — red    */
    '.hud .hv.wx-lifr { color: #d77bff; }',   /* LIFR — magenta*/
    '.hud .hv.wx-gust { color: #e0a14a; }',   /* gusting wind  */
    '.hud .hk.wx-cat-tag { letter-spacing: .5px; }',
    '.hudc.wx-chip .wx-sub { font: 700 8px ui-monospace, Consolas, monospace; color: #5f7488; letter-spacing: .5px; }',
    '.hudc.wx-chip.wx-stale .hv { opacity: .55; }',
    'body[data-contrast="1"] .hud .hv.wx-vfr,',
    'body[data-contrast="1"] .hud .hv.wx-mvfr,',
    'body[data-contrast="1"] .hud .hv.wx-ifr,',
    'body[data-contrast="1"] .hud .hv.wx-lifr { color: #fff; }',
  ].join('\n');

  function injectCss() {
    if (document.getElementById('metar-hud-css')) return;
    var s = document.createElement('style');
    s.id = 'metar-hud-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- DOM ----------------------------------------------------------------
  // Build the three wx chips and append them to the HUD strip if absent.
  function el(id) { return document.getElementById(id); }

  function chip(id, label, subId) {
    var c = document.createElement('div');
    c.className = 'hudc wx-chip';
    c.id = 'wx-chip-' + id;
    var k = document.createElement('span');
    k.className = 'hk';
    k.textContent = label;
    var v = document.createElement('span');
    v.className = 'hv';
    v.id = 'wx-' + id;
    v.textContent = '—';
    c.appendChild(k);
    c.appendChild(v);
    if (subId) {
      var sub = document.createElement('span');
      sub.className = 'wx-sub';
      sub.id = 'wx-' + subId;
      sub.textContent = '';
      c.appendChild(sub);
    }
    return c;
  }

  function ensureChips() {
    var hud = el('hud');
    if (!hud) return false;
    if (el('wx-chip-wind')) return true; // already built
    // Insert after the SIGNAL chip if present, else just append, so wx sits near
    // the live/environment readouts rather than the assigned-clearance ones.
    var anchor = el('hud-sig');
    var ref = anchor ? anchor.parentNode : null;
    var windC = chip('wind', 'WIND', null);
    var altC = chip('altim', 'ALTIM', null);
    var visC = chip('vis', 'VIS', 'cat');
    if (ref && ref.nextSibling) {
      hud.insertBefore(windC, ref.nextSibling);
      hud.insertBefore(altC, windC.nextSibling);
      hud.insertBefore(visC, altC.nextSibling);
    } else {
      hud.appendChild(windC);
      hud.appendChild(altC);
      hud.appendChild(visC);
    }
    if (hud.style.display === 'none' || hud.style.display === '') hud.style.display = 'flex';
    return true;
  }

  // ---- parsing ------------------------------------------------------------
  // Best-effort METAR parse, mirroring src/brain/sim/weather.ts parseMetarDetail()
  // but returning compact display values. Pure & deterministic.
  function parse(raw) {
    var out = {
      windDir: null,       // degrees true, or 'VRB', or null
      windKt: null,
      gustKt: null,
      windStr: '—',
      altInHg: null,       // e.g. 29.92
      altQnh: null,        // e.g. 1013 (hPa)
      altStr: '—',
      visStr: '—',
      visSM: null,         // numeric statute miles when known
      ceilingFt: null,     // lowest BKN/OVC layer in ft, or null
      category: null,      // 'VFR' | 'MVFR' | 'IFR' | 'LIFR'
    };
    if (!raw || typeof raw !== 'string') return out;
    var s = raw.trim().toUpperCase();

    // Wind: dddssKT, dddssGggKT, VRBssKT, 00000KT (calm).
    var w = s.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
    if (/\b00000KT\b/.test(s)) {
      out.windStr = 'CALM';
    } else if (w) {
      var dir = w[1] === 'VRB' ? 'VRB' : parseInt(w[1], 10);
      out.windDir = w[1] === 'VRB' ? 'VRB' : dir;
      out.windKt = parseInt(w[2], 10);
      if (w[3]) out.gustKt = parseInt(w[3], 10);
      var dirTxt = w[1] === 'VRB' ? 'VRB/' : (pad3(dir) + '°/');
      out.windStr = dirTxt + out.windKt + (out.gustKt ? 'G' + out.gustKt : '') + 'kt';
    }

    // Altimeter: Annnn (inHg, US) or Qnnnn (hPa, intl).
    var a = s.match(/\bA(\d{4})\b/);
    if (a) {
      out.altInHg = parseFloat(a[1].slice(0, 2) + '.' + a[1].slice(2));
      out.altStr = a[1].slice(0, 2) + '.' + a[1].slice(2);
    } else {
      var q = s.match(/\bQ(\d{4})\b/);
      if (q) {
        out.altQnh = parseInt(q[1], 10);
        out.altStr = 'Q' + q[1];
      }
    }

    // Visibility: statute miles (US) or 4-digit meters (intl) or CAVOK.
    if (/\bCAVOK\b/.test(s)) {
      out.visStr = 'CAVOK';
      out.visSM = 10;
    } else {
      var vsm = s.match(/\b(\d{1,2}|\d\/\d|\d\s\d\/\d|M1\/4)SM\b/);
      if (vsm) {
        out.visStr = vsm[1] + 'SM';
        out.visSM = smToNumber(vsm[1]);
      } else {
        var vm = s.match(/\s(\d{4})\s/);
        if (vm) {
          var meters = parseInt(vm[1], 10);
          out.visStr = (meters >= 9999 ? '10+km' : meters + 'm');
          out.visSM = meters / 1609.34;
        }
      }
    }

    // Ceiling: lowest BKN/OVC/VV layer, hundreds of feet.
    var ceil = null;
    var layerRe = /\b(BKN|OVC|VV)(\d{3})\b/g;
    var lm;
    while ((lm = layerRe.exec(s)) !== null) {
      var ft = parseInt(lm[2], 10) * 100;
      if (ceil === null || ft < ceil) ceil = ft;
    }
    if (/\b(SKC|CLR|NSC|CAVOK)\b/.test(s)) { if (ceil === null) ceil = Infinity; }
    out.ceilingFt = (ceil === Infinity) ? null : ceil;

    out.category = flightCategory(out.visSM, ceil);
    return out;
  }

  function pad3(n) { return ('00' + n).slice(-3); }

  function smToNumber(t) {
    t = t.trim();
    if (t === 'M1/4') return 0.25;
    if (t.indexOf(' ') >= 0) {
      var parts = t.split(' ');
      return Number(parts[0]) + frac(parts[1]);
    }
    if (t.indexOf('/') >= 0) return frac(t);
    return Number(t);
  }
  function frac(t) { var p = t.split('/'); return Number(p[0]) / Number(p[1]); }

  // Standard US flight-category thresholds (visibility SM + ceiling AGL ft).
  function flightCategory(visSM, ceilFt) {
    var c = (ceilFt === null || ceilFt === Infinity) ? Infinity : ceilFt;
    var v = (visSM === null) ? Infinity : visSM;
    if (c < 500 || v < 1) return 'LIFR';
    if (c < 1000 || v < 3) return 'IFR';
    if (c <= 3000 || v <= 5) return 'MVFR';
    return 'VFR';
  }

  // ---- render -------------------------------------------------------------
  function setHv(id, val, cls) {
    var e = el(id);
    if (!e) return;
    e.textContent = (val == null || val === '') ? '—' : val;
    e.className = 'hv' + (cls ? (' ' + cls) : '');
  }

  function render(icao, raw, opts) {
    if (!ensureChips()) return;
    var p = parse(raw);
    var stale = !!(opts && opts.stale);

    // WIND chip — warn-colored when gusting.
    setHv('wx-wind', p.windStr, p.gustKt ? 'wx-gust' : null);

    // ALTIM chip.
    setHv('wx-altim', p.altStr, null);

    // VIS chip + flight-category sub-label, colored by category.
    var catCls = p.category ? ('wx-' + p.category.toLowerCase()) : null;
    setHv('wx-vis', p.visStr, catCls);
    var sub = el('wx-cat');
    if (sub) sub.textContent = (icao ? icao + ' ' : '') + (p.category || '');

    // Dim the whole wx set when the data is known-stale.
    ['wind', 'altim', 'vis'].forEach(function (k) {
      var c = el('wx-chip-' + k);
      if (c) c.classList.toggle('wx-stale', stale);
    });

    state.lastIcao = icao || state.lastIcao;
    state.lastRaw = raw || state.lastRaw;
  }

  // ---- state + polling ----------------------------------------------------
  var state = {
    httpBase: null,
    getActiveIcao: null,
    activeIcao: null,
    lastIcao: null,
    lastRaw: null,
    rawByIcao: {},     // icao -> raw, populated from fpinfo
    timer: null,
  };

  function activeIcao() {
    if (state.activeIcao) return state.activeIcao;
    if (typeof state.getActiveIcao === 'function') {
      try { var v = state.getActiveIcao(); if (v) return String(v).toUpperCase(); } catch (e) {}
    }
    return state.lastIcao;
  }

  // Try the /api/metar endpoint; fall back to whatever raw we cached from fpinfo.
  function refresh() {
    var icao = activeIcao();
    var base = state.httpBase;
    if (base && icao) {
      var url = base + '/api/metar?icao=' + encodeURIComponent(icao);
      fetch(url, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.raw) {
            render(j.icao || icao, j.raw, { stale: ageStale(j.age) });
          } else {
            fallbackRender(icao);
          }
        })
        .catch(function () { fallbackRender(icao); });
    } else {
      fallbackRender(icao);
    }
  }

  function ageStale(ageSec) {
    return typeof ageSec === 'number' && ageSec > 3900; // > ~65 min old
  }

  function fallbackRender(icao) {
    var raw = (icao && state.rawByIcao[icao]) || state.lastRaw;
    if (raw) render(icao || state.lastIcao, raw, { stale: false });
    else if (ensureChips()) { /* leave em-dashes; nothing to show yet */ }
  }

  // ---- public API ---------------------------------------------------------
  var api = {
    init: function (cfg) {
      cfg = cfg || {};
      // Prefer an explicit httpBase; otherwise reuse the widget's global httpBase()
      // helper (atc-widget.html exposes it) so the /api/metar path works without
      // the host having to thread the base URL through.
      var base = cfg.httpBase || null;
      if (!base && typeof window.httpBase === 'function') {
        try { base = window.httpBase(); } catch (e) { base = null; }
      }
      state.httpBase = base || null;
      state.getActiveIcao = cfg.getActiveIcao || null;
      injectCss();
      ensureChips();
      refresh();
      if (state.timer) clearInterval(state.timer);
      // Real METAR updates ~hourly; poll modestly. The server caches/refreshes too.
      state.timer = setInterval(refresh, 5 * 60 * 1000);
      return api;
    },

    // Feed raw METAR from the existing 'fpinfo' WS message:
    //   { weather: { origin: '<raw>', dest: '<raw>' }, ... }
    // We need the ICAOs too; pass the plan/flight if available, else origin/dest fall
    // back to keys 'origin'/'dest' so at least one chip set renders.
    setRawFromFpinfo: function (fpinfo, originIcao, destIcao) {
      if (!fpinfo || !fpinfo.weather) return;
      var oi = (originIcao || '').toUpperCase();
      var di = (destIcao || '').toUpperCase();
      if (fpinfo.weather.origin) {
        if (oi) state.rawByIcao[oi] = fpinfo.weather.origin;
        if (!state.lastRaw) state.lastRaw = fpinfo.weather.origin;
        if (!state.lastIcao && oi) state.lastIcao = oi;
      }
      if (fpinfo.weather.dest && di) state.rawByIcao[di] = fpinfo.weather.dest;
      refresh();
    },

    // Switch which field's weather the chips show (e.g. origin while on the ground,
    // destination once arriving). icao is an ICAO code string.
    setActiveIcao: function (icao) {
      state.activeIcao = icao ? String(icao).toUpperCase() : null;
      refresh();
    },

    renderRaw: function (icao, raw) { render(icao ? String(icao).toUpperCase() : null, raw, {}); },

    refresh: refresh,

    // Exposed for testing / reuse.
    _parse: parse,
    _flightCategory: flightCategory,
  };

  window.MetarHud = api;

  // Auto-init on DOM ready if the host page didn't call init() explicitly. The host
  // can still call MetarHud.init(...) later to supply httpBase/getActiveIcao.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (!state.timer) { injectCss(); ensureChips(); }
    });
  } else {
    injectCss();
    ensureChips();
  }
})();
