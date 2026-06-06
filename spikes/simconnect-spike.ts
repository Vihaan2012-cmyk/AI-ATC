/**
 * Phase 0b spike: confirm the Brain can read live sim state via SimConnect.
 * One-shot: connect, read 3 samples of well-known sim vars, then exit.
 *
 * Run with MSFS running + a flight loaded (not the main menu):
 *   npm run spike:simconnect
 */
import {
  open,
  Protocol,
  SimConnectDataType,
  SimConnectPeriod,
  SimConnectConstants,
} from 'node-simconnect';

const DEF = 0;
const REQ = 0;
const SAMPLES = 3;

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

async function main() {
  console.log('-> connecting to MSFS via SimConnect ...');
  const { recvOpen, handle } = await withTimeout(
    open('ATC Brain Spike', Protocol.KittyHawk),
    8000,
    'no response from SimConnect within 8s (is MSFS running and IN a flight?)',
  );
  console.log(`[OK] connected to: ${recvOpen.applicationName}`);

  // Well-known sim vars with unambiguous units (read back in this exact order).
  handle.addToDataDefinition(DEF, 'PLANE LATITUDE', 'degrees', SimConnectDataType.FLOAT64);
  handle.addToDataDefinition(DEF, 'PLANE LONGITUDE', 'degrees', SimConnectDataType.FLOAT64);
  handle.addToDataDefinition(DEF, 'PLANE ALTITUDE', 'feet', SimConnectDataType.FLOAT64);
  handle.addToDataDefinition(DEF, 'PLANE HEADING DEGREES TRUE', 'degrees', SimConnectDataType.FLOAT64);
  handle.addToDataDefinition(DEF, 'AIRSPEED INDICATED', 'knots', SimConnectDataType.FLOAT64);
  handle.addToDataDefinition(DEF, 'SIM ON GROUND', 'bool', SimConnectDataType.INT32);

  handle.requestDataOnSimObject(REQ, DEF, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SECOND);

  let count = 0;
  const noData = setTimeout(() => {
    console.error('[FAIL] connected but received no data in 12s (is a flight actually loaded?)');
    process.exit(1);
  }, 12000);

  handle.on('simObjectData', (d) => {
    if (d.requestID !== REQ) return;
    const lat = d.data.readFloat64();
    const lon = d.data.readFloat64();
    const alt = d.data.readFloat64();
    const hdg = d.data.readFloat64();
    const ias = d.data.readFloat64();
    const onGnd = d.data.readInt32();
    count += 1;
    console.log(
      `#${count}  lat ${lat.toFixed(5)}  lon ${lon.toFixed(5)}  alt ${alt.toFixed(0)} ft  ` +
        `hdg ${hdg.toFixed(0)} T  IAS ${ias.toFixed(0)} kt  onGround ${onGnd ? 'Y' : 'N'}`,
    );
    if (count >= SAMPLES) {
      clearTimeout(noData);
      console.log('\n[OK] live sim data confirmed.');
      handle.close();
      process.exit(0);
    }
  });

  handle.on('exception', (e) => console.error('[EXCEPTION]', e));
  handle.on('quit', () => { console.log('sim quit.'); process.exit(0); });
  handle.on('error', (e) => { console.error('[ERROR]', e); process.exit(1); });
}

main().catch((e) => {
  console.error('[FAIL]', e?.message ?? e);
  process.exit(1);
});
