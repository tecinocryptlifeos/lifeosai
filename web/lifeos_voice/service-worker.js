/* LIFEOS_PUBLIC_MOBILE_PWA_V2_0_4 */
const LIFEOS_RELEASE='lifeos-premium-public-mobile-v2.0.4-20260714';
self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(n=>Promise.all(n.map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{const q=e.request;if(q.method!=="GET")return;const u=new URL(q.url);if(u.origin!==self.location.origin)return;const fresh=q.mode==="navigate"||["document","style","script"].includes(q.destination);if(fresh)e.respondWith(fetch(q,{cache:"no-store"}));});
