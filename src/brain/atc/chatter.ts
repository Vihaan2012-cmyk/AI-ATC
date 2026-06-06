// Ambient radio chatter: plausible background transmissions from other (synthetic) traffic
// on the current frequency. Adds life to the channel without affecting the player's flight.
// Deterministic phrase templates; the controller kind biases what kind of calls appear.
import { spokenCallsign, spokenRunway, spokenAltitude, spokenDigits } from '../util/phraseology.js';

export type ChatterLevel = 'off' | 'low' | 'medium' | 'high';
export type ChatterKind = 'delivery' | 'ground' | 'tower' | 'departure' | 'center' | 'approach';

// Mean seconds between chatter transmissions per level.
const PERIOD_SEC: Record<ChatterLevel, number> = { off: 0, low: 90, medium: 50, high: 28 };

const FLEET = ['UAL482', 'DAL1190', 'AAL735', 'SWA2241', 'ASA619', 'JBU904', 'SKW3380', 'FFT512', 'NKS221', 'ACA1208'];

interface ChatterLine { from: string; text: string; }

function pick<T>(arr: T[], n: number): T { return arr[((n % arr.length) + arr.length) % arr.length]!; }

/**
 * Build one ambient transmission appropriate to the controller position.
 * `n` is a rolling counter that varies the output deterministically (no Math.random).
 */
function line(kind: ChatterKind, rwy: string | null, n: number): ChatterLine {
  const cs = pick(FLEET, n);
  const spoken = spokenCallsign(cs);
  const rw = rwy ? spokenRunway(rwy) : 'two seven';
  const alt = spokenAltitude(2000 + (n % 9) * 1000);
  const sq = spokenDigits(String(1200 + (n * 37) % 6000).padStart(4, '0'));
  switch (kind) {
    case 'delivery': return pick([
      { from: cs, text: `Clearance, ${spoken}, requesting IFR clearance.` },
      { from: 'Delivery', text: `${spoken}, cleared as filed, squawk ${sq}.` },
      { from: cs, text: `${spoken}, with you, ready to copy.` },
    ], n);
    case 'ground': return pick([
      { from: cs, text: `Ground, ${spoken}, request taxi.` },
      { from: 'Ground', text: `${spoken}, taxi to the runway via Alpha.` },
      { from: cs, text: `${spoken}, holding short runway ${rw}.` },
    ], n);
    case 'tower': return pick([
      { from: 'Tower', text: `${spoken}, runway ${rw}, cleared for takeoff.` },
      { from: cs, text: `${spoken}, rolling, runway ${rw}.` },
      { from: 'Tower', text: `${spoken}, runway ${rw}, cleared to land.` },
      { from: cs, text: `${spoken}, going around.` },
    ], n);
    case 'departure': return pick([
      { from: cs, text: `Departure, ${spoken}, ${alt} climbing.` },
      { from: 'Departure', text: `${spoken}, radar contact, climb and maintain ${alt}.` },
    ], n);
    case 'center': return pick([
      { from: 'Center', text: `${spoken}, contact next center, good day.` },
      { from: cs, text: `${spoken}, level ${alt}.` },
      { from: 'Center', text: `${spoken}, descend and maintain ${alt}.` },
    ], n);
    case 'approach': return pick([
      { from: 'Approach', text: `${spoken}, turn left heading two seven zero, descend ${alt}.` },
      { from: cs, text: `${spoken}, established on the localizer runway ${rw}.` },
      { from: 'Approach', text: `${spoken}, contact tower, good day.` },
    ], n);
    default: return { from: cs, text: `${spoken}, roger.` };
  }
}

export class ChatterGenerator {
  private n = 7;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private level: ChatterLevel = 'low') {}

  get active(): boolean { return this.level !== 'off'; }

  /** Start emitting chatter for the current kind/runway. onLine receives each transmission. */
  start(getKind: () => ChatterKind, getRunway: () => string | null, onLine: (l: ChatterLine) => void): () => void {
    if (!this.active) return () => {};
    const base = PERIOD_SEC[this.level] * 1000;
    const schedule = () => {
      // Jitter 0.6x–1.4x the mean, deterministically from the counter.
      const jitter = 0.6 + ((this.n * 53) % 80) / 100;
      this.timer = setTimeout(() => {
        this.n += 1;
        try { onLine(line(getKind(), getRunway(), this.n)); } catch { /* ignore */ }
        schedule();
      }, Math.max(8000, base * jitter));
    };
    schedule();
    return () => this.stop();
  }

  stop(): void { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
}
