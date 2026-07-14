document.addEventListener("DOMContentLoaded", async () => {
  "use strict";

  const message = document.getElementById("message");
  const status = document.getElementById("systemStatus");
  const setup = document.getElementById("setupPanel");
  const dashboard = document.getElementById("dashboard");
  const escapeHtml = value => String(value ?? "").replace(
    /[&<>"']/g,
    character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

  async function loadDashboard() {
    if (!window.LifeOSAuth?.configured) {
      if (setup) setup.hidden = false;
      return;
    }
    if (!window.LifeOSAuth?.session) return;

    status.textContent = "VERIFYING ADMIN";
    status.className = "status";
    message.textContent = "Loading protected account and operations data…";
    dashboard.hidden = true;

    try {
      const response = await window.LifeOSAuth.authFetch("/api/admin-dashboard", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Dashboard unavailable");

      status.textContent = "ADMIN VERIFIED";
      status.className = "status ok";
      message.textContent = "";
      dashboard.hidden = false;

      const labels = {
        registered_users: "Registered users",
        sign_ins_today: "Sign-ins today",
        voice_sessions_today: "Voice sessions today",
        chat_messages_today: "Chat messages today",
        active_users_24h: "Active users · 24h",
        recent_errors: "Recent errors",
      };
      document.getElementById("metrics").innerHTML = Object.entries(data.metrics)
        .map(([key, value]) => `<div class="card"><div class="metric">${escapeHtml(value)}</div><div class="label">${escapeHtml(labels[key] || key)}</div></div>`)
        .join("");
      document.getElementById("users").innerHTML = data.users
        .map(user => `<tr><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.display_name)}</td><td>${escapeHtml(user.created_at)}</td><td>${escapeHtml(user.last_sign_in_at)}</td><td>${escapeHtml(user.account_status)}</td></tr>`)
        .join("");
      document.getElementById("events").innerHTML = data.events
        .map(event => `<tr><td>${escapeHtml(event.created_at)}</td><td>${escapeHtml(event.user_email)}</td><td>${escapeHtml(event.event_type)}</td><td>${escapeHtml(event.device_type)}</td><td>${escapeHtml(event.error_message || event.error_code || "")}</td></tr>`)
        .join("");
    } catch (error) {
      status.textContent = "ACCESS DENIED";
      status.className = "status warn";
      message.textContent = error.message;
    }
  }

  await window.LifeOSAuth?.whenReady?.();
  if (!window.LifeOSAuth?.configured) {
    if (setup) setup.hidden = false;
    return;
  }
  await loadDashboard();
  document.getElementById("refreshAdmin")?.addEventListener("click", () => { void loadDashboard(); });
  window.addEventListener("lifeos-auth-change", event => {
    if (event.detail?.signedIn) void loadDashboard();
  });
});
