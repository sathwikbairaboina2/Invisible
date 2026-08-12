'use strict';

const { ChatOllama } = require('@langchain/ollama');
const { buildMessages } = require('./prompt');

/**
 * Thin wrapper over ChatOllama.
 *
 * `stream(state, signal)` returns an AsyncIterable<string>, which is exactly
 * the shape createGenerator({ stream }) has expected since Phase 1 — so this
 * drops into the existing seam without touching the graph wiring.
 *
 * `chatImpl` and `fetchImpl` are injected so both paths are testable without a
 * running container.
 *
 * @param {{baseUrl: string, model: string, temperature?: number,
 *          numPredict?: number, keepAlive?: string, historyTurns?: number,
 *          chatImpl?: object, fetchImpl?: typeof fetch}} options
 */
function createOllamaClient({
  baseUrl,
  model,
  temperature = 0.2,
  numPredict = 200,
  keepAlive = '30m',
  historyTurns = 8,
  chatImpl,
  fetchImpl = fetch,
} = {}) {
  if (!baseUrl) throw new TypeError('createOllamaClient: baseUrl is required');
  if (!model) throw new TypeError('createOllamaClient: model is required');

  const chat =
    chatImpl ??
    new ChatOllama({
      baseUrl,
      model,
      temperature,
      // Caps a runaway answer. The shape asked for is under 60 words; 200
      // tokens leaves slack without letting a confused model monologue.
      numPredict,
      // Keeps the 9 GB model resident between questions, so a pause in the
      // conversation does not put a full model load in front of the next one.
      keepAlive,
    });

  /**
   * @param {object} state graph state
   * @param {AbortSignal} [signal]
   * @returns {AsyncIterable<string>}
   */
  async function* stream(state, signal) {
    const messages = buildMessages({
      utterance: state.utterance,
      transcript: state.transcript,
      retrieved: state.retrieved,
      historyTurns,
    });

    // Passed through, not just checked in the loop below: breaking our own
    // iteration would stop the overlay updating while the model kept
    // generating and holding the GPU.
    for await (const chunk of chat.stream(messages, { signal })) {
      if (signal?.aborted) return;
      const text = typeof chunk === 'string' ? chunk : (chunk?.content ?? '');
      if (text) yield text;
    }
  }

  /**
   * Reachability plus "is the model actually pulled". Never throws — a dead
   * Ollama must degrade to a visible banner, not a failed launch.
   *
   * @returns {Promise<{ok: boolean, hasModel: boolean, models: string[], error?: string}>}
   */
  async function probe() {
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return { ok: false, hasModel: false, models: [], error: `HTTP ${response.status}` };
      }
      const payload = await response.json();
      const models = (payload?.models ?? []).map((entry) => entry.name);
      return { ok: true, hasModel: models.includes(model), models };
    } catch (err) {
      return { ok: false, hasModel: false, models: [], error: err.message };
    }
  }

  return { stream, probe };
}

module.exports = { createOllamaClient };
