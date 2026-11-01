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
  // Altre mappe di base libere, costruite su dati OpenStreetMap o su immagini Copernicus. Non si chiede il CORS
  // (senzaCors): si vedono comunque; non si salvano nella cache offline, ma non si rischia che una tessera sparisca
  // perché il server non manda l'intestazione.
  {
    id: "cyclosm",
    nome: "CyclOSM (sentieri e curve di livello)",
    nota: "Mappa libera costruita su OpenStreetMap: sentieri, mulattiere, curve di livello.",
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 19,
    senzaCors: true,
    attr: "© collaboratori di OpenStreetMap | CyclOSM (OSM France)",
  },
  {
    id: "hot",
    nome: "OpenStreetMap Umanitaria (HOT)",
    nota: "Stile libero con colori netti per strade e abitati; ottima alla scala del paese.",
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 19,
    senzaCors: true,
    attr: "© collaboratori di OpenStreetMap | stile Humanitarian OpenStreetMap Team, server OSM France",
  },
  {
    id: "voyager",
    nome: "CARTO Voyager (chiara)",
    nota: "Dati OpenStreetMap con uno stile chiaro e leggibile.",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxZoom: 20,
    senzaCors: true,
    attr: "© collaboratori di OpenStreetMap © CARTO",
  },
  {
    id: "positron",
    nome: "CARTO Positron (grigio chiaro)",
    nota: "Fondo quasi bianco: fa risaltare i livelli sovrapposti (LiDAR, IGM, catasto).",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxZoom: 20,
    senzaCors: true,
    attr: "© collaboratori di OpenStreetMap © CARTO",
  },
  {
    id: "s2",
    nome: "Sentinel-2 senza nuvole (EOX)",
    nota: "Immagini Copernicus a 10 m per pixel, un mosaico 2020 senza nuvole: aperte, ma lontane quanto a dettaglio. Uso non commerciale.",
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg",
    maxNativeZoom: 14,
    maxZoom: 19,
    senzaCors: true,
    attr: "Sentinel-2 cloudless 2020 di EOX IT Services GmbH (contiene dati Copernicus Sentinel modificati 2020) – s2maps.eu",
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
    nome: "Rilievo ombreggiato (TINITALY 10 m)",
    tipo: "wms",
    // Modello del terreno dell'INGV a 10 m su tutta l'Italia: tre volte più fine dell'ombreggiatura Esri (circa 30 m).
    url: "https://tinitaly.pi.ingv.it/TINItaly_1_1/wms",
    livelli: "tinitaly_hshd",
    versione: "1.1.1",
    maxNativeZoom: 15,
    risoluzione: 2, // tessere richieste al doppio dei pixel: ombre più nitide
    opacita: 0.55,
    rapido: true,
    etichettaRapida: "Ombre",
    attr: "Rilievo ombreggiato: TINITALY/1.1 © INGV (CC BY 4.0), Tarquini et al. 2023",
    nota: "Aiuta a leggere terrazzamenti, argini e fossati a scala di paesaggio; il pixel è di 10 m, quindi non mostra strutture piccole (per quelle serve il LiDAR). Se il servizio non risponde usa «Rilievo ombreggiato (Esri)».",
    daVerificare: true,
  },
  {
    id: "ombre-esri",
    nome: "Rilievo ombreggiato (Esri)",
    tipo: "tile",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 13,
    maxZoom: 19,
    opacita: 0.5,
    attr: "Rilievo © Esri",
    nota: "Ombreggiatura mondiale, meno fine di TINITALY: resta come ripiego.",
  },
  {
    id: "catasto",
    nome: "Catasto: particelle",
    tipo: "wms",
    url: "https://wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php",
    // Stessa richiesta dell'app di riferimento: WMS 1.3.0 in EPSG:4258, con particelle, fabbricati, strade e acque.
    livelli: "CP.CadastralParcel,fabbricati,strade,acque",
    versione: "1.3.0",
    crs: "EPSG:4258",
    minZoom: 15,
    opacita: 0.85,
    rapido: true,
    etichettaRapida: "Catasto",
    attr: "© Agenzia delle Entrate (CC BY 4.0)",
    nota: "Visibile solo a scala di dettaglio (zoom 15 o più).",
    daVerificare: true,
  },
  {
    id: "ortofoto",
    nome: "Ortofoto 2012 (Geoportale nazionale)",
    tipo: "wms",
    url: WMS_PCN + "raster/ortofoto_colore_12.map",
    // Un livello per fuso (nome.32 e nome.33): la richiesta giusta si sceglie provando (js/varianti.js).
    famiglia: "OI.ORTOIMMAGINI.2012",
    minZoom: 9, // sotto scala regionale il servizio non disegna nulla
    maxNativeZoom: 18,
    opacita: 1,
    rapido: true,
    etichettaRapida: "Ortofoto",
    attr: "© Ministero dell'Ambiente e della Sicurezza Energetica – Geoportale Nazionale",
    nota: "Ortofoto del 2012, da zoom 9. Servizio del Ministero: se non si vede, «Verifica servizi» prova da sola più formati di richiesta e dice cosa risponde il server.",
    daVerificare: true,
  },
  {
    id: "igm25",
    nome: "IGM 1:25.000 (Geoportale nazionale)",
    tipo: "wms",
    url: WMS_PCN + "raster/IGM_25000.map",
    famiglia: "CB.IGM25000",
    minZoom: 13, // sotto lo zoom 13 il servizio non disegna nulla (lo riferiscono anche gli utenti di altre app)
    maxNativeZoom: 16, // lo zoom 17 è solo il 16 ingrandito
    opacita: 0.9,
    rapido: true,
    etichettaRapida: "IGM",
    attr: "© Istituto Geografico Militare – Geoportale Nazionale",
    nota: "Cartografia storica: toponimi utili per ricerche d'archivio. Compare solo da zoom 13. Se il server del Ministero ha un guasto sui file degli indici (errore msShapefileOpen), l'app lo mostra com'è: non si può riparare da qui.",
    daVerificare: true,
  },
  {
    id: "igm100",
    nome: "IGM 1:100.000 (Geoportale nazionale)",
    tipo: "wms",
    url: WMS_PCN + "raster/IGM_100000.map",
    famiglia: "MB.IGM100000",
    minZoom: 9,
    maxNativeZoom: 15,
    opacita: 0.9,
    attr: "© Istituto Geografico Militare – Geoportale Nazionale",
    nota: "Carta d'insieme, utile a scala larga (zoom 9 e oltre).",
    daVerificare: true,
  },
  {
    id: "topoesri",
    nome: "Carta topografica (Esri)",
    tipo: "tile",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 19,
    maxZoom: 19,
    opacita: 0.9,
    attr: "© Esri, HERE, Garmin, OpenStreetMap",
    nota: "Carta con strade, edifici e curve di livello attuali: serve al confronto con il satellite quando l'IGM non risponde.",
  },
  ...[
    ["wb2014", "2014", 10],
    ["wb2018", "2018", 8255],
    ["wb2022", "2022", 16245],
    ["wb2026", "2026", 32246],
  ].map(([id, anno, rilascio]) => ({
    id,
    nome: `Satellite Esri ${anno} (storico)`,
    tipo: "tile",
    url: `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${rilascio}/{z}/{y}/{x}`,
    maxNativeZoom: 18,
    maxZoom: 19,
    opacita: 1,
    attr: "Immagini © Esri, Maxar, Earthstar Geographics (Wayback)",
    nota: "Rilascio di Esri Wayback, circa " + anno + ": la data è quella del rilascio, non di ogni fotogramma. Utile a vedere tracce nelle colture in anni diversi.",
  })),
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
    opacita: 0.8, // tessere da 256 px: a 512 il servizio non dà più dettaglio (il dato è a 1 m) e ogni tessera pesa il quadruplo
    rapido: true,
    etichettaRapida: "LiDAR",
    attr: "© MASE – Piano Straordinario di Telerilevamento Ambientale (CC BY 4.0)",
    nota: "Per ora Marche e Umbria. È l'immagine che il Ministero produce (256 grigi, senza ombre): per vedere il terreno nitido, in metri e con le ombre usa la scheda Rilievo. Il servizio è raggiungibile in http: nell'app Android funziona, dal sito (https) serve un proxy (vedi sotto) oppure carica un file nella scheda Rilievo.",
    daVerificare: true,
  },
];

/** Servizi WMS proposti nel menu "servizi noti" (si possono sempre incollare altri indirizzi). */
export const SERVIZI_NOTI = [
  { nome: "Catasto – particelle (Agenzia delle Entrate)", url: "https://wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php" },
  { nome: "Ortofoto 2012 (Geoportale nazionale)", url: WMS_PCN + "raster/ortofoto_colore_12.map" },
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
export function creaLivello(L, def, { livelli, url, versione, tileSize } = {}) {
  const comuni = { attribution: def.attr, opacity: def.opacita ?? 1, maxZoom: def.maxZoom ?? 19 };
  if (def.minZoom) comuni.minZoom = def.minZoom;
  if (def.tipo === "tile" || def.url?.includes("{z}")) {
    return L.tileLayer(def.url, {
      ...comuni,
      subdomains: def.subdomains ?? "abc",
      maxNativeZoom: def.maxNativeZoom,
      crossOrigin: !def.senzaCors, // risposte non opache: la cache offline le può conservare (salvo le mappe che non mandano il CORS)
    });
  }
  if (def.maxNativeZoom) comuni.maxNativeZoom = def.maxNativeZoom;
  if (tileSize) comuni.tileSize = tileSize; // 512: meno richieste, come l'app Grok
  if (def.crs === "EPSG:4258") {
    // Leaflet sa chiedere solo in 3857: qui la tessera si calcola in gradi, nell'ordine di assi del WMS 1.3.0
    const Capa = L.TileLayer.extend({
      getTileUrl(c) {
        return urlTessera({ url: url ?? def.url, livelli: livelli ?? def.livelli, versione: def.versione ?? "1.3.0", crs: def.crs }, this._getZoomForUrl(), c.x, c.y);
      },
    });
    return new Capa("", comuni);
  }
  const wms = L.tileLayer.wms(url ?? def.url, {
    ...comuni,
    layers: livelli ?? def.livelli,
    format: "image/png",
    transparent: true,
    version: versione ?? def.versione ?? "1.3.0",
  });
  // Più pixel per tessera di quelli mostrati (il browser li riduce): meno scatti a scala larga, più nitidezza sugli schermi ad alta densità
  if (def.risoluzione > 1 && wms.wmsParams) wms.wmsParams.width = wms.wmsParams.height = Math.round((tileSize ?? 256) * def.risoluzione);
  return wms;
}

// ---------------------------------------------------------- tessere

const MEZZO_MONDO = 20037508.342789244;

/** Tessera (x, y) che contiene il punto, allo zoom z. */
export function tesseraDa(lat, lon, z) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/**
 * GetMap della tessera z/x/y (256×256 px, o `px`), nello stesso formato delle app che già funzionano con questi servizi.
 * crs: EPSG:3857 (predefinito) o EPSG:4258 (gradi; con WMS 1.3.0 l'ordine degli assi è latitudine, longitudine).
 */
export function urlTessera({ url, livelli, versione = "1.1.1", crs = "EPSG:3857", px = 256 }, z, x, y) {
  const n = 2 ** z;
  const sep = url.includes("?") ? "&" : "?";
  const nomeCrs = versione === "1.1.1" ? "SRS" : "CRS";
  const testa = `${url}${sep}SERVICE=WMS&VERSION=${versione}&REQUEST=GetMap&LAYERS=${livelli}&STYLES=&${nomeCrs}=${crs}&BBOX=`;
  const coda = `&WIDTH=${px}&HEIGHT=${px}&FORMAT=image/png&TRANSPARENT=true`;
  if (crs === "EPSG:4258") {
    const lat = (yy) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
    const lon = (xx) => (xx / n) * 360 - 180;
    const bbox = versione === "1.1.1"
      ? [lon(x), lat(y + 1), lon(x + 1), lat(y)]
      : [lat(y + 1), lon(x), lat(y), lon(x + 1)];
    return testa + bbox.map((v) => v.toFixed(7)).join(",") + coda;
  }
  const lato = (2 * MEZZO_MONDO) / n;
  const minx = -MEZZO_MONDO + x * lato, maxy = MEZZO_MONDO - y * lato;
  return testa + [minx, maxy - lato, minx + lato, maxy].map((v) => v.toFixed(3)).join(",") + coda;
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
