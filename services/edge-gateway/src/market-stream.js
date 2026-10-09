import { normalizeProviderSymbol, validateSymbol } from "./market-data.js";

export function normalizeStreamTick(payload, requestedSymbol) {
  const data=payload&&typeof payload==="object"?payload:{};
  if(data.event!=="price" || !Number.isFinite(Number(data.price)) || Number(data.price)<=0) return null;
  const symbol=String(data.symbol||"").toUpperCase();
  if(symbol && symbol!==String(requestedSymbol).toUpperCase()) return null;
  let timestamp=Number(data.timestamp);
  if(!Number.isFinite(timestamp)) timestamp=Date.now();
  else if(timestamp<1e12) timestamp*=1000;
  return {type:"tick",source:"Twelve Data WebSocket",symbol:requestedSymbol,price:Number(data.price),timestamp:new Date(timestamp).toISOString()};
}

export async function marketStream(request, env) {
  if(String(request.headers.get("Upgrade")||"").toLowerCase()!=="websocket") {
    return new Response("WebSocket upgrade required.",{status:426,headers:{"Upgrade":"websocket","Cache-Control":"no-store"}});
  }
  const url=new URL(request.url);
  const type=url.searchParams.get("type")||"stock";
  const requestedSymbol=validateSymbol(url.searchParams.get("symbol")||"AAPL",type);
  const symbol=normalizeProviderSymbol(requestedSymbol,type);
  const apiKey=String(env.TWELVE_DATA_API_KEY||"").trim();
  if(!apiKey) return new Response("Live streaming is not configured.",{status:503,headers:{"Cache-Control":"no-store"}});
  const providerUrl="wss://ws.twelvedata.com/v1/quotes/price?apikey="+encodeURIComponent(apiKey);
  const providerResponse=await fetch(providerUrl,{headers:{Upgrade:"websocket"}});
  const upstream=providerResponse.webSocket;
  if(!upstream) return new Response("Market-data provider did not accept the WebSocket connection.",{status:502,headers:{"Cache-Control":"no-store"}});
  const pair=new WebSocketPair();
  const client=pair[0],server=pair[1];
  server.accept();
  upstream.accept();
  let subscribed=false,closed=false;
  const subscribe=()=>{
    if(subscribed||upstream.readyState!==WebSocket.OPEN)return;
    upstream.send(JSON.stringify({action:"subscribe",params:{symbols:symbol}}));
    subscribed=true;
  };
  const safeClose=(code=1000,reason="closed")=>{
    if(closed)return;closed=true;
    try{if(server.readyState===WebSocket.OPEN)server.close(code,reason)}catch{}
    try{if(upstream.readyState===WebSocket.OPEN)upstream.close(code,reason)}catch{}
  };
  server.addEventListener("message",event=>{
    try {
      const msg=JSON.parse(String(event.data||"{}"));
      if(msg.action==="heartbeat"&&upstream.readyState===WebSocket.OPEN)upstream.send(JSON.stringify({action:"heartbeat"}));
    } catch {}
  });
  server.addEventListener("close",()=>safeClose());
  server.addEventListener("error",()=>safeClose(1011,"client socket error"));
  upstream.addEventListener("open",subscribe);
  upstream.addEventListener("message",event=>{
    if(closed||server.readyState!==WebSocket.OPEN)return;
    let payload;try{payload=JSON.parse(String(event.data||"{}"))}catch{return}
    const tick=normalizeStreamTick(payload,requestedSymbol);
    if(tick){server.send(JSON.stringify(tick));return}
    if(payload.event==="error"||payload.status==="error")server.send(JSON.stringify({type:"status",status:"provider_error",message:String(payload.message||"Market-data stream error").slice(0,160)}));
  });
  upstream.addEventListener("close",()=>safeClose(1011,"market-data stream closed"));
  upstream.addEventListener("error",()=>safeClose(1011,"market-data stream error"));
  subscribe();
  return new Response(null,{status:101,webSocket:client,headers:{"Cache-Control":"no-store"}});
}
