export function evaluateSetup(bars) {
  if (!Array.isArray(bars) || bars.length < 50) {
    return { status: "HOLD", reason: "At least 50 valid OHLC candles are required." };
  }

  const closes = bars.map(b => Number(b.close));
  const sma = (values, n) => values.slice(-n).reduce((a, b) => a + b, 0) / n;
  const m20 = sma(closes, 20);
  const m50 = sma(closes, 50);
  const last = bars.at(-1);

  const pivots = [];
  for (let i = 1; i < bars.length - 1; i++) {
    if (bars[i].high > bars[i - 1].high && bars[i].high >= bars[i + 1].high) {
      pivots.push({ type: "high", index: i, price: bars[i].high });
    }
    if (bars[i].low < bars[i - 1].low && bars[i].low <= bars[i + 1].low) {
      pivots.push({ type: "low", index: i, price: bars[i].low });
    }
  }

  const highs = pivots.filter(p => p.type === "high").slice(-4);
  const lows = pivots.filter(p => p.type === "low").slice(-4);
  const resistance = highs.at(-1)?.price;
  const support = lows.at(-1)?.price;
  if (!Number.isFinite(resistance) || !Number.isFinite(support) || resistance <= support) {
    return { status: "HOLD", reason: "Confirmed swing levels are not sufficiently defined.", sma20: m20, sma50: m50 };
  }

  const bullish = m20 > m50;
  const bearish = m20 < m50;
  const direction = bullish ? "LONG" : bearish ? "SHORT" : "HOLD";
  if (direction === "HOLD") {
    return { status: "HOLD", reason: "SMA20 and SMA50 do not establish directional bias.", sma20: m20, sma50: m50, support, resistance };
  }

  const entry = direction === "LONG" ? resistance : support;
  const stop = direction === "LONG" ? support : resistance;
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk <= 0) {
    return { status: "HOLD", reason: "The calculated setup has no positive price range.", sma20: m20, sma50: m50, support, resistance };
  }

  const takeProfit = direction === "LONG" ? entry + risk * 2 : entry - risk * 2;
  const triggerMet = direction === "LONG" ? last.close >= entry : last.close <= entry;

  return {
    status: triggerMet ? "TRIGGERED" : "WAIT",
    direction,
    entry,
    stop,
    takeProfit,
    risk,
    rewardRisk: 2,
    triggerMet,
    sma20: m20,
    sma50: m50,
    support,
    resistance,
    reason: triggerMet
      ? direction === "LONG" ? "Close is at or above the confirmed resistance entry level." : "Close is at or below the confirmed support entry level."
      : direction === "LONG" ? "Wait for price to reach the confirmed resistance entry level." : "Wait for price to reach the confirmed support entry level."
  };
}
