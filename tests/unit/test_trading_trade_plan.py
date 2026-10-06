import unittest

from trading_intelligence.model import RiskPolicy
from trading_intelligence.trade_plan import (
    PortfolioState,
    daily_loss_status,
    direction_from_side,
    plan_setup,
    risk_reward_points,
    score_setup,
    side_from_direction,
)

# Leveraged policy: 1% risk per trade, positions up to 30x equity, generous portfolio caps.
LEVERAGED = RiskPolicy(max_risk_fraction=0.01, max_position_fraction=30.0, max_portfolio_exposure_fraction=10.0)

EURUSD = dict(entry=1.1000, stop=1.0960, target=1.1120, equity=10_000.0, pip_size=0.0001, contract_size=100_000.0)


def plan(**overrides):
    args = {"direction": "buy", "policy": LEVERAGED, **EURUSD, **overrides}
    return plan_setup(**args)


class PlanSizingTests(unittest.TestCase):
    def test_buy_is_sized_to_the_risk_budget(self):
        p = plan()
        self.assertTrue(p.allowed)
        self.assertAlmostEqual(p.quantity, 25_000, places=4)
        self.assertAlmostEqual(p.lots, 0.25, places=6)
        self.assertAlmostEqual(p.risk_amount, 100.0, places=6)
        self.assertAlmostEqual(p.stop_distance_pips, 40.0, places=6)
        self.assertAlmostEqual(p.risk_reward, 3.0, places=6)
        self.assertAlmostEqual(p.potential_profit, 300.0, places=4)
        self.assertEqual(p.warnings, ())

    def test_sell_mirrors_buy(self):
        p = plan(direction="sell", stop=1.1040, target=1.0880)
        self.assertTrue(p.allowed)
        self.assertAlmostEqual(p.quantity, 25_000, places=4)
        self.assertAlmostEqual(p.risk_reward, 3.0, places=6)

    def test_quote_currency_conversion_keeps_risk_in_account_currency(self):
        p = plan(entry=150.0, stop=149.6, target=150.8, pip_size=0.01, quote_to_account=1 / 150)
        self.assertTrue(p.allowed)
        self.assertAlmostEqual(p.risk_amount, 100.0, places=4)
        self.assertAlmostEqual(p.quantity, 37_500, places=3)
        self.assertAlmostEqual(p.stop_distance_pips, 40.0, places=4)

    def test_quantity_step_rounds_down_never_up(self):
        p = plan(stop=1.0970, target=1.1090, quantity_step=1000.0)
        self.assertAlmostEqual(p.quantity, 33_000.0, places=6)
        self.assertLessEqual(p.risk_amount, 100.0)

    def test_budget_below_minimum_step_is_rejected(self):
        p = plan(quantity_step=100_000.0)
        self.assertFalse(p.allowed)
        self.assertIn("minimum position size", p.reason)

    def test_default_unleveraged_policy_caps_size_and_says_so(self):
        p = plan(policy=RiskPolicy())
        self.assertTrue(p.allowed)
        self.assertAlmostEqual(p.quantity, 10_000 / 1.1, places=4)
        self.assertTrue(any("smaller than the requested risk" in w for w in p.warnings))


class PlanValidationTests(unittest.TestCase):
    def test_unknown_direction_raises(self):
        with self.assertRaises(ValueError):
            plan(direction="long")

    def test_stop_on_the_wrong_side_is_rejected(self):
        self.assertIn("below entry", plan(stop=1.1040).reason)
        self.assertIn("above entry", plan(direction="sell", stop=1.0960, target=1.0880).reason)

    def test_target_on_the_wrong_side_is_rejected(self):
        p = plan(target=1.0900)
        self.assertFalse(p.allowed)
        self.assertIn("above entry", p.reason)

    def test_requested_risk_above_the_policy_limit_is_rejected(self):
        p = plan(risk_fraction=0.02)
        self.assertFalse(p.allowed)
        self.assertIn("exceeds the per-trade limit", p.reason)

    def test_lower_requested_risk_scales_the_position(self):
        p = plan(risk_fraction=0.005)
        self.assertAlmostEqual(p.risk_amount, 50.0, places=6)
        self.assertAlmostEqual(p.quantity, 12_500, places=4)

    def test_bad_numbers_are_rejected_not_raised(self):
        self.assertFalse(plan(entry=0.0).allowed)
        self.assertFalse(plan(equity=-1.0).allowed)
        self.assertFalse(plan(stop=float("nan")).allowed)
        self.assertFalse(plan(quote_to_account=0.0).allowed)
        self.assertFalse(plan(pip_size=-0.0001).allowed)


class PlanWarningTests(unittest.TestCase):
    def test_low_reward_to_risk_and_missing_target(self):
        self.assertTrue(any("below 1.5:1" in w for w in plan(target=1.1040).warnings))
        self.assertTrue(any("no take-profit" in w for w in plan(target=None).warnings))

    def test_high_risk_fraction_warns(self):
        loose = RiskPolicy(max_risk_fraction=0.05, max_position_fraction=30.0)
        self.assertTrue(any("above 2%" in w for w in plan(policy=loose, risk_fraction=0.03).warnings))

    def test_stop_size_relative_to_atr(self):
        self.assertTrue(any("tight" in w for w in plan(atr=0.01).warnings))
        self.assertTrue(any("very wide" in w for w in plan(atr=0.001).warnings))
        self.assertEqual(plan(atr=0.004).warnings, ())


class PortfolioGateTests(unittest.TestCase):
    def test_exposure_limit_blocks_but_keeps_the_sizing(self):
        strict = RiskPolicy(max_risk_fraction=0.01, max_position_fraction=30.0)
        p = plan(policy=strict, portfolio=PortfolioState(open_exposure=0.0))
        self.assertFalse(p.allowed)
        self.assertIn("portfolio exposure", p.reason)
        self.assertAlmostEqual(p.quantity, 25_000, places=4)

    def test_drawdown_limit_blocks(self):
        p = plan(portfolio=PortfolioState(drawdown=0.25))
        self.assertFalse(p.allowed)
        self.assertIn("drawdown", p.reason)

    def test_correlated_exposure_only_counts_when_flagged(self):
        self.assertTrue(plan(portfolio=PortfolioState()).allowed)
        blocked = plan(portfolio=PortfolioState(), is_correlated=True)
        self.assertFalse(blocked.allowed)
        self.assertIn("correlated", blocked.reason)


class ScoreTests(unittest.TestCase):
    def test_components_add_up_to_a_hundred_point_scale(self):
        s = score_setup(trend=18, structure=19, momentum=16, entry=17, risk_reward=3.2)
        self.assertEqual(s.total, 90)
        self.assertEqual(s.breakdown, {"trend": 18.0, "structure": 19.0, "momentum": 16.0, "entry": 17.0, "risk_reward": 20.0})
        self.assertEqual(score_setup(trend=20, structure=20, momentum=20, entry=20, risk_reward=5).total, 100)
        self.assertEqual(score_setup(trend=0, structure=0, momentum=0, entry=0, risk_reward=None).total, 0)

    def test_risk_reward_points_scale(self):
        self.assertEqual(risk_reward_points(0.8), 0.0)
        self.assertEqual(risk_reward_points(1.0), 0.0)
        self.assertEqual(risk_reward_points(2.0), 10.0)
        self.assertEqual(risk_reward_points(3.0), 20.0)
        self.assertEqual(risk_reward_points(None), 0.0)

    def test_out_of_range_components_are_rejected(self):
        with self.assertRaises(ValueError):
            score_setup(trend=21, structure=10, momentum=10, entry=10, risk_reward=2)
        with self.assertRaises(ValueError):
            score_setup(trend=10, structure=-1, momentum=10, entry=10, risk_reward=2)


class DailyLossTests(unittest.TestCase):
    def test_states(self):
        kwargs = dict(day_start_equity=10_000.0, max_daily_loss_fraction=0.03)
        self.assertEqual(daily_loss_status(realized_pnl_today=-100.0, **kwargs).state, "ok")
        self.assertEqual(daily_loss_status(realized_pnl_today=250.0, **kwargs).state, "ok")
        self.assertEqual(daily_loss_status(realized_pnl_today=-250.0, **kwargs).state, "warning")
        self.assertEqual(daily_loss_status(realized_pnl_today=-300.0, **kwargs).state, "breached")

    def test_invalid_limits_raise(self):
        with self.assertRaises(ValueError):
            daily_loss_status(day_start_equity=0.0, realized_pnl_today=0.0, max_daily_loss_fraction=0.03)
        with self.assertRaises(ValueError):
            daily_loss_status(day_start_equity=1000.0, realized_pnl_today=0.0, max_daily_loss_fraction=0.0)


class SideMappingTests(unittest.TestCase):
    def test_round_trip(self):
        self.assertEqual(side_from_direction("buy"), "long")
        self.assertEqual(side_from_direction("sell"), "short")
        self.assertEqual(direction_from_side("long"), "buy")
        self.assertEqual(direction_from_side("short"), "sell")
        with self.assertRaises(ValueError):
            side_from_direction("long")
        with self.assertRaises(ValueError):
            direction_from_side("buy")


if __name__ == "__main__":
    unittest.main()