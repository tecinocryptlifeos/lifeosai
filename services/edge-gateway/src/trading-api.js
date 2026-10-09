import { GatewayError } from "./policy.js";
import { verifySession } from "./supabase.js";
import { marketData } from "./market-data.js";
import { analyzeMultiTimeframe, trendState } from "./trading-intelligence.js";

const SELECT_INSTRUMENT="id,symbol,display_name,asset_class,pip_size,price_decimals,contract_size";
const TIMEFRAMES={M1:"1m",M5:"5m",M15:"15m",M30:"30m",H1:"1h",D1:"1d",W1:"1wk"};
function sessionFor(date=new Date()){
  const d=new Date(date),day=d.getUTCDay(),hour=d.getUTCHours();
  if(day===0||day===6)return "weekend";
  if(hour>=12&&hour<16)return "london_new_york_overlap";
  if(hour>=7&&hour<16)return "london";
  if(hour>=13&&hour<22)return "new_york";
  if(hour>=0&&hour<9)return "asia";
  return "off_hours";
}
function supabaseConfig(env){
  const base=String(env.SUPABASE_URL||"").trim().replace(/\/$/,"");
  const key=String(env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY||"").trim();
  if(!base||!key)throw new GatewayError(503,"TRADING_DB_NOT_CONFIGURED","Trading database is not configured.");
  return {base,key};
}
async function rest(request,env,table,query,{write=false,body=null}={}){
  const {base,key}=supabaseConfig(env),session=await verifySession(request,env,{profile:"optional"});
  const headers={apikey:key,Authorization:"Bearer "+session.token,Accept:"application/json"};
  const options={method:write?"POST":"GET",headers};
  if(write){headers["Content-Type"]="application/json";headers.Prefer="return=representation";options.body=JSON.stringify(body);}
  let response;
  try{response=await fetch(base+"/rest/v1/"+table+"?"+query.toString(),options)}catch{throw new GatewayError(502,"TRADING_DB_UNAVAILABLE","Trading database request failed.");}
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new GatewayError(response.status===401?401:response.status===403?403:502,"TRADING_DB_ERROR","Trading database request failed (HTTP "+response.status+").");
  return {data,session};
}
function requireFinitePrice(value,name){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)throw new GatewayError(400,"INVALID_TRADING_INPUT",name+" must be a positive finite price.");
  return n;
}
function validSymbol(value){
  const symbol=String(value||"").trim().toUpperCase();
  if(!/^[A-Z0-9_.:/-]{2,20}$/.test(symbol))throw new GatewayError(400,"INVALID_SYMBOL","A valid instrument symbol is required.");
  return symbol;
}
function intervalMs(interval){return ({ "1m":60000,"5m":300000,"15m":900000,"30m":1800000,"1h":3600000,"1d":86400000,"1wk":604800000 })[interval]||3600000;}
async function rows(request,env,table,params){
  const query=new URLSearchParams(params);
  const result=await rest(request,env,table,query);
  if(!Array.isArray(result.data))throw new GatewayError(502,"TRADING_DB_INVALID_RESPONSE","Trading database returned an invalid response.");
  return result.data;
}
async function instrument(request,env,symbol){
  const found=await rows(request,env,"trading_instruments",{select:SELECT_INSTRUMENT,symbol:"eq."+symbol,limit:"1"});
  if(!found[0])throw new GatewayError(404,"INSTRUMENT_NOT_FOUND","Unknown or unavailable trading instrument.");
  return found[0];
}
export async function tradingInstruments(request,env){
  const data=await rows(request,env,"trading_instruments",{select:SELECT_INSTRUMENT,is_active:"eq.true",order:"symbol.asc"});
  return {ok:true,instruments:data};
}
export async function tradingBars(request,env){
  const url=new URL(request.url),symbol=validSymbol(url.searchParams.get("symbol")),tf=String(url.searchParams.get("timeframe")||"H1").toUpperCase();
  if(!Object.hasOwn(TIMEFRAMES,tf)&&tf!=="H4")throw new GatewayError(400,"INVALID_TIMEFRAME","Supported timeframes: M1, M5, M15, M30, H1, H4, D1, W1.");
  const limit=Math.max(30,Math.min(500,Number.parseInt(url.searchParams.get("limit")||"300",10)||300));
  const asset=await instrument(request,env,symbol);
  const interval=tf==="H4"?"1h":TIMEFRAMES[tf];
  const marketUrl=new URL(request.url);marketUrl.pathname="/api/market-data";marketUrl.search=new URLSearchParams({type:asset.asset_class==="crypto"?"crypto":asset.asset_class==="forex"?"forex":"stock",symbol,interval,outputsize:String(tf==="H4"?Math.min(500,limit*4):limit)}).toString();
  let payload;
  try{payload=await marketData(new Request(marketUrl.toString()),env)}catch{throw new GatewayError(503,"TRADING_MARKET_DATA_UNAVAILABLE","Verified market data is unavailable for this instrument/timeframe.");}
  let bars=payload.bars.map(b=>({t:b.timestamp,open:b.open,high:b.high,low:b.low,close:b.close}));
  if(tf==="H4"){
    const grouped=[];
    for(let i=0;i<bars.length;i+=4){const chunk=bars.slice(i,i+4);if(!chunk.length)continue;grouped.push({t:chunk[0].t,open:chunk[0].open,high:Math.max(...chunk.map(b=>b.high)),low:Math.min(...chunk.map(b=>b.low)),close:chunk.at(-1).close});}
    bars=grouped;
  }
  bars=bars.slice(-limit);
  const last=bars.at(-1),ts=last?Date.parse(last.t):NaN;
  return {ok:true,instrument:asset,timeframe:tf,bars,last_bar_is_forming:Number.isFinite(ts)&&Date.now()-ts<intervalMs(interval),server_time:new Date().toISOString(),source:payload.source};
}
export async function tradingPlan(request,env){
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=="object")throw new GatewayError(400,"INVALID_TRADING_INPUT","A JSON trade plan is required.");
  const symbol=validSymbol(body.symbol),direction=String(body.direction||"");
  if(!["buy","sell"].includes(direction))throw new GatewayError(400,"INVALID_DIRECTION","Direction must be buy or sell.");
  const entry=requireFinitePrice(body.entry,"entry"),stop=requireFinitePrice(body.stop,"stop");
  const target=body.target==null?null:requireFinitePrice(body.target,"target");
  const tf=String(body.timeframe||"");
  if(!Object.hasOwn(TIMEFRAMES,tf)&&tf!=="H4")throw new GatewayError(400,"INVALID_TIMEFRAME","Unsupported planning timeframe.");
  const asset=await instrument(request,env,symbol);
  const profiles=await rows(request,env,"trading_risk_profiles",{select:"account_balance,default_risk_percent,max_risk_per_trade_percent,max_daily_loss_percent,max_open_risk_percent,max_open_positions",limit:"1"});
  if(!profiles[0])throw new GatewayError(409,"RISK_PROFILE_REQUIRED","Configure account balance and risk limits before planning.");
  const profile=profiles[0];
  const open=await rows(request,env,"trading_trades",{select:"risk_amount,pnl_amount,status","status":"eq.open",limit:"1000"});
  const midnight=new Date();midnight.setUTCHours(0,0,0,0);
  const closed=await rows(request,env,"trading_trades",{select:"pnl_amount,closed_at,status",status:"eq.closed",closed_at:"gte."+midnight.toISOString(),limit:"1000"});
  const equity=Number(profile.account_balance||0);
  if(!Number.isFinite(equity)||equity<=0)throw new GatewayError(409,"INVALID_ACCOUNT_BALANCE","Account balance must be positive.");
  const vetoes=[];
  if(direction==="buy"&&stop>=entry||direction==="sell"&&stop<=entry)vetoes.push("stop must be below entry for buys and above entry for sells");
  if(target!==null&&(direction==="buy"&&target<=entry||direction==="sell"&&target>=entry))vetoes.push("target must be above entry for buys and below entry for sells");
  const session=sessionFor();
  if(session==="weekend"&&asset.asset_class==="forex")vetoes.push("forex planning is blocked during the weekend");
  const pnl=[...open,...closed].reduce((sum,x)=>sum+Number(x.pnl_amount||0),0);
  const dailyLimit=Math.min(100,Math.max(0,Number(profile.max_daily_loss_percent||3)))/100;
  if(pnl<-(equity*dailyLimit))vetoes.push("daily loss limit appears breached; verify account-day accounting");
  const openRisk=open.reduce((sum,x)=>sum+Number(x.risk_amount||0),0);
  const maxOpenRisk=Math.min(Number(profile.max_open_risk_percent||5)/100,0.04);
  if(openRisk/equity>=maxOpenRisk)vetoes.push("maximum open risk reached");
  const maxPositions=Math.min(Math.max(1,Number(profile.max_open_positions||5)),4);
  if(open.length>=maxPositions)vetoes.push("maximum open positions reached");
  const maxRisk=Math.min(Number(profile.max_risk_per_trade_percent||2)/100,0.005);
  const riskFraction=Math.min(Number(profile.default_risk_percent||1)/100,maxRisk,0.005);
  const distance=Math.abs(entry-stop),budget=equity*riskFraction;
  const quantity=distance>0&&!vetoes.length?Math.min(budget/distance,equity/entry):0;
  const riskAmount=quantity*distance,reward=target===null?null:Math.abs(target-entry);
  return {ok:true,allowed:!vetoes.length,reason:vetoes[0]||"risk and price geometry checks passed; technical confirmation is not included",vetoes,warnings:["Planning only: this endpoint never submits or executes orders.","Costs, slippage, liquidity and currency conversion are not included."],session,direction,symbol,entry,stop,target,equity:Math.round(equity*100)/100,quantity:Math.round(quantity*1e8)/1e8,risk_amount:Math.round(riskAmount*100)/100,risk_fraction:equity?riskAmount/equity:0,stop_distance:distance,stop_distance_pips:distance/Number(asset.pip_size),risk_reward:reward!==null&&distance>0?reward/distance:null,potential_profit:reward!==null?quantity*reward:null,costs_estimated:false,planning_only:true};
}
export async function tradingJournal(request,env){
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=="object"||Array.isArray(body))throw new GatewayError(400,"INVALID_JOURNAL_ENTRY","A journal entry object is required.");
  const allowed=new Set(["instrument_id","opened_at","closed_at","entry_price","exit_price","stop_loss","position_size","risk_amount","pnl_amount","fees","session","setup_id","strategy_id","reason_for_entry","lesson","status"]);
  const input=Object.fromEntries(Object.entries(body).filter(([k])=>allowed.has(k)));
  if(!input.instrument_id||!input.opened_at||!input.entry_price||!input.position_size)throw new GatewayError(422,"JOURNAL_FIELDS_REQUIRED","instrument_id, opened_at, entry_price and position_size are required.");
  const {session}=await verifySession(request,env,{profile:"optional"});
  input.user_id=session.user.id;
  input.session=input.session||sessionFor();
  input.status=input.closed_at&&input.exit_price!==undefined&&input.exit_price!==null?"closed":"open";
  const query=new URLSearchParams({select:"*"});
  const result=await rest(request,env,"trading_trades",query,{write:true,body:input});
  return {ok:true,trade:Array.isArray(result.data)?result.data[0]||null:result.data};
}
export async function tradingPerformance(request,env){
  const url=new URL(request.url),days=Math.max(1,Math.min(3650,Number.parseInt(url.searchParams.get("days")||"365",10)||365));
  const since=new Date(Date.now()-days*86400000).toISOString();
  const data=await rows(request,env,"trading_trades",{select:"closed_at,pnl_amount,risk_amount,session",status:"eq.closed",closed_at:"gte."+since,order:"closed_at.asc",limit:"2000"});
  const pnls=data.map(x=>Number(x.pnl_amount||0)).filter(Number.isFinite),rs=data.map(x=>{const pnl=Number(x.pnl_amount||0),risk=Number(x.risk_amount||0);return risk>0&&Number.isFinite(pnl)?pnl/risk:null}).filter(Number.isFinite);
  const wins=pnls.filter(x=>x>0),losses=pnls.filter(x=>x<0),grossWin=wins.reduce((a,b)=>a+b,0),grossLoss=Math.abs(losses.reduce((a,b)=>a+b,0));
  return {ok:true,summary:{total_trades:pnls.length,winning_trades:wins.length,losing_trades:losses.length,win_rate_percent:pnls.length?100*wins.length/pnls.length:null,net_pnl:pnls.reduce((a,b)=>a+b,0),profit_factor:grossLoss?grossWin/grossLoss:null,expectancy_r:rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:null},r_multiples_count:rs.length,note:"Only closed rows visible under the caller's Supabase row-level security are included. Historical results do not predict future performance."};
}
function refreshCachedAnalysis(result){
  const now=Date.now(),a=result.analysis||{},execution=a.execution||{},alignment=a.alignment||{};
  const ms5=300000-(now%300000),ms1=60000-(now%60000);
  const secondsTo5mClose=Math.ceil(ms5/1000),secondsTo1mClose=Math.ceil(ms1/1000);
  const closingWindow=ms5<=10000&&ms1<=10000;
  const direction=a.macro?.weekly?.direction||"neutral";
  const ready=Number(a.quality_score)>=80&&alignment.macro&&alignment.setup&&alignment.pattern&&alignment.trigger&&alignment.close&&execution.entry!==null&&execution.stop!==null;
  const signal=ready&&closingWindow?(direction==="bullish"?"BUY":direction==="bearish"?"SELL":null):null;
  return {...result,cache:"HIT",analysis:{...a,status:signal?"SIGNAL":"HOLD",signal,reason:signal?"All three analysis layers align in the candle-closing window.":Number(a.quality_score)>=80&&!closingWindow?"Confluence score meets the rule threshold; waiting for the final 10 seconds of the aligned 5-minute and 1-minute candle close.":a.reason,execution:{...execution,closing_window:closingWindow,seconds_to_5m_close:secondsTo5mClose,seconds_to_1m_close:secondsTo1mClose,confirmation:closingWindow?"CLOSING_WINDOW":"WAIT_FOR_CLOSE"}}};
}
export async function tradingAnalysis(request,env){
  const url=new URL(request.url),type=url.searchParams.get("type")||"stock",symbol=validSymbol(url.searchParams.get("symbol")||"AAPL");
  if(!["stock","forex","crypto"].includes(type))throw new GatewayError(400,"INVALID_MARKET_TYPE","Unsupported market type.");
  const cacheKey="trading-analysis:v1:"+type+":"+symbol;
  if(env.ORIGIN_STATE?.get){
    try{
      const cached=await env.ORIGIN_STATE.get(cacheKey,{type:"json"});
      if(cached&&Date.now()-Date.parse(cached.cached_at)<300000)return refreshCachedAnalysis(cached);
    }catch{}
  }
  const intervals=["1wk","1d","1h","15m","10m","30m","5m","1m"];
  const settled=await Promise.allSettled(intervals.map(async interval=>{
    const marketUrl=new URL(request.url);marketUrl.pathname="/api/market-data";marketUrl.search=new URLSearchParams({type,symbol,interval,outputsize:"100"}).toString();
    return [interval,await marketData(new Request(marketUrl.toString()),env)];
  }));
  const series={},sources={},errors={};
  settled.forEach((item,i)=>{const tf=intervals[i];if(item.status==="fulfilled"){series[tf]=item.value.bars;sources[tf]=item.value.source}else{series[tf]=[];errors[tf]="Market data unavailable";}});
  const analysis=analyzeMultiTimeframe(series);
  const result={ok:true,symbol,type,source:"Cloudflare Workers",sources,errors,cached_at:new Date().toISOString(),analysis};
  if(env.ORIGIN_STATE?.put){try{await env.ORIGIN_STATE.put(cacheKey,JSON.stringify(result),{expirationTtl:300})}catch{}}
  return result;
}
export async function scheduledTradingAnalysis(controller,env){
  if(!env.ORIGIN_STATE?.put)return;
  const interval=controller.cron==="0 0 * * 1"?"1wk":controller.cron==="0 0 * * *"?"1d":"1h";
  const watchlist=String(env.LIFEOS_ANALYSIS_WATCHLIST||"BTC/USD,EUR/USD,AAPL").split(",").map(x=>x.trim().toUpperCase()).filter(Boolean).slice(0,6);
  const records=await Promise.all(watchlist.map(async symbol=>{
    const type=symbol.includes("BTC")||symbol.includes("ETH")||symbol.includes("SOL")||symbol.includes("USDT")?"crypto":symbol.includes("/")?"forex":"stock";
    try{
      const url=new URL("https://scheduled.invalid/api/market-data");url.search=new URLSearchParams({type,symbol,interval,outputsize:"100"}).toString();
      const data=await marketData(new Request(url.toString()),env);
      return {symbol,type,interval,trend:trendState(data.bars),source:data.source,updated_at:new Date().toISOString(),status:"ok"};
    }catch{return {symbol,type,interval,status:"unavailable",updated_at:new Date().toISOString()};}
  }));
  await env.ORIGIN_STATE.put("scheduled-trading-analysis:"+interval,JSON.stringify({cron:controller.cron,updated_at:new Date().toISOString(),records}),{expirationTtl:8*86400});
}
