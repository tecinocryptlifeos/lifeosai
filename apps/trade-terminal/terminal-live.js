/* Live market ticks and multi-timeframe overlay for the existing terminal. */
function closeMarketStream() {
  clearTimeout(S.wsTimer);
  clearInterval(S.wsHeartbeat);
  if (S.ws) { try { S.ws.close(); } catch {} }
  S.ws = null;
  S.wsKey = "";
}
function connectStream() {
  if (!S.live || document.hidden || !S.sym) return;
  const key = S.type + ":" + S.sym;
  if (S.ws && S.wsKey === key && (S.ws.readyState === WebSocket.OPEN || S.ws.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(S.wsTimer);
  if (S.ws) { try { S.ws.close(); } catch {} }
  S.ws = null;
  S.wsKey = key;
  const url = new URL(API + "/api/market-stream");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("type", S.type);
  url.searchParams.set("symbol", S.sym);
  let socket;
  try { socket = new WebSocket(url.toString()); } catch { qpull(); return; }
  S.ws = socket;
  socket.addEventListener("open", () => {
    if (S.ws !== socket) return;
    S.wsRetry = 0;
    clearTimeout(S.qt);
    // Keep the displayed source tied to the quote endpoint used by the candle feed.
    S.wsHeartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ action: "heartbeat" })); } catch {}
      }
    }, 10000);
    stat();
  });
  socket.addEventListener("message", event => {
    if (S.ws !== socket) return;
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === "tick") {
      // Ignore stream ticks here: this socket may use a different provider/feed
      // than the candles. qpull() updates the chart from the matching quote API.
    } else if (data.type === "status") {
      $("src").textContent = "STREAM ERROR";
      qpull();
    }
  });
  socket.addEventListener("close", () => {
    if (S.ws !== socket) return;
    clearInterval(S.wsHeartbeat);
    S.ws = null;
    if (S.live && !document.hidden) {
      qpull();
      const wait = Math.min(30000, 1000 * Math.pow(2, Math.min(S.wsRetry || 0, 5)));
      S.wsRetry = (S.wsRetry || 0) + 1;
      S.wsTimer = setTimeout(connectStream, wait);
    }
  });
  socket.addEventListener("error", () => { try { socket.close(); } catch {} });
}
async function loadIntelligence() {
  if (typeof S === "undefined" || !S.sym) return;
  const requestId = (S.intelReq || 0) + 1;
  S.intelReq = requestId;
  const symbol = S.sym, type = S.type;
  try {
    const url = API + "/api/trading-analysis?type=" + encodeURIComponent(type) + "&symbol=" + encodeURIComponent(symbol);
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (requestId !== S.intelReq || symbol !== S.sym || type !== S.type) return;
    if (!response.ok || !data.ok || !data.analysis) throw new Error(data.message || "analysis unavailable");
    const a = data.analysis, macro = a.macro || {}, setups = a.setups || {}, execution = a.execution || {};
    const trends = [["1W", macro.weekly], ["1D", macro.daily], ["1H", macro.hourly]]
      .map(item => item[0] + ": " + ((item[1] && item[1].direction) || "unknown")).join(" · ");
    const patterns = setups.patterns && setups.patterns.patterns && setups.patterns.patterns.length
      ? setups.patterns.patterns.join(", ") : "No confirmed reversal pattern";
    $("intel-signal").textContent = (a.signal ? a.signal : "HOLD") + " · " + (a.quality_score || 0) + "/100";
    $("intel-signal").className = "sig" + (a.signal === "BUY" ? " BUY" : a.signal === "SELL" ? " SELL" : "");
    $("intel-trend").textContent = trends;
    $("intel-patterns").textContent = patterns;
    $("intel-score").textContent = String(a.quality_score || 0) + "/100 (rule score)";
    $("intel-entry").textContent = execution.entry == null ? "—" : f(Number(execution.entry));
    $("intel-stop").textContent = execution.stop == null ? "—" : f(Number(execution.stop));
    $("intel-target").textContent = execution.target == null ? "—" : f(Number(execution.target));
    $("intel-note").textContent = (a.reason || "Waiting for aligned conditions.") + " " +
      (a.disclaimer || "Rule score is not a verified win probability.");
  } catch (error) {
    if (requestId === S.intelReq) $("intel-note").textContent = "Intelligence data unavailable: " + error.message;
  }
}
setInterval(loadIntelligence, 15000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && S.live) { connectStream(); loadIntelligence(); }
  else closeMarketStream();
});
const liveButton = $("lv");
if (liveButton) liveButton.addEventListener("click", () => setTimeout(() => {
  if (S.live) { connectStream(); loadIntelligence(); } else closeMarketStream();
}, 0));

// Start the overlay and stream on initial page load; reconnect logic handles symbol changes.
connectStream();
loadIntelligence();
setInterval(() => { if (S.live && !document.hidden) connectStream(); }, 5000);
