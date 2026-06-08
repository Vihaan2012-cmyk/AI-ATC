// Shareable "ATC tape": serialize a flight segment (track points + timestamped transcript +
// optional TTS cues) into a single self-contained JSON document, plus a standalone HTML player
// (returned as a string) that replays the approach with a synced map + transcript scroll.
//
// Pure, deterministic, self-contained module — no I/O, no side effects. Builds on:
//   - trackRecorder.ts  (PositionFrame / SerializedTrack: the flight track)
//   - transcript.ts      (TranscriptEntry: ATC/pilot exchanges)
//   - replay.ts          (buildReplay: aligns transcript events to the nearest frame)
//
// The deterministic engine owns all facts; this module only re-packages already-recorded data.

import { buildReplay, type ReplayFrame, type TranscriptEvent } from './replay.js';
import type { PositionFrame, SerializedTrack } from './trackRecorder.js';
import type { TranscriptEntry } from './transcript.js';

/** Current tape schema version. Bump when the on-disk shape changes incompatibly. */
export const TAPE_VERSION = 1 as const;

/** A single transcript line placed on the tape's timeline. */
export interface TapeCue {
  /** Elapsed time in seconds from the start of the segment when this line is spoken. */
  t: number;
  /** Index of the position frame nearest to this cue (for map highlighting). */
  atFrame: number;
  /** Speaker label, e.g. 'Pilot', 'Tower', 'Approach'. */
  from: string;
  /** Frequency in MHz as a display string, e.g. '118.300' (optional). */
  freq?: string;
  /** The spoken text. */
  text: string;
  /**
   * Optional TTS cue: text to synthesize (defaults to `text`) plus a voice hint so a player
   * can pick a distinct voice for pilot vs. controller. Purely advisory — players may ignore it.
   */
  tts?: TtsCue;
}

/** Advisory text-to-speech cue attached to a tape line. */
export interface TtsCue {
  /** Text to synthesize (may differ from display text, e.g. expanded numbers). */
  say: string;
  /** Voice role hint: 'pilot' or 'atc'. Players map this to a SpeechSynthesis voice. */
  role: 'pilot' | 'atc';
  /** Speaking rate multiplier (1 = normal). Clamped to a sane range by the player. */
  rate?: number;
}

/** Metadata describing the segment captured on the tape. */
export interface TapeMeta {
  /** Flight callsign, e.g. 'SWA1234'. */
  callsign?: string;
  /** Spoken telephony, e.g. 'Southwest 1234'. */
  telephony?: string;
  /** Aircraft ICAO type, e.g. 'B738'. */
  aircraftIcao?: string;
  /** Origin ICAO. */
  origin?: string;
  /** Destination ICAO. */
  destination?: string;
  /** Free-form segment label, e.g. 'ILS 16R approach into KSEA'. */
  title?: string;
  /** When the underlying flight was recorded (ISO 8601). */
  recordedAt?: string;
  /** When this tape was exported (ISO 8601). */
  exportedAt?: string;
  /** Total segment duration in seconds. */
  durationSec?: number;
}

/** The complete, shareable ATC tape document (one JSON object). */
export interface AtcTape {
  /** Schema version (== TAPE_VERSION at write time). */
  version: number;
  /** A short type tag so consumers can sniff the document. */
  kind: 'atc-tape';
  meta: TapeMeta;
  /** Position track for the map (downsampled flight frames). */
  frames: PositionFrame[];
  /** Timestamped transcript cues, aligned to frames and ordered by time. */
  cues: TapeCue[];
}

/** Inputs to {@link buildTape}: a track + transcript + metadata + options. */
export interface BuildTapeInput {
  /** Flight track: either a SerializedTrack or a bare frame array. */
  track: SerializedTrack | PositionFrame[];
  /** ATC/pilot transcript entries (from transcript.ts). */
  transcript: TranscriptEntry[];
  /** Optional metadata overrides (merged over anything derived from the track). */
  meta?: TapeMeta;
}

/** Options controlling tape construction. */
export interface BuildTapeOptions {
  /** When true, attach advisory TTS cues to every line (default: true). */
  withTts?: boolean;
}

/**
 * Build a shareable ATC tape from a recorded track + transcript.
 *
 * Reuses {@link buildReplay} to align each transcript line to the nearest position frame, then
 * derives a per-cue elapsed time `t` from that frame so a player can drive playback off a single
 * clock. Cues are sorted by time. Optionally attaches advisory TTS cues (pilot/ATC voice roles).
 *
 * Fully deterministic: identical inputs produce identical output (aside from `exportedAt`, which
 * is taken from `meta.exportedAt` when provided so callers can pin it for tests).
 *
 * @param input Track + transcript + metadata.
 * @param options Tape construction options.
 * @returns A complete {@link AtcTape}.
 */
export function buildTape(input: BuildTapeInput, options?: BuildTapeOptions): AtcTape {
  const withTts = options?.withTts ?? true;

  // Normalize the track to frames + metadata.
  const serialized: SerializedTrack | null = Array.isArray(input.track)
    ? null
    : input.track;
  const frames: PositionFrame[] = Array.isArray(input.track)
    ? input.track
    : input.track.frames ?? [];

  // Replay frames share the PositionFrame shape (t, lat, lon, altFt, hdg).
  const replayFrames: ReplayFrame[] = frames.map((f) => ({
    t: f.t,
    lat: f.lat,
    lon: f.lon,
    altFt: f.altFt,
    hdg: f.hdg,
  }));

  // Convert transcript entries into replay events. Prefer a numeric (seconds) ts when present so
  // buildReplay can place lines exactly; otherwise it falls back to sequential distribution.
  const events: TranscriptEvent[] = (input.transcript ?? [])
    .filter((e) => e.text && e.text.trim().length > 0)
    .map((e) => ({
      ts: e.ts != null ? String(e.ts) : undefined,
      from: e.from,
      text: e.text.trim(),
    }));

  const replay = buildReplay(replayFrames, events);

  // Map aligned replay events back to rich cues. The source transcript and replay.events are
  // 1:1 and in the same order, so we can zip them to recover freq + build TTS cues.
  const cues: TapeCue[] = replay.events.map((ev, i) => {
    const src = sourceEntryFor(input.transcript, ev.text, i);
    const frame = replayFrames[ev.atFrame];
    const t = frame ? frame.t : 0;
    const from = ev.speaker?.trim() || src?.from?.trim() || 'Unknown';
    const cue: TapeCue = {
      t,
      atFrame: ev.atFrame,
      from,
      text: ev.text,
    };
    const freq = formatFreq(src?.freq);
    if (freq) cue.freq = freq;
    if (withTts) cue.tts = buildTtsCue(from, ev.text);
    return cue;
  }).sort((a, b) => a.t - b.t || a.atFrame - b.atFrame);

  // Derive duration: prefer track meta, else span of frames, else span of cues.
  const frameSpan = frames.length > 0
    ? Math.round((frames[frames.length - 1]!.t) - (frames[0]?.t ?? 0))
    : 0;
  const cueSpan = cues.length > 0 ? Math.round(cues[cues.length - 1]!.t - cues[0]!.t) : 0;
  const durationSec = serialized?.meta?.durationSec ?? (frameSpan || cueSpan);

  const meta: TapeMeta = {
    callsign: input.meta?.callsign ?? serialized?.meta?.callsign,
    telephony: input.meta?.telephony,
    aircraftIcao: input.meta?.aircraftIcao ?? serialized?.meta?.aircraftIcao,
    origin: input.meta?.origin ?? serialized?.meta?.origin,
    destination: input.meta?.destination ?? serialized?.meta?.destination,
    title: input.meta?.title,
    recordedAt: input.meta?.recordedAt ?? serialized?.meta?.recordedAt,
    exportedAt: input.meta?.exportedAt ?? new Date().toISOString(),
    durationSec,
  };

  return {
    version: TAPE_VERSION,
    kind: 'atc-tape',
    meta,
    frames,
    cues,
  };
}

/**
 * Find the source transcript entry that produced an aligned replay event. Events preserve input
 * order, so index `i` is the primary match; we fall back to a text match for safety.
 */
function sourceEntryFor(
  transcript: TranscriptEntry[] | undefined,
  text: string,
  i: number
): TranscriptEntry | undefined {
  if (!transcript || transcript.length === 0) return undefined;
  // Filter mirrors buildTape's event filter, so indices line up with replay.events.
  const filtered = transcript.filter((e) => e.text && e.text.trim().length > 0);
  const byIndex = filtered[i];
  if (byIndex && byIndex.text.trim() === text) return byIndex;
  return filtered.find((e) => e.text.trim() === text) ?? byIndex;
}

/** Format a frequency (number kHz/MHz or string) into a 3-decimal MHz display string. */
function formatFreq(freq: string | number | undefined): string | undefined {
  if (freq == null || freq === '') return undefined;
  if (typeof freq === 'string') {
    return freq.includes('.') ? freq : freqFromRaw(freq);
  }
  return freqFromRaw(String(freq));
}

/** Normalize a raw frequency token: kHz integers (e.g. 118300) become MHz; MHz stays as-is. */
function freqFromRaw(raw: string): string | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  // Treat values >= 1000 as kHz (e.g. 118300 -> 118.300), otherwise as MHz already.
  const mhz = n >= 1000 ? n / 1000 : n;
  return mhz.toFixed(3);
}

/** Build an advisory TTS cue, picking a voice role from the speaker label. */
function buildTtsCue(from: string, text: string): TtsCue {
  const role: 'pilot' | 'atc' = /pilot/i.test(from) ? 'pilot' : 'atc';
  return { say: text, role, rate: role === 'atc' ? 1.05 : 1.0 };
}

/**
 * Serialize a tape to a compact JSON string (single line, share-friendly).
 * @param tape The tape to serialize.
 * @param pretty When true, pretty-print with 2-space indent.
 */
export function tapeToJson(tape: AtcTape, pretty = false): string {
  return pretty ? JSON.stringify(tape, null, 2) : JSON.stringify(tape);
}

/**
 * Parse + validate a tape from JSON. Returns null on malformed input or schema mismatch.
 * @param jsonStr JSON produced by {@link tapeToJson}.
 */
export function tapeFromJson(jsonStr: string): AtcTape | null {
  try {
    const obj = JSON.parse(jsonStr) as unknown;
    return isAtcTape(obj) ? obj : null;
  } catch {
    return null;
  }
}

/** Runtime type guard for an {@link AtcTape}. */
export function isAtcTape(obj: unknown): obj is AtcTape {
  if (typeof obj !== 'object' || obj === null) return false;
  const t = obj as Record<string, unknown>;
  return (
    t.kind === 'atc-tape' &&
    typeof t.version === 'number' &&
    Array.isArray(t.frames) &&
    Array.isArray(t.cues) &&
    typeof t.meta === 'object' &&
    t.meta !== null
  );
}

/**
 * Render a self-contained HTML player for a tape. The returned string is a complete HTML document
 * with the tape embedded as JSON and all CSS/JS inline (no external dependencies, no network). It
 * draws the track on a self-scaling SVG map, animates the aircraft along it, scrolls the transcript
 * in sync, and (if the browser supports SpeechSynthesis) speaks each line from its TTS cue.
 *
 * @param tape The tape to embed.
 * @returns A full HTML document string, ready to write to a .html file and open in any browser.
 */
export function buildTapePlayerHtml(tape: AtcTape): string {
  // Embed the tape safely: JSON.stringify, then neutralize any '</' so a stray "</script>" inside
  // transcript text can't break out of the inline <script> element.
  const embedded = JSON.stringify(tape).replace(/</g, '\\u003c');
  const title = escapeHtml(
    tape.meta.title ||
      `${tape.meta.callsign ?? 'Flight'} — ${tape.meta.origin ?? '?'} to ${tape.meta.destination ?? '?'}`
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ATC Tape — ${title}</title>
<style>
  :root { --bg:#0b1018; --panel:#121a26; --line:#1e2a3a; --fg:#dbe6f3; --dim:#8aa0bc;
          --pilot:#5fd0ff; --atc:#ffd15f; --track:#3b6ea5; --ac:#ffae42; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg);
    font: 14px/1.45 system-ui, "Segoe UI", Roboto, sans-serif; }
  .wrap { display: flex; flex-direction: column; height: 100%; }
  header { padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--panel); }
  header h1 { margin: 0; font-size: 15px; }
  header .sub { color: var(--dim); font-size: 12px; margin-top: 2px; }
  .main { flex: 1; display: flex; min-height: 0; }
  .mapwrap { flex: 1; position: relative; min-width: 0; }
  svg { width: 100%; height: 100%; display: block; background:
    radial-gradient(circle at 50% 40%, #14202f 0%, #0b1018 80%); }
  .side { width: 340px; max-width: 45%; border-left: 1px solid var(--line);
    background: var(--panel); display: flex; flex-direction: column; min-height: 0; }
  .cues { flex: 1; overflow-y: auto; padding: 8px; }
  .cue { padding: 6px 8px; border-radius: 6px; margin-bottom: 4px; border: 1px solid transparent; }
  .cue .who { font-weight: 600; font-size: 12px; }
  .cue.pilot .who { color: var(--pilot); }
  .cue.atc .who { color: var(--atc); }
  .cue .freq { color: var(--dim); font-weight: 400; font-size: 11px; }
  .cue .txt { margin-top: 2px; }
  .cue.active { background: #1b2940; border-color: #335; }
  .hud { position: absolute; left: 10px; top: 10px; background: rgba(10,16,24,.78);
    border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 12px;
    color: var(--dim); }
  .hud b { color: var(--fg); font-variant-numeric: tabular-nums; }
  .controls { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
    border-top: 1px solid var(--line); }
  button { background: #1c2a3c; color: var(--fg); border: 1px solid var(--line);
    border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
  button:hover { background: #243650; }
  input[type=range] { flex: 1; }
  .t { color: var(--dim); font-variant-numeric: tabular-nums; min-width: 84px; text-align: right; }
  label.tts { color: var(--dim); display: flex; align-items: center; gap: 4px; cursor: pointer; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1 id="title"></h1>
    <div class="sub" id="sub"></div>
  </header>
  <div class="main">
    <div class="mapwrap">
      <svg id="map" preserveAspectRatio="xMidYMid meet" viewBox="0 0 1000 1000">
        <polyline id="track" fill="none" stroke="var(--track)" stroke-width="2.5"
          stroke-linejoin="round" stroke-linecap="round" />
        <polyline id="flown" fill="none" stroke="var(--ac)" stroke-width="2.5"
          stroke-linejoin="round" stroke-linecap="round" />
        <circle id="ac" r="5" fill="var(--ac)" stroke="#000" stroke-width="1" />
      </svg>
      <div class="hud" id="hud"></div>
    </div>
    <div class="side">
      <div class="cues" id="cues"></div>
      <div class="controls">
        <button id="play">Play</button>
        <input type="range" id="seek" min="0" max="1000" value="0" step="1" />
        <span class="t" id="clock">0:00 / 0:00</span>
      </div>
      <div class="controls" style="border-top:none; padding-top:0;">
        <label class="tts"><input type="checkbox" id="ttsOn" /> Speak (TTS)</label>
        <span style="flex:1"></span>
        <button id="restart">Restart</button>
      </div>
    </div>
  </div>
</div>
<script id="tape" type="application/json">${embedded}</script>
<script>
(function () {
  "use strict";
  var tape;
  try { tape = JSON.parse(document.getElementById("tape").textContent); }
  catch (e) { document.body.textContent = "Invalid tape data."; return; }

  var frames = (tape.frames || []).slice().sort(function (a, b) { return a.t - b.t; });
  var cues = (tape.cues || []).slice().sort(function (a, b) { return a.t - b.t; });
  var meta = tape.meta || {};

  var t0 = frames.length ? frames[0].t : (cues.length ? cues[0].t : 0);
  var tEnd = 0;
  if (frames.length) tEnd = Math.max(tEnd, frames[frames.length - 1].t);
  if (cues.length) tEnd = Math.max(tEnd, cues[cues.length - 1].t);
  var duration = Math.max(0, tEnd - t0);

  // Title + subtitle
  var title = meta.title || ((meta.callsign || "Flight") + " — " + (meta.origin || "?") + " to " + (meta.destination || "?"));
  document.getElementById("title").textContent = title;
  var subBits = [];
  if (meta.callsign) subBits.push(meta.callsign);
  if (meta.aircraftIcao) subBits.push(meta.aircraftIcao);
  if (meta.recordedAt) subBits.push(new Date(meta.recordedAt).toLocaleString());
  subBits.push(fmtTime(duration) + " long");
  document.getElementById("sub").textContent = subBits.join("  •  ");

  // --- Map projection: equirectangular, scaled to a padded 1000x1000 viewBox -----------------
  var PAD = 60, VB = 1000;
  var lats = frames.map(function (f) { return f.lat; });
  var lons = frames.map(function (f) { return f.lon; });
  var minLat = Math.min.apply(null, lats.length ? lats : [0]);
  var maxLat = Math.max.apply(null, lats.length ? lats : [1]);
  var minLon = Math.min.apply(null, lons.length ? lons : [0]);
  var maxLon = Math.max.apply(null, lons.length ? lons : [1]);
  // Correct longitude for latitude (degrees of lon are narrower away from the equator).
  var midLat = (minLat + maxLat) / 2;
  var lonScale = Math.max(0.05, Math.cos(midLat * Math.PI / 180));
  var spanLat = Math.max(1e-6, maxLat - minLat);
  var spanLon = Math.max(1e-6, (maxLon - minLon) * lonScale);
  var span = Math.max(spanLat, spanLon);
  var inner = VB - PAD * 2;

  function project(lat, lon) {
    var x = ((lon - minLon) * lonScale) / span * inner + PAD;
    // Flip Y so north is up.
    var y = VB - (((lat - minLat) / span) * inner + PAD);
    // Centre the smaller axis.
    var ox = (inner - (spanLon / span) * inner) / 2;
    var oy = (inner - (spanLat / span) * inner) / 2;
    return [x + ox, y - oy];
  }

  var pts = frames.map(function (f) { return project(f.lat, f.lon); });
  document.getElementById("track").setAttribute("points",
    pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "));

  var acEl = document.getElementById("ac");
  var flownEl = document.getElementById("flown");
  var hudEl = document.getElementById("hud");

  // --- Transcript list -----------------------------------------------------------------------
  var cueEls = [];
  var cuesBox = document.getElementById("cues");
  cues.forEach(function (c, i) {
    var div = document.createElement("div");
    var role = /pilot/i.test(c.from || "") ? "pilot" : "atc";
    div.className = "cue " + role;
    var who = document.createElement("div");
    who.className = "who";
    who.textContent = c.from || "Unknown";
    if (c.freq) { var f = document.createElement("span"); f.className = "freq"; f.textContent = "  " + c.freq; who.appendChild(f); }
    var txt = document.createElement("div");
    txt.className = "txt";
    txt.textContent = c.text || "";
    div.appendChild(who); div.appendChild(txt);
    div.addEventListener("click", function () { seekTo((c.t - t0)); });
    cuesBox.appendChild(div);
    cueEls.push(div);
  });

  // --- Playback clock ------------------------------------------------------------------------
  var playing = false, elapsed = 0, lastTick = 0, raf = 0, spokenIdx = -1, activeIdx = -1;
  var playBtn = document.getElementById("play");
  var seek = document.getElementById("seek");
  var clock = document.getElementById("clock");
  var ttsOn = document.getElementById("ttsOn");

  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    var m = Math.floor(s / 60), sec = s % 60;
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  function frameAt(tAbs) {
    if (!frames.length) return null;
    var lo = 0, hi = frames.length - 1;
    if (tAbs <= frames[0].t) return { i: 0, f: frames[0], next: frames[0], k: 0 };
    if (tAbs >= frames[hi].t) return { i: hi, f: frames[hi], next: frames[hi], k: 0 };
    while (lo < hi - 1) {
      var mid = (lo + hi) >> 1;
      if (frames[mid].t <= tAbs) lo = mid; else hi = mid;
    }
    var a = frames[lo], b = frames[hi];
    var k = (tAbs - a.t) / Math.max(1e-6, (b.t - a.t));
    return { i: lo, f: a, next: b, k: k };
  }

  function render() {
    var tAbs = t0 + elapsed;
    var info = frameAt(tAbs);
    if (info) {
      var pa = project(info.f.lat, info.f.lon);
      var pb = project(info.next.lat, info.next.lon);
      var x = pa[0] + (pb[0] - pa[0]) * info.k;
      var y = pa[1] + (pb[1] - pa[1]) * info.k;
      acEl.setAttribute("cx", x.toFixed(1));
      acEl.setAttribute("cy", y.toFixed(1));
      var flown = pts.slice(0, info.i + 1).concat([[x, y]]);
      flownEl.setAttribute("points", flown.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "));
      var alt = Math.round(info.f.altFt + (info.next.altFt - info.f.altFt) * info.k);
      var hdg = Math.round(info.f.hdg);
      hudEl.innerHTML = "ALT <b>" + alt.toLocaleString() + "</b> ft<br>HDG <b>" + (hdg < 100 ? "0" : "") + (hdg < 10 ? "0" : "") + hdg + "</b>";
    }
    // Active transcript line = latest cue at or before now.
    var idx = -1;
    for (var i = 0; i < cues.length; i++) { if (cues[i].t - t0 <= elapsed + 0.001) idx = i; else break; }
    if (idx !== activeIdx) {
      if (activeIdx >= 0 && cueEls[activeIdx]) cueEls[activeIdx].classList.remove("active");
      if (idx >= 0 && cueEls[idx]) {
        cueEls[idx].classList.add("active");
        cueEls[idx].scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      activeIdx = idx;
    }
    // Speak any newly-passed cues (only while playing forward).
    if (ttsOn.checked && playing && idx > spokenIdx) {
      for (var j = spokenIdx + 1; j <= idx; j++) speak(cues[j]);
      spokenIdx = idx;
    }
    seek.value = String(duration > 0 ? Math.round((elapsed / duration) * 1000) : 0);
    clock.textContent = fmtTime(elapsed) + " / " + fmtTime(duration);
  }

  function speak(cue) {
    if (!cue || !("speechSynthesis" in window)) return;
    var tts = cue.tts || { say: cue.text, role: /pilot/i.test(cue.from || "") ? "pilot" : "atc", rate: 1 };
    var u = new SpeechSynthesisUtterance(tts.say || cue.text || "");
    u.rate = Math.min(2, Math.max(0.5, tts.rate || 1));
    u.pitch = tts.role === "pilot" ? 1.05 : 0.95;
    try { window.speechSynthesis.speak(u); } catch (e) {}
  }

  function tick(now) {
    if (!playing) return;
    var dt = (now - lastTick) / 1000;
    lastTick = now;
    elapsed += dt;
    if (elapsed >= duration) { elapsed = duration; render(); stop(); return; }
    render();
    raf = requestAnimationFrame(tick);
  }

  function play() {
    if (duration <= 0) return;
    if (elapsed >= duration) { elapsed = 0; spokenIdx = activeIdx; }
    playing = true; playBtn.textContent = "Pause"; lastTick = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    playing = false; playBtn.textContent = "Play"; cancelAnimationFrame(raf);
    if ("speechSynthesis" in window) try { window.speechSynthesis.cancel(); } catch (e) {}
  }
  function seekTo(sec) {
    elapsed = Math.min(duration, Math.max(0, sec));
    // Mark everything before now as already spoken so a backward seek doesn't replay it.
    spokenIdx = -1;
    for (var i = 0; i < cues.length; i++) { if (cues[i].t - t0 <= elapsed) spokenIdx = i; else break; }
    render();
  }

  playBtn.addEventListener("click", function () { playing ? stop() : play(); });
  document.getElementById("restart").addEventListener("click", function () { stop(); seekTo(0); });
  seek.addEventListener("input", function () {
    if (playing) stop();
    seekTo((Number(seek.value) / 1000) * duration);
  });

  render();
})();
</script>
</body>
</html>`;
}

/** Escape a string for safe insertion into HTML text/attribute context. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
