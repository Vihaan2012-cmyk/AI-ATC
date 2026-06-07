// Tower control: hold-short sequencing (departure), land-behind sequencing (arrival), and handoff to departure.
import type { FlightPlan, Reply } from '../types.js';
import type { Navdata } from '../navdata/navdata.js';
import type { LlmClient } from '../llm/ollama.js';
import { parseIntent } from '../llm/nlu.js';
import { spokenFreq, spokenRunway, shortenAirportName } from '../util/phraseology.js';
import { spokenFlightCallsign } from '../util/aircraft.js';
import { makeSequence, sequencePhrase } from './traffic.js';
import { composeConditionalClause, hasTrafficInSight } from './conditional.js';

type State = 'idle' | 'awaiting_takeoff_readback' | 'landing' | 'complete';

function runwayKey(s: string): string {
  return s.toUpperCase().replace(/[^0-9LCR]/g, '');
}

export class TowerControl {
  private state: State = 'idle';
  private readonly stationLabel: string;
  private readonly towerFreq: number | null;
  private readonly departureFreq: number | null;
  private readonly approachFreq: number | null;
  private readonly groundFreq: number | null;
  private readonly runway: string | null;
  private readonly spokenCs: string;
  /** Set once we've issued a hold-short for sequencing, so the next call clears. */
  private sequenced = false;

  constructor(
    private fp: FlightPlan,
    private nav: Navdata,
    private llm: LlmClient | null,
    private airport: string = fp.origin,
    private mode: 'departure' | 'arrival' = 'departure',
  ) {
    const apt = nav.getAirport(airport);
    this.stationLabel = `${shortenAirportName(apt?.name, airport)} Tower`;
    this.towerFreq = nav.getTowerFrequency(airport);
    this.departureFreq = nav.getDepartureFrequency(airport);
    this.approachFreq = nav.getApproachFrequency(airport);
    this.groundFreq = nav.getGroundFrequency(airport);
    this.runway = mode === 'departure'
      ? (fp.departureRunway ?? null)
      : (nav.getRunways(airport)[0] ?? null);
    this.spokenCs = spokenFlightCallsign(fp);
  }

  async handle(pilotText: string): Promise<Reply> {
    const intent = await parseIntent(pilotText, this.llm);

    // Pattern work (VFR closed traffic / touch-and-go) — handled in either mode.
    if (intent.intent === 'request_pattern') return this.clearPattern();
    if (intent.intent === 'touch_and_go') return this.clearTouchAndGo();

    if (this.mode === 'arrival') return this.handleArrival(pilotText);
    if (this.state === 'awaiting_takeoff_readback') return this.handleTakeoffReadback(pilotText);
    if (this.state === 'complete') return this.handoffToDeparture();

    if (intent.intent === 'ready_for_departure' || /\b(ready|holding short|linedup|line up|takeoff)\b/i.test(pilotText)) {
      return this.issueTakeoff(pilotText);
    }
    return this.say('report ready for departure.', 'none');
  }

  // --- VFR pattern work ---
  private clearPattern(): Reply {
    const rwy = this.runway ? `runway ${spokenRunway(this.runway)}` : 'the active runway';
    const seq = makeSequence(this.airport, this.fp.callsign, 'arrival');
    const seqText = seq.number > 1 && seq.ahead ? `${sequencePhrase(seq).trim()} ` : '';
    const enter = `Enter left downwind ${rwy}, report midfield. Cleared for the option.`;
    // If a sequence sentence precedes, lowercase the lead-in so it reads naturally.
    return this.say(`${seqText}${seqText ? enter.charAt(0).toLowerCase() + enter.slice(1) : enter}`, 'none');
  }

  private clearTouchAndGo(): Reply {
    const rwy = this.runway ? `Runway ${spokenRunway(this.runway)}, ` : '';
    return this.say(`${rwy}cleared touch and go. Make left traffic, report downwind.`, 'none');
  }

  // --- departure ---
  private issueTakeoff(pilotText: string): Reply {
    const rwy = this.runway ? `Runway ${spokenRunway(this.runway)}, ` : '';
    // First "ready" with traffic ahead -> hold short + sequence. The traffic clears,
    // then the pilot's next "ready" call gets the actual takeoff clearance.
    if (!this.sequenced) {
      const seq = makeSequence(this.airport, this.fp.callsign, 'departure');
      if (seq.number > 1 && seq.ahead) {
        this.sequenced = true;
        return {
          from: this.stationLabel, freqMhz: this.towerFreq,
          text: `${this.spokenCs}, ${rwy}hold short.${sequencePhrase(seq)} Advise ready when the traffic is clear.`,
          expecting: 'readback',
        };
      }
      this.sequenced = true;
    }
    // Second "ready" after hold-short. If pilot reports traffic in sight, issue conditional clearance.
    if (hasTrafficInSight(pilotText)) {
      const seq = makeSequence(this.airport, this.fp.callsign, 'departure');
      if (seq.ahead) {
        this.state = 'awaiting_takeoff_readback';
        const conditional = composeConditionalClause(seq.ahead, 'takeoff');
        return { from: this.stationLabel, freqMhz: this.towerFreq, text: `${this.spokenCs}, ${rwy}${conditional}.`, expecting: 'readback' };
      }
    }
    this.state = 'awaiting_takeoff_readback';
    return { from: this.stationLabel, freqMhz: this.towerFreq, text: `${this.spokenCs}, ${rwy}cleared for takeoff.`, expecting: 'readback' };
  }

  private handleTakeoffReadback(pilotText: string): Reply {
    const runwayOk = !this.runway || runwayKey(pilotText).includes(runwayKey(this.runway));
    if (runwayOk || /takeoff|behind/.test(pilotText)) {
      this.state = 'complete';
      return this.handoffToDeparture();
    }
    const rwy = this.runway ? `Runway ${spokenRunway(this.runway)}, ` : '';
    return { from: this.stationLabel, freqMhz: this.towerFreq, text: `${this.spokenCs}, negative. I say again: ${rwy}cleared for takeoff. Read back.`, expecting: 'readback' };
  }

  private handoffToDeparture(): Reply {
    const dep = this.departureFreq ? ` on ${spokenFreq(this.departureFreq)}` : '';
    return { from: this.stationLabel, freqMhz: this.towerFreq, text: `${this.spokenCs}, contact departure${dep} airborne.`, expecting: 'none', handoff: 'departure' };
  }

  // --- arrival ---
  private handleArrival(pilotText: string): Reply {
    if (/go.?around|going around|missed approach/i.test(pilotText)) {
      this.state = 'idle';
      const app = this.approachFreq ? ` on ${spokenFreq(this.approachFreq)}` : '';
      return {
        from: this.stationLabel,
        freqMhz: this.towerFreq,
        text: `${this.spokenCs}, roger, go around. Fly runway heading, climb and maintain three thousand. Contact approach${app}.`,
        expecting: 'none',
        handoff: 'approach',
      };
    }
    if (this.state === 'idle') {
      this.state = 'landing';
      const rwy = this.runway ? `Runway ${spokenRunway(this.runway)}, ` : '';
      const seq = makeSequence(this.airport, this.fp.callsign, 'arrival');
      // If pilot reports traffic in sight during sequencing, use conditional phrasing.
      if (seq.number > 1 && seq.ahead && hasTrafficInSight(pilotText)) {
        const conditional = composeConditionalClause(seq.ahead, 'landing');
        return { from: this.stationLabel, freqMhz: this.towerFreq, text: `${this.spokenCs}, ${rwy}${conditional}.`, expecting: 'none' };
      }
      // Sequenced behind arriving traffic but still cleared to land (US-style "number two, cleared to land").
      const seqText = seq.number > 1 && seq.ahead
        ? `${sequencePhrase(seq).trim()} ${this.spokenCs}, ${rwy}cleared to land.`
        : `${this.spokenCs}, ${rwy}cleared to land.`;
      return { from: this.stationLabel, freqMhz: this.towerFreq, text: seqText, expecting: 'none' };
    }
    // after landing: send to ground
    this.state = 'complete';
    const gnd = this.groundFreq ? ` on ${spokenFreq(this.groundFreq)}` : '';
    return { from: this.stationLabel, freqMhz: this.towerFreq, text: `${this.spokenCs}, welcome. Contact ground${gnd}.`, expecting: 'none', handoff: 'ground' };
  }

  private say(message: string, expecting: 'readback' | 'none'): Reply {
    return { from: this.stationLabel, freqMhz: this.towerFreq, text: `${this.spokenCs}, ${message}`, expecting };
  }
}
