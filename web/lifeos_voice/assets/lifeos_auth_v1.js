(() => {
  "use strict";

  const state = { client: null, session: null, config: null, ready: false };
  let resolveReady;
  const readyPromise = new Promise(resolve => { resolveReady = resolve; });
  const $ = id => document.getElementById(id);
  const all = selector => Array.from(document.querySelectorAll(selector));
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

  async function event(eventType, extra = {}) {
    try {
      const token = accessToken();
      if (!token) return;
      await fetch("/api/analytics-event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({
          event_type: eventType,
          device_type: device(),
          browser: navigator.userAgent,
          ...extra,
        }),
        keepalive: true,
      });
    } catch (error) {
      console.warn("LifeOS audit event failed", error);
    }
  }

  function render() {
    const configured = Boolean(state.config?.configured);
    const signedIn = configured && Boolean(state.session?.access_token);
    const emailEnabled = configured && Boolean(state.config?.email_enabled);
    const googleEnabled = configured && Boolean(state.config?.google_enabled);
    const providerReady = emailEnabled || googleEnabled;

    document.body.classList.toggle("lifeos-signed-in", signedIn);
    document.body.classList.toggle("lifeos-auth-configured", configured);
    all("[data-lifeos-auth-gate]").forEach(element => show(element, !signedIn));
    all("[data-lifeos-protected]").forEach(element => show(element, signedIn));

    const identity = $("userIdentity");
    if (identity) {
      identity.textContent = signedIn
        ? state.session.user.user_metadata?.full_name || state.session.user.email || "Signed in"
        : "";
    }
    show($("signOut"), signedIn);

    const email = $("authEmail");
    const emailButton = $("emailSignIn");
    const googleButton = $("googleSignIn");
    if (email) {
      email.disabled = !emailEnabled;
      show(email, emailEnabled);
    }
    if (emailButton) {
      emailButton.disabled = !emailEnabled;
      show(emailButton, emailEnabled);
    }
    if (googleButton) {
      googleButton.disabled = !googleEnabled;
      show(googleButton, googleEnabled);
    }

    const badge = $("authStatusBadge");
    if (badge) {
      badge.textContent = signedIn ? "SIGNED IN" : providerReady ? "SIGN-IN REQUIRED" : "SERVICE LOCKED";
      badge.dataset.state = signedIn ? "ok" : providerReady ? "ready" : "warning";
    }

    if (!configured) {
      setMessage(
        "Public access is locked while the owner completes secure account configuration. Sophia cannot be started without sign-in.",
        "warning",
      );
    } else if (!providerReady) {
      setMessage(
        "Public access is locked until the owner enables a secure sign-in provider.",
        "warning",
      );
    } else if (!signedIn) {
      setMessage("Sign in securely before using Sophia.", "ready");
    }
  }

  function finishReady() {
    if (state.ready) return;
    state.ready = true;
    resolveReady();
  }

  function notifyAuthChange() {
    window.dispatchEvent(new CustomEvent("lifeos-auth-change", {
      detail: { signedIn: Boolean(state.session?.access_token) },
    }));
  }

  async function init() {
    try {
      const config = await loadConfig();
      if (config.configured) {
        if (!window.supabase?.createClient) {
          throw new Error("The secure sign-in library did not load. Refresh the page and try again.");
        }
        state.client = window.supabase.createClient(
          config.supabase_url,
          config.supabase_anon_key,
          { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
        );
        const { data, error } = await state.client.auth.getSession();
        if (error) throw error;
        state.session = data.session;
        state.client.auth.onAuthStateChange((kind, session) => {
          state.session = session;
          render();
          notifyAuthChange();
          if (kind === "SIGNED_IN") {
            void event("sign_in", { metadata: { route: location.pathname } });
            history.replaceState(null, "", location.pathname);
          }
        });
      }
      finishReady();
      render();
      notifyAuthChange();
      if (state.session) {
        void event("page_view", { metadata: { route: location.pathname } });
      }
    } catch (error) {
      state.config = state.config || { configured: false, auth_required: true };
      finishReady();
      render();
      notifyAuthChange();
      setMessage(error.message || "The account system could not initialize.", "error");
      console.error(error);
    }
  }

  async function emailSignIn() {
    if (!state.client || !state.config?.email_enabled) {
      setMessage("Email sign-in is not enabled. Continue with Google.", "warning");
      return;
    }
    const email = $("authEmail")?.value.trim() || "";
    if (!email) {
      setMessage("Enter your email address.", "error");
      return;
    }
    setMessage("Sending secure sign-in link…", "ready");
    const { error } = await state.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    setMessage(
      error ? error.message : "Check your email and tap the secure sign-in link.",
      error ? "error" : "ok",
    );
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
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        "Authorization": "Bearer " + token,
      },
    });
  }

  window.LifeOSAuth = {
    init,
    event,
    authFetch,
    whenReady: () => readyPromise,
    get session() { return state.session; },
    get config() { return state.config; },
    get configured() { return Boolean(state.config?.configured); },
    get ready() { return state.ready; },
  };

  document.addEventListener("DOMContentLoaded", () => {
    void init();
    $("emailSignIn")?.addEventListener("click", () => { void emailSignIn(); });
    $("authEmail")?.addEventListener("keydown", eventObject => {
      if (eventObject.key === "Enter") void emailSignIn();
    });
    $("googleSignIn")?.addEventListener("click", () => { void googleSignIn(); });
    $("signOut")?.addEventListener("click", () => { void signOut(); });
  });
})();
