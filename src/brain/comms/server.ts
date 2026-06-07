// Comms server for the widget: serves the widget HTML over HTTP and the ATC conversation
// + flight plan + live position over WebSocket on the same port.
//
// Protocol (JSON over WS):
//   widget -> brain : { type:'pilot_tx', text }
//   brain  -> widget: { type:'hello', callsign, origin, destination }
//                     { type:'flightplan', originPos, destPos, waypoints:[{ident,lat,lon}] }
//                     { type:'atc_tx', from, freq, text, expecting }
//                     { type:'state', activeController }
//                     { type:'position', lat, lon, hdg, altFt, gsKt, onGround }
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { FlightPhaseTracker } from '../sim/flightPhase.js';
import { spokenFlightCallsign } from '../util/aircraft.js';
import { HoppieClient } from './hoppie.js';
import { ChatterGenerator, type ChatterLevel } from '../atc/chatter.js';
import { isCongested, standbyPhrase } from '../atc/congestion.js';
import { ReactiveMonitor } from '../atc/monitor.js';
import { buildTrafficPicture, type TrafficPicture } from '../atc/liveTraffic.js';
import { applyPhraseology, type PhraseologyProfile } from '../atc/phraseologyProfile.js';
import { airportCoords } from '../navdata/airports.js';
import type { ControllerKind } from '../types.js';

// Short station labels for reactive callouts (by active controller kind).
const STATION_LABEL: Record<ControllerKind, string> = {
  delivery: 'Delivery', ground: 'Ground', tower: 'Tower',
  departure: 'Departure', center: 'Center', approach: 'Approach',
};
import type { ControllerSession } from '../atc/session.js';
import type { FlightPlan } from '../types.js';
import type { SimClient } from '../sim/simClient.js';
import type { MetarInfo } from '../sim/weather.js';
import { fetchMetars } from '../sim/weather.js';

// Proactive nudges as the flight progresses (reminds you to make the next call).
const ADVISORY: Record<string, string> = {
  climb: 'airborne — when ready, contact Departure.',
  descent: 'approaching top of descent — start your arrival and contact Approach.',
  approach: 'established on the approach — contact Tower for landing.',
  taxi_in: 'clear of the runway — contact Ground for taxi to parking.',
};

// Ground services (stock MSFS), for labels + spoken ramp acknowledgements.
const GROUND_SVC_LABEL: Record<string, string> = {
  pushback: 'Pushback', jetway: 'Jetway', fuel: 'Fuel truck', baggage: 'Baggage',
  catering: 'Catering', power: 'Ground power', rampTruck: 'Stairs', groundCrew: 'Ground crew',
  door: 'Main door', door2: 'Door 2', door3: 'Door 3', door4: 'Door 4',
};
// Map free pilot text to a ground SERVICE (only ones ATC doesn't already handle — pushback/taxi
// stay with the ATC session so you still get the clearance). Returns null if it's not a svc request.
function matchGroundService(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bfuel\b|refuel|top off|gas( us)? up/.test(t)) return 'fuel';
  if (/jet ?way|jet bridge|air ?bridge/.test(t)) return 'jetway';
  if (/cater|catering|galley|meals? loaded/.test(t)) return 'catering';
  if (/baggage|luggage|bags? (loaded|on)/.test(t)) return 'baggage';
  if (/ground power|gpu\b|external power|power cart/.test(t)) return 'power';
  if (/stairs|air ?stairs|boarding stairs/.test(t)) return 'rampTruck';
  if (/open .*doors?|toggle .*door|main door/.test(t)) return 'door';
  if (/ground crew|ramp crew|are you (there|connected)/.test(t)) return 'groundCrew';
  return null;
}

const GROUND_SVC_SPOKEN: Record<string, string> = {
  pushback: 'pushback approved, brakes released, cleared to push',
  jetway: 'jetway operating',
  fuel: 'fuel truck on the way',
  baggage: 'baggage loading',
  catering: 'catering on the way',
  power: 'ground power connected',
  rampTruck: 'stairs coming to the door',
  groundCrew: 'ground crew standing by',
  door: 'main door operating', door2: 'door two operating', door3: 'door three operating', door4: 'door four operating',
};

const here = dirname(fileURLToPath(import.meta.url));
const WIDGET_HTML = join(here, '..', '..', '..', 'widget', 'atc-widget.html');
const DASHBOARD_HTML = join(here, '..', '..', '..', 'widget', 'dashboard.html');

// Electron stores the logbook here; the dashboard reads the same file so history shows up.
function logbookPath(): string {
  const appData = process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return join(appData, 'Air Traffic Control', 'logbook.json');
}
function readLogbook(): unknown[] {
  try { return JSON.parse(readFileSync(logbookPath(), 'utf8')); } catch { return []; }
}

export interface CommsDeps {
  session: ControllerSession;
  fp: FlightPlan;
  sim: SimClient | null;
  weather: Record<string, MetarInfo>;
  /** Auto-tune COM1 on handoff: 'swap' (active), 'standby' (standby only), or 'off'. */
  autoTuneCom?: 'swap' | 'standby' | 'off';
  /** Hoppie ACARS logon (optional; enables CPDLC datalink). */
  hoppieLogon?: string;
  /** Ambient radio chatter level. */
  chatter?: ChatterLevel;
  /** Path to persist/restore session state across restarts (resume a flight). */
  statePath?: string;
  /** Regional phraseology + controller tone. */
  region?: import('../atc/phraseologyProfile.js').Region;
  tone?: import('../atc/phraseologyProfile.js').Tone;
  /** Opt-in: poll live AI/MP traffic via SimConnect. Off by default (can destabilize the sim). */
  liveTraffic?: boolean;
  /** Granular traffic sub-toggles to isolate the crash source (position/poll/advisories). */
  trafficOptions?: { position: boolean; strings: boolean; poll: boolean; advisories: boolean };
}

function fpInfoMessage(fp: FlightPlan, weather: Record<string, MetarInfo>) {
  const wx = (icao: string) => weather[icao]?.raw ?? '';
  return {
    type: 'fpinfo',
    aircraft: fp.aircraftIcao,
    aircraftName: fp.aircraftName ?? '',
    route: fp.route ?? '',
    cruise: fp.cruiseAltitudeFt,
    initialAlt: fp.initialAltitudeFt,
    depRunway: fp.departureRunway ?? '',
    alternate: fp.alternate ?? '',
    rules: fp.flightRules,
    ofp: fp.ofp ?? {},
    sections: fp.infoSections ?? [],
    weights: fp.weights ?? {},
    rawOfp: fp.rawOfp ?? '',
    weather: { origin: wx(fp.origin), dest: wx(fp.destination) },
  };
}

function flightPlanMessage(fp: FlightPlan) {
  return {
    type: 'flightplan',
    callsign: fp.callsign,
    origin: fp.origin,
    destination: fp.destination,
    aircraft: fp.aircraftIcao,
    cruise: fp.cruiseAltitudeFt,
    originPos: fp.originLat != null && fp.originLon != null ? { lat: fp.originLat, lon: fp.originLon } : null,
    destPos: fp.destLat != null && fp.destLon != null ? { lat: fp.destLat, lon: fp.destLon } : null,
    waypoints: fp.waypoints ?? [],
  };
}

// A datalink-style PDC (pre-departure clearance) text, built from the flight plan.
function buildPdc(fp: FlightPlan): string {
  const route = fp.sid ? `${fp.sid} DEP THEN AS FILED` : 'AS FILED';
  return [
    `CLD ${fp.callsign} CLRD TO ${fp.destination} OFF ${fp.origin}`,
    `VIA ${route}`,
    `CLIMB ${fp.initialAltitudeFt}FT EXPECT ${fp.cruiseAltitudeFt}FT`,
    fp.departureRunway ? `RWY ${fp.departureRunway}` : '',
    'CONTACT GND WHEN READY',
  ].filter(Boolean).join('\n');
}

// Aggregate stats from the logbook + the live flight, for the dashboard.
function dashboardData(deps: CommsDeps, lastPos: { lat: number; lon: number; hdg: number; altFt: number; gsKt: number; onGround: boolean } | null) {
  const log = readLogbook() as Array<Record<string, unknown>>;
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const flights = log.length;
  const airports = new Set<string>();
  let accSum = 0, accN = 0, emergencies = 0;
  const routes: Record<string, number> = {};
  for (const e of log) {
    if (typeof e.origin === 'string') airports.add(e.origin);
    if (typeof e.destination === 'string') airports.add(e.destination);
    if (typeof e.readbackAccuracy === 'number') { accSum += e.readbackAccuracy; accN++; }
    if (e.declaredEmergency) emergencies++;
    if (typeof e.origin === 'string' && typeof e.destination === 'string') {
      const k = `${e.origin}-${e.destination}`; routes[k] = (routes[k] ?? 0) + 1;
    }
  }
  const topRoutes = Object.entries(routes).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([route, count]) => ({ route, count }));

  // Coordinates for every airport seen (logbook + live), so the globe can plot all of them.
  const coords: Record<string, [number, number]> = {};
  const addCoord = (icao?: string) => {
    if (!icao) return;
    const c = airportCoords(icao);
    if (c) coords[icao.toUpperCase()] = c;
  };
  for (const a of airports) addCoord(a);
  addCoord(deps.fp.origin); addCoord(deps.fp.destination);
  return {
    callsign: deps.fp.callsign,
    live: {
      active: deps.sim != null && lastPos != null,
      origin: deps.fp.origin, destination: deps.fp.destination,
      aircraft: deps.fp.aircraftIcao, controller: deps.session.activeKind,
      pos: lastPos,
      originPos: deps.fp.originLat != null ? { lat: deps.fp.originLat, lon: deps.fp.originLon } : null,
      destPos: deps.fp.destLat != null ? { lat: deps.fp.destLat, lon: deps.fp.destLon } : null,
      waypoints: deps.fp.waypoints ?? [],
    },
    stats: {
      flights,
      airportsVisited: airports.size,
      avgReadbackAccuracy: accN ? Math.round(accSum / accN) : null,
      emergencies,
      topRoutes,
    },
    recent: log.slice(0, 20).map((e) => ({
      callsign: e.callsign, origin: e.origin, destination: e.destination,
      readbackAccuracy: num(e.readbackAccuracy), declaredEmergency: !!e.declaredEmergency, savedAt: e.savedAt,
      // pass through any richer fields the app saved (aircraft, route, cruise, full OFP, etc.)
      aircraft: e.aircraft ?? null, route: e.route ?? null, cruiseAltitudeFt: e.cruiseAltitudeFt ?? null,
      flightRules: e.flightRules ?? null, readbacksCorrect: e.readbacksCorrect ?? null,
      readbacksExpected: e.readbacksExpected ?? null, alternate: e.alternate ?? null,
      initialAlt: e.initialAlt ?? null, ofp: e.ofp ?? null, sections: e.sections ?? null, weights: e.weights ?? null,
      transcript: typeof e.transcript === 'string' ? e.transcript.slice(0, 8000) : null,
      rawOfp: typeof e.rawOfp === 'string' ? e.rawOfp.slice(0, 40000) : null,
    })),
    coords,
  };
}

// A clean, shareable flight report card for the CURRENT flight, from the live scorecard + plan.
function reportCard(deps: CommsDeps, conformance: number | null) {
  const sc = deps.session.scorecard;
  // Combine readback accuracy with altitude conformance (when available) for the grade.
  const composite = conformance != null ? Math.round((sc.readbackAccuracy + conformance) / 2) : sc.readbackAccuracy;
  const grade = composite >= 95 ? 'A' : composite >= 85 ? 'B'
    : composite >= 70 ? 'C' : composite >= 50 ? 'D' : 'F';
  return {
    callsign: deps.fp.callsign,
    aircraft: deps.fp.aircraftIcao,
    route: `${deps.fp.origin} → ${deps.fp.destination}`,
    rules: deps.fp.flightRules,
    cruiseFt: deps.fp.cruiseAltitudeFt,
    readbacks: { correct: sc.readbacksCorrect, expected: sc.readbacksExpected, accuracy: sc.readbackAccuracy },
    altitudeConformance: conformance,
    grade,
    declaredEmergency: sc.declaredEmergency,
    scenario: sc.scenario,
    summary: `${deps.fp.callsign} (${deps.fp.aircraftIcao}) ${deps.fp.origin}→${deps.fp.destination}: `
      + `readback ${sc.readbackAccuracy}%${conformance != null ? `, conformance ${conformance}%` : ''}, grade ${grade}`
      + (sc.declaredEmergency ? `, declared ${sc.scenario ?? 'emergency'}` : ''),
  };
}

export function startCommsServer(port: number, deps: CommsDeps): WebSocketServer {
  // Latest live position sample, for the dashboard's /api/dashboard snapshot.
  let lastPos: { lat: number; lon: number; hdg: number; altFt: number; gsKt: number; onGround: boolean } | null = null;
  let lastPilotTxAt = Date.now(); // for proactive "say intentions" prompts
  let pilotTxCount = 0;           // for deterministic frequency-congestion ("stand by")
  let lastConformance: number | null = null; // altitude conformance %, from the monitor

  // Resume a flight across an app/brain restart: restore the session if the saved state is the
  // same flight (matched on callsign + route inside restore()).
  if (deps.statePath) {
    try {
      const saved = JSON.parse(readFileSync(deps.statePath, 'utf8'));
      if (deps.session.restore(saved)) {
        console.log(`Resumed prior session: ${deps.fp.callsign} at ${deps.session.activeKind}.`);
      }
    } catch { /* no prior state */ }
  }
  const saveState = () => {
    if (!deps.statePath) return;
    try { mkdirSync(dirname(deps.statePath), { recursive: true }); writeFileSync(deps.statePath, JSON.stringify(deps.session.snapshot())); } catch { /* ignore */ }
  };

  // Regional phraseology + tone — light post-processing of reply text (facts untouched).
  const profile: PhraseologyProfile = { region: deps.region ?? 'us', tone: deps.tone ?? 'standard' };
  const phrase = (text: string, expecting: 'readback' | 'none') =>
    applyPhraseology(text, profile, expecting === 'none');
  const http = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (req.method === 'GET' && (path === '/' || path === '/atc-widget.html')) {
      try {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
          'pragma': 'no-cache',
        });
        res.end(readFileSync(WIDGET_HTML));
      } catch {
        res.writeHead(500);
        res.end('widget HTML not found');
      }
      return;
    }
    if (req.method === 'GET' && path === '/dashboard') {
      try {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(readFileSync(DASHBOARD_HTML));
      } catch {
        res.writeHead(500); res.end('dashboard HTML not found');
      }
      return;
    }
    if (req.method === 'GET' && path.startsWith('/lib/') && /^\/lib\/[\w.-]+\.js$/.test(path)) {
      try {
        res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'max-age=86400' });
        res.end(readFileSync(join(here, '..', '..', '..', 'widget', path.replace('/lib/', 'lib/'))));
      } catch {
        res.writeHead(404); res.end('not found');
      }
      return;
    }
    if (req.method === 'GET' && path === '/api/dashboard') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store',
        'access-control-allow-origin': '*' });
      res.end(JSON.stringify(dashboardData(deps, lastPos)));
      return;
    }
    // Shareable flight report card for the CURRENT flight (formatted scorecard).
    if (req.method === 'GET' && path === '/api/report') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store',
        'access-control-allow-origin': '*' });
      res.end(JSON.stringify(reportCard(deps, lastConformance)));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  const wss = new WebSocketServer({ server: http });
  const clients = new Set<WebSocket>();
  const send = (ws: WebSocket, obj: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
  const broadcast = (obj: unknown) => { const s = JSON.stringify(obj); for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(s); };

  // Auto-tune COM1 to a controller's frequency (handoff convenience). Tells all widgets too.
  const tuneMode = deps.autoTuneCom ?? 'swap';
  const autoTune = (mhz: number | null) => {
    if (tuneMode === 'off' || mhz == null || !deps.sim) return;
    const ok = deps.sim.tuneCom1(mhz, tuneMode === 'swap');
    if (ok) broadcast({ type: 'radio', com1: mhz, active: tuneMode === 'swap' });
  };

  // Apply structured assignments from a reply: auto-set the squawk and push the clearance
  // state to the widgets' HUD strip (assigned altitude/heading/squawk/next freq).
  const applyAssigned = (a: import('../types.js').AssignedState | undefined) => {
    if (!a) return;
    if (a.squawk && deps.sim && tuneMode !== 'off') {
      const ok = deps.sim.setSquawk(a.squawk);
      if (ok) broadcast({ type: 'squawk', code: a.squawk });
    }
    broadcast({ type: 'clearance', assigned: a });
  };

  // Hoppie CPDLC datalink (optional): poll for inbound messages and surface them.
  const hoppie = deps.hoppieLogon
    ? new HoppieClient({ logon: deps.hoppieLogon, callsign: deps.fp.callsign })
    : null;
  if (hoppie?.enabled) {
    hoppie.startPolling((m) => {
      broadcast({ type: 'cpdlc_in', from: `${m.from} (${m.type})`, text: m.packet, local: false, ok: true });
    });
    console.log('Hoppie CPDLC: polling enabled.');
  }

  // Ambient radio chatter: synthetic traffic on the active frequency.
  const chatter = new ChatterGenerator(deps.chatter ?? 'low');
  if (chatter.active) {
    const runwayFor = () => deps.fp.departureRunway ?? null;
    chatter.start(
      () => deps.session.activeKind,
      runwayFor,
      (l) => broadcast({ type: 'chatter', from: l.from, text: l.text }),
    );
    console.log(`Ambient chatter: ${deps.chatter}.`);
  }

  wss.on('connection', (ws) => {
    clients.add(ws);
    send(ws, { type: 'hello', callsign: deps.fp.callsign, origin: deps.fp.origin, destination: deps.fp.destination });
    send(ws, flightPlanMessage(deps.fp));
    send(ws, fpInfoMessage(deps.fp, deps.weather));
    send(ws, { type: 'state', activeController: deps.session.activeKind });

    if (hoppie?.enabled) send(ws, { type: 'cpdlc_status', enabled: true, callsign: deps.fp.callsign });

    ws.on('close', () => clients.delete(ws));
    ws.on('message', async (raw) => {
      let msg: { type?: string; text?: string; to?: string; service?: string; mhz?: number };
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type === 'pilot_tx' && typeof msg.text === 'string' && msg.text.trim()) {
        lastPilotTxAt = Date.now();
        // Voice/text ground-service requests (fuel/jetway/catering/etc.) go to the ramp, not ATC.
        const svc = matchGroundService(msg.text);
        if (svc) {
          const ok = deps.sim ? deps.sim.groundService(svc) : false;
          broadcast({ type: 'ground_ack', service: svc, ok });
          send(ws, { type: 'atc_tx', from: 'Ramp', freq: null,
            text: ok ? `${spokenFlightCallsign(deps.fp)}, ${GROUND_SVC_SPOKEN[svc] ?? 'roger'}.`
                     : `Ground service unavailable (is MSFS in a flight?)`,
            expecting: 'none' });
          return;
        }
        try {
          // Frequency congestion: on a busy frequency the controller occasionally says "stand by"
          // before getting to you. Deterministic cadence by chatter level; never on readback turns.
          pilotTxCount += 1;
          if (isCongested(pilotTxCount, deps.chatter ?? 'low') && deps.session.activeKind) {
            send(ws, { type: 'atc_tx', from: STATION_LABEL[deps.session.activeKind] ?? 'ATC', freq: deps.session.activeFreqMhz, text: standbyPhrase(spokenFlightCallsign(deps.fp)), expecting: 'none' });
          }
          const reply = await deps.session.handle(msg.text.trim());
          send(ws, { type: 'atc_tx', from: reply.from, freq: reply.freqMhz, text: phrase(reply.text, reply.expecting), expecting: reply.expecting });
          send(ws, { type: 'state', activeController: deps.session.activeKind });
          send(ws, { type: 'scorecard', ...deps.session.scorecard });
          autoTune(reply.freqMhz);
          applyAssigned(reply.assigned);
          saveState();
        } catch (e) {
          send(ws, { type: 'error', error: (e as Error).message });
        }
      } else if (msg.type === 'cpdlc_tx' && hoppie?.enabled && typeof msg.text === 'string' && msg.text.trim()) {
        // Send a datalink telex (default station = origin/destination clearance delivery).
        const to = (msg.to || deps.fp.origin).toUpperCase();
        try {
          const ok = await hoppie.sendTelex(to, msg.text.trim());
          send(ws, { type: 'cpdlc_sent', to, ok });
        } catch (e) {
          send(ws, { type: 'cpdlc_sent', to, ok: false, error: (e as Error).message });
        }
      } else if (msg.type === 'cpdlc_pdc' && hoppie?.enabled) {
        // Request a Pre-Departure Clearance over datalink: build it from the flight plan.
        const pdc = buildPdc(deps.fp);
        try {
          const ok = await hoppie.sendTelex(deps.fp.origin, pdc);
          send(ws, { type: 'cpdlc_in', from: `${deps.fp.origin} PDC`, text: pdc, local: true, ok });
        } catch (e) {
          send(ws, { type: 'cpdlc_sent', to: deps.fp.origin, ok: false, error: (e as Error).message });
        }
      } else if (msg.type === 'ground_svc' && typeof msg.service === 'string') {
        // Trigger a stock MSFS ground service and acknowledge to all widgets (ramp/voice).
        const svc = msg.service;
        const ok = deps.sim ? deps.sim.groundService(svc) : false;
        const label = GROUND_SVC_LABEL[svc] ?? svc;
        broadcast({ type: 'ground_ack', service: svc, ok });
        broadcast({ type: 'atc_tx', from: 'Ramp', freq: null,
          text: ok ? `${spokenFlightCallsign(deps.fp)}, ${GROUND_SVC_SPOKEN[svc] ?? (label + ' requested')}.`
                   : `Ground service unavailable (is MSFS in a flight?)`,
          expecting: 'none' });
      } else if (msg.type === 'tune_com' && typeof msg.mhz === 'number') {
        // Manual COM swap from the radio panel — tune COM1 active to the requested frequency.
        if (deps.sim) {
          const ok = deps.sim.tuneCom1(msg.mhz, true);
          if (ok) broadcast({ type: 'radio', com1: msg.mhz, active: true });
        }
      } else if (msg.type === 'scenario' && typeof msg.service === 'string') {
        // Declare a non-normal scenario; ATC responds with priority handling. Squawk 7700 too.
        const reply = deps.session.declareScenario(msg.service);
        if (deps.sim && (deps.autoTuneCom ?? 'swap') !== 'off') deps.sim.setSquawk('7700');
        send(ws, { type: 'atc_tx', from: reply.from, freq: reply.freqMhz, text: reply.text, expecting: reply.expecting });
        send(ws, { type: 'squawk', code: '7700' });
        send(ws, { type: 'scorecard', ...deps.session.scorecard });
        saveState();
      }
    });
  });

  // Live aircraft position -> all widgets (for the flight-plan display),
  // plus proactive advisories, frequency awareness, and reactive ATC callouts.
  if (deps.sim) {
    const tracker = new FlightPhaseTracker();
    const monitor = new ReactiveMonitor(deps.fp);
    const cs = spokenFlightCallsign(deps.fp);
    let lastPhase = '';
    // Living traffic: poll the sim's AI/MP aircraft on a slow cadence (it's heavier than a state
    // read), build the relative picture against the latest state, and keep it for callouts + queries.
    let trafficPicture: TrafficPicture | null = null;
    let lastTrafficPoll = 0;
    const sim = deps.sim;
    // (Re)start live streaming whenever SimConnect connects. onConnected fires immediately if the
    // sim is already connected, or later when the background retry succeeds (MSFS loaded a flight).
    const startStreaming = () => {
    try {
      sim.subscribeFlightState((s) => {
        lastPos = { lat: s.latitude, lon: s.longitude, hdg: s.headingTrue,
          altFt: s.altitudeFt, gsKt: s.groundSpeedKt, onGround: s.onGround };
        broadcast({ type: 'position', ...lastPos });
        // Frequency awareness: tell the session what COM1 is tuned to.
        if (s.com1Mhz) deps.session.setCom1(s.com1Mhz);

        // Refresh the traffic picture ~every 5s, then hand it to the session + UI.
        // Off unless explicitly enabled (LIVE_TRAFFIC=1) — reading AI objects can destabilize MSFS.
        // Granular sub-toggles (deps.trafficOptions) let the crash source be bisected: position read,
        // poll loop, and advisory emission are each independently switchable.
        const to = deps.trafficOptions ?? { position: true, poll: true, advisories: true };
        const now = Date.now();
        if (deps.liveTraffic && to.poll && to.position && now - lastTrafficPoll > 5000) {
          lastTrafficPoll = now;
          sim.fetchTraffic().then((list) => {
            trafficPicture = buildTrafficPicture(s, list);
            deps.session.setTraffic(to.advisories ? trafficPicture : null);
            broadcast({
              type: 'traffic',
              count: trafficPicture.nearby.length,
              aircraft: trafficPicture.nearby.slice(0, 12).map((t) => ({
                callsign: t.callsign, lat: t.lat, lon: t.lon, altFt: Math.round(t.altitudeFt),
                hdg: Math.round(t.headingTrue), rangeNm: Math.round(t.rangeNm * 10) / 10,
                clock: t.clock, vertical: t.vertical, onGround: t.onGround,
              })),
            });
          }).catch(() => { /* sim busy / no traffic */ });
        }

        const phase = tracker.update(s);
        if (phase !== lastPhase) {
          lastPhase = phase;
          const note = ADVISORY[phase];
          if (note) broadcast({ type: 'atc_tx', from: 'Advisory', freq: null, text: `${cs}, ${note}`, expecting: 'none' });
        }

        // Reactive + proactive ATC: nudge on deviations and initiate next steps.
        const adv = monitor.evaluate(s, {
          assignedAltitudeFt: deps.session.assignedAltitudeFt,
          arriving: deps.session.isArriving,
          destDistNm: monitor.destDistance(s),
          phase,
          controller: deps.session.activeKind,
          msSincePilotTx: Date.now() - lastPilotTxAt,
          traffic: to.advisories ? trafficPicture : null,
          windshear: /\b(WS|\+TSRA|\+TS|SQ)\b/.test(deps.weather[deps.fp.destination]?.raw ?? ''),
        }, Date.now());
        if (adv) {
          broadcast({ type: 'atc_tx', from: STATION_LABEL[deps.session.activeKind] ?? 'ATC', freq: deps.session.activeFreqMhz, text: `${cs}, ${adv.text}`, expecting: 'none' });
        }
        lastConformance = monitor.conformance();
      });
    } catch { /* sim not available */ }
    };
    sim.onConnected(startStreaming);
  }

  // Live weather: re-fetch real METAR for origin+destination every ~10 min and update in place,
  // so ATIS/altimeter stay current through a long flight. Re-broadcasts the info flyout.
  const refreshWeather = () => {
    fetchMetars([deps.fp.origin, deps.fp.destination]).then((wx) => {
      let changed = false;
      for (const [icao, info] of Object.entries(wx)) {
        if (deps.weather[icao]?.raw !== info.raw) { deps.weather[icao] = info; changed = true; }
      }
      if (changed) broadcast(fpInfoMessage(deps.fp, deps.weather));
    }).catch(() => { /* offline; keep last */ });
  };
  const wxTimer = setInterval(refreshWeather, 10 * 60 * 1000);
  if (typeof wxTimer === 'object' && 'unref' in wxTimer) (wxTimer as { unref(): void }).unref();

  http.listen(port, () => {
    console.log(`Comms: widget http://localhost:${port}/  |  WebSocket ws://localhost:${port}`);
    console.log(`Dashboard: http://localhost:${port}/dashboard`);
  });
  return wss;
}
