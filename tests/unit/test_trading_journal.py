import unittest
from datetime import datetime, timedelta, timezone

from trading_intelligence.journal import ClosedTrade, summarize, summarize_by_session

START = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)


def trade(day: int, pnl: float, risk: float | None = 100.0, session: str | None = None) -> ClosedTrade:
    return ClosedTrade(START + timedelta(days=day), pnl, risk, session)


class JournalSummaryTests(unittest.TestCase):
    def setUp(self):
        # R multiples: +2, -1, +3, -1, -1
        self.trades = [trade(0, 200), trade(1, -100), trade(2, 300), trade(3, -100), trade(4, -100)]

    def test_known_sequence_matches_hand_calculation(self):
        s = summarize(self.trades)
        self.assertEqual((s.total_trades, s.winning_trades, s.losing_trades, s.breakeven_trades), (5, 2, 3, 0))
        self.assertEqual(s.win_rate_percent, 40.0)
        self.assertEqual(s.average_win_r, 2.5)
        self.assertEqual(s.average_loss_r, -1.0)
        self.assertEqual(s.expectancy_r, 0.4)
        self.assertEqual(s.profit_factor, 1.67)
        self.assertEqual(s.total_r, 2.0)
        self.assertEqual(s.net_pnl, 200.0)
        self.assertEqual(s.max_drawdown, 200.0)
        self.assertEqual(s.longest_losing_streak, 2)

    def test_input_order_does_not_matter(self):
        self.assertEqual(summarize(reversed(self.trades)), summarize(self.trades))

    def test_drawdown_counts_losses_before_the_first_win(self):
        s = summarize([trade(0, -100), trade(1, 50)])
        self.assertEqual(s.max_drawdown, 100.0)

    def test_all_winning_trades_have_no_profit_factor_and_no_drawdown(self):
        s = summarize([trade(0, 100), trade(1, 200)])
        self.assertIsNone(s.profit_factor)
        self.assertEqual(s.max_drawdown, 0.0)
        self.assertEqual(s.longest_losing_streak, 0)
        self.assertEqual(s.win_rate_percent, 100.0)

    def test_breakeven_trade_ends_a_losing_streak_and_is_not_a_win(self):
        s = summarize([trade(0, -100), trade(1, 0), trade(2, -100)])
        self.assertEqual(s.longest_losing_streak, 1)
        self.assertEqual((s.winning_trades, s.losing_trades, s.breakeven_trades), (0, 2, 1))

    def test_trades_without_risk_are_left_out_of_r_statistics_only(self):
        s = summarize([trade(0, 100, risk=None), trade(1, -50, risk=None)])
        self.assertEqual(s.total_trades, 2)
        self.assertEqual(s.net_pnl, 50.0)
        self.assertIsNone(s.expectancy_r)
        self.assertIsNone(s.total_r)
        self.assertIsNone(s.average_win_r)

    def test_empty_journal_returns_an_empty_summary(self):
        s = summarize([])
        self.assertEqual(s.total_trades, 0)
        self.assertIsNone(s.win_rate_percent)
        self.assertEqual(s.net_pnl, 0.0)

    def test_sessions_are_grouped_with_unspecified_fallback(self):
        result = summarize_by_session(
            [trade(0, 200, session="london"), trade(1, -100, session="london"), trade(2, 100)]
        )
        self.assertEqual(list(result), ["london", "unspecified"])
        self.assertEqual(result["london"].total_trades, 2)
        self.assertEqual(result["london"].total_r, 1.0)
        self.assertEqual(result["unspecified"].total_trades, 1)


class ClosedTradeTests(unittest.TestCase):
    def test_from_row_accepts_supabase_style_values(self):
        row = {
            "status": "closed",
            "closed_at": "2026-10-02T14:30:00Z",
            "pnl_amount": "-120.50",
            "risk_amount": "100.00",
            "session": "new_york",
        }
        t = ClosedTrade.from_row(row)
        self.assertEqual(t.closed_at, datetime(2026, 10, 2, 14, 30, tzinfo=timezone.utc))
        self.assertEqual(t.pnl, -120.5)
        self.assertAlmostEqual(t.r_multiple, -1.205)
        self.assertEqual(t.session, "new_york")

    def test_from_row_rejects_open_or_incomplete_trades(self):
        with self.assertRaises(ValueError):
            ClosedTrade.from_row({"status": "open", "closed_at": None, "pnl_amount": None})
        with self.assertRaises(ValueError):
            ClosedTrade.from_row({"status": "closed", "closed_at": "2026-10-02T14:30:00Z", "pnl_amount": None})

    def test_invalid_numbers_are_rejected(self):
        with self.assertRaises(ValueError):
            ClosedTrade(START, float("nan"))
        with self.assertRaises(ValueError):
            ClosedTrade(START, 10.0, risk_amount=-1.0)

    def test_zero_risk_gives_no_r_multiple(self):
        self.assertIsNone(ClosedTrade(START, 10.0, risk_amount=0.0).r_multiple)


if __name__ == "__main__":
    unittest.main()