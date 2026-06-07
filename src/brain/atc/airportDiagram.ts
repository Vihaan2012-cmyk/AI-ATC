// Deterministic airport diagram data builder: transforms runway and parking data
// into normalized 0..1 SVG-space coordinates for top-down airport diagrams.
// Pure, self-contained geometry — no external dependencies.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const NM_TO_FT = 6076.12;
const FT_TO_NM = 1 / NM_TO_FT;

/**
 * Input specification for airport diagram geometry.
 */
export interface AirportDiagramInput {
  /** Runway definitions: identifier, true heading, length in feet. */
  runways: Array<{ ident: string; headingTrue: number; lengthFt: number }>;
  /** Optional parking/gate positions with name and optional lat/lon. */
  parking?: Array<{ name: string; lat?: number; lon?: number }>;
  /** Optional reference point for lat/lon projections; defaults to (0,0). */
  center?: { lat: number; lon: number };
}

/**
 * Runway in normalized SVG space (0..1 in both axes).
 */
export interface DiagramRunway {
  ident: string;
  x1: number; // Start point x (0..1)
  y1: number; // Start point y (0..1)
  x2: number; // End point x (0..1)
  y2: number; // End point y (0..1)
}

/**
 * Gate/parking position in normalized SVG space (0..1 in both axes).
 */
export interface DiagramGate {
  name: string;
  x: number; // Position x (0..1)
  y: number; // Position y (0..1)
}

/**
 * Diagram output: runways and gates in normalized SVG-space coordinates.
 */
export interface AirportDiagram {
  runways: DiagramRunway[];
  gates: DiagramGate[];
}

/**
 * Build a top-down airport diagram in normalized SVG space (0..1).
 *
 * Runways are projected from their center point along their heading for their length.
 * If lat/lon coordinates are provided for parking spots, they are projected around
 * the center point using simple equirectangular projection.
 *
 * All coordinates are normalized to fit within 0..1 on both axes, with the entire
 * airport centered in the diagram.
 *
 * @param input Airport geometry (runways, optional parking, optional center)
 * @returns Diagram with runways and gates in SVG-space coordinates
 */
export function buildDiagram(input: AirportDiagramInput): AirportDiagram {
  const center = input.center ?? { lat: 0, lon: 0 };

  // Convert runway lengths from feet to nautical miles
  const runwayPts: Array<{ ident: string; x1: number; y1: number; x2: number; y2: number; raw: boolean }> = [];
  for (const rwy of input.runways) {
    const lengthNm = rwy.lengthFt * FT_TO_NM;
    // Project runway from center point
    const halfLen = lengthNm / 2;
    const headingRad = rwy.headingTrue * D2R;
    const x1 = -halfLen * Math.sin(headingRad);
    const y1 = -halfLen * Math.cos(headingRad);
    const x2 = halfLen * Math.sin(headingRad);
    const y2 = halfLen * Math.cos(headingRad);
    runwayPts.push({ ident: rwy.ident, x1, y1, x2, y2, raw: true });
  }

  // Convert parking lat/lon to diagram space if provided
  const parkingPts: Array<{ name: string; x: number; y: number; raw: boolean }> = [];
  if (input.parking) {
    for (const spot of input.parking) {
      if (spot.lat != null && spot.lon != null) {
        // Simple equirectangular projection relative to center
        const dlat = (spot.lat - center.lat) * D2R;
        const dlon = (spot.lon - center.lon) * D2R;
        const x = dlon * Math.cos(center.lat * D2R) * NM_TO_FT * FT_TO_NM; // Convert to NM
        const y = dlat * NM_TO_FT * FT_TO_NM; // Convert to NM
        parkingPts.push({ name: spot.name, x, y, raw: true });
      } else {
        // Parking without coordinates: place at origin
        parkingPts.push({ name: spot.name, x: 0, y: 0, raw: true });
      }
    }
  }

  // Compute bounding box in raw coordinates
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const rwy of runwayPts) {
    minX = Math.min(minX, rwy.x1, rwy.x2);
    maxX = Math.max(maxX, rwy.x1, rwy.x2);
    minY = Math.min(minY, rwy.y1, rwy.y2);
    maxY = Math.max(maxY, rwy.y1, rwy.y2);
  }
  for (const spot of parkingPts) {
    minX = Math.min(minX, spot.x);
    maxX = Math.max(maxX, spot.x);
    minY = Math.min(minY, spot.y);
    maxY = Math.max(maxY, spot.y);
  }

  // Add a 10% margin around the bounds
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const margin = Math.max(width, height) * 0.1;
  minX -= margin;
  maxX += margin;
  minY -= margin;
  maxY += margin;

  const scaledWidth = maxX - minX;
  const scaledHeight = maxY - minY;

  // Normalize to 0..1 space, centered
  const normalize = (x: number, y: number): { x: number; y: number } => {
    const nx = (x - minX) / scaledWidth;
    const ny = (y - minY) / scaledHeight;
    return { x: Math.max(0, Math.min(1, nx)), y: Math.max(0, Math.min(1, ny)) };
  };

  // Convert runways
  const runways: DiagramRunway[] = runwayPts.map((rwy) => {
    const p1 = normalize(rwy.x1, rwy.y1);
    const p2 = normalize(rwy.x2, rwy.y2);
    return { ident: rwy.ident, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  });

  // Convert gates
  const gates: DiagramGate[] = parkingPts.map((spot) => {
    const p = normalize(spot.x, spot.y);
    return { name: spot.name, x: p.x, y: p.y };
  });

  return { runways, gates };
}
