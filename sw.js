if(!self.define){let e,i={};const s=(s,n)=>(s=new URL(s+".js",n).href,i[s]||new Promise((i=>{if("document"in self){const e=document.createElement("script");e.src=s,e.onload=i,document.head.appendChild(e)}else e=s,importScripts(s),i()})).then((()=>{let e=i[s];if(!e)throw new Error(`Module ${s} didn’t register its module`);return e})));self.define=(n,r)=>{const o=e||("document"in self?document.currentScript.src:"")||location.href;if(i[o])return;let t={};const c=e=>s(e,o),d={module:{uri:o},exports:t,require:c};i[o]=Promise.all(n.map((e=>d[e]||c(e)))).then((e=>(r(...e),t)))}}define(["./workbox-9517df1b"],(function(e){"use strict";self.skipWaiting(),e.clientsClaim(),e.precacheAndRoute([{url:"assets/index-33b05e78.css",revision:null},{url:"assets/index-61f942c6.js",revision:null},{url:"assets/workbox-window.prod.es5-08b2315b.js",revision:null},{url:"index.html",revision:"72ee3e4194ef065eba2fd89b14a96882"},{url:"favicon.ico",revision:"1ba2ae710d927f13d483fd5d1e548c9b"},{url:"pwa-192x192.png",revision:"af32f6933f77250ea90ad9e124538479"},{url:"pwa-512x512.png",revision:"bbc33d27fc08601c197e7c87197d7dde"},{url:"manifest.webmanifest",revision:"51e5ebbc50e7dfe41f321cbccb0cc3cd"}],{}),e.cleanupOutdatedCaches(),e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("index.html")))}));
