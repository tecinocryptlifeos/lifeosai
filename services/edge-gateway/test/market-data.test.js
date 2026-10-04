import assert from "node:assert/strict";
import test from "node:test";
import { normalizeYahooChart, resampleBars } from "../src/market-data.js";

test("normalizes valid OHLC candles and rejects malformed bars", () => {
  const payload = {chart:{result:[{
    meta:{exchangeName:"NMS",currency:"USD",dataGranularity:"1d"},
    timestamp:[1700000000,1700086400,1700172800],
    indicators:{quote:[{
      open:[10,11,12], high:[12,13,14], low:[9,10,11], close:[11,12,13], volume:[100,110,120]
    }]}
  }]}};
  const many={chart:{result:[{meta:{},timestamp:Array.from({length:30},(_,i)=>1700000000+i*86400),indicators:{quote:[{open:Array(30).fill(10),high:Array(30).fill(12),low:Array(30).fill(9),close:Array(30).fill(11),volume:Array(30).fill(1)}]}}]}};
  assert.equal(normalizeYahooChart(many,"AAPL").bars.length,30);
  assert.throws(()=>normalizeYahooChart(payload,"AAPL"),/Insufficient/);
});

test("resamples base candles into requested 10-minute timeframe", () => {
  const bars = Array.from({length:6}, (_, i) => ({
    timestamp: new Date(1700000000000 + i * 5 * 60 * 1000).toISOString(),
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 10
  }));
  const out = resampleBars(bars, 10);
  assert.equal(out.length, 3);
  assert.equal(out[0].open, 100);
  assert.equal(out[0].close, 101.5);
  assert.equal(out[0].high, 102);
  assert.equal(out[0].low, 99);
  assert.equal(out[0].volume, 20);
});

test("normalizes a requested multi-timeframe interval", () => {
  const many = {chart:{result:[{
    meta:{},
    timestamp:Array.from({length:60},(_,i)=>1700000000+i*300),
    indicators:{quote:[{
      open:Array.from({length:60},()=>10),
      high:Array.from({length:60},()=>12),
      low:Array.from({length:60},()=>9),
      close:Array.from({length:60},()=>11),
      volume:Array.from({length:60},()=>1)
    }]}
  }]}};
  const result = normalizeYahooChart(many,"AAPL","10m");
  assert.equal(result.interval,"10m");
  assert.equal(result.upstream_interval,"5m");
  assert.equal(result.bars.length,30);
});
