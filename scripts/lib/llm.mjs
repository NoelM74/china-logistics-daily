/**
 * Model providers.
 *
 * The pipeline does not care who writes the briefing, only that it gets back
 * one JSON object it can validate. This file is the whole difference between
 * providers, so generate-briefing.mjs deals in plain turns and never in
 * vendor-specific message shapes.
 *
 * Two providers:
 *
 *   anthropic  Claude via the official SDK. Forces JSON with an assistant
 *              prefill, which is the most reliable trick available and the
 *              reason this pipeline has never had a parse failure.
 *
 *   nvidia     The free build.nvidia.com catalogue, OpenAI-compatible, over
 *              plain fetch. No prefill exists there, so JSON is forced with
 *              response_format instead. Several of that catalogue's strongest
 *              models are reasoning models that narrate their working before
 *              answering, so that is stripped before the JSON is extracted.
 *
 * BRIEFING_PROVIDER picks one. BRIEFING_FALLBACK names a second, tried only
 * when the first cannot produce anything usable: a free tier with no SLA is a
 * fine way to write a newspaper and a poor way to guarantee one.
 */
import Anthropic from '@anthropic-ai/sdk';

const NVIDIA_BASE = process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';

/** Default model per provider, overridable with BRIEFING_MODEL. */
export const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-5-20250929',
  nvidia: 'z-ai/glm-5.3',
};

/**
 * Reasoning models narrate their thinking first. Some return it in a separate
 * field, some inline it in tags. Either way it is not the answer, and leaving
 * it in front of the JSON is the quickest route to a parse failure.
 */
function stripReasoning(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    // An unclosed block means the model ran out of room mid-thought. Drop the
    // rest: there is no answer after it anyway.
    .replace(/<think(?:ing)?>[\s\S]*$/i, '')
    .trim();
}

/** Strip a fenced code block if the model wrapped its object in one. */
function stripFence(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return m ? m[1].trim() : text;
}

class AnthropicProvider {
  constructor({ apiKey, model, maxTokens, workspaceId }) {
    this.name = 'anthropic';
    this.model = model;
    this.maxTokens = maxTokens;
    this.client = new Anthropic({
      apiKey,
      ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
    });
  }

  async complete({ system, turns }) {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      // The prefill forces the response to open as JSON, which removes the
      // single most common failure mode: a chatty preamble before the object.
      messages: [...turns, { role: 'assistant', content: '{' }],
    });

    const body = res.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');

    return {
      // Hand back a whole object, so the caller never has to know that a brace
      // was borrowed to start it.
      text: body.trimStart().startsWith('{') ? body : `{${body}`,
      usage: {
        input_tokens: res.usage?.input_tokens ?? 0,
        output_tokens: res.usage?.output_tokens ?? 0,
      },
      stopReason: res.stop_reason === 'max_tokens' ? 'length' : res.stop_reason,
    };
  }
}

class NvidiaProvider {
  constructor({ apiKey, model, maxTokens, temperature }) {
    this.name = 'nvidia';
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
    this.apiKey = apiKey;
  }

  async complete({ system, turns }) {
    const res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: system }, ...turns],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        // No prefill exists here, so this is what keeps the preamble out.
        // Models that ignore it still get caught by the brace extraction in
        // parseModelJson.
        response_format: { type: 'json_object' },
      }),
      // A reasoning model on a busy free tier is slow. Generous on purpose: a
      // late briefing beats no briefing.
      signal: AbortSignal.timeout(Number(process.env.NVIDIA_TIMEOUT_MS ?? 600_000)),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 400);
      throw new Error(`NVIDIA ${res.status} ${res.statusText}: ${detail}`);
    }

    const json = await res.json();
    const msg = json.choices?.[0]?.message ?? {};
    // reasoning_content is a separate field on some models and must never be
    // concatenated with the answer.
    const raw = typeof msg.content === 'string' ? msg.content : '';

    return {
      text: stripFence(stripReasoning(raw)),
      usage: {
        input_tokens: json.usage?.prompt_tokens ?? 0,
        output_tokens: json.usage?.completion_tokens ?? 0,
      },
      stopReason: json.choices?.[0]?.finish_reason ?? 'stop',
    };
  }
}

/** Build one provider by name. Throws if its key is missing. */
export function createProvider(name, { model, maxTokens = 8000, temperature = 0.7 } = {}) {
  if (name === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    return new AnthropicProvider({
      apiKey,
      model: model ?? DEFAULT_MODELS.anthropic,
      maxTokens,
      workspaceId: process.env.ANTHROPIC_WORKSPACE_ID,
    });
  }

  if (name === 'nvidia') {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) throw new Error('NVIDIA_API_KEY is not set');
    return new NvidiaProvider({
      apiKey,
      model: model ?? DEFAULT_MODELS.nvidia,
      maxTokens,
      temperature,
    });
  }

  throw new Error(`unknown provider "${name}". Use "anthropic" or "nvidia".`);
}

/** Make the common auth and access failures self-explanatory in the log. */
export function explainApiError(err) {
  const msg = String(err?.message ?? err);

  if (msg.includes('anthropic-workspace-id')) {
    return (
      'The Anthropic key is identity-linked, so it needs a workspace id. Either add an ' +
      'ANTHROPIC_WORKSPACE_ID repo secret (Console > Settings > Workspaces, copy the id), ' +
      'or replace the key with a workspace-scoped one, which needs no extra header.'
    );
  }
  if (/NVIDIA 404/.test(msg)) {
    return (
      'NVIDIA returned 404 for that model. Either the id is wrong (check ' +
      'https://integrate.api.nvidia.com/v1/models for the exact string) or the model needs ' +
      '"Public API Endpoints" enabled on your NVIDIA organisation, which is requested on the ' +
      'developer forum. Newer models frequently need it.'
    );
  }
  if (/NVIDIA 401|NVIDIA 403/.test(msg)) {
    return 'NVIDIA_API_KEY was rejected. Generate a fresh key at build.nvidia.com.';
  }
  if (/NVIDIA 429/.test(msg)) {
    return 'NVIDIA rate limited the request. The free tier allows roughly 40 requests a minute.';
  }
  if (/timed out|TimeoutError/i.test(msg)) {
    return 'The model did not answer in time. Free-tier reasoning models queue under load; NVIDIA_TIMEOUT_MS raises the ceiling.';
  }
  if (msg.includes('401') || /authentication/i.test(msg)) {
    return 'ANTHROPIC_API_KEY was rejected. Check the repo secret is set and has not been revoked.';
  }
  if (msg.includes('429')) return 'Rate limited by the API. The next scheduled run will retry.';
  if (msg.includes('credit') || msg.includes('billing')) {
    return 'The Anthropic account is out of credit. Top up at console.anthropic.com.';
  }
  return null;
}
