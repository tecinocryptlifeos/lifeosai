import test from "node:test";
import assert from "node:assert/strict";

import { issueChatDecision } from "../src/chat.js";

function makeResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successPayload(text = "Sophia text fallback is available.") {
  return {
    candidates: [{
      content: {
        parts: [{ text }],
      },
    }],
  };
}

function request() {
  return new Request("https://lifeosai.pages.dev/api/chat-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Help me understand my next step." }],
    }),
  });
}

function baseEnv(overrides = {}) {
  return {
    GEMINI_API_KEY: "unit-test-key",
    LIFEOS_CHAT_SEARCH_ENABLED: "true",
    API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ORIGIN_STATE: {
      get: async () => undefined,
      put: async () => undefined,
    },
    ...overrides,
  };
}

test("Sophia starts with Flash-Lite and retries without Search after grounding quota exhaustion", async () => {
  const calls = [];
  const env = baseEnv({
    __TEST_FETCH__: async (url, options) => {
      const model = new URL(url).pathname.match(/\/models\/([^:]+):generateContent/)?.[1];
      const body = JSON.parse(options.body);
      const searchEnabled = Array.isArray(body.tools);
      calls.push({ model, searchEnabled });

      if (model === "gemini-3.5-flash-lite" && searchEnabled) {
        return makeResponse(429, {
          error: {
            status: "RESOURCE_EXHAUSTED",
            message: "Search grounding quota exhausted",
          },
        });
      }

      if (model === "gemini-3.5-flash-lite" && !searchEnabled) {
        return makeResponse(200, successPayload());
      }

      throw new Error("Unexpected model request: " + model);
    },
  });

  const result = await issueChatDecision(
    request(),
    env,
    { user: { id: "test-user" } },
    "sophia-chat-test-key-000001",
  );

  assert.equal(result.ok, true);
  assert.equal(result.model, "gemini-3.5-flash-lite");
  assert.equal(result.reply, "Sophia text fallback is available.");
  assert.deepEqual(calls, [
    { model: "gemini-3.5-flash-lite", searchEnabled: true },
    { model: "gemini-3.5-flash-lite", searchEnabled: false },
  ]);
});

test("Sophia retains modern fallback models when five custom models are configured", async () => {
  const calls = [];
  const env = baseEnv({
    GEMINI_TEXT_MODELS: [
      "configured-model-a",
      "configured-model-b",
      "configured-model-c",
      "configured-model-d",
      "configured-model-e",
    ].join(","),
    __TEST_FETCH__: async (url, options) => {
      const model = new URL(url).pathname.match(/\/models\/([^:]+):generateContent/)?.[1];
      const body = JSON.parse(options.body);
      const searchEnabled = Array.isArray(body.tools);
      calls.push({ model, searchEnabled });

      if (model.startsWith("configured-model-")) {
        return makeResponse(503, {
          error: { status: "UNAVAILABLE", message: "Configured model unavailable" },
        });
      }

      if (model === "gemini-3.5-flash-lite" && searchEnabled) {
        return makeResponse(429, {
          error: { status: "RESOURCE_EXHAUSTED", message: "Search grounding quota exhausted" },
        });
      }

      if (model === "gemini-3.5-flash-lite" && !searchEnabled) {
        return makeResponse(200, successPayload("Modern fallback survived custom configuration."));
      }

      throw new Error("Unexpected model request: " + model);
    },
  });

  const result = await issueChatDecision(
    request(),
    env,
    { user: { id: "test-user" } },
    "sophia-chat-test-key-000002",
  );

  assert.equal(result.ok, true);
  assert.equal(result.model, "gemini-3.5-flash-lite");
  assert.equal(result.reply, "Modern fallback survived custom configuration.");
  assert.deepEqual(calls.map(call => call.model), [
    "configured-model-a",
    "configured-model-b",
    "configured-model-c",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash-lite",
  ]);
});
