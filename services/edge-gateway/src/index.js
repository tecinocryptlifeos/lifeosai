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
import { issueDecisionIntelligence } from "./decision-engine.js";
import { currentOriginState } from "./health.js";
import { publicConfig, updateProfile, verifySession } from "./supabase.js";
import { marketData, marketQuote, marketSymbols } from "./market-data.js";
import { marketStream } from "./market-stream.js";
import { scheduledTradingAnalysis, tradingAnalysis, tradingBars, tradingInstruments, tradingJournal, tradingPerformance, tradingPlan } from "./trading-api.js";

function preflightResponse(request, env) {
  const headers = responseHeaders(request, env, new Headers({
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
  }));
  return new Response(null, { status: 204, headers });
}

function publicHealth(request, env, state) {
  return jsonResponse(request, env, 200, {
    ok: true,
    gateway: true,
    preferred_origin: "edge",
    edge_healthy: true,
    checked_at: state.checked_at,
    public_site_available_independently: true,
    supabase_is_system_of_record: true,
    voice_token_gateway_available: Boolean(String(env.GEMINI_API_KEY || "").trim()),
  });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, "") || "/";

  // These market-data routes are non-sensitive deployment/readiness probes.
  if (request.method === "GET" && pathname === "/api/market-data") {
    try {
      return jsonResponse(request, env, 200, await marketData(request, env));
    } catch (error) {
      throw new GatewayError(502, "MARKET_DATA_UNAVAILABLE", error.message || "Market data unavailable.");
    }
  }

  if (request.method === "GET" && pathname === "/api/market-quote") {
    try {
      return jsonResponse(request, env, 200, await marketQuote(request, env));
    } catch (error) {
      throw new GatewayError(502, "MARKET_QUOTE_UNAVAILABLE", error.message || "Latest market quote unavailable.");
    }
  }

  if (request.method === "GET" && pathname === "/api/market-symbols") {
    try {
      return jsonResponse(request, env, 200, await marketSymbols(request, env));
    } catch (error) {
      throw new GatewayError(502, "MARKET_SYMBOLS_UNAVAILABLE", error.message || "Market symbols unavailable.");
    }
  }

  if (request.method === "GET" && pathname === "/api/market-stream") {
    if (!requestOriginAllowed(request, env)) throw new GatewayError(403, "ORIGIN_NOT_ALLOWED", "This browser origin is not allowed.");
    try { return await marketStream(request, env); }
    catch (error) { throw new GatewayError(502, "MARKET_STREAM_UNAVAILABLE", error.message || "Live market stream unavailable."); }
  }

  if (request.method === "GET" && pathname === "/api/gemini-live-status") {
    return jsonResponse(request, env, 200, geminiStatus(env));
  }

  if (!requestOriginAllowed(request, env)) {
    throw new GatewayError(403, "ORIGIN_NOT_ALLOWED", "This browser origin is not allowed.");
  }
  if (request.method === "OPTIONS") return preflightResponse(request, env);

  if (request.method === "GET" && pathname === "/api/trading-analysis") {
    try { return jsonResponse(request, env, 200, await tradingAnalysis(request, env)); }
    catch (error) { if (error instanceof GatewayError) throw error; throw new GatewayError(503, "TRADING_ANALYSIS_UNAVAILABLE", error.message || "Trading analysis unavailable."); }
  }
  if (request.method === "GET" && ["/api/trading/instruments", "/instruments"].includes(pathname)) {
    return jsonResponse(request, env, 200, await tradingInstruments(request, env));
  }
  if (request.method === "GET" && ["/api/trading/bars", "/bars"].includes(pathname)) {
    return jsonResponse(request, env, 200, await tradingBars(request, env));
  }
  if (request.method === "POST" && ["/api/trading/plan", "/plan"].includes(pathname)) {
    return jsonResponse(request, env, 200, await tradingPlan(request, env));
  }
  if (request.method === "POST" && ["/api/trading/journal", "/journal"].includes(pathname)) {
    return jsonResponse(request, env, 201, await tradingJournal(request, env));
  }
  if (request.method === "GET" && ["/api/trading/performance", "/performance"].includes(pathname)) {
    return jsonResponse(request, env, 200, await tradingPerformance(request, env));
  }

  if (request.method === "GET" && pathname === "/health") {
    return publicHealth(request, env, await currentOriginState(env));
  }
  if (request.method === "GET" && ["/config", "/api/auth-config"].includes(pathname)) {
    return jsonResponse(request, env, 200, publicConfig(env));
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
    return jsonResponse(request, env, 200, await issueGeminiToken(request, env, session, idempotencyKey));
  }

  if (request.method === "POST" && pathname === "/api/chat-decision") {
    const idempotencyKey = requireIdempotencyKey(request);
    const session = await verifySession(request, env, { profile: "required" });
    return jsonResponse(
      request,
      env,
      200,
      await issueDecisionIntelligence(request, env, session, idempotencyKey),
    );
  }

  if (pathname === "/api/account-profile" && request.method === "GET") {
    const session = await verifySession(request, env, { profile: "optional" });
    return jsonResponse(request, env, 200, session.profile);
  }

  if (pathname === "/api/account-profile" && request.method === "POST") {
    requireIdempotencyKey(request);
    const session = await verifySession(request, env, { profile: "optional" });
    const payload = await request.json().catch(() => ({}));
    const profile = await updateProfile(env, session.token, session.user.id, payload);
    return jsonResponse(request, env, 200, profile);
  }

  // Unsupported legacy routes fail closed at the Cloudflare edge.
  if (!pathname.startsWith("/api/") && !pathname.startsWith("/audio/")) {
    throw new GatewayError(404, "NOT_FOUND", "Not found.");
  }
  if (!(request.method === "GET" && PUBLIC_COMPATIBILITY_GET_PATHS.has(pathname))) {
    await verifySession(request, env, { profile: "required" });
  }
  return maintenanceResponse(request, env, pathname, "EDGE_ROUTE_NOT_IMPLEMENTED");
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return errorResponse(request, env, error);
    }
  },
  async scheduled(controller, env) {
    try { await scheduledTradingAnalysis(controller, env); }
    catch (error) { console.error("Scheduled trading analysis failed:", error?.message || error); throw error; }
  },
};

export { handleRequest };
