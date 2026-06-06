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

export function startCommsServer(port: number, deps: CommsDeps): WebSocketServer {
  const http = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
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
        broadcast({
          type: 'position',
          lat: s.latitude, lon: s.longitude, hdg: s.headingTrue,
          altFt: s.altitudeFt, gsKt: s.groundSpeedKt, onGround: s.onGround,
        });
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
  });
  return wss;
}
