(()=>{"use strict";
const state={client:null,session:null,config:null};
const $=id=>document.getElementById(id);
const device=()=>/android/i.test(navigator.userAgent)?"Android":/iphone|ipad/i.test(navigator.userAgent)?"iOS":"Desktop";
async function config(){const r=await fetch('/api/auth-config',{cache:'no-store'});state.config=await r.json();return state.config;}
async function token(){return state.session?.access_token||"";}
async function event(event_type,extra={}){try{const t=await token();if(!t)return;await fetch('/api/analytics-event',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+t},body:JSON.stringify({event_type,device_type:device(),browser:navigator.userAgent,...extra}),keepalive:true});}catch(e){console.warn('LifeOS analytics event failed',e)}}
function render(){const signed=!!state.session;document.body.classList.toggle('lifeos-signed-in',signed);$('authGate')?.toggleAttribute('hidden',signed);$('voiceApp')?.toggleAttribute('hidden',!signed);if($('userIdentity'))$('userIdentity').textContent=signed?(state.session.user.user_metadata?.full_name||state.session.user.email||'Signed in'):'';}
async function init(){const c=await config();if(!c.configured){$('authMessage').textContent='Account service setup is required by the owner.';return;}state.client=supabase.createClient(c.supabase_url,c.supabase_anon_key);const {data}=await state.client.auth.getSession();state.session=data.session;render();if(state.session)event('page_view');state.client.auth.onAuthStateChange(async(kind,session)=>{state.session=session;render();if(kind==='SIGNED_IN'){await event('sign_in');location.hash='voice';}if(kind==='SIGNED_OUT')location.reload();});}
async function emailSignIn(){const email=$('authEmail').value.trim();if(!email){$('authMessage').textContent='Enter your email address.';return;}$('authMessage').textContent='Sending secure sign-in link…';const {error}=await state.client.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+'/voice'}});$('authMessage').textContent=error?error.message:'Check your email and tap the secure sign-in link.';}
async function googleSignIn(){const {error}=await state.client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/voice'}});if(error)$('authMessage').textContent=error.message;}
async function signOut(){await event('sign_out');await state.client.auth.signOut();}
async function authFetch(url,options={}){const t=await token();options.headers={...(options.headers||{}),'Authorization':'Bearer '+t};return fetch(url,options)}
window.LifeOSAuth={init,event,authFetch,get session(){return state.session},get configured(){return !!state.config?.configured}};
document.addEventListener('DOMContentLoaded',()=>{init();$('emailSignIn')?.addEventListener('click',emailSignIn);$('googleSignIn')?.addEventListener('click',googleSignIn);$('signOut')?.addEventListener('click',signOut);});
})();