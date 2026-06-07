// Controller session: routes pilot transmissions to the active controller and switches
// positions on handoff across the full gate-to-gate chain:
//   Delivery -> Ground -> Tower -> Departure -> Center -> Approach -> Tower(arr) -> Ground(arr)
import type { ControllerKind, FlightPlan, Reply } from '../types.js';
import type { Navdata } from '../navdata/navdata.js';
import type { LlmClient } from '../llm/ollama.js';
import { ClearanceDelivery } from './clearanceDelivery.js';
import { GroundControl, type GroundLayout } from './groundControl.js';
import type { StrictnessLevel } from './compliance.js';
import { TowerControl } from './towerControl.js';
import { DepartureControl } from './departureControl.js';
import { CenterControl } from './centerControl.js';
import { ApproachControl } from './approachControl.js';
import { spokenFlightCallsign } from '../util/aircraft.js';
import { shortenAirportName, spokenRunway, parseSpokenAltitudeFt } from '../util/phraseology.js';
import { buildHold } from './holds.js';
import { parseEnrouteRequests } from '../llm/freeflow.js';
import { composeEnrouteReply, assignedAltitude, composeUnableReply, isRerouteRequest, composeReroute, composePopupIfr } from './enroute.js';
import { trafficAdvisory, type TrafficPicture } from './liveTraffic.js';
import { isExplainRequest, explainInstruction, type LastInstruction } from './explain.js';
import { ConversationMemory } from '../llm/memory.js';
import { parseMetarDetail, type MetarInfo } from '../sim/weather.js';

interface Controller {
  handle(pilotText: string): Promise<Reply>;
}

const STATION_LABELS: Record<ControllerKind, string> = {
  delivery: 'Delivery', ground: 'Ground', tower: 'Tower',
  departure: 'Departure', center: 'Center', approach: 'Approach',
};

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

export class ControllerSession {
  private active: Controller;
  private kind: ControllerKind = 'delivery';
  /** Flips true once we reach Approach, so Tower/Ground build in arrival mode at the destination. */
  private arriving = false;
  private readonly spokenCs: string;
  private lastFrom = 'ATC';
  /** Live COM1 active frequency (MHz), updated from the sim. 0 = unknown (don't enforce). */
  private com1Mhz = 0;
  /** When true, calls on the wrong frequency get no useful answer. */
  private enforceFrequency = false;
  /** Last altitude (ft) a controller assigned, parsed from replies. Null until one is issued. */
  private lastAssignedAltFt: number | null = null;
  /** Emergency flow: 0 = none, 1 = declared (asked for souls/fuel), 2 = info given (vectors offered). */
  private emergencyStep = 0;
  /** Active scenario flavor (engine_failure, medical, etc.), for tailored ATC + the logbook. */
  private scenario: string | null = null;
  /** Readback scoring: how many readbacks were requested vs. accepted first-try. */
  private readbacksExpected = 0;
  private readbacksCorrect = 0;
  private declaredEmergency = false;
  /** True after a reply that expected a readback (so the next pilot call is scored). */
  private awaitingReadback = false;
  /** Latest live-traffic picture from the sim, for "say traffic" queries + traffic-aware replies. */
  private traffic: TrafficPicture | null = null;
  /** The last structured instruction ATC issued, for the "explain that" clarifier. */
  private lastInstruction: LastInstruction | null = null;
  /** Per-session conversational memory for back-references. */
  private readonly memory = new ConversationMemory();

  constructor(
    private fp: FlightPlan,
    private nav: Navdata,
    private llm: LlmClient | null,
    private weather: Record<string, MetarInfo> = {},
    private ground: Record<string, GroundLayout> = {},
    private strictness: StrictnessLevel = 'normal',
  ) {
    this.active = new ClearanceDelivery(fp, nav, llm, strictness);
    this.spokenCs = spokenFlightCallsign(fp);
  }

  get activeKind(): ControllerKind {
    return this.kind;
  }

  /** The frequency the active controller is on (MHz), or null if unknown. */
  get activeFreqMhz(): number | null {
    return this.freqFor(this.kind);
  }

  /** The altitude (ft) the active controller last assigned, for reactive monitoring. */
  get assignedAltitudeFt(): number | null {
    return this.lastAssignedAltFt;
  }

  get isArriving(): boolean {
    return this.arriving;
  }

  /** Feed the live COM1 active frequency (MHz). Enables frequency awareness once seen. */
  setCom1(mhz: number): void {
    if (mhz && mhz > 100 && mhz < 140) { this.com1Mhz = mhz; this.enforceFrequency = true; }
  }

  /** Turn frequency enforcement on/off (e.g. from a realism setting). */
  setEnforceFrequency(on: boolean): void { this.enforceFrequency = on; }

  /** Feed the latest live-traffic picture (from the sim) for traffic queries + advisories. */
  setTraffic(picture: TrafficPicture | null): void { this.traffic = picture; }

  private freqFor(kind: ControllerKind): number | null {
    const dep = this.fp.origin, arr = this.fp.destination;
    const apt = this.arriving ? arr : dep;
    switch (kind) {
      case 'delivery': return this.nav.getDeliveryFrequency(dep);
      case 'ground': return this.nav.getGroundFrequency(apt);
      case 'tower': return this.nav.getTowerFrequency(apt);
      case 'departure': return this.nav.getDepartureFrequency(dep);
      case 'approach': return this.nav.getApproachFrequency(arr);
      case 'center': return null; // center freq varies; not enforced
      default: return null;
    }
  }

  /** Is COM1 tuned (within tolerance) to the active controller's frequency? */
  private onCorrectFrequency(): boolean {
    if (!this.enforceFrequency || !this.com1Mhz) return true;
    const want = this.freqFor(this.kind);
    if (want == null) return true; // unknown/center -> don't block
    return Math.abs(this.com1Mhz - want) < 0.011;
  }

  async handle(pilotText: string): Promise<Reply> {
    // Emergency takes over the session until resolved.
    if (this.emergencyStep > 0 || this.isEmergency(pilotText)) return this.emergencyReply(pilotText);
    if (/\batis\b/i.test(pilotText)) return this.atisReply();
    if (!this.onCorrectFrequency()) return this.wrongFreqReply();
    if (/flight following|vfr (advisor|service|flight following)|request advisor/i.test(pilotText)) {
      return this.flightFollowingReply();
    }
    if (/\bhold(ing)?\b|hold as published|enter the hold/i.test(pilotText)) {
      return this.holdReply();
    }
    // "explain that" -> restate the last instruction in plain English.
    if (isExplainRequest(pilotText)) {
      return {
        from: STATION_LABELS[this.kind] ?? this.lastFrom, freqMhz: this.activeFreqMhz,
        text: `${this.spokenCs}, ${explainInstruction(this.lastInstruction)}`, expecting: 'none',
      };
    }
    // "say traffic" / "any traffic" / "traffic advisories" -> read back the live traffic picture.
    if (/\b(say|any|request|report)\s+traffic\b|\btraffic\s+(advisor|in sight|call)/i.test(pilotText)) {
      return this.trafficReply();
    }
    // Pilot "unable" — decline the standing instruction; offer an alternative.
    if (/\bunable\b/i.test(pilotText) && (this.kind === 'center' || this.kind === 'departure' || this.kind === 'approach')) {
      return {
        from: STATION_LABELS[this.kind] ?? 'ATC', freqMhz: this.activeFreqMhz,
        text: `${this.spokenCs}, ${composeUnableReply(this.lastAssignedAltFt)}.`,
        expecting: 'none',
      };
    }
    // Pop-up VFR-to-IFR: a VFR flight airborne requesting IFR to its destination.
    if (this.fp.flightRules === 'VFR' && /request (ifr|i-f-r)( clearance)?/i.test(pilotText)
        && (this.kind === 'center' || this.kind === 'approach' || this.kind === 'departure')) {
      const squawk = String(4000 + ((this.com1Mhz * 1000) % 3000)).padStart(4, '0').slice(0, 4);
      const climbTo = Math.max(this.fp.cruiseAltitudeFt, (this.lastAssignedAltFt ?? 6000) + 2000);
      this.lastAssignedAltFt = climbTo;
      return {
        from: STATION_LABELS[this.kind] ?? 'ATC', freqMhz: this.activeFreqMhz,
        text: `${this.spokenCs}, ${composePopupIfr(this.fp.destination, squawk, climbTo)}.`,
        expecting: 'readback', assigned: { squawk, altitudeFt: climbTo },
      };
    }
    // Enroute reroute request (center).
    if (isRerouteRequest(pilotText) && (this.kind === 'center' || this.kind === 'departure')) {
      const viaFix = pilotText.match(/\bvia ([A-Za-z]{2,5})\b/i)?.[1]?.toUpperCase()
        ?? pilotText.match(/\bdirect ([A-Za-z]{2,5})\b/i)?.[1]?.toUpperCase();
      return {
        from: STATION_LABELS[this.kind] ?? 'ATC', freqMhz: this.activeFreqMhz,
        text: `${this.spokenCs}, ${composeReroute(viaFix, this.fp.destination)}.`,
        expecting: 'readback',
      };
    }
    // Free-flow enroute requests (deviate/direct/climb/descend/speed) — handled when airborne and
    // talking to an enroute/approach controller, where such requests make sense.
    if (this.kind === 'center' || this.kind === 'departure' || this.kind === 'approach') {
      const reqs = parseEnrouteRequests(pilotText).filter((r) => r.type !== 'unable');
      if (reqs.length > 0) {
        const now = new Date();
        const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
        const ctx = { altitudeFt: this.lastAssignedAltFt ?? undefined, cruiseFt: this.fp.cruiseAltitudeFt, nowUtcMinutes: nowMin };
        const body = composeEnrouteReply(reqs, ctx);
        if (body) {
          const alt = assignedAltitude(reqs, ctx);
          if (alt != null) this.lastAssignedAltFt = alt;
          const fix = reqs.find((r) => r.fix)?.fix;
          const speedKt = reqs.find((r) => r.speedKt != null)?.speedKt;
          this.lastInstruction = { altitudeFt: alt ?? undefined, fix, speedKt, raw: body };
          this.memory.add({ pilot: pilotText, atc: body, altitudeFt: alt ?? undefined, fix, speedKt, kind: 'enroute' });
          return {
            from: STATION_LABELS[this.kind] ?? 'ATC', freqMhz: this.activeFreqMhz,
            text: `${this.spokenCs}, ${body}`, expecting: 'readback',
            assigned: alt != null ? { altitudeFt: alt } : undefined,
          };
        }
      }
    }
    // VFR pattern work routes to Tower regardless of the current position.
    if (/closed traffic|remain(ing)? in the pattern|stay in the pattern|pattern work|touch.?and.?go|low approach|the option|enter (the )?(left|right) (down ?wind|base)/i.test(pilotText)) {
      if (this.kind !== 'tower') this.switchTo('tower');
    }
    // If the previous reply asked for a readback, score this transmission as the readback.
    if (this.awaitingReadback) {
      this.readbacksExpected += 1;
    }

    const reply = await this.active.handle(pilotText);

    // A correction ("negative ... I say again") means the readback was wrong; otherwise correct.
    if (this.awaitingReadback) {
      const wasCorrect = !/\bnegative\b|i say again/i.test(reply.text);
      if (wasCorrect) {
        this.readbacksCorrect += 1;
        // Explicit "readback correct" acknowledgement — only when the controller isn't already
        // issuing a new instruction (expecting another readback), so it doesn't get spammy.
        if (reply.expecting !== 'readback' && !/readback correct/i.test(reply.text)) {
          reply.text = `${this.spokenCs}, readback correct. ${reply.text.replace(new RegExp('^' + this.spokenCs + ',?\\s*', 'i'), '')}`.trim();
        }
      }
    }
    this.awaitingReadback = reply.expecting === 'readback';

    // Each handoff targets a different position than the current one, so this is safe even
    // though ground/tower recur (their second occurrence is reached from approach/tower).
    if (reply.handoff && reply.handoff !== this.kind) {
      // Surface who/what to contact next for the HUD strip (before switching position).
      reply.assigned = {
        ...reply.assigned,
        nextStation: STATION_LABELS[reply.handoff] ?? reply.handoff,
        nextFreqMhz: this.freqFor(reply.handoff) ?? reply.assigned?.nextFreqMhz,
      };
      this.switchTo(reply.handoff);
    }
    this.captureAssignedAltitude(reply.text);
    this.lastFrom = reply.from;
    return reply;
  }

  /** Flight scorecard for the logbook. */
  get scorecard(): { callsign: string; origin: string; destination: string; readbacksExpected: number; readbacksCorrect: number; readbackAccuracy: number; declaredEmergency: boolean; scenario: string | null } {
    const acc = this.readbacksExpected > 0 ? Math.round((this.readbacksCorrect / this.readbacksExpected) * 100) : 100;
    return {
      callsign: this.fp.callsign, origin: this.fp.origin, destination: this.fp.destination,
      readbacksExpected: this.readbacksExpected, readbacksCorrect: this.readbacksCorrect,
      readbackAccuracy: acc, declaredEmergency: this.declaredEmergency, scenario: this.scenario,
    };
  }

  /** Serializable session state, for resuming a flight across an app restart. */
  snapshot(): Record<string, unknown> {
    return {
      callsign: this.fp.callsign, origin: this.fp.origin, destination: this.fp.destination,
      kind: this.kind, arriving: this.arriving, lastFrom: this.lastFrom,
      lastAssignedAltFt: this.lastAssignedAltFt, emergencyStep: this.emergencyStep,
      scenario: this.scenario, readbacksExpected: this.readbacksExpected,
      readbacksCorrect: this.readbacksCorrect, declaredEmergency: this.declaredEmergency,
    };
  }

  /** Restore from a snapshot — only if it's the SAME flight (callsign + route), else ignore. */
  restore(s: Record<string, unknown> | null): boolean {
    if (!s || s.callsign !== this.fp.callsign || s.origin !== this.fp.origin || s.destination !== this.fp.destination) {
      return false;
    }
    this.arriving = !!s.arriving;
    this.kind = (s.kind as ControllerKind) ?? 'delivery';
    const rebuilt = this.build(this.kind);
    if (rebuilt) this.active = rebuilt;
    this.lastFrom = typeof s.lastFrom === 'string' ? s.lastFrom : 'ATC';
    this.lastAssignedAltFt = typeof s.lastAssignedAltFt === 'number' ? s.lastAssignedAltFt : null;
    this.emergencyStep = typeof s.emergencyStep === 'number' ? s.emergencyStep : 0;
    this.scenario = typeof s.scenario === 'string' ? s.scenario : null;
    this.readbacksExpected = typeof s.readbacksExpected === 'number' ? s.readbacksExpected : 0;
    this.readbacksCorrect = typeof s.readbacksCorrect === 'number' ? s.readbacksCorrect : 0;
    this.declaredEmergency = !!s.declaredEmergency;
    return true;
  }

  /** Pull an assigned altitude out of an ATC reply (e.g. "climb and maintain five thousand"). */
  private captureAssignedAltitude(text: string): void {
    const ft = parseSpokenAltitudeFt(text);
    if (ft != null) this.lastAssignedAltFt = ft;
  }

  private isEmergency(t: string): boolean {
    return /\bmayday\b|\bpan[- ]?pan\b|declar\w*\s+(an?\s+)?emergenc|\bemergency\b|\b7700\b/i.test(t);
  }

  private holdReply(): Reply {
    const now = new Date();
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const hold = buildHold(this.fp, nowMin);
    return {
      from: this.lastFrom === 'ATC' ? (STATION_LABELS[this.kind] ?? 'Center') : this.lastFrom,
      freqMhz: this.activeFreqMhz,
      text: `${this.spokenCs}, ${hold.text}`,
      expecting: 'readback',
    };
  }

  /** Answer a pilot traffic query from the live picture, or "no reported traffic". */
  private trafficReply(): Reply {
    const from = STATION_LABELS[this.kind] ?? this.lastFrom;
    const freq = this.activeFreqMhz;
    const primary = this.traffic?.primary ?? this.traffic?.nearby[0] ?? null;
    const adv = trafficAdvisory(primary);
    const more = this.traffic ? this.traffic.nearby.length - (primary ? 1 : 0) : 0;
    const tail = more > 0 ? ` Additional traffic in your area, ${more} target${more > 1 ? 's' : ''}.` : '';
    const text = adv
      ? `${this.spokenCs}, ${adv}.${tail}`
      : `${this.spokenCs}, no reported traffic in your immediate area.`;
    return { from, freqMhz: freq, text, expecting: 'none' };
  }

  private flightFollowingReply(): Reply {
    const dest = shortenAirportName(this.nav.getAirport(this.fp.destination)?.name, this.fp.destination);
    const squawk = String(1200 + ((this.com1Mhz * 1000) % 5000)).padStart(4, '0').slice(0, 4);
    return {
      from: this.lastFrom === 'ATC' ? 'Approach' : this.lastFrom,
      freqMhz: this.activeFreqMhz,
      text: `${this.spokenCs}, radar contact, squawk ${squawk.split('').join(' ')}. VFR flight following to ${dest} approved. Maintain VFR, advise any altitude changes.`,
      expecting: 'none',
    };
  }

  private wrongFreqReply(): Reply {
    const want = this.freqFor(this.kind);
    const tuned = this.com1Mhz ? this.com1Mhz.toFixed(3) : '—';
    // On the wrong frequency the active controller can't hear you; surface a hint so the
    // player isn't stuck. (Realistic enough: another aircraft / the controller nudges you.)
    const hint = want != null ? `try ${want.toFixed(3)}` : 'check your assigned frequency';
    return {
      from: 'No reply',
      freqMhz: this.com1Mhz || null,
      text: `(no response on ${tuned} — you may be on the wrong frequency; ${hint})`,
      expecting: 'none',
    };
  }

  /** Declare a specific non-normal scenario (engine_failure, medical, depressurization, ...). */
  declareScenario(kind: string): Reply {
    this.scenario = kind;
    this.emergencyStep = 0;            // route into the emergency flow with this flavor
    return this.emergencyReply('');
  }

  // Scenario-specific opening acknowledgement (after the generic squawk-7700 line).
  private scenarioAck(): string {
    switch (this.scenario) {
      case 'engine_failure': return ' Understood, engine failure. Do you require the longest runway and immediate vectors?';
      case 'medical': return ' Copy medical emergency. Medical services will meet the aircraft. Say souls on board and nature if able.';
      case 'depressurization': return ' Roger, depressurization — descend at your discretion to a safe altitude, expedite as required.';
      case 'fuel': return ' Roger, fuel emergency — you are number one, expect the most direct routing.';
      case 'smoke_fire': return ' Copy smoke or fire — recommend land as soon as possible; equipment will be standing by.';
      case 'control': return ' Roger, control difficulty — say controllability and the assistance you need.';
      default: return '';
    }
  }

  private emergencyReply(pilotText: string): Reply {
    const from = this.lastFrom === 'ATC' ? (STATION_LABELS[this.kind] ?? 'ATC') : this.lastFrom;
    const freq = this.activeFreqMhz;

    // Step 1: just declared — acknowledge, squawk 7700, ask souls/fuel/intentions.
    if (this.emergencyStep === 0) {
      this.emergencyStep = 1;
      this.declaredEmergency = true;
      return {
        from, freqMhz: freq,
        text: `${this.spokenCs}, roger your emergency. Squawk seven seven zero zero. You have priority — the airspace is yours.${this.scenarioAck()} Say souls on board, fuel remaining in minutes, and your intentions.`,
        expecting: 'none',
      };
    }

    // Step 2: pilot gave info (any reply) — offer the nearest suitable field + vectors + roll equipment.
    if (this.emergencyStep === 1) {
      this.emergencyStep = 2;
      const div = this.nearestSuitable();
      const divName = div ? shortenAirportName(this.nav.getAirport(div)?.name, div) : 'your destination';
      const rwy = div ? this.pickActiveRunway(div, parseMetarDetail(this.weather[div]?.raw).windDir) : null;
      const rwyTxt = rwy ? ` Expect runway ${spokenRunway(rwy)}.` : '';
      return {
        from, freqMhz: freq,
        text: `${this.spokenCs}, copy. Nearest suitable airport is ${divName}. Fly direct ${div ?? 'destination'}, descend at your discretion, cleared the approach.${rwyTxt} Emergency equipment is rolling. Advise any assistance required.`,
        expecting: 'none',
      };
    }

    // Step 3+: ongoing — keep priority, accept further requests / cancellation.
    if (/cancel|negative emergency|operations normal|resume normal/i.test(pilotText)) {
      this.emergencyStep = 0;
      return { from, freqMhz: freq, text: `${this.spokenCs}, roger, emergency cancelled. Squawk as previously assigned, resume normal operations.`, expecting: 'none' };
    }
    return { from, freqMhz: freq, text: `${this.spokenCs}, roger, you still have priority. Say intentions or advise when ready.`, expecting: 'none' };
  }

  /** Nearest of origin/destination by great-circle from the last known position-less heuristic. */
  private nearestSuitable(): string | null {
    // Prefer destination if we're already arriving, else origin; both have known runways.
    return this.arriving ? this.fp.destination : this.fp.origin;
  }

  private atisLetter(): string {
    return String.fromCharCode(65 + (new Date().getUTCHours() % 26));
  }

  private pickActiveRunway(icao: string, windDir: number | null): string | null {
    const rwys = this.nav.getRunways(icao);
    if (rwys.length === 0) return null;
    if (windDir == null) return rwys[0] ?? null;
    let best = rwys[0]!;
    let bestDiff = 999;
    for (const r of rwys) {
      const n = parseInt(r, 10);
      if (!Number.isFinite(n)) continue;
      const diff = Math.abs(((windDir - n * 10 + 540) % 360) - 180);
      if (diff < bestDiff) { bestDiff = diff; best = r; }
    }
    return best;
  }

  private atisReply(): Reply {
    const icao = this.arriving ? this.fp.destination : this.fp.origin;
    const name = shortenAirportName(this.nav.getAirport(icao)?.name, icao);
    const det = parseMetarDetail(this.weather[icao]?.raw);
    const letter = this.atisLetter();
    const rwy = this.pickActiveRunway(icao, det.windDir) ?? this.fp.departureRunway ?? null;
    const atisFreq = this.nav.getFrequencies(icao).find((f) => f.type.toUpperCase() === 'ATIS')?.mhz ?? null;
    const parts = [`${name} information ${letter}.`];
    if (det.wind) parts.push(cap(det.wind) + '.');
    if (det.vis) parts.push(cap(det.vis) + '.');
    if (det.sky) parts.push(cap(det.sky) + '.');
    if (det.temp) parts.push(cap(det.temp) + '.');
    if (det.alt) parts.push(`Altimeter ${det.alt}.`);
    if (rwy) parts.push(`Landing and departing runway ${spokenRunway(rwy)}.`);
    parts.push(`Advise on initial contact you have information ${letter}.`);
    return { from: `${name} ATIS`, freqMhz: atisFreq, text: parts.join(' '), expecting: 'none' };
  }

  private switchTo(kind: ControllerKind): void {
    if (kind === 'approach') this.arriving = true;
    const next = this.build(kind);
    if (next) {
      this.kind = kind;
      this.active = next;
    }
  }

  private build(kind: ControllerKind): Controller | null {
    const { fp, nav, llm, strictness } = this;
    switch (kind) {
      case 'delivery':
        return new ClearanceDelivery(fp, nav, llm, strictness);
      case 'ground':
        return this.arriving
          ? new GroundControl(fp, nav, llm, fp.destination, 'arrival', this.ground[fp.destination] ?? null)
          : new GroundControl(fp, nav, llm, fp.origin, 'departure', this.ground[fp.origin] ?? null);
      case 'tower':
        return this.arriving
          ? new TowerControl(fp, nav, llm, fp.destination, 'arrival')
          : new TowerControl(fp, nav, llm, fp.origin, 'departure');
      case 'departure':
        return new DepartureControl(fp, nav, llm);
      case 'center':
        return new CenterControl(fp, nav, llm);
      case 'approach':
        return new ApproachControl(fp, nav, llm, strictness);
      default:
        return null;
    }
  }
}
