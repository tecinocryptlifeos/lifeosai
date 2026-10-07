import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAlpacaBars, normalizeProviderSymbol, normalizeTwelveDataSeries } from "../src/market-data.js";

function seriesPayload(count=31) {
  return { status:"ok", values:Array.from({length:count},(_,i)=>({
    datetime:`2026-01-${String(i+1).padStart(2,"0")} 00:00:00`,
    open:"10", high:"12", low:"9", close:"11", volume:"1"
  })) };
}

test("normalizes valid Twelve Data OHLC series and rejects malformed bars",()=>{
  const payload=seriesPayload();
  payload.values[4].high="8";
  const result=normalizeTwelveDataSeries(payload,"AAPL","stock","1d");
  assert.equal(result.source,"Twelve Data");
  assert.equal(result.market_type,"stock");
  assert.equal(result.bars.length,30);
  assert.equal(result.bars.every(b=>b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)),true);
});

test("normalizes intraday Twelve Data resolution",()=>{
  const result=normalizeTwelveDataSeries({
    status:"ok",
    values:Array.from({length:30},(_,i)=>({datetime:`2026-01-01 00:${String(i).padStart(2,"0")}:00`,open:"10",high:"12",low:"9",close:"11",volume:"1"}))
  },"AAPL","stock","5m");
  assert.equal(result.resolution,"5");
  assert.equal(result.bars.length,30);
});

test("normalizes provider symbols for crypto and preserves requested symbol shape",()=>{
  assert.equal(normalizeProviderSymbol("BINANCE:BTCUSDT","crypto"),"BTC/USD");
  assert.equal(normalizeProviderSymbol("ETH/USDT","crypto"),"ETH/USDT");
  assert.equal(normalizeProviderSymbol("AAPL","stock"),"AAPL");
});

test("accepts UTC offsets and rejects invalid timestamps",()=>{
  const payload=seriesPayload();
  payload.values[0].datetime="2026-01-01 00:00:00+00:00";
  const result=normalizeTwelveDataSeries(payload,"AAPL","stock","1d");
  assert.equal(result.bars.length,31);
  payload.values[1].datetime="not-a-date";
  assert.throws(()=>normalizeTwelveDataSeries(payload,"AAPL","stock","1d"),/invalid Twelve Data timestamp/i);
});

test("rejects error responses",()=>{
  assert.throws(()=>normalizeTwelveDataSeries({status:"error",message:"symbol not found"},"BAD","stock","1d"),/symbol not found/i);
});

test("normalizes Alpaca stock and crypto OHLC bars without changing timestamps",()=>{
  const stock=normalizeAlpacaBars({bars:[{t:"2026-10-07T14:15:00Z",o:100,h:105,l:99,c:103,v:25}]},"AAPL","stock","5m");
  assert.equal(stock.source,"Alpaca"); assert.equal(stock.bars[0].close,103); assert.equal(stock.bars[0].timestamp,"2026-10-07T14:15:00.000Z");
  const crypto=normalizeAlpacaBars({bars:{"BTC/USD":[{t:"2026-10-07T14:15:00Z",o:83000,h:83100,l:82900,c:83050,v:1.2}]}}, "BTC/USD","crypto","5m");
  assert.equal(crypto.bars.length,1); assert.equal(crypto.resolution,"5");
});
