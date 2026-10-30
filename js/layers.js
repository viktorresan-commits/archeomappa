// Registro dei livelli cartografici. Gli endpoint WMS istituzionali sono indicati come
// "da verificare": il servizio può cambiare indirizzo o non rispondere. L'app li prova
// davvero ("Verifica servizi") e mostra lo stato invece di darlo per scontato.

import { caricaCapabilities } from "./sources.js";
import { mem } from "./util.js";

export const BASI = [
  {
    id: "osm",
    nome: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attr: "© collaboratori di OpenStreetMap",
  },
  {
    id: "topo",
    nome: "OpenTopoMap (rilievo)",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 17,
    attr: "© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)",
  },
  {
    id: "sat",
    nome: "Satellite (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    attr: "Immagini © Esri, Maxar, Earthstar Geographics",
  },
];

export const PCN_HOST = "wms.pcn.minambiente.it";
export const WMS_PCN = `https://${PCN_HOST}/ogc?map=/ms_ogc/WMS_v1.3/`;

/**
 * Dove gira l'app. Una pagina https non può caricare servizi http (il browser li blocca);
 * l'app Android (Capacitor) si apre invece su http://localhost e li carica senza problemi.
 */
export function ambiente(win = globalThis) {
  const nativa = !!win.Capacitor?.isNativePlatform?.();
  const https = (win.location?.protocol ?? "https:") === "https:";
  return { nativa, httpConsentito: !https };
}

/** Indirizzo del proxy facoltativo (solo https, senza barra finale), oppure "" se non valido. */
export function normalizzaProxy(valore) {
  const s = String(valore ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(s) ? s : "";
}

export const usaPcn = (url) => {
  try {
    return new URL(url).hostname === PCN_HOST;
  } catch {
    return false;
  }
};

/**
 * Adatta all'ambiente l'indirizzo di un servizio del Geoportale nazionale:
 * con un proxy passa da lì; dove l'http è consentito (app Android) usa http, che è il
 * protocollo con cui il servizio è noto funzionare; altrimenti prova https.
 */
export function urlPerAmbiente(url, { amb = ambiente(), proxy = "" } = {}) {
  if (!usaPcn(url)) return url;
  const u = new URL(url);
  const p = normalizzaProxy(proxy);
  if (p) return `${p}/pcn${u.pathname}${u.search}`;
  u.protocol = amb.httpConsentito ? "http:" : "https:";
  return u.href;
}

export const SOVRAPPOSIZIONI = [
  {
    id: "ombre",
    nome: "Rilievo ombreggiato",
    tipo: "tile",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 13,
    maxZoom: 19,
    opacita: 0.5,
    attr: "Rilievo © Esri",
    nota: "Aiuta a leggere terrazzamenti, argini e fossati. Non è LiDAR.",
  },
  {
    id: "catasto",
    nome: "Catasto: particelle",
    tipo: "wms",
    url: "https://wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php",
    livelli: "CP.CadastralParcel",
    minZoom: 15,
    opacita: 0.85,
    attr: "© Agenzia delle Entrate (CC BY 4.0)",
    nota: "Visibile solo a scala di dettaglio (zoom 15 o più).",
    daVerificare: true,
  },
  {
    id: "ortofoto",
    nome: "Ortofoto (Geoportale nazionale)",
    tipo: "wms",
    url: WMS_PCN + "raster/ortofoto_colore_12.map",
    livelli: "OI.ORTOIMMAGINI.2012.33",
    versione: "1.1.1",
    maxNativeZoom: 18,
    opacita: 1,
    attr: "© Ministero dell'Ambiente e della Sicurezza Energetica – Geoportale Nazionale",
    nota: "Ortofoto del 2012. Servizio del Ministero: vedi la nota sul LiDAR qui sotto.",
    daVerificare: true,
  },
  {
    id: "igm25",
    nome: "IGM 1:25.000",
    tipo: "wms",
    url: WMS_PCN + "raster/IGM_25000.map",
    opacita: 0.9,
    attr: "© Istituto Geografico Militare – Geoportale Nazionale",
    nota: "Cartografia storica: toponimi utili per ricerche d'archivio.",
    daVerificare: true,
  },
  {
    id: "lidar",
    nome: "LiDAR (Geoportale nazionale)",
    tipo: "wms-regione",
    modello: WMS_PCN + "servizi-LiDAR/LIDAR_<REGIONE>.map",
    // Nomi dei file e dei livelli presi da un'app che li usa davvero (Marche e Umbria).
    // Per le altre regioni il nome del livello va letto dal servizio, e non sempre è possibile.
    mappe: { MARCHE: "LIDAR_MARCHE.map", UMBRIA: "LIDAR_UMBRIA_2.map" },
    prodotti: {
      MARCHE: [
        { nome: "DTM 1 m – terreno nudo (consigliato)", livello: "EL.LIDAR.MARCHE.1x1.DTM" },
        { nome: "DSM 1 m – ultimo impulso", livello: "EL.LIDAR.MARCHE.1x1.DSM_LAST" },
        { nome: "DSM 1 m – primo impulso (chiome e tetti)", livello: "EL.LIDAR.MARCHE.1x1.DSM_FIRST" },
        { nome: "DTM 2 m", livello: "EL.LIDAR.MARCHE.2x2.DTM" },
      ],
      UMBRIA: [
        { nome: "DTM 1 m (consigliato)", livello: "EL.LIDAR.UMBRIA.1x1.DTM" },
        { nome: "DTM 1 m – volo 2014", livello: "EL.LIDAR.UMBRIA.1x1.T1.DTM" },
        { nome: "DSM 1 m primo impulso – volo 2014", livello: "EL.LIDAR.UMBRIA.1x1.T1.DSM_FIRST" },
      ],
    },
    regioni: [
      "MARCHE", "UMBRIA", "ABRUZZO", "BASILICATA", "CALABRIA", "CAMPANIA", "EMILIA_ROMAGNA", "FRIULI_VENEZIA_GIULIA",
      "LAZIO", "LIGURIA", "LOMBARDIA", "MOLISE", "PIEMONTE", "PUGLIA", "SARDEGNA", "SICILIA", "TOSCANA",
      "TRENTINO_ALTO_ADIGE", "VALLE_D_AOSTA", "VENETO",
    ],
    versione: "1.1.1",
    maxNativeZoom: 17,
    opacita: 0.8,
    attr: "© MASE – Piano Straordinario di Telerilevamento Ambientale (CC BY 4.0)",
    nota: "Per ora Marche e Umbria. Il servizio del Ministero è raggiungibile in http: nell'app Android funziona, dal sito (https) serve un proxy (vedi sotto) oppure carica un file nella scheda Rilievo.",
    daVerificare: true,
  },
];

/** Servizi WMS proposti nel menu "servizi noti" (si possono sempre incollare altri indirizzi). */
export const SERVIZI_NOTI = [
  { nome: "Catasto – particelle (Agenzia delle Entrate)", url: "https://wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php" },
  { nome: "Ortofoto (Geoportale nazionale)", url: WMS_PCN + "raster/ortofoto_colore_12.map" },
  { nome: "IGM 1:25.000 (Geoportale nazionale)", url: WMS_PCN + "raster/IGM_25000.map" },
  { nome: "IGM 1:100.000 (Geoportale nazionale)", url: WMS_PCN + "raster/IGM_100000.map" },
  { nome: "SITAP – vincoli paesaggistici (solo http: funziona nell'app Android)", url: "http://sitap.beniculturali.it:8080/geoserver/apar.public/wms" },
];

export function urlRegione(def, regione) {
  const file = def.mappe?.[regione];
  return file ? def.modello.replace("LIDAR_<REGIONE>.map", file) : def.modello.replace("<REGIONE>", regione);
}

/** Livelli di cui si conosce il nome per una regione (vuoto se va letto dal servizio). */
export function prodottiRegione(def, regione) {
  return def.prodotti?.[regione] ?? [];
}

/** Crea il livello Leaflet. `L` viene passato dal chiamante (nessun globale qui). */
export function creaLivello(L, def, { livelli, url } = {}) {
  const comuni = { attribution: def.attr, opacity: def.opacita ?? 1, maxZoom: def.maxZoom ?? 19 };
  if (def.minZoom) comuni.minZoom = def.minZoom;
  if (def.tipo === "tile" || def.url?.includes("{z}")) {
    return L.tileLayer(def.url, {
      ...comuni,
      subdomains: def.subdomains ?? "abc",
      maxNativeZoom: def.maxNativeZoom,
      crossOrigin: true, // risposte non opache: la cache offline le può conservare
    });
  }
  if (def.maxNativeZoom) comuni.maxNativeZoom = def.maxNativeZoom;
  return L.tileLayer.wms(url ?? def.url, {
    ...comuni,
    layers: livelli ?? def.livelli,
    format: "image/png",
    transparent: true,
    version: def.versione ?? "1.3.0",
  });
}

// ----------------------------------------------------- nomi dei livelli WMS

/** Se la definizione non indica il livello, lo legge dal GetCapabilities (con cache locale). */
export async function risolviLivelli(def, urlServizio = def.url, { impl } = {}) {
  if (def.livelli) return def.livelli;
  const chiave = "am.wmslayers." + urlServizio;
  const salvato = mem.get(chiave, null);
  if (salvato && Date.now() - salvato.t < 7 * 24 * 3600 * 1000) return salvato.livelli;
  const cap = await caricaCapabilities(urlServizio, { impl });
  const scelto = (def.scegli && cap.livelli.find((l) => def.scegli.test(l.name) || def.scegli.test(l.title))) || cap.livelli[0];
  mem.set(chiave, { t: Date.now(), livelli: scelto.name });
  return scelto.name;
}

// ---------------------------------------------------------- prova del servizio

function mercatore(lat, lon) {
  const R = 6378137;
  return [R * ((lon * Math.PI) / 180), R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
}

/** URL di un GetMap di prova 256×256 su Roma (centro d'Italia). */
export function urlProva(urlServizio, livelli, versione = "1.3.0", d = 20000) {
  const [x, y] = mercatore(41.9028, 12.4964);
  const u = new URL(urlServizio);
  const set = (k, v) => {
    for (const key of [...u.searchParams.keys()]) if (key.toLowerCase() === k.toLowerCase()) u.searchParams.delete(key);
    u.searchParams.set(k, v);
  };
  set("SERVICE", "WMS");
  set("VERSION", versione);
  set("REQUEST", "GetMap");
  set("LAYERS", livelli);
  set("STYLES", "");
  set(versione === "1.1.1" ? "SRS" : "CRS", "EPSG:3857");
  set("BBOX", [x - d, y - d, x + d, y + d].join(","));
  set("WIDTH", "256");
  set("HEIGHT", "256");
  set("FORMAT", "image/png");
  set("TRANSPARENT", "TRUE");
  return u.href;
}

/** Prova a caricare un'immagine GetMap. Risponde "ok", "errore" o "timeout". */
export function provaServizio(urlServizio, livelli, versione, timeoutMs = 15000, d = 20000) {
  return new Promise((risolvi) => {
    const img = new Image();
    const t = setTimeout(() => {
      img.src = "";
      risolvi("timeout");
    }, timeoutMs);
    img.onload = () => { clearTimeout(t); risolvi("ok"); };
    img.onerror = () => { clearTimeout(t); risolvi("errore"); };
    img.src = urlProva(urlServizio, livelli, versione, d);
  });
}
