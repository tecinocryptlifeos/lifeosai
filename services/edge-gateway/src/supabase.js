import {
  GatewayError,
  jsonResponse,
  requireIdempotencyKey,
} from "./policy.js";

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function integerSetting(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ""), 10);
  const selected = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(minimum, Math.min(maximum, selected));
}

function publicKey(env) {
  return String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "").trim();
}

function requireSupabase(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = publicKey(env);
  if (!url || !key) {
    throw new GatewayError(503, "AUTH_NOT_CONFIGURED", "LifeOS authentication is not configured.");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new GatewayError(503, "AUTH_NOT_CONFIGURED", "LifeOS authentication is not configured.");
  }
  if (parsed.protocol !== "https:" || parsed.origin !== url) {
    throw new GatewayError(503, "AUTH_NOT_CONFIGURED", "LifeOS authentication is not configured.");
  }
  return { url, key };
}

function fetchImpl(env) {
  return typeof env.__TEST_FETCH__ === "function" ? env.__TEST_FETCH__ : fetch;
}

async function fetchJson(env, url, options = {}, timeoutMs = 10000) {
  const response = await fetchImpl(env)(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function bearerToken(request) {
  const header = String(request.headers.get("Authorization") || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

function decodedClaimsAfterVerification(token) {
  try {
    const encoded = token.split(".")[1] || "";
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

function enforceAccountAccess(user, token) {
  const metadata = user?.app_metadata && typeof user.app_metadata === "object"
    ? user.app_metadata
    : {};
  if (metadata.lifeos_access_blocked === true) {
    throw new GatewayError(403, "ACCOUNT_BLOCKED", "This LifeOS account has been blocked by an administrator.");
  }
  const claims = decodedClaimsAfterVerification(token);
  const issuedAt = Number.parseInt(String(claims.iat || "0"), 10) || 0;
  const validAfter = Number.parseInt(String(metadata.lifeos_session_not_before || "0"), 10) || 0;
  if (validAfter && issuedAt <= validAfter) {
    throw new GatewayError(401, "SESSION_REVOKED", "This LifeOS session was signed out by an administrator. Sign in again.");
  }
}

function profileComplete(profile, minimumAge) {
  if (!profile || typeof profile !== "object") return false;
  for (const field of ["first_name", "surname", "country"]) {
    if (!String(profile[field] || "").trim()) return false;
  }
  if (!profile.terms_accepted_at) return false;
  if (String(profile.date_of_birth || "").trim()) {
    const birth = new Date(`${profile.date_of_birth}T00:00:00Z`);
    if (Number.isNaN(birth.getTime())) return false;
    const today = new Date();
    let age = today.getUTCFullYear() - birth.getUTCFullYear();
    const beforeBirthday = today.getUTCMonth() < birth.getUTCMonth() ||
      (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate());
    if (beforeBirthday) age -= 1;
    return age >= minimumAge;
  }
  const year = Number.parseInt(String(profile.birth_year || ""), 10);
  const currentYear = new Date().getUTCFullYear();
  return Number.isFinite(year) && year >= 1900 && currentYear - year >= minimumAge &&
    Boolean(profile.age_verified_at) && profile.dob_retention === "eligibility_only";
}

export function publicConfig(env) {
  const emailEnabled = enabled(env.LIFEOS_EMAIL_AUTH_ENABLED);
  const key = publicKey(env);
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  return {
    ok: true,
    configured: Boolean(url && key),
    supabase_url: url,
    supabase_anon_key: key,
    auth_required: true,
    auth_mode: "mandatory",
    email_enabled: emailEnabled,
    registration_enabled: emailEnabled && enabled(env.LIFEOS_REGISTRATION_ENABLED),
    google_enabled: enabled(env.LIFEOS_GOOGLE_AUTH_ENABLED),
    minimum_age: integerSetting(env.LIFEOS_MINIMUM_AGE, 13, 13, 18),
    password_min_length: integerSetting(env.LIFEOS_PASSWORD_MIN_LENGTH, 10, 8, 128),
    api_origin: String(env.LIFEOS_API_ORIGIN || "https://api.losai.ng.eu.org").replace(/\/$/, ""),
    public_site_origin: String(env.LIFEOS_PUBLIC_SITE_ORIGIN || "https://losai.ng.eu.org").replace(/\/$/, ""),
  };
}

export async function loadProfile(env, token, userId) {
  const { url, key } = requireSupabase(env);
  const query = new URLSearchParams({
    select: "user_id,email,display_name,first_name,surname,date_of_birth,country,phone,terms_accepted_at,birth_year,age_verified_at,dob_retention,account_status",
    user_id: `eq.${userId}`,
    limit: "1",
  });
  const { response, data } = await fetchJson(
    env,
    `${url}/rest/v1/lifeos_profiles?${query}`,
    { headers: { apikey: key, Authorization: `Bearer ${token}` } },
  );
  if (!response.ok || !Array.isArray(data)) {
    throw new GatewayError(503, "PROFILE_UNAVAILABLE", "The LifeOS account profile could not be loaded.");
  }
  const profile = data[0] || null;
  const minimumAge = integerSetting(env.LIFEOS_MINIMUM_AGE, 13, 13, 18);
  return { profile, complete: profileComplete(profile, minimumAge), minimum_age: minimumAge };
}

export async function verifySession(request, env, options = {}) {
  const token = bearerToken(request);
  if (!token) {
    throw new GatewayError(401, "AUTH_REQUIRED", "Sign-in is required.");
  }
  const { url, key } = requireSupabase(env);
  const { response, data: user } = await fetchJson(
    env,
    `${url}/auth/v1/user`,
    { headers: { apikey: key, Authorization: `Bearer ${token}` } },
  );
  if (!response.ok || !user?.id) {
    throw new GatewayError(401, "SESSION_INVALID", "The sign-in session is invalid or expired.");
  }
  enforceAccountAccess(user, token);
  let profile = null;
  if (options.profile !== "none") {
    profile = await loadProfile(env, token, user.id);
    if (options.profile === "required" && !profile.complete) {
      throw new GatewayError(403, "PROFILE_REQUIRED", "Complete your LifeOS profile before using Sophia.");
    }
  }
  return { user, token, profile };
}
// LOSAI_ACCOUNT_PROFILE_EDGE_FALLBACK_V1
function directProfileText(body, field) {
  return String(body?.[field] ?? "").trim();
}

function buildDirectProfileRow(body, session, minimumAge) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GatewayError(
      400,
      "INVALID_PROFILE",
      "The LifeOS profile request must be a JSON object.",
    );
  }

  if (body.accept_terms !== true) {
    throw new GatewayError(
      422,
      "PROFILE_TERMS_REQUIRED",
      "Accept the Terms and Privacy Policy before continuing.",
    );
  }

  const row = {
    user_id: session.user.id,
    email: session.user.email || null,
    first_name: directProfileText(body, "first_name"),
    surname: directProfileText(body, "surname"),
    date_of_birth: directProfileText(body, "date_of_birth"),
    country: directProfileText(body, "country"),
    phone: directProfileText(body, "phone") || null,
    terms_accepted_at: new Date().toISOString(),
  };

  if (!profileComplete(row, minimumAge)) {
    throw new GatewayError(
      422,
      "PROFILE_INVALID",
      "Complete the required profile details and minimum-age verification before continuing.",
    );
  }

  return row;
}

async function upsertDirectProfile(env, token, row) {
  const { url, key } = requireSupabase(env);

  const { response } = await fetchJson(
    env,
    `${url}/rest/v1/lifeos_profiles?on_conflict=user_id`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    },
  );

  if (!response.ok) {
    throw new GatewayError(
      503,
      "PROFILE_SAVE_FAILED",
      "The LifeOS account profile could not be saved.",
    );
  }
}

export async function handleAccountProfileDirect(request, env, session) {
  if (request.method === "GET") {
    return jsonResponse(request, env, 200, session.profile);
  }

  requireIdempotencyKey(request);

  let body;
  try {
    body = await request.json();
  } catch {
    throw new GatewayError(
      400,
      "INVALID_JSON",
      "The request body must be valid JSON.",
    );
  }

  const minimumAge = integerSetting(
    env.LIFEOS_MINIMUM_AGE,
    13,
    13,
    18,
  );

  const row = buildDirectProfileRow(
    body,
    session,
    minimumAge,
  );

  await upsertDirectProfile(
    env,
    session.token,
    row,
  );

  const profile = await loadProfile(
    env,
    session.token,
    session.user.id,
  );

  return jsonResponse(
    request,
    env,
    200,
    profile,
  );
}
