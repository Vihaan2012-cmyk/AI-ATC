// SimConnect client owned by the Brain. Two jobs:
//  1) fetch real airport facility data (runways + ATC frequencies) from the sim's navdata
//  2) read live aircraft state (for the flight-phase tracker, later)
import {
  open,
  Protocol,
  FacilityDataType,
  SimConnectDataType,
  SimConnectPeriod,
  SimConnectConstants,
  EventFlag,
  type ConnectionHandle,
  type RawBuffer,
} from 'node-simconnect';
import type { FlightContext } from '../types.js';

export interface RunwayInfo {
  primary: string; // e.g. "09L"
  secondary: string; // e.g. "27R"
  headingTrue: number;
  lengthFt: number;
  widthFt: number;
}

export interface FacilityFreq {
  type: string; // GROUND, TOWER, CLEARANCE, ATIS, ...
  mhz: number;
  name: string;
}

export interface AirportFacility {
  icao: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  elevationFt: number;
  runways: RunwayInfo[];
  frequencies: FacilityFreq[];
}

export interface ParkingSpot {
  /** Human label, e.g. "Gate A 12", "Ramp GA 4". */
  name: string;
  /** Parking kind: GATE / RAMP / DOCK / etc. */
  kind: string;
}

export interface GroundLayout {
  icao: string;
  parking: ParkingSpot[];
  /** Distinct taxiway names, e.g. ["A","B","C","K"]. */
  taxiways: string[];
}

// MSFS SDK enum maps (SimConnect_AddToFacilityDefinition).
const DESIGNATOR = ['', 'L', 'R', 'C', 'W', 'A', 'B', ''];
const FREQ_TYPE = [
  'NONE', 'ATIS', 'MULTICOM', 'UNICOM', 'CTAF', 'GROUND', 'TOWER', 'CLEARANCE',
  'APPROACH', 'DEPARTURE', 'CENTER', 'FSS', 'AWOS', 'ASOS', 'CPT', 'GCO',
];

const AIRPORT_DEF = 0;
const STATE_DEF = 1;
const PARKING_DEF = 2;
const M_TO_FT = 3.28084;

// MSFS facility enums for TAXI_PARKING.
// PARKING_NAME (the NAME field): index into named parking groups.
const PARKING_NAME = [
  'NONE', 'PARKING', 'N_PARKING', 'NE_PARKING', 'E_PARKING', 'SE_PARKING',
  'S_PARKING', 'SW_PARKING', 'W_PARKING', 'NW_PARKING', 'GATE', 'DOCK', 'GATE',
];
// Friendlier spoken label per name group; gates A..Z map onto the alphabetic gate naming.
const PARKING_TYPE = [
  'NONE', 'RAMP_GA', 'RAMP_GA_SMALL', 'RAMP_GA_MEDIUM', 'RAMP_GA_LARGE',
  'RAMP_CARGO', 'RAMP_MIL_CARGO', 'RAMP_MIL_COMBAT', 'GATE_SMALL',
  'GATE_MEDIUM', 'GATE_HEAVY', 'DOCK_GA', 'FUEL', 'VEHICLES',
];

// Client-event ids + sim event names for auto-tuning the radio.
// The *_HZ variants take a plain frequency in Hz (no BCD encoding).
const EVT_COM1_STBY_SET = 70;
const EVT_COM1_SWAP = 71;
// node-simconnect's NotificationPriority is a `const enum` (erased at runtime, so it
// can't be imported as a value under tsx/esbuild). Use the literal: HIGHEST = 1.
const PRIORITY_HIGHEST = 1;

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

interface PendingFacility {
  icao: string;
  acc: AirportFacility;
  resolve: (f: AirportFacility) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingGround {
  icao: string;
  acc: GroundLayout;
  taxiNames: string[]; // TAXI_NAME table, indexed
  resolve: (g: GroundLayout) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SimClient {
  private handle: ConnectionHandle | null = null;
  private nextReqId = 100;
  private readonly pending = new Map<number, PendingFacility>();
  private readonly pendingGround = new Map<number, PendingGround>();
  private comEventsReady = false;

  get connected(): boolean {
    return this.handle !== null;
  }

  async connect(appName = 'MSFS AI ATC'): Promise<string> {
    const { recvOpen, handle } = await withTimeout(
      open(appName, Protocol.KittyHawk),
      8000,
      'SimConnect not responding (is MSFS running and in a flight?)',
    );
    this.handle = handle;
    this.comEventsReady = false;
    this.defineAirportFacility();
    this.defineParking();
    this.defineState();

    handle.on('facilityData', (d) => this.onFacilityData(d));
    handle.on('facilityDataEnd', (d) => this.onFacilityDataEnd(d));
    handle.on('quit', () => { this.handle = null; });
    handle.on('exception', (e) => console.error('[SimConnect exception]', e));

    return recvOpen.applicationName;
  }

  close(): void {
    this.handle?.close();
    this.handle = null;
    this.comEventsReady = false;
  }

  /**
   * Auto-tune COM1 to `mhz`. Sets the standby frequency and (if `swap`) flips it active,
   * mirroring what a pilot does on a handoff ("contact Tower on 119.90"). Best-effort: if
   * the sim isn't connected or the write fails, it silently no-ops. Returns true if sent.
   */
  tuneCom1(mhz: number, swap = true): boolean {
    const handle = this.handle;
    if (!handle || !Number.isFinite(mhz) || mhz < 118 || mhz > 137) return false;
    try {
      if (!this.comEventsReady) {
        handle.mapClientEventToSimEvent(EVT_COM1_STBY_SET, 'COM_STBY_RADIO_SET_HZ');
        handle.mapClientEventToSimEvent(EVT_COM1_SWAP, 'COM_STBY_RADIO_SWAP');
        this.comEventsReady = true;
      }
      const hz = Math.round(mhz * 1e6);
      handle.transmitClientEvent(
        SimConnectConstants.OBJECT_ID_USER, EVT_COM1_STBY_SET, hz,
        PRIORITY_HIGHEST, EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY,
      );
      if (swap) {
        handle.transmitClientEvent(
          SimConnectConstants.OBJECT_ID_USER, EVT_COM1_SWAP, 0,
          PRIORITY_HIGHEST, EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY,
        );
      }
      return true;
    } catch (e) {
      console.error(`[SimConnect] COM1 auto-tune failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** Fetch runways + frequencies for an airport from the sim's navdata. */
  fetchAirport(icao: string): Promise<AirportFacility> {
    const handle = this.handle;
    if (!handle) return Promise.reject(new Error('SimClient not connected'));
    const reqId = this.nextReqId++;
    return new Promise<AirportFacility>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`facility data timeout for ${icao}`));
      }, 10000);
      this.pending.set(reqId, {
        icao,
        acc: { icao, name: '', region: '', lat: 0, lon: 0, elevationFt: 0, runways: [], frequencies: [] },
        resolve,
        reject,
        timer,
      });
      handle.requestFacilityData(AIRPORT_DEF, reqId, icao);
    });
  }

  /**
   * Fetch the ground layout (parking spots + taxiway names) for an airport.
   * Isolated from fetchAirport so a SimConnect field-name mismatch here can't break
   * the (working) runway/frequency fetch. Resolves with empty arrays on timeout.
   */
  fetchGroundLayout(icao: string): Promise<GroundLayout> {
    const handle = this.handle;
    if (!handle) return Promise.reject(new Error('SimClient not connected'));
    const reqId = this.nextReqId++;
    return new Promise<GroundLayout>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingGround.delete(reqId);
        reject(new Error(`ground layout timeout for ${icao}`));
      }, 12000);
      this.pendingGround.set(reqId, {
        icao,
        acc: { icao, parking: [], taxiways: [] },
        taxiNames: [],
        resolve,
        reject,
        timer,
      });
      handle.requestFacilityData(PARKING_DEF, reqId, icao);
    });
  }

  /** One-shot read of live aircraft state. */
  getFlightState(): Promise<FlightContext> {
    const handle = this.handle;
    if (!handle) return Promise.reject(new Error('SimClient not connected'));
    const reqId = this.nextReqId++;
    return new Promise<FlightContext>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('flight state timeout')), 6000);
      const onData = (d: { requestID: number; data: RawBuffer }) => {
        if (d.requestID !== reqId) return;
        clearTimeout(timer);
        handle.removeListener('simObjectData', onData);
        resolve(parseState(d.data));
      };
      handle.on('simObjectData', onData);
      handle.requestDataOnSimObject(reqId, STATE_DEF, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.ONCE);
    });
  }

  /** Continuously receive live aircraft state (default once per second). Returns an unsubscribe fn. */
  subscribeFlightState(onState: (s: FlightContext) => void, period: SimConnectPeriod = SimConnectPeriod.SECOND): () => void {
    const handle = this.handle;
    if (!handle) throw new Error('SimClient not connected');
    const reqId = this.nextReqId++;
    const listener = (d: { requestID: number; data: RawBuffer }) => {
      if (d.requestID === reqId) onState(parseState(d.data));
    };
    handle.on('simObjectData', listener);
    handle.requestDataOnSimObject(reqId, STATE_DEF, SimConnectConstants.OBJECT_ID_USER, period);
    return () => {
      handle.removeListener('simObjectData', listener);
      handle.requestDataOnSimObject(reqId, STATE_DEF, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.NEVER);
    };
  }

  private defineAirportFacility(): void {
    const h = this.handle!;
    const f = (field: string) => h.addToFacilityDefinition(AIRPORT_DEF, field);
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
  }

  // Separate, isolated definition for the ground layout (parking + taxiway names).
  private defineParking(): void {
    const h = this.handle!;
    const f = (field: string) => h.addToFacilityDefinition(PARKING_DEF, field);
    f('OPEN AIRPORT');
    f('OPEN TAXI_NAME');
    f('NAME');
    f('CLOSE TAXI_NAME');
    f('OPEN TAXI_PARKING');
    f('NAME'); f('SUFFIX'); f('NUMBER'); f('TYPE');
    f('CLOSE TAXI_PARKING');
    f('CLOSE AIRPORT');
  }

  private defineState(): void {
    const h = this.handle!;
    // Order here MUST match parseState() below.
    h.addToDataDefinition(STATE_DEF, 'PLANE LATITUDE', 'degrees', SimConnectDataType.FLOAT64);
    h.addToDataDefinition(STATE_DEF, 'PLANE LONGITUDE', 'degrees', SimConnectDataType.FLOAT64);
    h.addToDataDefinition(STATE_DEF, 'PLANE ALTITUDE', 'feet', SimConnectDataType.FLOAT64);
    h.addToDataDefinition(STATE_DEF, 'PLANE ALT ABOVE GROUND', 'feet', SimConnectDataType.FLOAT64);
    h.addToDataDefinition(STATE_DEF, 'PLANE HEADING DEGREES TRUE', 'degrees', SimConnectDataType.FLOAT64);
    h.addToDataDefinition(STATE_DEF, 'AIRSPEED INDICATED', 'knots', SimConnectDataType.FLOAT64);
    h.addToDataDefinition(STATE_DEF, 'GROUND VELOCITY', 'knots', SimConnectDataType.FLOAT64);
    h.addToDataDefinition(STATE_DEF, 'VERTICAL SPEED', 'feet per minute', SimConnectDataType.FLOAT64);
    h.addToDataDefinition(STATE_DEF, 'SIM ON GROUND', 'bool', SimConnectDataType.INT32);
    h.addToDataDefinition(STATE_DEF, 'BRAKE PARKING INDICATOR', 'bool', SimConnectDataType.INT32);
    h.addToDataDefinition(STATE_DEF, 'COM ACTIVE FREQUENCY:1', 'MHz', SimConnectDataType.FLOAT64);
  }

  private onFacilityData(d: { userRequestId: number; type: FacilityDataType; data: import('node-simconnect').RawBuffer }): void {
    const g = this.pendingGround.get(d.userRequestId);
    if (g) { this.onGroundData(g, d.type, d.data); return; }
    const p = this.pending.get(d.userRequestId);
    if (!p) return;
    const b = d.data;
    if (d.type === FacilityDataType.AIRPORT) {
      p.acc.lat = b.readFloat64();
      p.acc.lon = b.readFloat64();
      p.acc.elevationFt = b.readFloat64() * M_TO_FT;
      p.acc.name = b.readString32();
      b.readString8(); // ICAO echo
      p.acc.region = b.readString8();
      b.readInt32(); // N_RUNWAYS
      b.readInt32(); // N_FREQUENCIES
    } else if (d.type === FacilityDataType.RUNWAY) {
      const pn = b.readInt32();
      const pd = b.readInt32();
      const sn = b.readInt32();
      const sd = b.readInt32();
      const headingTrue = b.readFloat32();
      const lengthM = b.readFloat32();
      const widthM = b.readFloat32();
      p.acc.runways.push({
        primary: runwayEnd(pn, pd),
        secondary: runwayEnd(sn, sd),
        headingTrue,
        lengthFt: lengthM * M_TO_FT,
        widthFt: widthM * M_TO_FT,
      });
    } else if (d.type === FacilityDataType.FREQUENCY) {
      const type = b.readInt32();
      const rawHz = b.readInt32();
      const name = b.readString64();
      p.acc.frequencies.push({ type: FREQ_TYPE[type] ?? `#${type}`, mhz: rawHz / 1e6, name });
    }
  }

  private onGroundData(g: PendingGround, type: FacilityDataType, b: import('node-simconnect').RawBuffer): void {
    if (type === FacilityDataType.TAXI_NAME) {
      g.taxiNames.push(b.readString8().trim());
    } else if (type === FacilityDataType.TAXI_PARKING) {
      const nameIdx = b.readInt32();
      const suffix = b.readString8().trim();
      const number = b.readInt32();
      const typeIdx = b.readInt32();
      const group = PARKING_NAME[nameIdx] ?? 'PARKING';
      const kind = (PARKING_TYPE[typeIdx] ?? 'RAMP').startsWith('GATE') ? 'GATE'
        : (PARKING_TYPE[typeIdx] ?? '').includes('CARGO') ? 'CARGO' : 'RAMP';
      const label = friendlyParking(group, suffix, number, kind);
      if (label) g.acc.parking.push({ name: label, kind });
    }
    // AIRPORT record carries no fields we need here (we didn't request any).
  }

  private onFacilityDataEnd(d: { userRequestId: number }): void {
    const g = this.pendingGround.get(d.userRequestId);
    if (g) {
      clearTimeout(g.timer);
      this.pendingGround.delete(d.userRequestId);
      // Distinct, sorted taxiway names (single letters / short codes only).
      g.acc.taxiways = [...new Set(g.taxiNames.filter((n) => n && n.length <= 3))].sort();
      g.resolve(g.acc);
      return;
    }
    const p = this.pending.get(d.userRequestId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(d.userRequestId);
    p.resolve(p.acc);
  }
}

/** Build a spoken-ish parking label from MSFS parking enums. "GATE" + "A" + 12 -> "Gate A 12". */
function friendlyParking(group: string, suffix: string, number: number, kind: string): string {
  const head = kind === 'GATE' ? 'Gate' : kind === 'CARGO' ? 'Cargo' : group === 'PARKING' ? 'Ramp' : 'Ramp';
  const parts = [head];
  if (suffix) parts.push(suffix.toUpperCase());
  if (number > 0) parts.push(String(number));
  // Drop meaningless "Ramp 0" type entries.
  if (parts.length === 1 && number <= 0) return '';
  return parts.join(' ');
}

/** Decode a STATE_DEF buffer into FlightContext (read order must match defineState). */
function parseState(b: RawBuffer): FlightContext {
  return {
    latitude: b.readFloat64(),
    longitude: b.readFloat64(),
    altitudeFt: b.readFloat64(),
    altitudeAglFt: b.readFloat64(),
    headingTrue: b.readFloat64(),
    iasKt: b.readFloat64(),
    groundSpeedKt: b.readFloat64(),
    verticalSpeedFpm: b.readFloat64(),
    onGround: b.readInt32() !== 0,
    parkingBrakeOn: b.readInt32() !== 0,
    com1Mhz: b.readFloat64(), // live COM1 active frequency (MHz) for frequency awareness
    source: 'simconnect',
  };
}
