/**
 * Phase 0c spike: pull REAL airport data (runways + ATC frequencies) from the sim's
 * own navdata via the SimConnect Facilities API. This is what replaces mock navdata.
 *
 * Run with MSFS in a flight:  npm run spike:facilities          (defaults to VOBL)
 *                             npm run spike:facilities KSEA
 */
import { open, Protocol, FacilityDataType } from 'node-simconnect';

const DEF = 0;
const REQ = 0;
const icao = (process.argv[2] ?? 'VOBL').toUpperCase();

// Enum maps from the MSFS SDK (SimConnect_AddToFacilityDefinition).
const DESIGNATOR = ['', 'L', 'R', 'C', 'W', 'A', 'B', '']; // 0 NONE..7 LAST
const FREQ_TYPE = [
  'NONE', 'ATIS', 'MULTICOM', 'UNICOM', 'CTAF', 'GROUND', 'TOWER', 'CLEARANCE',
  'APPROACH', 'DEPARTURE', 'CENTER', 'FSS', 'AWOS', 'ASOS', 'CPT', 'GCO',
];

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

function runwayEnd(num: number, desig: number): string {
  const n = num >= 1 && num <= 36 ? String(num).padStart(2, '0') : `#${num}`;
  return `${n}${DESIGNATOR[desig] ?? ''}`;
}

interface RunwayRow { id: string; headingTrue: number; lengthM: number; widthM: number; }
interface FreqRow { type: string; mhz: number; name: string; rawHz: number; }

async function main() {
  console.log(`-> facilities request for ${icao} ...`);
  const { recvOpen, handle } = await withTimeout(
    open('ATC Facilities Spike', Protocol.KittyHawk),
    8000,
    'no SimConnect response within 8s (is MSFS running and in a flight?)',
  );
  console.log(`[OK] connected to: ${recvOpen.applicationName}`);

  // Define the facility data tree (every OPEN needs a matching CLOSE).
  // Buffer fields come back in the exact order added below.
  const f = (field: string) => handle.addToFacilityDefinition(DEF, field);
  f('OPEN AIRPORT');
  f('LATITUDE'); f('LONGITUDE'); f('ALTITUDE');
  f('NAME'); f('ICAO'); f('REGION');
  f('N_RUNWAYS'); f('N_FREQUENCIES');
  f('OPEN RUNWAY');
  f('PRIMARY_NUMBER'); f('PRIMARY_DESIGNATOR'); f('SECONDARY_NUMBER'); f('SECONDARY_DESIGNATOR');
  f('HEADING'); f('LENGTH'); f('WIDTH');
  f('CLOSE RUNWAY');
  f('OPEN FREQUENCY');
  f('TYPE'); f('FREQUENCY'); f('NAME');
  f('CLOSE FREQUENCY');
  f('CLOSE AIRPORT');

  let airport: { name: string; region: string; lat: number; lon: number; altM: number; nRwy: number; nFreq: number } | null = null;
  const runways: RunwayRow[] = [];
  const freqs: FreqRow[] = [];

  const timer = setTimeout(() => {
    console.error('[FAIL] no facilityDataEnd within 12s — field name/type mismatch or unknown ICAO?');
    process.exit(1);
  }, 12000);

  handle.requestFacilityData(DEF, REQ, icao);

  handle.on('facilityData', (d) => {
    const b = d.data;
    if (d.type === FacilityDataType.AIRPORT) {
      const lat = b.readFloat64();
      const lon = b.readFloat64();
      const altM = b.readFloat64();
      const name = b.readString32();
      b.readString8(); // ICAO (echoes the request)
      const region = b.readString8();
      const nRwy = b.readInt32();
      const nFreq = b.readInt32();
      airport = { name, region, lat, lon, altM, nRwy, nFreq };
    } else if (d.type === FacilityDataType.RUNWAY) {
      const pn = b.readInt32();
      const pd = b.readInt32();
      const sn = b.readInt32();
      const sd = b.readInt32();
      const headingTrue = b.readFloat32();
      const lengthM = b.readFloat32();
      const widthM = b.readFloat32();
      runways.push({ id: `${runwayEnd(pn, pd)}/${runwayEnd(sn, sd)}`, headingTrue, lengthM, widthM });
    } else if (d.type === FacilityDataType.FREQUENCY) {
      const type = b.readInt32();
      const rawHz = b.readInt32();
      const name = b.readString64();
      freqs.push({ type: FREQ_TYPE[type] ?? `#${type}`, mhz: rawHz / 1e6, name, rawHz });
    }
  });

  handle.on('facilityDataEnd', () => {
    clearTimeout(timer);
    console.log(`\n=== ${icao} ===`);
    if (airport) {
      console.log(`${airport.name}  [${airport.region}]  ${airport.lat.toFixed(4)}, ${airport.lon.toFixed(4)}  elev ${Math.round(airport.altM * 3.281)} ft`);
      console.log(`reported: ${airport.nRwy} runway-ends, ${airport.nFreq} frequencies`);
    }
    console.log(`\nRunways (${runways.length}):`);
    for (const r of runways) {
      console.log(`  ${r.id.padEnd(10)} hdg ${r.headingTrue.toFixed(0)} T  ${Math.round(r.lengthM * 3.281)} ft x ${Math.round(r.widthM * 3.281)} ft`);
    }
    console.log(`\nFrequencies (${freqs.length}):`);
    for (const fr of freqs) {
      console.log(`  ${fr.type.padEnd(10)} ${fr.mhz.toFixed(3)} MHz  ${fr.name}`);
    }
    handle.close();
    process.exit(0);
  });

  handle.on('exception', (e) => console.error('[EXCEPTION]', e));
  handle.on('error', (e) => { console.error('[ERROR]', e); process.exit(1); });
}

main().catch((e) => {
  console.error('[FAIL]', e?.message ?? e);
  process.exit(1);
});
