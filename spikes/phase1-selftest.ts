// Deterministic self-test of the Phase 1 flow (no sim, no LLM):
// Delivery (clearance + readback) -> handoff -> Ground (pushback + taxi + readback).
// Run: npm run demo
import { fetchFlightPlan } from '../src/brain/flightplan/simbrief.js';
import { createNavdata } from '../src/brain/navdata/navdata.js';
import { ControllerSession } from '../src/brain/atc/session.js';
import { spokenFlightCallsign, reconcileAircraftType } from '../src/brain/util/aircraft.js';

const WORD2DIGIT: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', niner: '9', nine: '9',
};

function spokenSquawkToDigits(text: string): string {
  const m = text.match(/Squawk ([a-z ]+?)\./i);
  return (m?.[1] ?? '')
    .trim()
    .split(/\s+/)
    .map((w) => WORD2DIGIT[w.toLowerCase()] ?? '')
    .join('');
}

const fp = await fetchFlightPlan(''); // built-in sample
const nav = createNavdata();
const session = new ControllerSession(fp, nav, null); // null LLM => deterministic

async function say(text: string) {
  console.log(`PILOT> ${text}`);
  const r = await session.handle(text);
  const freq = r.freqMhz ? ` ${r.freqMhz.toFixed(3)}` : '';
  console.log(`[${r.from}${freq}] ${r.text}\n`);
  return r;
}

console.log(`Flight plan: ${fp.callsign} ${fp.origin} -> ${fp.destination}, cruise ${fp.cruiseAltitudeFt} ft, dep rwy ${fp.departureRunway}\n`);

// --- Clearance Delivery ---
const r1 = await say('Seattle Delivery, Southwest 1234, request IFR clearance to KPDX, information Alpha.');
const squawk = spokenSquawkToDigits(r1.text);
await say('Cleared to Portland as filed, climb and maintain five thousand, Southwest 1234.'); // missing squawk
await say(`Cleared to Portland as filed, climb and maintain five thousand, squawk ${squawk}, Southwest 1234.`); // full -> handoff to ground

// --- Ground ---
await say('Seattle Ground, Southwest 1234, request pushback.');
await say('Southwest 1234, request taxi.');
await say(`Runway ${fp.departureRunway}, taxi to the runway, Southwest 1234.`); // readback -> handoff to tower

// --- Tower (departure) ---
await say(`Seattle Tower, Southwest 1234, holding short runway ${fp.departureRunway}, ready for departure.`);
await say(`Cleared for takeoff runway ${fp.departureRunway}, Southwest 1234.`); // readback -> handoff to departure

// --- Departure ---
await say('Departure, Southwest 1234, with you climbing through three thousand.');
await say('Southwest 1234, level five thousand, request higher.'); // -> handoff to center

// --- Center (enroute) ---
await say('Center, Southwest 1234, level flight level two four zero.');
await say('Southwest 1234, request descent.'); // -> handoff to approach

// --- Approach ---
await say('Approach, Southwest 1234, with you descending.');
await say('Southwest 1234, established.'); // -> handoff to tower (arrival)

// --- Tower (arrival) ---
await say('Tower, Southwest 1234, on final.'); // cleared to land
await say('Southwest 1234, clear of the runway.'); // -> handoff to ground (arrival)

// --- Ground (arrival) ---
await say('Ground, Southwest 1234, request taxi to parking.');

console.log(`(assigned squawk was ${squawk}; active position now: ${session.activeKind})`);

console.log('\n--- aircraft type awareness ---');
console.log('heavy:', spokenFlightCallsign({ callsign: 'BAW287', telephony: 'Speedbird 287', aircraftIcao: 'B77W' }));
console.log('super:', spokenFlightCallsign({ callsign: 'UAE201', telephony: 'Emirates 201', aircraftIcao: 'A388' }));
console.log('reconcile (CEO vs CEO):', reconcileAircraftType('A320', 'A320').message);
console.log('reconcile (CEO vs NEO):', reconcileAircraftType('A320', 'A20N').message);
console.log('reconcile (A320 vs 777):', reconcileAircraftType('A320', 'B772').message);
