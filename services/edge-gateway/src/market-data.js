const INTERVALS = {
  "1m": { interval: "1min", resolution: "1", lookbackSeconds: 7 * 86400 },
  "5m": { interval: "5min", resolution: "5", lookbackSeconds: 60 * 86400 },
  "15m": { interval: "15min", resolution: "15", lookbackSeconds: 60 * 86400 },
  "30m": { interval: "30min", resolution: "30", lookbackSeconds: 60 * 86400 },
  "1h": { interval: "1h", resolution: "60", lookbackSeconds: 730 * 86400 },
  "1d": { interval: "1day", resolution: "D", lookbackSeconds: 2 * 365 * 86400 },
  "1wk": { interval: "1week", resolution: "W", lookbackSeconds: 10 * 365 * 86400 },
  "1mo": { interval: "1month", resolution: "M", lookbackSeconds: 20 * 365 * 86400 }
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
function normalizeTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Invalid Twelve Data timestamp");
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + "Z";
  const date = new Date(zoned);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid Twelve Data timestamp");
  return date.toISOString();
}
function minimumBars(requestedInterval) {
  return requestedInterval === "1d" ? 30 : requestedInterval === "1wk" ? 12 : requestedInterval === "1mo" ? 6 : 30;
}
export function normalizeProviderSymbol(symbol, type) {
  if (type !== "crypto") return symbol;
  if (symbol.includes(":")) symbol = symbol.split(":").pop();
  if (symbol.includes("/")) return symbol;
  if (symbol.endsWith("USDT")) return symbol.slice(0,-4) + "/USD";
  if (symbol.endsWith("USDC")) return symbol.slice(0,-4) + "/USD";
  return symbol;
}
export function normalizeTwelveDataSeries(payload, symbol, type, requestedInterval = "1d") {
  const target = INTERVALS[requestedInterval];
  if (!target) throw new Error("Unsupported interval");
  if (!payload || payload.status !== "ok" || !Array.isArray(payload.values)) {
    throw new Error(payload?.message || "Twelve Data returned an invalid OHLC response");
  }
  const bars = payload.values.map((row) => ({
    timestamp: normalizeTimestamp(row.datetime),
    open: Number(row.open), high: Number(row.high), low: Number(row.low),
    close: Number(row.close), volume: Number(row.volume || 0)
  })).filter(finiteBar).sort((a,b) => a.timestamp.localeCompare(b.timestamp));
  if (bars.length < minimumBars(requestedInterval)) throw new Error("Insufficient OHLC history");
  return { ok:true, source:"Twelve Data", symbol, market_type:type, interval:requestedInterval, resolution:target.resolution, fetched_at:new Date().toISOString(), bars };
}
async function twelveDataFetch(path, env, params = {}) {
  if (!env.TWELVE_DATA_API_KEY) throw new Error("Twelve Data API key is not configured");
  const url = new URL("https://api.twelvedata.com" + path);
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
  url.searchParams.set("apikey", env.TWELVE_DATA_API_KEY);
  const response = await fetch(url.toString(), {headers:{Accept:"application/json"}});
  const text = await response.text().catch(() => "");
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok || data.status === "error") {
    throw new Error("Twelve Data HTTP " + response.status + (data.message ? ": " + data.message : text ? ": " + text.slice(0,180) : ""));
  }
  return data;
}
export async function marketSymbols(request, env) {
  const url = new URL(request.url), type = url.searchParams.get("type") || "stock";
  if (!TYPES.has(type)) throw new Error("Unsupported market type");
  const path = type === "stock" ? "/stocks" : type === "forex" ? "/forex_pairs" : "/cryptocurrencies";
  const data = await twelveDataFetch(path, env, {outputsize:"120"});
  return {ok:true,source:"Twelve Data",market_type:type,symbols:(Array.isArray(data.data)?data.data:[])
    .filter(x => x.symbol)
    .slice(0,120).map(x => ({symbol:x.symbol,description:x.name||x.instrument_name||x.symbol,displaySymbol:x.symbol,type:x.type||x.instrument_type||type}))};
}
export async function marketData(request, env) {
  const url = new URL(request.url), type = url.searchParams.get("type") || "stock";
  const requestedSymbol = validateSymbol(url.searchParams.get("symbol") || "AAPL",type);
  const symbol = normalizeProviderSymbol(requestedSymbol,type);
  const interval = url.searchParams.get("interval") || "1d", target = INTERVALS[interval];
  if (!target) throw new Error("Unsupported interval");
  const outputsize = Math.min(Math.max(Number(url.searchParams.get("outputsize") || 60), minimumBars(interval)), 5000);
  const payload = await twelveDataFetch("/time_series",env,{symbol,interval:target.interval,outputsize:String(outputsize),timezone:"UTC"});
  const result = normalizeTwelveDataSeries(payload,requestedSymbol,type,interval);
  result.provider_symbol = symbol;
  return result;
}
