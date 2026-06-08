// Frequency gating: ATC only hears (and answers) the pilot when COM1 is tuned to the active
// controller's frequency. This is a pure, deterministic language/decision layer — it owns no
// facts beyond the two numbers it is given (controller freq + live COM1 active freq).
//
// Models monitor-vs-contact: after a "monitor X" handoff the pilot is on X's frequency but is
// NOT expected to check in (X will call them). A spurious check-in on a monitor freq is still
// "heard" by the receiving controller, but the engine can choose to treat it as unsolicited.
//
// Flag: needs live SimConnect COM data — feed `com1Mhz` from FlightContext.com1Mhz
//       (SimVar "COM ACTIVE FREQUENCY:1", MHz), already parsed in simClient.ts/parseState.

import { spokenFreq, spokenCallsign } from '../util/phraseology.js';

/**
 * How the pilot arrived on the active controller's frequency.
 *  - 'contact': normal — pilot was told to "contact" the controller and is expected to check in.
 *  - 'monitor': pilot was told to "monitor" the controller — they are listening but should NOT
 *               call first; the controller will initiate. (Common for tower on a handoff.)
 */
export type FreqMode = 'contact' | 'monitor';

/** Outcome of testing whether a pilot transmission reaches the active controller. */
export interface FreqGateResult {
  /** True if COM1 is on the controller's frequency (within tolerance) and the call is received. */
  heard: boolean;
  /** True when on the correct frequency but in 'monitor' mode (call received, but unsolicited). */
  unsolicited: boolean;
  /** Reason code for diagnostics / logging. */
  reason: 'heard' | 'wrong_frequency' | 'unknown_frequency' | 'no_com_data' | 'unsolicited_on_monitor';
  /** The controller frequency the pilot should be on (echo of input), or null if unknown. */
  wantMhz: number | null;
  /** The COM1 active frequency seen (echo of input), or null if no live data. */
  haveMhz: number | null;
}

/**
 * Frequency comparison tolerance in MHz. MSFS reports COM frequencies that can differ from the
 * navdata value by a sub-kHz rounding error and by 8.33 kHz vs 25 kHz channel spacing, so a strict
 * equality check would spuriously reject correctly tuned radios. 0.011 MHz (11 kHz) is wide enough
 * to absorb that rounding yet narrow enough that an adjacent channel never matches. Matches the
 * tolerance already used by session.ts so the two stay consistent.
 */
export const FREQ_TOLERANCE_MHZ = 0.011;

/**
 * Are two COM frequencies (MHz) effectively the same channel?
 * Deterministic, NaN-safe. Returns false if either value is not a finite, plausible VHF COM freq.
 */
export function sameFrequency(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a < 100 || a > 140 || b < 100 || b > 140) return false;
  return Math.abs(a - b) < FREQ_TOLERANCE_MHZ;
}

/**
 * Decide whether a pilot transmission is heard by the active controller.
 *
 * @param wantMhz  The active controller's frequency in MHz (from the nav/facility data), or null
 *                 when unknown/uncontrolled (e.g. Center, where freq is not enforced).
 * @param haveMhz  The live COM1 active frequency in MHz (FlightContext.com1Mhz). Pass 0/null/NaN
 *                 when no live SimConnect COM data is available yet.
 * @param mode     'contact' (default) or 'monitor'. In 'monitor' mode a correctly-tuned call is
 *                 still received but flagged `unsolicited`.
 *
 * Decision order (deterministic):
 *  1. No live COM data            -> heard (don't penalise the player before the sim reports a freq).
 *  2. Controller freq unknown     -> heard (can't gate on a frequency we don't have; e.g. Center).
 *  3. COM1 != controller freq     -> NOT heard (wrong frequency).
 *  4. COM1 == controller freq     -> heard; `unsolicited` set iff mode==='monitor'.
 */
export function evaluateFreqGate(
  wantMhz: number | null | undefined,
  haveMhz: number | null | undefined,
  mode: FreqMode = 'contact',
): FreqGateResult {
  const want = wantMhz != null && Number.isFinite(wantMhz) ? wantMhz : null;
  const have = haveMhz != null && Number.isFinite(haveMhz) && haveMhz > 100 && haveMhz < 140 ? haveMhz : null;

  // 1. No live COM data — be permissive so frequency gating never blocks before the sim reports.
  if (have == null) {
    return { heard: true, unsolicited: false, reason: 'no_com_data', wantMhz: want, haveMhz: null };
  }
  // 2. Unknown controller frequency (e.g. Center) — nothing to gate against.
  if (want == null) {
    return { heard: true, unsolicited: false, reason: 'unknown_frequency', wantMhz: null, haveMhz: have };
  }
  // 3. Wrong frequency — the controller never hears the call.
  if (!sameFrequency(want, have)) {
    return { heard: false, unsolicited: false, reason: 'wrong_frequency', wantMhz: want, haveMhz: have };
  }
  // 4. Correct frequency. In monitor mode the call is heard but unsolicited.
  if (mode === 'monitor') {
    return { heard: true, unsolicited: true, reason: 'unsolicited_on_monitor', wantMhz: want, haveMhz: have };
  }
  return { heard: true, unsolicited: false, reason: 'heard', wantMhz: want, haveMhz: have };
}

/** Convenience boolean: is the call heard at all (correct freq, or gating not applicable)? */
export function isCallHeard(
  wantMhz: number | null | undefined,
  haveMhz: number | null | undefined,
  mode: FreqMode = 'contact',
): boolean {
  return evaluateFreqGate(wantMhz, haveMhz, mode).heard;
}

/**
 * Compose the silent / no-response outcome for a call on the wrong frequency.
 *
 * In the real world the controller simply doesn't answer — there is no transmission at all. We
 * return an out-of-band advisory string (NOT controller phraseology) that the session/HUD can show
 * to the player to explain the silence. The empty-radio case is the default; pass `radioCheck=true`
 * to instead model the player calling the station they ARE tuned to and getting a "say again, you're
 * unreadable / check your frequency" type nudge from whoever happens to be on that channel.
 *
 * @param station    The controller the pilot was trying to reach, e.g. "Seattle Tower".
 * @param wantMhz    The correct frequency in MHz, or null if unknown.
 * @param radioCheck When true, return a spoken nudge instead of pure silence.
 */
export function composeNoResponse(
  station: string,
  wantMhz: number | null | undefined,
  radioCheck = false,
): string {
  const onFreq = wantMhz != null && Number.isFinite(wantMhz) ? ` on ${spokenFreq(wantMhz)}` : '';
  if (radioCheck) {
    // Someone is on the channel but it isn't the station the pilot wants — gentle correction.
    return `Station calling, you're not on the correct frequency. Try ${station}${onFreq}.`;
  }
  // Pure silence: nothing is transmitted. The bracketed advisory is a UI hint, not radio audio.
  return `[No response — ${station} can't hear you. Check your COM1 frequency${onFreq}.]`;
}

/**
 * Compose an "unsolicited call on a monitor frequency" advisory. After a "monitor" handoff the
 * pilot shouldn't check in; if they do, the controller may briefly acknowledge and ask them to
 * stand by for the call. Deterministic.
 *
 * @param spokenCs Spoken callsign, e.g. "Southwest 1234".
 * @param station  Station label, e.g. "Tower".
 */
export function composeMonitorAck(spokenCs: string, station: string): string {
  return `${spokenCs}, ${station} has your information, monitor this frequency, I'll call you.`;
}

/**
 * Detect whether a pilot transmission is a frequency/radio check — i.e. they're asking whether
 * they're being heard ("radio check", "how do you read", "do you copy", "are you receiving").
 * Useful for deciding to answer with a readability report even on a marginal channel.
 */
export function isFreqCheckRequest(text: string): boolean {
  return /\bradio\s+check\b|\bhow\s+(do\s+)?you\s+read\b|\bdo\s+you\s+(copy|read|receive)\b|\bare\s+you\s+receiving\b|\bcheck\s+freq(uency)?\b/i.test(
    text,
  );
}

/**
 * One-call helper for the session layer: given the active controller's frequency, the live COM1
 * frequency, the station label, callsign info, and the handoff mode, return either the gate result
 * plus the exact text to emit when the call is NOT a normal heard "contact". Returns `text: null`
 * when the call should be processed normally (heard + solicited).
 *
 * This keeps the wrong-frequency / monitor wording in one deterministic place so callers don't
 * reinvent it.
 *
 * @param wantMhz   Active controller frequency (MHz) or null.
 * @param haveMhz   Live COM1 active frequency (MHz) or null/0 when no live data.
 * @param station   Full station label, e.g. "Seattle Tower".
 * @param callsign  Filed callsign, e.g. "SWA1234".
 * @param telephony Optional spoken callsign override, e.g. "Southwest 1234".
 * @param mode      'contact' (default) or 'monitor'.
 */
export function gateTransmission(
  wantMhz: number | null | undefined,
  haveMhz: number | null | undefined,
  station: string,
  callsign: string,
  telephony?: string,
  mode: FreqMode = 'contact',
): { result: FreqGateResult; text: string | null } {
  const result = evaluateFreqGate(wantMhz, haveMhz, mode);
  if (!result.heard) {
    return { result, text: composeNoResponse(station, result.wantMhz) };
  }
  if (result.unsolicited) {
    const spokenCs = spokenCallsign(callsign, telephony);
    return { result, text: composeMonitorAck(spokenCs, station) };
  }
  return { result, text: null };
}
