/**
 * Phase 0d spike: read the Navigraph DFD (SQLite) navdata.
 *
 * Supply your own AIRAC file (e.g. cycle 2605) and set NAVDATA_PATH in .env.
 * Uses Node's built-in `node:sqlite`.
 *
 * Run:  npm run spike:navdata           (defaults to KSEA)
 *       npm run spike:navdata KJFK
 *
 * If you see an error that node:sqlite is experimental (older Node), run:
 *   node --experimental-sqlite --import tsx spikes/navdata-spike.ts KSEA
 */
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.env.NAVDATA_PATH ?? './navdata/cycle.s3db';
const icao = (process.argv[2] ?? 'KSEA').toUpperCase();

function section(title: string) {
  console.log(`\n[${title}]`);
}

async function main() {
  console.log(`-> navdata ${dbPath} | ICAO ${icao}`);

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath);
  } catch (e: any) {
    console.error(`[FAIL] could not open ${dbPath}: ${e.message}`);
    console.error('       set NAVDATA_PATH to your Navigraph DFD .s3db file');
    process.exit(1);
  }

  // What tables exist? (DFD schemas vary; this tells us the real names.)
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all() as Array<{ name: string }>;
  section('tables');
  console.log('  ' + tables.map((t) => t.name).join(', '));

  // Airport
  section('airport');
  try {
    const apt = db.prepare(`SELECT * FROM tbl_airports WHERE airport_identifier = ?`).get(icao);
    console.log(apt ? '  ' + JSON.stringify(apt) : '  (not found)');
  } catch (e: any) {
    console.log('  table/columns differ: ' + e.message);
  }

  // Frequencies — the bit ATC actually needs
  section('frequencies');
  try {
    const freqs = db
      .prepare(
        `SELECT communication_type, communication_frequency, callsign
         FROM tbl_airport_communication WHERE airport_identifier = ?`
      )
      .all(icao) as any[];
    console.log(`  ${freqs.length} found`);
    for (const f of freqs) {
      console.log(`  ${String(f.communication_type).padEnd(6)} ${String(f.communication_frequency).padEnd(9)} ${f.callsign ?? ''}`);
    }
  } catch (e: any) {
    console.log('  table/columns differ: ' + e.message);
  }

  // Runways
  section('runways');
  try {
    const rwys = db
      .prepare(
        `SELECT runway_identifier, runway_length, runway_width, runway_true_bearing
         FROM tbl_runways WHERE airport_identifier = ?`
      )
      .all(icao) as any[];
    console.log(`  ${rwys.length} found`);
    for (const r of rwys) {
      console.log(`  ${String(r.runway_identifier).padEnd(5)} len ${r.runway_length} brg ${r.runway_true_bearing}`);
    }
  } catch (e: any) {
    console.log('  table/columns differ: ' + e.message);
  }

  // Procedures available (SIDs/STARs/approaches) — just counts for the spike
  section('procedures');
  for (const [label, table] of [
    ['SIDs', 'tbl_sids'],
    ['STARs', 'tbl_stars'],
    ['approaches', 'tbl_iaps'],
  ] as const) {
    try {
      const rows = db
        .prepare(`SELECT DISTINCT procedure_identifier FROM ${table} WHERE airport_identifier = ?`)
        .all(icao) as any[];
      console.log(`  ${label}: ${rows.map((r) => r.procedure_identifier).join(', ') || '(none)'}`);
    } catch (e: any) {
      console.log(`  ${label}: table/columns differ (${e.message})`);
    }
  }

  db.close();
  console.log('\n[OK] spike complete');
}

main().catch((e) => {
  console.error('[FAIL]', e?.message ?? e);
  process.exit(1);
});
