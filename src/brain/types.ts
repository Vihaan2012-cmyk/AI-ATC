// Shared domain types for the ATC brain.

export type FlightRules = 'IFR' | 'VFR';

export interface Waypoint {
  ident: string;
  lat: number;
  lon: number;
  type?: string;
}

/** A titled group of label/value rows for the info flyout. */
export interface InfoSection {
  title: string;
  rows: Array<[string, string]>;
}

/** Formatted OFP summary for the info flyout. */
export interface OfpSummary {
  gcNm?: string;
  routeNm?: string;
  eobt?: string;
  etd?: string;
  eta?: string;
  ete?: string;
  block?: string;
  sid?: string;
  star?: string;
}

/** Normalized flight plan (from SimBrief OFP, or the built-in sample). */
export interface FlightPlan {
  /** Filed/ATC callsign, e.g. "SWA1234" or "N512SR". */
  callsign: string;
  /** Spoken form if known, e.g. "Southwest 1234". Optional; derived otherwise. */
  telephony?: string;
  /** Aircraft ICAO type, e.g. "B738". */
  aircraftIcao: string;
  origin: string; // ICAO
  destination: string; // ICAO
  alternate?: string; // ICAO
  cruiseAltitudeFt: number;
  initialAltitudeFt: number;
  /** Filed enroute route string. */
  route: string;
  sid?: string;
  /** Planned arrival procedure (from the OFP), e.g. "GLASR2". */
  star?: string;
  /** Planned departure runway, e.g. "16R" (from SimBrief origin.plan_rwy). */
  departureRunway?: string;
  /** Planned arrival runway, e.g. "10R" (from SimBrief destination.plan_rwy). */
  arrivalRunway?: string;
  flightRules: FlightRules;
  source: 'simbrief' | 'sample';
  /** OFP details for the info flyout. */
  aircraftName?: string;
  weights?: { zfw?: string; tow?: string; fuel?: string; units?: string };
  ofp?: OfpSummary;
  /** Comprehensive OFP data for the flyout (exact values, grouped). */
  infoSections?: InfoSection[];
  /** Raw SimBrief OFP document as plain text (the full briefing), if available. */
  rawOfp?: string;
  /** Origin/destination coordinates + route fixes, for the flight-plan display. */
  originLat?: number;
  originLon?: number;
  destLat?: number;
  destLon?: number;
  waypoints?: Waypoint[];
}

/** Live aircraft state from SimConnect. */
export interface FlightContext {
  latitude: number;
  longitude: number;
  altitudeFt: number;
  altitudeAglFt: number;
  headingTrue: number;
  iasKt: number;
  groundSpeedKt: number;
  verticalSpeedFpm: number;
  onGround: boolean;
  parkingBrakeOn: boolean;
  com1Mhz: number;
  source: 'simconnect' | 'mock';
}

export type PilotIntentType =
  | 'request_ifr_clearance'
  | 'request_pushback'
  | 'request_taxi'
  | 'ready_for_departure'
  | 'go_around'
  | 'request_flight_following'
  | 'request_pattern'
  | 'touch_and_go'
  | 'full_stop'
  | 'request_hold'
  | 'readback'
  | 'unknown';

/** Result of parsing a pilot transmission (NLU). */
export interface PilotIntent {
  intent: PilotIntentType;
  /** ATIS letter if mentioned, e.g. "B". */
  atisInfo: string | null;
  confidence: number; // 0..1
  via: 'rules' | 'llm';
}

/** A single enroute request parsed from free-flow speech (one transmission may have several). */
export type EnrouteRequestType =
  | 'climb' | 'descend' | 'direct' | 'deviate' | 'speed' | 'hold_at' | 'higher' | 'lower'
  | 'cross' | 'unable';

export interface EnrouteRequest {
  type: EnrouteRequestType;
  /** Target altitude in ft (climb/descend, or the crossing altitude for 'cross'). */
  altitudeFt?: number;
  /** Fix/waypoint for direct-to, hold, or a crossing restriction. */
  fix?: string;
  /** Deviation side + degrees (deviate). */
  side?: 'left' | 'right';
  degrees?: number;
  /** Speed in knots (speed). */
  speedKt?: number;
  /** Crossing restriction relation for 'cross' (default 'at'). */
  restriction?: 'at' | 'at_or_above' | 'at_or_below';
  /** True when the pilot asked for the change at their discretion / when ready. */
  discretionary?: boolean;
}

/** A built IFR clearance (CRAFT). */
export interface Clearance {
  callsign: string;
  clearanceLimit: string; // destination ICAO
  route: string; // "as filed" or "<SID> then as filed"
  initialAltitudeFt: number;
  cruiseAltitudeFt: number;
  departureFreqMhz: number | null;
  squawk: string; // 4-digit octal
}

export type ControllerKind =
  | 'delivery'
  | 'ground'
  | 'tower'
  | 'departure'
  | 'center'
  | 'approach';

/** Machine-readable instruction values carried alongside a reply (for auto-set + the HUD strip). */
export interface AssignedState {
  squawk?: string;          // 4-digit octal, e.g. "4517"
  altitudeFt?: number;      // assigned/cleared altitude
  headingDeg?: number;      // assigned heading
  speedKt?: number;         // assigned speed
  nextFreqMhz?: number;     // frequency to contact next (handoff)
  nextStation?: string;     // who to contact next, e.g. "Departure"
}

/** A controller -> pilot reply. */
export interface Reply {
  from: string; // station label, e.g. "Seattle Delivery"
  freqMhz: number | null;
  text: string;
  expecting: 'readback' | 'none';
  /** If set, the session should switch the active controller to this position. */
  handoff?: ControllerKind | null;
  /** Structured values for the cockpit (auto-squawk, HUD strip). */
  assigned?: AssignedState;
}
