// Offline unit-style test of the FlightPhaseTracker: feed a synthetic flight profile
// (parked -> taxi -> takeoff -> climb -> cruise -> descent -> approach -> landing -> taxi in)
// and check the detected phase at each step. Run: npm run phase-test
import { FlightPhaseTracker, type PhaseInput, type FlightPhase } from '../src/brain/sim/flightPhase.js';

function s(o: Partial<PhaseInput>): PhaseInput {
  return {
    onGround: o.onGround ?? false,
    groundSpeedKt: o.groundSpeedKt ?? 0,
    altitudeAglFt: o.altitudeAglFt ?? 0,
    verticalSpeedFpm: o.verticalSpeedFpm ?? 0,
    parkingBrakeOn: o.parkingBrakeOn ?? false,
  };
}

const steps: Array<{ label: string; input: PhaseInput; expect: FlightPhase }> = [
  { label: 'at gate, brakes set',        input: s({ onGround: true, groundSpeedKt: 0, parkingBrakeOn: true }),                         expect: 'parked' },
  { label: 'taxiing out',                input: s({ onGround: true, groundSpeedKt: 15 }),                                              expect: 'taxi_out' },
  { label: 'takeoff roll',               input: s({ onGround: true, groundSpeedKt: 120 }),                                             expect: 'takeoff' },
  { label: 'initial climb',              input: s({ onGround: false, altitudeAglFt: 600, verticalSpeedFpm: 2200 }),                    expect: 'climb' },
  { label: 'climbing',                   input: s({ onGround: false, altitudeAglFt: 12000, verticalSpeedFpm: 1800 }),                  expect: 'climb' },
  { label: 'level at cruise',            input: s({ onGround: false, altitudeAglFt: 35000, verticalSpeedFpm: 50 }),                    expect: 'cruise' },
  { label: 'descending',                 input: s({ onGround: false, altitudeAglFt: 15000, verticalSpeedFpm: -1800 }),                 expect: 'descent' },
  { label: 'on approach',                input: s({ onGround: false, altitudeAglFt: 1800, verticalSpeedFpm: -700 }),                   expect: 'approach' },
  { label: 'touchdown / rollout',        input: s({ onGround: true, groundSpeedKt: 110 }),                                             expect: 'landing' },
  { label: 'taxiing in',                 input: s({ onGround: true, groundSpeedKt: 12 }),                                              expect: 'taxi_in' },
  { label: 'at gate again',              input: s({ onGround: true, groundSpeedKt: 0, parkingBrakeOn: true }),                         expect: 'taxi_in' },
];

const tracker = new FlightPhaseTracker();
let pass = 0;
for (const step of steps) {
  const got = tracker.update(step.input);
  const ok = got === step.expect;
  if (ok) pass += 1;
  console.log(`${ok ? 'OK ' : 'XX '} ${step.label.padEnd(24)} -> ${got}${ok ? '' : `  (expected ${step.expect})`}`);
}
console.log(`\n${pass}/${steps.length} phase transitions correct`);
process.exit(pass === steps.length ? 0 : 1);
