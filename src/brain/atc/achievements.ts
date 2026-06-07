// Pure, deterministic module for computing achievements/badges from flight statistics.
// No I/O, no Date, no randomness — only functions of the stats object.

export interface Badge {
  id: string;
  title: string;
  description: string;
  earned: boolean;
}

export interface AchievementStats {
  flights: number;
  airportsVisited: number;
  avgReadbackAccuracy: number | null;
  emergencies: number;
  topRoutes?: Array<{ route: string; count: number }>;
}

/**
 * Compute achievement badges from flight statistics.
 * Each badge is earned based on deterministic thresholds.
 */
export function computeAchievements(stats: AchievementStats): Badge[] {
  const badges: Badge[] = [
    {
      id: 'first-flight',
      title: 'First Flight',
      description: 'Complete your first flight',
      earned: stats.flights >= 1,
    },
    {
      id: 'frequent-flyer',
      title: 'Frequent Flyer',
      description: 'Complete 10 flights',
      earned: stats.flights >= 10,
    },
    {
      id: 'centurion',
      title: 'Centurion',
      description: 'Complete 100 flights',
      earned: stats.flights >= 100,
    },
    {
      id: 'globetrotter',
      title: 'Globetrotter',
      description: 'Visit 10 different airports',
      earned: stats.airportsVisited >= 10,
    },
    {
      id: 'sharp-readback',
      title: 'Sharp Readback',
      description: 'Achieve 95% average readback accuracy',
      earned: stats.avgReadbackAccuracy != null && stats.avgReadbackAccuracy >= 95,
    },
    {
      id: 'perfectionist',
      title: 'Perfectionist',
      description: 'Achieve 99% average readback accuracy with 5+ flights',
      earned:
        stats.avgReadbackAccuracy != null &&
        stats.avgReadbackAccuracy >= 99 &&
        stats.flights >= 5,
    },
    {
      id: 'emergency-handled',
      title: 'Emergency Handler',
      description: 'Declare and handle at least one emergency',
      earned: stats.emergencies >= 1,
    },
    {
      id: 'road-warrior',
      title: 'Road Warrior',
      description: 'Fly the same route 5 times',
      earned: (stats.topRoutes ?? []).some((r) => r.count >= 5),
    },
  ];

  return badges;
}
