// Free-flow enroute responses: turn parsed multi-part requests into one natural ATC reply that
// addresses each, in order, with proper phraseology. Deterministic — the engine decides what to
// approve (e.g. won't clear you below a sane floor) and composes the wording.
import { spokenAltitude, spokenDigits } from '../util/phraseology.js';
import { computeEfcZulu } from './holds.js';
import type { EnrouteRequest } from '../types.js';

export interface EnrouteContext {
  /** Current altitude (ft) if known, to phrase climb/descend sensibly. */
  altitudeFt?: number;
  /** Cruise altitude (ft), used as the ceiling for "higher". */
  cruiseFt?: number;
  /** Current UTC time in minutes since 00:00, for EFC computation. If omitted, no EFC is appended. */
  nowUtcMinutes?: number;
}

/** Resolve the concrete target altitude (ft) a request maps to, given context. */
export function resolvedAltitude(r: EnrouteRequest, ctx: EnrouteContext): number | undefined {
  switch (r.type) {
    case 'climb':
    case 'descend':
      return r.altitudeFt ?? undefined;
    case 'higher':
      return ctx.cruiseFt ?? ((ctx.altitudeFt ?? 10000) + 4000);
    case 'lower':
      return Math.max(3000, (ctx.altitudeFt ?? 10000) - 4000);
    default:
      return undefined;
  }
}

/** Compose the response clause for a single request. Returns null if it can't be honored. */
function clauseFor(r: EnrouteRequest, ctx: EnrouteContext): string | null {
  // "at pilot's discretion" suffix for discretionary climbs/descents.
  const disc = r.discretionary ? ' at pilot’s discretion' : '';
  switch (r.type) {
    case 'climb':
      return r.altitudeFt != null
        ? (r.discretionary ? `climb at pilot’s discretion, maintain ${spokenAltitude(r.altitudeFt)}` : `climb and maintain ${spokenAltitude(r.altitudeFt)}`)
        : null;
    case 'descend':
      return r.altitudeFt != null
        ? (r.discretionary ? `descend at pilot’s discretion, maintain ${spokenAltitude(r.altitudeFt)}` : `descend and maintain ${spokenAltitude(r.altitudeFt)}`)
        : null;
    case 'higher': {
      const tgt = resolvedAltitude(r, ctx)!;
      return `climb and maintain ${spokenAltitude(tgt)}${disc}`;
    }
    case 'lower': {
      const tgt = resolvedAltitude(r, ctx)!;
      return `descend and maintain ${spokenAltitude(tgt)}${disc}`;
    }
    case 'cross': {
      if (!r.fix || r.altitudeFt == null) return null;
      const rel = r.restriction === 'at_or_above' ? 'at or above '
        : r.restriction === 'at_or_below' ? 'at or below ' : 'at ';
      return `cross ${r.fix} ${rel}${spokenAltitude(r.altitudeFt)}`;
    }
    case 'direct':
      return r.fix ? `cleared direct ${r.fix}` : null;
    case 'deviate': {
      const deg = r.degrees ? `${r.degrees} degrees ` : '';
      return r.side ? `deviation ${deg}${r.side} of course approved, advise when able direct` : null;
    }
    case 'speed':
      return r.speedKt != null ? `maintain ${r.speedKt} knots` : null;
    case 'hold_at': {
      if (!r.fix) return null;
      if (ctx.nowUtcMinutes != null) {
        const efc = computeEfcZulu(ctx.nowUtcMinutes);
        return `hold at ${r.fix} as published, expect further clearance at ${spokenDigits(efc)} Zulu`;
      }
      return `hold at ${r.fix} as published, expect further clearance shortly`;
    }
    default:
      return null;
  }
}

/**
 * Compose ATC's response to a pilot "unable". Given the last assigned altitude (if any), offer a
 * sensible alternative: hold present altitude and expect the change later. Deterministic.
 */
export function composeUnableReply(lastAssignedAltFt: number | null): string {
  if (lastAssignedAltFt != null) {
    return `roger, maintain ${spokenAltitude(lastAssignedAltFt)}, expect higher in one zero miles`;
  }
  return 'roger, maintain present altitude, advise when able';
}

/** Items the pilot must read back, derived from the honored requests (for compliance). */
export function enrouteReadback(reqs: EnrouteRequest[]): { altitudeFt?: number; headingDeg?: number; speedKt?: number } {
  const out: { altitudeFt?: number; headingDeg?: number; speedKt?: number } = {};
  for (const r of reqs) {
    if ((r.type === 'climb' || r.type === 'descend') && r.altitudeFt != null) out.altitudeFt = r.altitudeFt;
    if (r.type === 'speed' && r.speedKt != null) out.speedKt = r.speedKt;
  }
  return out;
}

/**
 * Compose a single ATC reply body for a set of free-flow requests. Returns the joined clauses
 * (callsign is prepended by the caller), or null if nothing was honored.
 */
export function composeEnrouteReply(reqs: EnrouteRequest[], ctx: EnrouteContext): string | null {
  const clauses = reqs.map((r) => clauseFor(r, ctx)).filter((c): c is string => !!c);
  if (clauses.length === 0) return null;
  // Capitalize the first clause, comma-join the rest, end with a period.
  const first = clauses[0]!.charAt(0).toUpperCase() + clauses[0]!.slice(1);
  return [first, ...clauses.slice(1)].join(', ') + '.';
}

/** Used by the squawk/HUD path: any altitude assigned in this batch (resolves higher/lower too). */
export function assignedAltitude(reqs: EnrouteRequest[], ctx: EnrouteContext = {}): number | undefined {
  for (const r of reqs) {
    if (r.type === 'climb' || r.type === 'descend' || r.type === 'higher' || r.type === 'lower') {
      const ft = resolvedAltitude(r, ctx);
      if (ft != null) return ft;
    }
  }
  return undefined;
}

// (spokenDigits kept imported for future heading phrasing; referenced to avoid unused warning.)
void spokenDigits;
