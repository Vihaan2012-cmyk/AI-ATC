/**
 * Flight replay model: aligns transcript events with flight position frames.
 * Pure, deterministic, self-contained module for post-flight replay visualization.
 */

export interface ReplayFrame {
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

export interface TranscriptEvent {
  /** ISO timestamp or elapsed time string (optional) */
  ts?: string;
  /** Speaker (e.g. 'PILOT', 'ATC') */
  from?: string;
  /** Transcript text */
  text: string;
}

export interface ReplayEvent {
  /** Index of the frame nearest to this event's timestamp */
  atFrame: number;
  /** Event text to display */
  text: string;
  /** Speaker/source of the event */
  speaker?: string;
}

export interface Replay {
  /** Flight position frames in order */
  frames: ReplayFrame[];
  /** Transcript events aligned to frames */
  events: ReplayEvent[];
}

/**
 * Builds a replay by aligning transcript events to the nearest position frame.
 *
 * Strategy:
 * - If transcript has numeric timestamps (seconds elapsed), align directly.
 * - If transcript has ISO timestamps, parse them and align to frame times.
 * - If no timestamps, align events sequentially to frames (one per frame or spaced).
 * - Always clamp atFrame to valid frame indices.
 *
 * @param positions - Chronological list of flight position frames
 * @param transcript - List of transcript events with optional timestamps
 * @returns Replay object with frames and time-aligned events
 */
export function buildReplay(
  positions: ReplayFrame[],
  transcript: TranscriptEvent[]
): Replay {
  // Edge cases: empty input
  if (!positions || positions.length === 0) {
    return { frames: [], events: [] };
  }

  if (!transcript || transcript.length === 0) {
    return { frames: positions, events: [] };
  }

  // Detect timestamp format and parse
  const events = parseAndAlignEvents(positions, transcript);

  return {
    frames: positions,
    events,
  };
}

/**
 * Parses transcript timestamps and aligns events to frames.
 * Tries numeric seconds, ISO timestamps, then falls back to sequential alignment.
 */
function parseAndAlignEvents(
  frames: ReplayFrame[],
  transcript: TranscriptEvent[]
): ReplayEvent[] {
  if (transcript.length === 0) return [];

  // Try to detect timestamp type from first non-empty ts
  const firstTs = transcript.find((e) => e.ts)?.ts;

  if (!firstTs) {
    // No timestamps: align sequentially
    return alignSequential(frames, transcript);
  }

  // Try numeric (seconds)
  if (/^\d+(\.\d+)?$/.test(firstTs)) {
    return alignNumeric(frames, transcript);
  }

  // Try ISO timestamp
  if (isIsoLike(firstTs)) {
    return alignIso(frames, transcript);
  }

  // Fallback to sequential
  return alignSequential(frames, transcript);
}

/**
 * Simple check if a string looks like ISO 8601 timestamp.
 */
function isIsoLike(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}[T ]/.test(s);
}

/**
 * Align events where ts is numeric seconds elapsed from start.
 */
function alignNumeric(
  frames: ReplayFrame[],
  transcript: TranscriptEvent[]
): ReplayEvent[] {
  return transcript.map((evt) => {
    const ts = parseFloat(evt.ts ?? "0");
    const frameIdx = findNearestFrame(frames, ts);
    return {
      atFrame: frameIdx,
      text: evt.text,
      speaker: evt.from,
    };
  });
}

/**
 * Align events where ts is ISO timestamp.
 * Converts ISO times to relative seconds from first frame's assumed timestamp.
 */
function alignIso(
  frames: ReplayFrame[],
  transcript: TranscriptEvent[]
): ReplayEvent[] {
  if (frames.length === 0) return [];

  // Try to parse first event's ISO timestamp as reference
  const firstEvent = transcript.find((e) => e.ts);
  if (!firstEvent || !firstEvent.ts) {
    return alignSequential(frames, transcript);
  }

  let refTime: number;
  try {
    refTime = new Date(firstEvent.ts).getTime();
    if (isNaN(refTime)) {
      return alignSequential(frames, transcript);
    }
  } catch {
    return alignSequential(frames, transcript);
  }

  return transcript.map((evt) => {
    if (!evt.ts) {
      // No timestamp: align to frame 0
      return {
        atFrame: 0,
        text: evt.text,
        speaker: evt.from,
      };
    }

    let eventTime: number;
    try {
      eventTime = new Date(evt.ts).getTime();
      if (isNaN(eventTime)) {
        return {
          atFrame: 0,
          text: evt.text,
          speaker: evt.from,
        };
      }
    } catch {
      return {
        atFrame: 0,
        text: evt.text,
        speaker: evt.from,
      };
    }

    // Convert to seconds relative to ref
    const elapsedSec = (eventTime - refTime) / 1000;
    const frameIdx = findNearestFrame(frames, elapsedSec);
    return {
      atFrame: frameIdx,
      text: evt.text,
      speaker: evt.from,
    };
  });
}

/**
 * Align events sequentially when no timestamps available.
 * Distributes events evenly across frames.
 */
function alignSequential(
  frames: ReplayFrame[],
  transcript: TranscriptEvent[]
): ReplayEvent[] {
  if (frames.length === 0) return [];

  const frameCount = frames.length;
  const eventCount = transcript.length;

  return transcript.map((evt, idx) => {
    // Distribute events across frames proportionally
    const frameIdx = Math.floor(
      (idx / Math.max(eventCount - 1, 1)) * Math.max(frameCount - 1, 0)
    );
    return {
      atFrame: Math.min(frameIdx, frameCount - 1),
      text: evt.text,
      speaker: evt.from,
    };
  });
}

/**
 * Find the frame index nearest to a given elapsed time (in seconds).
 * Uses simple linear search; for large frame counts, consider binary search.
 */
function findNearestFrame(frames: ReplayFrame[], targetTime: number): number {
  if (frames.length === 0) return 0;
  if (frames.length === 1) return 0;

  let bestIdx = 0;
  let bestDiff = Math.abs((frames[0]?.t ?? 0) - targetTime);

  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i];
    if (!frame) continue;
    const diff = Math.abs(frame.t - targetTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  return bestIdx;
}
