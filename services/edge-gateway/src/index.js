import {
  GatewayError,
  PUBLIC_COMPATIBILITY_GET_PATHS,
  errorResponse,
  jsonResponse,
  maintenanceResponse,
  requestOriginAllowed,
  requireIdempotencyKey,
  responseHeaders,
} from "./policy.js";
import { geminiStatus, issueGeminiToken } from "./gemini.js";
import { issueChatDecision } from "./chat.js";
import { publicConfig, verifySession, handleAccountProfileDirect } from "./supabase.js";

function preflightResponse(request, env) {
  const headers = responseHeaders(request, env, new Headers({
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
  }));
  return new Response(null, { status: 204, headers });
}

function publicHealth(request, env) {
  return jsonResponse(request, env, 200, {
    ok: true,
    gateway: true,
    runtime: "cloudflare-worker",
    preferred_origin: "edge",
    python_origins_required: false,
    render_dependency: false,
    public_site_available_independently: true,
    supabase_is_system_of_record: true,
    voice_token_gateway_available: Boolean(String(env.GEMINI_API_KEY || "").trim()),
  });
}

async function handleRequest(request, env) {
  if (!requestOriginAllowed(request, env)) {
    throw new GatewayError(403, "ORIGIN_NOT_ALLOWED", "This browser origin is not allowed.");
  }
  if (request.method === "OPTIONS") return preflightResponse(request, env);

  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, "") || "/";

  if (request.method === "GET" && pathname === "/health") {
    return publicHealth(request, env);
  }

  if (request.method === "GET" && ["/config", "/api/auth-config"].includes(pathname)) {
    return jsonResponse(request, env, 200, publicConfig(env));
  }

  if (request.method === "GET" && pathname === "/api/gemini-live-status") {
    return jsonResponse(request, env, 200, geminiStatus(env));
  }

  if (request.method === "GET" && ["/api/session", "/api/session-status"].includes(pathname)) {
    const session = await verifySession(request, env, { profile: "optional" });
    return jsonResponse(request, env, 200, {
      ok: true,
      user_id: session.user.id,
      profile_complete: Boolean(session.profile?.complete),
    });
  }

  if (request.method === "POST" && pathname === "/api/gemini-live-token") {
    const idempotencyKey = requireIdempotencyKey(request);
    const session = await verifySession(request, env, { profile: "required" });
    return jsonResponse(
      request,
      env,
      200,
      await issueGeminiToken(request, env, session, idempotencyKey),
    );
  }

  if (request.method === "POST" && pathname === "/api/chat-decision") {
    const idempotencyKey = requireIdempotencyKey(request);
    const session = await verifySession(request, env, { profile: "required" });
    return jsonResponse(
      request,
      env,
      200,
      await issueChatDecision(request, env, session, idempotencyKey),
    );
  }

  if (pathname === "/api/account-profile" && ["GET", "POST"].includes(request.method)) {
    const session = await verifySession(request, env, { profile: "optional" });
    return handleAccountProfileDirect(request, env, session);
  }

  if (!pathname.startsWith("/api/") && !pathname.startsWith("/audio/")) {
    throw new GatewayError(404, "NOT_FOUND", "Not found.");
  }

  if (!(request.method === "GET" && PUBLIC_COMPATIBILITY_GET_PATHS.has(pathname))) {
    await verifySession(request, env, { profile: "required" });
  }

  return maintenanceResponse(
    request,
    env,
    pathname,
    "EDGE_ROUTE_NOT_IMPLEMENTED",
  );
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return errorResponse(request, env, error);
    }
  },
};

export { handleRequest };
