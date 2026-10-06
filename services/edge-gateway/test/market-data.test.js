import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFinnhubCandle } from "../src/market-data.js";

function candlePayload(count=31) {
  return { s:"ok", t:Array.from({length:count},(_,i)=>1700000000+i*86400), o:Array(count).fill(10), h:Array(count).fill(12), l:Array(count).fill(9), c:Array(count).fill(11), v:Array(count).fill(1) };
}

test("normalizes valid Finnhub OHLC candles and rejects malformed bars",()=>{
  const payload=candlePayload();
  payload.h[4]=8;
  const result=normalizeFinnhubCandle(payload,"AAPL","stock","1d");
  assert.equal(result.source,"Finnhub");
  assert.equal(result.market_type,"stock");
  assert.equal(result.bars.length,30);
  assert.equal(result.bars.every(b=>b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)),true);
});

test("normalizes intraday Finnhub resolution",()=>{
  const result=normalizeFinnhubCandle({s:"ok",t:Array.from({length:30},(_,i)=>1700000000+i*300),o:Array(30).fill(10),h:Array(30).fill(12),l:Array(30).fill(9),c:Array(30).fill(11),v:Array(30).fill(1)},"BINANCE:BTCUSDT","crypto","5m");
  assert.equal(result.resolution,"5");
  assert.equal(result.bars.length,30);
});

test("rejects no-data responses",()=>{
  assert.throws(()=>normalizeFinnhubCandle({s:"no_data"},"BAD","stock","1d"),/no market data/i);
});
