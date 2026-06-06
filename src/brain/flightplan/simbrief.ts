// SimBrief flight-plan source. Fetches the latest OFP by username and normalizes it.
// With no username, returns a built-in sample so the harness runs offline.
import type { FlightPlan, Waypoint, OfpSummary, InfoSection } from '../types.js';

const SAMPLE: FlightPlan = {
  callsign: 'SWA1234',
  telephony: 'Southwest 1234',
  aircraftIcao: 'B738',
  origin: 'KSEA',
  destination: 'KPDX',
  alternate: 'KSLE',
  cruiseAltitudeFt: 24000,
  initialAltitudeFt: 5000,
  route: 'SEA HAROB OLM BTG PDX',
  departureRunway: '16R',
  flightRules: 'IFR',
  source: 'sample',
  aircraftName: 'Boeing 737-800',
  weights: { zfw: '58000', tow: '70000', fuel: '9000', units: 'kg' },
  ofp: { gcNm: '116', routeNm: '129', eobt: '18:30Z', etd: '18:42Z', eta: '19:21Z', ete: '0:39', block: '0:51', sid: 'SUMMA7', star: 'HHOOD4' },
  infoSections: [
    { title: 'General', rows: [['Airline','SWA 1234'],['Callsign','SWA1234'],['Rules','IFR'],['Cost index','18'],['Cruise','FL240  M0.780'],['Avg wind','250/22'],['Route dist','129 nm'],['GC dist','116 nm']] },
    { title: 'Aircraft', rows: [['Type','B738'],['Name','Boeing 737-800'],['Reg','N8512S'],['Max pax','175']] },
    { title: 'Departure', rows: [['ICAO','KSEA'],['Name','Seattle Tacoma Intl'],['Elevation','433 ft'],['Runway','16R'],['SID','SUMMA7']] },
    { title: 'Arrival', rows: [['ICAO','KPDX'],['Name','Portland Intl'],['Elevation','31 ft'],['Runway','10R'],['STAR','HHOOD4'],['Alternate','KSLE Salem']] },
    { title: 'Weights (kg)', rows: [['OEW','41413'],['Pax','175'],['Cargo','1200'],['Payload','16587'],['ZFW','58000'],['TOW','70000'],['LDW','64000'],['Max TOW','79016']] },
    { title: 'Fuel (kg)', rows: [['Taxi','200'],['Trip','5400'],['Contingency','270'],['Alternate','900'],['Reserve','1100'],['Extra','0'],['Block','7870'],['Ramp','8070']] },
    { title: 'Times (UTC)', rows: [['EOBT','18:30Z'],['Takeoff','18:42Z'],['Landing','19:21Z'],['Enroute','0:39'],['Block','0:51'],['Taxi out','0:12']] },
  ],
  originLat: 47.4490, originLon: -122.3093,
  destLat: 45.5887, destLon: -122.5975,
  waypoints: [
    { ident: 'SEA', lat: 47.435, lon: -122.310 },
    { ident: 'HAROB', lat: 47.073, lon: -122.430 },
    { ident: 'OLM', lat: 46.971, lon: -122.902 },
    { ident: 'BTG', lat: 45.745, lon: -122.595 },
    { ident: 'PDX', lat: 45.589, lon: -122.597 },
  ],
};

interface SimBriefFix { ident?: string; pos_lat?: string | number; pos_long?: string | number; type?: string; via_airway?: string; stage?: string }
interface SimBriefOfp {
  general?: { route?: string; initial_altitude?: string | number; icao_airline?: string; flight_number?: string; route_distance?: string | number; gc_distance?: string | number };
  origin?: { icao_code?: string; plan_rwy?: string; pos_lat?: string | number; pos_long?: string | number };
  destination?: { icao_code?: string; pos_lat?: string | number; pos_long?: string | number; plan_rwy?: string };
  alternate?: { icao_code?: string };
  aircraft?: { icaocode?: string; name?: string };
  weights?: { est_zfw?: string | number; est_tow?: string | number };
  fuel?: { plan_ramp?: string | number };
  params?: { units?: string };
  atc?: { callsign?: string };
  times?: { sched_out?: string | number; est_out?: string | number; est_off?: string | number; est_on?: string | number; est_time_enroute?: string | number; est_block?: string | number; sched_block?: string | number };
  navlog?: { fix?: SimBriefFix | SimBriefFix[] };
}

function str(v: unknown): string | undefined {
  return v == null || v === '' ? undefined : String(v);
}

function fmtZ(epochSec: unknown): string | undefined {
  const n = Number(epochSec);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const d = new Date(n * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}
function fmtDur(sec: unknown): string | undefined {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return `${Math.floor(n / 3600)}:${String(Math.floor((n % 3600) / 60)).padStart(2, '0')}`;
}

// SID = procedure on the first non-DCT leg; STAR = procedure on the last non-DCT leg.
function procFromNavlog(fixes: SimBriefFix[]): { sid?: string; star?: string } {
  const isProc = (v?: string) => !!v && v !== 'DCT' && /[A-Z]+\d/.test(v);
  const sid = fixes.slice(0, 4).map((f) => f.via_airway).find(isProc);
  const star = fixes.slice(-4).map((f) => f.via_airway).reverse().find(isProc);
  return { sid, star };
}

// Comprehensive OFP -> grouped sections (exact values straight from the OFP).
function buildInfoSections(ofp: any, fixes: SimBriefFix[]): InfoSection[] {
  const g = ofp.general || {}, ac = ofp.aircraft || {}, w = ofp.weights || {}, f = ofp.fuel || {},
    t = ofp.times || {}, o = ofp.origin || {}, d = ofp.destination || {}, alt = ofp.alternate || {},
    atc = ofp.atc || {}, p = ofp.params || {};
  const u = str(p.units) || '';
  const proc = procFromNavlog(fixes);
  const sec = (title: string, rows: Array<[string, string | undefined]>): InfoSection =>
    ({ title, rows: rows.filter((r) => r[1] != null && r[1] !== '') as Array<[string, string]> });
  const wnum = (v: unknown, unit: string) => { const s = str(v); return s == null ? undefined : `${s} ${unit}`; };
  const join = (a: Array<string | undefined>, sep = ' ') => a.filter(Boolean).join(sep) || undefined;

  return [
    sec('General', [
      ['Airline', join([str(g.icao_airline), str(g.flight_number)])],
      ['Callsign', str(atc.callsign)],
      ['Rules', str(atc.flight_rules)],
      ['Cost index', str(g.costindex)],
      ['Cruise', join([str(g.initial_altitude) ? `${g.initial_altitude} ft` : undefined, str(g.cruise_mach) ? `M${g.cruise_mach}` : (str(g.cruise_tas) ? `${g.cruise_tas} TAS` : undefined)], '  ')],
      ['Avg wind', join([str(g.avg_wind_dir), str(g.avg_wind_spd)], '/')],
      ['ISA dev', str(g.avg_temp_dev)],
      ['Route dist', wnum(g.route_distance, 'nm')],
      ['GC dist', wnum(g.gc_distance, 'nm')],
      ['Air dist', wnum(g.air_distance, 'nm')],
    ]),
    sec('Aircraft', [
      ['Type', str(ac.icaocode)], ['Name', str(ac.name)], ['Reg', str(ac.reg)],
      ['SELCAL', str(ac.selcal)], ['Equip', str(ac.equip)], ['Max pax', str(ac.max_passengers)],
    ]),
    sec('Departure', [
      ['ICAO', str(o.icao_code)], ['Name', str(o.name)], ['Elevation', wnum(o.elevation, 'ft')],
      ['Runway', str(o.plan_rwy)], ['SID', proc.sid], ['Trans alt', wnum(o.trans_alt, 'ft')],
    ]),
    sec('Arrival', [
      ['ICAO', str(d.icao_code)], ['Name', str(d.name)], ['Elevation', wnum(d.elevation, 'ft')],
      ['Runway', str(d.plan_rwy)], ['STAR', proc.star], ['Alternate', join([str(alt.icao_code), str(alt.name)])],
    ]),
    sec(`Weights${u ? ' (' + u + ')' : ''}`, [
      ['OEW', str(w.oew)], ['Pax', str(w.pax_count)], ['Cargo', str(w.cargo)], ['Payload', str(w.payload)],
      ['ZFW', str(w.est_zfw)], ['TOW', str(w.est_tow)], ['LDW', str(w.est_ldw)],
      ['Max ZFW', str(w.max_zfw)], ['Max TOW', str(w.max_tow)], ['Max LDW', str(w.max_ldw)],
    ]),
    sec(`Fuel${u ? ' (' + u + ')' : ''}`, [
      ['Taxi', str(f.taxi)], ['Trip', str(f.enroute_burn)], ['Contingency', str(f.contingency)],
      ['Alternate', str(f.alternate_burn)], ['Reserve', str(f.reserve)], ['Extra', str(f.extra)],
      ['Min T/O', str(f.min_takeoff)], ['Takeoff', str(f.plan_takeoff)], ['Block', str(f.plan_ramp)],
    ]),
    sec('Times (UTC)', [
      ['EOBT', fmtZ(t.sched_out ?? t.est_out)], ['Takeoff', fmtZ(t.est_off)], ['Landing', fmtZ(t.est_on)],
      ['On block', fmtZ(t.est_in)], ['Enroute', fmtDur(t.est_time_enroute)], ['Block', fmtDur(t.est_block)],
      ['Taxi out', fmtDur(t.taxi_out)], ['Endurance', fmtDur(t.endurance)],
    ]),
  ].filter((s) => s.rows.length > 0);
}

function buildOfpSummary(ofp: SimBriefOfp, fixes: SimBriefFix[]): OfpSummary {
  const t = ofp.times ?? {};
  const proc = procFromNavlog(fixes);
  return {
    gcNm: str(ofp.general?.gc_distance),
    routeNm: str(ofp.general?.route_distance),
    eobt: fmtZ(t.sched_out ?? t.est_out),
    etd: fmtZ(t.est_off),
    eta: fmtZ(t.est_on),
    ete: fmtDur(t.est_time_enroute),
    block: fmtDur(t.est_block ?? t.sched_block),
    sid: proc.sid,
    star: proc.star,
  };
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseWaypoints(ofp: SimBriefOfp): Waypoint[] {
  const fixes = ofp.navlog?.fix;
  const arr = Array.isArray(fixes) ? fixes : fixes ? [fixes] : [];
  return arr
    .map((f) => ({ ident: String(f.ident ?? ''), lat: num(f.pos_lat) ?? NaN, lon: num(f.pos_long) ?? NaN, type: f.type }))
    .filter((w) => w.ident && Number.isFinite(w.lat) && Number.isFinite(w.lon));
}

function toNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalize(ofp: SimBriefOfp): FlightPlan {
  const callsign =
    ofp.atc?.callsign ||
    `${ofp.general?.icao_airline ?? ''}${ofp.general?.flight_number ?? ''}` ||
    'UNKNOWN';
  const fixes = Array.isArray(ofp.navlog?.fix)
    ? (ofp.navlog!.fix as SimBriefFix[])
    : (ofp.navlog?.fix ? [ofp.navlog.fix as SimBriefFix] : []);
  return {
    callsign,
    aircraftIcao: ofp.aircraft?.icaocode ?? 'ZZZZ',
    origin: ofp.origin?.icao_code ?? '????',
    destination: ofp.destination?.icao_code ?? '????',
    alternate: ofp.alternate?.icao_code || undefined,
    cruiseAltitudeFt: toNumber(ofp.general?.initial_altitude, 35000),
    initialAltitudeFt: 5000, // refined from the SID via navdata later
    route: ofp.general?.route ?? '',
    departureRunway: ofp.origin?.plan_rwy || undefined,
    flightRules: 'IFR',
    source: 'simbrief',
    aircraftName: str(ofp.aircraft?.name),
    weights: { zfw: str(ofp.weights?.est_zfw), tow: str(ofp.weights?.est_tow), fuel: str(ofp.fuel?.plan_ramp), units: str(ofp.params?.units) },
    ofp: buildOfpSummary(ofp, fixes),
    infoSections: buildInfoSections(ofp, fixes),
    originLat: num(ofp.origin?.pos_lat),
    originLon: num(ofp.origin?.pos_long),
    destLat: num(ofp.destination?.pos_lat),
    destLon: num(ofp.destination?.pos_long),
    waypoints: parseWaypoints(ofp),
  };
}

/**
 * Fetch the latest SimBrief OFP by numeric Pilot ID (preferred) or username.
 * Both empty -> built-in sample.
 */
export async function fetchFlightPlan(username: string, userid?: string): Promise<FlightPlan> {
  const id = (userid ?? '').trim();
  const user = (username ?? '').trim();
  if (!id && !user) return SAMPLE;
  const q = id ? `userid=${encodeURIComponent(id)}` : `username=${encodeURIComponent(user)}`;
  const url = `https://www.simbrief.com/api/xml.fetcher.php?${q}&json=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`SimBrief ${res.status} (check username/ID, and that a plan exists)`);
  const ofp = (await res.json()) as SimBriefOfp;
  return normalize(ofp);
}
