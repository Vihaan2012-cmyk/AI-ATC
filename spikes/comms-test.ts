// Verifies the WebSocket comms server end-to-end: connect, send a pilot transmission,
// print the ATC reply. Assumes `npm run server` is running. Run: npm run comms-test
import WebSocket from 'ws';

const URL = `ws://localhost:${process.env.WS_PORT ?? 8742}`;
const ws = new WebSocket(URL);

const lines = [
  'Delivery, request IFR clearance, information Alpha.',
];
let sent = 0;

ws.on('open', () => {
  console.log(`connected to ${URL}`);
  setTimeout(() => ws.send(JSON.stringify({ type: 'pilot_tx', text: lines[0] })), 300);
});

ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type === 'hello') console.log(`hello: ${m.callsign} ${m.origin}->${m.destination}`);
  else if (m.type === 'atc_tx') {
    console.log(`[${m.from}${m.freq ? ' ' + Number(m.freq).toFixed(3) : ''}] ${m.text}`);
    sent += 1;
    if (sent >= lines.length) { ws.close(); process.exit(0); }
  } else if (m.type === 'state') {
    console.log(`(active: ${m.activeController})`);
  }
});

ws.on('error', (e) => { console.error('comms-test failed:', e.message); process.exit(1); });
setTimeout(() => { console.error('timeout — is `npm run server` running?'); process.exit(1); }, 8000);
