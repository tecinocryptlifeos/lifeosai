const ALLOWED_RANGES = new Set(["1mo","3mo","6mo","1y"]);
const ALLOWED_INTERVALS = new Set(["1d","1h"]);

function validateSymbol(value) {
  const symbol = String(value || "AAPL").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error("Invalid symbol");
  return symbol;
}

export function normalizeYahooChart(payload, symbol) {
  const result = payload?.chart?.result?.[0];
  if (!result?.timestamp?.length || !Array.isArray(result.indicators?.quote?.[0]?.open)) {
    throw new Error("Market provider returned no OHLC data");
  }
  const quote = result.indicators.quote[0];
  const bars = result.timestamp.map((ts, i) => ({
    timestamp: new Date(Number(ts) * 1000).toISOString(),
    open: Number(quote.open?.[i]),
    high: Number(quote.high?.[i]),
    low: Number(quote.low?.[i]),
    close: Number(quote.close?.[i]),
    volume: Number(quote.volume?.[i] || 0),
  })).filter(b => [b.open,b.high,b.low,b.close].every(Number.isFinite) && b.high >= Math.max(b.open,b.close) && b.low <= Math.min(b.open,b.close));

  if (bars.length < 30) throw new Error("Insufficient OHLC history");
  return {
    ok: true,
    source: "Yahoo Finance chart API",
    symbol,
    exchange: result.meta?.exchangeName || null,
    currency: result.meta?.currency || null,
    interval: result.meta?.dataGranularity || null,
    fetched_at: new Date().toISOString(),
    bars,
  };
}

export async function marketData(request, env) {
  const url = new URL(request.url);
  const symbol = validateSymbol(url.searchParams.get("symbol"));
  const range = url.searchParams.get("range") || "6mo";
  const interval = url.searchParams.get("interval") || "1d";
  if (!ALLOWED_RANGES.has(range) || !ALLOWED_INTERVALS.has(interval)) {
    throw new Error("Unsupported range or interval");
  }
  const upstream = new URL("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol));
  upstream.searchParams.set("range", range);
  upstream.searchParams.set("interval", interval);
  upstream.searchParams.set("events", "div,splits");
  const response = await fetch(upstream.toString(), {headers: {"Accept":"application/json","User-Agent":"LifeOS-Research-Console/1.0"}});
  if (!response.ok) throw new Error("Market provider HTTP " + response.status);
  return normalizeYahooChart(await response.json(), symbol);
}
