import assert from "node:assert/strict";
import test from "node:test";
import { normalizeYahooChart } from "../src/market-data.js";

test("normalizes valid OHLC candles and rejects malformed bars", () => {
  const payload = {chart:{result:[{
    meta:{exchangeName:"NMS",currency:"USD",dataGranularity:"1d"},
    timestamp:[1700000000,1700086400,1700172800],
    indicators:{quote:[{
      open:[10,11,12], high:[12,13,14], low:[9,10,11], close:[11,12,13], volume:[100,110,120]
    }]}
  }]}}
  const many={chart:{result:[{meta:{},timestamp:Array.from({length:30},(_,i)=>1700000000+i*86400),indicators:{quote:[{open:Array(30).fill(10),high:Array(30).fill(12),low:Array(30).fill(9),close:Array(30).fill(11),volume:Array(30).fill(1)}]}}]}}
  assert.equal(normalizeYahooChart(many,"AAPL").bars.length,30);
  assert.throws(()=>normalizeYahooChart(payload,"AAPL"),/Insufficient/);
});
