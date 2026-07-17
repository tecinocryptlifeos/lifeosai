(() => {
  "use strict";

  const state = {
    client: null,
    session: null,
    config: null,
    profile: null,
    ready: false,
    mode: "sign-in",
  };
  const signInAuditPending = new Set();
  const SIGN_IN_AUDIT_KEY = "lifeos-sign-in-audit-v1";
  const ACCESS_CHECK_INTERVAL_MS = 30000;
  let resolveReady;
  let accessCheckTimer = 0;
  const readyPromise = new Promise(resolve => { resolveReady = resolve; });
  const $ = id => document.getElementById(id);
  const all = selector => Array.from(document.querySelectorAll(selector));
  const value = id => $(id)?.value?.trim?.() || "";
  const device = () => /android/i.test(navigator.userAgent)
    ? "Android"
    : /iphone|ipad/i.test(navigator.userAgent) ? "iOS" : "Desktop";

  function setMessage(text, kind = "") {
    const element = $("authMessage");
    if (!element) return;
    element.textContent = text;
    element.dataset.kind = kind;
  }

  function show(element, visible) {
    if (element) element.hidden = !visible;
  }

  function configured() {
    return Boolean(state.config?.configured);
  }

  function authenticated() {
    return configured() && Boolean(state.session?.access_token);
  }

  function profileComplete() {
    return authenticated() && Boolean(state.profile?.complete);
  }

  function setMode(mode, announce = true) {
    state.mode = mode === "sign-up" ? "sign-up" : "sign-in";
    const emailEnabled = configured() && Boolean(state.config?.email_enabled);
    const registrationEnabled = emailEnabled && Boolean(state.config?.registration_enabled);
    const entryVisible = !authenticated();
    show($("authSignInPanel"), entryVisible && emailEnabled && state.mode === "sign-in");
    show($("authSignUpPanel"), entryVisible && registrationEnabled && state.mode === "sign-up");
    $("authTabSignIn")?.setAttribute("aria-selected", String(state.mode === "sign-in"));
    $("authTabSignUp")?.setAttribute("aria-selected", String(state.mode === "sign-up"));
    if (announce && entryVisible) {
      setMessage(
        state.mode === "sign-up"
          ? "Create a verified LifeOS account."
          : "Sign in securely before using Sophia.",
        "ready",
      );
    }
  }

  async function loadConfig() {
    const response = await fetch("/api/auth-config", { cache: "no-store" });
    if (!response.ok) throw new Error("The account configuration endpoint is unavailable.");
    state.config = await response.json();
    if (!state.config.auth_required) throw new Error("Mandatory account protection is not active.");
    return state.config;
  }

  function accessToken() {
    return state.session?.access_token || "";
  }

  async function loadProfile() {
    const token = accessToken();
    if (!token) {
      state.profile = null;
      return null;
    }
    const response = await fetch("/api/account-profile", {
      cache: "no-store",
      headers: { "Authorization": "Bearer " + token },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error(data.error || "The sign-in session is invalid or expired.");
    if (!response.ok) throw new Error(data.error || "The LifeOS account profile could not be loaded.");
    state.profile = data;
    fillProfileForm();
    return data;
  }

  function fillProfileForm() {
    const profile = state.profile?.profile || {};
    const metadata = state.session?.user?.user_metadata || {};
    const values = {
      profileFirstName: profile.first_name || metadata.first_name || "",
      profileSurname: profile.surname || metadata.surname || "",
      profileDateOfBirth: profile.date_of_birth || metadata.date_of_birth || "",
      profileCountry: profile.country || metadata.country || "",
      profilePhone: profile.phone || metadata.phone || "",
    };
    Object.entries(values).forEach(([id, fieldValue]) => {
      const input = $(id);
      if (input && !input.value) input.value = fieldValue;
    });
  }

  async function event(eventType, extra = {}) {
    try {
      const token = accessToken();
      if (!token || !profileComplete()) return false;
      const response = await fetch("/api/analytics-event", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ event_type: eventType, device_type: device(), browser: navigator.userAgent, ...extra }),
        keepalive: true,
      });
      return response.ok;
    } catch (error) {
      console.warn("LifeOS audit event failed", error);
      return false;
    }
  }

  function signInFingerprint() {
    const user = state.session?.user;
    if (!user?.id || !profileComplete()) return "";
    return [user.id, user.last_sign_in_at || state.session?.expires_at || "session"].join(":");
  }

  async function auditSignInOnce() {
    const fingerprint = signInFingerprint();
    if (!fingerprint || signInAuditPending.has(fingerprint)) return;
    try { if (localStorage.getItem(SIGN_IN_AUDIT_KEY) === fingerprint) return; }
    catch (error) { console.warn("LifeOS sign-in audit storage is unavailable", error); }
    signInAuditPending.add(fingerprint);
    try {
      const recorded = await event("sign_in", { metadata: { route: location.pathname } });
      if (recorded) {
        try { localStorage.setItem(SIGN_IN_AUDIT_KEY, fingerprint); }
        catch (error) { console.warn("LifeOS sign-in audit marker could not be saved", error); }
      }
    } finally { signInAuditPending.delete(fingerprint); }
  }

  function render() {
    const isConfigured = configured();
    const isAuthenticated = authenticated();
    const isComplete = profileComplete();
    const emailEnabled = isConfigured && Boolean(state.config?.email_enabled);
    const googleEnabled = isConfigured && Boolean(state.config?.google_enabled);
    const registrationEnabled = emailEnabled && Boolean(state.config?.registration_enabled);
    const providerReady = emailEnabled || googleEnabled;
    const entryVisible = !isAuthenticated;
    const profileRequired = isAuthenticated && !isComplete;

    document.body.classList.toggle("lifeos-signed-in", isComplete);
    document.body.classList.toggle("lifeos-auth-configured", isConfigured);
    document.body.classList.toggle("lifeos-profile-required", profileRequired);
    all("[data-lifeos-auth-gate]").forEach(element => show(element, !isComplete));
    all("[data-lifeos-protected]").forEach(element => show(element, isComplete));
    all("[data-lifeos-email-auth]").forEach(element => show(element, entryVisible && emailEnabled));
    all("[data-lifeos-registration]").forEach(element => show(element, entryVisible && registrationEnabled));
    all("[data-lifeos-profile-completion]").forEach(element => show(element, profileRequired));
    all("[data-lifeos-auth-tabs]").forEach(element => show(element, entryVisible && emailEnabled && registrationEnabled));
    all("[data-lifeos-google-entry]").forEach(element => show(element, entryVisible && googleEnabled));

    setMode(state.mode, false);
    const identity = $("userIdentity");
    if (identity) identity.textContent = isAuthenticated
      ? state.session.user.user_metadata?.full_name || state.session.user.email || "Signed in"
      : "";
    show($("signOut"), isComplete);
    if ($("googleSignIn")) $("googleSignIn").disabled = !googleEnabled;

    const badge = $("authStatusBadge");
    if (badge) {
      badge.textContent = isComplete
        ? "SIGNED IN"
        : profileRequired ? "PROFILE REQUIRED" : providerReady ? "SIGN-IN REQUIRED" : "SERVICE LOCKED";
      badge.dataset.state = isComplete ? "ok" : profileRequired || providerReady ? "ready" : "warning";
    }

    if (!isConfigured) {
      setMessage("Public access is locked while secure account configuration is completed.", "warning");
    } else if (!providerReady) {
      setMessage("Public access is locked until a secure sign-in provider is enabled.", "warning");
    } else if (profileRequired) {
      setMessage("Complete the required profile details before using Sophia.", "warning");
    } else if (!isAuthenticated) {
      setMode(state.mode);
    }
  }

  function finishReady() {
    if (state.ready) return;
    state.ready = true;
    resolveReady();
  }

  function notifyAuthChange() {
    window.dispatchEvent(new CustomEvent("lifeos-auth-change", {
      detail: { signedIn: profileComplete(), authenticated: authenticated(), profileComplete: profileComplete() },
    }));
  }

  async function clearRevokedSession(reason) {
    if (!state.session) return;
    setMessage(reason || "Your LifeOS session ended. Sign in again.", "warning");
    window.dispatchEvent(new CustomEvent("lifeos-access-revoked", { detail: { reason: reason || "Access revoked" } }));
    try {
      const result = await state.client?.auth?.signOut?.({ scope: "local" });
      if (result?.error) console.warn("LifeOS local session cleanup reported an error", result.error);
    } catch (error) { console.warn("LifeOS local session cleanup was incomplete", error); }
    state.session = null;
    state.profile = null;
    render();
    notifyAuthChange();
  }

  async function completeSignedInSession() {
    if (!state.session) {
      state.profile = null;
      render();
      notifyAuthChange();
      return;
    }
    await loadProfile();
    render();
    notifyAuthChange();
    if (profileComplete()) {
      void auditSignInOnce();
      void event("page_view", { metadata: { route: location.pathname } });
    }
  }

  async function checkAccess() {
    const token = accessToken();
    if (!token || document.visibilityState === "hidden") return true;
    try {
      const response = await fetch("/api/session-status", {
        cache: "no-store",
        headers: { "Authorization": "Bearer " + token },
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        await clearRevokedSession(data.error);
        return false;
      }
      if (!response.ok) return false;
      if (Boolean(data.profile_complete) !== profileComplete()) {
        await loadProfile();
        render();
        notifyAuthChange();
      }
      return true;
    } catch (error) { return false; }
  }

  function scheduleAccessChecks() {
    window.clearInterval(accessCheckTimer);
    accessCheckTimer = window.setInterval(() => { void checkAccess(); }, ACCESS_CHECK_INTERVAL_MS);
  }

  async function init() {
    try {
      const config = await loadConfig();
      if (config.configured) {
        if (!window.supabase?.createClient) throw new Error("The secure sign-in library did not load. Refresh the page and try again.");
        state.client = window.supabase.createClient(config.supabase_url, config.supabase_anon_key, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        const { data, error } = await state.client.auth.getSession();
        if (error) throw error;
        state.session = data.session;
        if (state.session) await loadProfile();
        state.client.auth.onAuthStateChange((kind, session) => {
          state.session = session;
          if (!session) state.profile = null;
          void completeSignedInSession().catch(error => {
            setMessage(error.message || "The LifeOS account profile could not be loaded.", "error");
          });
          if (kind === "SIGNED_IN") {
            history.replaceState(null, "", location.pathname);
          }
        });
      }
      finishReady();
      render();
      notifyAuthChange();
      if (state.session && profileComplete()) {
        void auditSignInOnce();
        void event("page_view", { metadata: { route: location.pathname } });
      }
      scheduleAccessChecks();
    } catch (error) {
      state.config = state.config || { configured: false, auth_required: true };
      finishReady();
      render();
      notifyAuthChange();
      setMessage(error.message || "The account system could not initialize.", "error");
      console.error(error);
    }
  }

  function accountService() {
    if (!window.LifeOSAccount) throw new Error("The LifeOS account module did not load.");
    if (!state.client || !state.config?.email_enabled) throw new Error("Email accounts are not enabled.");
    return window.LifeOSAccount;
  }

  async function emailPasswordSignIn() {
    try {
      setMessage("Signing in…", "ready");
      const result = await accountService().signIn(state.client, value("authEmail"), $("authPassword")?.value || "");
      if (result.error) throw result.error;
      setMessage("Sign-in accepted. Checking your LifeOS profile…", "ok");
    } catch (error) { setMessage(error.message || "Email sign-in failed.", "error"); }
  }

  async function emailSignUp() {
    try {
      if (!state.config?.registration_enabled) throw new Error("Public registration is not enabled.");
      setMessage("Creating your secure account…", "ready");
      const result = await accountService().signUp(state.client, {
        first_name: value("authFirstName"), surname: value("authSurname"),
        date_of_birth: value("authDateOfBirth"), country: value("authCountry"),
        phone: value("authPhone"), email: value("authSignupEmail"),
        password: $("authSignupPassword")?.value || "", accept_terms: Boolean($("authAcceptTerms")?.checked),
      }, {
        minimumAge: Number(state.config.minimum_age || 13),
        passwordMinimum: Number(state.config.password_min_length || 10),
        redirectTo: location.origin + location.pathname,
      });
      if (result.error) throw result.error;
      setMessage(result.data?.session
        ? "Account created. Checking your LifeOS profile…"
        : "Account created. Check your email and confirm the account before signing in.", "ok");
      if (!result.data?.session) setMode("sign-in", false);
    } catch (error) { setMessage(error.message || "Account creation failed.", "error"); }
  }

  async function requestPasswordReset() {
    try {
      setMessage("Sending password-reset instructions…", "ready");
      const result = await accountService().requestPasswordReset(
        state.client,
        value("authEmail"),
        location.origin + "/reset-password",
      );
      if (result.error) throw result.error;
      setMessage("Check your email for the password-reset link.", "ok");
    } catch (error) { setMessage(error.message || "Password reset could not be started.", "error"); }
  }

  async function saveProfile() {
    try {
      if (!authenticated()) throw new Error("Sign in before completing your profile.");
      const payload = {
        first_name: value("profileFirstName"),
        surname: value("profileSurname"),
        date_of_birth: value("profileDateOfBirth"),
        country: value("profileCountry"),
        phone: value("profilePhone"),
        accept_terms: Boolean($("profileAcceptTerms")?.checked),
      };
      window.LifeOSAccount?.validateRequiredProfile(payload, {
        minimumAge: Number(state.config?.minimum_age || 13),
      });
      setMessage("Saving your verified LifeOS profile…", "ready");
      const response = await authFetch("/api/account-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The LifeOS profile could not be saved.");
      state.profile = data;
      render();
      notifyAuthChange();
      setMessage("Profile completed. LifeOS access is now active.", "ok");
      void auditSignInOnce();
      void event("page_view", { metadata: { route: location.pathname } });
    } catch (error) { setMessage(error.message || "Profile completion failed.", "error"); }
  }

  async function googleSignIn() {
    if (!state.client || !state.config?.google_enabled) {
      setMessage("Google sign-in is not enabled.", "warning");
      return;
    }
    const { error } = await state.client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) setMessage(error.message, "error");
  }

  async function signOut() {
    if (!state.client || !state.session) return;
    await event("sign_out", { metadata: { route: location.pathname } });
    const { error } = await state.client.auth.signOut();
    if (error) setMessage(error.message, "error");
  }

  async function authFetch(url, options = {}) {
    await readyPromise;
    const token = accessToken();
    if (!token) throw new Error("Sign in before using Sophia.");
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), "Authorization": "Bearer " + token },
    });
    if (response.status === 401 || response.status === 403) {
      const data = await response.clone().json().catch(() => ({}));
      if (data.code === "PROFILE_REQUIRED") {
        await loadProfile().catch(() => {});
        render();
        notifyAuthChange();
      } else if (/blocked|signed out by an administrator|invalid or expired/i.test(data.error || "")) {
        void clearRevokedSession(data.error);
      }
    }
    return response;
  }

  window.LifeOSAuth = {
    init, event, authFetch, checkAccess, whenReady: () => readyPromise,
    get session() { return state.session; },
    get config() { return state.config; },
    get profile() { return state.profile; },
    get signedIn() { return profileComplete(); },
    get configured() { return configured(); },
    get ready() { return state.ready; },
  };

  document.addEventListener("DOMContentLoaded", () => {
    void init();
    $("authTabSignIn")?.addEventListener("click", () => setMode("sign-in"));
    $("authTabSignUp")?.addEventListener("click", () => setMode("sign-up"));
    $("emailPasswordSignIn")?.addEventListener("click", () => { void emailPasswordSignIn(); });
    $("emailSignUp")?.addEventListener("click", () => { void emailSignUp(); });
    $("forgotPassword")?.addEventListener("click", () => { void requestPasswordReset(); });
    $("saveProfile")?.addEventListener("click", () => { void saveProfile(); });
    $("googleSignIn")?.addEventListener("click", () => { void googleSignIn(); });
    $("signOut")?.addEventListener("click", () => { void signOut(); });
    $("profileSignOut")?.addEventListener("click", () => { void signOut(); });
    $("authPassword")?.addEventListener("keydown", eventObject => {
      if (eventObject.key === "Enter") void emailPasswordSignIn();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void checkAccess();
    });
    window.addEventListener("focus", () => { void checkAccess(); });
  });
})();
