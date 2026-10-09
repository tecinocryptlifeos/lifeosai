import unittest
from datetime import datetime, timezone
from trading_api.planner import session_for, build_plan
from trading_api.schemas import PlanRequest

class PlannerTests(unittest.TestCase):
    instrument={"symbol":"EURUSD","asset_class":"forex","pip_size":0.0001,"price_decimals":5,"contract_size":100000,"display_name":"Euro / US Dollar"}
    profile={"account_balance":10000,"default_risk_percent":1,"max_risk_per_trade_percent":2,"max_daily_loss_percent":3,"max_open_risk_percent":5,"max_open_positions":5}
    def test_buy_stop_geometry_and_conservative_risk(self):
        p=build_plan(PlanRequest(symbol="EURUSD",timeframe="H1",direction="buy",entry=1.1,stop=1.096,target=1.112),self.instrument,self.profile,[])
        self.assertTrue(p.allowed,p.reason)
        self.assertAlmostEqual(p.risk_amount,50.0,places=2)
        self.assertAlmostEqual(p.stop_distance_pips,40.0,places=5)
        self.assertTrue(p.planning_only)
    def test_wrong_stop_side_vetoes_plan(self):
        p=build_plan(PlanRequest(symbol="EURUSD",timeframe="H1",direction="buy",entry=1.1,stop=1.105,target=1.112),self.instrument,self.profile,[])
        self.assertFalse(p.allowed)
        self.assertTrue(p.vetoes)
        self.assertEqual(p.quantity,0)
    def test_wrong_target_side_vetoes_plan(self):
        p=build_plan(PlanRequest(symbol="EURUSD",timeframe="H1",direction="sell",entry=1.1,stop=1.105,target=1.112),self.instrument,self.profile,[])
        self.assertFalse(p.allowed)
    def test_missing_account_balance_is_rejected(self):
        with self.assertRaises(ValueError):
            build_plan(PlanRequest(symbol="EURUSD",timeframe="H1",direction="buy",entry=1.1,stop=1.096),self.instrument,{"account_balance":0},[])
    def test_weekend_session_is_explicit(self):
        self.assertEqual(session_for(datetime(2026,3,14,12,tzinfo=timezone.utc)),"weekend")

if __name__=="__main__": unittest.main()
