// Stile della vista 3D (MapLibre GL JS): mappe di base, rilievo, ombreggiatura, edifici, LiDAR. Solo dati, nessun DOM:
// si può provare in Node. Le funzioni che toccano MapLibre e la rete stanno in vista3d.js.

export const PROTOCOLLO_DEM = "amdem";
export const PROTOCOLLO_LIDAR = "amlidar";
export const ZOOM_DEM_MAX = 13; // oltre, MapLibre ingrandisce la tessera z13 (passo ~9 m): il dato di TINITALY non è più fine
export const URL_EDIFICI = "https://tiles.openfreemap.org/planet";

/**
 * Mappe di base per il 3D. Servono servizi che permettono la lettura dall'altra origine (intestazione CORS):
 * WebGL non può usare come texture un'immagine che il browser considera «non sicura». Verificato dai server di GitHub
 * il 1° novembre 2026: Esri, OpenStreetMap, OpenTopoMap rispondono con «access-control-allow-origin: *».
 */
export const BASI_3D = [
  {
    id: "sat", nome: "Satellite", maxzoom: 19,
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attr: "Immagini © Esri, Maxar, Earthstar Geographics",
  },
  {
    id: "topo", nome: "Topografica", maxzoom: 17,
    tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png", "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"],
    attr: "© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)",
  },
  {
    id: "osm", nome: "Stradale", maxzoom: 19,
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attr: "© OpenStreetMap contributors",
  },
];

/** Base 3D che corrisponde alla base scelta sulla mappa 2D (le altre ripiegano sul satellite). */
export const base3dDa2d = (id) => (BASI_3D.some((b) => b.id === id) ? id : "sat");

/** Ingrandimento Leaflet (tessere da 256 px) → MapLibre (tessere da 512 px): un livello in meno. */
export const zoomMapLibre = (zoomLeaflet) => zoomLeaflet - 1;
export const zoomLeaflet = (zoomMapLibre) => zoomMapLibre + 1;

export const ESAGERAZIONI = [1, 1.5, 2, 3];

/**
 * Stile completo (versione 8) con tutti i livelli già presenti; accensioni e spegnimenti si fanno poi con
 * setLayoutProperty (visibilità) e setTerrain (esagerazione).
 */
export function costruisciStile({ base = "sat", ombre = true, edifici = true, lidar = false, esagerazione = 1, urlEdifici = URL_EDIFICI } = {}) {
  const baseScelta = BASI_3D.find((b) => b.id === base) ?? BASI_3D[0];
  const vis = (acceso) => ({ visibility: acceso ? "visible" : "none" });
  const sources = {
    dem: { type: "raster-dem", tiles: [`${PROTOCOLLO_DEM}://{z}/{x}/{y}`], tileSize: 512, minzoom: 0, maxzoom: ZOOM_DEM_MAX, encoding: "terrarium", attribution: "Quote: TINITALY/1.1 © INGV (CC BY 4.0); ripiego Mapzen/AWS Terrain Tiles" },
    lidar: { type: "raster", tiles: [`${PROTOCOLLO_LIDAR}://{z}/{x}/{y}`], tileSize: 256, minzoom: 12, maxzoom: 17, attribution: "LiDAR © MASE – PST-A (CC BY 4.0)" },
    edifici: { type: "vector", url: urlEdifici, attribution: "Edifici © OpenStreetMap contributors, OpenFreeMap" },
  };
  const layers = [{ id: "sfondo", type: "background", paint: { "background-color": "#d9d6cc" } }];
  for (const b of BASI_3D) {
    sources[`base-${b.id}`] = { type: "raster", tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attr };
    layers.push({ id: `base-${b.id}`, type: "raster", source: `base-${b.id}`, layout: vis(b.id === baseScelta.id) });
  }
  layers.push(
    { id: "ombre", type: "hillshade", source: "dem", layout: vis(ombre), paint: { "hillshade-exaggeration": 0.55, "hillshade-shadow-color": "#1a1a1a", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#000000", "hillshade-illumination-direction": 315 } },
    { id: "lidar", type: "raster", source: "lidar", layout: vis(lidar), paint: { "raster-opacity": 0.8 } },
    {
      id: "edifici", type: "fill-extrusion", source: "edifici", "source-layer": "building", minzoom: 13, layout: vis(edifici),
      paint: {
        "fill-extrusion-color": "#e4dccb",
        "fill-extrusion-height": ["to-number", ["get", "render_height"], 0],
        "fill-extrusion-base": ["to-number", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.82,
      },
    },
  );
  return {
    version: 8,
    sources,
    layers,
    terrain: { source: "dem", exaggeration: esagerazione },
    sky: { "sky-color": "#8fb4d9", "horizon-color": "#e8eef2", "fog-color": "#e8eef2", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.35 },
  };
}

/** Indirizzo di una tessera di LiDAR (WMS del Ministero) in Web Mercator, 256 px: come per la mappa 2D. */
export function urlTesseraLidar({ url, livelli, versione = "1.1.1" }, z, x, y, px = 256) {
  const M = 20037508.342789244, s = (2 * M) / 2 ** z;
  const bb = [-M + x * s, M - (y + 1) * s, -M + (x + 1) * s, M - y * s].map((v) => v.toFixed(3)).join(",");
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}SERVICE=WMS&VERSION=${versione}&REQUEST=GetMap&LAYERS=${encodeURIComponent(livelli)}&STYLES=&SRS=EPSG:3857&BBOX=${bb}&WIDTH=${px}&HEIGHT=${px}&FORMAT=image/png&TRANSPARENT=true`;
}

/** Legge «z/x/y» da un indirizzo con protocollo personalizzato, es. «amdem://13/4389/2999». */
export function leggiZxy(url) {
  const m = /^[a-z]+:\/\/(\d+)\/(\d+)\/(\d+)/i.exec(url);
  if (!m) throw new Error(`indirizzo di tessera non valido: ${url}`);
  return { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) };
}

/** Testo da mostrare con la quota letta sul terreno (l'esagerazione si toglie). Metri interi: il dato è a 10 m, i decimali sarebbero falsa precisione. */
export function testoQuota(quotaConEsagerazione, esagerazione = 1) {
  if (!Number.isFinite(quotaConEsagerazione)) return "quota non disponibile";
  return `${Math.round(quotaConEsagerazione / (esagerazione || 1))} m s.l.m.`;
}
