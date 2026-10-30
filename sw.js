// Service worker: guscio dell'app in cache (funziona senza rete), tessere delle mappe
// viste di recente, aggiornamento in sottofondo. Le chiamate alle API non vengono toccate.

const VERSIONE = "am-v2";
const CACHE_GUSCIO = `${VERSIONE}-guscio`;
const CACHE_TESSERE = `${VERSIONE}-tessere`;
const MAX_TESSERE = 500;

const GUSCIO = [
  "./", "index.html", "manifest.json", "css/app.css",
  "js/app.js", "js/geo.js", "js/potential.js", "js/epochs.js", "js/sources.js", "js/layers.js", "js/util.js",
  "js/rilievo-ui.js", "js/motore.js", "js/worker-rilievo.js", "js/analisi.js", "js/raster.js", "js/proj.js", "js/visual.js", "js/detect.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
];
const ESTERNI = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE_GUSCIO);
    await cache.addAll(GUSCIO);
    // Se la CDN non risponde, l'installazione non fallisce: la libreria verrà salvata al primo uso.
    await Promise.all(ESTERNI.map((u) => cache.add(new Request(u, { mode: "cors" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    for (const nome of await caches.keys()) {
      if (nome.startsWith("am-v") && !nome.startsWith(VERSIONE)) await caches.delete(nome);
    }
    await self.clients.claim();
  })());
});

const eTessera = (u) =>
  u.hostname === "tile.openstreetmap.org" ||
  u.hostname.endsWith(".tile.opentopomap.org") ||
  u.hostname === "server.arcgisonline.com";

async function limita(cache, max) {
  const chiavi = await cache.keys();
  for (let i = 0; i < chiavi.length - max; i++) await cache.delete(chiavi[i]);
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_GUSCIO);
  const salvata = await cache.match(req, { ignoreSearch: true });
  const rete = fetch(req)
    .then((r) => {
      if (r.ok) cache.put(req, r.clone());
      return r;
    })
    .catch(() => null);
  if (salvata) {
    rete.catch(() => {});
    return salvata;
  }
  return (await rete) || (req.mode === "navigate" ? await cache.match("index.html") : null) || Response.error();
}

async function primaLaCache(req, nomeCache, max) {
  const cache = await caches.open(nomeCache);
  const salvata = await cache.match(req);
  if (salvata) return salvata;
  try {
    const r = await fetch(req);
    if (r.ok && r.type !== "opaque") {
      cache.put(req, r.clone()).then(() => (max ? limita(cache, max) : null)).catch(() => {});
    }
    return r;
  } catch {
    return Response.error();
  }
}

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    ev.respondWith(staleWhileRevalidate(req));
  } else if (url.hostname === "unpkg.com") {
    ev.respondWith(primaLaCache(req, CACHE_GUSCIO));
  } else if (eTessera(url)) {
    ev.respondWith(primaLaCache(req, CACHE_TESSERE, MAX_TESSERE));
  }
});
