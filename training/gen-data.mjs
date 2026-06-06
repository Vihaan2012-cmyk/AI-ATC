// Synthetic ATC training-data generator (distillation).
//
// Produces JSONL training pairs that teach a SMALL model to do the brain's NLU job:
//   pilot transmission (possibly messy) -> {"intent": <one of N>, "atis_info": <letter|null>}
//
// Two goals baked in:
//   1) ATC ONLY — the model must NOT behave like a chatbot. Off-topic input maps to "unknown".
//   2) Robust to messy text — typos, missing words, slang, lowercase, run-ons all map to the
//      CLOSEST valid intent.
//
// The "teacher" labels come from a known-good source. For clean canonical phrasings we trust the
// templates directly; the 14b teacher (via Ollama) is used to label HARD/messy cases and to widen
// coverage. Templates guarantee correctness; the teacher adds variety.
//
// Usage:
//   node training/gen-data.mjs                 # ~default 4000 examples to training/data/atc-nlu.jsonl
//   node training/gen-data.mjs --n 8000 --teacher   # also call the 14b to label extra messy cases
//
// Output format (one JSON object per line):
//   {"prompt": "<exact INTENT_PROMPT text>", "completion": "{\"intent\":\"...\",\"atis_info\":null}"}
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'data', 'atc-nlu.jsonl');

// ---- args ----
const args = process.argv.slice(2);
const argN = Number((args[args.indexOf('--n') + 1]) || 0) || 4000;
const useTeacher = args.includes('--teacher');
const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const TEACHER_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:14b';

// ---- the EXACT prompt the brain sends (must match src/brain/llm/nlu.ts) ----
const INTENTS = [
  'request_ifr_clearance', 'request_pushback', 'request_taxi', 'ready_for_departure', 'go_around',
  'request_flight_following', 'request_pattern', 'touch_and_go', 'full_stop', 'request_hold', 'readback', 'unknown',
];
const intentPrompt = (text) =>
  `You classify a single pilot radio transmission. Return ONLY JSON:\n` +
  `{"intent": one of ["${INTENTS.join('","')}"], "atis_info": single letter A-Z or null}\n\n` +
  `Pilot: "${text}"\nJSON:`;

// ---- canonical phrasings per intent (the "truth") ----
const CALLSIGNS = ['Southwest 1234', 'Delta 88', 'November 512 Sierra Romeo', 'Speedbird 9', 'United 305', 'cessna 73Q', 'Alaska 219'];
const DESTS = ['Portland', 'Seattle', 'KLAX', 'Denver', 'the field'];
const ATIS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Zulu', 'Whiskey'];
const ATIS_LETTER = { Alpha: 'A', Bravo: 'B', Charlie: 'C', Delta: 'D', Zulu: 'Z', Whiskey: 'W' };

const TEMPLATES = {
  request_ifr_clearance: [
    'request IFR clearance to {dest}', 'clearance to {dest}', 'ready to copy IFR', 'request our IFR clearance',
    'like to copy clearance', 'IFR to {dest} ready to copy', 'request PDC', 'pre-departure clearance please',
    // off-template variants the model missed:
    'standing by to copy', 'ready to copy', 'standing by for clearance', 'got a clearance for us',
    'we would like our IFR', 'ready to copy our clearance', 'can we get cleared to {dest}',
  ],
  request_pushback: ['request pushback', 'ready for pushback', 'request push and start', 'push back please', 'ready to push', 'startup and pushback', 'ready to push whenever', 'push approved ready'],
  request_taxi: [
    'request taxi', 'ready to taxi', 'request taxi to the active', 'taxi for departure', 'ready to taxi to the runway',
    // "roll to the runway" should be taxi, not departure:
    'ready to roll to the runway', 'can we start taxiing', 'where to taxi', 'taxi to the active runway',
    'ready to taxi out', 'request to taxi to the runway',
  ],
  ready_for_departure: [
    'ready for departure', 'holding short ready for departure', 'ready for takeoff', 'we are ready to go',
    'number one ready', 'lined up and ready', 'good to go on the runway', 'all set ready when you are',
    // "holding short <rwy>, ready" must be departure, NOT an enroute hold:
    'we are set holding short {rwy}', 'holding short {rwy} ready', 'holding short and ready for departure',
    'buttoned up and ready', 'ready to depart',
  ],
  go_around: [
    'going around', 'go around', 'executing a go around', 'missed approach', 'we are going missed',
    // go-around without the literal words:
    'taking it around', 'balked landing going around', 'aborting the landing', 'we are going up and around',
    'unable to land going around', 'taking it back up', 'balked landing going up', 'balked landing climbing out',
    'discontinuing the approach climbing', 'not landing going back up', 'pulling up and going around',
  ],
  request_flight_following: ['request VFR flight following to {dest}', 'request flight following', 'like flight following to {dest}', 'request VFR advisories', 'request traffic advisories VFR', 'can we get advisories to {dest}'],
  request_pattern: ['request closed traffic', 'remaining in the pattern', 'request pattern work', 'inbound for the pattern', 'request to stay in the pattern', 'enter left downwind', 'we want to stay in the pattern'],
  touch_and_go: [
    'request touch and go', 'this will be a touch and go', 'request the option', 'low approach please',
    'touch and goes requested', 'planning the option', 'the option this time', 'request a stop and go',
    'this one will be the option', 'request low approach',
  ],
  full_stop: ['this will be a full stop', 'inbound full stop', 'request full stop landing', 'to a full stop', 'full stop this time'],
  request_hold: ['request holding', 'unable to continue request hold', 'we need to hold', 'request hold as published', 'enter the hold', 'we need to hold somewhere'],
  readback: [
    'roger squawk 4517 climbing to five thousand', 'cleared to {dest} squawk 2200', 'runway 16 left cleared for takeoff',
    'descend and maintain three thousand', 'wilco contact tower 119.9',
    // terse / mixed readbacks the model missed:
    'climbing five thousand squawk 4521', 'roger tower 118 point 3', 'ok climbing to five thousand squawk 2200',
    'maintaining three thousand wilco', 'cleared for takeoff runway 16 roger', 'squawk 4521 climbing wilco',
  ],
};

// Off-topic / non-ATC inputs that MUST map to "unknown" (keeps it an ATC controller, not a chatbot).
const NON_ATC = [
  'what is the weather like in Paris today', 'tell me a joke', 'who won the world cup',
  'can you write me an essay', 'what time is it', 'how do I cook pasta', 'what is the capital of France',
  'sing me a song', 'explain quantum physics', 'are you an AI', 'help me with my homework',
  "what's your name", 'translate hello to spanish', 'give me stock tips', 'recommend a movie',
  'whats 2 plus 2', 'how are you doing today', 'thanks for the help bye',
  // help-seeking / panic that is NOT an ATC request — must still be "unknown", never a chatbot reply:
  'can you help me land this thing im scared', 'how do I land the plane', 'i dont know how to fly help',
  'what button do I press to land', 'how do I use the autopilot', 'can you control the plane for me',
  'whats the best plane in the sim', 'how much fuel do I have', 'is my landing gear down',
];

// ---- messy-text augmentation: typos, drops, slang, casing, run-ons ----
const SLANG = [
  [/request/gi, 'req'], [/clearance/gi, 'clx'], [/runway/gi, 'rwy'], [/please/gi, 'pls'],
  [/ready/gi, 'rdy'], [/pushback/gi, 'push back'], [/IFR/gi, 'ifr'], [/touch and go/gi, 'tng'],
  [/with you/gi, 'wit u'], [/for/gi, '4'],
];
function dropWords(s, n = 1) {
  const w = s.split(' '); for (let i = 0; i < n && w.length > 2; i++) w.splice((i * 3) % w.length, 1); return w.join(' ');
}
function typo(s, seed) {
  // deterministic single-char swap/drop based on seed
  if (s.length < 4) return s;
  const i = 1 + (seed % (s.length - 2));
  const ch = s[i];
  if (/[a-z]/i.test(ch)) return s.slice(0, i) + (seed % 2 ? '' : ch + ch) + s.slice(i + 1); // drop or double
  return s;
}
function messify(s, seed) {
  let out = s;
  const mode = seed % 6;
  if (mode === 0) out = out.toLowerCase();
  else if (mode === 1) out = out.toUpperCase();
  else if (mode === 2) for (const [re, rep] of SLANG) if (seed % 3 === 0) out = out.replace(re, rep);
  else if (mode === 3) out = dropWords(out, 1);
  else if (mode === 4) out = typo(out, seed);
  else out = out.replace(/[.,]/g, '').replace(/\s+/g, ' ').trim() + (seed % 2 ? ' uh' : ' ...');
  return out;
}

const RWYS = ['16', '34L', '27', '9', '16L', '22R', '4'];
function fill(t, seed) {
  return t
    .replace('{dest}', DESTS[seed % DESTS.length])
    .replace('{cs}', CALLSIGNS[seed % CALLSIGNS.length])
    .replace('{rwy}', RWYS[seed % RWYS.length]);
}

// Build one labeled example. Optionally prepend/append the callsign + ATIS like a real call.
function buildExample(intent, phrasing, seed) {
  const cs = CALLSIGNS[seed % CALLSIGNS.length];
  let atisLetter = null;
  let text = phrasing;
  // ~40% include a callsign prefix; ~25% include an ATIS letter (for the atis_info field).
  if (seed % 5 < 2) text = `${cs}, ${text}`;
  if (intent !== 'unknown' && seed % 4 === 0) {
    const a = ATIS[seed % ATIS.length];
    text = `${text}, information ${a}`;
    atisLetter = ATIS_LETTER[a];
  }
  // ~45% get messified.
  if (seed % 20 >= 11) text = messify(text, seed);
  return { text, intent, atis_info: atisLetter };
}

function toLine(ex) {
  return JSON.stringify({
    prompt: intentPrompt(ex.text),
    completion: JSON.stringify({ intent: ex.intent, atis_info: ex.atis_info }),
  });
}

// ---- optional teacher labeling for extra-hard messy cases ----
async function teacherLabel(text) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: TEACHER_MODEL, prompt: intentPrompt(text), stream: false, format: 'json', options: { temperature: 0 } }),
  });
  if (!res.ok) throw new Error(`teacher ${res.status}`);
  const j = await res.json();
  const obj = JSON.parse(j.response || '{}');
  if (!INTENTS.includes(obj.intent)) obj.intent = 'unknown';
  obj.atis_info = (typeof obj.atis_info === 'string' && obj.atis_info.length === 1) ? obj.atis_info.toUpperCase() : null;
  return obj;
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  const lines = [];
  let seed = 1;

  // 1) Canonical + messy template examples, balanced across intents.
  const perIntent = Math.floor((argN * 0.8) / Object.keys(TEMPLATES).length);
  for (const [intent, phrasings] of Object.entries(TEMPLATES)) {
    for (let i = 0; i < perIntent; i++) {
      const phrasing = fill(phrasings[i % phrasings.length], seed);
      lines.push(toLine(buildExample(intent, phrasing, seed)));
      seed++;
    }
  }

  // 2) Non-ATC -> unknown (the anti-chatbot guardrail), generously represented.
  const nUnknown = Math.floor(argN * 0.15);
  for (let i = 0; i < nUnknown; i++) {
    const base = NON_ATC[i % NON_ATC.length];
    const text = i % 3 === 0 ? messify(base, seed) : base;
    lines.push(toLine({ text, intent: 'unknown', atis_info: null }));
    seed++;
  }

  // 3) Optional: teacher-labeled extra-messy cases for the last ~5%.
  if (useTeacher) {
    const nTeach = Math.floor(argN * 0.05);
    console.log(`Labeling ${nTeach} hard cases with ${TEACHER_MODEL}…`);
    for (let i = 0; i < nTeach; i++) {
      const intent = Object.keys(TEMPLATES)[seed % Object.keys(TEMPLATES).length];
      const phr = fill(TEMPLATES[intent][seed % TEMPLATES[intent].length], seed);
      const text = messify(messify(phr, seed), seed + 7); // double-messified
      try {
        const lbl = await teacherLabel(text);
        lines.push(toLine({ text, intent: lbl.intent, atis_info: lbl.atis_info }));
      } catch (e) {
        console.warn(`  teacher skip: ${e.message}`);
      }
      seed++;
      if (i % 25 === 0) console.log(`  ${i}/${nTeach}`);
    }
  }

  // Shuffle deterministically (no Math.random) so intents are interleaved.
  for (let i = lines.length - 1; i > 0; i--) {
    const j = (i * 2654435761) % (i + 1);
    [lines[i], lines[j]] = [lines[j], lines[i]];
  }

  writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`Wrote ${lines.length} examples to ${OUT}`);
  console.log(`Intents: ${INTENTS.join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
