// Terminal Aerodrome Forecast (TAF) from the NOAA Aviation Weather Center (no API key needed).
// Provides trend analysis of expected weather changes.

export interface TafInfo {
  icao: string;
  raw: string;
  trend: string;
}

/**
 * Fetches TAF for a single ICAO code from aviationweather.gov.
 * Returns raw TAF string or null if unavailable.
 */
export async function fetchTaf(icao: string): Promise<string | null> {
  if (!icao) return null;
  try {
    const res = await fetch(
      `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(icao)}&format=json`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ icaoId?: string; rawTAF?: string }>;
    if (!arr || arr.length === 0) return null;
    const taf = arr[0];
    return taf?.rawTAF ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort parser: extracts one-line plain-English trend from raw TAF.
 * Returns strings like "improving", "deteriorating", "VFR throughout", or "unknown trend".
 */
export function parseTafTrend(raw: string | null | undefined): string {
  if (!raw) return 'unknown trend';

  // Count VFR vs IFR/MVFR/LIFR conditions across the forecast
  let vfrCount = 0;
  let ifrCount = 0;
  let hasImprovement = false;
  let hasDeterioration = false;

  // Look for explicit BECMG or TEMPO transitions
  if (/BECMG.*(?:VFR|SKC|CLR|CAVOK)/i.test(raw)) hasImprovement = true;
  if (/BECMG.*(?:OVC|BKN|\+RA|\+SN|RA)/i.test(raw)) hasDeterioration = true;

  // Count conditions: simple heuristic
  // VFR indicators: SKC, CLR, CAVOK, or ceilings >3000 and visibility >5SM
  vfrCount = (raw.match(/\b(SKC|CLR|CAVOK)\b/gi) || []).length;
  if (/(?:BKN|OVC)(\d{3})\b/.test(raw)) {
    const m = raw.match(/(?:BKN|OVC)(\d{3})\b/);
    if (m && Number(m[1]) > 30) vfrCount++; // >3000 ft is VFR ceiling
  }

  // IFR indicators: low ceilings (<1000 ft), low vis, or precip
  ifrCount = (raw.match(/\b(?:FG|FZFG|\+RA|\+SN|BR)\b/gi) || []).length;
  if (/(OVC|BKN)(\d{3})/.test(raw)) {
    const m = raw.match(/(OVC|BKN)(\d{3})/);
    if (m && Number(m[2]) <= 10) ifrCount++; // <=1000 ft is IFR
  }

  // Decide trend
  if (hasImprovement && !hasDeterioration) return 'improving';
  if (hasDeterioration && !hasImprovement) return 'deteriorating';
  if (vfrCount >= 2 && ifrCount === 0) return 'VFR throughout';
  if (ifrCount >= 2 && vfrCount === 0) return 'IFR conditions expected';
  if (hasImprovement && hasDeterioration) return 'variable conditions';

  // Fallback to simple heuristic
  if (vfrCount > ifrCount) return 'mostly VFR';
  if (ifrCount > vfrCount) return 'IFR expected';
  return 'mixed conditions';
}

/**
 * Convenience: fetch TAF and parse trend in one call.
 */
export async function fetchTafTrend(icao: string): Promise<string | null> {
  const taf = await fetchTaf(icao);
  if (!taf) return null;
  return parseTafTrend(taf);
}
