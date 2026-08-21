import assert from "node:assert/strict";
import test from "node:test";

import gateway from "../src/index.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PUBLIC_ORIGIN = "https://lifeosai.pages.dev";
const API_ORIGIN = "https://api.losai.ng.eu.org";
const SUPABASE_ORIGIN = "https://project.supabase.co";

class MemoryKV {
  constructor() {
    this.values = new Map();
    this.puts = [];
  }

  async get(key, options = {}) {
    const value = this.values.get(key);
    if (value == null) return null;
    return options?.type === "json" ? JSON.parse(value) : value;
  }

  async put(key, value, options = {}) {
    this.values.set(key, String(value));
    this.puts.push({ key, options: { ...options } });
  }
}

class RateLimiter {
  constructor() {
    this.keys = [];
  }

  async limit({ key }) {
    this.keys.push(key);
    return { success: true };
  }
}

function token() {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ iat: 200 })}.signature`;
}

function profile(overrides = {}) {
  return {
    user_id: USER_ID,
    email: "owner@example.com",
    first_name: "LifeOS",
    surname: "Owner",
    country: "Nigeria",
    terms_accepted_at: "2026-08-01T00:00:00Z",
    birth_year: 1990,
    age_verified_at: "2026-08-01T00:00:00Z",
    dob_retention: "eligibility_only",
    ...overrides,
  };
}

function baseEnv(fetcher) {
  return {
    LIFEOS_ALLOWED_ORIGINS: PUBLIC_ORIGIN,
    LIFEOS_PUBLIC_SITE_ORIGIN: PUBLIC_ORIGIN,
    LIFEOS_API_ORIGIN: API_ORIGIN,
    LIFEOS_GATEWAY_SHARED_SECRET: "test-gateway-secret",
    SUPABASE_URL: SUPABASE_ORIGIN,
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    LIFEOS_EMAIL_AUTH_ENABLED: "true",
    LIFEOS_REGISTRATION_ENABLED: "true",
    LIFEOS_GOOGLE_AUTH_ENABLED: "true",
    LIFEOS_MINIMUM_AGE: "13",
    LIFEOS_PASSWORD_MIN_LENGTH: "10",
    LIFEOS_GEMINI_LIVE_PRIMARY_MODEL: "gemini-3.1-flash-live-preview",
    LIFEOS_GEMINI_LIVE_FALLBACK_MODEL: "gemini-2.5-flash-native-audio-preview-12-2025",
    GEMINI_API_KEY: "gemini-secret-test",
    ORIGIN_STATE: new MemoryKV(),
    API_RATE_LIMITER: new RateLimiter(),
    __TEST_FETCH__: fetcher,
  };
}

function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Origin", options.origin || PUBLIC_ORIGIN);
  return new Request(`${API_ORIGIN}${path}`, { ...options, headers });
}

function authenticated(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token()}`);
  return request(path, { ...options, headers });
}

function authFetcher(extra, selectedProfile = profile()) {
  return async (input, options = {}) => {
    const url = String(input);
    if (url === `${SUPABASE_ORIGIN}/auth/v1/user`) {
      return Response.json({ id: USER_ID, email: "owner@example.com", app_metadata: {} });
    }
    if (url.startsWith(`${SUPABASE_ORIGIN}/rest/v1/lifeos_profiles?`)) {
      return Response.json([selectedProfile]);
    }
    return extra(input, options);
  };
}

test("health is edge-native and does not inspect a Python origin", async () => {
  const env = baseEnv(authFetcher(() => { throw new Error("unexpected outbound request"); }));
  const response = await gateway.fetch(request("/health"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    gateway: true,
    runtime: "cloudflare-worker",
    preferred_origin: "edge",
    python_origins_required: false,
    render_dependency: false,
    public_site_available_independently: true,
    supabase_is_system_of_record: true,
    voice_token_gateway_available: true,
  });
});

test("public configuration is served directly by the Worker", async () => {
  const env = baseEnv(authFetcher(() => { throw new Error("unexpected outbound request"); }));
  const response = await gateway.fetch(request("/config"), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.api_origin, API_ORIGIN);
  assert.equal(data.public_site_origin, PUBLIC_ORIGIN);
  assert.equal(data.supabase_anon_key, "sb_publishable_test");
});

test("session validation uses Supabase directly", async () => {
  const env = baseEnv(authFetcher(() => { throw new Error("unexpected outbound request"); }));
  const response = await gateway.fetch(authenticated("/api/session"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, user_id: USER_ID, profile_complete: true });
});

test("Gemini Live token issuance is edge-native and idempotent", async () => {
  let tokenCalls = 0;
  const env = baseEnv(authFetcher(async (input, options) => {
    const url = String(input);
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/auth_tokens");
    tokenCalls += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.uses, 1);
    assert.equal(body.liveConnectConstraints.model, "models/gemini-3.1-flash-live-preview");
    return Response.json({ name: "auth_tokens/edge-test" });
  }));
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "11111111-2222-4333-8444-555555555555" },
    body: JSON.stringify({ model_preference: "primary" }),
  };
  const first = await gateway.fetch(authenticated("/api/gemini-live-token", options), env);
  const second = await gateway.fetch(authenticated("/api/gemini-live-token", options), env);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).idempotent_replay, false);
  assert.equal((await second.json()).idempotent_replay, true);
  assert.equal(tokenCalls, 1);
  assert.equal(env.API_RATE_LIMITER.keys.length, 1);
});

test("chat decision is edge-native and never calls Render or another Python origin", async () => {
  const calls = [];
  const env = baseEnv(authFetcher(async (input, options) => {
    const url = String(input);
    calls.push(url);
    assert.equal(url.startsWith("https://generativelanguage.googleapis.com/v1beta/models/"), true);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.tools, [{ google_search: {} }]);
    return Response.json({
      candidates: [{
        content: { parts: [{ text: "Worker fallback reply" }] },
        groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/source", title: "Example" } }] },
      }],
    });
  }));
  const response = await gateway.fetch(authenticated("/api/chat-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
  }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.reply, "Worker fallback reply");
  assert.equal(data.fallback_origin, "cloudflare-worker");
  assert.equal(data.grounded, true);
  assert.equal(calls.some(url => url.includes("onrender.com")), false);
  assert.equal(calls.some(url => url.includes("northflank")), false);
});

test("account profile GET is direct through Supabase", async () => {
  const selectedProfile = profile();
  const env = baseEnv(authFetcher(() => { throw new Error("profile GET must not use a Python origin"); }, selectedProfile));
  const response = await gateway.fetch(authenticated("/api/account-profile"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { profile: selectedProfile, complete: true, minimum_age: 13 });
});

test("account profile POST is written directly to Supabase", async () => {
  let writtenRow = null;
  const env = baseEnv(async (input, options = {}) => {
    const url = String(input);
    if (url === `${SUPABASE_ORIGIN}/auth/v1/user`) {
      return Response.json({ id: USER_ID, email: "owner@example.com", app_metadata: {} });
    }
    if (url.startsWith(`${SUPABASE_ORIGIN}/rest/v1/lifeos_profiles?`)) {
      if (options.method === "POST") {
        writtenRow = JSON.parse(options.body);
        return new Response(null, { status: 201 });
      }
      return Response.json([profile({ ...writtenRow, birth_year: null, age_verified_at: null, dob_retention: "eligibility_only" })]);
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  });
  const response = await gateway.fetch(authenticated("/api/account-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa" },
    body: JSON.stringify({
      first_name: "LifeOS",
      surname: "Owner",
      date_of_birth: "1990-08-08",
      country: "Nigeria",
      phone: "+234000000000",
      accept_terms: true,
      account_status: "admin",
    }),
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).complete, true);
  assert.equal(writtenRow.user_id, USER_ID);
  assert.equal(writtenRow.email, "owner@example.com");
  assert.equal(Object.hasOwn(writtenRow, "account_status"), false);
});

test("unsupported API routes return controlled maintenance instead of using Render", async () => {
  const env = baseEnv(authFetcher(() => { throw new Error("unsupported route must not call an origin"); }));
  const response = await gateway.fetch(authenticated("/api/legacy-python-route", {
    method: "GET",
  }), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "EDGE_ROUTE_NOT_IMPLEMENTED");
});

test("mutations still require an idempotency key", async () => {
  const env = baseEnv(authFetcher(() => { throw new Error("must not reach outbound service"); }));
  const response = await gateway.fetch(authenticated("/api/chat-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
  }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "IDEMPOTENCY_KEY_REQUIRED");
});
