/* handoff-cue.js — auto-tune confirmation chime + "you're now with <Approach>" banner.
 *
 * Self-contained widget add-on. When the active ATC controller changes (the WS already
 * emits {type:'state', activeController} on every handoff, and {type:'atc_tx', freq} when a
 * new frequency is spoken), this module:
 *   1. plays a short two-note WebAudio chime (synthesized, no audio file), and
 *   2. shows a transient banner: "✔ Now with Approach — 119.200".
 *
 * It is deliberately decoupled from the rest of atc-widget.html so it can be wired in two ways:
 *   A) Explicitly (preferred): call window.HandoffCue.onControllerChange(kind, freqMhz) from the
 *      existing `state` / `atc_tx` WS handlers.
 *   B) Automatically (fallback): if no explicit call ever arrives, the module sniffs WebSocket
 *      traffic to ws://*:8742 and reacts to `state` messages itself.
 * Either path is safe on its own; together they de-dupe so the cue fires once per real change.
 *
 * No facts are invented here — the controller identity and frequency come straight off the wire.
 * Vanilla JS, no build step, no dependencies. Matches widget conventions (2-space indent).
 */
(function () {
  'use strict';

  // Friendly station labels. Mirrors STATION in atc-widget.html; kept local so this file is
  // self-contained and never throws if loaded before the main script defines its globals.
  var LABELS = {
    delivery: 'Clearance Delivery',
    ground: 'Ground',
    tower: 'Tower',
    departure: 'Departure',
    center: 'Center',
    approach: 'Approach'
  };

  var CONFIG = {
    bannerMs: 3400,       // how long the banner stays fully visible before fading
    fadeMs: 450,          // fade-out duration
    volume: 0.18,         // master chime gain (gentle by design — never earrapes)
    minGapMs: 1200,       // ignore repeat triggers for the same controller within this window
    enabled: true         // master on/off (toggle via setEnabled)
  };

  var lastKind = null;        // last controller we observed (changes drive the cue)
  var lastCueKey = null;      // last controller we actually cued (for A+B path de-dup)
  var lastFireAt = 0;         // timestamp of the last cue, for de-dup
  var lastFreqByKind = {};    // remember the most recent freq seen per controller
  var actx = null;            // shared AudioContext
  var bannerEl = null;        // the transient banner element
  var bannerTimer = null;
  var styleInjected = false;

  /* ---------------- WebAudio chime ---------------- */

  function ensureCtx() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!actx) {
      try { actx = new AC(); } catch (e) { return null; }
    }
    if (actx.state === 'suspended') {
      try { actx.resume(); } catch (e) { /* ignore */ }
    }
    return actx;
  }

  // One soft sine "ping" with a quick attack and exponential decay (bell-like, not a buzzer).
  function tone(c, startAt, freqHz, durSec, peak) {
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqHz, startAt);
    // Tiny upward glide gives it an "uplink/confirm" feel rather than a flat beep.
    osc.frequency.exponentialRampToValueAtTime(freqHz * 1.02, startAt + durSec * 0.5);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);            // fast attack
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durSec);          // smooth tail
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(startAt);
    osc.stop(startAt + durSec + 0.02);
  }

  // Two-note rising "auto-tune confirmed" chime (a perfect fourth, ~660 -> ~880 Hz).
  function playChime() {
    if (!CONFIG.enabled) return;
    var c = ensureCtx();
    if (!c) return;
    try {
      var t = c.currentTime + 0.005;
      var v = CONFIG.volume;
      tone(c, t, 659.25, 0.16, v);            // E5
      tone(c, t + 0.11, 880.0, 0.30, v * 1.05); // A5, slightly longer + brighter
    } catch (e) { /* never let audio break the UI */ }
  }

  /* ---------------- Transient banner ---------------- */

  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var css = ''
      + '#handoffCue{position:fixed;left:50%;top:54px;transform:translateX(-50%) translateY(-8px);'
      + 'z-index:99999;display:flex;align-items:center;gap:9px;padding:8px 15px;border-radius:9px;'
      + 'font:700 12.5px "Inter","Segoe UI",system-ui,sans-serif;letter-spacing:.3px;color:#eafff5;'
      + 'background:linear-gradient(135deg,#10402c,#123a52);border:1px solid #2f7d5a;'
      + 'box-shadow:0 6px 22px rgba(0,0,0,.45);opacity:0;pointer-events:none;'
      + 'transition:opacity .28s ease,transform .28s ease;white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis;}'
      + '#handoffCue.show{opacity:1;transform:translateX(-50%) translateY(0);}'
      + '#handoffCue .hcdot{width:8px;height:8px;border-radius:50%;background:#43d17a;'
      + 'box-shadow:0 0 8px #43d17a;flex:0 0 8px;}'
      + '#handoffCue .hcstn{color:#aef0d0;}'
      + '#handoffCue .hcfreq{font-family:"Cascadia Mono","Consolas",ui-monospace,monospace;'
      + 'color:#74e6c2;margin-left:2px;}';
    var st = document.createElement('style');
    st.id = 'handoffCueStyle';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function ensureBanner() {
    if (bannerEl && document.body && document.body.contains(bannerEl)) return bannerEl;
    injectStyle();
    bannerEl = document.getElementById('handoffCue');
    if (!bannerEl) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'handoffCue';
      bannerEl.setAttribute('role', 'status');
      bannerEl.setAttribute('aria-live', 'polite');
      (document.body || document.documentElement).appendChild(bannerEl);
    }
    return bannerEl;
  }

  function fmtFreq(freqMhz) {
    var n = Number(freqMhz);
    return (isFinite(n) && n > 0) ? n.toFixed(3) : '';
  }

  function showBanner(label, freqMhz) {
    var el = ensureBanner();
    if (!el) return;
    var f = fmtFreq(freqMhz);
    el.innerHTML = '<span class="hcdot"></span>'
      + '<span>Now with <span class="hcstn">' + escHtml(label) + '</span></span>'
      + (f ? '<span class="hcfreq">' + f + '</span>' : '');
    // restart the show animation even if already visible
    el.classList.remove('show');
    // force reflow so the transition replays
    void el.offsetWidth;
    el.classList.add('show');
    if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
    bannerTimer = setTimeout(function () {
      if (el) el.classList.remove('show');
      bannerTimer = null;
    }, CONFIG.bannerMs);
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch];
    });
  }

  /* ---------------- Public trigger ---------------- */

  // Call this when the active controller changes. `kind` is a ControllerKind
  // ('delivery'|'ground'|'tower'|'departure'|'center'|'approach') or a ready label string.
  // `freqMhz` is optional; if omitted we use the most recent freq remembered for this kind.
  function onControllerChange(kind, freqMhz) {
    if (!kind) return;
    var key = String(kind).toLowerCase();

    // Remember the freq for this kind whenever we learn one.
    if (freqMhz != null && fmtFreq(freqMhz)) lastFreqByKind[key] = Number(freqMhz);

    var now = Date.now();

    // Only cue on a REAL change of controller. The server re-emits {type:'state',
    // activeController} on every transmission (not just on handoff), so a same-controller
    // message must never re-chime no matter how much time has passed.
    if (key === lastKind) return;

    // De-dup window: collapse the two triggers that fire for ONE real change when both the
    // explicit onControllerChange() call and the WS sniffer (paths A + B) see it within a few
    // milliseconds. This guards the transition into `key` specifically.
    if (key === lastCueKey && (now - lastFireAt) < CONFIG.minGapMs) return;

    // Skip the very first controller assignment on connect (no real "handoff" happened yet)
    // unless it carries a frequency — keep the initial cue quiet to avoid a startup beep.
    var isFirst = (lastKind === null);

    lastKind = key;

    var label = LABELS[key] || titleCase(String(kind));
    var freq = (freqMhz != null) ? freqMhz : lastFreqByKind[key];

    if (isFirst && freq == null) {
      // Establish baseline silently — banner + chime begin from the next real handoff.
      return;
    }
    lastCueKey = key;
    lastFireAt = now;
    playChime();
    showBanner(label, freq);
  }

  // Record a frequency for the current/last controller without firing a cue. Useful to wire from
  // `atc_tx` so the banner can show the freq that was just spoken on the next handoff.
  function noteFrequency(freqMhz, kind) {
    var f = fmtFreq(freqMhz);
    if (!f) return;
    var key = kind ? String(kind).toLowerCase() : lastKind;
    if (key) lastFreqByKind[key] = Number(freqMhz);
  }

  function titleCase(s) {
    return s.replace(/\w\S*/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1); });
  }

  function setEnabled(on) { CONFIG.enabled = !!on; }
  function setVolume(v) { var n = Number(v); if (isFinite(n)) CONFIG.volume = Math.max(0, Math.min(1, n)); }

  /* ---------------- Automatic WS sniffing (fallback path B) ---------------- */
  // If the orchestrator never wires the explicit calls, we still work by listening to the same
  // WebSocket the widget already opens. We patch the prototype once and watch for `state`
  // messages (controller change) and `atc_tx` (to remember freqs). This is additive: it does not
  // consume or alter events for the existing onmessage handler.
  function installWsSniffer() {
    if (typeof window.WebSocket !== 'function') return;
    var Native = window.WebSocket;
    if (Native.__handoffCuePatched) return;

    function Patched(url, protocols) {
      var ws = protocols !== undefined ? new Native(url, protocols) : new Native(url);
      try {
        if (/:8742(\/|$)/.test(String(url)) || /localhost|127\.0\.0\.1/.test(String(url))) {
          ws.addEventListener('message', function (ev) {
            var m;
            try { m = JSON.parse(ev.data); } catch (e) { return; }
            if (!m || !m.type) return;
            if (m.type === 'state' && m.activeController) {
              onControllerChange(m.activeController, lastFreqByKind[String(m.activeController).toLowerCase()]);
            } else if (m.type === 'atc_tx' && m.freq) {
              // Remember the freq spoken so the next handoff banner can show it.
              noteFrequency(m.freq, lastKind);
            } else if (m.type === 'radio' && m.active && m.com1) {
              noteFrequency(m.com1, lastKind);
            }
          });
        }
      } catch (e) { /* ignore — never break socket creation */ }
      return ws;
    }
    // Preserve the prototype + statics so existing code keeps working.
    Patched.prototype = Native.prototype;
    Patched.CONNECTING = Native.CONNECTING;
    Patched.OPEN = Native.OPEN;
    Patched.CLOSING = Native.CLOSING;
    Patched.CLOSED = Native.CLOSED;
    Patched.__handoffCuePatched = true;
    try { window.WebSocket = Patched; } catch (e) { /* read-only in some sandboxes; explicit path still works */ }
  }

  // Patch as early as possible so we catch the widget's own socket creation. If this file is
  // loaded after the socket already opened, the explicit onControllerChange() path covers it.
  installWsSniffer();

  // Expose the API for the orchestrator to wire into the existing WS handlers.
  window.HandoffCue = {
    onControllerChange: onControllerChange,
    noteFrequency: noteFrequency,
    playChime: playChime,
    setEnabled: setEnabled,
    setVolume: setVolume,
    labels: LABELS
  };
})();
