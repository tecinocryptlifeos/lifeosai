(()=>{"use strict";
const state={client:null,session:null,config:null,ready:false};
const $=id=>document.getElementById(id);
const device=()=>/android/i.test(navigator.userAgent)?"Android":/iphone|ipad/i.test(navigator.userAgent)?"iOS":"Desktop";
const setMessage=(text,kind="")=>{const el=$("authMessage");if(!el)return;el.textContent=text;el.dataset.kind=kind;};
function show(el,visible){if(el)el.hidden=!visible;}
async function loadConfig(){const r=await fetch('/api/auth-config',{cache:'no-store'});if(!r.ok)throw new Error('Account configuration endpoint is unavailable.');state.config=await r.json();return state.config;}
async function token(){return state.session?.access_token||"";}
async function event(event_type,extra={}){try{const t=await token();if(!t)return;await fetch('/api/analytics-event',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+t},body:JSON.stringify({event_type,device_type:device(),browser:navigator.userAgent,...extra}),keepalive:true});}catch(e){console.warn('LifeOS analytics event failed',e)}}
function render(){
 const signed=!!state.session;
 const configured=!!state.config?.configured;
 const required=!!state.config?.auth_required;
 document.body.classList.toggle('lifeos-signed-in',signed);
 document.body.classList.toggle('lifeos-auth-configured',configured);
 show($('authGate'),!signed);
 show($('voiceApp'),signed||!configured||!required);
 if($('userIdentity'))$('userIdentity').textContent=signed?(state.session.user.user_metadata?.full_name||state.session.user.email||'Signed in'):'';
 if($('signOut'))show($('signOut'),signed);
 const email=$('authEmail'), emailBtn=$('emailSignIn'), googleBtn=$('googleSignIn');
 if(email)email.disabled=!configured;
 if(emailBtn)emailBtn.disabled=!configured;
 if(googleBtn){googleBtn.disabled=!configured||!state.config?.google_enabled;show(googleBtn,configured&&!!state.config?.google_enabled);}
 const badge=$('authStatusBadge');
 if(badge){badge.textContent=signed?'SIGNED IN':configured?'SIGN-IN READY':'OWNER SETUP REQUIRED';badge.dataset.state=signed?'ok':configured?'ready':'warning';}
 if(!configured){setMessage('The account interface is installed. The owner must connect Supabase in Render before public sign-in can operate. Live Voice remains available during setup.','warning');}
 else if(!signed){setMessage('Sign in securely with email or Google to use and track LifeOS Voice.','ready');}
}
async function init(){
 try{
  const c=await loadConfig();
  if(c.configured){
   if(!window.supabase?.createClient)throw new Error('The secure sign-in library did not load. Refresh the page or check the network.');
   state.client=window.supabase.createClient(c.supabase_url,c.supabase_anon_key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
   const {data,error}=await state.client.auth.getSession();if(error)throw error;state.session=data.session;
   state.client.auth.onAuthStateChange(async(kind,session)=>{state.session=session;render();if(kind==='SIGNED_IN'){await event('sign_in');history.replaceState(null,'',location.pathname);}if(kind==='SIGNED_OUT'){state.session=null;render();}});
  }
  state.ready=true;render();if(state.session)event('page_view');
 }catch(e){state.ready=true;state.config=state.config||{configured:false,auth_required:false};render();setMessage(e.message||'Account system could not initialize.','error');console.error(e);}
}
async function emailSignIn(){if(!state.client){setMessage('Owner setup is required before email sign-in can work.','warning');return;}const email=$('authEmail').value.trim();if(!email){setMessage('Enter your email address.','error');return;}setMessage('Sending secure sign-in link…','ready');const {error}=await state.client.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+'/voice'}});setMessage(error?error.message:'Check your email and tap the secure sign-in link.',error?'error':'ok');}
async function googleSignIn(){if(!state.client){setMessage('Owner setup is required before Google sign-in can work.','warning');return;}const {error}=await state.client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/voice'}});if(error)setMessage(error.message,'error');}
async function signOut(){if(!state.client)return;await event('sign_out');await state.client.auth.signOut();}
async function authFetch(url,options={}){const t=await token();options.headers={...(options.headers||{}),...(t?{'Authorization':'Bearer '+t}:{})};return fetch(url,options)}
window.LifeOSAuth={init,event,authFetch,get session(){return state.session},get config(){return state.config},get configured(){return !!state.config?.configured},get ready(){return state.ready}};
document.addEventListener('DOMContentLoaded',()=>{init();$('emailSignIn')?.addEventListener('click',emailSignIn);$('googleSignIn')?.addEventListener('click',googleSignIn);$('signOut')?.addEventListener('click',signOut);});
})();
