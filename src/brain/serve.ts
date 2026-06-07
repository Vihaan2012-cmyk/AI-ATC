// Server entry: wire up the app and serve the WebSocket comms for the in-sim widget.
// Run: npm run server
import { createApp } from './app.js';
import { startCommsServer } from './comms/server.js';
import { config } from './config.js';

async function main() {
  console.log('=== MSFS AI ATC - Brain (server) ===\n');
  const app = await createApp();
  console.log(`Flight: ${app.fp.callsign}  ${app.fp.origin} -> ${app.fp.destination}`);
  console.log(`LLM: ${app.llmLabel} | Navdata: ${app.navLabel}`);

  startCommsServer(config.wsPort, {
    session: app.session, fp: app.fp, sim: app.sim, weather: app.weather,
    autoTuneCom: config.autoTuneCom,
    hoppieLogon: config.hoppieLogon,
    chatter: config.chatter,
    statePath: config.sessionStatePath,
  });
  console.log('Widget can now connect. Ctrl+C to stop.');

  process.on('SIGINT', () => {
    app.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
