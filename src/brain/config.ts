// Loads .env (if present) and exposes typed config. No dependency: Node's built-in loader.
try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on real environment variables / defaults below
}

function splitList(v: string | undefined, fallback: string[]): string[] {
  const parts = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : fallback;
}

export const config = {
  // --- LLM provider (local/downloadable backends only) ---
  /**
   * 'ollama'           -> local Ollama
   * 'openai-compatible'-> any local OpenAI-compatible server: LM Studio, llama.cpp,
   *                       Jan, LocalAI, KoboldCpp, oobabooga, vLLM, GPT4All...
   */
  llmProvider: (process.env.LLM_PROVIDER ?? 'ollama') as 'ollama' | 'openai-compatible',
  /** Base URL for a local OpenAI-compatible server (e.g. http://localhost:1234/v1 for LM Studio). */
  llmBaseUrl: process.env.LLM_BASE_URL ?? '',
  /** API key — usually blank for local servers (some accept any token). */
  llmApiKey: process.env.LLM_API_KEY ?? '',
  /** Model id; if blank, falls back to OLLAMA_MODEL (ollama) or the loaded local model. */
  llmModel: process.env.LLM_MODEL ?? '',
  /** Compute device for the local LLM: 'auto' (let Ollama decide), 'gpu', or 'cpu'. */
  llmDevice: (process.env.LLM_DEVICE ?? 'auto') as 'auto' | 'gpu' | 'cpu',

  ollamaHost: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL ?? 'myaimodels/atc-nlu',

  /** Port the WebSocket comms server listens on (the in-sim widget connects here). */
  wsPort: Number(process.env.WS_PORT ?? 8742),
  /** SimBrief username (Account > Settings). Empty -> built-in sample flight plan. */
  simbriefUsername: process.env.SIMBRIEF_USERNAME ?? '',
  /** SimBrief numeric Pilot ID (alternative to username; takes priority if set). */
  simbriefUserid: process.env.SIMBRIEF_USERID ?? '',
  /**
   * Live AI/MP traffic polling via SimConnect SimObjects. OFF by default — reading other aircraft
   * has been observed to destabilize some setups. Set LIVE_TRAFFIC=1 to opt in (master switch).
   */
  liveTraffic: process.env.LIVE_TRAFFIC === '1' || process.env.LIVE_TRAFFIC === 'true',
  /**
   * Granular traffic sub-toggles, to ISOLATE which part destabilizes MSFS. Each independently
   * enabled via env. All require liveTraffic=1 (the master). Defaults chosen as the safest combo.
   *  TRAFFIC_POSITION=1  -> read AI positions via requestDataOnSimObjectType (default on if master)
   *  TRAFFIC_STRINGS=1   -> ALSO read string vars (ATC ID/AIRLINE/TITLE). KNOWN CRASH RISK; default OFF
   *  TRAFFIC_POLL=1      -> run the periodic poll loop (default on if master)
   *  TRAFFIC_ADVISORIES=1-> emit proactive traffic callouts from the picture (default on if master)
   */
  trafficOptions: {
    position: process.env.TRAFFIC_POSITION !== '0',
    strings: process.env.TRAFFIC_STRINGS === '1' || process.env.TRAFFIC_STRINGS === 'true',
    poll: process.env.TRAFFIC_POLL !== '0',
    advisories: process.env.TRAFFIC_ADVISORIES !== '0',
  },
  /** Path to Navigraph DFD .s3db (or an aircraft's DFD nav DB). Empty/missing -> skipped. */
  navdataPath: process.env.NAVDATA_PATH ?? '',
  /**
   * Ordered navdata fallback chain; first source with data wins per field.
   *  'sim'  = MSFS default navdata via SimConnect facilities (real freqs/runways)
   *  'dfd'  = Navigraph DFD SQLite at NAVDATA_PATH (or an aircraft's DFD nav DB)
   *  'mock' = tiny built-in placeholder set (offline last resort)
   */
  navdataSources: splitList(process.env.NAVDATA_SOURCES, ['sim', 'mock']),
  /** 'auto' = use Ollama if reachable; 'on' = require it; 'off' = deterministic only. */
  useLlm: (process.env.USE_LLM ?? 'auto') as 'auto' | 'on' | 'off',

  /**
   * Auto-tune COM1 over SimConnect when a controller hands you off.
   *  'swap' = set standby AND make it active (hands-free)   [default]
   *  'standby' = set standby only; you flip it active yourself (more realistic)
   *  'off' = never touch your radio
   */
  autoTuneCom: (process.env.AUTO_TUNE_COM ?? 'swap') as 'swap' | 'standby' | 'off',

  /**
   * Readback strictness: how hard controllers enforce correct readbacks.
   *  'relaxed' = anything you say is accepted
   *  'normal'  = safety-critical items (altitude/heading/squawk) must be read back  [default]
   *  'strict'  = every assigned item must be read back
   */
  strictness: (process.env.ATC_STRICTNESS ?? 'normal') as 'relaxed' | 'normal' | 'strict',

  /** Ambient AI radio chatter on frequency: 'off' | 'low' | 'medium' | 'high'. */
  chatter: (process.env.ATC_CHATTER ?? 'low') as 'off' | 'low' | 'medium' | 'high',

  /** Regional phraseology: 'us' | 'uk' | 'euro'. */
  region: (process.env.ATC_REGION ?? 'us') as 'us' | 'uk' | 'euro',
  /** Controller tone: 'standard' | 'terse' | 'chatty'. */
  tone: (process.env.ATC_TONE ?? 'standard') as 'standard' | 'terse' | 'chatty',

  /** Hoppie ACARS/CPDLC logon code (optional; enables text datalink). */
  hoppieLogon: process.env.HOPPIE_LOGON ?? '',

  /** Where to persist session state so a flight resumes across an app/brain restart. */
  sessionStatePath: process.env.SESSION_STATE_PATH ?? './cache/session.json',

  /** Disk cache for SimConnect facility data (lets the brain run without the sim). */
  facilityCacheDir: process.env.FACILITY_CACHE_DIR ?? './cache/facilities',
  /** Cache size cap in bytes (default 16 GiB). LRU eviction when exceeded. 0 = unlimited. */
  facilityCacheMaxBytes: Number(process.env.FACILITY_CACHE_MAX_BYTES ?? 16 * 1024 * 1024 * 1024),
  /** Refetch cached airports older than this (days); matches ~AIRAC cycle. 0 = never expire. */
  facilityCacheTtlDays: Number(process.env.FACILITY_CACHE_TTL_DAYS ?? 28),
} as const;
