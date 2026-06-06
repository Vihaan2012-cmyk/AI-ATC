// Live phase monitor: subscribe to sim state and print the detected flight phase once
// per second for 30s. Run while taxiing/flying:  npm run phase-monitor
import { SimClient } from '../src/brain/sim/simClient.js';
import { FlightPhaseTracker } from '../src/brain/sim/flightPhase.js';

const sim = new SimClient();
const app = await sim.connect('MSFS AI ATC (phase-monitor)');
console.log(`[OK] connected to: ${app} — watching phase for 30s\n`);

const tracker = new FlightPhaseTracker();
const unsub = sim.subscribeFlightState((s) => {
  const phase = tracker.update(s);
  console.log(
    `${phase.padEnd(9)} | gs ${s.groundSpeedKt.toFixed(0).padStart(3)} kt` +
      ` | agl ${s.altitudeAglFt.toFixed(0).padStart(6)} ft` +
      ` | vs ${s.verticalSpeedFpm.toFixed(0).padStart(6)} fpm` +
      ` | onGnd ${s.onGround ? 'Y' : 'N'} | brake ${s.parkingBrakeOn ? 'Y' : 'N'}`,
  );
});

setTimeout(() => {
  unsub();
  sim.close();
  console.log('\n[done]');
  process.exit(0);
}, 30000);
