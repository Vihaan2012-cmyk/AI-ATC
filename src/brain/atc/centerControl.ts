// Center (enroute) control: maintains cruise on check-in, then starts the descent
// and hands off to Approach on the next call (e.g. a descent request).
import type { FlightPlan, Reply } from '../types.js';
import type { Navdata } from '../navdata/navdata.js';
import type { LlmClient } from '../llm/ollama.js';
import { spokenAltitude, spokenFreq } from '../util/phraseology.js';
import { spokenFlightCallsign } from '../util/aircraft.js';

type State = 'idle' | 'cruise' | 'complete';

const INITIAL_DESCENT_FT = 11000;

export class CenterControl {
  private state: State = 'idle';
  private readonly spokenCs: string;
  private readonly approachFreq: number | null;

  constructor(private fp: FlightPlan, private nav: Navdata, _llm: LlmClient | null) {
    this.spokenCs = spokenFlightCallsign(fp);
    this.approachFreq = nav.getApproachFrequency(fp.destination);
  }

  async handle(_pilotText: string): Promise<Reply> {
    if (this.state === 'idle') {
      this.state = 'cruise';
      return {
        from: 'Center',
        freqMhz: null,
        text: `${this.spokenCs}, Center, radar contact. Maintain ${spokenAltitude(this.fp.cruiseAltitudeFt)}.`,
        expecting: 'none',
      };
    }
    this.state = 'complete';
    const app = this.approachFreq ? ` on ${spokenFreq(this.approachFreq)}` : '';
    const star = this.fp.star ? ` Expect the ${this.fp.star} arrival.` : '';
    return {
      from: 'Center',
      freqMhz: null,
      text: `${this.spokenCs}, descend and maintain ${spokenAltitude(INITIAL_DESCENT_FT)}.${star} Contact approach${app}.`,
      expecting: 'none',
      handoff: 'approach',
    };
  }
}
