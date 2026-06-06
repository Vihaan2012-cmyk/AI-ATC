// Phase 2 integration test: run the ATC engine on REAL sim navdata.
// Connects via SimConnect, pulls VOBL (+ dest) facility data, and drives a full
// Delivery -> Ground flow using the actual frequencies and runway from the sim.
//
// Run with MSFS in a flight:  npm run sim-test           (VOBL -> VOMM)
//                             npm run sim-test VOBL VOMM
import { SimClient } from '../src/brain/sim/simClient.js';
import { FacilityCache } from '../src/brain/sim/facilityCache.js';
import { loadSimNavdata } from '../src/brain/navdata/simconnectNavdata.js';
import { ControllerSession } from '../src/brain/atc/session.js';
import { config } from '../src/brain/config.js';
import type { FlightPlan } from '../src/brain/types.js';

const origin = (process.argv[2] ?? 'VOBL').toUpperCase();
const dest = (process.argv[3] ?? 'VOMM').toUpperCase();

const WORD2DIGIT: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', niner: '9', nine: '9',
};
function spokenSquawkToDigits(text: string): string {
  const m = text.match(/Squawk ([a-z ]+?)\./i);
  return (m?.[1] ?? '').trim().split(/\s+/).map((w) => WORD2DIGIT[w.toLowerCase()] ?? '').join('');
}

const sim = new SimClient();
const app = await sim.connect('MSFS AI ATC (sim-test)');
console.log(`[OK] connected to: ${app}\n`);

const state = await sim.getFlightState();
console.log(`Live state: ${state.latitude.toFixed(4)}, ${state.longitude.toFixed(4)}  alt ${state.altitudeFt.toFixed(0)} ft  onGround ${state.onGround ? 'Y' : 'N'}\n`);

const cache = new FacilityCache(config.facilityCacheDir, config.facilityCacheMaxBytes, config.facilityCacheTtlDays);
const nav = await loadSimNavdata(sim, [origin, dest], cache);
console.log(`facility cache: ${cache.stats().count} airports, ${(cache.stats().bytes / 1024).toFixed(1)} KB on disk\n`);
const originFac = nav.getFacility(origin);
const depRunway = originFac?.runways[0]?.primary ?? '';
console.log(
  `Navdata(sim): ${origin} delivery ${nav.getDeliveryFrequency(origin)} | ground ${nav.getGroundFrequency(origin)} | ` +
    `tower ${nav.getTowerFrequency(origin)} | approach ${nav.getApproachFrequency(origin)} | departure ${nav.getDepartureFrequency(origin)} | dep rwy ${depRunway}\n`,
);

const fp: FlightPlan = {
  callsign: 'AIC191',
  aircraftIcao: 'A343', // A340 = heavy
  origin,
  destination: dest,
  cruiseAltitudeFt: 36000,
  initialAltitudeFt: 6000,
  route: 'as filed',
  departureRunway: depRunway || undefined,
  flightRules: 'IFR',
  source: 'sample',
};

const session = new ControllerSession(fp, nav, null);
async function say(text: string) {
  console.log(`PILOT> ${text}`);
  const r = await session.handle(text);
  const freq = r.freqMhz ? ` ${r.freqMhz.toFixed(3)}` : '';
  console.log(`[${r.from}${freq}] ${r.text}\n`);
  return r;
}

const r1 = await say(`Bengaluru Delivery, Air India 191, request IFR clearance to ${dest}, information Alpha.`);
const squawk = spokenSquawkToDigits(r1.text);
await say(`Cleared to destination as filed, climb six thousand, squawk ${squawk}, Air India 191.`);
await say('Bengaluru Ground, Air India 191, request pushback.');
await say('Air India 191, request taxi.');
await say(`Runway ${depRunway}, taxi to the runway, Air India 191.`);

sim.close();
console.log(`(active position now: ${session.activeKind})`);
process.exit(0);
