import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTwelveDataSeries } from "../src/market-data.js";

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

test("rejects error responses",()=>{
  assert.throws(()=>normalizeTwelveDataSeries({status:"error",message:"symbol not found"},"BAD","stock","1d"),/symbol not found/i);
});
