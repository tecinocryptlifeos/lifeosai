"""Supabase PostgREST adapter using the caller JWT so RLS remains authoritative."""
from __future__ import annotations
import os
from datetime import datetime, timedelta, timezone
from typing import Any
import httpx
from fastapi import HTTPException

SUPABASE_URL=os.environ.get("SUPABASE_URL","").rstrip("/")
SUPABASE_ANON_KEY=os.environ.get("SUPABASE_ANON_KEY","")
REST=f"{SUPABASE_URL}/rest/v1"

def _headers(token: str, write: bool=False):
    result={"apikey":SUPABASE_ANON_KEY,"Authorization":f"Bearer {token}","Accept":"application/json"}
    if write:
        result.update({"Content-Type":"application/json","Prefer":"return=representation"})
    return result

async def _get(token: str, table: str, params: dict[str,Any]):
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(503,"Supabase URL and anon key are not configured")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response=await client.get(f"{REST}/{table}",params=params,headers=_headers(token))
        if response.status_code >= 400:
            raise HTTPException(502,f"Supabase read failed for {table} (HTTP {response.status_code})")
        data=response.json()
        if not isinstance(data,list):
            raise HTTPException(502,"Supabase returned an unexpected response")
        return data
    except httpx.HTTPError:
        raise HTTPException(502,"Supabase request failed") from None

async def list_instruments(token: str):
    return await _get(token,"trading_instruments",{"select":"id,symbol,display_name,asset_class,pip_size,price_decimals,contract_size","is_active":"eq.true","order":"symbol.asc"})

async def get_instrument(token: str, symbol: str):
    rows=await _get(token,"trading_instruments",{"select":"id,symbol,display_name,asset_class,pip_size,price_decimals,contract_size","symbol":f"eq.{symbol.upper()}","limit":"1"})
    if not rows: raise HTTPException(404,"unknown or unavailable instrument")
    return rows[0]

async def get_risk_profile(token: str):
    rows=await _get(token,"trading_risk_profiles",{"select":"account_balance,default_risk_percent,max_risk_per_trade_percent,max_daily_loss_percent,max_open_risk_percent,max_open_positions","limit":"1"})
    if not rows: raise HTTPException(409,"no risk profile is configured; set account balance and risk limits before planning")
    return rows[0]

async def get_open_trades(token: str):
    return await _get(token,"trading_trades",{"select":"risk_amount,pnl_amount","status":"eq.open"})

async def get_closed_trades(token: str, days: int=365):
    since=(datetime.now(timezone.utc)-timedelta(days=max(1,min(days,3650)))).isoformat()
    return await _get(token,"trading_trades",{"select":"closed_at,pnl_amount,risk_amount,session","status":"eq.closed","closed_at":f"gte.{since}","order":"closed_at.asc","limit":"2000"})

async def insert_trade(token: str, body: dict):
    if not SUPABASE_URL or not SUPABASE_ANON_KEY: raise HTTPException(503,"Supabase is not configured")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response=await client.post(f"{REST}/trading_trades",json=body,headers=_headers(token,True))
        if response.status_code >= 400: raise HTTPException(502,f"Supabase journal write failed (HTTP {response.status_code})")
        rows=response.json()
        return rows[0] if isinstance(rows,list) and rows else {}
    except httpx.HTTPError: raise HTTPException(502,"Supabase journal write failed") from None
