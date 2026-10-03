const INTERVALS = {
  "1m":  { range: "7d", upstream: "1m", minutes: 1 },
  "2m":  { range: "60d", upstream: "2m", minutes: 2 },
  "5m":  { range: "60d", upstream: "5m", minutes: 5 },
  "10m": { range: "60d", upstream: "5m", minutes: 10 },
  "15m": { range: "60d", upstream: "15m", minutes: 15 },
  "20m": { range: "60d", upstream: "5m", minutes: 20 },
  "30m": { range: "60d", upstream: "30m", minutes: 30 },
  "1h":  { range: "730d", upstream: "60m", minutes: 60 },
  "1d":  { range: "2y", upstream: "1d", minutes: 1440 },
  "1wk": { range: "10y", upstream: "1wk", minutes: 10080 },
  "1mo": { range: "20y", upstream: "1mo", minutes: 43200 }
};
function validateSymbol(value) {
  const symbol = String(value || "AAPL").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error("Invalid symbol");
  return symbol;
}
function floorBucket(ms, minutes) {
  return Math.floor(ms / (minutes * 60 * 1000)) * (minutes * 60 * 1000);
}
export function resampleBars(bars, minutes) {
  if (minutes === 1) return bars;
  const out = [];
  let current = null;
  for (const bar of bars) {
    const bucket = floorBucket(Date.parse(bar.timestamp), minutes);
    if (!current || current.bucket !== bucket) {
      current = {bucket, timestamp:new Date(bucket).toISOString(), open:bar.open, high:bar.high, low:bar.low, close:bar.close, volume:bar.volume};
      out.push(current);
    } else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
    }
  }
  return out.map(({bucket,...bar})=>bar);
}
export function normalizeYahooChart(payload, symbol, requestedInterval = "1d") {
  const result = payload?.chart?.result?.[0];
  if (!result?.timestamp?.length || !Array.isArray(result.indicators?.quote?.[0]?.open)) throw new Error("Market provider returned no OHLC data");
  const quote = result.indicators.quote[0];
  const bars = result.timestamp.map((ts,i)=>({timestamp:new Date(Number(ts)*1000).toISOString(),open:Number(quote.open?.[i]),high:Number(quote.high?.[i]),low:Number(quote.low?.[i]),close:Number(quote.close?.[i]),volume:Number(quote.volume?.[i]||0)}))
    .filter(b=>[b.open,b.high,b.low,b.close].every(Number.isFinite)&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close));
  const target = INTERVALS[requestedInterval];
  if (!target) throw new Error("Unsupported interval");
  const normalized = resampleBars(bars,target.minutes);
  const minimum = requestedInterval === "1d" ? 30 : requestedInterval === "1wk" ? 12 : requestedInterval === "1mo" ? 6 : 30;
  if (normalized.length < minimum) throw new Error("Insufficient OHLC history");
  return {ok:true,source:"Yahoo Finance chart API",symbol,exchange:result.meta?.exchangeName||null,currency:result.meta?.currency||null,interval:requestedInterval,upstream_interval:target.upstream,fetched_at:new Date().toISOString(),bars:normalized};
}
export async function marketData(request, env) {
  const url = new URL(request.url);
  const symbol = validateSymbol(url.searchParams.get("symbol"));
  const interval = url.searchParams.get("interval") || "1d";
  const target = INTERVALS[interval];
  if (!target) throw new Error("Unsupported interval");
  const range = url.searchParams.get("range") || target.range;
  const upstream = new URL("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol));
  upstream.searchParams.set("range",range);
  upstream.searchParams.set("interval",target.upstream);
  upstream.searchParams.set("events","div,splits");
  const response = await fetch(upstream.toString(),{headers:{Accept:"application/json","User-Agent":"LifeOS-Research-Console/1.0"}});
  if (!response.ok) throw new Error("Market provider HTTP " + response.status);
  return normalizeYahooChart(await response.json(),symbol,interval);
}
