import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSetup } from "../src/trading-setup.js";

function fixture(direction = "long") {
  const bars = [];
  for (let i = 0; i < 60; i++) {
    const base = direction === "long" ? 100 + i * 0.2 : 120 - i * 0.2;
    bars.push({
      timestamp: new Date(1700000000000 + i * 86400000).toISOString(),
      open: base,
      high: base + 2,
      low: base - 2,
      close: base + (direction === "long" ? 0.5 : -0.5),
      volume: 100
    });
  }
  return bars;
}

test("returns HOLD when OHLC history is insufficient", () => {
  assert.equal(evaluateSetup(fixture().slice(0, 49)).status, "HOLD");
});

test("calculates a long entry, stop and 2R take-profit from confirmed swing levels", () => {
  const bars = fixture("long");
  bars[58] = { ...bars[58], high: 114, low: 108, close: 113 };
  bars[59] = { ...bars[59], high: 116, low: 112, close: 115 };
  const result = evaluateSetup(bars);
  assert.equal(result.direction, "LONG");
  assert.ok(result.entry > result.stop);
  assert.equal(result.takeProfit, result.entry + (result.entry - result.stop) * 2);
  assert.equal(result.rewardRisk, 2);
});

test("calculates a short entry, stop and 2R take-profit from confirmed swing levels", () => {
  const bars = fixture("short");
  bars[58] = { ...bars[58], high: 112, low: 106, close: 107 };
  bars[59] = { ...bars[59], high: 108, low: 104, close: 105 };
  const result = evaluateSetup(bars);
  assert.equal(result.direction, "SHORT");
  assert.ok(result.entry < result.stop);
  assert.equal(result.takeProfit, result.entry - (result.stop - result.entry) * 2);
  assert.equal(result.rewardRisk, 2);
});
