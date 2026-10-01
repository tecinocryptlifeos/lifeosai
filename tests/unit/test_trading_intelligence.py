import unittest
from datetime import datetime, timedelta, timezone

from trading_intelligence.causal import atr, sma
from trading_intelligence.lona_adapter import build_lona_request
from trading_intelligence.market_structure import confirmed_pivots, structure_state
from trading_intelligence.model import Bar, ExperimentSpec, RiskPolicy, StrategyDefinition
from trading_intelligence.risk import portfolio_gate, position_size
from trading_intelligence.strategy import validate_strategy_definition
from trading_intelligence.validation import check_timestamp_order, validate_experiment_periods, walk_forward_windows


def bars(values):
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return tuple(Bar(start + timedelta(minutes=i), x, x + 1, x - 1, x + 0.5) for i, x in enumerate(values))


class TradingIntelligenceTests(unittest.TestCase):
    def test_causal_pivot_is_not_usable_before_confirmation(self):
        data = bars([1, 2, 4, 2, 1, 2, 3])
        pivots = confirmed_pivots(data, left=1, right=1)
        high = next(p for p in pivots if p.kind == "high")
        states = structure_state(data, pivots)
        self.assertEqual(high.confirmation_index, high.index + 1)
        self.assertIsNone(states[high.index].last_confirmed_high)
        self.assertEqual(states[high.confirmation_index].last_confirmed_high, high)

    def test_indicators_have_warmup_and_no_future_values(self):
        data = bars([1, 2, 3, 4])
        values = sma([b.close for b in data], 3)
        self.assertEqual(values[:2], (None, None))
        self.assertAlmostEqual(values[2], (1.5 + 2.5 + 3.5) / 3)
        self.assertEqual(len(atr(data, 2)), len(data))

    def test_strategy_requires_declared_causal_inputs(self):
        strategy = StrategyDefinition("structure-v1", 1, "Structure", ("forex",), ("confirmed pivot break",), ("structure invalidation",), ("confirmed_pivot",), {})
        validate_strategy_definition(strategy)
        with self.assertRaises(ValueError):
            validate_strategy_definition(StrategyDefinition("bad", 1, "Bad", ("forex",), ("entry",), ("exit",), ("repainting future pivot",), {}))

    def test_risk_size_is_bounded(self):
        decision = position_size(10000, 100, 98, RiskPolicy(max_risk_fraction=0.01))
        self.assertTrue(decision.allowed)
        self.assertLessEqual(decision.risk_amount, 100.0 + 1e-9)
        allowed, _ = portfolio_gate(10000, 12000, 0.05, 1000, RiskPolicy(max_portfolio_exposure_fraction=1.0))
        self.assertFalse(allowed)

    def test_validation_and_walk_forward(self):
        d = datetime(2026, 1, 1, tzinfo=timezone.utc)
        result = validate_experiment_periods(d + timedelta(days=10), d + timedelta(days=20), d + timedelta(days=30))
        self.assertTrue(result.passed)
        self.assertTrue(check_timestamp_order([d, d + timedelta(days=1)]).passed)
        self.assertEqual(walk_forward_windows(d, d + timedelta(days=100), 50, 10, 10, 80)[0], (0, 50, 50, 60))

    def test_lona_adapter_preserves_strategy_identity_and_parameters(self):
        strategy = StrategyDefinition("structure-v1", 1, "Structure", ("forex",), ("entry",), ("exit",), ("confirmed_pivot",), {"left": 2})
        d = datetime(2026, 1, 1, tzinfo=timezone.utc)
        spec = ExperimentSpec("exp-1", "structure-v1", "EURUSD", "forex", "1h", d, d + timedelta(days=30), d + timedelta(days=10), d + timedelta(days=20), parameters={"left": 3})
        request = build_lona_request(spec, strategy)
        self.assertEqual(request.strategy_id, "structure-v1")
        self.assertEqual(request.parameters["left"], 3)


if __name__ == "__main__":
    unittest.main()
