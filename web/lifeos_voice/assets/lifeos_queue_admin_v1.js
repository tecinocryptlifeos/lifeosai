document.addEventListener("DOMContentLoaded", async () => {
  "use strict";

  const byId = id => document.getElementById(id);
  const state = { busy: false, requestId: "" };
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
  const queueMessage = (value, kind = "") => {
    const node = byId("queueMessage");
    node.textContent = value;
    node.className = "queue-message" + (kind ? " " + kind : "");
  };
  const newRequestId = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  };

  function updatePreview() {
    const name = byId("queueRecipientName").value.trim();
    const email = byId("queueRecipientEmail").value.trim();
    const subject = byId("queueSubject").value.trim();
    const body = byId("queueBody").value.trim();
    const invitationUrl = byId("queueInvitationUrl").value.trim();
    byId("queuePreviewTo").textContent = email ? (name ? `${name} <${email}>` : email) : "Enter a recipient email";
    byId("queuePreviewSubject").textContent = subject || "Enter a subject";
    byId("queuePreviewBody").textContent = body + (invitationUrl && !body.includes(invitationUrl) ? `\n\n${invitationUrl}` : "");
    byId("queueInvitation").disabled = !(byId("queueApproved").checked && byId("invitationForm").checkValidity()) || state.busy;
  }

  function renderStatus(queue) {
    const host = byId("queueStatusCards");
    host.replaceChildren();
    const cards = [
      ["Authorized sender", queue.gmail_profile_verified || queue.expected_gmail, queue.gmail_profile_verified === queue.expected_gmail],
      ["Worker", queue.background_worker_alive ? "Running" : "Stopped", Boolean(queue.background_worker_alive)],
      ["Delivery gate", queue.database_queue_enabled ? "Enabled" : "Paused", Boolean(queue.database_queue_enabled)],
      ["Daily policy", `${text(queue.daily_send_limit)} maximum · ${text(queue.send_interval_minutes)} min spacing`, true],
    ];
    cards.forEach(([label, value, ok]) => {
      const card = element("div", "queue-status-card " + (ok ? "ok" : "warn"));
      card.append(element("strong", "", value), element("span", "", label));
      host.appendChild(card);
    });
  }

  function renderMessages(messages) {
    const body = byId("queueMessages");
    body.replaceChildren();
    if (!messages?.length) {
      const row = document.createElement("tr");
      const cell = element("td", "empty", "No LifeOS Queue messages have been recorded.");
      cell.colSpan = 6; row.appendChild(cell); body.appendChild(row); return;
    }
    messages.forEach(item => {
      const row = document.createElement("tr");
      row.appendChild(element("td", "", date(item.sent_at || item.created_at)));
      const direction = document.createElement("td");
      direction.appendChild(element("span", `queue-direction ${item.direction || ""}`, item.direction));
      row.appendChild(direction);
      row.appendChild(element("td", "", item.direction === "inbound" ? item.sender_email : item.recipient_email));
      row.appendChild(element("td", "", item.subject));
      row.appendChild(element("td", "queue-body-cell", item.body_preview));
      const status = document.createElement("td");
      status.appendChild(element("span", `queue-state ${item.status || ""}`, item.status));
      row.appendChild(status); body.appendChild(row);
    });
  }

  async function loadQueue() {
    if (!window.LifeOSAuth?.configured || !window.LifeOSAuth?.session || state.busy) return;
    state.busy = true; updatePreview(); queueMessage("Checking the verified sender, delivery gate, invitations, and replies…");
    try {
      const response = await window.LifeOSAuth.authFetch("/api/admin-lifeos-queue", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "LifeOS Queue is unavailable");
      renderStatus(data.queue || {}); renderMessages(data.messages || []);
      queueMessage(data.queue?.database_queue_enabled ? "Delivery is enabled. Approved queued invitations will follow the 30-minute spacing rule." : "Delivery gate is paused. You can safely queue and inspect an invitation without sending it.", data.ok ? "ok" : "warn");
    } catch (error) {
      queueMessage(error.message, "error");
    } finally { state.busy = false; updatePreview(); }
  }

  async function postQueue(payload) {
    const response = await window.LifeOSAuth.authFetch("/api/admin-lifeos-queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || "LifeOS Queue action failed");
    return data;
  }

  byId("invitationForm").addEventListener("input", updatePreview);
  byId("invitationForm").addEventListener("change", updatePreview);
  byId("invitationForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (state.busy || !byId("queueApproved").checked || !event.currentTarget.reportValidity()) return;
    state.busy = true; updatePreview(); queueMessage("Queueing the exact approved invitation…");
    state.requestId ||= newRequestId();
    let refreshAfter = false;
    try {
      const data = await postQueue({
        action: "enqueue_invitation",
        request_id: state.requestId,
        approved: true,
        recipient_name: byId("queueRecipientName").value.trim(),
        recipient_email: byId("queueRecipientEmail").value.trim(),
        subject: byId("queueSubject").value.trim(),
        body_text: byId("queueBody").value.trim(),
        invitation_url: byId("queueInvitationUrl").value.trim(),
      });
      state.requestId = ""; byId("queueApproved").checked = false;
      queueMessage(data.delivery_gate_enabled ? "Invitation queued. The worker will deliver it under the active spacing and daily limits." : "Invitation queued and verified. Delivery remains paused until the database gate is deliberately opened.", "ok");
      refreshAfter = true;
    } catch (error) { queueMessage(error.message, "error"); }
    finally { state.busy = false; updatePreview(); }
    if (refreshAfter) await loadQueue();
  });

  byId("refreshQueue").addEventListener("click", () => { void loadQueue(); });
  byId("syncQueueReplies").addEventListener("click", async () => {
    if (state.busy) return;
    state.busy = true; updatePreview(); queueMessage("Checking Gmail threads for replies…");
    let refreshAfter = false;
    try {
      const data = await postQueue({ action: "reply_sync" });
      queueMessage(`Reply sync completed: ${Number(data.replies_recorded || 0)} new repl${Number(data.replies_recorded || 0) === 1 ? "y" : "ies"}.`, "ok");
      refreshAfter = true;
    } catch (error) { queueMessage(error.message, "error"); }
    finally { state.busy = false; updatePreview(); }
    if (refreshAfter) await loadQueue();
  });

  updatePreview();
  await window.LifeOSAuth?.whenReady?.();
  if (window.LifeOSAuth?.session) await loadQueue();
  window.addEventListener("lifeos-auth-change", event => {
    if (event.detail?.signedIn) void loadQueue();
  });
});
