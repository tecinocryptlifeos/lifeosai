export const EDGE_RELEASE = "losai-split-platform-edge-v1";

export const EDGE_NATIVE_PATHS = new Set([
  "/health",
  "/config",
  "/api/auth-config",
  "/api/session",
  "/api/session-status",
  "/api/gemini-live-status",
  "/api/market-data",
  "/api/gemini-live-token",
]);

export const PUBLIC_COMPATIBILITY_GET_PATHS = new Set([
  "/api/release",
  "/api/realtime-status",
]);

export const NORTHFLANK_GET_PATHS = new Set([
  "/api/auth-config",
  "/api/config",
  "/api/session",
  "/api/session-status",
  "/api/account-profile",
  "/api/gemini-live-status",
]);

export const NORTHFLANK_MUTATION_PATHS = new Set([
  "/api/gemini-live-token",
  "/api/chat-decision",
]);

export const SAFE_GET_RETRY_PATHS = new Set([
  "/health",
  "/config",
  "/api/auth-config",
  "/api/release",
]);

export const NEVER_REPLAY_PATH_FRAGMENTS = Object.freeze([
  "account-delete",
  "delete-account",
  "email",
  "queue",
  "payment",
  "admin",
]);

const PUBLIC_SITE_ORIGIN = "https://lifeosai.pages.dev";
const TRADING_SYSTEM_ORIGIN = "https://lifeos-trade-system.pages.dev";
const PAGES_PREVIEW_PATTERN = /^https:\/\/[a-z0-9-]+\.lifeosai\.pages\.dev$/i;

export class GatewayError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function isMutation(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());
}

export function isSafeGetRetry(method, pathname) {
  return String(method || "GET").toUpperCase() === "GET" &&
    SAFE_GET_RETRY_PATHS.has(pathname);
}

export function isNeverReplayPath(pathname) {
  const lowered = String(pathname || "").toLowerCase();
  return NEVER_REPLAY_PATH_FRAGMENTS.some(fragment => lowered.includes(fragment));
}

export function northflankCompatible(method, pathname) {
  const selected = String(method || "GET").toUpperCase();
  if (["GET", "HEAD"].includes(selected)) return NORTHFLANK_GET_PATHS.has(pathname);
  return NORTHFLANK_MUTATION_PATHS.has(pathname);
}

export function requireIdempotencyKey(request) {
  if (!isMutation(request.method)) return "";
  const value = String(request.headers.get("Idempotency-Key") || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/.test(value)) {
    throw new GatewayError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key is required for this mutation.",
    );
  }
  return value;
}

function isTrustedPagesPreviewOrigin(origin) {
  return origin === PUBLIC_SITE_ORIGIN || origin === TRADING_SYSTEM_ORIGIN || PAGES_PREVIEW_PATTERN.test(origin);
}

export function configuredOrigins(env) {
  return String(env.LIFEOS_ALLOWED_ORIGINS || "")
    .split(",")
    .map(item => item.trim().replace(/\/$/, ""))
    .filter(item => {
      try {
        const url = new URL(item);
        return url.protocol === "https:" && url.origin === item;
      } catch {
        return false;
      }
    });
}

export function requestOriginAllowed(request, env) {
  const origin = String(request.headers.get("Origin") || "").trim();
  if (!origin) return true;
  if (isTrustedPagesPreviewOrigin(origin)) return true;
  return configuredOrigins(env).includes(origin);
}

export function corsOrigin(request, env) {
  const origin = String(request.headers.get("Origin") || "").trim();
  if (isTrustedPagesPreviewOrigin(origin)) return origin;
  return origin && configuredOrigins(env).includes(origin) ? origin : "";
}

export function responseHeaders(request, env, existing = new Headers()) {
  const headers = new Headers(existing);
  headers.delete("Server");
  headers.delete("X-Powered-By");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=()");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-LifeOS-Edge-Release", EDGE_RELEASE);
  headers.set("Vary", headers.get("Vary") ? `${headers.get("Vary")}, Origin` : "Origin");
  const allowed = corsOrigin(request, env);
  if (allowed) {
    headers.set("Access-Control-Allow-Origin", allowed);
    headers.set("Access-Control-Allow-Credentials", "true");
  } else {
    headers.delete("Access-Control-Allow-Origin");
    headers.delete("Access-Control-Allow-Credentials");
  }
  return headers;
}

export function jsonResponse(request, env, status, payload, extraHeaders = {}) {
  const headers = responseHeaders(
    request,
    env,
    new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    }),
  );
  return new Response(JSON.stringify(payload), { status, headers });
}

export function errorResponse(request, env, error) {
  const known = error instanceof GatewayError;
  const status = known ? error.status : 503;
  const code = known ? error.code : "EDGE_UNAVAILABLE";
  const message = known
    ? error.message
    : "The LifeOS API gateway is temporarily unavailable.";
  return jsonResponse(request, env, status, {
    ok: false,
    code,
    error: message,
    ...(known ? error.extra : {}),
  });
}

export function maintenanceResponse(request, env, pathname, reason = "ORIGIN_UNAVAILABLE") {
  return jsonResponse(request, env, 503, {
    ok: false,
    code: "CONTROLLED_MAINTENANCE",
    error: "This noncritical LifeOS feature is temporarily under maintenance.",
    feature: pathname,
    reason,
    retryable: !isMutation(request.method),
  }, { "Retry-After": "60" });
}

export async function stableHash(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
