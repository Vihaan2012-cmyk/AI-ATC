// Prove the facility cache works OFFLINE: load navdata with sim=null, served entirely
// from the disk cache populated by an earlier sim-test run. Run: npm run cache-test
import { FacilityCache } from '../src/brain/sim/facilityCache.js';
import { loadSimNavdata } from '../src/brain/navdata/simconnectNavdata.js';
import { config } from '../src/brain/config.js';

const cache = new FacilityCache(config.facilityCacheDir, config.facilityCacheMaxBytes, config.facilityCacheTtlDays);
console.log(`cache on disk: ${cache.stats().count} airports, ${(cache.stats().bytes / 1024).toFixed(1)} KB\n`);

const icaos = ['VOBL', 'VOMM'];
const nav = await loadSimNavdata(null, icaos, cache); // sim = null => OFFLINE, cache only

for (const icao of icaos) {
  const a = nav.getAirport(icao);
  console.log(
    `${icao}: ${a?.name ?? '(missing)'} | delivery ${nav.getDeliveryFrequency(icao)}` +
      ` | ground ${nav.getGroundFrequency(icao)} | tower ${nav.getTowerFrequency(icao)}`,
  );
}
process.exit(0);
