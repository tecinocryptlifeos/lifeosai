const INTERVAL_MS = { "1m": 60_000, "5m": 300_000, "10m": 600_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "1d": 86_400_000, "1wk": 604_800_000 };

function validBars(input) {
  return Array.isArray(input) ? input.filter(b =>
    b && [b.open,b.high,b.low,b.close].every(v => Number.isFinite(Number(v))) &&
    Number(b.high) >= Math.max(Number(b.open),Number(b.close)) &&
    Number(b.low) <= Math.min(Number(b.open),Number(b.close)) &&
    Number(b.low) <= Number(b.high)
  ) : [];
}
function emaSeries(values, period) {
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  let seed = values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  out[period-1] = seed;
  const k = 2/(period+1);
  for (let i=period;i<values.length;i++) {
    seed = values[i]*k + seed*(1-k);
    out[i] = seed;
  }
  return out;
}
export function macdState(input) {
  const bars=validBars(input), closes=bars.map(b=>Number(b.close));
  if (closes.length < 35) return {available:false,direction:"unknown",reason:"At least 35 candles are required for MACD (12,26,9)."};
  const fast=emaSeries(closes,12), slow=emaSeries(closes,26);
  const line=closes.map((_,i)=>fast[i]===null||slow[i]===null?null:fast[i]-slow[i]);
  const validLine=line.filter(Number.isFinite);
  const signalValues=emaSeries(validLine,9);
  if (validLine.length < 10 || signalValues.at(-1)===null) return {available:false,direction:"unknown",reason:"MACD signal history is insufficient."};
  const macd=validLine.at(-1), signal=signalValues.at(-1);
  const previousMacd=validLine.at(-2), previousSignal=signalValues.at(-2);
  return {available:true,direction:macd>signal?"bullish":macd<signal?"bearish":"neutral",macd,signal,histogram:macd-signal,histogram_rising:(macd-signal)>(previousMacd-previousSignal),reason:macd>signal?"MACD is above its signal line.":macd<signal?"MACD is below its signal line.":"MACD and signal line are equal."};
}
export function trendState(input) {
  const bars=validBars(input), closes=bars.map(b=>Number(b.close));
  if (closes.length < 50) return {available:false,direction:"unknown",reason:"At least 50 candles are required for macro trend."};
  const fast=emaSeries(closes,20).at(-1), slow=emaSeries(closes,50).at(-1), last=closes.at(-1);
  const direction=fast>slow&&last>fast?"bullish":fast<slow&&last<fast?"bearish":"neutral";
  return {available:true,direction,ema20:fast,ema50:slow,last,reason:direction==="bullish"?"EMA20 > EMA50 and price is above EMA20.":direction==="bearish"?"EMA20 < EMA50 and price is below EMA20.":"Trend is mixed; no directional macro bias."};
}
function closedBars(input, interval, now) {
  const bars=validBars(input), ms=INTERVAL_MS[interval];
  if (!ms || bars.length<2) return bars;
  const ts=Date.parse(bars.at(-1).timestamp);
  if (Number.isFinite(ts) && now-ts>=0 && now-ts<ms) return bars.slice(0,-1);
  return bars;
}
export function candlePatterns(input, interval="15m", now=Date.now()) {
  const bars=closedBars(input,interval,now);
  if (bars.length<7) return {available:false,direction:"neutral",hammer:false,dolphin:false,reason:"Not enough closed candles to validate reversal patterns."};
  const b=bars.at(-1), prev=bars.at(-2);
  const body=Math.abs(b.close-b.open), range=b.high-b.low;
  const upper=b.high-Math.max(b.open,b.close), lower=Math.min(b.open,b.close)-b.low;
  const hammer=range>0 && body/range<=0.38 && lower>=Math.max(body*2,range*0.45) && upper<=Math.max(body*0.8,range*0.12) && b.close>=b.open;
  const shootingStar=range>0 && body/range<=0.38 && upper>=Math.max(body*2,range*0.45) && lower<=Math.max(body*0.8,range*0.12) && b.close<=b.open;
  const prior=bars.slice(-7,-2);
  const priorLow=Math.min(...prior.map(x=>x.low)), priorHigh=Math.max(...prior.map(x=>x.high));
  // "Dolphin-like" is explicitly a local sweep-and-reclaim heuristic, not a standardised industry pattern.
  const dolphinBull=prev.low<priorLow && b.close>prev.high;
  const dolphinBear=prev.high>priorHigh && b.close<prev.low;
  const direction=hammer||dolphinBull?"bullish":shootingStar||dolphinBear?"bearish":"neutral";
  const names=[];
  if(hammer) names.push("Hammer reversal");
  if(shootingStar) names.push("Shooting-star reversal");
  if(dolphinBull) names.push("Dolphin-like bullish sweep/reclaim");
  if(dolphinBear) names.push("Dolphin-like bearish sweep/reclaim");
  return {available:true,direction,hammer,shootingStar,dolphin:dolphinBull||dolphinBear,patterns:names,reason:names.join(", ")||"No qualifying closed-candle reversal pattern."};
}
function hold(reason, partial={}) {
  return {status:"HOLD",signal:null,quality_score:0,threshold:80,reason,accuracy_claim:false,macro:{},setups:{},execution:{},...partial,disclaimer:"The quality score is a rule-confluence score, not a measured probability or an 80% historical win-rate claim. No signal is guaranteed."};
}
export function analyzeMultiTimeframe(series, now=Date.now()) {
  const required=["1wk","1d","1h","15m","10m","30m","5m","1m"];
  const missing=required.filter(tf=>validBars(series?.[tf]).length<35);
  if(missing.length) return hold("Insufficient verified OHLC history for: "+missing.join(", ")+".", {missing_timeframes:missing});
  const macro={weekly:trendState(series["1wk"]),daily:trendState(series["1d"]),hourly:trendState(series["1h"])};
  const setups={m15:macdState(series["15m"]),m10:macdState(series["10m"]),m30:macdState(series["30m"]),patterns:candlePatterns(series["15m"],"15m",now)};
  const execution={m5:macdState(series["5m"]),m1:macdState(series["1m"])};
  const macroDirs=[macro.weekly.direction,macro.daily.direction,macro.hourly.direction];
  const macroAligned=macroDirs.every(d=>d==="bullish")||macroDirs.every(d=>d==="bearish");
  const direction=macroAligned?macroDirs[0]:"neutral";
  const setupAligned=[setups.m15.direction,setups.m10.direction,setups.m30.direction].every(d=>d===direction)&&direction!=="neutral";
  const patternAligned=setups.patterns.direction===direction&&direction!=="neutral";
  const triggerAligned=[execution.m5.direction,execution.m1.direction].every(d=>d===direction)&&direction!=="neutral";
  const last1=validBars(series["1m"]).at(-1), prev1=validBars(series["1m"]).at(-2);
  const closeConfirms=direction==="bullish"?last1.close>=prev1.close:direction==="bearish"?last1.close<=prev1.close:false;
  const score=(macroAligned?30:0)+(setupAligned?30:0)+(patternAligned?20:0)+(triggerAligned&&closeConfirms?20:0);
  const secondsTo5mClose=Math.ceil((300_000-(now%300_000))/1000);
  const secondsTo1mClose=Math.ceil((60_000-(now%60_000))/1000);
  const closingWindow=secondsTo5mClose<=10&&secondsTo1mClose<=10;
  const lows=validBars(series["1m"]).slice(-10).map(b=>b.low), highs=validBars(series["1m"]).slice(-10).map(b=>b.high);
  const entry=Number(last1.close);
  const rawStop=direction==="bullish"?Math.min(...lows):Math.max(...highs);
  const stop=Number.isFinite(rawStop)?rawStop:null;
  const validGeometry=direction==="bullish"?stop!==null&&stop<entry:direction==="bearish"?stop!==null&&stop>entry:false;
  const risk=validGeometry?Math.abs(entry-stop):null;
  const target=validGeometry?(direction==="bullish"?entry+2*risk:entry-2*risk):null;
  const qualified=score>=80&&macroAligned&&setupAligned&&patternAligned&&triggerAligned&&closeConfirms&&closingWindow&&validGeometry;
  const signal=qualified?(direction==="bullish"?"BUY":"SELL"):null;
  let reason="Waiting for weekly/daily/hourly trend, 15m/10m/30m setup, and 5m/1m trigger to align.";
  if(score>=80&&!closingWindow) reason="Confluence score meets the rule threshold; waiting for the final 10 seconds of the aligned 5-minute and 1-minute candle close.";
  if(score>=80&&closingWindow&&!validGeometry) reason="The stop-loss geometry is invalid; signal suppressed.";
  if(qualified) reason="All three analysis layers align in the candle-closing window.";
  return {status:signal?"SIGNAL":"HOLD",signal,quality_score:score,threshold:80,reason,accuracy_claim:false,macro,setups,execution:{...execution,closing_window:closingWindow,seconds_to_5m_close:secondsTo5mClose,seconds_to_1m_close:secondsTo1mClose,entry:validGeometry?entry:null,stop:validGeometry?stop:null,target,risk,confirmation:closingWindow?"CLOSING_WINDOW":"WAIT_FOR_CLOSE"},alignment:{macro:macroAligned,setup:setupAligned,pattern:patternAligned,trigger:triggerAligned,close:closeConfirms},disclaimer:"The quality score is a rule-confluence score, not a measured probability or an 80% historical win-rate claim. No signal is guaranteed."};
}
