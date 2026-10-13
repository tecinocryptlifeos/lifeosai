// LOSAI_WORKER_CHAT_FALLBACK_V2
import { GatewayError, stableHash } from "./policy.js";

export const CHAT_IDEMPOTENCY_TTL_SECONDS = 60;

const MAX_CHAT_BODY_BYTES = 60000;
const MAX_CHAT_MESSAGES = 12;
const MAX_USER_MESSAGE_CHARACTERS = 1400;
const MAX_ASSISTANT_MESSAGE_CHARACTERS = 1000;

const DEFAULT_CHAT_MODELS = Object.freeze([
  // The provider probe confirmed this model can still return text when Search
  // grounding quota is exhausted and Gemini 3.8 is temporarily unavailable.
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
]);

const SYSTEM_INSTRUCTION = `
You are Sophia, the LifeOSAI Synthetic Artificial Intelligence assistant. You
are a context-aware decision-intelligence system, not a generic chatbot. Answer
the user's actual request and preserve relevant facts, corrections, preferences,
names, quantities, dates, negation, and unresolved questions from the supplied
conversation. Do not restart a continuing discussion or ask again for facts the
user has already provided.

LANGUAGE UNDERSTANDING POLICY:
- Infer meaning from the whole utterance and conversation, not one isolated word.
  Resolve pronouns, shortened follow-ups, and reasonable spelling, grammar,
  punctuation, or speech-transcription errors from context.
- Never silently change a name, place, number, date, currency, unit, positive or
  negative instruction, or other high-impact detail. Ask one precise question
  only when the remaining ambiguity would materially change the answer.
- Answer in the language or natural language mixture of the latest user turn
  unless another language is requested. A borrowed word or code-switched phrase
  alone does not establish a language change.

IGBO UNDERSTANDING POLICY:
- Treat Igbo as a first-class conversation language. Formulate Igbo answers
  directly in fluent contemporary Standard Igbo (Igbo Izugbe), not as a literal
  word-for-word translation from English.
- Use the full clause and prior turns to understand spelling variants, omitted
  tone marks, likely transcription mistakes, code-switching, names, kinship
  terms, place names, and clearly recognisable dialects. Default to Igbo Izugbe
  when a dialect is uncertain. Never invent a spelling, tone mark, proverb,
  translation, dialect form, or cultural meaning.
- Once a substantial turn establishes Igbo, remain in Igbo until the user
  clearly changes language or requests translation. If an unresolved word
  materially affects the answer, briefly state in Igbo what you understood and
  ask one precise clarification in Igbo.

REASONING AND RESPONSE POLICY:
- Separate verified facts from inference, estimates, uncertainty, and opinion.
  Use Google Search for current or externally verifiable facts when supplied in
  this request; never invent a source or claim a search occurred when it did not.
- For decisions, examine likely short- and long-term outcomes, assumptions,
  alternatives, the main risk, opportunity cost, a safer alternative, and one
  practical next action. Do not force this template onto an ordinary question.
- Never guarantee a future, profit, price, medical result, or legal result.
  Protect privacy and never expose secrets or conversation content in audit data.
- Be warm, direct, natural, and complete. Do not claim human consciousness,
  private-system access, or tools the service does not possess.
`.trim();

function fetchImpl(env) {
  return typeof env.__TEST_FETCH__ === "function"
    ? env.__TEST_FETCH__
    : fetch;
}

function enabled(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (!normalized) return fallback;

  return ["1", "true", "yes", "on"].includes(normalized);
}

function normalizeModel(value) {
  const model = String(value || "")
    .trim()
    .replace(/^models\//, "");

  return /^[A-Za-z0-9._-]{3,120}$/.test(model) ? model : "";
}

function configuredModels(env) {
  const configured = String(
    env.GEMINI_GROUNDED_TEXT_MODELS ||
    env.GEMINI_TEXT_MODELS ||
    "",
  );

  // Preserve the first three configured choices, but reserve room for the
  // two modern fallbacks so a long configured list cannot remove them.
  const preferred = [
    ...new Set(configured.split(",").map(normalizeModel).filter(Boolean)),
  ].slice(0, 3);

  // Gemini 2.5 access is restricted for projects without prior active usage.
  const models = [
    ...preferred,
    ...DEFAULT_CHAT_MODELS,
  ];

  return [...new Set(models)].slice(0, 5);
}

async function requestPayload(request) {
  const contentLength = request.headers.get("Content-Length");
  const declaredLength = contentLength
    ? Number.parseInt(contentLength, 10)
    : 0;

  if (
    Number.isFinite(declaredLength) &&
    (declaredLength < 0 || declaredLength > MAX_CHAT_BODY_BYTES)
  ) {
    throw new GatewayError(
      413,
      "CHAT_REQUEST_TOO_LARGE",
      "The chat request body is too large.",
    );
  }

  const raw = await request.text();

  if (new TextEncoder().encode(raw).byteLength > MAX_CHAT_BODY_BYTES) {
    throw new GatewayError(
      413,
      "CHAT_REQUEST_TOO_LARGE",
      "The chat request body is too large.",
    );
  }

  if (!raw.trim()) {
    throw new GatewayError(
      400,
      "CHAT_REQUEST_INVALID",
      "The chat request body is required.",
    );
  }

  let payload;

  try {
    payload = JSON.parse(raw);
  } catch {
    throw new GatewayError(
      400,
      "CHAT_REQUEST_INVALID",
      "The chat request body is invalid.",
    );
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new GatewayError(
      400,
      "CHAT_REQUEST_INVALID",
      "The chat request body must be an object.",
    );
  }

  return payload;
}

function cleanMessages(payload) {
  if (!Array.isArray(payload.messages)) {
    throw new GatewayError(
      400,
      "CHAT_MESSAGES_INVALID",
      "Messages must be supplied as a list.",
    );
  }

  const excludedFragments = [
    "could not complete the continuation",
    "under high demand",
    "reviewing the decision thread",
  ];

  const selected = [];

  for (const item of payload.messages.slice(-MAX_CHAT_MESSAGES)) {
    if (!item || typeof item !== "object") continue;

    const role = String(item.role || "").trim().toLowerCase();
    const content = String(item.content || "").trim();

    if (!["user", "assistant"].includes(role) || !content) continue;

    if (
      excludedFragments.some(fragment =>
        content.toLowerCase().includes(fragment))
    ) {
      continue;
    }

    selected.push({
      role,
      content: content.slice(
        0,
        role === "user"
          ? MAX_USER_MESSAGE_CHARACTERS
          : MAX_ASSISTANT_MESSAGE_CHARACTERS,
      ),
    });
  }

  const firstUserIndex = selected.findIndex(
    item => item.role === "user",
  );

  if (firstUserIndex < 0) {
    throw new GatewayError(
      400,
      "CHAT_USER_MESSAGE_REQUIRED",
      "A user message is required.",
    );
  }

  const compacted = [];

  for (const message of selected.slice(firstUserIndex)) {
    const previous = compacted[compacted.length - 1];

    if (previous?.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`.slice(
        0,
        message.role === "user"
          ? MAX_USER_MESSAGE_CHARACTERS
          : MAX_ASSISTANT_MESSAGE_CHARACTERS,
      );
      continue;
    }

    compacted.push({ ...message });
  }

  return compacted;
}

function generationConfig(model) {
  const config = {
    maxOutputTokens: 900,
  };

  if (model.startsWith("gemini-2.5-")) {
    config.thinkingConfig = {
      thinkingBudget: 1024,
    };
  } else if (model.startsWith("gemini-3")) {
    config.thinkingConfig = {
      thinkingLevel: "low",
    };
  }

  return config;
}

function modelRequest(messages, model, useSearch) {
  return {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    contents: messages.map(message => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
    ...(useSearch
      ? {
          tools: [{ google_search: {} }],
        }
      : {}),
    generationConfig: generationConfig(model),
  };
}

function extractText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];

  return parts
    .filter(
      part =>
        part &&
        part.thought !== true &&
        typeof part.text === "string",
    )
    .map(part => part.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractSources(payload) {
  const chunks =
    payload?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

  const sources = [];
  const seen = new Set();

  for (const chunk of chunks) {
    const web = chunk?.web;

    if (!web?.uri) continue;

    try {
      const parsed = new URL(String(web.uri));

      if (!["http:", "https:"].includes(parsed.protocol)) continue;

      parsed.hash = "";

      const normalized = parsed.toString();

      if (seen.has(normalized)) continue;

      seen.add(normalized);

      sources.push({
        title: String(web.title || parsed.hostname)
          .trim()
          .slice(0, 180),
        url: normalized,
      });

      if (sources.length >= 5) break;
    } catch {
      // Malformed grounding links are ignored.
    }
  }

  return sources;
}

async function generateFallbackReply(env, messages) {
  const apiKey = String(env.GEMINI_API_KEY || "").trim();

  if (!apiKey) {
    throw new GatewayError(
      503,
      "GEMINI_NOT_CONFIGURED",
      "The Worker chat fallback is not configured.",
    );
  }

  const models = configuredModels(env);

  if (!models.length) {
    throw new GatewayError(
      503,
      "GEMINI_MODEL_MISSING",
      "No Worker chat fallback model is configured.",
    );
  }

  const searchEnabled = enabled(
    env.LIFEOS_CHAT_SEARCH_ENABLED,
    true,
  );

  let lastFailure =
    "No configured Gemini model returned a usable response.";

  for (const model of models) {
    const searchModes = searchEnabled
      ? [true, false]
      : [false];

    for (const useSearch of searchModes) {
      try {
        const response = await fetchImpl(env)(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify(
              modelRequest(messages, model, useSearch),
            ),
            signal: AbortSignal.timeout(20000),
          },
        );

        const payload = await response
          .json()
          .catch(() => ({}));

        const text = response.ok
          ? extractText(payload)
          : "";

        if (response.ok && text) {
          const sources = extractSources(payload);

          return {
            text,
            sources,
            grounded: sources.length > 0,
            model,
          };
        }

        lastFailure =
          `${model} returned HTTP ${response.status}` +
          (useSearch ? " with Search grounding" : "");

        if (
          useSearch &&
          [400, 403, 429].includes(response.status)
        ) {
          continue;
        }

        break;
      } catch (error) {
        lastFailure =
          `${model} failed with ${error?.name || "Error"}`;

        break;
      }
    }
  }

  console.error("LOSAI_WORKER_CHAT_FALLBACK_FAILED", {
    reason: lastFailure,
  });

  throw new GatewayError(
    503,
    "WORKER_CHAT_FALLBACK_FAILED",
    "The emergency chat service is temporarily unavailable.",
  );
}

export async function issueChatDecision(
  request,
  env,
  session,
  idempotencyKey,
) {
  const userId = String(session?.user?.id || "").trim();

  if (!userId) {
    throw new GatewayError(
      401,
      "AUTH_REQUIRED",
      "Sign-in is required.",
    );
  }

  const idempotencyMaterial =
    `${userId}:${idempotencyKey}`;

  const cacheKey =
    `chat-idempotency:${await stableHash(idempotencyMaterial)}`;

  const cached = await env.ORIGIN_STATE?.get(
    cacheKey,
    { type: "json" },
  );

  if (cached?.ok && cached?.reply) {
    return {
      ...cached,
      idempotent_replay: true,
    };
  }

  if (!env.API_RATE_LIMITER?.limit) {
    throw new GatewayError(
      503,
      "RATE_LIMITER_MISSING",
      "The LifeOS API rate limiter is not configured.",
    );
  }

  const limited = await env.API_RATE_LIMITER.limit({
    key: `${userId}:worker-chat-fallback`,
  });

  if (!limited?.success) {
    throw new GatewayError(
      429,
      "RATE_LIMITED",
      "Please wait before sending another chat request.",
      {
        retry_after: 60,
      },
    );
  }

  const payload = await requestPayload(request);
  const messages = cleanMessages(payload);
  const generated = await generateFallbackReply(env, messages);

  const result = {
    ok: true,
    reply: generated.text,
    sources: generated.sources,
    grounded: generated.grounded,
    model: generated.model,
    audio_url: null,
    tts_error: null,
    fallback_origin: "cloudflare-worker",
    idempotent_replay: false,
  };

  if (env.ORIGIN_STATE?.put) {
    await env.ORIGIN_STATE.put(
      cacheKey,
      JSON.stringify(result),
      {
        expirationTtl: CHAT_IDEMPOTENCY_TTL_SECONDS,
      },
    );
  }

  return result;
}
