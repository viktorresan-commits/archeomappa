// Vista 3D del terreno (MapLibre GL JS), caricata solo al tocco del pulsante «3D».
// Quote: TINITALY 10 m (INGV) ricampionate sulla tessera, con tessera mondiale dove manca il dato.
// Sopra: satellite o altra mappa di base, ombreggiatura calcolata dalle stesse quote, edifici di OpenStreetMap con la loro altezza,
// e, dove raggiungibile (app Android o proxy), l'immagine LiDAR del Ministero. Non è una ricostruzione fotogrammetrica:
// i palazzi sono blocchi e le quote hanno il passo del modello (10 m).

import {
  ErroreDem, PIXEL_TESSERA, componiTessera, codificaTerrarium, decodificaTerrarium, leggiGeoTiff, qualeFonte, urlTerrarium, urlWcsTinitaly,
} from "./dem.js";
import {
  BASI_3D, ESAGERAZIONI, PROTOCOLLO_DEM, PROTOCOLLO_LIDAR, base3dDa2d, costruisciStile, leggiZxy, testoQuota, urlTesseraLidar, zoomLeaflet, zoomMapLibre,
} from "./stile3d.js";
import { clienteNativo, scaricaTessera } from "./tessere.js";
import { h } from "./util.js";

const TEMPO_MAX_MS = 25000;
const CACHE_DEM = "am-dem-v1";
const MAX_IN_CACHE = 160;
const PNG_VUOTO = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmNgYGBgAAAABQABGWkDzwAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)); // 1×1 trasparente

/**
 * Conteggio delle tessere di quota per fonte, per dire all'utente da dove vengono le altezze:
 * tinitaly = 10 m intero; misto = 10 m con qualche pixel mancante colmato; lontane = tessere lontane o fuori Italia (mondiali per scelta);
 * ripiego = TINITALY non ha risposto e si è ripiegato sulle mondiali; errori = nessuna quota.
 */
export const statoQuote = { tinitaly: 0, misto: 0, lontane: 0, ripiego: 0, errori: 0 };
let lidarCorrente = null;
let protocolliRegistrati = false;

// ------------------------------------------------------------------------------ rete e immagini

async function scarica(url, segnale, opzioni = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opzioni.timeoutMs ?? TEMPO_MAX_MS);
  const ferma = () => ctrl.abort();
  segnale?.addEventListener?.("abort", ferma);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.arrayBuffer();
  } finally {
    clearTimeout(timer);
    segnale?.removeEventListener?.("abort", ferma);
  }
}

const nuovaTela = (w, h_) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h_) : Object.assign(document.createElement("canvas"), { width: w, height: h_ }));

async function pngInQuote(ab) {
  const bmp = await createImageBitmap(new Blob([ab], { type: "image/png" }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const tela = nuovaTela(bmp.width, bmp.height), g = tela.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const dati = g.getImageData(0, 0, bmp.width, bmp.height).data;
  bmp.close?.();
  return { quote: decodificaTerrarium(dati), lato: bmp.width };
}

async function quoteInPng(quote, lato) {
  const tela = nuovaTela(lato, lato), g = tela.getContext("2d");
  const img = g.createImageData(lato, lato);
  img.data.set(codificaTerrarium(quote));
  g.putImageData(img, 0, 0);
  const blob = tela.convertToBlob ? await tela.convertToBlob({ type: "image/png" }) : await new Promise((ok) => tela.toBlob(ok, "image/png"));
  return await blob.arrayBuffer();
}

async function dallaCache(chiave) {
  try {
    const c = await caches.open(CACHE_DEM);
    const r = await c.match(chiave);
    return r ? await r.arrayBuffer() : null;
  } catch { return null; }
}

async function inCache(chiave, ab) {
  try {
    const c = await caches.open(CACHE_DEM);
    await c.put(chiave, new Response(ab, { headers: { "content-type": "image/png" } }));
    const chiavi = await c.keys();
    for (let i = 0; i < chiavi.length - MAX_IN_CACHE; i++) await c.delete(chiavi[i]);
  } catch { /* la cache è un di più */ }
}

// ------------------------------------------------------------------------------ protocolli di MapLibre

/** Tessera di quote «Terrarium» per MapLibre: TINITALY (se in Italia e abbastanza vicina) completato dalla tessera mondiale. */
export async function tesseraQuote({ z, x, y }, segnale) {
  const chiaveCache = `https://am.locale/dem/v1/${z}/${x}/${y}.png`;
  const mondiale = () => scarica(urlTerrarium(z, x, y), segnale);
  if (qualeFonte(z, x, y) === "terrarium") {
    statoQuote.lontane++;
    return await mondiale();
  }
  const salvata = await dallaCache(chiaveCache);
  if (salvata) { statoQuote.tinitaly++; return salvata; }
  const [tinitaly, rip] = await Promise.allSettled([scarica(urlWcsTinitaly(z, x, y), segnale), mondiale()]);
  let mond = null;
  if (rip.status === "fulfilled") { try { mond = { ...(await pngInQuote(rip.value)), grezzo: rip.value }; } catch { mond = null; } }
  try {
    if (tinitaly.status !== "fulfilled") throw tinitaly.reason;
    const tiff = leggiGeoTiff(tinitaly.value);
    const t = componiTessera({ tiff, z, x, y, ripiego: mond?.quote ?? null, ripiegoLato: mond?.lato ?? 0 });
    if (t.fonte === "terrarium") { if (!mond) throw new ErroreDem("nessuna quota"); statoQuote.lontane++; return mond.grezzo; } // mare o estero: TINITALY non ha dati
    const png = await quoteInPng(t.quote, t.w);
    statoQuote[t.fonte]++;
    await inCache(chiaveCache, png);
    return png;
  } catch (e) {
    if (segnale?.aborted) throw e;
    if (mond) { statoQuote.ripiego++; return mond.grezzo; } // il servizio di TINITALY non ha risposto: si ripiega sulle quote mondiali
    statoQuote.errori++;
    throw e;
  }
}

/** Tessera LiDAR del Ministero: dall'app Android con il client nativo (il servizio è in http), altrove con fetch se raggiungibile. */
async function tesseraLidar({ z, x, y }, segnale) {
  const def = lidarCorrente;
  if (!def) return PNG_VUOTO.buffer.slice(0);
  const url = urlTesseraLidar(def, z, x, y);
  const nativo = clienteNativo();
  try {
    if (nativo) {
      const r = await scaricaTessera(nativo, url);
      if (!r.src) return PNG_VUOTO.buffer.slice(0);
      const bin = atob(r.src.slice(r.src.indexOf(",") + 1));
      return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
    }
    return await scarica(url, segnale, { timeoutMs: 20000 });
  } catch (e) {
    if (segnale?.aborted) throw e;
    return PNG_VUOTO.buffer.slice(0);
  }
}

// ------------------------------------------------------------------------------ libreria

let promessaLibreria = null;
export function caricaMapLibre(doc = document) {
  if (globalThis.maplibregl) return Promise.resolve(globalThis.maplibregl);
  promessaLibreria ??= new Promise((ok, ko) => {
    const css = doc.createElement("link");
    css.rel = "stylesheet";
    css.href = new URL("vendor/maplibre/maplibre-gl.css", doc.baseURI).href;
    doc.head.append(css);
    const s = doc.createElement("script");
    s.src = new URL("vendor/maplibre/maplibre-gl.js", doc.baseURI).href;
    s.onload = () => (globalThis.maplibregl ? ok(globalThis.maplibregl) : ko(new Error("libreria 3D non avviata")));
    s.onerror = () => { promessaLibreria = null; ko(new Error("libreria 3D non raggiungibile: serve la rete la prima volta")); };
    doc.head.append(s);
  });
  return promessaLibreria;
}

export const haWebGL2 = () => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } };

// ------------------------------------------------------------------------------ interfaccia

let aperta = null; // {mappa, chiudi}

/**
 * Apre la vista 3D a schermo intero sopra l'app.
 * opzioni: {centro: [lat, lon], zoom (Leaflet), base (id della base 2D), ombre, lidar: {url, livelli, versione}|null, bearing, inclinazione (gradi, 62),
 *           alChiudere({lat, lon, zoom (Leaflet)}), toast(msg)}
 */
export async function apriVista3D(opzioni) {
  if (aperta) return aperta;
  const { centro, zoom = 14, base = "sat", ombre = true, lidar = null, bearing = 0, inclinazione = 62, alChiudere = () => {}, toast = () => {}, radice = document.body } = opzioni;
  if (!haWebGL2()) { toast("Questo dispositivo non supporta il 3D (serve WebGL 2)."); return null; }
  const velo = h("div", { class: "vista3d", role: "dialog", "aria-modal": "true", "aria-label": "Vista 3D del terreno" });
  const stato = h("span", { class: "stato3d", role: "status", "aria-live": "polite" }, "Carico la vista 3D…");
  const btnChiudi = h("button", { type: "button", class: "chip chiudi3d", "aria-label": "Chiudi la vista 3D" }, "✕ Chiudi 3D");
  const contenitore = h("div", { class: "mappa3d" });
  const barra = h("header", { class: "barra3d" }, btnChiudi, stato);
  const pannello = h("div", { class: "comandi3d", role: "toolbar", "aria-label": "Comandi della vista 3D" });
  contenitore.append(barra);
  velo.append(contenitore, pannello);
  radice.append(velo);
  btnChiudi.focus();

  let mappa = null, chiusa = false;
  let voceCronologia = false;
  const alIndietro = () => { voceCronologia = false; chiudi(); };
  let ml;
  try {
    ml = await caricaMapLibre();
  } catch (e) {
    velo.remove();
    toast(e.message);
    return null;
  }
  if (!protocolliRegistrati) {
    ml.addProtocol(PROTOCOLLO_DEM, async (p, ctrl) => ({ data: await tesseraQuote(leggiZxy(p.url), ctrl?.signal) }));
    ml.addProtocol(PROTOCOLLO_LIDAR, async (p, ctrl) => ({ data: await tesseraLidar(leggiZxy(p.url), ctrl?.signal) }));
    protocolliRegistrati = true;
  }
  lidarCorrente = lidar;
  for (const k of Object.keys(statoQuote)) statoQuote[k] = 0;

  const st = { base: base3dDa2d(base), ombre, edifici: true, lidar: !!lidar, esagerazione: 1 };
  const annulla = (msg) => { velo.remove(); toast(msg); return null; };
  try {
  mappa = new ml.Map({
    container: contenitore,
    style: costruisciStile(st),
    center: [centro[1], centro[0]],
    zoom: Math.max(8, Math.min(16.5, zoomMapLibre(zoom))),
    pitch: Math.max(0, Math.min(85, Number(inclinazione) || 62)), bearing, maxPitch: 85, minZoom: 5, maxZoom: 19,
    maxParallelImageRequests: 8,
    attributionControl: false,
    canvasContextAttributes: { antialias: true },
  });
  } catch (e) {
    return annulla(`La vista 3D non parte su questo dispositivo: ${e?.message ?? "errore di grafica"}`);
  }
  // Il tasto Indietro (Android) chiude la vista invece di uscire dall'app: la vista occupa una voce della cronologia.
  try { history.pushState({ vista3d: true }, ""); voceCronologia = true; } catch { /* cronologia non disponibile */ }
  window.addEventListener("popstate", alIndietro);
  const attribuzione = new ml.AttributionControl({ compact: true });
  mappa.addControl(attribuzione, "bottom-right");
  // le fonti restano nel pulsante «i» (obbligatorie), ma non coprono la mappa all'apertura
  const chiudiAttribuzione = () => { const el = attribuzione._container; el?.classList.remove("maplibregl-compact-show"); el?.removeAttribute("open"); };
  mappa.once("load", chiudiAttribuzione);
  setTimeout(chiudiAttribuzione, 300);
  mappa.addControl(new ml.NavigationControl({ visualizePitch: true, showZoom: true }), "top-right");
  mappa.addControl(new ml.ScaleControl({ unit: "metric" }), "bottom-left");

  // ---- comandi
  const gruppi = [];
  const chip = (testo, titolo, onclick, premuto) => h("button", { type: "button", class: "chip", title: titolo, "aria-label": titolo, "aria-pressed": premuto == null ? null : String(!!premuto), onclick }, testo);
  const imposta = (el, v) => el.setAttribute("aria-pressed", String(!!v));
  const bottoniBase = BASI_3D.map((b) => chip(b.nome, `Mappa di base: ${b.nome}`, () => {
    st.base = b.id;
    for (const x of BASI_3D) mappa.setLayoutProperty(`base-${x.id}`, "visibility", x.id === b.id ? "visible" : "none");
    bottoniBase.forEach((el, i) => imposta(el, BASI_3D[i].id === b.id));
  }, b.id === st.base));
  const bOmbre = chip("Ombre", "Ombreggiatura calcolata dalle quote del terreno", () => {
    st.ombre = !st.ombre; mappa.setLayoutProperty("ombre", "visibility", st.ombre ? "visible" : "none"); imposta(bOmbre, st.ombre);
  }, st.ombre);
  const bEdifici = chip("Edifici", "Edifici di OpenStreetMap con la loro altezza (blocchi, non fotogrammetria)", () => {
    st.edifici = !st.edifici; mappa.setLayoutProperty("edifici", "visibility", st.edifici ? "visible" : "none"); imposta(bEdifici, st.edifici);
  }, st.edifici);
  const bLidar = lidar ? chip("LiDAR", "Immagine LiDAR del Ministero sopra il rilievo (dove c'è)", () => {
    st.lidar = !st.lidar; mappa.setLayoutProperty("lidar", "visibility", st.lidar ? "visible" : "none"); imposta(bLidar, st.lidar);
  }, st.lidar) : null;
  const bottoniAltezze = ESAGERAZIONI.map((e) => chip(`×${String(e).replace(".", ",")}`, e === 1 ? "Altezze reali, senza esagerazione" : `Altezze esagerate ${e} volte`, () => {
    st.esagerazione = e; mappa.setTerrain({ source: "dem", exaggeration: e });
    bottoniAltezze.forEach((el, i) => imposta(el, ESAGERAZIONI[i] === e)); aggiornaQuotaCentro();
  }, e === st.esagerazione));
  const bAlto = chip("Dall'alto", "Guarda il terreno dall'alto (pianta)", () => mappa.easeTo({ pitch: 0, bearing: 0, duration: 600 }));
  const bInclina = chip("Inclina", "Guarda il terreno di sbieco", () => mappa.easeTo({ pitch: 68, duration: 600 }));
  pannello.append(
    h("div", { class: "gruppo3d" }, h("span", { class: "etichetta3d" }, "Mappa"), ...bottoniBase),
    h("div", { class: "gruppo3d" }, h("span", { class: "etichetta3d" }, "Livelli"), bOmbre, bEdifici, ...(bLidar ? [bLidar] : [])),
    h("div", { class: "gruppo3d" }, h("span", { class: "etichetta3d" }, "Altezze"), ...bottoniAltezze),
    h("div", { class: "gruppo3d" }, h("span", { class: "etichetta3d" }, "Vista"), bAlto, bInclina),
  );

  // ---- quota letta dal terreno
  const quotaPunto = (lngLat) => {
    const q = mappa.queryTerrainElevation(lngLat);
    return testoQuota(q, st.esagerazione);
  };
  let testoFonte = "";
  const descriviFonte = () => {
    const { tinitaly, misto, ripiego, errori } = statoQuote;
    const buone = tinitaly + misto;
    const parti = [];
    if (buone) parti.push(`quote TINITALY 10 m (${buone} tessere)`);
    if (ripiego) parti.push(`${ripiego} a ~30 m: TINITALY non ha risposto`);
    if (errori) parti.push(`${errori} senza quote`);
    return parti.join(" · ");
  };
  function aggiornaQuotaCentro() {
    if (chiusa || !mappa) return;
    const c = mappa.getCenter();
    testoFonte = descriviFonte();
    stato.textContent = `Centro: ${quotaPunto(c)} · inclinazione ${Math.round(mappa.getPitch())}°${testoFonte ? ` · ${testoFonte}` : ""}`;
  }
  mappa.on("moveend", aggiornaQuotaCentro);
  mappa.on("idle", aggiornaQuotaCentro);
  mappa.on("click", (e) => {
    const q = quotaPunto(e.lngLat);
    new ml.Popup({ closeButton: true, maxWidth: "240px" })
      .setLngLat(e.lngLat)
      .setDOMContent(h("div", { class: "popup3d" }, h("strong", null, q), h("br"), `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`))
      .addTo(mappa);
  });
  mappa.on("error", (ev) => {
    const msg = String(ev?.error?.message ?? "");
    if (/Failed to fetch|NetworkError|HTTP|AJAXError|Load failed/i.test(msg)) stato.dataset.errore = "rete";
  });

  // ---- chiusura
  const chiudi = () => {
    if (chiusa) return;
    chiusa = true;
    document.removeEventListener("keydown", tasto);
    window.removeEventListener("popstate", alIndietro);
    if (voceCronologia) { voceCronologia = false; try { history.back(); } catch { /* ok */ } }
    let c = null;
    try { const m = mappa.getCenter(); c = { lat: m.lat, lon: m.lng, zoom: zoomLeaflet(mappa.getZoom()) }; } catch { /* mappa già persa */ }
    try { mappa.remove(); } catch { /* ok */ }
    velo.remove();
    aperta = null;
    if (c) alChiudere(c);
  };
  const tasto = (ev) => { if (ev.key === "Escape") chiudi(); };
  document.addEventListener("keydown", tasto);
  btnChiudi.addEventListener("click", chiudi);
  mappa.once("load", () => { stato.textContent = "Carico le quote del terreno…"; });
  aperta = { mappa, chiudi, stato: st, descriviFonte };
  return aperta;
}

export const vista3dAperta = () => aperta;
