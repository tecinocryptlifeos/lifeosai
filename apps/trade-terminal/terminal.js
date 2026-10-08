'use strict';
const API='https://losai-edge-gateway.lifeostecinoai.workers.dev',$=i=>document.getElementById(i);
const LIST={stock:[['AAPL','Apple'],['MSFT','Microsoft'],['GOOGL','Alphabet (Google)'],['AMZN','Amazon'],['NVDA','NVIDIA'],['META','Meta'],['TSLA','Tesla'],['NFLX','Netflix'],['AMD','AMD'],['INTC','Intel'],['JPM','JPMorgan'],['V','Visa'],['DIS','Disney'],['BA','Boeing'],['KO','Coca-Cola'],['WMT','Walmart'],['XOM','Exxon Mobil'],['PYPL','PayPal'],['UBER','Uber'],['COIN','Coinbase']],
forex:[['EUR/USD','Euro / US Dollar'],['GBP/USD','Pound / US Dollar'],['USD/JPY','Dollar / Yen'],['AUD/USD','Aussie / US Dollar'],['USD/CAD','Dollar / Canadian'],['USD/CHF','Dollar / Franc'],['NZD/USD','Kiwi / US Dollar'],['USD/NGN','Dollar / Naira'],['USD/ZAR','Dollar / Rand'],['USD/CNY','Dollar / Yuan'],['USD/INR','Dollar / Rupee'],['XAU/USD','Gold / US Dollar']],
crypto:[['BTC/USD','Bitcoin'],['ETH/USD','Ethereum'],['SOL/USD','Solana'],['XRP/USD','XRP'],['BNB/USD','BNB'],['ADA/USD','Cardano'],['DOGE/USD','Dogecoin'],['AVAX/USD','Avalanche'],['LINK/USD','Chainlink'],['DOT/USD','Polkadot'],['LTC/USD','Litecoin'],['MATIC/USD','Polygon']]};
const TF={'1m':['1m',1],'5m':['5m',5],'15m':['15m',15],'30m':['30m',30],'1H':['1h',60],'1D':['1d',1440],'1W':['1wk',10080],'1M':['1mo',43200]};
const UP='#16c784',DN='#ea3943',MUT='#8a94a6',GRID='rgba(255,255,255,.06)';
const ld=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))||d}catch{return d}},sv=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
const S={tab:'crypto',type:'crypto',sym:'BTC/USD',tf:'5m',bars:[],n:80,off:0,live:true,disp:null,from:0,t0:0,raf:0,cross:null,err:0,req:0,timer:0,nextAt:0,stale:false,s20:[],s50:[],sig:null,quote:null,studies:{sma20:false,sma50:false,rsi:false,atr:false},patterns:{structure:false,levels:false,breaks:false},drawMode:null,drawings:[]};
let A=ld('losai_demo_v1',{bal:10000,pos:{},ord:[]}),H=ld('losai_sigs_v1',[]);const LP={};
const WAT='Africa/Lagos';
const EXCHANGE_TZ='America/New_York';
const intr=()=>TF[S.tf][1]<1440,last=()=>S.bars[S.bars.length-1];
const dp=p=>p>=100?2:p>=10?3:p>=1?4:6,f=v=>Number(v).toFixed(dp(Math.abs(v))),usd=v=>(v<0?'-':'')+'$'+Math.abs(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const ft=(ts,full)=>{const d=new Date(ts);const opts=intr()?(full?{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}:{hour:'2-digit',minute:'2-digit'}):{year:'numeric',month:'short',day:'numeric'};opts.timeZone=intr()?WAT:'UTC';return d.toLocaleString('en-NG',opts);};
const candleMs=()=>TF[S.tf][1]*60000;
const candleCloseAt=()=>{const L=last();if(!L||!intr())return 0;return Date.parse(L.timestamp)+candleMs();};
const refreshSeconds=()=>Math.max(5,Math.min(30,Math.round(TF[S.tf][1]/2)));
const fx=(s,px)=>{const[b,q]=s.split('/');return !q||q==='USD'?1:b==='USD'?1/px:1};
let tt=0;function toast(t){const e=$('toast');e.textContent=t;e.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>e.classList.remove('on'),3200)}
const msg=t=>{$('msg').textContent=t||''};
function sma(a,n){return a.map((_,i)=>i<n-1?null:a.slice(i-n+1,i+1).reduce((s,x)=>s+x,0)/n)}
/* ---------- data ---------- */
async function pull(){
  clearTimeout(S.timer);const id=++S.req;
  try{
    const r=await fetch(`${API}/api/market-data?type=${S.type}&symbol=${encodeURIComponent(S.sym)}&interval=${TF[S.tf][0]}&outputsize=300`,{cache:'no-store'});
    const j=await r.json().catch(()=>({}));if(id!==S.req)return;
    if(!r.ok||!j.ok||!j.bars||!j.bars.length)throw new Error(j.error||('HTTP '+r.status));
    S.err=0;if($('feed'))$('feed').textContent=(j.source||'MARKET DATA').toUpperCase();S.bars=j.bars.slice().sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));const L=last(),c=S.bars.map(b=>b.close);S.s20=sma(c,20);S.s50=sma(c,50);
    S.from=S.disp==null?L.close:S.disp;S.t0=performance.now();if(S.disp==null)S.disp=L.close;
    const prev=LP[S.sym];LP[S.sym]=L.close;
    const age=Date.now()-Date.parse(L.timestamp);S.stale=intr()&&age>Math.max(TF[S.tf][1]*2.5,15)*60000;
    try{S.quote=await quote();}catch{S.quote=null}syncMarketState(L,age);
    msg(S.stale?`Latest candle is delayed (${ft(L.timestamp,true)}).`:'');
    guard();head(prev);acct();runSig();if(!S.raf){S.raf=1;requestAnimationFrame(loop)}else draw();
  }catch(e){if(id!==S.req)return;S.err++;msg(S.bars.length?'Update failed ('+e.message+'). Retrying…':'Cannot load '+S.sym+': '+e.message+'. Retrying…');stat()}
  if(id!==S.req)return;stat();
  if(S.live&&!document.hidden){const d=S.err?Math.min(30*2**S.err,300):S.stale?300:refreshSeconds();S.nextAt=Date.now()+d*1000;S.timer=setTimeout(pull,d*1000)}else S.nextAt=0;
}
function loop(){const L=last();if(!L){S.raf=0;return}const t=Math.min(1,(performance.now()-S.t0)/700);S.disp=S.from+(L.close-S.from)*(1-Math.pow(1-t,3));draw();if(t<1)requestAnimationFrame(loop);else S.raf=0}
function syncMarketState(L,age){
  const name=$('marketName'),qa=$('quoteAge'),ms=$('marketState');
  if(name)name.textContent=S.sym;
  if(qa)qa.textContent=S.quote?'Live quote · '+ft(S.quote.timestamp,true):(!L?'Waiting for candle':S.stale?'Delayed · last candle '+ft(L.timestamp,true):'Latest candle · '+ft(L.timestamp,true));
  if(ms)ms.textContent=!L?'Market data connecting':S.quote?'Live quote · '+ft(S.quote.timestamp,true):S.stale?'Delayed market data · latest candle '+ft(L.timestamp,true):'Market data live · candle age '+Math.max(0,Math.round(age/1000))+'s';
}
function stat(){const e=$('stat');let c='stat',t='PAUSED';if(S.err&&!S.bars.length){t='OFFLINE';c+=' shut'}else if(!S.bars.length)t='CONNECTING';else if(S.stale){t='DELAYED';c+=' shut'}else if(S.live){t='LIVE';c+=' live'}e.className=c;e.textContent=t;const L=last(),age=L?Date.now()-Date.parse(L.timestamp):0;syncMarketState(L,age)}
function head(prev){
  const B=S.bars,L=last(),px=S.quote?.price??L.close;let ref;if(intr()){const d=L.timestamp.slice(0,10);ref=(B.find(b=>b.timestamp.slice(0,10)===d)||B[0]).open}else ref=(B[B.length-2]||L).close;
  $('hs').textContent=S.sym;const p=$('px');p.textContent=f(px);p.className='hp'+(prev==null||prev===px?'':px>prev?' u':' d');
  const d=px-ref,pc=d/ref*100;$('chg').textContent=(d>=0?'+':'')+f(d)+' ('+(d>=0?'+':'')+pc.toFixed(2)+'%)';$('chg').className='hc '+(d>=0?'u':'d');
  $('sp').textContent=$('bp').textContent=f(px);
}
async function quote(){const r=await fetch(`${API}/api/market-quote?type=${S.type}&symbol=${encodeURIComponent(S.sym)}`,{cache:'no-store'});const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok||!Number.isFinite(Number(j.price))||Number(j.price)<=0)throw new Error(j.error||('HTTP '+r.status));return {price:Number(j.price),timestamp:j.timestamp||new Date().toISOString(),source:j.source||'MARKET DATA'};}
/* ---------- chart ---------- */
function rsi14(B){if(B.length<15)return null;let g=0,l=0;for(let i=B.length-14;i<B.length;i++){const d=B[i].close-B[i-1].close;if(d>0)g+=d;else l-=d}return l===0?100:100-100/(1+g/l)}
function atr14(B){if(B.length<15)return null;let s=0;for(let i=B.length-14;i<B.length;i++)s+=Math.max(B[i].high-B[i].low,Math.abs(B[i].high-B[i-1].close),Math.abs(B[i].low-B[i-1].close));return s/14}
function swingPoints(B){const hi=[],lo=[];for(let i=2;i<B.length-2;i++){if(B[i].high>=B[i-1].high&&B[i].high>=B[i+1].high)hi.push({i,p:B[i].high});if(B[i].low<=B[i-1].low&&B[i].low<=B[i+1].low)lo.push({i,p:B[i].low})}return {hi:hi.slice(-8),lo:lo.slice(-8)}}
function drawLine(a,b,dash){cx.save();cx.strokeStyle='#9aa6bd';cx.lineWidth=1.5;cx.setLineDash(dash||[5,4]);cx.beginPath();cx.moveTo(a.x,a.y);cx.lineTo(b.x,b.y);cx.stroke();cx.restore()}

const cv=$('cv'),cx=cv.getContext('2d');
function draw(){
  const w=cv.clientWidth,h=cv.clientHeight,d=devicePixelRatio||1;if(!w||!h)return;
  if(cv.width!==Math.round(w*d)||cv.height!==Math.round(h*d)){cv.width=Math.round(w*d);cv.height=Math.round(h*d)}
  cx.setTransform(d,0,0,d,0,0);cx.clearRect(0,0,w,h);const B=S.bars;if(!B.length)return;
  const n=Math.min(S.n,B.length);S.off=Math.max(0,Math.min(S.off,B.length-n));
  const end=B.length-S.off,st=end-n,li=B.length-1,PW=w-72,TH=h-22,VH=Math.round(TH*.15),CH=TH-VH-8,bw=PW/n;
  const W=B.slice(st,end).map((b,i)=>st+i===li&&S.disp!=null?{...b,close:S.disp,high:Math.max(b.high,S.disp),low:Math.min(b.low,S.disp)}:b);
  let lo=Math.min(...W.map(b=>b.low)),hi=Math.max(...W.map(b=>b.high));const pd=(hi-lo||hi*.001)*.08;lo-=pd;hi+=pd;
  const Y=p=>CH-(p-lo)/(hi-lo)*CH,X=i=>i*bw+bw/2;
  cx.font='11px system-ui,sans-serif';cx.textBaseline='middle';cx.textAlign='left';
  for(let k=0;k<=4;k++){const p=lo+(hi-lo)*k/4,y=Y(p);cx.strokeStyle=GRID;cx.beginPath();cx.moveTo(0,y);cx.lineTo(PW,y);cx.stroke();cx.fillStyle=MUT;cx.fillText(p.toFixed(dp(p)),PW+6,y)}
  const stp=Math.max(1,Math.round(n/6));cx.textBaseline='alphabetic';cx.textAlign='center';cx.fillStyle=MUT;
  for(let i=Math.floor(stp/2);i<n;i+=stp)cx.fillText(ft(W[i].timestamp,intr()&&stp*bw>105),X(i),h-6);cx.textAlign='left';
  const vm=Math.max(...W.map(b=>b.volume||0))||1;
  W.forEach((b,i)=>{const x=X(i),c=b.close>=b.open?UP:DN;cx.strokeStyle=cx.fillStyle=c;cx.beginPath();cx.moveTo(x,Y(b.high));cx.lineTo(x,Y(b.low));cx.stroke();
    cx.fillRect(x-bw*.35,Y(Math.max(b.open,b.close)),Math.max(1,bw*.7),Math.max(1,Math.abs(Y(b.open)-Y(b.close))));
    if(b.volume){cx.globalAlpha=.35;const vh=b.volume/vm*VH;cx.fillRect(x-bw*.35,TH-vh,Math.max(1,bw*.7),vh);cx.globalAlpha=1}});
  if(S.studies.sma20)for(const[arr,col]of[[S.s20,'#f5a623']]){cx.strokeStyle=col;cx.lineWidth=1.2;cx.beginPath();let s=0;W.forEach((_,i)=>{const v=arr[st+i];if(v==null)return;s?cx.lineTo(X(i),Y(v)):(cx.moveTo(X(i),Y(v)),s=1)});cx.stroke()}if(S.studies.sma50)for(const[arr,col]of[[S.s50,'#4c8dff']]){cx.strokeStyle=col;cx.lineWidth=1.2;cx.beginPath();let s=0;W.forEach((_,i)=>{const v=arr[st+i];if(v==null)return;s?cx.lineTo(X(i),Y(v)):(cx.moveTo(X(i),Y(v)),s=1)});cx.stroke()}
const sw=swingPoints(B);if(S.patterns.levels){for(const z of [...sw.hi.slice(-3),...sw.lo.slice(-3)]){const y=Y(z.p);cx.strokeStyle='rgba(138,148,166,.45)';cx.setLineDash([2,4]);cx.beginPath();cx.moveTo(0,y);cx.lineTo(PW,y);cx.stroke();cx.setLineDash([])}}if(S.patterns.structure&&sw.hi.length>=2&&sw.lo.length>=2){const a=sw.lo.slice(-2),b=sw.hi.slice(-2);drawLine({x:X(a[0].i-st),y:Y(a[0].p)},{x:X(a[1].i-st),y:Y(a[1].p)});drawLine({x:X(b[0].i-st),y:Y(b[0].p)},{x:X(b[1].i-st),y:Y(b[1].p)})}if(S.patterns.breaks&&S.sig&&S.sig.break!=='NONE'){cx.fillStyle=S.sig.break.includes('BULLISH')?UP:DN;cx.font='700 11px system-ui';cx.fillText(S.sig.break,X(Math.max(0,n-14)),18)}for(const d of S.drawings){if(d.kind==='hline'){const y=Y(d.price);if(y>=0&&y<=CH)drawLine({x:0,y},{x:PW,y})}else{const x1=X(d.i1-st),x2=X(d.i2-st);if(x1>=-bw&&x2<=PW+bw)drawLine({x:x1,y:Y(d.p1)},{x:x2,y:Y(d.p2)})}}if(S.studies.rsi||S.studies.atr){const a=[];if(S.studies.rsi){const v=rsi14(B);if(v!=null)a.push('RSI 14 '+v.toFixed(1))}if(S.studies.atr){const v=atr14(B);if(v!=null)a.push('ATR 14 '+f(v))}$('indicatorReadout').textContent=a.join('  ·  ')}else $('indicatorReadout').textContent=''
  const line=(p,col,txt,da)=>{if(p<lo||p>hi)return;const y=Y(p);cx.setLineDash(da);cx.strokeStyle=col;cx.beginPath();cx.moveTo(0,y);cx.lineTo(PW,y);cx.stroke();cx.setLineDash([]);cx.fillStyle=col;cx.fillRect(PW,y-9,72,18);cx.fillStyle='#fff';cx.textBaseline='middle';cx.fillText(txt,PW+5,y)};
  const lb=B[li],lp=S.disp==null?lb.close:S.disp;line(lp,lp>=lb.open?UP:DN,f(lp),[4,3]);
  const po=A.pos[S.sym];if(po){line(po.avg,'#4c8dff',(po.q>0?'LONG ':'SHORT ')+f(po.avg),[6,4]);if(po.sl)line(po.sl,DN,'SL '+f(po.sl),[2,3]);if(po.tp)line(po.tp,UP,'TP '+f(po.tp),[2,3])}
  const c=S.cross;let sel=lb;
  if(c&&c.x<PW&&c.y<TH){const i=Math.min(n-1,Math.max(0,Math.floor(c.x/bw)));sel=W[i];cx.strokeStyle='rgba(255,255,255,.3)';cx.setLineDash([3,3]);cx.beginPath();cx.moveTo(X(i),0);cx.lineTo(X(i),TH);cx.moveTo(0,c.y);cx.lineTo(PW,c.y);cx.stroke();cx.setLineDash([]);
    if(c.y<CH){const p=lo+(CH-c.y)/CH*(hi-lo);cx.fillStyle='#2a3558';cx.fillRect(PW,c.y-9,72,18);cx.fillStyle='#fff';cx.textBaseline='middle';cx.fillText(p.toFixed(dp(p)),PW+5,c.y)}}
  $('ohlc').textContent=`${ft(sel.timestamp,true)}  O ${f(sel.open)}  H ${f(sel.high)}  L ${f(sel.low)}  C ${f(sel.close)}  Vol ${Math.round(sel.volume||0).toLocaleString()}`;
}
const zoom=(k,anchorX)=>{const oldN=Math.min(S.n,S.bars.length||1),oldOff=S.off,oldEnd=S.bars.length-oldOff,ratio=anchorX==null?.5:Math.max(0,Math.min(1,anchorX)),anchorIndex=Math.max(0,Math.min(S.bars.length-1,Math.floor((oldEnd-oldN)+ratio*oldN)));S.n=Math.round(Math.max(15,Math.min(300,S.n*k)));const newN=Math.min(S.n,S.bars.length||1),targetEnd=anchorIndex+Math.round((1-ratio)*newN);S.off=Math.max(0,Math.min(S.bars.length-newN,S.bars.length-targetEnd));draw()};
const P=new Map();let lx=0,pdist=0;
cv.onpointerdown=e=>{cv.setPointerCapture(e.pointerId);P.set(e.pointerId,e);lx=e.clientX;pdist=0};
cv.onpointermove=e=>{const r=cv.getBoundingClientRect();S.cross={x:e.clientX-r.left,y:e.clientY-r.top};
  if(P.has(e.pointerId)){P.set(e.pointerId,e);
    if(P.size===2){const[a,b]=[...P.values()],d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);if(pdist){const r=cv.getBoundingClientRect(),ax=((a.clientX+b.clientX)/2-r.left)/r.width;zoom(pdist/d,ax)}pdist=d}
    else{const bw=(cv.clientWidth-72)/Math.min(S.n,S.bars.length||1),k=Math.trunc((e.clientX-lx)/bw);if(k){S.off+=k;lx+=k*bw}}}
  draw()};
cv.onpointerup=cv.onpointercancel=e=>{if(e.type==='pointerup'&&S.drawMode&&P.size===1){const r=cv.getBoundingClientRect(),a={x:lx-r.left,y:e.clientY-r.top},b={x:e.clientX-r.left,y:e.clientY-r.top},n=Math.min(S.n,S.bars.length||1),bw=(cv.clientWidth-72)/Math.max(1,n),end=S.bars.length-S.off,st=end-n,ix=x=>st+Math.max(0,Math.min(n-1,Math.floor(x/bw))),price=y=>{const W=S.bars.slice(st,end),hi=Math.max(...W.map(b=>b.high)),lo=Math.min(...W.map(b=>b.low)),pd=(hi-lo||hi*.001)*.08,LL=lo-pd,HH=hi+pd,CH=(cv.clientHeight-22)*.85;return LL+(CH-y)/CH*(HH-LL)};const p1=price(a.y),p2=price(b.y);if(S.drawMode==='hline')S.drawings.push({kind:'hline',price:p1});else if(Math.abs(b.x-a.x)>8)S.drawings.push({kind:'trend',i1:ix(a.x),i2:ix(b.x),p1,p2});S.drawMode=null;$('trendTool').classList.remove('on');$('hlineTool').classList.remove('on')}P.delete(e.pointerId);pdist=0;if(e.pointerType==='touch')S.cross=null;draw()};
cv.onpointerleave=()=>{S.cross=null;draw()};
cv.addEventListener('wheel',e=>{e.preventDefault();const r=cv.getBoundingClientRect();zoom(e.deltaY>0?1.15:1/1.15,(e.clientX-r.left)/r.width)},{passive:false});
$('zi').onclick=()=>zoom(1/1.25,.5);$('zo').onclick=()=>zoom(1.25,.5);$('zr').onclick=()=>{S.off=0;S.n=80;draw()};
function togglePanel(which){const p=$('toolPanel');p.hidden=!p.hidden;['indicatorPanel','patternPanel','drawPanel'].forEach(id=>$(id).hidden=id!==which);['indBtn','patBtn','drawBtn'].forEach(id=>$(id).classList.toggle('active',id[0]===which[0]))}
$('indBtn').onclick=()=>togglePanel('indicator');$('patBtn').onclick=()=>togglePanel('pattern');$('drawBtn').onclick=()=>togglePanel('draw');
$('iSma20').onchange=e=>{S.studies.sma20=e.target.checked;draw()};$('iSma50').onchange=e=>{S.studies.sma50=e.target.checked;draw()};$('iRsi').onchange=e=>{S.studies.rsi=e.target.checked;draw()};$('iAtr').onchange=e=>{S.studies.atr=e.target.checked;draw()};$('pStructure').onchange=e=>{S.patterns.structure=e.target.checked;draw()};$('pLevels').onchange=e=>{S.patterns.levels=e.target.checked;draw()};$('pBreaks').onchange=e=>{S.patterns.breaks=e.target.checked;draw()};
$('trendTool').onclick=()=>{S.drawMode=S.drawMode==='trend'?null:'trend';$('trendTool').classList.toggle('on',S.drawMode==='trend');$('hlineTool').classList.remove('on')};$('hlineTool').onclick=()=>{S.drawMode=S.drawMode==='hline'?null:'hline';$('hlineTool').classList.toggle('on',S.drawMode==='hline');$('trendTool').classList.remove('on')};$('clearDraw').onclick=()=>{S.drawings=[];draw()};
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
  const px=S.quote?.price??L.close,sg=side==='BUY'?q:-q,p=A.pos[S.sym],opening=!p||Math.sign(p.q)===Math.sign(sg);
  const sl=+$('sl').value||0,tp=+$('tp').value||0;
  if(opening){
    if(side==='BUY'&&((sl&&sl>=px)||(tp&&tp<=px)))return toast('For a BUY: stop loss must be below and take profit above the price.');
    if(side==='SELL'&&((sl&&sl<=px)||(tp&&tp>=px)))return toast('For a SELL: stop loss must be above and take profit below the price.');
    const [b]=S.sym.split('/');if(q*(b==='USD'?1:px)>Math.max(A.bal,1)*10)return toast('Demo limit: position size cannot exceed 10x your balance.');
  }
  exec(S.sym,sg,px,side);const np=A.pos[S.sym];if(np&&Math.sign(np.q)===Math.sign(sg)){np.sl=sl||null;np.tp=tp||null}
  toast(side+' '+q+' '+S.sym+' @ '+f(px));acct();draw();
}
function closeAll(){const p=A.pos[S.sym],L=last();if(!p)return toast('No open '+S.sym+' position to close.');const px=S.quote?.price??L.close;exec(S.sym,-p.q,px,'CLOSE');toast('Closed '+S.sym+' @ '+f(px));acct();draw()}
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
/* ---------- signal ---------- */
function structureRead(B){
  const n=B.length;if(n<12)return {trend:'UNKNOWN',break:'NONE'};
  const highs=[],lows=[];
  for(let i=2;i<n-2;i++){if(B[i].high>=B[i-1].high&&B[i].high>=B[i+1].high)highs.push({i,p:B[i].high});if(B[i].low<=B[i-1].low&&B[i].low<=B[i+1].low)lows.push({i,p:B[i].low})}
  const H=highs.slice(-3),L=lows.slice(-3),lh=H.at(-1)?.p,ph=H.at(-2)?.p,ll=L.at(-1)?.p,pl=L.at(-2)?.p;
  const trend=lh>ph&&ll>pl?'BULLISH':lh<ph&&ll<pl?'BEARISH':'MIXED';
  const px=B.at(-1).close,brk=lh&&px>lh?'BULLISH BREAK':ll&&px<ll?'BEARISH BREAK':'NONE';
  return {trend,break:brk};
}
function runSig(){
  const B=S.bars;if(B.length<55){S.sig=null;return rSig()}
  const c=B.map(b=>b.close),L=c.length-1,s20=S.s20[L],s50=S.s50[L],st=structureRead(B);let g=0,l=0,atr=0;
  for(let i=L-13;i<=L;i++){const d=c[i]-c[i-1];d>0?g+=d:l-=d;atr+=Math.max(B[i].high-B[i].low,Math.abs(B[i].high-c[i-1]),Math.abs(B[i].low-c[i-1]))}
  atr/=14;const rsi=l===0?100:100-100/(1+g/l),why=[];let s=0;
  if(st.trend==='BULLISH'){s++;why.push('Market structure: higher highs / higher lows')}else if(st.trend==='BEARISH'){s--;why.push('Market structure: lower highs / lower lows')}else why.push('Market structure: mixed');
  if(st.break==='BULLISH BREAK'){s++;why.push('Bullish structure break')}else if(st.break==='BEARISH BREAK'){s--;why.push('Bearish structure break')}
  c[L]>s20?(s++,why.push('Price above SMA 20')):(s--,why.push('Price below SMA 20'));
  s20>s50?(s++,why.push('SMA 20 above SMA 50')):(s--,why.push('SMA 20 below SMA 50'));
  if(rsi>55){s++;why.push('RSI '+rsi.toFixed(0)+': bullish momentum')}else if(rsi<45){s--;why.push('RSI '+rsi.toFixed(0)+': bearish momentum')}else why.push('RSI '+rsi.toFixed(0)+': neutral');
  const dir=s>=3?'BUY':s<=-3?'SELL':'WAIT',k=dir==='SELL'?-1:1,px=c[L];
  S.sig={dir,why,px,sl:px-k*1.5*atr,tp:px+k*3*atr,structure:st.trend,break:st.break};
  const h=H.find(x=>x.sym===S.sym&&x.tf===S.tf);if(!h||h.dir!==dir){H.unshift({t:Date.now(),sym:S.sym,tf:S.tf,dir,px});H.length=Math.min(H.length,10);sv('losai_sigs_v1',H)}
  rSig();
}
function rSig(){
  const g=S.sig;$('sig').textContent=g?(g.dir==='WAIT'?'WAIT: no clear setup':g.dir):'Not enough candles yet';$('sig').className='sig '+(g?g.dir:'');
  $('why').innerHTML='';(g?g.why:[]).forEach(t=>{const li=document.createElement('li');li.textContent=t;$('why').append(li)});
  $('plan').innerHTML='';if(g&&g.dir!=='WAIT'){for(const[a,b]of[['Entry',f(g.px)],['Stop',f(g.sl)],['Target',f(g.tp)],['Reward : risk','2.0 : 1']]){const x=document.createElement('span');x.textContent=a;const y=document.createElement('b');y.textContent=b;$('plan').append(x,y)}}
  $('hist').innerHTML='';for(const h of H.slice(0,8)){const li=document.createElement('li');li.textContent=`${new Date(h.t).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})} ${h.sym} ${h.tf}: ${h.dir} @ ${f(h.px)}`;$('hist').append(li)}
}
/* ---------- controls ---------- */
function pick(s){
  s=String(s).trim().toUpperCase();if(!/^[A-Z0-9_.:\/-]{1,40}$/.test(s))return toast('That is not a valid symbol.');
  S.sym=s;S.type=S.tab==='stock'&&s.includes('/')?'forex':S.tab;S.bars=[];S.disp=null;S.off=0;S.err=0;S.stale=false;S.sig=null;
  $('hs').textContent=s;$('px').textContent=$('sp').textContent=$('bp').textContent='—';$('chg').textContent='';$('ohlc').textContent='';msg('Loading '+s+'…');stat();renderList();rSig();acct();pull();
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
$('use').onclick=()=>{if(!S.sig||S.sig.dir==='WAIT')return toast('No trade plan right now. The signal says wait.');$('sl').value=f(S.sig.sl);$('tp').value=f(S.sig.tp);toast('Stop and target filled. Press '+S.sig.dir+' to enter.');acct()};
$('rst').onclick=()=>{if(confirm('Reset the demo account to $10,000 and clear all positions and orders?')){A={bal:10000,pos:{},ord:[]};save();acct();draw();toast('Demo account reset.')}};
$('sl').oninput=$('qty').oninput=acct;
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.live)pull();else clearTimeout(S.timer)});
const tick=()=>{const d=new Date(),wat=d.toLocaleTimeString('en-NG',{timeZone:WAT,hour12:false}),utc=d.toISOString().slice(11,16);$('clock').textContent=wat+' WAT  ·  '+utc+' UTC';
  let t=S.live?(S.nextAt?'Next refresh in '+Math.max(0,Math.round((S.nextAt-Date.now())/1000))+'s':''):'Live updates paused';
  if(intr()&&S.bars.length&&!S.stale){const closeAt=candleCloseAt(),r=Math.max(0,Math.ceil((closeAt-Date.now())/1000));t+=(t?'  ·  ':'')+'Candle closes in '+Math.floor(r/60)+':'+String(r%60).padStart(2,'0');if(r===0&&S.live){t+='  ·  Updating';}}
  $('next').textContent=t};tick();setInterval(tick,1000);
renderList();rSig();acct();stat();pull();
