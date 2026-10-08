'use strict';
const API='https://losai-edge-gateway.lifeostecinoai.workers.dev',$=i=>document.getElementById(i);
const LIST={stock:[['AAPL','Apple'],['MSFT','Microsoft'],['GOOGL','Alphabet (Google)'],['AMZN','Amazon'],['NVDA','NVIDIA'],['META','Meta'],['TSLA','Tesla'],['NFLX','Netflix'],['AMD','AMD'],['INTC','Intel'],['JPM','JPMorgan'],['V','Visa'],['DIS','Disney'],['BA','Boeing'],['KO','Coca-Cola'],['WMT','Walmart'],['XOM','Exxon Mobil'],['PYPL','PayPal'],['UBER','Uber'],['COIN','Coinbase']],
forex:[['EUR/USD','Euro / US Dollar'],['GBP/USD','Pound / US Dollar'],['USD/JPY','Dollar / Yen'],['AUD/USD','Aussie / US Dollar'],['USD/CAD','Dollar / Canadian'],['USD/CHF','Dollar / Franc'],['NZD/USD','Kiwi / US Dollar'],['USD/NGN','Dollar / Naira'],['USD/ZAR','Dollar / Rand'],['USD/CNY','Dollar / Yuan'],['USD/INR','Dollar / Rupee'],['XAU/USD','Gold / US Dollar']],
crypto:[['BTC/USD','Bitcoin'],['ETH/USD','Ethereum'],['SOL/USD','Solana'],['XRP/USD','XRP'],['BNB/USD','BNB'],['ADA/USD','Cardano'],['DOGE/USD','Dogecoin'],['AVAX/USD','Avalanche'],['LINK/USD','Chainlink'],['DOT/USD','Polkadot'],['LTC/USD','Litecoin'],['MATIC/USD','Polygon']]};
const TF={'1m':['1m',1],'5m':['5m',5],'15m':['15m',15],'30m':['30m',30],'1H':['1h',60],'1D':['1d',1440],'1W':['1wk',10080],'1M':['1mo',43200]};
const UP='#16c784',DN='#ea3943',MUT='#8a94a6',GRID='rgba(255,255,255,.06)';
const ld=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))||d}catch{return d}},sv=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
const S={tab:'crypto',type:'crypto',sym:'BTC/USD',tf:'5m',bars:[],n:80,off:0,live:true,disp:null,from:0,t0:0,raf:0,cross:null,err:0,req:0,timer:0,nextAt:0,stale:false,s20:[],s50:[],sg:[],sel:null,drag:0,stats:null,tool:null,tmp:null,qt:0,geo:null,rs:[],brk:[],pv:[],old:0,src:''};
S.ind=Object.assign({sma20:1,sma50:1,rsi:0,vol:1,sig:1,swing:0,bos:0},ld('losai_ind_v1',{}));let DR=ld('losai_draw_v1',{});
const ago=ms=>{const m=Math.round(ms/60000);return m>=2880?Math.round(m/1440)+' days':m>=120?Math.round(m/60)+' hours':m+' minutes'};
let A=ld('losai_demo_v1',{bal:10000,pos:{},ord:[]}),H=ld('losai_sigs_v1',[]);const LP={};
const TZ=new Intl.DateTimeFormat([],{timeZoneName:'short'}).formatToParts(new Date()).find(p=>p.type==='timeZoneName')?.value||'';
const intr=()=>TF[S.tf][1]<1440,last=()=>S.bars[S.bars.length-1];
const dp=p=>p>=100?2:p>=10?3:p>=1?4:6,f=v=>Number(v).toFixed(dp(Math.abs(v))),usd=v=>(v<0?'-':'')+'$'+Math.abs(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const ft=(ts,full)=>{const d=new Date(ts);return intr()?d.toLocaleString([],full?{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}:{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString([],{timeZone:'UTC',year:'numeric',month:'short',day:'numeric'})};
const fx=(s,px)=>{const[b,q]=s.split('/');return !q||q==='USD'?1:b==='USD'?1/px:1};
let tt=0;function toast(t){const e=$('toast');e.textContent=t;e.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>e.classList.remove('on'),3200)}
const msg=t=>{$('msg').textContent=t||''};
function sma(a,n){return a.map((_,i)=>i<n-1?null:a.slice(i-n+1,i+1).reduce((s,x)=>s+x,0)/n)}
/* ---------- data ---------- */
async function pull(){
  clearTimeout(S.timer);clearTimeout(S.qt);const id=++S.req;
  try{
    const r=await fetch(`${API}/api/market-data?type=${S.type}&symbol=${encodeURIComponent(S.sym)}&interval=${TF[S.tf][0]}&outputsize=300`,{cache:'no-store'});
    const j=await r.json().catch(()=>({}));if(id!==S.req)return;
    if(!r.ok||!j.ok||!j.bars||!j.bars.length)throw new Error(j.error||('HTTP '+r.status));
    S.err=0;S.bars=j.bars;const L=last(),c=S.bars.map(b=>b.close);S.s20=sma(c,20);S.s50=sma(c,50);
    S.from=S.disp==null?L.close:S.disp;S.t0=performance.now();if(S.disp==null)S.disp=L.close;
    const prev=LP[S.sym];LP[S.sym]=L.close;
    const age=Date.now()-Date.parse(L.timestamp),ims=TF[S.tf][1]*60000;S.stale=intr()&&age>Math.max(ims*2.5,15*60000);S.old=intr()&&age>(S.type==='crypto'?Math.max(ims*6,2*3600000):5*86400000)?1:0;S.src=j.source||'';$('src').textContent=S.src;
    msg(S.old?'Data feed problem: the newest candle from '+(S.src||'the provider')+' is '+ago(age)+' old, so prices may not match the market.':S.stale?'Market closed. Showing the latest candles (last candle '+ft(L.timestamp,true)+').':'');
    guard();head(prev);acct();analyse();qpull();if(!S.raf){S.raf=1;requestAnimationFrame(loop)}else draw();
  }catch(e){if(id!==S.req)return;S.err++;msg(S.bars.length?'Update failed ('+e.message+'). Retrying…':'Cannot load '+S.sym+': '+e.message+'. Retrying…');stat()}
  if(id!==S.req)return;stat();
  if(S.live&&!document.hidden){const d=S.err?Math.min(30*2**S.err,300):S.stale?300:S.type==='forex'?60:30;S.nextAt=Date.now()+d*1000;S.timer=setTimeout(pull,d*1000)}else S.nextAt=0;
}
function loop(){const L=last();if(!L){S.raf=0;return}const t=Math.min(1,(performance.now()-S.t0)/700);S.disp=S.from+(L.close-S.from)*(1-Math.pow(1-t,3));draw();if(t<1)requestAnimationFrame(loop);else S.raf=0}
function stat(){const e=$('stat');let c='stat',t='PAUSED';if(S.err&&!S.bars.length){t='OFFLINE';c+=' shut'}else if(!S.bars.length)t='CONNECTING';else if(S.stale||S.old){t=S.old||S.type==='crypto'?'DELAYED':'MARKET CLOSED';c+=' shut'}else if(S.live){t='LIVE';c+=' live'}e.className=c;e.textContent=t}
function head(prev){
  const B=S.bars,L=last();let ref;if(intr()){const d=L.timestamp.slice(0,10);ref=(B.find(b=>b.timestamp.slice(0,10)===d)||B[0]).open}else ref=(B[B.length-2]||L).close;
  $('hs').textContent=S.sym;const p=$('px');p.textContent=f(L.close);p.className='hp'+(prev==null||prev===L.close?'':L.close>prev?' u':' d');
  const d=L.close-ref,pc=d/ref*100;$('chg').textContent=(d>=0?'+':'')+f(d)+' ('+(d>=0?'+':'')+pc.toFixed(2)+'%)';$('chg').className='hc '+(d>=0?'u':'d');
  $('sp').textContent=$('bp').textContent=f(L.close);
}
/* ---------- live quote ticks: the forming candle is built from real latest quotes ---------- */
async function qpull(){
  clearTimeout(S.qt);const id=S.req;if(!S.live||document.hidden||!S.bars.length)return;
  try{const r=await fetch(`${API}/api/market-quote?type=${S.type}&symbol=${encodeURIComponent(S.sym)}`,{cache:'no-store'}),j=await r.json();
    if(id!==S.req||!r.ok||!j.ok)throw 0;mergeQuote(+j.price,Date.parse(j.timestamp)||Date.now())}catch{}
  if(id===S.req&&S.live&&!document.hidden)S.qt=setTimeout(qpull,S.type==='forex'?30000:5000);
}
function mergeQuote(px,ts){
  const B=S.bars,L=last();if(!L||!(px>0))return;const gap=Math.abs(px/L.close-1);
  if(gap>.05){S.old=1;msg('Chart candles are out of date: the live price is '+f(px)+' but the last candle closed at '+f(L.close)+' ('+(gap*100).toFixed(1)+'% apart). The provider candle data needs fixing.');stat();return}
  const ms=TF[S.tf][1]*60000,t0=Date.parse(L.timestamp);let added=0;
  if(intr()){if(Date.now()-t0>ms*3)return;if(ts>=t0+ms){B.push({timestamp:new Date(Math.floor(ts/ms)*ms).toISOString(),open:L.close,high:Math.max(L.close,px),low:Math.min(L.close,px),close:px,volume:0});added=1}}
  if(!added){if(px===L.close)return;L.close=px;L.high=Math.max(L.high,px);L.low=Math.min(L.low,px)}
  const c=B.map(b=>b.close);S.s20=sma(c,20);S.s50=sma(c,50);const prev=LP[S.sym];LP[S.sym]=px;
  S.from=S.disp==null?px:S.disp;S.t0=performance.now();head(prev);acct();if(added)analyse();if(!S.raf){S.raf=1;requestAnimationFrame(loop)}
}
/* ---------- market structure: swing pivots and breaks of structure ---------- */
function structure(){
  const B=S.bars,n=B.length;S.brk=[];S.pv=[];
  for(let i=3;i<n-3;i++){let ph=1,pl=1;for(let k=1;k<=3;k++){if(B[i-k].high>=B[i].high||B[i+k].high>=B[i].high)ph=0;if(B[i-k].low<=B[i].low||B[i+k].low<=B[i].low)pl=0}if(ph)S.pv.push({i,h:1,p:B[i].high});if(pl)S.pv.push({i,h:0,p:B[i].low})}
  let hi=null,lo=null,bh=-1,bl=-1;
  for(let i=0;i<n;i++){for(const v of S.pv)if(v.i+3===i)v.h?hi=v:lo=v;
    if(hi&&B[i].close>hi.p&&bh!==hi.i){S.brk.push({i,d:1,p:hi.p,f:hi.i});bh=hi.i}
    if(lo&&B[i].close<lo.p&&bl!==lo.i){S.brk.push({i,d:-1,p:lo.p,f:lo.i});bl=lo.i}}
}
/* ---------- chart ---------- */
const cv=$('cv'),cx=cv.getContext('2d');
function draw(){
  const w=cv.clientWidth,h=cv.clientHeight,d=devicePixelRatio||1;if(!w||!h)return;
  if(cv.width!==Math.round(w*d)||cv.height!==Math.round(h*d)){cv.width=Math.round(w*d);cv.height=Math.round(h*d)}
  cx.setTransform(d,0,0,d,0,0);cx.clearRect(0,0,w,h);const B=S.bars;if(!B.length)return;
  const I=S.ind,n=Math.min(S.n,B.length);S.off=Math.max(0,Math.min(S.off,B.length-n));
  const end=B.length-S.off,st=end-n,li=B.length-1,AX=72,PW=w-AX,TH=h-22,VH=I.vol?Math.round(TH*.14):0,RH=I.rsi?Math.round(TH*.18):0,CH=TH-VH-RH-(VH?6:0)-(RH?6:0),bw=PW/n;
  const W=B.slice(st,end).map((b,i)=>st+i===li&&S.disp!=null?{...b,close:S.disp,high:Math.max(b.high,S.disp),low:Math.min(b.low,S.disp)}:b);
  let lo=Math.min(...W.map(b=>b.low)),hi=Math.max(...W.map(b=>b.high));const pd=(hi-lo||hi*.001)*.08;lo-=pd;hi+=pd;
  const Y=p=>CH-(p-lo)/(hi-lo)*CH,X=i=>i*bw+bw/2;S.geo={lo,hi,CH,st,n,bw,PW,TH};
  const ix=ts=>{const t=Date.parse(ts);let j=0,m=1e18;B.forEach((b,i)=>{const e=Math.abs(Date.parse(b.timestamp)-t);if(e<m){m=e;j=i}});return j};
  cx.font='11px system-ui,sans-serif';cx.textBaseline='middle';cx.textAlign='left';
  for(let k=0;k<=4;k++){const p=lo+(hi-lo)*k/4,y=Y(p);cx.strokeStyle=GRID;cx.beginPath();cx.moveTo(0,y);cx.lineTo(PW,y);cx.stroke();cx.fillStyle=MUT;cx.fillText(p.toFixed(dp(p)),PW+6,y)}
  const stp=Math.max(1,Math.ceil(n/Math.max(2,Math.floor(PW/92))));cx.textBaseline='alphabetic';cx.textAlign='center';cx.fillStyle=MUT;let pk='';
  for(let i=Math.floor(stp/2);i<n;i+=stp){const dk=W[i].timestamp.slice(0,10);cx.fillText(ft(W[i].timestamp,intr()&&(dk!==pk||stp*bw>105)),X(i),h-6);pk=dk}cx.textAlign='left';
  const vb=CH+(VH?6+VH:0),rt=vb+(RH?6:0),vm=Math.max(...W.map(b=>b.volume||0))||1;
  W.forEach((b,i)=>{const x=X(i),c=b.close>=b.open?UP:DN;cx.strokeStyle=cx.fillStyle=c;cx.beginPath();cx.moveTo(x,Y(b.high));cx.lineTo(x,Y(b.low));cx.stroke();
    cx.fillRect(x-bw*.35,Y(Math.max(b.open,b.close)),Math.max(1,bw*.7),Math.max(1,Math.abs(Y(b.open)-Y(b.close))));
    if(VH&&b.volume){cx.globalAlpha=.35;const vh=b.volume/vm*VH;cx.fillRect(x-bw*.35,vb-vh,Math.max(1,bw*.7),vh);cx.globalAlpha=1}});
  if(RH){cx.strokeStyle=GRID;for(const v of[30,70]){const y=rt+RH-v/100*RH;cx.setLineDash([3,3]);cx.beginPath();cx.moveTo(0,y);cx.lineTo(PW,y);cx.stroke();cx.setLineDash([]);cx.fillStyle=MUT;cx.textBaseline='middle';cx.fillText(v,PW+6,y)}
    cx.strokeStyle='#b48cff';cx.beginPath();let s0=0;W.forEach((_,i)=>{const v=S.rs[st+i];if(v==null)return;const y=rt+RH-v/100*RH;s0?cx.lineTo(X(i),y):(cx.moveTo(X(i),y),s0=1)});cx.stroke();cx.fillStyle=MUT;cx.textBaseline='top';cx.fillText('RSI 14',6,rt+3)}
  for(const[on,arr,col]of[[I.sma20,S.s20,'#f5a623'],[I.sma50,S.s50,'#4c8dff']]){if(!on)continue;cx.strokeStyle=col;cx.beginPath();let s1=0;W.forEach((_,i)=>{const v=arr[st+i];if(v==null)return;s1?cx.lineTo(X(i),Y(v)):(cx.moveTo(X(i),Y(v)),s1=1)});cx.stroke()}
  const line=(p,col,txt,da)=>{if(p<lo||p>hi)return;const y=Y(p);cx.setLineDash(da);cx.strokeStyle=col;cx.beginPath();cx.moveTo(0,y);cx.lineTo(PW,y);cx.stroke();cx.setLineDash([]);cx.fillStyle=col;cx.fillRect(PW,y-9,AX,18);cx.fillStyle='#fff';cx.textBaseline='middle';cx.fillText(txt,PW+5,y)};
  if(I.swing){const H2=[...S.pv].reverse().find(v=>v.h),L2=[...S.pv].reverse().find(v=>!v.h);if(H2)line(H2.p,'#b48cff','Swing H '+f(H2.p),[5,4]);if(L2)line(L2.p,'#b48cff','Swing L '+f(L2.p),[5,4])}
  if(I.bos)for(const e of S.brk){const k=e.i-st;if(k<0||k>=n)continue;const y=Y(e.p),x0=Math.max(0,X(e.f-st));cx.strokeStyle='#b48cff';cx.beginPath();cx.moveTo(x0,y);cx.lineTo(X(k),y);cx.stroke();cx.fillStyle='#b48cff';cx.font='bold 10px system-ui,sans-serif';cx.textAlign='center';cx.textBaseline=e.d>0?'bottom':'top';cx.fillText(e.d>0?'BOS ▲':'BOS ▼',X(k),y+(e.d>0?-3:3));cx.textAlign='left';cx.font='11px system-ui,sans-serif'}
  cx.save();cx.beginPath();cx.rect(0,0,PW,TH);cx.clip();
  for(const D of DR[S.sym]||[]){if(D.k==='h'){cx.strokeStyle='#f5a623';cx.beginPath();cx.moveTo(0,Y(D.p));cx.lineTo(PW,Y(D.p));cx.stroke()}
    else{const a=ix(D.t1),b2=ix(D.t2),m=(D.p2-D.p1)/((b2-a)||1);cx.strokeStyle='#f5a623';cx.lineWidth=1.6;cx.beginPath();cx.moveTo(X(a-st),Y(D.p1));cx.lineTo(PW,Y(D.p1+m*(st+n-a)));cx.stroke();cx.lineWidth=1}}
  if(S.tmp){cx.fillStyle='#f5a623';cx.beginPath();cx.arc(X(ix(S.tmp.t)-st),Y(S.tmp.p),4,0,7);cx.fill()}cx.restore();
  if(I.sig)for(const g of S.sg){const k=g.i-st;if(k<0||k>=n)continue;const b=W[k],x=X(k),u=g.d>0,y=u?Y(b.low)+6:Y(b.high)-6,ty=u?y+26:y-26;
    if(S.sel&&S.sel.t===g.t){cx.strokeStyle='#fff';cx.lineWidth=1.5;cx.strokeRect(x-Math.max(bw/2,4),Y(b.high)-3,Math.max(bw,8),Y(b.low)-Y(b.high)+6);cx.lineWidth=1}
    cx.fillStyle=u?UP:DN;cx.beginPath();cx.moveTo(x,y);cx.lineTo(x-7,y+(u?13:-13));cx.lineTo(x+7,y+(u?13:-13));cx.fill();
    if(bw>=13||(S.sel&&S.sel.t===g.t)){cx.fillRect(x-27,ty-9,54,18);cx.fillStyle='#fff';cx.font='bold 11px system-ui,sans-serif';cx.textAlign='center';cx.textBaseline='middle';cx.fillText((u?'BUY ':'SELL ')+g.cnt+'/6',x,ty);cx.textAlign='left';cx.font='11px system-ui,sans-serif'}}
  const lb=B[li],lp=S.disp==null?lb.close:S.disp;line(lp,lp>=lb.open?UP:DN,f(lp),[4,3]);
  const po=A.pos[S.sym];if(po){line(po.avg,'#4c8dff',(po.q>0?'LONG ':'SHORT ')+f(po.avg),[6,4]);if(po.sl)line(po.sl,DN,'SL '+f(po.sl),[2,3]);if(po.tp)line(po.tp,UP,'TP '+f(po.tp),[2,3])}
  const c=S.cross;let sel=lb;
  if(c&&c.x<PW&&c.y<TH){const i=Math.min(n-1,Math.max(0,Math.floor(c.x/bw)));sel=W[i];cx.strokeStyle='rgba(255,255,255,.3)';cx.setLineDash([3,3]);cx.beginPath();cx.moveTo(X(i),0);cx.lineTo(X(i),TH);cx.moveTo(0,c.y);cx.lineTo(PW,c.y);cx.stroke();cx.setLineDash([]);
    if(c.y<CH){const p=lo+(CH-c.y)/CH*(hi-lo);cx.fillStyle='#2a3558';cx.fillRect(PW,c.y-9,AX,18);cx.fillStyle='#fff';cx.textBaseline='middle';cx.fillText(p.toFixed(dp(p)),PW+5,c.y)}}
  const card=(g,b,x)=>{const u=g.d>0,T=[(u?'BUY':'SELL')+' · '+g.cnt+' of 6 checks agree',...NM.map((nm,k)=>(g.v[k]===g.d?'✓ ':g.v[k]?'✗ ':'– ')+nm+': '+g.det[k]),'Click the marker for the full plan'];
    cx.font='11px system-ui,sans-serif';const w2=Math.max(...T.map(t=>cx.measureText(t).width))+18,h2=T.length*16+12,bx=Math.min(Math.max(4,x-w2/2),PW-w2-4);let by=u?Y(b.high)-h2-14:Y(b.low)+44;if(by<4)by=Y(b.low)+44;if(by+h2>TH-2)by=Math.max(4,Y(b.high)-h2-14);
    cx.fillStyle='rgba(12,18,38,.96)';cx.fillRect(bx,by,w2,h2);cx.strokeStyle=u?UP:DN;cx.strokeRect(bx,by,w2,h2);cx.textAlign='left';cx.textBaseline='middle';
    T.forEach((t,k)=>{cx.fillStyle=k===0?(u?UP:DN):k===T.length-1?MUT:t[0]==='✓'?'#cfe9dc':t[0]==='✗'?'#f2b8bc':MUT;cx.fillText(t,bx+9,by+14+k*16)})};
  if(c&&c.x<PW&&c.y<TH){const i=Math.min(n-1,Math.max(0,Math.floor(c.x/bw))),g=S.sg.find(z=>z.i===st+i);if(g)card(g,W[i],X(i))}
  const hg=c&&c.x<PW&&c.y<TH&&I.sig?S.sg.find(z=>z.i===st+Math.min(n-1,Math.max(0,Math.floor(c.x/bw)))):null;if(hg)card(hg,W[hg.i-st],X(hg.i-st));
  $('ohlc').textContent=S.sym+' · '+S.tf+'   '+ft(sel.timestamp,true)+'   O '+f(sel.open)+'   H '+f(sel.high)+'   L '+f(sel.low)+'   C '+f(sel.close)+'   Vol '+Math.round(sel.volume||0).toLocaleString();
}
const zoom=k=>{S.n=Math.round(Math.max(15,Math.min(300,S.n*k)));draw()};
const P=new Map();let lx=0,pdist=0;
cv.onpointerdown=e=>{cv.setPointerCapture(e.pointerId);P.set(e.pointerId,e);lx=e.clientX;pdist=0;S.drag=0};
cv.onpointermove=e=>{const r=cv.getBoundingClientRect();S.cross={x:e.clientX-r.left,y:e.clientY-r.top};
  if(P.has(e.pointerId)){P.set(e.pointerId,e);
    if(P.size===2){const[a,b]=[...P.values()],d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);if(pdist)zoom(pdist/d);pdist=d;S.drag=1}
    else{const bw=(cv.clientWidth-72)/Math.min(S.n,S.bars.length||1),k=Math.trunc((e.clientX-lx)/bw);if(k){S.off+=k;lx+=k*bw;S.drag=1}}}
  draw()};
cv.onpointerup=cv.onpointercancel=e=>{P.delete(e.pointerId);pdist=0;if(e.pointerType==='touch')S.cross=null;draw()};
cv.onpointerleave=()=>{S.cross=null;draw()};
cv.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.15:1/1.15)},{passive:false});
$('zi').onclick=()=>zoom(1/1.25);$('zo').onclick=()=>zoom(1.25);$('zr').onclick=()=>{S.off=0;S.n=80;draw()};
addEventListener('resize',draw);
/* ---------- demo account ---------- */
const save=()=>sv('losai_demo_v1',A);
function exec(sym,sg,px,why){
  const p=A.pos[sym],F=fx(sym,px);let pnl=0;
  if(!p)A.pos[sym]={q:sg,avg:px,t:Date.now()};
  else if(Math.sign(p.q)===Math.sign(sg)){p.avg=(p.avg*Math.abs(p.q)+px*Math.abs(sg))/(Math.abs(p.q)+Math.abs(sg));p.q+=sg}
  else{const c=Math.min(Math.abs(p.q),Math.abs(sg));pnl=(px-p.avg)*Math.sign(p.q)*c*F;A.bal+=pnl;const r=p.q+sg;
    if(Math.abs(r)<1e-12)delete A.pos[sym];else if(Math.sign(r)===Math.sign(p.q))p.q=r;else A.pos[sym]={q:r,avg:px,t:Date.now()}}
  A.ord.unshift({t:Date.now(),sym,sg,px,pnl,why});A.ord.length=Math.min(A.ord.length,30);save();
}
function trade(side){
  const L=last();if(!L)return toast('Wait for market data to load first.');
  const q=+$('qty').value;if(!(q>0))return toast('Enter a quantity above 0.');
  const px=L.close,sg=side==='BUY'?q:-q,p=A.pos[S.sym],opening=!p||Math.sign(p.q)===Math.sign(sg);
  const sl=+$('sl').value||0,tp=+$('tp').value||0;
  if(opening){
    if(side==='BUY'&&((sl&&sl>=px)||(tp&&tp<=px)))return toast('For a BUY: stop loss must be below and take profit above the price.');
    if(side==='SELL'&&((sl&&sl<=px)||(tp&&tp>=px)))return toast('For a SELL: stop loss must be above and take profit below the price.');
    const [b]=S.sym.split('/');if(q*(b==='USD'?1:px)>Math.max(A.bal,1)*10)return toast('Demo limit: position size cannot exceed 10x your balance.');
  }
  exec(S.sym,sg,px,side);const np=A.pos[S.sym];if(np&&Math.sign(np.q)===Math.sign(sg)){np.sl=sl||null;np.tp=tp||null}
  toast(side+' '+q+' '+S.sym+' @ '+f(px));acct();draw();
}
function closeAll(){const p=A.pos[S.sym],L=last();if(!p)return toast('No open '+S.sym+' position to close.');exec(S.sym,-p.q,L.close,'CLOSE');toast('Closed '+S.sym+' @ '+f(L.close));acct();draw()}
function guard(){
  const p=A.pos[S.sym],L=last();if(!p)return;const b=S.bars.filter(x=>Date.parse(x.timestamp)>p.t),lo=Math.min(L.close,...b.map(x=>x.low)),hi=Math.max(L.close,...b.map(x=>x.high)),lg=p.q>0;let h=null;
  if(p.sl&&(lg?lo<=p.sl:hi>=p.sl))h=[p.sl,'STOP LOSS'];else if(p.tp&&(lg?hi>=p.tp:lo<=p.tp))h=[p.tp,'TAKE PROFIT'];
  if(h){exec(S.sym,-p.q,h[0],h[1]);toast(h[1]+' hit on '+S.sym+' @ '+f(h[0]))}
}
function acct(){
  const L=last();let eq=A.bal;for(const[s,p]of Object.entries(A.pos)){const px=LP[s]??p.avg;eq+=(px-p.avg)*Math.sign(p.q)*Math.abs(p.q)*fx(s,px)}
  const p=A.pos[S.sym];$('bal').textContent=usd(A.bal);$('eq').textContent=usd(eq);
  let u=0;if(p&&L)u=(L.close-p.avg)*Math.sign(p.q)*Math.abs(p.q)*fx(S.sym,L.close);
  $('pos').textContent=p?(p.q>0?'LONG ':'SHORT ')+Math.abs(p.q)+' @ '+f(p.avg):'FLAT';const e=$('upl');e.textContent=usd(u);e.className=u>0?'u':u<0?'d':'';
  const sl=+$('sl').value,q=+$('qty').value,r=$('risk');if(L&&sl&&q>0){const rk=Math.abs(L.close-sl)*q*fx(S.sym,L.close),pc=rk/Math.max(A.bal,1)*100;r.textContent=`Risk at stop: ${usd(rk)} (${pc.toFixed(1)}% of balance)`+(pc>2?'. Above the usual 1-2% guideline.':'');r.className='hint'+(pc>2?' w':'')}else r.textContent='';
  $('ord').innerHTML='';for(const o of A.ord.slice(0,8)){const li=document.createElement('li');li.textContent=`${new Date(o.t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} ${o.why} ${o.sym} ${f(o.px)}`+(o.pnl?` · P/L ${usd(o.pnl)}`:'');$('ord').append(li)}
}
/* ---------- confluence engine: a signal needs 4 of 6 checks to agree on a CLOSED candle ---------- */
const NM=['Trend','Momentum','MACD','Candle','Structure','Volume'];
const ema=(a,n)=>{const k=2/(n+1);let p=null;return a.map(v=>p=p==null?v:v*k+p*(1-k))};
function analyse(){
  const B=S.bars,n=B.length,old=S.sel;S.sg=[];S.stats=null;S.rs=[];
  if(n>=60){
    const c=B.map(b=>b.close),e12=ema(c,12),e26=ema(c,26),ml=c.map((_,i)=>e12[i]-e26[i]),s9=ema(ml,9),hs=ml.map((v,i)=>v-s9[i]),vl=B.map(b=>b.volume||0),hasV=vl.slice(-60).some(v=>v>0);
    const rs=[],at=[];let ag=0,al=0,a=0;
    for(let i=1;i<n;i++){const d=c[i]-c[i-1],tr=Math.max(B[i].high-B[i].low,Math.abs(B[i].high-c[i-1]),Math.abs(B[i].low-c[i-1]));
      if(i<=14){ag+=Math.max(d,0)/14;al+=Math.max(-d,0)/14;a+=tr/14}else{ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;a=(a*13+tr)/14}
      if(i>=14){rs[i]=al===0?100:100-100/(1+ag/al);at[i]=a}}
    let lg=-9,lD=0;
    for(let i=50;i<n-1;i++){
      const b=B[i],p=B[i-1],A=at[i],body=Math.abs(b.close-b.open),rg=(b.high-b.low)||1e-9,up=b.close>b.open,pb=Math.abs(p.close-p.open);
      const uw=b.high-Math.max(b.open,b.close),lw=Math.min(b.open,b.close)-b.low;let pat=0,pn='No candle pattern';
      if(up&&p.close<p.open&&b.close>=p.open&&b.open<=p.close&&body>pb){pat=1;pn='Bullish engulfing'}
      else if(!up&&p.close>p.open&&b.close<=p.open&&b.open>=p.close&&body>pb){pat=-1;pn='Bearish engulfing'}
      else if(lw>=2*body&&uw<=rg*.2){pat=1;pn='Hammer (rejects lower prices)'}
      else if(uw>=2*body&&lw<=rg*.2){pat=-1;pn='Shooting star (rejects higher prices)'}
      else if(body>=.65*rg&&body>=.9*A){pat=up?1:-1;pn=up?'Strong bullish candle':'Strong bearish candle'}
      const h10=Math.max(...B.slice(i-10,i).map(x=>x.high)),l10=Math.min(...B.slice(i-10,i).map(x=>x.low)),va=vl.slice(i-20,i).reduce((s,x)=>s+x,0)/20,vx=va>0?vl[i]/va:0;
      const v=[S.s20[i]>S.s50[i]&&c[i]>S.s20[i]?1:S.s20[i]<S.s50[i]&&c[i]<S.s20[i]?-1:0,
        rs[i]>52&&rs[i]<72?1:rs[i]<48&&rs[i]>28?-1:0,
        hs[i]>0&&hs[i]>hs[i-1]?1:hs[i]<0&&hs[i]<hs[i-1]?-1:0,
        pat,c[i]>h10?1:c[i]<l10?-1:0,(hasV&&vx>1.3)?(up?1:-1):0];
      const bu=v.filter(x=>x>0).length,be=v.filter(x=>x<0).length,d=bu>=4?1:be>=4?-1:0;
      if(!d||(d===lD&&i-lg<10))continue;lg=i;lD=d;
      const det=['SMA 20 '+f(S.s20[i])+' vs SMA 50 '+f(S.s50[i]),'RSI 14 = '+rs[i].toFixed(1)+(rs[i]>=72?' (overbought, not counted)':rs[i]<=28?' (oversold, not counted)':''),'Histogram '+(hs[i]>0?'+':'')+hs[i].toPrecision(2)+', '+(hs[i]>hs[i-1]?'rising':'falling'),pn,c[i]>h10?'Closed above 10-bar high '+f(h10):c[i]<l10?'Closed below 10-bar low '+f(l10):'Inside 10-bar range',hasV?'Volume '+vx.toFixed(1)+'x average':'No volume data'];
      S.sg.push({i,t:b.timestamp,d,v,det,cnt:d>0?bu:be,opp:d>0?be:bu,e:b.close,atr:A,sl:b.close-d*1.5*A,t1:b.close+d*2.25*A,t2:b.close+d*4.5*A,rsi:rs[i]});
    }
    let w=0,l=0;for(const g of S.sg){for(let j=g.i+1;j<Math.min(g.i+41,n);j++){const x=B[j],stop=g.d>0?x.low<=g.sl:x.high>=g.sl,tgt=g.d>0?x.high>=g.t1:x.low<=g.t1;if(stop){l++;break}if(tgt){w++;break}}}
    S.stats={w,l,n:S.sg.length};S.rs=rs;
  }
  structure();S.sel=S.sg.find(g=>old&&g.t===old.t)||S.sg[S.sg.length-1]||null;rIdea();
}
const sz=g=>{const risk=Math.abs(g.e-g.sl)*fx(S.sym,g.e),r=A.bal*(+$('rk').value||1)/100,u=risk>0?r/risk:0;return u>=100?Math.floor(u):u>=1?+u.toFixed(2):+u.toFixed(5)};
const dist=(g,p)=>{const x=Math.abs(p-g.e),pip=S.type==='forex'&&!S.sym.startsWith('XAU')?x/(S.sym.includes('JPY')?.01:.0001):0;return (x/g.e*100).toFixed(2)+'%'+(pip?' · '+pip.toFixed(1)+' pips':'')};
function rIdea(){
  const g=S.sel,n=S.bars.length,u=g&&g.d>0;
  $('sig').textContent=g?(u?'BUY':'SELL')+' · '+g.cnt+' of 6 checks agree':(n?'No confirmed signal':'Waiting for data…');$('sig').className='sig '+(g?(u?'BUY':'SELL'):'');
  $('chk').textContent='';$('plan').textContent='';
  if(g){NM.forEach((nm,k)=>{const li=document.createElement('li'),m=g.v[k]===g.d?'ok':g.v[k]?'no':'na',x=document.createElement('b'),y=document.createElement('span');li.className=m;x.textContent=(m==='ok'?'✓ ':m==='no'?'✗ ':'– ')+nm;y.textContent=g.det[k];li.append(x,y);$('chk').append(li)});
    for(const[a,b]of[['Entry (candle close)',f(g.e)],['Stop loss',f(g.sl)+'  ·  '+dist(g,g.sl)],['Target 1 (1.5R)',f(g.t1)+'  ·  '+dist(g,g.t1)],['Target 2 (3R)',f(g.t2)+'  ·  '+dist(g,g.t2)],['ATR 14',f(g.atr)],['Size at '+$('rk').value+'% risk',sz(g)+' units']]){const x=document.createElement('span'),y=document.createElement('b');x.textContent=a;y.textContent=b;$('plan').append(x,y)}}
  const k=g?n-1-g.i:0;
  $('st').textContent=g?(u?'▲ BUY ':'▼ SELL ')+g.cnt+'/6 · '+(k<=1?'last closed candle':k+' candles ago')+' · Entry '+f(g.e)+' · Stop '+f(g.sl)+' · Target '+f(g.t1):(n?'No candle has 4+ matching checks yet. Waiting for a clean setup.':'');
  $('st').className=g?(u?'u':'d'):'';
  const s=S.stats;$('bt').textContent=s?(s.w+s.l?'On these '+n+' candles: '+s.n+' signals, '+s.w+' reached Target 1 before the stop, '+s.l+' hit the stop first ('+Math.round(s.w/(s.w+s.l)*100)+'%). Small sample, not a promise.':'On these '+n+' candles: '+s.n+' signals, none resolved yet.'):'';
}
function useIdea(){const g=S.sel,L=last();if(!g||!L)return toast('No signal to use yet.');const c=L.close;
  if(g.d>0?(c<=g.sl||c>=g.t1):(c>=g.sl||c<=g.t1))return toast('Price has already passed the stop or target of this signal. Wait for a new one.');
  $('sl').value=f(g.sl);$('tp').value=f(g.t1);$('qty').value=sz(g);acct();toast('Ticket filled. Press '+(g.d>0?'BUY':'SELL')+' to enter.')}
function step(k){if(!S.sg.length)return toast('No signals on this chart yet.');let j=S.sg.findIndex(g=>S.sel&&g.t===S.sel.t)+k;j=Math.max(0,Math.min(S.sg.length-1,j));const g=S.sg[j];S.sel=g;S.off=Math.max(0,S.bars.length-g.i-Math.round(Math.min(S.n,S.bars.length)/2));rIdea();draw()}
/* ---------- controls ---------- */
function pick(s){
  s=String(s).trim().toUpperCase();if(!/^[A-Z0-9_.:\/-]{1,40}$/.test(s))return toast('That is not a valid symbol.');
  S.sym=s;S.type=S.tab==='stock'&&s.includes('/')?'forex':S.tab;S.bars=[];S.disp=null;S.off=0;S.err=0;S.stale=false;S.sg=[];S.sel=null;S.stats=null;
  $('hs').textContent=s;$('px').textContent=$('sp').textContent=$('bp').textContent='—';$('chg').textContent='';$('ohlc').textContent='';msg('Loading '+s+'…');stat();renderList();rIdea();acct();pull();
}
function renderList(){
  const q=$('q').value.trim().toUpperCase(),ul=$('ul');ul.textContent='';
  const rows=LIST[S.tab].filter(([s,n])=>!q||s.includes(q)||n.toUpperCase().includes(q));if(q&&!rows.some(r=>r[0]===q))rows.unshift([q,'Load this symbol']);
  for(const[s,n]of rows){const li=document.createElement('li');if(s===S.sym)li.className='on';const b=document.createElement('b'),sp=document.createElement('span');b.textContent=s;sp.textContent=n;li.append(b,sp);li.onclick=()=>pick(s);ul.append(li)}
}
for(const k of Object.keys(TF)){const b=document.createElement('button');b.textContent=k;if(k===S.tf)b.className='on';b.onclick=()=>{S.tf=k;S.bars=[];S.disp=null;S.off=0;S.err=0;[...$('tf').children].forEach(x=>x.className=x===b?'on':'');msg('Loading…');stat();pull()};$('tf').append(b)}
$('mk').onclick=e=>{const t=e.target.dataset?.t;if(!t)return;S.tab=t;[...$('mk').children].forEach(x=>x.className=x.dataset.t===t?'on':'');$('q').value='';renderList()};
$('q').oninput=renderList;$('q').onkeydown=e=>{if(e.key==='Enter'&&$('q').value.trim()){pick($('q').value);$('q').value='';renderList()}};
$('buy').onclick=()=>trade('BUY');$('sell').onclick=()=>trade('SELL');$('cls').onclick=closeAll;
$('lv').onclick=()=>{S.live=!S.live;$('lv').className=S.live?'on':'';if(S.live)pull();else{clearTimeout(S.timer);S.nextAt=0;stat()}};
$('rf').onclick=()=>{toast('Refreshing market data…');pull()};
$('use').onclick=$('use2').onclick=useIdea;$('pv').onclick=()=>step(-1);$('nx').onclick=()=>step(1);$('rk').onchange=rIdea;
cv.addEventListener('click',e=>{if(S.drag||!S.geo)return;const r=cv.getBoundingClientRect(),G=S.geo,x=e.clientX-r.left,y=e.clientY-r.top;if(x>G.PW||y>G.CH)return;
  const k=Math.min(S.bars.length-1,G.st+Math.floor(x/G.bw)),p=G.lo+(G.CH-y)/G.CH*(G.hi-G.lo),svd=()=>sv('losai_draw_v1',DR);
  if(S.tool==='h'){(DR[S.sym]=DR[S.sym]||[]).push({k:'h',p});svd();setTool(null);draw();return}
  if(S.tool==='t'){const t=S.bars[k].timestamp;if(!S.tmp){S.tmp={t,p};toast('Now tap the second point.')}else{(DR[S.sym]=DR[S.sym]||[]).push({k:'t',t1:S.tmp.t,p1:S.tmp.p,t2:t,p2:p});S.tmp=null;svd();setTool(null)}draw();return}
  if(!S.ind.sig)return;const g=S.sg.find(z=>Math.abs(z.i-k)<=1);if(g){S.sel=g;rIdea();draw()}});
function setTool(t){S.tool=t;S.tmp=null;$('d-h').className=t==='h'?'on':'';$('d-t').className=t==='t'?'on':'';cv.style.cursor=t?'copy':'crosshair';document.querySelectorAll('.pop').forEach(x=>x.classList.remove('on'));if(t)toast(t==='h'?'Tap the chart to place a horizontal line.':'Tap the first point of the trend line.')}
for(const[b,p]of[['b-ind','p-ind'],['b-pat','p-pat'],['b-drw','p-drw']])$(b).onclick=e=>{e.stopPropagation();const on=!$(p).classList.contains('on');document.querySelectorAll('.pop').forEach(x=>x.classList.remove('on'));if(on)$(p).classList.add('on')};
document.addEventListener('click',e=>{if(!e.target.closest('.pop'))document.querySelectorAll('.pop').forEach(x=>x.classList.remove('on'))});
for(const[id,key]of[['i-sma20','sma20'],['i-sma50','sma50'],['i-rsi','rsi'],['i-vol','vol'],['p-sig','sig'],['p-swing','swing'],['p-bos','bos']]){const e=$(id);e.checked=!!S.ind[key];e.onchange=()=>{S.ind[key]=e.checked?1:0;sv('losai_ind_v1',S.ind);draw()}}
$('d-h').onclick=()=>setTool(S.tool==='h'?null:'h');$('d-t').onclick=()=>setTool(S.tool==='t'?null:'t');$('d-c').onclick=()=>{DR[S.sym]=[];sv('losai_draw_v1',DR);draw();toast('Drawings cleared.');document.querySelectorAll('.pop').forEach(x=>x.classList.remove('on'))};
addEventListener('keydown',e=>{if(e.key==='Escape')setTool(null)});
$('rst').onclick=()=>{if(confirm('Reset the demo account to $10,000 and clear all positions and orders?')){A={bal:10000,pos:{},ord:[]};save();acct();draw();toast('Demo account reset.')}};
$('sl').oninput=$('qty').oninput=acct;
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.live)pull();else clearTimeout(S.timer)});
const tick=()=>{const d=new Date();$('clock').textContent=d.toLocaleTimeString([],{hour12:false})+' '+TZ;$('clock').title=d.toISOString().slice(0,16).replace('T',' ')+' UTC';
  let t=S.live?(S.nextAt?'Next refresh in '+Math.max(0,Math.round((S.nextAt-Date.now())/1000))+'s':''):'Live updates paused';
  if(intr()&&S.bars.length&&!S.stale){const ms=TF[S.tf][1]*60000,r=Math.floor((ms-Date.now()%ms)/1000);t+=(t?'  ·  ':'')+'Candle closes in '+Math.floor(r/60)+':'+String(r%60).padStart(2,'0')}
  $('next').textContent=t};tick();setInterval(tick,1000);
renderList();rIdea();acct();stat();pull();
