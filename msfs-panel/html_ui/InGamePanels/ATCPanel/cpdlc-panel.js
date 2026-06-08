/* cpdlc-panel.js — self-contained CPDLC datalink panel for the ATC widget.
 *
 * Surfaces Hoppie CPDLC (the brain's existing datalink) as a proper datalog:
 * a scrolling uplink/downlink message log + a composer with standard responses
 * (WILCO / UNABLE / STANDBY / ROGER / AFFIRM / NEGATIVE) and request builders
 * (request altitude, request direct/route, request PDC, free text).
 *
 * Talks over the EXISTING widget WebSocket using a single new message type
 * 'cpdlc' (carrying an `action` discriminator), in both directions. For
 * backward compatibility with the current brain it ALSO understands the legacy
 * messages already broadcast by src/brain/comms/server.ts:
 *   cpdlc_status / cpdlc_in / cpdlc_sent
 * and falls back to emitting legacy outbound types (cpdlc_tx / cpdlc_pdc) when
 * the new unified 'cpdlc' handler is not present. See the BRAIN HANDLER block
 * at the bottom of this file for the server-side code to add.
 *
 * Vanilla JS, zero dependencies. Wiring (done by the orchestrator in
 * atc-widget.html — this module changes nothing there itself):
 *   1) Add a tab + view container following the existing pattern, e.g.
 *        <button class="tab" data-v="cpdlc">CPDLC</button>     (in .tabs)
 *        <div class="view" id="v-cpdlc"></div>                  (in .views)
 *   2) Load and init the panel against that container and the live socket:
 *        <script src="cpdlc-panel.js"></script>
 *        CpdlcPanel.init({ mount: document.getElementById('v-cpdlc'),
 *                          getWs: () => ws, callsign: flight && flight.callsign });
 *   3) In ws.onmessage, after parsing, also feed every message to the panel:
 *        CpdlcPanel.handleMessage(m);
 *
 * The panel keeps NO authoritative facts — it only displays datalink traffic
 * and composes pilot downlinks. All clearance facts come from the brain.
 */
(function (global) {
  'use strict';

  // ---- styles (injected once) ----------------------------------------------
  var CSS = [
    '.cpdlc { display:flex; flex-direction:column; height:100%; min-height:0; background:#0a131c; }',
    '.cpdlc-bar { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:9px 13px; border-bottom:1px solid #182433; background:#0c1722; }',
    '.cpdlc-bar .ct { font:800 11px ui-monospace,Consolas,monospace; letter-spacing:2px; color:#cdd9e5; }',
    '.cpdlc-bar .conn { margin-left:auto; display:flex; align-items:center; gap:6px; font:700 10px ui-monospace,Consolas,monospace; letter-spacing:1px; text-transform:uppercase; color:#ff5f73; }',
    '.cpdlc-bar .conn .dot { width:8px; height:8px; border-radius:50%; background:currentColor; box-shadow:0 0 7px currentColor; }',
    '.cpdlc-bar .conn.on { color:#43d17a; }',
    '.cpdlc-bar .sta { font:700 10px ui-monospace,Consolas,monospace; color:#5f7488; letter-spacing:.5px; }',
    '.cpdlc-log { flex:1 1 auto; min-height:0; overflow-y:auto; padding:11px 12px; display:flex; flex-direction:column; gap:8px; }',
    '.cpdlc-log::-webkit-scrollbar { width:7px; } .cpdlc-log::-webkit-scrollbar-thumb { background:#1f2c3a; border-radius:7px; }',
    '.cpdlc-empty { text-align:center; color:#56697d; font-size:12px; padding:18px 8px; }',
    '.cpdlc-msg { border-left:2px solid #2a3b4d; padding:4px 0 5px 10px; }',
    '.cpdlc-msg.up { border-left-color:#43d17a; }',      /* uplink: ATC -> us */
    '.cpdlc-msg.down { border-left-color:#e0a14a; }',    /* downlink: us -> ATC */
    '.cpdlc-msg.sys { border-left-color:transparent; text-align:center; color:#6f8197; font-size:11.5px; }',
    '.cpdlc-mh { display:flex; align-items:baseline; gap:8px; margin-bottom:2px; }',
    '.cpdlc-mh .dir { font:800 9.5px ui-monospace,Consolas,monospace; letter-spacing:1px; text-transform:uppercase; }',
    '.cpdlc-msg.up .dir { color:#43d17a; } .cpdlc-msg.down .dir { color:#e0a14a; }',
    '.cpdlc-mh .who { font:700 9.5px ui-monospace,Consolas,monospace; color:#8aa3b8; letter-spacing:.4px; }',
    '.cpdlc-mh .min { font:700 9px ui-monospace,Consolas,monospace; color:#56697d; }',
    '.cpdlc-mh .t { margin-left:auto; font:700 9px ui-monospace,Consolas,monospace; color:#56697d; }',
    '.cpdlc-body { font:600 12px ui-monospace,Consolas,monospace; color:#dbe6f1; white-space:pre-wrap; word-break:break-word; }',
    '.cpdlc-msg.up .cpdlc-body { color:#bfe9cf; }',
    '.cpdlc-st { display:inline-block; margin-top:4px; font:800 9px ui-monospace,Consolas,monospace; letter-spacing:.8px; padding:1px 6px; border-radius:4px; }',
    '.cpdlc-st.open { color:#e0a14a; background:#241a0e; border:1px solid #3a2c14; }',
    '.cpdlc-st.wilco { color:#43d17a; background:#0f2018; border:1px solid #1d3a2c; }',
    '.cpdlc-st.unable { color:#ff7a6b; background:#241210; border:1px solid #3a1714; }',
    '.cpdlc-st.standby { color:#9fb4ff; background:#10182e; border:1px solid #1d2a4a; }',
    '.cpdlc-st.roger,.cpdlc-st.affirm { color:#74e6c2; background:#0e2420; border:1px solid #1d3a34; }',
    '.cpdlc-st.failed { color:#ff5f73; background:#241012; border:1px solid #3a1418; }',
    '.cpdlc-resp { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }',
    '.cpdlc-resp button { font:700 10px ui-monospace,Consolas,monospace; letter-spacing:.5px; color:#cfe0f2; background:#122130; border:1px solid #21384a; border-radius:6px; padding:4px 9px; cursor:pointer; }',
    '.cpdlc-resp button:hover { border-color:#43d17a; color:#eafff8; }',
    '.cpdlc-quick { flex:0 0 auto; display:flex; flex-wrap:wrap; gap:6px; padding:9px 12px 0; }',
    '.cpdlc-quick .q { font:700 11px ui-monospace,Consolas,monospace; color:#9fe9bf; background:#102a1d; border:1px solid #1d3a2c; border-radius:7px; padding:6px 10px; cursor:pointer; }',
    '.cpdlc-quick .q:hover { border-color:#43d17a; color:#eafff8; }',
    '.cpdlc-quick .q[disabled] { opacity:.4; cursor:default; }',
    '.cpdlc-comp { flex:0 0 auto; display:flex; gap:7px; padding:10px 12px 12px; }',
    '.cpdlc-comp select { flex:0 0 92px; padding:9px 7px; border-radius:9px; border:1px solid #243747; background:#0f1925; color:#cfe0f2; font:600 11px ui-monospace,Consolas,monospace; outline:none; }',
    '.cpdlc-comp input { flex:1; min-width:0; padding:10px 12px; border-radius:9px; border:1px solid #243747; background:#0f1925; color:#fff; font:inherit; outline:none; }',
    '.cpdlc-comp input:focus,.cpdlc-comp select:focus { border-color:#43d17a; }',
    '.cpdlc-comp input::placeholder { color:#5f7388; }',
    '.cpdlc-comp button { min-width:54px; border:0; border-radius:9px; cursor:pointer; background:linear-gradient(135deg,#2bbf76,#1f8f5a); color:#fff; font-weight:800; }',
    '.cpdlc-comp button[disabled] { opacity:.4; cursor:default; }'
  ].join('\n');

  // ---- module state --------------------------------------------------------
  var state = {
    mounted: false,
    root: null,         // panel root element
    logEl: null,        // message log container
    getWs: null,        // () => WebSocket | null
    connected: false,   // CPDLC datalink up?
    callsign: '',       // our station id
    msgs: [],           // [{id, dir:'up'|'down'|'sys', who, text, status, atMs, mrn?}]
    seq: 0,             // local message id counter
    unifiedSeen: false  // true once we receive a unified 'cpdlc' msg (brain supports new protocol)
  };

  // Standard CPDLC pilot responses to an open uplink (downlink-msg-element set).
  var RESPONSES = ['WILCO', 'UNABLE', 'STANDBY', 'ROGER', 'AFFIRM', 'NEGATIVE'];

  // ---- helpers -------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  function pad2(x) { return ('0' + x).slice(-2); }
  function hms(ms) {
    var n = new Date(ms || Date.now());
    return pad2(n.getHours()) + ':' + pad2(n.getMinutes()) + ':' + pad2(n.getSeconds());
  }
  function injectCss() {
    if (document.getElementById('cpdlc-panel-css')) return;
    var st = document.createElement('style');
    st.id = 'cpdlc-panel-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  function wsReady() {
    var ws = state.getWs ? state.getWs() : null;
    return ws && ws.readyState === 1 ? ws : null;
  }

  // ---- WS send -------------------------------------------------------------
  // Always emit the new unified 'cpdlc' message. If we have not (yet) seen the
  // brain speak the unified protocol, ALSO emit the legacy type so the current
  // server still works. Once the brain replies with a unified 'cpdlc', we stop
  // double-sending (state.unifiedSeen flips true).
  function sendUnified(payload) {
    var ws = wsReady();
    if (!ws) { addSys('Datalink offline — message not sent.'); return false; }
    ws.send(JSON.stringify(Object.assign({ type: 'cpdlc' }, payload)));
    return true;
  }
  function sendLegacy(payload) {
    var ws = wsReady();
    if (!ws) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  // Send a pilot downlink (free text or built request). `to` is optional (brain
  // defaults to the origin/destination CDA). Mirrors it into the log optimistically.
  function sendDownlink(text, opts) {
    text = String(text || '').trim();
    if (!text) return;
    var o = opts || {};
    var m = addMsg('down', state.callsign || 'YOU', text, o.replyTo ? 'wilco' : null);
    if (o.replyTo != null) m.mrn = o.replyTo; // message reference number for a response
    sendUnified({ action: 'downlink', text: text, to: o.to || null, mrn: o.replyTo != null ? o.replyTo : undefined });
    if (!state.unifiedSeen) sendLegacy({ type: 'cpdlc_tx', text: text, to: o.to || undefined });
    render();
  }

  // Request a Pre-Departure Clearance over datalink.
  function requestPdc() {
    if (sendUnified({ action: 'request_pdc' })) {
      if (!state.unifiedSeen) sendLegacy({ type: 'cpdlc_pdc' });
      addSys('PDC requested via datalink…');
      render();
    }
  }

  // Respond to an open uplink with a standard element (WILCO/UNABLE/...).
  function respond(msgLocalId, word) {
    var src = null;
    for (var i = 0; i < state.msgs.length; i++) if (state.msgs[i].id === msgLocalId) { src = state.msgs[i]; break; }
    if (!src) return;
    src.status = word.toLowerCase();
    // Downlink the response, referencing the source uplink's network MRN if known.
    var ref = (src.mrn != null) ? src.mrn : undefined;
    addMsg('down', state.callsign || 'YOU', word, word.toLowerCase());
    sendUnified({ action: 'respond', word: word, mrn: ref, refLocal: msgLocalId });
    if (!state.unifiedSeen) sendLegacy({ type: 'cpdlc_tx', text: word });
    render();
  }

  // ---- request builders (composer "verb" dropdown) -------------------------
  // These produce standard ICAO-style CPDLC downlink free text. The brain owns
  // the actual clearance; this is only the request phrasing.
  function buildRequest(verb, arg) {
    arg = String(arg || '').trim().toUpperCase();
    switch (verb) {
      case 'CLB': return arg ? ('REQUEST CLIMB TO ' + arg) : 'REQUEST CLIMB';
      case 'DES': return arg ? ('REQUEST DESCENT TO ' + arg) : 'REQUEST DESCENT';
      case 'ALT': return arg ? ('REQUEST ' + arg) : 'REQUEST ALTITUDE';
      case 'DCT': return arg ? ('REQUEST DIRECT TO ' + arg) : 'REQUEST DIRECT';
      case 'RTE': return arg ? ('REQUEST ROUTE ' + arg) : 'REQUEST ROUTE CLEARANCE';
      case 'SPD': return arg ? ('REQUEST SPEED ' + arg) : 'REQUEST SPEED';
      case 'TXT': return arg; // free text
      default: return arg;
    }
  }

  // ---- log model -----------------------------------------------------------
  function addMsg(dir, who, text, status) {
    var m = { id: ++state.seq, dir: dir, who: who || '', text: String(text || ''), status: status || null, atMs: Date.now() };
    state.msgs.push(m);
    if (state.msgs.length > 200) state.msgs.shift();
    return m;
  }
  function addSys(text) { return addMsg('sys', '', text, null); }

  // Inbound uplink from the network/brain. status 'open' means a response is expected.
  function addUplink(who, text, mrn, expectResponse) {
    var m = addMsg('up', who || 'ATC', text, expectResponse ? 'open' : null);
    if (mrn != null) m.mrn = mrn;
    return m;
  }

  // ---- rendering -----------------------------------------------------------
  function setConnected(on, callsign) {
    state.connected = !!on;
    if (callsign) state.callsign = String(callsign);
    var bar = state.root && state.root.querySelector('.conn');
    var sta = state.root && state.root.querySelector('.sta');
    if (bar) { bar.classList.toggle('on', state.connected); bar.lastChild.textContent = state.connected ? 'connected' : 'offline'; }
    if (sta) sta.textContent = state.callsign ? ('STA ' + state.callsign) : '';
    updateQuickEnabled();
  }
  function updateQuickEnabled() {
    if (!state.root) return;
    var dis = !state.connected;
    state.root.querySelectorAll('.cpdlc-quick .q, .cpdlc-comp button, .cpdlc-comp input, .cpdlc-comp select').forEach(function (el) {
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT') el.disabled = dis;
      else el.disabled = dis;
    });
  }

  function render() {
    var log = state.logEl;
    if (!log) return;
    if (!state.msgs.length) {
      log.innerHTML = '<div class="cpdlc-empty">No datalink messages yet.' +
        (state.connected ? ' Send a request below.' : ' CPDLC is offline — add a Hoppie logon in Setup.') +
        '</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < state.msgs.length; i++) {
      var m = state.msgs[i];
      if (m.dir === 'sys') {
        html += '<div class="cpdlc-msg sys">' + esc(m.text) + '</div>';
        continue;
      }
      var dirLbl = m.dir === 'up' ? 'UPLINK ◂' : 'DOWNLINK ▸';
      html += '<div class="cpdlc-msg ' + m.dir + '" data-id="' + m.id + '">';
      html += '<div class="cpdlc-mh"><span class="dir">' + dirLbl + '</span>' +
        '<span class="who">' + esc(m.who) + '</span>' +
        (m.mrn != null ? '<span class="min">#' + esc(m.mrn) + '</span>' : '') +
        '<span class="t">' + hms(m.atMs) + '</span></div>';
      html += '<div class="cpdlc-body">' + esc(m.text) + '</div>';
      if (m.status) {
        var stCls = m.status === 'negative' ? 'unable' : m.status;
        html += '<span class="cpdlc-st ' + esc(stCls) + '">' + esc(m.status.toUpperCase()) + '</span>';
      }
      // Response row only for an OPEN uplink awaiting a pilot element.
      if (m.dir === 'up' && m.status === 'open') {
        html += '<div class="cpdlc-resp">';
        for (var r = 0; r < RESPONSES.length; r++) {
          html += '<button data-resp="' + RESPONSES[r] + '" data-mid="' + m.id + '">' + RESPONSES[r] + '</button>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    log.innerHTML = html;
    log.scrollTop = log.scrollHeight;
    // Wire response buttons (delegation-free; small set).
    log.querySelectorAll('.cpdlc-resp button').forEach(function (b) {
      b.addEventListener('click', function () {
        respond(parseInt(b.getAttribute('data-mid'), 10), b.getAttribute('data-resp'));
      });
    });
  }

  // ---- DOM build -----------------------------------------------------------
  function build(mount) {
    injectCss();
    var root = document.createElement('div');
    root.className = 'cpdlc';
    root.innerHTML =
      '<div class="cpdlc-bar">' +
        '<span class="ct">CPDLC DATALINK</span>' +
        '<span class="sta"></span>' +
        '<span class="conn"><span class="dot"></span><span>offline</span></span>' +
      '</div>' +
      '<div class="cpdlc-log"></div>' +
      '<div class="cpdlc-quick">' +
        '<button class="q" data-quick="pdc">REQ PDC</button>' +
        '<button class="q" data-quick="logon">LOGON</button>' +
        '<button class="q" data-quick="wx">REQ WX</button>' +
        '<button class="q" data-quick="voice">REQ VOICE</button>' +
      '</div>' +
      '<div class="cpdlc-comp">' +
        '<select class="cpdlc-verb">' +
          '<option value="TXT">TEXT</option>' +
          '<option value="CLB">CLIMB</option>' +
          '<option value="DES">DESCEND</option>' +
          '<option value="ALT">ALT</option>' +
          '<option value="DCT">DIRECT</option>' +
          '<option value="RTE">ROUTE</option>' +
          '<option value="SPD">SPEED</option>' +
        '</select>' +
        '<input class="cpdlc-input" placeholder="message / value (e.g. FL350, KEPEC)…" autocomplete="off" />' +
        '<button class="cpdlc-send">Send</button>' +
      '</div>';
    mount.appendChild(root);
    state.root = root;
    state.logEl = root.querySelector('.cpdlc-log');

    // composer send
    var input = root.querySelector('.cpdlc-input');
    var verbSel = root.querySelector('.cpdlc-verb');
    function doSend() {
      var verb = verbSel.value;
      var raw = input.value;
      var text = buildRequest(verb, raw);
      if (!text) return;
      sendDownlink(text);
      input.value = '';
    }
    root.querySelector('.cpdlc-send').addEventListener('click', doSend);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });

    // quick actions
    root.querySelectorAll('.cpdlc-quick .q').forEach(function (b) {
      b.addEventListener('click', function () {
        var q = b.getAttribute('data-quick');
        if (q === 'pdc') requestPdc();
        else if (q === 'logon') sendDownlink('REQUEST LOGON', { });
        else if (q === 'wx') sendDownlink('REQUEST WX', { });
        else if (q === 'voice') sendDownlink('REQUEST VOICE CONTACT', { });
      });
    });

    render();
    updateQuickEnabled();
  }

  // ---- public API ----------------------------------------------------------
  var CpdlcPanel = {
    /** Build the panel into `mount` and bind to the live WebSocket via getWs(). */
    init: function (opts) {
      opts = opts || {};
      if (state.mounted) return CpdlcPanel;
      var mount = opts.mount;
      if (!mount) throw new Error('CpdlcPanel.init: { mount } is required');
      state.getWs = typeof opts.getWs === 'function' ? opts.getWs : function () { return null; };
      build(mount);
      state.mounted = true;
      if (opts.callsign) state.callsign = String(opts.callsign);
      setConnected(state.connected, state.callsign);
      return CpdlcPanel;
    },

    /** Feed every parsed WS message here (from ws.onmessage). Ignores non-CPDLC. */
    handleMessage: function (m) {
      if (!m || !m.type) return;
      // New unified protocol -------------------------------------------------
      if (m.type === 'cpdlc') {
        state.unifiedSeen = true;
        switch (m.action) {
          case 'status':
            setConnected(!!m.enabled, m.callsign);
            break;
          case 'uplink':
            // m: { from, text, mrn?, response? }  response truthy => awaits a reply
            addUplink(m.from || 'ATC', m.text || '', m.mrn, !!m.response);
            render();
            break;
          case 'sent':
            // ack of one of our downlinks: { ok, to?, error? }
            if (!m.ok) addSys('Datalink send failed' + (m.error ? (' — ' + m.error) : '') + '.');
            render();
            break;
          case 'system':
            addSys(m.text || '');
            render();
            break;
          default:
            break;
        }
        return;
      }
      // Legacy protocol (current brain) — keep working without the new handler.
      if (m.type === 'cpdlc_status') { setConnected(!!m.enabled, m.callsign); return; }
      if (m.type === 'cpdlc_in') {
        // Legacy uplink: from like "KSEA (cpdlc)" or "KSEA PDC". local=our own echo.
        var awaits = /cpdlc/i.test(String(m.from || '')) && !m.local;
        addUplink(String(m.from || 'ATC').replace(/\s*\((telex|cpdlc|progress|position)\)\s*$/i, ''),
          m.text || '', null, awaits);
        if (m.ok === false) addSys('Datalink message not delivered.');
        render();
        return;
      }
      if (m.type === 'cpdlc_sent') {
        if (!m.ok) addSys('CPDLC send failed' + (m.error ? (' — ' + m.error) : '') + '.');
        render();
        return;
      }
    },

    /** Programmatic helpers (optional; e.g. a toolbar button elsewhere). */
    requestPdc: requestPdc,
    sendText: function (t, to) { sendDownlink(t, { to: to }); },
    isConnected: function () { return state.connected; },
    _state: state // for debugging
  };

  global.CpdlcPanel = CpdlcPanel;
})(typeof window !== 'undefined' ? window : this);

/* ===========================================================================
 * BRAIN-SIDE HANDLER (documentation — DO NOT paste here; add to the brain).
 * ===========================================================================
 *
 * The panel speaks a new unified WS message type 'cpdlc'. The current brain
 * (src/brain/comms/server.ts) already implements the legacy types this panel
 * also understands (cpdlc_status / cpdlc_in / cpdlc_sent <- ; cpdlc_tx /
 * cpdlc_pdc ->), so the panel works TODAY unchanged. To upgrade the brain to
 * the unified protocol, do the following in src/brain/comms/server.ts (these
 * are NEW lines; the file is owned by the orchestrator — see wiring notes):
 *
 * 1) On connection, alongside the existing cpdlc_status send, also send the
 *    unified status:
 *
 *      if (hoppie?.enabled) {
 *        send(ws, { type: 'cpdlc_status', enabled: true, callsign: deps.fp.callsign }); // legacy
 *        send(ws, { type: 'cpdlc', action: 'status', enabled: true, callsign: deps.fp.callsign });
 *      } else {
 *        send(ws, { type: 'cpdlc', action: 'status', enabled: false });
 *      }
 *
 * 2) In hoppie.startPolling(...), also broadcast the unified uplink. An inbound
 *    Hoppie CPDLC message expects a response; a telex does not:
 *
 *      hoppie.startPolling((msg) => {
 *        broadcast({ type: 'cpdlc_in', from: `${msg.from} (${msg.type})`, text: msg.packet, local: false, ok: true }); // legacy
 *        broadcast({ type: 'cpdlc', action: 'uplink', from: msg.from, text: msg.packet,
 *                    response: msg.type.toLowerCase() === 'cpdlc' });
 *      });
 *
 * 3) In ws.on('message'), add a branch handling the unified outbound type.
 *    `to` defaults to the origin clearance-delivery authority. WILCO/UNABLE/etc.
 *    and built requests are all sent as free text (telex) on the Hoppie net;
 *    use sendCpdlc() instead if you want them tagged as CPDLC packets:
 *
 *      } else if (msg.type === 'cpdlc' && hoppie?.enabled) {
 *        const a = (msg as { action?: string }).action;
 *        if (a === 'request_pdc') {
 *          const pdc = buildPdc(deps.fp);
 *          try {
 *            const ok = await hoppie.sendTelex(deps.fp.origin, pdc);
 *            send(ws, { type: 'cpdlc', action: 'uplink', from: `${deps.fp.origin} PDC`, text: pdc, response: false });
 *            send(ws, { type: 'cpdlc', action: 'sent', to: deps.fp.origin, ok });
 *          } catch (e) {
 *            send(ws, { type: 'cpdlc', action: 'sent', to: deps.fp.origin, ok: false, error: (e as Error).message });
 *          }
 *        } else if ((a === 'downlink' || a === 'respond') && typeof (msg as { text?: string; word?: string }).text === 'string'
 *                   || a === 'respond') {
 *          const m2 = msg as { text?: string; word?: string; to?: string };
 *          const text = (m2.word ?? m2.text ?? '').toString().trim();
 *          if (text) {
 *            const to = (m2.to || deps.fp.origin).toUpperCase();
 *            try {
 *              const ok = await hoppie.sendTelex(to, text);
 *              send(ws, { type: 'cpdlc', action: 'sent', to, ok });
 *            } catch (e) {
 *              send(ws, { type: 'cpdlc', action: 'sent', to, ok: false, error: (e as Error).message });
 *            }
 *          }
 *        }
 *      }
 *
 * No changes to src/brain/comms/hoppie.ts are required — it already exposes
 * sendTelex / sendCpdlc / startPolling used above.
 * ======================================================================== */
