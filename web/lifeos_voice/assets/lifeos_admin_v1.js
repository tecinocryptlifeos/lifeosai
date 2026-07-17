document.addEventListener("DOMContentLoaded", async () => {
  "use strict";

  const byId = id => document.getElementById(id);
  const message = byId("message");
  const systemStatus = byId("systemStatus");
  const setup = byId("setupPanel");
  const dashboard = byId("dashboard");
  const state = { data: null, errorLimit: 6, busy: false };

  const text = value => value == null || value === "" ? "—" : String(value);
  const date = value => {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? text(value) : parsed.toLocaleString();
  };
  const element = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = text(content);
    return node;
  };
  const focusPanel = id => {
    const panel = byId(id);
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => panel?.focus({ preventScroll: true }), 350);
  };
  const toast = value => {
    const node = byId("adminToast");
    node.textContent = value;
    node.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { node.hidden = true; }, 4200);
  };

  const metricLabels = {
    registered_users: ["Registered users", "Open access controls", "usersPanel"],
    sign_ins_today: ["Sign-ins today", "Open access audit", "eventsPanel"],
    voice_sessions_today: ["Voice sessions today", "Open voice events", "eventsPanel"],
    chat_messages_today: ["Chat messages today", "Open chat events", "eventsPanel"],
    active_users_24h: ["Active users · 24h", "Open activity audit", "eventsPanel"],
    recent_errors: ["Recent errors", "Inspect each problem", "errorsPanel"],
  };

  function renderMetrics(metrics) {
    const host = byId("metrics");
    host.replaceChildren();
    Object.entries(metrics || {}).forEach(([key, value]) => {
      const labels = metricLabels[key] || [key, "Open details", "eventsPanel"];
      const button = element("button", "metric-card");
      button.type = "button";
      button.dataset.metric = key;
      button.append(element("span", "metric-value", value), element("span", "metric-label", labels[0]), element("span", "metric-hint", labels[1] + " →"));
      button.addEventListener("click", () => {
        if (key === "recent_errors") state.errorLimit = Number.MAX_SAFE_INTEGER;
        if (key === "voice_sessions_today") byId("eventFilter").value = "voice";
        if (key === "chat_messages_today") byId("eventFilter").value = "chat";
        if (key === "sign_ins_today") byId("eventFilter").value = "access";
        renderEvents();
        renderErrors();
        focusPanel(labels[2]);
      });
      host.appendChild(button);
    });
  }

  function showError(error) {
    const details = byId("errorDetails");
    details.replaceChildren();
    [
      ["Time", date(error.created_at)], ["User", error.user_email], ["Surface", error.route],
      ["Event", error.event_type], ["Code", error.error_code], ["Device", error.device_type],
      ["Session", error.session_id], ["Recorded problem", error.error_message],
      ["What it means", error.explanation],
    ].forEach(([label, value]) => {
      details.append(element("dt", "", label), element("dd", "", value));
    });
    byId("errorAdvice").textContent = "Recommended next check: " + text(error.recommended_action);
    byId("errorDialog").showModal();
  }

  function renderErrors() {
    const host = byId("errorList");
    host.replaceChildren();
    const errors = state.data?.errors || [];
    if (!errors.length) {
      host.appendChild(element("div", "empty", "No recent operational errors were recorded."));
      return;
    }
    errors.slice(0, state.errorLimit).forEach(error => {
      const button = element("button", "error-card");
      button.type = "button";
      const top = element("span", "error-top");
      top.append(element("span", "error-code", error.error_code || error.event_type || "Operational error"), element("span", "muted", date(error.created_at)));
      button.append(top, element("span", "error-summary", error.explanation), element("span", "error-meta", [error.user_email, error.device_type, error.route].filter(Boolean).join(" · ")));
      button.addEventListener("click", () => showError(error));
      host.appendChild(button);
    });
  }

  function requestUserAction(user, action) {
    const labels = {
      sign_out: ["Sign out user", "End this user's existing LifeOS sessions. The user may sign in again."],
      block: ["Block user", "Prevent this account from signing in or using Sophia until an administrator unblocks it."],
      unblock: ["Unblock user", "Restore this account's ability to sign in. Existing revoked sessions remain unusable."],
    };
    const selected = labels[action];
    byId("actionDialogTitle").textContent = selected[0];
    byId("actionCopy").textContent = `${selected[1]} Account: ${text(user.email)}.`;
    byId("actionUserId").value = user.user_id;
    byId("actionName").value = action;
    byId("confirmAction").className = action === "block" ? "danger" : "primary";
    byId("confirmAction").textContent = selected[0];
    byId("actionDialog").showModal();
  }

  function renderUsers() {
    const body = byId("users");
    body.replaceChildren();
    const query = byId("userFilter").value.trim().toLowerCase();
    (state.data?.users || []).filter(user => !query || `${user.email || ""} ${user.display_name || ""}`.toLowerCase().includes(query)).forEach(user => {
      const row = document.createElement("tr");
      [
        user.email,
        user.display_name,
        user.date_of_birth,
        user.country,
        user.phone,
        date(user.created_at),
        date(user.last_sign_in_at),
      ].forEach(value => row.appendChild(element("td", "", value)));
      const statusCell = document.createElement("td");
      statusCell.appendChild(element("span", "account-status " + (user.account_status === "blocked" ? "blocked" : ""), user.account_status || "active"));
      row.appendChild(statusCell);
      const actionCell = document.createElement("td");
      const controls = element("div", "user-actions");
      if (user.can_manage) {
        if (user.account_status === "blocked") {
          const unblock = element("button", "success", "Unblock"); unblock.type = "button"; unblock.addEventListener("click", () => requestUserAction(user, "unblock")); controls.appendChild(unblock);
        } else {
          const signOut = element("button", "", "Sign out"); signOut.type = "button"; signOut.addEventListener("click", () => requestUserAction(user, "sign_out"));
          const block = element("button", "danger", "Block"); block.type = "button"; block.addEventListener("click", () => requestUserAction(user, "block")); controls.append(signOut, block);
        }
      } else controls.appendChild(element("span", "muted", "Protected administrator"));
      actionCell.appendChild(controls); row.appendChild(actionCell); body.appendChild(row);
    });
  }

  function filteredEvents() {
    const filter = byId("eventFilter").value;
    return (state.data?.events || []).filter(event => {
      const kind = String(event.event_type || "");
      if (filter === "errors") return kind.endsWith("error") || event.error_code || event.error_message;
      if (filter === "admin") return kind.startsWith("admin_");
      if (filter === "access") return ["sign_in", "sign_out"].includes(kind);
      if (filter === "voice") return kind.startsWith("voice_") || ["microphone_error", "audio_error"].includes(kind);
      if (filter === "chat") return kind === "chat_message";
      return true;
    });
  }

  function renderEvents() {
    const body = byId("events");
    body.replaceChildren();
    filteredEvents().forEach(event => {
      const row = document.createElement("tr");
      const detail = event.error_message || event.error_code || (event.metadata?.action ? `${event.metadata.action}: ${event.metadata.target_email || event.metadata.target_user_id || "user"}` : event.metadata?.status || "Completed");
      [date(event.created_at), event.user_email, event.event_type, event.device_type, detail].forEach(value => row.appendChild(element("td", "", value)));
      body.appendChild(row);
    });
  }

  async function loadDashboard() {
    if (!window.LifeOSAuth?.configured) { if (setup) setup.hidden = false; return; }
    if (!window.LifeOSAuth?.session || state.busy) return;
    state.busy = true; systemStatus.textContent = "VERIFYING ADMIN"; systemStatus.className = "status"; message.textContent = "Loading protected account and operations data…"; dashboard.hidden = true;
    try {
      const response = await window.LifeOSAuth.authFetch("/api/admin-dashboard", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Dashboard unavailable");
      state.data = data; systemStatus.textContent = "ADMIN VERIFIED"; systemStatus.className = "status ok"; message.textContent = ""; dashboard.hidden = false;
      renderMetrics(data.metrics); renderErrors(); renderUsers(); renderEvents();
    } catch (error) {
      systemStatus.textContent = "ACCESS DENIED"; systemStatus.className = "status warn"; message.textContent = error.message;
    } finally { state.busy = false; }
  }

  byId("actionForm").addEventListener("submit", async event => {
    if (event.submitter?.value !== "confirm") return;
    event.preventDefault();
    const action = byId("actionName").value; const userId = byId("actionUserId").value;
    byId("confirmAction").disabled = true;
    try {
      const response = await window.LifeOSAuth.authFetch("/api/admin-user-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, user_id: userId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Administration action failed");
      byId("actionDialog").close(); toast(action === "block" ? "User blocked." : action === "unblock" ? "User unblocked." : "User sessions signed out."); await loadDashboard();
    } catch (error) { byId("actionCopy").textContent = error.message; }
    finally { byId("confirmAction").disabled = false; }
  });
  document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => byId(button.dataset.closeDialog)?.close()));
  byId("showAllErrors").addEventListener("click", () => { state.errorLimit = Number.MAX_SAFE_INTEGER; renderErrors(); });
  byId("userFilter").addEventListener("input", renderUsers);
  byId("eventFilter").addEventListener("change", renderEvents);
  byId("refreshAdmin").addEventListener("click", () => { void loadDashboard(); });

  await window.LifeOSAuth?.whenReady?.();
  if (!window.LifeOSAuth?.configured) { if (setup) setup.hidden = false; return; }
  await loadDashboard();
  window.addEventListener("lifeos-auth-change", event => { if (event.detail?.signedIn) void loadDashboard(); });
});
