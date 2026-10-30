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

export const WMS_PCN = "https://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/";

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
    scegli: /orto|image/i,
    opacita: 1,
    attr: "© Ministero dell'Ambiente e della Sicurezza Energetica – Geoportale Nazionale",
    nota: "Il nome del livello viene letto dal servizio.",
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
    nome: "LiDAR PST-A (per regione)",
    tipo: "wms-regione",
    modello: WMS_PCN + "servizi-LiDAR/LIDAR_<REGIONE>.map",
    regioni: [
      "ABRUZZO", "BASILICATA", "CALABRIA", "CAMPANIA", "EMILIA_ROMAGNA", "FRIULI_VENEZIA_GIULIA", "LAZIO",
      "LIGURIA", "LOMBARDIA", "MARCHE", "MOLISE", "PIEMONTE", "PUGLIA", "SARDEGNA", "SICILIA", "TOSCANA",
      "TRENTINO_ALTO_ADIGE", "UMBRIA", "VALLE_D_AOSTA", "VENETO",
    ],
    opacita: 0.8,
    attr: "© MASE – Piano Straordinario di Telerilevamento Ambientale",
    nota: "Servizio ministeriale: spesso non risponde dal browser. Per il LiDAR affidabile carica un file nella scheda Rilievo.",
    daVerificare: true,
  },
];

/** Servizi WMS proposti nel menu "servizi noti" (si possono sempre incollare altri indirizzi). */
export const SERVIZI_NOTI = [
  { nome: "Catasto – particelle (Agenzia delle Entrate)", url: "https://wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php" },
  { nome: "Ortofoto (Geoportale nazionale)", url: WMS_PCN + "raster/ortofoto_colore_12.map" },
  { nome: "IGM 1:25.000 (Geoportale nazionale)", url: WMS_PCN + "raster/IGM_25000.map" },
  { nome: "IGM 1:100.000 (Geoportale nazionale)", url: WMS_PCN + "raster/IGM_100000.map" },
  { nome: "SITAP – vincoli paesaggistici (http: non funziona se l'app è su https)", url: "http://sitap.beniculturali.it:8080/geoserver/apar.public/wms" },
];

export function urlRegione(def, regione) {
  return def.modello.replace("<REGIONE>", regione);
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
export function urlProva(urlServizio, livelli, versione = "1.3.0") {
  const [x, y] = mercatore(41.9028, 12.4964);
  const d = 20000;
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
export function provaServizio(urlServizio, livelli, versione, timeoutMs = 15000) {
  return new Promise((risolvi) => {
    const img = new Image();
    const t = setTimeout(() => {
      img.src = "";
      risolvi("timeout");
    }, timeoutMs);
    img.onload = () => { clearTimeout(t); risolvi("ok"); };
    img.onerror = () => { clearTimeout(t); risolvi("errore"); };
    img.src = urlProva(urlServizio, livelli, versione);
  });
}
