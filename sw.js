const VERSION="20260920113400";const CACHE="fitlog-"+VERSION;
const APP_SHELL=["index.html","./","manifest.webmanifest","icon.svg"];
const OFFLINE_HTML='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>FitLog · 离线</title><style>body{font-family:-apple-system,"PingFang SC",sans-serif;background:#0f1420;color:#e8edf5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}div{max-width:340px}.t{font-size:20px;font-weight:700;margin-bottom:12px}.d{font-size:14px;line-height:1.7;color:#9fb0c8}a{color:#5ec8ff}</style></head><body><div><div class="t">📴 当前离线</div><div class="d">你的训练数据都安全地存在本机。<br>连上网后重新打开本应用即可正常使用。<br><br>若此前在线打开过，可尝试先联网一次再离线使用。</div></div></body></html>';

/* 安装：逐个预缓存，单资源失败不连累整体 */
self.addEventListener("install",e=>{e.waitUntil((async()=>{
  const c=await caches.open(CACHE);
  await Promise.allSettled(APP_SHELL.map(u=>c.add(u).catch(()=>{})));
  await self.skipWaiting();
})());});

/* 激活：清旧缓存 + 立即接管页面 */
self.addEventListener("activate",e=>{e.waitUntil((async()=>{
  const ks=await caches.keys();
  await Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})());});

self.addEventListener("message",e=>{if(e.data==="SKIP_WAITING")self.skipWaiting();});

self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return; // 仅处理同源
  const nav=(e.request.mode==="navigate");
  if(nav){
    e.respondWith((async()=>{
      const c=await caches.open(CACHE);
      // 1) 缓存优先：冷启动离线也能秒出（根路径 ./ 或 index.html 任一命中）
      const hit=await c.match(e.request,{ignoreSearch:true})
        || await c.match("./") || await c.match("index.html") || await c.match("/index.html");
      // 2) 后台联网刷新缓存（在线时拿到最新版）
      try{
        const r=await fetch(e.request,{cache:"no-cache"});
        c.put(e.request,r.clone()).catch(()=>{});
        return r;
      }catch(_){
        // 3) 离线：返回已缓存的页面；实在没有则给一个离线提示页，绝不白屏
        return hit || new Response(OFFLINE_HTML,{headers:{"Content-Type":"text/html;charset=utf-8"}});
      }
    })());
    return;
  }
  // 静态资源：缓存优先 + 回源补缓存
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
    const cp=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});return resp;
  }).catch(()=>r)));
});
