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
import {
  SimObjectType,
} from 'node-simconnect';
import type { FlightContext } from '../types.js';

/** A single AI/multiplayer aircraft near the user, read from the sim. */
export interface TrafficAircraft {
  /** Best-effort callsign/ident, e.g. "DAL123" or the tail number; falls back to the model title. */
  callsign: string;
  /** Aircraft model title (e.g. "Airbus A320neo Delta"). */
  title: string;
  lat: number;
  lon: number;
  altitudeFt: number;
  headingTrue: number;
  groundSpeedKt: number;
  onGround: boolean;
}

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
  /** Position (degrees), for plotting / nearest-gate. */
  lat?: number;
  lon?: number;
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
const TRAFFIC_DEF = 3;
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
const EVT_XPNDR_SET = 72; // XPNDR_SET takes a BCD16 squawk code
// node-simconnect's NotificationPriority is a `const enum` (erased at runtime, so it
// can't be imported as a value under tsx/esbuild). Use the literal: HIGHEST = 1.
const PRIORITY_HIGHEST = 1;

// Ground-service key events (sent by string name). Only stock MSFS events — nothing proprietary.
// Unknown/unsupported names simply no-op in the sim, so this is safe across MSFS 2020/2024.
// Each gets a unique client-event id starting at 80.
const GROUND_EVENTS: Record<string, string> = {
  pushback: 'TOGGLE_PUSHBACK',
  // Doors toggle by index: TOGGLE_AIRCRAFT_EXIT selects exit 1, then KEY_SELECT_n picks exit n.
  // The widget sends door<n> and we issue the toggle then the selector for that index.
  door: 'TOGGLE_AIRCRAFT_EXIT',
  jetway: 'TOGGLE_JETWAY',
  fuel: 'REQUEST_FUEL_KEY',
  baggage: 'REQUEST_LUGGAGE',
  catering: 'REQUEST_CATERING',
  power: 'REQUEST_POWER_SUPPLY',
  rampTruck: 'TOGGLE_RAMP_TRUCK',
  groundCrew: 'TOGGLE_AIRCRAFT_EXIT', // crew availability is door-driven in stock MSFS
};
// Exit selectors: KEY_SELECT_2..8 pick a specific door index before the toggle.
const SELECT_EVENTS: Record<number, string> = {
  2: 'KEY_SELECT_2', 3: 'KEY_SELECT_3', 4: 'KEY_SELECT_4',
  5: 'KEY_SELECT_5', 6: 'KEY_SELECT_6', 7: 'KEY_SELECT_7', 8: 'KEY_SELECT_8',
};
const GROUND_EVENT_BASE_ID = 80;

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
  parseErrors?: number; // count of skipped records on field-layout mismatch
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
  /** Callbacks fired each time a connection is (re)established. */
  private readonly connectedCbs: Array<() => void> = [];
  private retrying = false;

  get connected(): boolean {
    return this.handle !== null;
  }

  /** Register a callback fired whenever SimConnect (re)connects — e.g. to (re)start live streaming. */
  onConnected(cb: () => void): void {
    this.connectedCbs.push(cb);
    if (this.handle) { try { cb(); } catch { /* ignore */ } }
  }

  /**
   * Keep trying to connect in the background until MSFS is ready (it may not be in a flight when the
   * brain starts). Fires onConnected callbacks on success. Re-arms on 'quit' so unloading/reloading
   * a flight reconnects automatically. Non-blocking: returns immediately.
   */
  connectWithRetry(appName = 'MSFS AI ATC', intervalMs = 5000): void {
    if (this.retrying) return;
    this.retrying = true;
    const attempt = async (): Promise<void> => {
      if (this.handle) return; // already connected
      try {
        const name = await this.connect(appName);
        console.log(`SimConnect: connected (${name})`);
        for (const cb of this.connectedCbs) { try { cb(); } catch (e) { console.error('[SimConnect] onConnected cb failed', e); } }
      } catch {
        // Not ready yet — quietly try again. (Avoid log spam; this is expected pre-flight.)
        setTimeout(() => { void attempt(); }, intervalMs);
      }
    };
    void attempt();
  }

  async connect(appName = 'MSFS AI ATC'): Promise<string> {
    const { recvOpen, handle } = await withTimeout(
      open(appName, Protocol.KittyHawk),
      8000,
      'SimConnect not responding (is MSFS running and in a flight?)',
    );
    this.handle = handle;
    this.comEventsReady = false;
    this.groundEventsReady = false;
    this.xpndrReady = false;
    this.defineAirportFacility();
    this.defineParking();
    this.defineState();
    this.defineTraffic();

    handle.on('facilityData', (d) => this.onFacilityData(d));
    handle.on('facilityDataEnd', (d) => this.onFacilityDataEnd(d));
    handle.on('quit', () => {
      this.handle = null;
      // MSFS closed/unloaded — if a retry loop is active, resume trying to reconnect.
      if (this.retrying) { this.retrying = false; this.connectWithRetry(appName); }
    });
    handle.on('exception', (e) => console.error('[SimConnect exception]', e));

    return recvOpen.applicationName;
  }

  close(): void {
    this.handle?.close();
    this.handle = null;
    this.comEventsReady = false;
    this.groundEventsReady = false;
    this.xpndrReady = false;
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

  private xpndrReady = false;

  /**
   * Set the transponder code (4-digit octal squawk, e.g. "4517"). XPNDR_SET expects a BCD16
   * value (one nibble per digit). Best-effort; no-ops if not connected. Returns true if sent.
   */
  setSquawk(code: string): boolean {
    const handle = this.handle;
    const digits = (code || '').replace(/\D/g, '').slice(0, 4);
    if (!handle || digits.length !== 4) return false;
    try {
      if (!this.xpndrReady) {
        handle.mapClientEventToSimEvent(EVT_XPNDR_SET, 'XPNDR_SET');
        this.xpndrReady = true;
      }
      // BCD16: each decimal digit becomes a 4-bit nibble. "4517" -> 0x4517.
      const bcd = parseInt(digits, 16); // digits are 0-7 (octal squawk) so hex parse == BCD
      handle.transmitClientEvent(
        SimConnectConstants.OBJECT_ID_USER, EVT_XPNDR_SET, bcd,
        PRIORITY_HIGHEST, EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY,
      );
      return true;
    } catch (e) {
      console.error(`[SimConnect] squawk set failed: ${(e as Error).message}`);
      return false;
    }
  }

  private groundEventsReady = false;

  /**
   * Trigger a stock MSFS ground service by key (see GROUND_EVENTS). Best-effort: maps the event
   * lazily, transmits it, and no-ops if the sim isn't connected or the event is unsupported.
   * Returns true if the event was sent.
   */
  groundService(key: string): boolean {
    const handle = this.handle;
    if (!handle) return false;
    try {
      this.ensureGroundEvents(handle);
      // Doors: "door" = exit 1 (plain toggle); "door<n>" = select index n, then toggle.
      const doorMatch = /^door(\d+)$/.exec(key);
      if (key === 'door' || doorMatch) {
        const n = doorMatch ? Number(doorMatch[1]) : 1;
        if (n >= 2 && SELECT_EVENTS[n]) this.fire(handle, this.eventId(SELECT_EVENTS[n]!));
        this.fire(handle, this.eventId('TOGGLE_AIRCRAFT_EXIT'));
        return true;
      }
      const eventName = GROUND_EVENTS[key];
      if (!eventName) return false;
      this.fire(handle, this.eventId(eventName));
      return true;
    } catch (e) {
      console.error(`[SimConnect] ground service '${key}' failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** Map every ground + selector event to a stable client-event id, once per connection. */
  private ensureGroundEvents(handle: ConnectionHandle): void {
    if (this.groundEventsReady) return;
    let id = GROUND_EVENT_BASE_ID;
    for (const name of this.allGroundEventNames()) handle.mapClientEventToSimEvent(id++, name);
    this.groundEventsReady = true;
  }
  private allGroundEventNames(): string[] {
    return [...new Set([...Object.values(GROUND_EVENTS), ...Object.values(SELECT_EVENTS)])];
  }
  private eventId(name: string): number {
    return GROUND_EVENT_BASE_ID + this.allGroundEventNames().indexOf(name);
  }
  private fire(handle: ConnectionHandle, id: number): void {
    handle.transmitClientEvent(
      SimConnectConstants.OBJECT_ID_USER, id, 0,
      PRIORITY_HIGHEST, EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY,
    );
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

  /**
   * One-shot read of all AI/multiplayer aircraft within `radiusMeters` of the user (default 80 km).
   * Returns them sorted nearest-first is left to the caller — here we just collect the batch the sim
   * sends back. The user's own aircraft is excluded. Best-effort: resolves [] on timeout.
   */
  fetchTraffic(radiusMeters = 80000): Promise<TrafficAircraft[]> {
    const handle = this.handle;
    if (!handle) return Promise.reject(new Error('SimClient not connected'));
    const reqId = this.nextReqId++;
    return new Promise<TrafficAircraft[]>((resolve) => {
      const out: TrafficAircraft[] = [];
      const timer = setTimeout(() => {
        handle.removeListener('simObjectDataByType', onData);
        resolve(out);
      }, 4000);
      const onData = (d: { requestID: number; objectID: number; entryNumber: number; outOf: number; data: RawBuffer }) => {
        if (d.requestID !== reqId) return;
        try {
          // objectID 0 is the user's own aircraft — exclude it from the traffic picture.
          if (d.objectID !== SimConnectConstants.OBJECT_ID_USER) {
            const t = parseTraffic(d.data, d.objectID);
            if (t) out.push(t);
          }
        } catch { /* skip a malformed record */ }
        // outOf === 0 means no objects; otherwise resolve once we've seen the last one.
        if (d.outOf === 0 || d.entryNumber >= d.outOf) {
          clearTimeout(timer);
          handle.removeListener('simObjectDataByType', onData);
          resolve(out);
        }
      };
      handle.on('simObjectDataByType', onData);
      handle.requestDataOnSimObjectType(reqId, TRAFFIC_DEF, radiusMeters, SimObjectType.AIRCRAFT);
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
  // Field order/types MUST match the MSFS SDK TAXI_PARKING node exactly, else reads run off the
  // end of the buffer. We request a contiguous prefix of the documented fields and stop after the
  // ones we need (NAME, SUFFIX, NUMBER, then position) — all INT32 except LAT/LON (FLOAT64).
  private defineParking(): void {
    const h = this.handle!;
    const f = (field: string) => h.addToFacilityDefinition(PARKING_DEF, field);
    f('OPEN AIRPORT');
    f('OPEN TAXI_NAME');
    f('NAME');
    f('CLOSE TAXI_NAME');
    f('OPEN TAXI_PARKING');
    // SDK order: TYPE, TAXI_POINT_TYPE, NAME, SUFFIX, NUMBER, ORIENTATION, HEADING, RADIUS,
    // BIAS_X, BIAS_Z, LATITUDE, LONGITUDE, ALTITUDE, N_AIRLINES ...
    f('TYPE'); f('TAXI_POINT_TYPE'); f('NAME'); f('SUFFIX'); f('NUMBER');
    f('ORIENTATION'); f('HEADING'); f('RADIUS'); f('BIAS_X'); f('BIAS_Z');
    f('LATITUDE'); f('LONGITUDE');
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

  // Traffic: NUMERIC-ONLY per-aircraft fields for every AI/MP object in range. Order MUST match
  // parseTraffic(). We deliberately avoid string vars (ATC ID/AIRLINE/TITLE): mixing fixed-width
  // strings into a requestDataOnSimObjectType definition is fragile and was crashing MSFS on connect.
  // The callsign is synthesized from the object id instead — positions are all we need for advisories.
  private defineTraffic(): void {
    const h = this.handle!;
    h.addToDataDefinition(TRAFFIC_DEF, 'PLANE LATITUDE', 'degrees', SimConnectDataType.FLOAT64);
    h.addToDataDefinition(TRAFFIC_DEF, 'PLANE LONGITUDE', 'degrees', SimConnectDataType.FLOAT64);
    h.addToDataDefinition(TRAFFIC_DEF, 'PLANE ALTITUDE', 'feet', SimConnectDataType.FLOAT64);
    h.addToDataDefinition(TRAFFIC_DEF, 'PLANE HEADING DEGREES TRUE', 'degrees', SimConnectDataType.FLOAT64);
    h.addToDataDefinition(TRAFFIC_DEF, 'GROUND VELOCITY', 'knots', SimConnectDataType.FLOAT64);
    h.addToDataDefinition(TRAFFIC_DEF, 'SIM ON GROUND', 'bool', SimConnectDataType.INT32);
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
    // The exact TAXI_* field byte-layout varies; never let a mismatched read crash the brain.
    // On any parse error we just skip that record (taxi routing degrades to "taxi to parking").
    try {
      if (type === FacilityDataType.TAXI_NAME) {
        g.taxiNames.push(b.readString8().trim());
      } else if (type === FacilityDataType.TAXI_PARKING) {
        // Read in exact SDK order (see defineParking).
        const typeIdx = b.readInt32();        // TYPE (parking type enum)
        b.readInt32();                        // TAXI_POINT_TYPE (unused)
        const nameIdx = b.readInt32();        // NAME (parking name enum)
        const suffixCode = b.readInt32();     // SUFFIX (char code, e.g. 65='A')
        const number = b.readInt32();         // NUMBER
        b.readInt32();                        // ORIENTATION (unused)
        b.readFloat32();                      // HEADING
        b.readFloat32();                      // RADIUS
        b.readFloat32();                      // BIAS_X
        b.readFloat32();                      // BIAS_Z
        const lat = b.readFloat64();          // LATITUDE
        const lon = b.readFloat64();          // LONGITUDE
        const suffix = suffixCode >= 32 && suffixCode < 127 ? String.fromCharCode(suffixCode).trim() : '';
        const group = PARKING_NAME[nameIdx] ?? 'PARKING';
        const kind = (PARKING_TYPE[typeIdx] ?? 'RAMP').startsWith('GATE') ? 'GATE'
          : (PARKING_TYPE[typeIdx] ?? '').includes('CARGO') ? 'CARGO' : 'RAMP';
        const label = friendlyParking(group, suffix, number, kind);
        if (label) g.acc.parking.push({ name: label, kind, lat, lon });
      }
      // AIRPORT record carries no fields we need here (we didn't request any).
    } catch {
      g.parseErrors = (g.parseErrors ?? 0) + 1;
    }
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

/** Decode a TRAFFIC_DEF buffer into a TrafficAircraft (read order must match defineTraffic). */
function parseTraffic(b: RawBuffer, objectId: number): TrafficAircraft | null {
  // Numeric-only read (must match defineTraffic) — no string vars, which crashed the sim.
  const lat = b.readFloat64();
  const lon = b.readFloat64();
  const altitudeFt = b.readFloat64();
  const headingTrue = b.readFloat64();
  const groundSpeedKt = b.readFloat64();
  const onGround = b.readInt32() !== 0;
  // No callsign/title available without string vars; synthesize a stable label from the object id.
  const callsign = `Traffic ${objectId}`;
  return { callsign, title: callsign, lat, lon, altitudeFt, headingTrue, groundSpeedKt, onGround };
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
