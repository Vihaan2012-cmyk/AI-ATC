// Local OpenAI-compatible LLM backend, behind the same LlmClient interface.
// Works with any local server that speaks the OpenAI /v1 API: LM Studio, llama.cpp
// server, Jan, LocalAI, KoboldCpp, oobabooga, vLLM, GPT4All, etc.
import type { LlmClient } from './ollama.js';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Pull the first {...} / [...] JSON block out of a possibly-fenced response. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  const start = body.search(/[[{]/);
  if (start === -1) return body.trim();
  return body.slice(start).trim();
}

export class OpenAICompatibleClient implements LlmClient {
  constructor(private baseUrl: string, private apiKey: string, private model: string) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${stripTrailingSlash(this.baseUrl)}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(2500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async chat(prompt: string, json: boolean): Promise<string> {
    const res = await fetch(`${stripTrailingSlash(this.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return String(j.choices?.[0]?.message?.content ?? '');
  }

  async generate(prompt: string): Promise<string> {
    return (await this.chat(prompt, false)).trim();
  }

  async generateJson(prompt: string): Promise<unknown> {
    return JSON.parse(extractJson(await this.chat(prompt, true)));
  }
}
