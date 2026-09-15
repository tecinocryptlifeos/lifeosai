import test from "node:test";
import assert from "node:assert/strict";
import { issueGeminiToken } from "../src/gemini.js";

function makeRequest(preference = "primary") {
  return new Request("https://lifeosai.pages.dev/api/gemini-live-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "voice-test-key-123456",
    },
    body: JSON.stringify({ model_preference: preference }),
  });
}

function makeEnv(fetchImpl) {
  return {
    GEMINI_API_KEY: "test-key",
    LIFEOS_GEMINI_LIVE_PRIMARY_MODEL: "gemini-3.1-flash-live-preview",
    LIFEOS_GEMINI_LIVE_FALLBACK_MODEL: "gemini-2.5-flash-native-audio-preview-12-2025",
    __TEST_FETCH__: fetchImpl,
    API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ORIGIN_STATE: {
      async get() { return null; },
      async put() {},
    },
  };
}

test("Gemini Live token issuance falls back when the primary model token is rejected", async () => {
  const requestedModels = [];
  const env = makeEnv(async (_url, init) => {
    const body = JSON.parse(init.body);
    requestedModels.push(body.config.bidiGenerateContentSetup.model);
    if (requestedModels.length === 1) {
      return new Response(JSON.stringify({ error: { message: "primary unavailable" } }), { status: 503 });
    }
    return new Response(JSON.stringify({ name: "auth_tokens/fallback-test" }), { status: 200 });
  });

  const result = await issueGeminiToken(
    makeRequest("primary"),
    env,
    { user: { id: "user-1" } },
    "voice-test-key-123456",
  );

  assert.equal(result.ok, true);
  assert.equal(result.model, "gemini-2.5-flash-native-audio-preview-12-2025");
  assert.equal(result.model_preference, "fallback");
  assert.equal(result.fallback_used, true);
  assert.deepEqual(requestedModels, [
    "models/gemini-3.1-flash-live-preview",
    "models/gemini-2.5-flash-native-audio-preview-12-2025",
  ]);
});

test("Gemini Live token issuance reports failure when both model lanes fail", async () => {
  const env = makeEnv(async () => new Response(JSON.stringify({ error: { message: "unavailable" } }), { status: 503 }));

  await assert.rejects(
    issueGeminiToken(
      makeRequest("primary"),
      env,
      { user: { id: "user-2" } },
      "voice-test-key-123456",
    ),
    error => error?.code === "GEMINI_TOKEN_FAILED" && error?.extra?.provider_status === 503,
  );
});
