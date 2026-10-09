from __future__ import annotations
import os
from datetime import datetime, timezone
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from . import market_data, repository
from .auth import Caller, current_user
from .planner import build_plan, session_for
from .schemas import BarsResponse, BarOut, InstrumentOut, PlanRequest, PlanResponse

app=FastAPI(title="LifeOS Trading Planner API",version="1.0.0",description="Planning and journalling only; no order execution endpoints.")
origins=[x.strip() for x in os.environ.get("CORS_ORIGINS","").split(",") if x.strip()]
app.add_middleware(CORSMiddleware,allow_origins=origins,allow_credentials=False,allow_methods=["GET","POST"],allow_headers=["Authorization","Content-Type"])

@app.get("/health")
async def health():
    return {"status":"ok","time":datetime.now(timezone.utc).isoformat(),"market_data_configured":bool(market_data.MARKET_DATA_URL),"synthetic_bars_allowed":False,"order_execution":False}

@app.get("/instruments",response_model=list[InstrumentOut])
async def instruments(caller: Caller=Depends(current_user)):
    return await repository.list_instruments(caller.token)

@app.get("/bars",response_model=BarsResponse)
async def bars(symbol: str,timeframe: str="H1",limit: int=300,caller: Caller=Depends(current_user)):
    instrument=await repository.get_instrument(caller.token,symbol)
    try: rows,forming=await market_data.fetch_bars(symbol,timeframe,limit)
    except market_data.MarketDataError as exc: raise HTTPException(503,str(exc)) from None
    return BarsResponse(instrument=InstrumentOut(**instrument),timeframe=timeframe,bars=[BarOut(**x) for x in rows],last_bar_is_forming=forming,server_time=datetime.now(timezone.utc))

@app.post("/plan",response_model=PlanResponse)
async def plan(req: PlanRequest,caller: Caller=Depends(current_user)):
    instrument=await repository.get_instrument(caller.token,req.symbol)
    profile=await repository.get_risk_profile(caller.token)
    open_trades=await repository.get_open_trades(caller.token)
    closed_today=await repository.get_closed_trades_today(caller.token)
    try: return build_plan(req,instrument,profile,open_trades,closed_today)
    except ValueError as exc: raise HTTPException(400,str(exc)) from None

@app.post("/journal")
async def journal(entry: dict,caller: Caller=Depends(current_user)):
    # Whitelist fields to prevent clients from setting another user's ownership.
    allowed={"instrument_id","opened_at","closed_at","entry_price","exit_price","stop_loss","position_size","risk_amount","pnl_amount","fees","session","setup_id","strategy_id","reason_for_entry","lesson","status"}
    body={k:v for k,v in entry.items() if k in allowed}
    if not body.get("instrument_id") or not body.get("opened_at") or not body.get("entry_price") or not body.get("position_size"):
        raise HTTPException(422,"instrument_id, opened_at, entry_price and position_size are required")
    body["user_id"]=caller.user_id
    body["session"]=body.get("session") or session_for(datetime.now(timezone.utc))
    body["status"]="closed" if body.get("closed_at") and body.get("exit_price") is not None else "open"
    return await repository.insert_trade(caller.token,body)

@app.get("/performance")
async def performance(days: int=365,caller: Caller=Depends(current_user)):
    rows=await repository.get_closed_trades(caller.token,days)
    rs=[]; pnls=[]
    for row in rows:
        try:
            pnl=float(row.get("pnl_amount") or 0); risk=float(row.get("risk_amount") or 0)
            pnls.append(pnl)
            if risk>0: rs.append(pnl/risk)
        except (TypeError,ValueError): continue
    wins=sum(1 for x in pnls if x>0)
    losses=sum(1 for x in pnls if x<0)
    gross_win=sum(x for x in pnls if x>0)
    gross_loss=abs(sum(x for x in pnls if x<0))
    return {"summary":{"total_trades":len(pnls),"win_rate_percent":100*wins/len(pnls) if pnls else None,"net_pnl":sum(pnls),"profit_factor":gross_win/gross_loss if gross_loss else None,"expectancy_r":sum(rs)/len(rs) if rs else None},"r_multiples_count":len(rs),"note":"Only closed rows visible under the caller's Supabase RLS are included; this is journaling analytics, not a forecast."}
