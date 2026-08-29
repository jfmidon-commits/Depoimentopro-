const CACHE='depoimentopro-v3';
const STATIC=['/','/login','/signup','/manifest.webmanifest','/icon-192.png','/icon-512.png','/pwa.js'];
const NEVER_CACHE=new Set(['/dashboard']);

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)).catch(()=>null));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/')) return;

  if(NEVER_CACHE.has(url.pathname)) {
    event.respondWith(fetch(req));
    return;
  }

  if(req.mode==='navigate'){
    const cacheableNavigation=STATIC.includes(url.pathname);
    event.respondWith(
      fetch(req).then(res=>{
        if(cacheableNavigation && res.ok){
          const copy=res.clone();
          caches.open(CACHE).then(c=>c.put(req,copy));
        }
        return res;
      }).catch(()=>cacheableNavigation ? caches.match(req).then(r=>r||caches.match('/')) : caches.match('/'))
    );
    return;
  }

  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{
    if(res.ok){
      const copy=res.clone();
      caches.open(CACHE).then(c=>c.put(req,copy));
    }
    return res;
  })));
});
