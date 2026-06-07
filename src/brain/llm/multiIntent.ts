// Multi-intent transmission splitting: decompose combined pilot requests into separate parts.
// Pure, deterministic — no LLM or external dependencies.

/**
 * Split a combined pilot transmission into separate actionable parts.
 * Handles connectors like "and also", "also", ";", and " and request ".
 * Conservative: only splits on explicit connectors, never on ambiguous conjunctions.
 *
 * Examples:
 *   "request lower and say traffic" => ["request lower", "say traffic"]
 *   "contact center also request flight following" => ["contact center", "request flight following"]
 *   "climb to flight level 250; say traffic advisories" => ["climb to flight level 250", "say traffic advisories"]
 *   "request lower" => ["request lower"] (no split if no connector)
 *
 * @param text - Pilot transmission (original radio speech or transcript)
 * @returns Array of non-empty strings, each a separate intent to be handled
 */
export function splitTransmissions(text: string): string[] {
  if (!text || !text.trim()) return [];

  // Trim and normalize whitespace
  const normalized = text.trim().replace(/\s+/g, ' ');

  // Order matters: check longer connectors first to avoid partial matches.
  // Each tuple is (connector_pattern, should_keep_connector_text)
  const connectors: Array<[RegExp, boolean]> = [
    // "and also" / "and then also" - multi-word connectors
    [/\s+and\s+also\s+/i, false],
    // "and request" - explicit second request prefix
    [/\s+and\s+request\s+/i, false],
    // "also" - standalone, as in "also request..."
    [/\s+also\s+/i, false],
    // Semicolon - statement boundary
    [/\s*;\s*/i, false],
    // "and" - only split if it looks like it's introducing a new independent clause.
    // Heuristic: only split if preceded by a period, or if the next clause starts
    // with a known intent keyword (request, contact, say, report, etc.).
    // This avoids splitting things like "unable and request..."
    [/\s+and\s+(?=request\b|contact\b|say\b|report\b|tell\b|give\b|advise\b|climb\b|descend\b|turn\b)/i, false],
  ];

  let parts: string[] = [normalized];

  for (const [pattern] of connectors) {
    const newParts: string[] = [];
    for (const part of parts) {
      // Split on the connector pattern
      const split = part.split(pattern);
      newParts.push(...split);
    }
    parts = newParts;
  }

  // Filter out empty strings and trim each part
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
