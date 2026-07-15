/* LIFEOS_ADMIN_CHAT_VOICE_CONTROL_V2_0_6 */
const LIFEOS_RELEASE='lifeos-admin-chat-voice-control-v2.0.6-20260715';
self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(n=>Promise.all(n.map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{const q=e.request;if(q.method!=="GET")return;const u=new URL(q.url);if(u.origin!==self.location.origin)return;const fresh=q.mode==="navigate"||["document","style","script"].includes(q.destination);if(fresh)e.respondWith(fetch(q,{cache:"no-store"}));});
