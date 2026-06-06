// Hoppie ACARS / CPDLC datalink client.
// Hoppie's network is a simple HTTP API: GET connect.html?logon=&from=&to=&type=&packet=
// We use it to (a) poll for inbound messages addressed to us, and (b) send telex/CPDLC.
// Requires a free Hoppie logon code (https://www.hoppie.nl/acars/). Optional feature.

const HOPPIE_URL = 'https://www.hoppie.nl/acars/system/connect.html';

export type HoppieType = 'telex' | 'cpdlc' | 'progress' | 'position' | 'ping' | 'poll';

export interface HoppieMessage {
  from: string;
  type: string;
  packet: string;
}

export interface HoppieDeps {
  logon: string;
  /** Our station id = the flight callsign (e.g. "SWA1234"). */
  callsign: string;
}

/** Low-level send. Returns the raw response text (Hoppie replies "ok" or "ok {…}"). */
async function send(logon: string, from: string, to: string, type: HoppieType, packet: string): Promise<string> {
  const params = new URLSearchParams({ logon, from, to, type, packet });
  const res = await fetch(`${HOPPIE_URL}?${params.toString()}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Hoppie HTTP ${res.status}`);
  return (await res.text()).trim();
}

/** Parse a poll response: "ok {CALLSIGN type {packet}} {CALLSIGN type {packet}}". */
function parsePoll(text: string): HoppieMessage[] {
  if (!text.startsWith('ok')) return [];
  const out: HoppieMessage[] = [];
  const re = /\{([A-Z0-9]+)\s+(\w+)\s+\{([^}]*)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ from: m[1] ?? '', type: m[2] ?? '', packet: m[3] ?? '' });
  }
  return out;
}

export class HoppieClient {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: HoppieDeps) {}

  get enabled(): boolean {
    return this.deps.logon.trim().length > 0;
  }

  /** Verify the logon by pinging the network. */
  async ping(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const r = await send(this.deps.logon, this.deps.callsign, 'SERVER', 'ping', '');
      return r.startsWith('ok');
    } catch {
      return false;
    }
  }

  /** Send a free-text (telex) message to a station, e.g. "KSEA" for clearance delivery. */
  async sendTelex(to: string, message: string): Promise<boolean> {
    if (!this.enabled) return false;
    const r = await send(this.deps.logon, this.deps.callsign, to.toUpperCase(), 'telex', message);
    return r.startsWith('ok');
  }

  /** Send a CPDLC message (e.g. a clearance request / response). */
  async sendCpdlc(to: string, packet: string): Promise<boolean> {
    if (!this.enabled) return false;
    const r = await send(this.deps.logon, this.deps.callsign, to.toUpperCase(), 'cpdlc', packet);
    return r.startsWith('ok');
  }

  /** Poll once for inbound messages addressed to our callsign. */
  async poll(): Promise<HoppieMessage[]> {
    if (!this.enabled) return [];
    const text = await send(this.deps.logon, this.deps.callsign, 'SERVER', 'poll', '');
    return parsePoll(text);
  }

  /** Start polling at an interval; calls onMessage for each inbound message. Returns a stop fn. */
  startPolling(onMessage: (m: HoppieMessage) => void, intervalMs = 20000): () => void {
    if (!this.enabled || this.timer) return () => {};
    const tick = async () => {
      try {
        const msgs = await this.poll();
        for (const m of msgs) onMessage(m);
      } catch { /* transient network error; keep polling */ }
    };
    this.timer = setInterval(tick, intervalMs);
    void tick();
    return () => this.stop();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
