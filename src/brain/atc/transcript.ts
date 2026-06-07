// Transcript export: formats ATC/pilot exchanges into shareable markdown.
// Pure function — no I/O, no side effects, deterministic output.

export interface TranscriptEntry {
  from?: string;        // 'Pilot', 'Delivery', 'Tower', etc.
  freq?: string | number; // Frequency in MHz (e.g. 119.3 or '119.3')
  text: string;         // The spoken text
  ts?: string;          // Timestamp (ISO 8601 or HHmm)
}

export interface TranscriptMetadata {
  callsign: string;     // Flight callsign, e.g. 'SWA1234'
  route: string;        // Route, e.g. 'KORD KJFK' or 'ORD-JFK'
  aircraft?: string;    // Aircraft type, e.g. 'B738'
  origin?: string;      // Origin ICAO
  destination?: string; // Destination ICAO
  flightRules?: string; // 'IFR' or 'VFR'
  cruiseAltFt?: number; // Cruise altitude in ft
  depTime?: string;     // Departure time (ISO 8601 or HHmm)
}

/**
 * Format ATC transcript entries into clean markdown.
 * @param entries Array of {from?, freq?, text, ts?}
 * @param meta Flight metadata: callsign, route (required), plus optional fields
 * @returns Markdown string with header and chronological exchanges
 */
export function formatTranscript(entries: TranscriptEntry[], meta: TranscriptMetadata): string {
  // Validate required metadata
  if (!meta.callsign || !meta.route) {
    return '# Transcript\n\nError: callsign and route are required.\n';
  }

  const lines: string[] = [];

  // Header with flight metadata
  lines.push('# ATC Transcript');
  lines.push('');
  lines.push(`**Flight:** ${meta.callsign}`);
  lines.push(`**Route:** ${meta.route}`);

  if (meta.aircraft) lines.push(`**Aircraft:** ${meta.aircraft}`);
  if (meta.flightRules) lines.push(`**Rules:** ${meta.flightRules}`);
  if (meta.cruiseAltFt) lines.push(`**Cruise:** ${meta.cruiseAltFt.toLocaleString()} ft`);
  if (meta.depTime) lines.push(`**Departure:** ${meta.depTime}`);

  lines.push('');
  lines.push('---');
  lines.push('');

  // Entries
  for (const entry of entries) {
    if (!entry.text || !entry.text.trim()) continue;

    const parts: string[] = [];

    // Timestamp (if available)
    if (entry.ts) {
      parts.push(`*${entry.ts}*`);
    }

    // From/Station (e.g. "Delivery", "Pilot", "Tower 118.5")
    const station = entry.from?.trim() || 'Unknown';
    const freqStr = entry.freq
      ? ` ${String(entry.freq).includes('.') ? entry.freq : (Number(entry.freq) / 1000).toFixed(3)}`
      : '';
    parts.push(`**${station}**${freqStr}`);

    // The message text
    parts.push(`: ${entry.text.trim()}`);

    lines.push(parts.join(' '));
  }

  lines.push('');
  lines.push('---');
  lines.push(`*Generated from ATC transcript data*`);

  return lines.join('\n');
}

/**
 * Format transcript for plain-text (non-markdown) export.
 * Useful for systems that don't render markdown.
 * @param entries Array of transcript entries
 * @param meta Flight metadata
 * @returns Plain text string
 */
export function formatTranscriptPlain(entries: TranscriptEntry[], meta: TranscriptMetadata): string {
  if (!meta.callsign || !meta.route) {
    return 'ERROR: callsign and route are required.';
  }

  const lines: string[] = [];

  // Header
  lines.push('='.repeat(70));
  lines.push('ATC TRANSCRIPT');
  lines.push('='.repeat(70));
  lines.push('');
  lines.push(`Flight: ${meta.callsign}`);
  lines.push(`Route:  ${meta.route}`);
  if (meta.aircraft) lines.push(`Aircraft: ${meta.aircraft}`);
  if (meta.flightRules) lines.push(`Rules: ${meta.flightRules}`);
  if (meta.cruiseAltFt) lines.push(`Cruise: ${meta.cruiseAltFt.toLocaleString()} ft`);
  if (meta.depTime) lines.push(`Departure: ${meta.depTime}`);
  lines.push('');
  lines.push('-'.repeat(70));
  lines.push('');

  // Entries
  for (const entry of entries) {
    if (!entry.text || !entry.text.trim()) continue;

    const ts = entry.ts ? `[${entry.ts}] ` : '';
    const station = entry.from?.trim() || 'Unknown';
    const freq = entry.freq
      ? ` (${String(entry.freq).includes('.') ? entry.freq : (Number(entry.freq) / 1000).toFixed(3)})`
      : '';
    lines.push(`${ts}${station}${freq}:`);
    lines.push(`  ${entry.text.trim()}`);
    lines.push('');
  }

  lines.push('-'.repeat(70));
  lines.push('End of transcript');
  lines.push('');

  return lines.join('\n');
}
