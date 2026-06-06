// NLU: pilot free-text -> structured intent.
// Rules first (instant, deterministic); LLM only as a fallback for ambiguous input.
import type { PilotIntent, PilotIntentType } from '../types.js';
import type { LlmClient } from './ollama.js';

const ATIS_WORDS: Record<string, string> = {
  alpha: 'A', bravo: 'B', charlie: 'C', delta: 'D', echo: 'E', foxtrot: 'F',
  golf: 'G', hotel: 'H', india: 'I', juliett: 'J', juliet: 'J', kilo: 'K',
  lima: 'L', mike: 'M', november: 'N', oscar: 'O', papa: 'P', quebec: 'Q',
  romeo: 'R', sierra: 'S', tango: 'T', uniform: 'U', victor: 'V',
  whiskey: 'W', xray: 'X', yankee: 'Y', zulu: 'Z',
};

function matchAtis(text: string): string | null {
  const m = text.match(/\b(?:information|info)\s+([a-z]+)/i);
  if (m && m[1]) {
    const word = m[1].toLowerCase();
    if (ATIS_WORDS[word]) return ATIS_WORDS[word];
    if (word.length === 1) return word.toUpperCase();
  }
  return null;
}

function ruleParse(text: string): PilotIntent {
  const t = text.toLowerCase();
  const atisInfo = matchAtis(t);

  if (/\b(clearance|ifr|pdc)\b|pre.?departure clearance|(ready|like) to copy/.test(t)) {
    return { intent: 'request_ifr_clearance', atisInfo, confidence: 0.9, via: 'rules' };
  }
  if (/\bpush\s?back\b|\bpush\b|request start|start ?up/.test(t)) {
    return { intent: 'request_pushback', atisInfo, confidence: 0.85, via: 'rules' };
  }
  if (/\btaxi\b/.test(t)) {
    return { intent: 'request_taxi', atisInfo, confidence: 0.85, via: 'rules' };
  }
  if (/ready (for|to) (departure|takeoff|go|the runway)|holding short|line ?up|request takeoff|\btakeoff\b|we'?re ready|we are ready/.test(t)) {
    return { intent: 'ready_for_departure', atisInfo, confidence: 0.85, via: 'rules' };
  }
  if (/go.?around|going around|missed approach/.test(t)) {
    return { intent: 'go_around', atisInfo, confidence: 0.9, via: 'rules' };
  }
  if (/flight following|vfr (advisor|service|flight following)|request advisor/.test(t)) {
    return { intent: 'request_flight_following', atisInfo, confidence: 0.9, via: 'rules' };
  }
  if (/touch.?and.?go|touch and go|low approach/.test(t)) {
    return { intent: 'touch_and_go', atisInfo, confidence: 0.9, via: 'rules' };
  }
  if (/full stop|to a full stop/.test(t)) {
    return { intent: 'full_stop', atisInfo, confidence: 0.9, via: 'rules' };
  }
  if (/closed traffic|remain(ing)? in the pattern|stay in the pattern|the pattern\b|pattern work|inbound for landing|inbound full stop|enter (the )?(left|right) (down ?wind|base)/.test(t)) {
    return { intent: 'request_pattern', atisInfo, confidence: 0.85, via: 'rules' };
  }
  if (/\bhold(ing)?\b|hold as published|enter the hold/.test(t)) {
    return { intent: 'request_hold', atisInfo, confidence: 0.8, via: 'rules' };
  }
  return { intent: 'unknown', atisInfo, confidence: 0.2, via: 'rules' };
}

function normIntent(v: unknown): PilotIntentType {
  const allowed: PilotIntentType[] = [
    'request_ifr_clearance', 'request_pushback', 'request_taxi', 'ready_for_departure', 'go_around',
    'request_flight_following', 'request_pattern', 'touch_and_go', 'full_stop', 'request_hold', 'readback', 'unknown',
  ];
  return allowed.includes(v as PilotIntentType) ? (v as PilotIntentType) : 'unknown';
}

const INTENT_PROMPT = (text: string) =>
  `You classify a single pilot radio transmission. Return ONLY JSON:
{"intent": one of ["request_ifr_clearance","request_pushback","request_taxi","ready_for_departure","go_around","request_flight_following","request_pattern","touch_and_go","full_stop","request_hold","readback","unknown"], "atis_info": single letter A-Z or null}

Pilot: "${text}"
JSON:`;

/** Parse a pilot transmission. Uses rules; falls back to the LLM when unsure. */
export async function parseIntent(text: string, llm: LlmClient | null): Promise<PilotIntent> {
  const rules = ruleParse(text);
  if (rules.confidence >= 0.75 || !llm) return rules;
  try {
    const j = (await llm.generateJson(INTENT_PROMPT(text))) as {
      intent?: unknown;
      atis_info?: unknown;
    };
    const atis = typeof j.atis_info === 'string' && j.atis_info.length === 1
      ? j.atis_info.toUpperCase()
      : rules.atisInfo;
    return { intent: normIntent(j.intent), atisInfo: atis, confidence: 0.7, via: 'llm' };
  } catch {
    return rules;
  }
}
