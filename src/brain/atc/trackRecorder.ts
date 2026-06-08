// Flight position track recorder for replay: captures position samples from the server,
// downsamples to reduce logbook size (~1 frame per few seconds), and exports for replay visualization.
// Pure, deterministic, self-contained module—no I/O or side effects.

export interface PositionFrame {
  /** Elapsed time in seconds since recording start */
  t: number;
  /** Latitude in decimal degrees */
  lat: number;
  /** Longitude in decimal degrees */
  lon: number;
  /** Altitude in feet */
  altFt: number;
  /** Heading in degrees (0-359) */
  hdg: number;
}

export interface TrackMetadata {
  /** Flight callsign, e.g. 'SWA1234' */
  callsign?: string;
  /** Aircraft ICAO type, e.g. 'B738' */
  aircraftIcao?: string;
  /** Origin ICAO code */
  origin?: string;
  /** Destination ICAO code */
  destination?: string;
  /** Recording start time (ISO 8601) */
  recordedAt?: string;
  /** Total flight duration in seconds */
  durationSec?: number;
}

export interface SerializedTrack {
  /** Downsampled position frames */
  frames: PositionFrame[];
  /** Optional metadata for context */
  meta?: TrackMetadata;
}

/**
 * Recorder for flight position tracks. Captures position updates from the server,
 * applies downsampling to keep memory bounded, and provides serialization for storage.
 *
 * Downsampling strategy: keeps approximately 1 frame per interval (default ~3-5 seconds),
 * always preserves the first and last frames, and caps the total frame count at 2400
 * (enough for ~3 hours at ~5-sec intervals).
 *
 * Usage (in a session/server context):
 * ```
 * const recorder = new TrackRecorder({ interval: 4, maxFrames: 2400 });
 *
 * // Each time server emits {type:'position', lat, lon, hdg, altFt, gsKt, onGround, ...}:
 * recorder.add({ t: elapsedSeconds, lat, lon, altFt, hdg });
 *
 * // When saving to logbook:
 * const track = recorder.serialize('SWA1234', 'B738', 'KORD', 'KJFK');
 * logbook.saveTrack(track);
 *
 * // For replay:
 * const frames = recorder.frames();
 * buildReplay(frames, transcriptEvents);
 * ```
 */
export class TrackRecorder {
  private _frames: PositionFrame[] = [];
  private startTime: number = 0;
  private interval: number; // Downsample interval in seconds
  private maxFrames: number; // Maximum frames to keep
  private lastAddedTime: number = 0;

  /**
   * Create a new track recorder.
   * @param options.interval Target downsampling interval in seconds (default: 4)
   * @param options.maxFrames Maximum frames to keep (default: 2400 for ~3h @ 5s intervals)
   */
  constructor(options?: { interval?: number; maxFrames?: number }) {
    this.interval = options?.interval ?? 4;
    this.maxFrames = options?.maxFrames ?? 2400;
  }

  /**
   * Add a position frame. Automatically downsamples based on the configured interval.
   * Always accepts the first frame and the last if sufficient time has elapsed.
   *
   * @param frame Position update: {t, lat, lon, altFt, hdg}
   */
  public add(frame: PositionFrame): void {
    // Initialize start time on first frame
    if (this._frames.length === 0) {
      this.startTime = frame.t;
    }

    // Downsample: skip frames within the interval, unless we're near the limit
    const timeSinceLastFrame = frame.t - this.lastAddedTime;
    const nearCapacity = this._frames.length >= this.maxFrames - 1;

    // Accept frame if:
    // - First frame (always), OR
    // - Enough time has elapsed since last frame AND not at capacity, OR
    // - We're near capacity (preserve recent activity)
    if (
      this._frames.length === 0 ||
      (timeSinceLastFrame >= this.interval && !nearCapacity) ||
      nearCapacity
    ) {
      this._frames.push(frame);
      this.lastAddedTime = frame.t;

      // If we've exceeded max, prune older frames (keeping first and last)
      if (this._frames.length > this.maxFrames) {
        this.pruneOldest();
      }
    }
  }

  /**
   * Get all recorded frames (downsampled).
   */
  public frames(): PositionFrame[] {
    return [...this._frames];
  }

  /**
   * Clear all recorded frames.
   */
  public clear(): void {
    this._frames = [];
    this.startTime = 0;
    this.lastAddedTime = 0;
  }

  /**
   * Serialize the track for storage (e.g., in logbook). Includes metadata and frames.
   * @param callsign Flight callsign (optional)
   * @param aircraftIcao Aircraft type (optional)
   * @param origin Origin ICAO code (optional)
   * @param destination Destination ICAO code (optional)
   * @returns Serialized track ready for JSON storage
   */
  public serialize(
    callsign?: string,
    aircraftIcao?: string,
    origin?: string,
    destination?: string
  ): SerializedTrack {
    const durationSec = this._frames.length > 0
      ? this._frames[this._frames.length - 1]!.t - (this._frames[0]?.t ?? 0)
      : 0;

    return {
      frames: this._frames,
      meta: {
        callsign,
        aircraftIcao,
        origin,
        destination,
        recordedAt: new Date().toISOString(),
        durationSec: Math.round(durationSec),
      },
    };
  }

  /**
   * Prune the oldest middle frames when capacity is exceeded.
   * Keeps the first frame (start) and last frame (current position).
   */
  private pruneOldest(): void {
    if (this._frames.length <= 2) return;

    // Remove every other frame from the middle, keeping start and end
    const newFrames: PositionFrame[] = [this._frames[0]!];
    for (let i = 1; i < this._frames.length - 1; i += 2) {
      newFrames.push(this._frames[i]!);
    }
    newFrames.push(this._frames[this._frames.length - 1]!);

    this._frames = newFrames;
  }
}

/**
 * Helper to export a track as JSON for storage.
 * @param track Serialized track from TrackRecorder.serialize()
 * @returns JSON string representation
 */
export function trackToJson(track: SerializedTrack): string {
  return JSON.stringify(track, null, 2);
}

/**
 * Helper to load a track from JSON.
 * @param jsonStr JSON string from trackToJson()
 * @returns Deserialized track, or null if parsing fails
 */
export function trackFromJson(jsonStr: string): SerializedTrack | null {
  try {
    return JSON.parse(jsonStr) as SerializedTrack;
  } catch {
    return null;
  }
}
