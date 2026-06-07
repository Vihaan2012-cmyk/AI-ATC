// Shared app wiring used by both the CLI (index.ts) and the comms server (serve.ts):
// flight plan + SimConnect + navdata chain + LLM + controller session.
import { config } from './config.js';
import { fetchFlightPlan } from './flightplan/simbrief.js';
import { createNavdataChain } from './navdata/composite.js';
import { SimClient } from './sim/simClient.js';
import { FacilityCache } from './sim/facilityCache.js';
import { createLlm } from './llm/ollama.js';
import { ControllerSession } from './atc/session.js';
import { fetchMetars, type MetarInfo } from './sim/weather.js';
import type { Navdata } from './navdata/navdata.js';
import type { FlightPlan } from './types.js';
import type { LlmClient } from './llm/ollama.js';

export interface AppContext {
  session: ControllerSession;
  fp: FlightPlan;
  nav: Navdata;
  llm: LlmClient | null;
  sim: SimClient | null;
  weather: Record<string, MetarInfo>;
  navLabel: string;
  llmLabel: string;
  close(): void;
}

function describeNav(nav: Navdata): string {
  return 'describe' in nav && typeof (nav as { describe?: unknown }).describe === 'function'
    ? (nav as { describe(): string }).describe()
    : nav.kind;
}

export async function createApp(): Promise<AppContext> {
  let fp: FlightPlan;
  try {
    fp = await fetchFlightPlan(config.simbriefUsername, config.simbriefUserid);
  } catch (e) {
    console.error(`SimBrief fetch failed (${(e as Error).message}); using sample plan.`);
    fp = await fetchFlightPlan('');
  }

  let sim: SimClient | null = null;
  if (config.navdataSources.includes('sim')) {
    sim = new SimClient();
    try {
      const app = await sim.connect('MSFS AI ATC');
      console.log(`SimConnect: connected (${app})`);
    } catch (e) {
      // MSFS may not be in a flight yet. Keep the client and retry in the background so live data
      // (position/HUD/traffic) starts streaming automatically once the sim is ready. Navdata/ground
      // below fall back to cache for now.
      console.error(`SimConnect: not ready (${(e as Error).message}); will keep retrying in the background.`);
      sim.connectWithRetry('MSFS AI ATC');
    }
  }

  const cache = new FacilityCache(config.facilityCacheDir, config.facilityCacheMaxBytes, config.facilityCacheTtlDays);
  const nav = await createNavdataChain({
    sources: config.navdataSources,
    sim,
    cache,
    icaos: [fp.origin, fp.destination],
    dfdPath: config.navdataPath,
  });
  const llm = await createLlm();
  const weather = await fetchMetars([fp.origin, fp.destination]);

  // Real ground layout (parking + taxiways) from the sim, if connected. Best-effort.
  const ground: Record<string, import('./atc/groundControl.js').GroundLayout> = {};
  if (sim) {
    for (const icao of new Set([fp.origin, fp.destination])) {
      try {
        const g = await sim.fetchGroundLayout(icao);
        ground[icao] = { parking: g.parking, taxiways: g.taxiways };
        console.log(`Ground: ${icao} — ${g.parking.length} stands, ${g.taxiways.length} taxiways`);
      } catch (e) {
        console.error(`Ground layout for ${icao} unavailable (${(e as Error).message}).`);
      }
    }
  }

  const session = new ControllerSession(fp, nav, llm, weather, ground, config.strictness);

  return {
    session,
    fp,
    nav,
    llm,
    sim,
    weather,
    navLabel: describeNav(nav),
    llmLabel: llm ? `${config.llmProvider} connected` : 'OFF (deterministic only)',
    close: () => sim?.close(),
  };
}
