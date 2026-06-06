// Live weather (METAR) from the NOAA Aviation Weather Center (no API key needed).
// Used for the info flyout and to give the AI weather awareness.

export interface MetarInfo {
  icao: string;
  raw: string;
  /** Parsed-ish hints for simple decisions (best-effort). */
  visibilityLow: boolean;
  ceilingLow: boolean;
}

function looksLowVis(raw: string): boolean {
  // crude: visibility under ~1SM or under 1600m, or fog/heavy precip
  if (/\b(FG|FZFG|\+RA|\+SN|BR)\b/.test(raw)) return true;
  const sm = raw.match(/\b(\d(?:\s\d\/\d)?|\d\/\d)SM\b/);
  if (sm && /^(0|1\/|1\b)/.test(sm[1] ?? '')) return true;
  const m = raw.match(/\s(\d{4})\s/);
  if (m && Number(m[1]) <= 1600) return true;
  return false;
}
function looksLowCeiling(raw: string): boolean {
  const m = raw.match(/\b(BKN|OVC)(\d{3})\b/);
  if (m) return Number(m[2]) <= 5; // <= 500 ft
  return false;
}

export interface MetarDetail {
  windDir: number | null;
  wind: string;
  vis: string;
  sky: string;
  temp: string;
  alt: string;
}

const SKY = { FEW: 'few clouds', SCT: 'scattered clouds', BKN: 'broken clouds', OVC: 'overcast' } as const;

/** Best-effort human-readable parse of a raw METAR (for ATIS). */
export function parseMetarDetail(raw: string | undefined): MetarDetail {
  const out: MetarDetail = { windDir: null, wind: '', vis: '', sky: '', temp: '', alt: '' };
  if (!raw) return out;
  const wind = raw.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  if (wind) {
    if (wind[1] === '00000' || (wind[1] === '000' && wind[2] === '00')) out.wind = 'wind calm';
    else {
      out.windDir = wind[1] === 'VRB' ? null : parseInt(wind[1]!, 10);
      const dir = wind[1] === 'VRB' ? 'variable' : `${wind[1]} degrees`;
      out.wind = `wind ${dir} at ${parseInt(wind[2]!, 10)} knots${wind[3] ? `, gusting ${parseInt(wind[3], 10)}` : ''}`;
    }
  }
  if (/\b00000KT\b/.test(raw)) out.wind = 'wind calm';
  const visSm = raw.match(/\b(\d{1,2}(?:\s\d\/\d)?|\d\/\d)SM\b/);
  if (visSm) out.vis = `visibility ${visSm[1]} statute miles`;
  else { const m = raw.match(/\s(\d{4})\s/); if (m) out.vis = `visibility ${parseInt(m[1]!, 10)} meters`; }
  if (/\b(CAVOK|SKC|CLR|NSC)\b/.test(raw)) out.sky = 'sky clear';
  else {
    const layers = [...raw.matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3})\b/g)]
      .map((m) => `${SKY[m[1] as keyof typeof SKY]} at ${parseInt(m[2]!, 10) * 100} feet`);
    if (layers.length) out.sky = layers.join(', ');
  }
  const td = raw.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  if (td) out.temp = `temperature ${td[1]!.replace('M', 'minus ')}, dew point ${td[2]!.replace('M', 'minus ')}`;
  const a = raw.match(/\bA(\d{4})\b/);
  if (a) out.alt = `${a[1]!.slice(0, 2)}.${a[1]!.slice(2)}`;
  else { const q = raw.match(/\bQ(\d{4})\b/); if (q) out.alt = `Q${q[1]}`; }
  return out;
}

export async function fetchMetars(icaos: string[]): Promise<Record<string, MetarInfo>> {
  const ids = [...new Set(icaos.filter(Boolean))].join(',');
  if (!ids) return {};
  try {
    const res = await fetch(
      `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(ids)}&format=json`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return {};
    const arr = (await res.json()) as Array<{ icaoId?: string; rawOb?: string }>;
    const out: Record<string, MetarInfo> = {};
    for (const m of arr) {
      if (!m.icaoId || !m.rawOb) continue;
      out[m.icaoId] = { icao: m.icaoId, raw: m.rawOb, visibilityLow: looksLowVis(m.rawOb), ceilingLow: looksLowCeiling(m.rawOb) };
    }
    return out;
  } catch {
    return {};
  }
}
