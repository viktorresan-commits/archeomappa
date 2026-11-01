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
    nota: "Carta con curve di livello e rilievo. Il server è di volontari e a volte risponde con una pagina di errore al posto della tessera (il 1° novembre 2026, dalle prove, ai zoom 13 e oltre in Italia centrale): se la mappa resta vuota usa «CyclOSM», «Stradale Esri» o «Carta topografica (Esri)» fra i livelli.",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxZoom: 17,
    attr: "© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)",
  },
  {
    id: "sat",
    nome: "Satellite HD (Esri Clarity)",
    nota: "Le immagini Esri nella versione «Clarity», più nitida ma in molte zone meno recente di «Satellite Esri (classico)». Dove una tessera manca usa l'immagine Esri standard. Oltre lo zoom 18 il dettaglio vero finisce: lo zoom 19 è solo l'immagine allargata.",
    url: "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    urlRipiego: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 18, // Clarity non ha tessere oltre lo zoom 18 (risponde 404); l'Esri standard a 19 in campagna dà spesso un segnaposto grigio
    maxZoom: 19,
    attr: "Immagini © Esri (Clarity), Maxar, Earthstar Geographics",
  },
  {
    id: "sat-esri",
    nome: "Satellite Esri (classico)",
    nota: "L'immagine Esri di sempre (è quella a cui si riferiscono il confronto con i satelliti storici e il riconoscimento automatico). Date e stagioni delle riprese possono essere diverse da quelle di «Satellite HD».",
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
    id: "s2",
    nome: "Sentinel-2 senza nuvole 2024 (EOX)",
    nota: "Immagini Copernicus a 10 m per pixel, mosaico 2024 senza nuvole: aperte, ma lontane quanto a dettaglio (utili per vedere vegetazione e campi, non strutture). Uso non commerciale.",
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
    maxNativeZoom: 14,
    maxZoom: 19,
    senzaCors: true,
    attr: "Sentinel-2 cloudless 2024 di EOX IT Services GmbH (contiene dati Copernicus Sentinel modificati 2024) – s2maps.eu",
  },
  {
    id: "esri-strade",
    nome: "Stradale Esri",
    nota: "Mappa stradale con edifici, toponimi e confini, a colori chiari; dati Esri, HERE, Garmin e OpenStreetMap.",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    attr: "© Esri, HERE, Garmin, OpenStreetMap contributors",
  },
  {
    id: "osmde",
    nome: "OpenStreetMap (stile tedesco)",
    nota: "Stesso dato di OpenStreetMap con uno stile più ricco di dettagli (sentieri, edifici, curve di livello nei rilievi).",
    url: "https://tile.openstreetmap.de/{z}/{x}/{y}.png",
    maxZoom: 19,
    attr: "© collaboratori di OpenStreetMap, server OpenStreetMap.de",
  },
  {
    id: "esri-chiaro",
    nome: "Grigio chiaro (Esri)",
    nota: "Fondo quasi bianco, senza colori: fa risaltare i livelli sovrapposti (LiDAR, rilievo, catasto). Dettaglio fino allo zoom 16, oltre è ingrandito.",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 16,
    maxZoom: 19,
    attr: "© Esri, HERE, Garmin, OpenStreetMap contributors",
  },
  {
    id: "esri-scuro",
    nome: "Grigio scuro (Esri)",
    nota: "Fondo scuro: fa risaltare ortofoto, LiDAR e rilievo chiari sovrapposti. Dettaglio fino allo zoom 16, oltre è ingrandito.",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 16,
    maxZoom: 19,
    attr: "© Esri, HERE, Garmin, OpenStreetMap contributors",
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
    nome: "Rilievo ombreggiato – grigi (TINITALY 10 m)",
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
    nota: "Ombreggiatura in bianco e nero: aiuta a leggere terrazzamenti, argini e fossati a scala di paesaggio. Il pixel è di 10 m, quindi non mostra strutture piccole (per quelle serve il LiDAR). Se il servizio non risponde usa «Rilievo ombreggiato (Esri)».",
    daVerificare: true,
  },
  {
    id: "ombre-colori",
    nome: "Rilievo a colori – quote e ombre (TINITALY 10 m)",
    tipo: "wms",
    url: "https://tinitaly.pi.ingv.it/TINItaly_1_1/wms",
    livelli: "tinitaly_hsv",
    versione: "1.1.1",
    maxNativeZoom: 15,
    opacita: 0.7,
    rapido: true,
    etichettaRapida: "Rilievo colori",
    attr: "Rilievo a colori: TINITALY/1.1 © INGV (CC BY 4.0), Tarquini et al. 2023",
    nota: "Lo stesso modello a 10 m in colori (ombreggiatura con tinta che cambia con la quota), distinto dal bianco e nero di «Ombre» e dal LiDAR del Ministero. Copre tutta l'Italia, ma a 10 m per pixel.",
    daVerificare: true,
  },
  {
    id: "svf",
    nome: "Apertura del cielo – SVF (TINITALY 10 m)",
    tipo: "wms",
    url: "https://tinitaly.pi.ingv.it/TINItaly_1_1/wms",
    livelli: "tinitaly_svf_2d5",
    versione: "1.1.1",
    maxNativeZoom: 15,
    opacita: 0.75,
    attr: "Sky-view factor: TINITALY/1.1 © INGV (CC BY 4.0), Tarquini et al. 2023",
    nota: "Quanto cielo si vede da ogni punto del terreno: i punti più scuri sono avvallamenti, fossati e cavità, i più chiari rilievi e piani aperti. Non dipende da una direzione della luce, a differenza dell'ombreggiatura.",
    daVerificare: true,
  },
  {
    id: "pendenza",
    nome: "Pendenza (TINITALY 10 m)",
    tipo: "wms",
    url: "https://tinitaly.pi.ingv.it/TINItaly_1_1/wms",
    livelli: "tinitaly_slope",
    versione: "1.1.1",
    maxNativeZoom: 15,
    opacita: 0.75,
    attr: "Pendenza: TINITALY/1.1 © INGV (CC BY 4.0), Tarquini et al. 2023",
    nota: "Più chiaro = più ripido. Mette in evidenza scarpate, terrazzamenti e argini.",
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
  // Esri Wayback: ogni «rilascio» è un'istantanea del satellite Esri, con la data vera dell'archivio (waybackconfig.json,
  // letto il 1° novembre 2026). La data è quella del rilascio, non di ogni fotogramma.
  ...[
    ["wb2014", "2014", 10, "20 febbraio 2014"],
    ["wb2016", "2016", 388, "20 aprile 2016"],
    ["wb2018", "2018", 8255, "14 marzo 2018"],
    ["wb2020", "2020", 119, "14 ottobre 2020"],
    ["wb2022", "2022", 16245, "27 aprile 2022"],
    ["wb2024", "2024", 12428, "6 giugno 2024"],
    ["wb2026", "2026", 32246, "30 giugno 2026"],
  ].map(([id, anno, rilascio, data]) => ({
    id,
    nome: `Satellite Esri ${anno} (storico)`,
    tipo: "tile",
    url: `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${rilascio}/{z}/{y}/{x}`,
    maxNativeZoom: 18,
    maxZoom: 19,
    opacita: 1,
    attr: "Immagini © Esri, Maxar, Earthstar Geographics (Wayback)",
    nota: `Rilascio Esri Wayback del ${data}: la data è quella del rilascio dell'archivio, non quella di ogni ripresa. Se due anni sembrano uguali, in quella zona non ci sono state nuove riprese fra i due rilasci. Per vedere tracce nelle colture o nei campi, confronta anni diversi con «Confronta».`,
  })),
  // Ortofoto storiche del Geoportale nazionale: stessi server, stesso meccanismo a due fusi dell'ortofoto 2012.
  ...[
    ["orto1988", "1988", "ortofoto_bn_88", "OI.ORTOIMMAGINI.1988", "bianco e nero", 12],
    ["orto1994", "1994", "ortofoto_bn_94", "OI.ORTOIMMAGINI.1994", "bianco e nero", 12],
    ["orto2006", "2006", "ortofoto_colore_06", "OI.ORTOIMMAGINI.2006", "a colori", 12],
  ].map(([id, anno, mappa, famiglia, tipo, minZoom]) => ({
    id,
    nome: `Ortofoto ${anno} (${tipo}, Geoportale nazionale)`,
    tipo: "wms",
    url: WMS_PCN + `raster/${mappa}.map`,
    famiglia,
    minZoom,
    maxNativeZoom: 17,
    opacita: 1,
    attr: "© Ministero dell'Ambiente e della Sicurezza Energetica – Geoportale Nazionale",
    nota: `Ortofoto ${tipo} del ${anno} (l'anno è quello del livello del Geoportale): serve a vedere com'era il territorio prima delle trasformazioni recenti. Server del Ministero, a volte in errore: se non si vede, l'app lo dice e ripete la richiesta da sola.`,
    daVerificare: true,
    provaSoloSeAcceso: true, // «Verifica servizi» non lo prova se è spento: sono tanti formati e il server è lento
  })),
  // Cartografia storica regionale (servizi WMS delle Regioni, verificati con una richiesta vera il 1° novembre 2026).
  {
    id: "castore",
    nome: "Catasto ottocentesco della Toscana (CASTORE)",
    tipo: "wms",
    url: "https://www502.regione.toscana.it/cartografia/wmsraster/com.rt.wms.RTmap/wms?map=wmscastore",
    livelli: "r_toscan_cst_fogli",
    versione: "1.3.0",
    minZoom: 15, // sotto lo zoom 15 il servizio non disegna i fogli
    maxNativeZoom: 18,
    opacita: 0.9,
    attr: "© Regione Toscana – progetto CASTORE (Archivio di Stato di Firenze)",
    nota: "Fogli del catasto storico della Toscana (Catasto Generale): particelle, strade e fabbricati dell'Ottocento. Solo Toscana, da zoom 15. Fonte: Regione Toscana; per la pubblicazione controlla le condizioni d'uso.",
    daVerificare: true,
  },
  {
    id: "inghirami",
    nome: "Carta geometrica della Toscana (Inghirami, 1830 circa)",
    tipo: "wms",
    url: "https://www502.regione.toscana.it/cartografia/wmsraster/com.rt.wms.RTmap/wms?map=wmscastore",
    livelli: "r_toscan_cst_inghirami",
    versione: "1.3.0",
    minZoom: 9,
    maxNativeZoom: 14, // oltre, la carta (a scala 1:200.000) è solo ingrandita e si vedono i pixel
    opacita: 0.9,
    attr: "© Regione Toscana – progetto CASTORE",
    nota: "Carta storica d'insieme della Toscana con toponimi, strade, pievi e rilievi tratteggiati: utile per i nomi e la viabilità antica. Solo Toscana.",
    daVerificare: true,
  },
  {
    id: "bz1858",
    nome: "Catasto storico del 1858 (Alto Adige)",
    tipo: "wms",
    url: "https://geoservices5.civis.bz.it/geoserver/ows",
    livelli: "p_bz-Cadastre-Historical:Cadastre1858-Map",
    versione: "1.3.0",
    minZoom: 12,
    maxNativeZoom: 19,
    opacita: 0.9,
    attr: "© Provincia autonoma di Bolzano – Alto Adige (Geoportale)",
    nota: "Mappa del catasto di Francesco I (1858): edifici, campi, boschi e strade di allora, a colori. Solo Alto Adige. Fonte: Provincia autonoma di Bolzano; per la pubblicazione controlla le condizioni d'uso.",
    daVerificare: true,
  },
  {
    id: "nomi",
    nome: "Nomi dei luoghi (Esri)",
    tipo: "tile",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 17,
    maxZoom: 19,
    opacita: 1,
    attr: "Nomi e confini © Esri",
    nota: "Toponimi e confini da sovrapporre al satellite, all'ortofoto o al LiDAR.",
  },
  {
    id: "sentieri",
    nome: "Sentieri escursionistici (Waymarked Trails)",
    tipo: "tile",
    url: "https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png",
    maxNativeZoom: 17,
    maxZoom: 19,
    opacita: 0.9,
    attr: "Sentieri © Waymarked Trails (CC BY-SA); dati © collaboratori di OpenStreetMap",
    nota: "Sentieri e percorsi segnalati mappati su OpenStreetMap: utili per raggiungere un sito sul terreno.",
  },
  {
    id: "lidar",
    nome: "LiDAR – grigi (Ministero, Geoportale nazionale)",
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
    nota: "Per ora Marche e Umbria. È l'immagine che il Ministero produce: 256 livelli di grigio, senza ombre (il rilievo a colori è un livello a parte: «Rilievo a colori»). Se resta vuoto, in quella zona manca la copertura o il server del Ministero ha un guasto (il 1° novembre 2026 rispondeva con immagini vuote in tutte le zone provate): non dipende dall'app. Per vedere il terreno in metri e con le ombre carica un file nella scheda Rilievo. Il servizio è in http: nell'app Android funziona, dal sito (https) serve un proxy (vedi sotto).",
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

/**
 * Livello a tessere con una seconda fonte di ripiego: se la tessera della fonte principale manca (o dà errore),
 * la stessa tessera si chiede alla fonte di ripiego (`def.urlRipiego`), una sola volta.
 */
export function capaConRipiego(L, def, opzioni) {
  const riempi = (modello, z, c) => L.Util.template(modello, { x: c.x, y: c.y, z, s: "a", r: "" });
  const Capa = L.TileLayer.extend({
    createTile(coords, fatto) {
      const z = this._getZoomForUrl();
      let ripiegata = false;
      return L.TileLayer.prototype.createTile.call(this, coords, (err, t) => {
        if (err && !ripiegata) {
          ripiegata = true;
          t.src = riempi(def.urlRipiego, z, coords); // «load» o «error» richiamano questa funzione
          return;
        }
        fatto(err, t);
      });
    },
  });
  return new Capa(def.url, opzioni);
}

/** Crea il livello Leaflet. `L` viene passato dal chiamante (nessun globale qui). */
export function creaLivello(L, def, { livelli, url, versione, tileSize } = {}) {
  const comuni = { attribution: def.attr, opacity: def.opacita ?? 1, maxZoom: def.maxZoom ?? 19 };
  if (def.minZoom) comuni.minZoom = def.minZoom;
  if (def.tipo === "tile" || def.url?.includes("{z}")) {
    const opzioni = {
      ...comuni,
      subdomains: def.subdomains ?? "abc",
      maxNativeZoom: def.maxNativeZoom,
      crossOrigin: !def.senzaCors, // risposte non opache: la cache offline le può conservare (salvo le mappe che non mandano il CORS)
    };
    return def.urlRipiego ? capaConRipiego(L, def, opzioni) : L.tileLayer(def.url, opzioni);
  }
  if (def.maxNativeZoom) comuni.maxNativeZoom = def.maxNativeZoom;
  if (tileSize) comuni.tileSize = tileSize; // 512: meno richieste, come l'app Grok
  // Con lo zoom a due dita la mappa passa per molti ingrandimenti intermedi: per i servizi lenti del Ministero si chiede
  // solo quello finale (altrimenti decine di richieste inutili affollano il server e le tessere vere arrivano tardi o mai).
  comuni.updateWhenZooming = false;
  comuni.updateInterval = 300;
  comuni.keepBuffer = 3;
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
