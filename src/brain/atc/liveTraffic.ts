// Living-traffic model: turn the raw sim AI/MP aircraft list (from SimClient.fetchTraffic) into
// relative-position FACTS the deterministic ATC can reference — traffic calls, sequencing, runway
// occupancy. The model never invents aircraft; it only describes what the sim reports. The language
// layer phrases it. (Distinct from traffic.ts, which synthesizes a plausible *sequence* when no
// live sim traffic is available.)
import type { FlightContext } from '../types.js';
import type { TrafficAircraft } from '../sim/simClient.js';
import { distanceNm, bearingDeg, clockPosition } from '../util/geo.js';

/** One AI aircraft enriched with its position relative to the user. */
export interface RelativeTraffic {
  callsign: string;
  title: string;
  lat: number;
  lon: number;
  altitudeFt: number;
  headingTrue: number;
  groundSpeedKt: number;
  onGround: boolean;
  /** Range from the user, nm. */
  rangeNm: number;
  /** True bearing from the user to this aircraft. */
  bearingDeg: number;
  /** Clock position relative to the user's nose (1..12). */
  clock: number;
  /** Altitude difference (ft): positive = traffic is above the user. */
  relAltFt: number;
  /** Coarse vertical band for phraseology. */
  vertical: 'above' | 'below' | 'same';
}

export interface TrafficPicture {
  /** All traffic within the relevance radius, sorted nearest-first. */
  nearby: RelativeTraffic[];
  /** The single most relevant conflict (close + near co-altitude), if any. */
  primary: RelativeTraffic | null;
}

const RELEVANCE_NM = 30;     // ignore traffic beyond this for callouts
const COALT_FT = 2000;       // within this vertical band counts as a potential conflict
const SAME_ALT_FT = 400;     // within this we call it co-altitude ("same altitude")

/** Build the relative-position picture from the user's state and the raw traffic batch. */
export function buildTrafficPicture(own: FlightContext, traffic: TrafficAircraft[]): TrafficPicture {
  const nearby: RelativeTraffic[] = [];
  for (const t of traffic) {
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
    const rangeNm = distanceNm(own.latitude, own.longitude, t.lat, t.lon);
    if (rangeNm > RELEVANCE_NM || rangeNm < 0.05) continue; // too far, or it's effectively us
    const brg = bearingDeg(own.latitude, own.longitude, t.lat, t.lon);
    const relAltFt = t.altitudeFt - own.altitudeFt;
    nearby.push({
      callsign: t.callsign, title: t.title, lat: t.lat, lon: t.lon,
      altitudeFt: t.altitudeFt, headingTrue: t.headingTrue, groundSpeedKt: t.groundSpeedKt,
      onGround: t.onGround, rangeNm, bearingDeg: brg,
      clock: clockPosition(own.headingTrue, brg),
      relAltFt,
      vertical: Math.abs(relAltFt) <= SAME_ALT_FT ? 'same' : relAltFt > 0 ? 'above' : 'below',
    });
  }
  nearby.sort((a, b) => a.rangeNm - b.rangeNm);

  // Primary conflict: nearest airborne traffic within the co-altitude band (most worth a call).
  const primary = nearby.find((t) => !t.onGround && Math.abs(t.relAltFt) <= COALT_FT) ?? null;
  return { nearby, primary };
}

/**
 * Compose a standard traffic advisory for one aircraft, e.g.
 * "traffic, two o'clock, one zero miles, two thousand feet above".
 * Returns null if there's nothing worth calling.
 */
export function trafficAdvisory(t: RelativeTraffic | null): string | null {
  if (!t) return null;
  const miles = Math.max(1, Math.round(t.rangeNm));
  const vert = t.onGround
    ? 'on the ground'
    : t.vertical === 'same'
      ? 'same altitude'
      : `${spokenThousands(Math.abs(t.relAltFt))} ${t.vertical}`;
  const unit = miles === 1 ? 'mile' : 'miles';
  return `traffic, ${clockSpoken(t.clock)} o'clock, ${spokenMiles(miles)} ${unit}, ${vert}`;
}

/** Is any ground traffic sitting on / rolling near a given runway-threshold position? */
export function runwayOccupied(
  thresholdLat: number,
  thresholdLon: number,
  traffic: TrafficAircraft[],
  withinNm = 1.5,
): TrafficAircraft | null {
  for (const t of traffic) {
    if (!t.onGround) continue;
    if (distanceNm(thresholdLat, thresholdLon, t.lat, t.lon) <= withinNm) return t;
  }
  return null;
}

// --- spoken-number helpers (kept local; phraseology.ts owns altitude wording elsewhere) ---------

const W = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

function clockSpoken(h: number): string {
  const words = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  return words[h] ?? String(h);
}

function spokenMiles(n: number): string {
  if (n < 10) return W[n]!;
  return String(n).split('').map((d) => W[Number(d)]).join(' ');
}

/** "2000" -> "two thousand"; rounds to the nearest 100 for tidy callouts. */
function spokenThousands(ft: number): string {
  const r = Math.round(ft / 100) * 100;
  const thousands = Math.floor(r / 1000);
  const hundreds = (r % 1000) / 100;
  const out: string[] = [];
  if (thousands > 0) out.push(`${W[thousands]} thousand`);
  if (hundreds > 0) out.push(`${W[hundreds]} hundred`);
  if (out.length === 0) out.push('level');
  return out.join(' ');
}
