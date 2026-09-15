import { GatewayError, stableHash } from "./policy.js";

export const GEMINI_WEBSOCKET_URL =
  "wss://generativelanguage.googleapis.com/ws/" +
  "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
export const TOKEN_IDEMPOTENCY_TTL_SECONDS = 60;

function fetchImpl(env) {
  return typeof env.__TEST_FETCH__ === "function" ? env.__TEST_FETCH__ : fetch;
}

function modelPolicy(env, requested) {
  const primary = String(env.LIFEOS_GEMINI_LIVE_PRIMARY_MODEL || "gemini-3.1-flash-live-preview").trim();
  const fallback = String(env.LIFEOS_GEMINI_LIVE_FALLBACK_MODEL || "gemini-2.5-flash-native-audio-preview-12-2025").trim();
  const preference = String(requested || "primary").trim().toLowerCase() === "fallback" && fallback
    ? "fallback"
    : "primary";
  const model = preference === "fallback" ? fallback : primary;
  if (!model) {
    throw new GatewayError(503, "GEMINI_MODEL_MISSING", "The selected Gemini Live model is not configured.");
  }
  return { primary, fallback, preference, model };
}

function sanitizeProviderError(data) {
  const error = data?.error;
  if (!error || typeof error !== "object") return null;
  return {
    code: Number(error.code) || null,
    status: String(error.status || "").slice(0, 64) || null,
    message: String(error.message || "").slice(0, 512) || null,
  };
}

async function requestPayload(request) {
  const length = Number.parseInt(request.headers.get("Content-Length") || "0", 10) || 0;
  if (length > 4096) {
    throw new GatewayError(413, "TOKEN_REQUEST_TOO_LARGE", "The token request body is too large.");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 4096) {
    throw new GatewayError(413, "TOKEN_REQUEST_TOO_LARGE", "The token request body is too large.");
  }
  if (!raw.trim()) return {};
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new GatewayError(400, "TOKEN_REQUEST_INVALID", "The token request body is invalid.");
  }
  return payload;
}

export function geminiStatus(env) {
  const policy = modelPolicy(env, "primary");
  return {
    ok: true,
    gemini_live: true,
    version: "edge-v1",
    model: policy.primary,
    primary_model: policy.primary,
    fallback_model: policy.fallback || null,
    fallback_enabled: Boolean(policy.fallback && policy.fallback !== policy.primary),
    capacity_profile: "primary-with-automatic-fallback",
    thinking_level: "medium",
    transport: "websocket",
    authentication: "constrained-ephemeral-token",
    gemini_key_configured: Boolean(String(env.GEMINI_API_KEY || "").trim()),
  };
}

async function createGeminiToken(fetchFunction, apiKey, model) {
  const now = Date.now();
  const tokenRequest = {
    uses: 1,
    expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
    newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
    liveConnectConstraints: {
      model: `models/${model}`,
      config: {
        sessionResumption: {},
        responseModalities: ["AUDIO"],
      },
    },
  };
  const response = await fetchFunction(
    "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(tokenRequest),
      signal: AbortSignal.timeout(15000),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !String(data.name || "").trim()) {
    return {
      ok: false,
      status: response.status,
      provider_error: sanitizeProviderError(data),
    };
  }
  return { ok: true, token: String(data.name).trim() };
}

export async function issueGeminiToken(request, env, session, idempotencyKey) {
  const apiKey = String(env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new GatewayError(503, "GEMINI_NOT_CONFIGURED", "Gemini Live is not configured.");
  }
  const payload = await requestPayload(request);
  const policy = modelPolicy(env, payload.model_preference);
  const cacheKey = `token-idempotency:${await stableHash(`${session.user.id}:${idempotencyKey}:${policy.preference}`)}`;
  const cached = await env.ORIGIN_STATE?.get(cacheKey, { type: "json" });
  if (cached?.ok && cached?.token) return { ...cached, idempotent_replay: true };

  if (!env.API_RATE_LIMITER?.limit) {
    throw new GatewayError(503, "RATE_LIMITER_MISSING", "The LifeOS API rate limiter is not configured.");
  }
  const limited = await env.API_RATE_LIMITER.limit({ key: `${session.user.id}:${policy.preference}:gemini-live-token` });
  if (!limited?.success) {
    throw new GatewayError(429, "RATE_LIMITED", "Please wait before starting another Gemini Live session.", { retry_after: 60 });
  }

  const fetchFunction = fetchImpl(env);
  let selectedModel = policy.model;
  let selectedPreference = policy.preference;
  let issued = await createGeminiToken(fetchFunction, apiKey, selectedModel);

  if (
    !issued.ok &&
    policy.preference === "primary" &&
    policy.fallback &&
    policy.fallback !== policy.primary
  ) {
    const fallbackIssued = await createGeminiToken(fetchFunction, apiKey, policy.fallback);
    if (fallbackIssued.ok) {
      issued = fallbackIssued;
      selectedModel = policy.fallback;
      selectedPreference = "fallback";
    }
  }

  if (!issued.ok || !issued.token) {
    throw new GatewayError(
      502,
      "GEMINI_TOKEN_FAILED",
      "Gemini Live token issuance failed.",
      {
        provider_status: Number(issued.status) || 0,
        provider_error: issued.provider_error || null,
        requested_model: policy.model,
      },
    );
  }

  const result = {
    ok: true,
    token: issued.token,
    model: selectedModel,
    model_preference: selectedPreference,
    primary_model: policy.primary,
    fallback_model: policy.fallback || null,
    fallback_available: Boolean(policy.fallback && policy.fallback !== policy.primary),
    fallback_used: selectedPreference === "fallback" && policy.preference === "primary",
    thinking_level: "medium",
    websocket_url: GEMINI_WEBSOCKET_URL,
    gateway_version: "edge-v1",
    idempotent_replay: false,
  };
  if (env.ORIGIN_STATE?.put) {
    await env.ORIGIN_STATE.put(cacheKey, JSON.stringify(result), {
      expirationTtl: TOKEN_IDEMPOTENCY_TTL_SECONDS,
    });
  }
  return result;
}
