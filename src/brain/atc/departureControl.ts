// Departure control: radar identifies the climbing aircraft, climbs it, hands off to Center.
import type { FlightPlan, Reply } from '../types.js';
import type { Navdata } from '../navdata/navdata.js';
import type { LlmClient } from '../llm/ollama.js';
import { spokenAltitude, shortenAirportName } from '../util/phraseology.js';
import { spokenFlightCallsign } from '../util/aircraft.js';

type State = 'idle' | 'climbing' | 'complete';

export class DepartureControl {
  private state: State = 'idle';
  private readonly stationLabel: string;
  private readonly freq: number | null;
  private readonly spokenCs: string;

  constructor(private fp: FlightPlan, private nav: Navdata, _llm: LlmClient | null) {
    const apt = nav.getAirport(fp.origin);
    this.stationLabel = `${shortenAirportName(apt?.name, fp.origin)} Departure`;
    this.freq = nav.getDepartureFrequency(fp.origin);
    this.spokenCs = spokenFlightCallsign(fp);
  }

  async handle(_pilotText: string): Promise<Reply> {
    if (this.state === 'idle') {
      this.state = 'climbing';
      return {
        from: this.stationLabel,
        freqMhz: this.freq,
        text: `${this.spokenCs}, radar contact. Climb and maintain ${spokenAltitude(this.fp.cruiseAltitudeFt)}.`,
        expecting: 'none',
      };
    }
    this.state = 'complete';
    return {
      from: this.stationLabel,
      freqMhz: this.freq,
      text: `${this.spokenCs}, contact center.`,
      expecting: 'none',
      handoff: 'center',
    };
  }
}
