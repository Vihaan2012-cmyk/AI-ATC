// Ground control. Departure role: pushback + taxi-to-runway, hand off to Tower.
// Arrival role (after landing): taxi to parking — end of flight.
import type { FlightPlan, Reply } from '../types.js';
import type { Navdata } from '../navdata/navdata.js';
import type { LlmClient } from '../llm/ollama.js';
import { parseIntent } from '../llm/nlu.js';
import { spokenFreq, spokenRunway, shortenAirportName } from '../util/phraseology.js';
import { spokenFlightCallsign } from '../util/aircraft.js';

type State = 'idle' | 'pushback' | 'awaiting_taxi_readback' | 'complete';

/** Ground layout the controller can route over (subset of SimClient's GroundLayout). */
export interface GroundLayout {
  parking: { name: string; kind: string }[];
  taxiways: string[];
}

function runwayKey(s: string): string {
  return s.toUpperCase().replace(/[^0-9LCR]/g, '');
}

/** Pick up to `n` taxiway names as a plausible route and phrase them: "via Alpha, Bravo". */
function taxiRoutePhrase(taxiways: string[], seed: number, n = 2): string {
  const usable = taxiways.filter((t) => /^[A-Z]{1,2}\d?$/.test(t));
  if (usable.length === 0) return '';
  const chosen: string[] = [];
  for (let i = 0; i < Math.min(n, usable.length); i++) {
    chosen.push(usable[(seed + i * 3) % usable.length]!);
  }
  const spoken = chosen.map(spokenTaxiway).join(', ');
  return ` via ${spoken}`;
}

const NATO: Record<string, string> = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot',
  G: 'Golf', H: 'Hotel', J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike',
  N: 'November', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango',
  U: 'Uniform', V: 'Victor', W: 'Whiskey', Y: 'Yankee', Z: 'Zulu',
};
export function spokenTaxiway(name: string): string {
  return name.split('').map((c) => NATO[c] ?? c).join(' ');
}

export class GroundControl {
  private state: State = 'idle';
  private readonly stationLabel: string;
  private readonly groundFreq: number | null;
  private readonly towerFreq: number | null;
  private readonly runway: string | null;
  private readonly destName: string;
  private readonly spokenCs: string;
  private readonly seed: number;

  constructor(
    private fp: FlightPlan,
    private nav: Navdata,
    private llm: LlmClient | null,
    private airport: string = fp.origin,
    private mode: 'departure' | 'arrival' = 'departure',
    private ground: GroundLayout | null = null,
  ) {
    const apt = nav.getAirport(airport);
    this.stationLabel = `${shortenAirportName(apt?.name, airport)} Ground`;
    this.destName = shortenAirportName(apt?.name, airport);
    this.groundFreq = nav.getGroundFrequency(airport);
    this.towerFreq = nav.getTowerFrequency(airport);
    this.runway = fp.departureRunway ?? null;
    this.spokenCs = spokenFlightCallsign(fp);
    this.seed = Math.abs([...fp.callsign].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0));
  }

  /** Pick a believable gate/stand for arrival from the real ground layout, if available. */
  private assignGate(): string | null {
    const gates = this.ground?.parking.filter((p) => p.kind === 'GATE') ?? [];
    const pool = gates.length > 0 ? gates : (this.ground?.parking ?? []);
    if (pool.length === 0) return null;
    return pool[this.seed % pool.length]!.name;
  }

  async handle(pilotText: string): Promise<Reply> {
    if (this.mode === 'arrival') return this.handleArrival();
    if (this.state === 'awaiting_taxi_readback') return this.handleTaxiReadback(pilotText);

    const intent = await parseIntent(pilotText, this.llm);
    switch (intent.intent) {
      case 'request_pushback':
        this.state = 'pushback';
        return this.say('push and start approved. Advise ready to taxi.', 'none');
      case 'request_taxi':
        return this.issueTaxi();
      case 'request_ifr_clearance':
        return this.say('clearance is with delivery. Advise ready to taxi.', 'none');
      default:
        if (/\bready\b/i.test(pilotText)) return this.issueTaxi();
        return this.say('say again your request.', 'none');
    }
  }

  private handleArrival(): Reply {
    this.state = 'complete';
    const gate = this.assignGate();
    const route = this.ground ? taxiRoutePhrase(this.ground.taxiways, this.seed) : '';
    const dest = gate ? `taxi to ${gate}${route}.` : 'taxi to parking.';
    return {
      from: this.stationLabel,
      freqMhz: this.groundFreq,
      text: `${this.spokenCs}, ${dest} Welcome to ${this.destName}.`,
      expecting: 'none',
    };
  }

  private issueTaxi(): Reply {
    this.state = 'awaiting_taxi_readback';
    const route = this.ground ? taxiRoutePhrase(this.ground.taxiways, this.seed) : '';
    const rwyPhrase = this.runway
      ? `Runway ${spokenRunway(this.runway)}, taxi to the runway${route}.`
      : `Taxi to the active runway${route}.`;
    return { from: this.stationLabel, freqMhz: this.groundFreq, text: `${this.spokenCs}, ${rwyPhrase}`, expecting: 'readback' };
  }

  private handleTaxiReadback(pilotText: string): Reply {
    const runwayOk = !this.runway || runwayKey(pilotText).includes(runwayKey(this.runway));
    if (runwayOk) {
      this.state = 'complete';
      const tower = this.towerFreq ? ` on ${spokenFreq(this.towerFreq)}` : '';
      return {
        from: this.stationLabel,
        freqMhz: this.groundFreq,
        text: `${this.spokenCs}, readback correct. Contact tower${tower} when ready for departure.`,
        expecting: 'none',
        handoff: 'tower',
      };
    }
    const rwy = this.runway ? `Runway ${spokenRunway(this.runway)}, ` : '';
    return {
      from: this.stationLabel,
      freqMhz: this.groundFreq,
      text: `${this.spokenCs}, negative. I say again: ${rwy}taxi to the runway. Read back.`,
      expecting: 'readback',
    };
  }

  private say(message: string, expecting: 'readback' | 'none'): Reply {
    return { from: this.stationLabel, freqMhz: this.groundFreq, text: `${this.spokenCs}, ${message}`, expecting };
  }
}
