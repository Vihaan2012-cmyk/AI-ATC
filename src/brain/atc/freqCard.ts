// Airport frequency reference card builder.
// Deterministic grouping and labeling of frequencies by type.

export interface FreqCardEntry {
  label: string;
  mhz: string;
}

/**
 * Build a frequency reference card by grouping frequencies by type.
 * Applies sensible labels and ordering (ATIS, Clearance, Ground, Tower,
 * Approach, Departure, Center) and formats MHz to 3 decimals.
 *
 * @param freqs Array of frequency records with type and mhz
 * @returns Array of labeled frequency entries, sorted by canonical order
 */
export function buildFreqCard(
  freqs: Array<{ type: string; mhz: number; name?: string }>
): FreqCardEntry[] {
  // Canonical type ordering and labels
  const typeOrder: Record<string, { label: string; order: number }> = {
    ATIS: { label: 'ATIS', order: 1 },
    ATI: { label: 'ATIS', order: 1 },
    CLD: { label: 'Clearance', order: 2 },
    CLR: { label: 'Clearance', order: 2 },
    GND: { label: 'Ground', order: 3 },
    TWR: { label: 'Tower', order: 4 },
    APP: { label: 'Approach', order: 5 },
    APR: { label: 'Approach', order: 5 },
    DEP: { label: 'Departure', order: 6 },
    CTR: { label: 'Center', order: 7 },
    RDO: { label: 'Radio', order: 8 },
    FIS: { label: 'Flight Info', order: 9 },
  };

  // Group by type
  const groups: Map<string, { label: string; order: number; mhzList: number[] }> = new Map();

  for (const freq of freqs) {
    const typeUpper = freq.type.toUpperCase();
    const info = typeOrder[typeUpper];

    if (info) {
      const key = info.label;
      if (!groups.has(key)) {
        groups.set(key, {
          label: info.label,
          order: info.order,
          mhzList: [],
        });
      }
      groups.get(key)!.mhzList.push(freq.mhz);
    }
  }

  // Build results, sorting by order
  const result: FreqCardEntry[] = [];
  const sortedGroups = Array.from(groups.values()).sort((a, b) => a.order - b.order);

  for (const group of sortedGroups) {
    // Deduplicate and sort frequencies within each group
    const unique = Array.from(new Set(group.mhzList)).sort((a, b) => a - b);

    for (const mhz of unique) {
      result.push({
        label: group.label,
        mhz: formatMhz(mhz),
      });
    }
  }

  return result;
}

/**
 * Format a frequency to 3 decimal places, e.g. 118.025, 121.700.
 */
function formatMhz(mhz: number): string {
  return mhz.toFixed(3);
}
