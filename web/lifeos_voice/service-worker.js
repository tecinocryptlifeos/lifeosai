/* LIFEOS_COST_FREE_GROWTH_READINESS_V2_0_5 */
const LIFEOS_RELEASE='lifeos-cost-free-growth-readiness-v2.0.5-20260715';
self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(n=>Promise.all(n.map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{const q=e.request;if(q.method!=="GET")return;const u=new URL(q.url);if(u.origin!==self.location.origin)return;const fresh=q.mode==="navigate"||["document","style","script"].includes(q.destination);if(fresh)e.respondWith(fetch(q,{cache:"no-store"}));});
