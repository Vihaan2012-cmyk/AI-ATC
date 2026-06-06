/**
 * Phase 0c spike: validate Ollama + Qwen for ATC use.
 *   1) model reachable
 *   2) generation speed on this CPU (tokens/sec)
 *   3) structured (JSON) intent extraction from a pilot transmission  <- the NLU job
 *
 * Run:   npm run spike:ollama
 * Needs: ollama running + `ollama pull qwen2.5:14b`
 */

const HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

async function generate(prompt: string, opts: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${HOST}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: false, ...opts }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log(`-> Ollama ${HOST} | model ${MODEL}\n`);

  // 1 + 2: reachability and speed
  console.log('[1] speed test ...');
  const r1 = await generate(
    'You are a US clearance delivery controller. In ONE short line, acknowledge a correct readback from "N512SR". Use standard phraseology.'
  );
  const tokps = r1.eval_count / (r1.eval_duration / 1e9);
  console.log(`    reply : ${JSON.stringify(String(r1.response).trim())}`);
  console.log(`    speed : ${r1.eval_count} tok / ${(r1.eval_duration / 1e9).toFixed(2)}s = ${tokps.toFixed(1)} tok/s`);
  console.log(`    total : ${(r1.total_duration / 1e9).toFixed(2)}s (incl. ${r1.prompt_eval_count} prompt tok)\n`);

  // 3: NLU — pilot transmission to structured intent
  console.log('[2] intent extraction (JSON) ...');
  const schema =
    'Return ONLY JSON with this shape: ' +
    '{"intent": one of ["request_ifr_clearance","request_pushback","request_taxi",' +
    '"request_takeoff_clearance","report_ready","position_report","readback","frequency_change","unknown"], ' +
    '"callsign": string|null, "runway": string|null, "altitude_ft": number|null, "atis_info": string|null}';
  const pilot = 'Ground, Speedbird 287 heavy, request taxi, information Bravo, runway one six right.';
  const r2 = await generate(
    `You convert a pilot radio transmission into JSON.\n${schema}\n\nPilot: "${pilot}"\nJSON:`,
    { format: 'json', options: { temperature: 0 } }
  );
  console.log(`    pilot : ${pilot}`);
  console.log(`    json  : ${String(r2.response).trim()}\n`);

  console.log('[OK] spike complete');
}

main().catch((e) => {
  console.error('[FAIL]', e?.message ?? e);
  console.error('       is `ollama serve` running? is the model pulled? (ollama list)');
  process.exit(1);
});
