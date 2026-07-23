/* LOSAI_ACCOUNT_RUNTIME_BRIDGE_V2_1_1 */
(function (global) {
  "use strict";

  const VERSION = "2.1.1";
  const SUBMIT_ID = "emailPasswordSignIn";
  const SIGNUP_TAB_ID = "authTabSignUp";
  const SIGNIN_TAB_ID = "authTabSignIn";
  let clientPromise = null;
  let busy = false;

  function normalized(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function rootsFor(element) {
    const roots = [];
    let current = element;
    while (current && current !== document.documentElement) {
      if (current.querySelector) roots.push(current);
      current = current.parentElement;
    }
    roots.push(document);
    return roots;
  }

  function controls(root) {
    return Array.from(root.querySelectorAll("input, select, textarea"));
  }

  function identity(control) {
    const label = control.labels && control.labels.length
      ? Array.from(control.labels).map((item) => item.textContent || "").join(" ")
      : "";
    return normalized([
      control.id,
      control.name,
      control.type,
      control.autocomplete,
      control.placeholder,
      control.getAttribute && control.getAttribute("aria-label"),
      control.getAttribute && control.getAttribute("data-field"),
      label
    ].filter(Boolean).join(" "));
  }

  function findField(root, aliases, preferredType) {
    const wanted = aliases.map(normalized);
    const list = controls(root).filter((control) => !control.disabled);
    if (preferredType) {
      const typed = list.find((control) => normalized(control.type) === normalized(preferredType));
      if (typed) return typed;
    }
    return list.find((control) => {
      const key = identity(control);
      return wanted.some((alias) => key === alias || key.includes(alias));
    }) || null;
  }

  function findPasswordFields(root) {
    return controls(root).filter((control) => normalized(control.type) === "password" && !control.disabled);
  }

  function value(control) {
    return control ? String(control.value || "").trim() : "";
  }

  function findMessage(root) {
    const selectors = [
      "[data-lifeos-auth-message]",
      "#authMessage",
      "#authStatus",
      "#authError",
      ".auth-message",
      ".auth-status",
      ".auth-error",
      "[role='alert']",
      "[role='status']"
    ];
    for (const selector of selectors) {
      const node = root.querySelector && root.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function showMessage(root, text, isError) {
    const node = findMessage(root);
    if (node) {
      node.textContent = text;
      node.hidden = false;
      node.setAttribute("role", isError ? "alert" : "status");
      node.setAttribute("data-state", isError ? "error" : "success");
      return;
    }
    if (global.alert) global.alert(text);
  }

  function safeMessage(error) {
    const message = String(error && error.message ? error.message : "The account request could not be completed.");
    return message.replace(/(?:eyJ|sb_(?:publishable|secret)_)[A-Za-z0-9._-]{20,}/g, "[redacted]").slice(0, 300);
  }

  function nestedString(object, keys) {
    const wanted = keys.map(normalized);
    const queue = [{ value: object, depth: 0 }];
    const seen = new Set();
    while (queue.length) {
      const item = queue.shift();
      if (!item.value || typeof item.value !== "object" || seen.has(item.value) || item.depth > 4) continue;
      seen.add(item.value);
      for (const [key, child] of Object.entries(item.value)) {
        if (typeof child === "string" && wanted.includes(normalized(key)) && child.trim()) return child.trim();
        if (child && typeof child === "object") queue.push({ value: child, depth: item.depth + 1 });
      }
    }
    return "";
  }

  function existingClient() {
    const candidates = [
      global.__LOSAI_SUPABASE_CLIENT__,
      global.lifeosSupabaseClient,
      global.supabaseClient,
      global.LifeOSAuth && global.LifeOSAuth.client,
      global.LifeOSAccount && global.LifeOSAccount.client
    ];
    return candidates.find((candidate) => candidate && candidate.auth &&
      typeof candidate.auth.signUp === "function" &&
      typeof candidate.auth.signInWithPassword === "function") || null;
  }

  async function getClient() {
    const current = existingClient();
    if (current) return current;
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
      const response = await global.fetch("/api/auth-config", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("Account configuration is unavailable (HTTP " + response.status + ").");
      const config = await response.json();
      const url = nestedString(config, ["supabase_url", "supabaseUrl", "url"]);
      const key = nestedString(config, ["supabase_anon_key", "supabaseAnonKey", "anon_key", "anonKey", "publishable_key", "publishableKey"]);
      if (!url || !key) throw new Error("The public account configuration is incomplete.");
      if (!global.supabase || typeof global.supabase.createClient !== "function") {
        throw new Error("The Supabase authentication library did not load.");
      }
      const client = global.supabase.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      global.__LOSAI_SUPABASE_CLIENT__ = client;
      return client;
    })();
    try {
      return await clientPromise;
    } catch (error) {
      clientPromise = null;
      throw error;
    }
  }

  function isSignupMode(button) {
    const tab = document.getElementById(SIGNUP_TAB_ID);
    if (tab) {
      if (tab.getAttribute("aria-selected") === "true") return true;
      if (tab.classList && (tab.classList.contains("active") || tab.classList.contains("selected"))) return true;
      if (tab.dataset && ["true", "signup", "register"].includes(String(tab.dataset.active || tab.dataset.mode || "").toLowerCase())) return true;
    }
    return /create\s*account|sign\s*up|register/i.test(String(button.textContent || button.value || ""));
  }

  function ageFrom(dateText) {
    if (!dateText) return null;
    const birth = new Date(dateText + "T00:00:00");
    if (Number.isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    if (today.getMonth() < birth.getMonth() ||
        (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
    return age;
  }

  function requestRoot(button) {
    const roots = rootsFor(button);
    return roots.find((root) => {
      if (!root.querySelector) return false;
      return Boolean(root.querySelector("input[type='email']") && root.querySelector("input[type='password']"));
    }) || document;
  }

  async function run(button) {
    if (busy || button.disabled) return;
    const root = requestRoot(button);
    const form = button.closest ? button.closest("form") : null;
    if (form && typeof form.reportValidity === "function" && !form.reportValidity()) return;
    const email = value(findField(root, ["email", "emailaddress"], "email"));
    const passwordFields = findPasswordFields(root);
    const password = value(passwordFields[0]);
    const confirmation = value(passwordFields[1]);
    const signup = isSignupMode(button);

    if (!email || !password) {
      showMessage(root, "Enter your email address and password.", true);
      return;
    }
    if (signup && password.length < 10) {
      showMessage(root, "Use a password with at least 10 characters.", true);
      return;
    }
    if (signup && confirmation && password !== confirmation) {
      showMessage(root, "The two passwords do not match.", true);
      return;
    }

    const firstName = value(findField(root, ["firstname", "givenname", "forename"]));
    const lastName = value(findField(root, ["lastname", "surname", "secondname", "familyname"]));
    const username = value(findField(root, ["username", "displayname", "profilename"]));
    const dateOfBirth = value(findField(root, ["dateofbirth", "birthdate", "birthday", "dob"]));
    const country = value(findField(root, ["countryoforigin", "country", "nationality"]));
    const phone = value(findField(root, ["phone", "phonenumber", "telephone"], "tel"));
    const age = ageFrom(dateOfBirth);

    if (signup && age !== null && age < 13) {
      showMessage(root, "You must be at least 13 years old to create an account.", true);
      return;
    }

    const original = button.textContent;
    busy = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = signup ? "Creating Account…" : "Signing In…";
    showMessage(root, signup ? "Creating your account…" : "Signing you in…", false);

    try {
      const client = await getClient();
      let result;
      if (signup) {
        const fullName = [firstName, lastName].filter(Boolean).join(" ");
        const metadata = {
          first_name: firstName,
          last_name: lastName,
          surname: lastName,
          username: username,
          display_name: username || fullName,
          full_name: fullName,
          date_of_birth: dateOfBirth,
          country: country,
          country_of_origin: country,
          phone: phone
        };
        Object.keys(metadata).forEach((key) => { if (!metadata[key]) delete metadata[key]; });
        result = await client.auth.signUp({
          email,
          password,
          options: {
            data: metadata,
            emailRedirectTo: global.location.origin + "/chat"
          }
        });
      } else {
        result = await client.auth.signInWithPassword({ email, password });
      }
      if (result && result.error) throw result.error;
      const session = result && result.data && result.data.session;
      if (signup && !session) {
        showMessage(root, "Account created. Check your email and confirm the account before signing in.", false);
      } else {
        showMessage(root, signup ? "Account created successfully. Opening LOSAI…" : "Sign-in successful. Opening LOSAI…", false);
        global.setTimeout(() => global.location.reload(), 400);
      }
    } catch (error) {
      showMessage(root, safeMessage(error), true);
    } finally {
      busy = false;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = original;
    }
  }

  function submitButtonFromEvent(event) {
    const target = event.target;
    if (!target) return null;
    if (target.id === SUBMIT_ID) return target;
    if (target.closest) return target.closest("#" + SUBMIT_ID);
    return null;
  }

  document.addEventListener("click", function (event) {
    const button = submitButtonFromEvent(event);
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    void run(button);
  }, true);

  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!form || !form.querySelector) return;
    const button = form.querySelector("#" + SUBMIT_ID);
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    void run(button);
  }, true);

  global.LOSAIAccountRuntimeBridge = Object.freeze({ version: VERSION, run });
})(window);
