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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { FlightPhaseTracker } from '../sim/flightPhase.js';
import { spokenFlightCallsign } from '../util/aircraft.js';
import { HoppieClient } from './hoppie.js';
import { ChatterGenerator, type ChatterLevel } from '../atc/chatter.js';
import { ReactiveMonitor } from '../atc/monitor.js';
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

// Proactive nudges as the flight progresses (reminds you to make the next call).
const ADVISORY: Record<string, string> = {
  climb: 'airborne — when ready, contact Departure.',
  descent: 'approaching top of descent — start your arrival and contact Approach.',
  approach: 'established on the approach — contact Tower for landing.',
  taxi_in: 'clear of the runway — contact Ground for taxi to parking.',
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

export function startCommsServer(port: number, deps: CommsDeps): WebSocketServer {
  // Latest live position sample, for the dashboard's /api/dashboard snapshot.
  let lastPos: { lat: number; lon: number; hdg: number; altFt: number; gsKt: number; onGround: boolean } | null = null;
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
      let msg: { type?: string; text?: string; to?: string };
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type === 'pilot_tx' && typeof msg.text === 'string' && msg.text.trim()) {
        try {
          const reply = await deps.session.handle(msg.text.trim());
          send(ws, { type: 'atc_tx', from: reply.from, freq: reply.freqMhz, text: reply.text, expecting: reply.expecting });
          send(ws, { type: 'state', activeController: deps.session.activeKind });
          send(ws, { type: 'scorecard', ...deps.session.scorecard });
          autoTune(reply.freqMhz);
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
    try {
      deps.sim.subscribeFlightState((s) => {
        lastPos = { lat: s.latitude, lon: s.longitude, hdg: s.headingTrue,
          altFt: s.altitudeFt, gsKt: s.groundSpeedKt, onGround: s.onGround };
        broadcast({ type: 'position', ...lastPos });
        // Frequency awareness: tell the session what COM1 is tuned to.
        if (s.com1Mhz) deps.session.setCom1(s.com1Mhz);

        const phase = tracker.update(s);
        if (phase !== lastPhase) {
          lastPhase = phase;
          const note = ADVISORY[phase];
          if (note) broadcast({ type: 'atc_tx', from: 'Advisory', freq: null, text: `${cs}, ${note}`, expecting: 'none' });
        }

        // Reactive ATC: nudge on deviations (cooldown-limited inside the monitor).
        const adv = monitor.evaluate(s, {
          assignedAltitudeFt: deps.session.assignedAltitudeFt,
          arriving: deps.session.isArriving,
          destDistNm: monitor.destDistance(s),
        }, Date.now());
        if (adv) {
          broadcast({ type: 'atc_tx', from: STATION_LABEL[deps.session.activeKind] ?? 'ATC', freq: deps.session.activeFreqMhz, text: `${cs}, ${adv.text}`, expecting: 'none' });
        }
      });
    } catch { /* sim not available */ }
  }

  http.listen(port, () => {
    console.log(`Comms: widget http://localhost:${port}/  |  WebSocket ws://localhost:${port}`);
    console.log(`Dashboard: http://localhost:${port}/dashboard`);
  });
  return wss;
}
