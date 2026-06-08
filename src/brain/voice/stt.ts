// Local speech-to-text for the ATC brain.
//
// Architecture note (HYBRID): STT is a pure *transport* layer — it turns a recorded WAV of the
// pilot's transmission into text and hands that text to the same deterministic NLU pipeline the
// typed input uses. It invents NO facts: it only transcribes. The whisper.cpp binary + model run
// entirely on the user's machine (no cloud), matching the "local" design of the rest of the brain.
//
// This module shells out to a whisper.cpp build (the `whisper-cli`/`main` executable) on a 16 kHz
// mono PCM WAV file via child_process. The widget's Web Speech API path (widget/voice-input.js) is
// the in-browser fallback for the Electron context; this server-side path is used when a higher
// quality, fully-offline transcription is wanted (whisper.cpp), or by any non-browser caller.
//
// HARDWARE/EXTERNAL DEPENDENCY — REQUIRES TESTING ON REAL HARDWARE:
//   The transcription is only as good as the recorded audio + the chosen model, and the binary
//   path/model path are environment-specific. This cannot be meaningfully exercised without a real
//   microphone capture and an installed whisper.cpp binary + ggml model. See resolveWhisperConfig()
//   for the env vars, and the README/wiring notes for install instructions.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, unlink } from 'node:fs';
import { dirname } from 'node:path';

/** Configuration for invoking a local whisper.cpp build. */
export interface WhisperConfig {
  /** Absolute path to the whisper.cpp executable (e.g. whisper-cli.exe / main.exe / ./main). */
  binaryPath: string;
  /** Absolute path to the ggml model file (e.g. ggml-base.en.bin). */
  modelPath: string;
  /** Recognition language. 'en' for aviation English; 'auto' to let whisper detect. Default 'en'. */
  language?: string;
  /** Worker threads for whisper.cpp (-t). Default: leave unset (whisper picks a default). */
  threads?: number;
  /** Hard timeout for a single transcription, in ms. Default 30000. */
  timeoutMs?: number;
}

/** Result of a transcription attempt. */
export interface SttResult {
  /** True when transcription produced usable text. */
  ok: boolean;
  /** The transcribed text (trimmed, single line). Empty when ok === false. */
  text: string;
  /** Present when ok === false: a human-readable reason. */
  error?: string;
  /** Wall-clock duration of the whisper.cpp invocation, in ms (for diagnostics). */
  durationMs?: number;
}

/** The contract every speech-to-text engine implements, so callers can swap whisper for another. */
export interface SpeechToText {
  /** True when the engine is configured and its binary + model exist on disk. */
  readonly available: boolean;
  /**
   * Transcribe a recorded WAV file (16 kHz mono PCM recommended) into text.
   * Never throws: failures are returned as { ok:false, error } so the caller (the comms server)
   * can degrade gracefully to "say again".
   */
  transcribeFile(wavPath: string): Promise<SttResult>;
}

/**
 * Resolve a WhisperConfig from environment variables, returning null when STT is not configured.
 * Reads (all optional):
 *   WHISPER_BIN      absolute path to the whisper.cpp executable
 *   WHISPER_MODEL    absolute path to the ggml model (.bin)
 *   WHISPER_LANG     language code (default 'en')
 *   WHISPER_THREADS  integer worker-thread count (default: unset)
 * Returns null if either WHISPER_BIN or WHISPER_MODEL is missing, so callers can cleanly fall back
 * to the widget's Web Speech API path.
 */
export function resolveWhisperConfig(env: NodeJS.ProcessEnv = process.env): WhisperConfig | null {
  const binaryPath = (env.WHISPER_BIN ?? '').trim();
  const modelPath = (env.WHISPER_MODEL ?? '').trim();
  if (!binaryPath || !modelPath) return null;
  const threadsRaw = (env.WHISPER_THREADS ?? '').trim();
  const threads = threadsRaw && Number.isFinite(Number(threadsRaw)) ? Number(threadsRaw) : undefined;
  return {
    binaryPath,
    modelPath,
    language: (env.WHISPER_LANG ?? 'en').trim() || 'en',
    ...(threads != null ? { threads } : {}),
  };
}

/**
 * Clean up whisper.cpp's raw output into a single radio-style line.
 * whisper.cpp prints timestamped segments like "[00:00:00.000 --> 00:00:02.000]  text" when not
 * given an output flag; with --no-timestamps / -nt it prints plain segment lines. We defensively
 * strip any leading "[hh:mm:ss --> hh:mm:ss]" timestamps, collapse whitespace, drop bracketed
 * non-speech annotations (e.g. "[BLANK_AUDIO]", "(wind)"), and join everything onto one line.
 * Pure function — exported for unit testing.
 */
export function cleanTranscript(raw: string): string {
  return raw
    .split(/\r?\n/)
    // Remove leading segment timestamps: "[00:00:00.000 --> 00:00:02.000]".
    .map((line) => line.replace(/^\s*\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/, ''))
    // Drop whole-line non-speech annotations whisper emits in brackets/parens.
    .map((line) => line.replace(/\[(?:BLANK_AUDIO|SILENCE|MUSIC|NOISE|INAUDIBLE)\]/gi, ''))
    .map((line) => line.replace(/^\s*\((?:[^)]*)\)\s*$/g, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A whisper.cpp-backed SpeechToText engine. */
export class WhisperStt implements SpeechToText {
  private readonly cfg: Required<Pick<WhisperConfig, 'binaryPath' | 'modelPath' | 'language' | 'timeoutMs'>> &
    Pick<WhisperConfig, 'threads'>;

  constructor(cfg: WhisperConfig) {
    this.cfg = {
      binaryPath: cfg.binaryPath,
      modelPath: cfg.modelPath,
      language: cfg.language ?? 'en',
      timeoutMs: cfg.timeoutMs ?? 30000,
      ...(cfg.threads != null ? { threads: cfg.threads } : {}),
    };
  }

  /** True only when both the binary and the model file actually exist on disk. */
  get available(): boolean {
    try {
      return existsSync(this.cfg.binaryPath) && existsSync(this.cfg.modelPath);
    } catch {
      return false;
    }
  }

  /**
   * Build the whisper.cpp argument list. Exported-ish (instance method) and pure so the wiring
   * can be reasoned about: model, mono/no-timestamps, language, optional threads, and the WAV.
   * We write the result to a sibling .txt via -otxt so we read transcript from a file rather than
   * parsing stdout (more robust across whisper.cpp builds), but we ALSO clean stdout as a fallback.
   */
  private buildArgs(wavPath: string): string[] {
    const args = ['-m', this.cfg.modelPath, '-l', this.cfg.language, '-nt', '-otxt', '-of', wavPath];
    if (this.cfg.threads != null) args.push('-t', String(this.cfg.threads));
    args.push('-f', wavPath);
    return args;
  }

  transcribeFile(wavPath: string): Promise<SttResult> {
    const started = Date.now();
    if (!this.available) {
      return Promise.resolve({
        ok: false,
        text: '',
        error: `whisper.cpp not available (check WHISPER_BIN=${this.cfg.binaryPath} and WHISPER_MODEL=${this.cfg.modelPath})`,
      });
    }
    if (!existsSync(wavPath)) {
      return Promise.resolve({ ok: false, text: '', error: `audio file not found: ${wavPath}` });
    }
    const args = this.buildArgs(wavPath);
    return new Promise<SttResult>((resolve) => {
      execFile(
        this.cfg.binaryPath,
        args,
        { timeout: this.cfg.timeoutMs, cwd: dirname(this.cfg.binaryPath), windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          const durationMs = Date.now() - started;
          // Prefer the -otxt sidecar file (whisper writes "<wavPath>.txt"); fall back to stdout.
          let text = '';
          const txtPath = `${wavPath}.txt`;
          try {
            if (existsSync(txtPath)) text = cleanTranscript(readFileSync(txtPath, 'utf8'));
          } catch {
            /* fall through to stdout */
          }
          if (!text) text = cleanTranscript(stdout ?? '');
          // Best-effort cleanup of the sidecar so recordings dir doesn't grow.
          unlink(txtPath, () => undefined);

          if (err && !text) {
            resolve({ ok: false, text: '', error: `whisper.cpp failed: ${err.message}`, durationMs });
            return;
          }
          if (!text) {
            resolve({ ok: false, text: '', error: 'no speech detected', durationMs });
            return;
          }
          resolve({ ok: true, text, durationMs });
        },
      );
    });
  }
}

/**
 * Factory: build a WhisperStt from the environment, or null if STT isn't configured.
 * The comms server can call this once at startup and only enable the voice-upload endpoint when
 * a non-null engine that reports `available` comes back.
 */
export function createWhisperFromEnv(env: NodeJS.ProcessEnv = process.env): WhisperStt | null {
  const cfg = resolveWhisperConfig(env);
  return cfg ? new WhisperStt(cfg) : null;
}
