// LLM layer. Pluggable across providers (Ollama / OpenAI-compatible / Anthropic);
// the brain runs deterministically when createLlm() returns null.
import { config } from '../config.js';
import { OpenAICompatibleClient } from './providers.js';

export interface LlmClient {
  /** Whether the backend is reachable/usable. */
  available(): Promise<boolean>;
  /** Free-text generation. */
  generate(prompt: string, opts?: Record<string, unknown>): Promise<string>;
  /** JSON-constrained generation; returns parsed object. */
  generateJson(prompt: string, opts?: Record<string, unknown>): Promise<unknown>;
}

// Map the device setting to Ollama's num_gpu (0 = CPU only, large = all layers on GPU).
function deviceOpts(): Record<string, unknown> {
  if (config.llmDevice === 'cpu') return { num_gpu: 0 };
  if (config.llmDevice === 'gpu') return { num_gpu: 999 };
  return {};
}

export class OllamaClient implements LlmClient {
  constructor(private host: string, private model: string) {}

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(2500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(prompt: string, opts: Record<string, unknown> = {}): Promise<string> {
    const res = await fetch(`${this.host}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: { temperature: 0, ...deviceOpts(), ...opts },
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { response?: string };
    return String(j.response ?? '').trim();
  }

  async generateJson(prompt: string, opts: Record<string, unknown> = {}): Promise<unknown> {
    const res = await fetch(`${this.host}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        format: 'json',
        options: { temperature: 0, ...deviceOpts(), ...opts },
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { response?: string };
    return JSON.parse(String(j.response ?? '{}'));
  }
}

/** Build the configured client (no availability check). */
export function buildLlmClient(): LlmClient {
  switch (config.llmProvider) {
    case 'openai-compatible':
      return new OpenAICompatibleClient(
        config.llmBaseUrl || 'http://localhost:1234/v1',
        config.llmApiKey,
        config.llmModel || 'local-model',
      );
    case 'ollama':
    default:
      return new OllamaClient(config.ollamaHost, config.llmModel || config.ollamaModel);
  }
}

/**
 * Returns the configured LLM client if reachable (or required), else null so callers
 * fall back to deterministic behavior. Honors USE_LLM=off|on|auto and LLM_PROVIDER.
 */
export async function createLlm(): Promise<LlmClient | null> {
  if (config.useLlm === 'off') return null;
  const client = buildLlmClient();
  const ok = await client.available();
  if (!ok) {
    if (config.useLlm === 'on') {
      throw new Error(`USE_LLM=on but the ${config.llmProvider} backend is not reachable/usable`);
    }
    return null;
  }
  return client;
}
