// NOTAM / runway-closure simulation. A tiny deterministic generator that, given an airport and a
// day seed, may mark a runway closed or a taxiway restricted, so ATIS/clearance can mention it.
// Deterministic (seeded by ICAO + day) so a given session is consistent. No live NOTAM feed.

export interface Notam {
  /** Short ATIS-style text, e.g. "runway 16L closed", "taxiway B closed between A and C". */
  text: string;
  /** Affected runway ident, if any (so the runway picker can avoid it). */
  closedRunway?: string;
}

function seed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Generate zero or one NOTAM for an airport. `dayKey` is a stable per-day string (e.g. "2026-06-07")
 * passed in by the caller so it doesn't call Date itself. Most days return none.
 */
export function generateNotam(icao: string, runways: string[], dayKey: string): Notam | null {
  const h = seed(`${icao}|${dayKey}`);
  // ~1 in 4 days has a NOTAM, to keep it occasional.
  if (h % 4 !== 0) return null;
  const pick = h % 3;
  if (pick === 0 && runways.length > 1) {
    // Close one runway (never the only one).
    const rwy = runways[h % runways.length] ?? runways[0]!;
    return { text: `runway ${rwy} closed`, closedRunway: rwy };
  }
  if (pick === 1) {
    const tw = String.fromCharCode(65 + (h % 6)); // A..F
    return { text: `taxiway ${tw} closed, expect alternate routing` };
  }
  return { text: 'bird activity reported in the vicinity of the airport' };
}

/** Filter a runway list to exclude a NOTAM-closed runway. */
export function openRunways(runways: string[], notam: Notam | null): string[] {
  if (!notam?.closedRunway) return runways;
  const closed = notam.closedRunway.toUpperCase();
  const open = runways.filter((r) => r.toUpperCase() !== closed);
  return open.length ? open : runways; // never return empty
}
