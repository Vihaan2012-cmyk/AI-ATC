// Pure, deterministic scenario library for ATC training challenges.
// No I/O, no Date, no randomness — only functions of scenario definitions.

export type ScenarioInjection =
  | 'engine_failure'
  | 'weather_deviation'
  | 'busy_frequency'
  | 'traffic_conflict'
  | 'runway_change'
  | 'none';

export interface Scenario {
  /** Unique scenario identifier, e.g. "pattern-ksea". */
  id: string;
  /** Short title, e.g. "Pattern work at KSEA". */
  title: string;
  /** Detailed description of the training objective and setup. */
  description: string;
  /** Departure airport ICAO code, e.g. "KSEA". */
  origin: string;
  /** Arrival airport ICAO code, e.g. "KPDX". */
  destination: string;
  /** Aircraft ICAO type, e.g. "B738", "C172". */
  aircraft: string;
  /** Optional injected complication to practice emergency/challenge handling. */
  inject?: ScenarioInjection;
  /** Learning goal and success criteria for the scenario. */
  goal: string;
}

/**
 * Curated scenarios for ATC training covering diverse flight phases and challenges.
 * Each scenario is immutable and deterministic.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'pattern-ksea',
    title: 'Pattern Work at KSEA',
    description:
      'Practice touch-and-go circuits in a Cessna 172 at Seattle-Tacoma International. ' +
      'Focus on smooth coordination with tower, correct readbacks, and consistent turns.',
    origin: 'KSEA',
    destination: 'KSEA',
    aircraft: 'C172',
    inject: 'none',
    goal:
      'Complete 3 full patterns with zero readback errors. ' +
      'Maintain proper spacing from other traffic and request go-around if necessary.',
  },
  {
    id: 'engine-out-climb',
    title: 'Engine Failure After V1 KSEA to KPDX',
    description:
      'Depart KSEA in a Boeing 737-800 for Portland. ' +
      'Single-engine failure occurs at V1+50 during the climb-out — ' +
      'practice proper ATC communication while handling the emergency.',
    origin: 'KSEA',
    destination: 'KPDX',
    aircraft: 'B738',
    inject: 'engine_failure',
    goal:
      'Declare the emergency, follow ATC vectors to a safe return to KSEA, ' +
      'and execute the approach without additional readback errors.',
  },
  {
    id: 'weather-deviation',
    title: 'Weather Deviation En Route',
    description:
      'Cruise a regional flight from KLAX to KSFO at FL350. ' +
      'Unexpected convective weather along the planned route requires requesting a deviation. ' +
      'Practice professional communication and negotiation with center control.',
    origin: 'KLAX',
    destination: 'KSFO',
    aircraft: 'CRJ9',
    inject: 'weather_deviation',
    goal:
      'Request an IFR deviation, receive clearance within 2 readbacks, ' +
      'and resume original flight plan once weather clears.',
  },
  {
    id: 'busy-arrival',
    title: 'Busy-Frequency Arrival at KLAX',
    description:
      'Arrive at Los Angeles International during high-traffic conditions (peak afternoon slot). ' +
      'The frequency is congested; practice brevity, listen-first discipline, and assertiveness.',
    origin: 'KSFO',
    destination: 'KLAX',
    aircraft: 'A320',
    inject: 'busy_frequency',
    goal:
      'Establish contact with approach, receive multiple vectoring instructions, ' +
      'and execute a clean approach with zero mic discipline violations.',
  },
  {
    id: 'oceanic-crossing',
    title: 'Oceanic Crossing Position Reports',
    description:
      'Conduct a Pacific oceanic flight from PANC (Anchorage) to KSFO ' +
      'at FL380 following NOPAC airway structure. ' +
      'Practice proper position report format and radio discipline over oceanic frequencies.',
    origin: 'PANC',
    destination: 'KSFO',
    aircraft: 'B789',
    inject: 'none',
    goal:
      'File an oceanic flight plan, complete required position reports ' +
      '(1 hour out, then 30-min intervals), and navigate accurately using waypoint fixes.',
  },
  {
    id: 'first-solo',
    title: 'First Solo: KSEA to KPDX',
    description:
      'Your first solo cross-country flight from Seattle to Portland in a Cessna 172. ' +
      'No second pilot; manage all ATC communications independently, ' +
      'weather decisions, and navigation with minimal stress.',
    origin: 'KSEA',
    destination: 'KPDX',
    aircraft: 'C172',
    inject: 'none',
    goal:
      'Maintain composure and clarity in all ATC interactions, ' +
      'file a flight plan, conduct a proper descent/approach at KPDX, ' +
      'and land without readback errors.',
  },
];

/**
 * Retrieve a scenario by ID.
 * @param id The scenario identifier.
 * @returns The scenario object, or null if not found.
 */
export function getScenario(id: string): Scenario | null {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

/**
 * Get all available scenario IDs.
 * @returns An array of scenario IDs suitable for UI dropdown/list.
 */
export function listScenarioIds(): string[] {
  return SCENARIOS.map((s) => s.id);
}

/**
 * Count total available scenarios.
 * @returns The number of scenarios in the library.
 */
export function getScenarioCount(): number {
  return SCENARIOS.length;
}
