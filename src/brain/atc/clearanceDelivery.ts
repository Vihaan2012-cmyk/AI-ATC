// Clearance Delivery position: a small state machine that issues an IFR clearance
// (CRAFT) and validates the pilot's readback. Engine-authoritative: all facts come
// from the flight plan + navdata; the LLM is only consulted (via NLU) for parsing.
import type { Clearance, FlightPlan, Reply } from '../types.js';
import type { Navdata } from '../navdata/navdata.js';
import type { LlmClient } from '../llm/ollama.js';
import { parseIntent } from '../llm/nlu.js';
import { allocateSquawk } from './squawk.js';
import {
  spokenAltitude,
  spokenDigits,
  spokenFreq,
  shortenAirportName,
} from '../util/phraseology.js';
import { spokenFlightCallsign } from '../util/aircraft.js';
import { readbackItems, checkReadback, correctionPhrase, type StrictnessLevel } from './compliance.js';

type State = 'idle' | 'awaiting_readback' | 'complete';

function buildClearance(fp: FlightPlan, departureFreqMhz: number | null): Clearance {
  return {
    callsign: fp.callsign,
    clearanceLimit: fp.destination,
    route: fp.sid ? `${fp.sid} departure, then as filed` : 'as filed',
    initialAltitudeFt: fp.initialAltitudeFt,
    cruiseAltitudeFt: fp.cruiseAltitudeFt,
    departureFreqMhz,
    squawk: allocateSquawk(),
  };
}

export class ClearanceDelivery {
  private state: State = 'idle';
  private clearance: Clearance | null = null;
  private readonly stationLabel: string;
  private readonly deliveryFreq: number | null;
  private readonly groundFreq: number | null;
  private readonly destName: string;
  private readonly spokenCs: string;

  constructor(
    private fp: FlightPlan,
    private nav: Navdata,
    private llm: LlmClient | null,
    private strictness: StrictnessLevel = 'normal',
  ) {
    const originApt = nav.getAirport(fp.origin);
    this.stationLabel = `${shortenAirportName(originApt?.name, fp.origin)} Delivery`;
    this.deliveryFreq = nav.getDeliveryFrequency(fp.origin);
    this.groundFreq = nav.getGroundFrequency(fp.origin);
    const destApt = nav.getAirport(fp.destination);
    this.destName = shortenAirportName(destApt?.name, fp.destination);
    this.spokenCs = spokenFlightCallsign(fp);
  }

  async handle(pilotText: string): Promise<Reply> {
    if (this.state === 'awaiting_readback') return this.handleReadback(pilotText);

    const intent = await parseIntent(pilotText, this.llm);
    switch (intent.intent) {
      case 'request_ifr_clearance':
        return this.issueClearance();
      case 'request_pushback':
      case 'request_taxi':
        return this.say('for taxi, contact ground.', 'none');
      default:
        return this.say('say again your request.', 'none');
    }
  }

  private issueClearance(): Reply {
    const c = buildClearance(this.fp, this.nav.getDepartureFrequency(this.fp.origin));
    this.clearance = c;
    this.state = 'awaiting_readback';

    const routePhrase = c.route === 'as filed' ? this.destName : `${this.destName} via ${c.route}`;
    const filed = c.route === 'as filed' ? ' as filed' : '';
    const parts = [
      `${this.spokenCs}, cleared to ${routePhrase}${filed}.`,
      `Climb and maintain ${spokenAltitude(c.initialAltitudeFt)}, expect ${spokenAltitude(c.cruiseAltitudeFt)}, one zero minutes after departure.`,
    ];
    if (c.departureFreqMhz) {
      parts.push(`Departure frequency ${spokenFreq(c.departureFreqMhz)}.`);
    }
    parts.push(`Squawk ${spokenDigits(c.squawk)}.`);

    return { from: this.stationLabel, freqMhz: this.deliveryFreq, text: parts.join(' '), expecting: 'readback' };
  }

  private handleReadback(pilotText: string): Reply {
    const c = this.clearance;
    if (!c) return this.say('say again your request.', 'none');

    const items = readbackItems({ altitudeFt: c.initialAltitudeFt, squawk: c.squawk });
    const res = checkReadback(pilotText, items, this.strictness);
    if (res.ok) {
      this.state = 'complete';
      const ground = this.groundFreq ? ` on ${spokenFreq(this.groundFreq)}` : '';
      return {
        from: this.stationLabel,
        freqMhz: this.deliveryFreq,
        text: `${this.spokenCs}, readback correct. Contact ground${ground} when ready for taxi.`,
        expecting: 'none',
        handoff: 'ground',
      };
    }

    return {
      from: this.stationLabel,
      freqMhz: this.deliveryFreq,
      text: `${this.spokenCs}, negative. I say again: ${correctionPhrase(res.missed)}. Read back.`,
      expecting: 'readback',
    };
  }

  private say(message: string, expecting: 'readback' | 'none'): Reply {
    return { from: this.stationLabel, freqMhz: this.deliveryFreq, text: `${this.spokenCs}, ${message}`, expecting };
  }
}
