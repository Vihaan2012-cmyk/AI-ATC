// Brain CLI: drive the controllers from the terminal (no widget needed).
import * as readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { createApp } from './app.js';
import { spokenCallsign } from './util/phraseology.js';

async function main() {
  console.log('=== MSFS AI ATC - Brain (CLI) ===\n');
  const app = await createApp();
  const { fp, session } = app;

  console.log(`Flight plan [${fp.source}]: ${fp.callsign}  ${fp.origin} -> ${fp.destination}  (${fp.aircraftIcao})`);
  console.log(`Cruise ${fp.cruiseAltitudeFt} ft | Route: ${fp.route || '(none)'}`);
  console.log(`LLM: ${app.llmLabel} | Navdata: ${app.navLabel}\n`);
  console.log(`You are ${spokenCallsign(fp.callsign, fp.telephony)}. Fly the whole arc:`);
  console.log(`  Delivery -> Ground -> Tower -> Departure -> Center -> Approach -> Tower -> Ground`);
  console.log(`Start: "Delivery, ${fp.callsign}, request IFR clearance to ${fp.destination}, information Alpha."`);
  console.log('Type /quit to exit.\n');

  const rl = readline.createInterface({ input, output, prompt: 'PILOT> ' });
  rl.prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (text === '/quit') break;
    if (text.length > 0) {
      const reply = await session.handle(text);
      const freq = reply.freqMhz ? ` ${reply.freqMhz.toFixed(3)}` : '';
      console.log(`\n[${reply.from}${freq}] ${reply.text}\n`);
    }
    rl.prompt();
  }
  rl.close();
  app.close();
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
