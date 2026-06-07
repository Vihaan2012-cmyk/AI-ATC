// Approach control (at destination): radar-vectors the arrival onto the final approach
// course with a sequence of heading/altitude/speed instructions, checks readbacks, clears
// the approach, then hands off to Tower. Vectors are derived from the landing runway so the
// turn-to-final geometry is plausible. Engine-authoritative; the LLM is not consulted here.
import type { FlightPlan, Reply } from '../types.js';
import type { Navdata } from '../navdata/navdata.js';
import type { LlmClient } from '../llm/ollama.js';
import { spokenAltitude, spokenDigits, spokenFreq, spokenRunway, shortenAirportName } from '../util/phraseology.js';
import { spokenFlightCallsign } from '../util/aircraft.js';
import { readbackItems, checkReadback, correctionPhrase, type StrictnessLevel } from './compliance.js';

type Step = 'descend' | 'downwind' | 'base' | 'final' | 'cleared' | 'done';

interface Vector {
  headingDeg?: number;
  altitudeFt?: number;
  speedKt?: number;
}

function runwayHeading(rwy: string | null): number {
  if (!rwy) return 360;
  const n = parseInt(rwy, 10);
  return Number.isFinite(n) ? ((n * 10) || 360) : 360;
}
function norm360(d: number): number {
  return ((Math.round(d) % 360) + 360) % 360 || 360;
}

export class ApproachControl {
  private step: Step = 'descend';
  private readonly stationLabel: string;
  private readonly freq: number | null;
  private readonly towerFreq: number | null;
  private readonly runway: string | null;
  private readonly star: string | null;
  private readonly spokenCs: string;
  private readonly rwyHdg: number;
  /** Items the pilot must read back for the instruction we just issued. */
  private pendingItems = readbackItems({});

  constructor(
    private fp: FlightPlan,
    private nav: Navdata,
    _llm: LlmClient | null,
    private strictness: StrictnessLevel = 'normal',
  ) {
    const apt = nav.getAirport(fp.destination);
    this.stationLabel = `${shortenAirportName(apt?.name, fp.destination)} Approach`;
    this.freq = nav.getApproachFrequency(fp.destination);
    this.towerFreq = nav.getTowerFrequency(fp.destination);
    // Prefer the OFP's planned arrival runway; fall back to the first nav runway.
    this.runway = fp.arrivalRunway ?? nav.getRunways(fp.destination)[0] ?? null;
    this.star = fp.star ?? null;
    this.spokenCs = spokenFlightCallsign(fp);
    this.rwyHdg = runwayHeading(this.runway);
  }

  async handle(pilotText: string): Promise<Reply> {
    // If we're awaiting a readback for the previous vector, validate it first.
    if (this.pendingItems.length > 0) {
      const res = checkReadback(pilotText, this.pendingItems, this.strictness);
      if (!res.ok) {
        return this.reply(`I say again: ${correctionPhrase(res.missed)}. Read back.`, 'readback', this.pendingItems);
      }
      this.pendingItems = readbackItems({});
    }

    switch (this.step) {
      case 'descend': return this.descend();
      case 'downwind': return this.vectorDownwind();
      case 'base': return this.vectorBase();
      case 'final': return this.vectorFinal();
      case 'cleared': return this.clearApproach();
      default: return this.reply('maintain present heading.', 'none', []);
    }
  }

  private descend(): Reply {
    this.step = 'downwind';
    const v: Vector = { altitudeFt: 5000 };
    const star = this.star ? ` Descend via the ${this.star} arrival.` : '';
    const rwy = this.runway ? ` Expect I-L-S runway ${spokenRunway(this.runway)}.` : '';
    return this.vectorReply(`radar contact. Descend and maintain ${spokenAltitude(v.altitudeFt!)}.${star}${rwy}`, v);
  }

  private vectorDownwind(): Reply {
    this.step = 'base';
    // Downwind: parallel-reciprocal to the runway heading, on the (left) downwind side.
    const v: Vector = { headingDeg: norm360(this.rwyHdg + 180 + 30), altitudeFt: 4000, speedKt: 250 };
    return this.vectorReply(this.vectorText(v, 'fly downwind'), v);
  }

  private vectorBase(): Reply {
    this.step = 'final';
    const v: Vector = { headingDeg: norm360(this.rwyHdg - 90), altitudeFt: 3000, speedKt: 210 };
    return this.vectorReply(this.vectorText(v, 'turn base'), v);
  }

  private vectorFinal(): Reply {
    this.step = 'cleared';
    // Intercept heading ~30° off the final approach course.
    const v: Vector = { headingDeg: norm360(this.rwyHdg - 30), altitudeFt: 2000, speedKt: 180 };
    const tail = this.runway ? ` to intercept the runway ${spokenRunway(this.runway)} localizer.` : ' to intercept the localizer.';
    return this.vectorReply(this.vectorText(v, 'turn').replace(/\.$/, '') + tail, v);
  }

  private clearApproach(): Reply {
    this.step = 'done';
    this.pendingItems = readbackItems({});
    const rwy = this.runway ? `runway ${spokenRunway(this.runway)} ` : '';
    const twr = this.towerFreq ? ` on ${spokenFreq(this.towerFreq)}` : '';
    return {
      from: this.stationLabel,
      freqMhz: this.freq,
      text: `${this.spokenCs}, cleared I-L-S ${rwy}approach. Contact tower${twr}.`,
      expecting: 'none',
      handoff: 'tower',
    };
  }

  // Compose the spoken vector and remember what must be read back.
  private vectorText(v: Vector, turnVerb: string): string {
    const parts: string[] = [];
    if (v.headingDeg != null) parts.push(`${turnVerb}, heading ${spokenDigits(String(v.headingDeg).padStart(3, '0'))}`);
    if (v.altitudeFt != null) parts.push(`descend and maintain ${spokenAltitude(v.altitudeFt)}`);
    if (v.speedKt != null) parts.push(`reduce speed to ${v.speedKt} knots`);
    return parts.join(', ') + '.';
  }

  private vectorReply(message: string, v: Vector): Reply {
    this.pendingItems = readbackItems({ altitudeFt: v.altitudeFt ?? null, headingDeg: v.headingDeg ?? null, speedKt: v.speedKt ?? null });
    return { from: this.stationLabel, freqMhz: this.freq, text: `${this.spokenCs}, ${message}`, expecting: 'readback' };
  }

  private reply(message: string, expecting: 'readback' | 'none', items: typeof this.pendingItems): Reply {
    this.pendingItems = items;
    return { from: this.stationLabel, freqMhz: this.freq, text: `${this.spokenCs}, ${message}`, expecting };
  }
}
