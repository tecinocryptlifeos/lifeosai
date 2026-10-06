const INTERVALS = {
  "1m": { resolution: "1", minutes: 1, lookbackSeconds: 7 * 86400 },
  "5m": { resolution: "5", minutes: 5, lookbackSeconds: 60 * 86400 },
  "15m": { resolution: "15", minutes: 15, lookbackSeconds: 60 * 86400 },
  "30m": { resolution: "30", minutes: 30, lookbackSeconds: 60 * 86400 },
  "1h": { resolution: "60", minutes: 60, lookbackSeconds: 730 * 86400 },
  "1d": { resolution: "D", minutes: 1440, lookbackSeconds: 2 * 365 * 86400 },
  "1wk": { resolution: "W", minutes: 10080, lookbackSeconds: 10 * 365 * 86400 },
  "1mo": { resolution: "M", minutes: 43200, lookbackSeconds: 20 * 365 * 86400 }
};
const TYPES = new Set(["stock", "forex", "crypto"]);
function validateSymbol(value, type = "stock") {
  const symbol = String(value || "").trim().toUpperCase();
  if (!TYPES.has(type)) throw new Error("Unsupported market type");
  if (!symbol || symbol.length > 40 || !/^[A-Z0-9_.:/-]+$/.test(symbol)) throw new Error("Invalid symbol");
  return symbol;
}
function finiteBar(bar) {
  return [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) &&
    bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close);
}
export function normalizeFinnhubCandle(payload, symbol, type, requestedInterval = "1d") {
  const target = INTERVALS[requestedInterval];
  if (!target) throw new Error("Unsupported interval");
  if (!payload || payload.s !== "ok" || !Array.isArray(payload.t)) {
    throw new Error(payload?.s === "no_data" ? "Finnhub returned no market data for this instrument." : "Finnhub returned an invalid OHLC response");
  }
  const bars = payload.t.map((ts, i) => ({
    timestamp: new Date(Number(ts) * 1000).toISOString(),
    open: Number(payload.o?.[i]), high: Number(payload.h?.[i]), low: Number(payload.l?.[i]),
    close: Number(payload.c?.[i]), volume: Number(payload.v?.[i] || 0)
  })).filter(finiteBar);
  const minimum = requestedInterval === "1d" ? 30 : requestedInterval === "1wk" ? 12 : requestedInterval === "1mo" ? 6 : 30;
  if (bars.length < minimum) throw new Error("Insufficient OHLC history");
  return { ok:true, source:"Finnhub", symbol, market_type:type, interval:requestedInterval, resolution:target.resolution, fetched_at:new Date().toISOString(), bars };
}
async function finnhubFetch(path, env, params = {}) {
  if (!env.FINNHUB_API_KEY) throw new Error("Finnhub API key is not configured");
  const url = new URL("https://api.finnhub.io/api/v1" + path);
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
  url.searchParams.set("token", env.FINNHUB_API_KEY);
  const response = await fetch(url.toString(), {headers:{Accept:"application/json","X-Finnhub-Token":env.FINNHUB_API_KEY}});
  if (!response.ok) { const detail = await response.text().catch(() => ""); throw new Error("Finnhub HTTP " + response.status + (detail ? ": " + detail.slice(0, 180) : "")); }
  return response.json();
}
export async function marketSymbols(request, env) {
  const url = new URL(request.url), type = url.searchParams.get("type") || "stock";
  if (!TYPES.has(type)) throw new Error("Unsupported market type");
  const exchange = url.searchParams.get("exchange") || (type === "stock" ? "US" : type === "forex" ? "oanda" : "BINANCE");
  const path = type === "stock" ? "/stock/symbol" : type === "forex" ? "/forex/symbol" : "/crypto/symbol";
  const data = await finnhubFetch(path, env, {exchange});
  return {ok:true,source:"Finnhub",market_type:type,exchange,symbols:(Array.isArray(data)?data:[]).filter(x=>x.symbol).slice(0,5000).map(x=>({symbol:x.symbol,description:x.description||x.displaySymbol||x.symbol,displaySymbol:x.displaySymbol||x.symbol,type:x.type||type}))};
}
export async function marketData(request, env) {
  const url = new URL(request.url), type = url.searchParams.get("type") || "stock";
  const symbol = validateSymbol(url.searchParams.get("symbol") || "AAPL",type);
  const interval = url.searchParams.get("interval") || "1d", target = INTERVALS[interval];
  if (!target) throw new Error("Unsupported interval");
  const now = Math.floor(Date.now()/1000);
  const rangeSeconds = Math.min(Math.max(Number(url.searchParams.get("range_seconds") || target.lookbackSeconds),3600),20*365*86400);
  const endpoint = type === "stock" ? "stock" : type === "forex" ? "forex" : "crypto";
  const payload = await finnhubFetch("/"+endpoint+"/candle",env,{symbol,resolution:target.resolution,from:String(now-rangeSeconds),to:String(now)});
  return normalizeFinnhubCandle(payload,symbol,type,interval);
}
