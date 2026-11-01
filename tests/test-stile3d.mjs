// Stile della vista 3D: basi, livelli, rilievo, indirizzi delle tessere. Esegui con: node tests/test-stile3d.mjs
import assert from "node:assert/strict";
import {
  BASI_3D, ESAGERAZIONI, PROTOCOLLO_DEM, PROTOCOLLO_LIDAR, ZOOM_DEM_MAX, base3dDa2d, costruisciStile, leggiZxy, testoQuota, urlTesseraLidar, zoomLeaflet, zoomMapLibre,
} from "../js/stile3d.js";
import { BASI } from "../js/layers.js";

let ok = 0;
const test = (nome, fn) => {
  try { fn(); ok++; console.log("  ok  ", nome); } catch (e) { process.exitCode = 1; console.error("  FAIL", nome, "\n      ", e.stack.split("\n").slice(0, 3).join("\n       ")); }
};

console.log("stile");
test("il rilievo viene dalle quote Terrarium con protocollo dell'app e tessere da 512 px, fino a z13", () => {
  const s = costruisciStile({});
  assert.equal(s.version, 8);
  assert.deepEqual(s.sources.dem.tiles, [`${PROTOCOLLO_DEM}://{z}/{x}/{y}`]);
  assert.equal(s.sources.dem.type, "raster-dem"); assert.equal(s.sources.dem.encoding, "terrarium");
  assert.equal(s.sources.dem.tileSize, 512); assert.equal(s.sources.dem.maxzoom, ZOOM_DEM_MAX); assert.equal(ZOOM_DEM_MAX, 13);
  assert.deepEqual(s.terrain, { source: "dem", exaggeration: 1 });
});
test("l'esagerazione delle altezze è quella chiesta", () => {
  assert.equal(costruisciStile({ esagerazione: 2 }).terrain.exaggeration, 2);
});
test("c'è una sola base visibile: quella scelta; le altre sono spente", () => {
  for (const b of BASI_3D) {
    const s = costruisciStile({ base: b.id });
    for (const x of BASI_3D) assert.equal(s.layers.find((l) => l.id === `base-${x.id}`).layout.visibility, x.id === b.id ? "visible" : "none");
  }
});
test("una base sconosciuta ripiega sul satellite", () => {
  const s = costruisciStile({ base: "boh" });
  assert.equal(s.layers.find((l) => l.id === "base-sat").layout.visibility, "visible");
});
test("ombre, edifici e LiDAR si accendono e spengono con le opzioni", () => {
  const vis = (s, id) => s.layers.find((l) => l.id === id).layout.visibility;
  const a = costruisciStile({ ombre: true, edifici: true, lidar: true }), b = costruisciStile({ ombre: false, edifici: false, lidar: false });
  for (const id of ["ombre", "edifici", "lidar"]) { assert.equal(vis(a, id), "visible"); assert.equal(vis(b, id), "none"); }
});
test("le ombre sono un livello «hillshade» calcolato dalle stesse quote", () => {
  const l = costruisciStile({}).layers.find((x) => x.id === "ombre");
  assert.equal(l.type, "hillshade"); assert.equal(l.source, "dem");
});
test("gli edifici usano l'altezza di OpenStreetMap (render_height / render_min_height), con 0 se manca", () => {
  const l = costruisciStile({}).layers.find((x) => x.id === "edifici");
  assert.equal(l.type, "fill-extrusion"); assert.equal(l["source-layer"], "building");
  assert.deepEqual(l.paint["fill-extrusion-height"], ["to-number", ["get", "render_height"], 0]);
  assert.deepEqual(l.paint["fill-extrusion-base"], ["to-number", ["get", "render_min_height"], 0]);
});
test("l'ordine dei livelli: sfondo, basi, ombre, LiDAR, edifici (gli edifici stanno in cima)", () => {
  const ids = costruisciStile({}).layers.map((l) => l.id);
  assert.deepEqual(ids, ["sfondo", "base-sat", "base-topo", "base-osm", "ombre", "lidar", "edifici"]);
});
test("ogni sorgente ha l'attribuzione (obbligatoria per le licenze)", () => {
  const s = costruisciStile({});
  for (const [id, src] of Object.entries(s.sources)) assert.ok(src.attribution && src.attribution.length > 5, `manca in ${id}`);
  assert.match(s.sources.dem.attribution, /TINITALY.*INGV/);
});
test("c'è il cielo con la foschia (l'orizzonte non finisce nel nero)", () => {
  assert.ok(costruisciStile({}).sky["sky-color"]);
});
test("le basi del 3D sono tutte https e con tessere leggibili da WebGL (servizi con CORS verificati)", () => {
  for (const b of BASI_3D) for (const u of b.tiles) assert.match(u, /^https:\/\//);
  assert.deepEqual(BASI_3D.map((b) => b.id), ["sat", "topo", "osm"]);
});
test("le basi 3D corrispondono a basi che esistono anche sulla mappa 2D", () => {
  for (const b of BASI_3D) assert.ok(BASI.some((x) => x.id === b.id), b.id);
});
test("dalla base della mappa 2D si passa alla stessa base 3D; le altre ripiegano sul satellite", () => {
  assert.equal(base3dDa2d("osm"), "osm"); assert.equal(base3dDa2d("topo"), "topo"); assert.equal(base3dDa2d("sat"), "sat");
  assert.equal(base3dDa2d("cyclosm"), "sat"); assert.equal(base3dDa2d("s2"), "sat"); assert.equal(base3dDa2d(undefined), "sat");
});
test("esagerazioni offerte: da ×1 (reale) a ×3, con ×1 per prima", () => {
  assert.deepEqual(ESAGERAZIONI, [1, 1.5, 2, 3]);
});

console.log("ingrandimento");
test("Leaflet (256 px) e MapLibre (512 px) differiscono di un livello, e la conversione è reversibile", () => {
  assert.equal(zoomMapLibre(14), 13); assert.equal(zoomLeaflet(13), 14);
  for (const z of [3, 9.5, 17]) assert.equal(zoomLeaflet(zoomMapLibre(z)), z);
});

console.log("indirizzi delle tessere");
test("leggiZxy legge z/x/y dai protocolli dell'app", () => {
  assert.deepEqual(leggiZxy("amdem://13/4389/2999"), { z: 13, x: 4389, y: 2999 });
  assert.deepEqual(leggiZxy(`${PROTOCOLLO_LIDAR}://17/70000/48000`), { z: 17, x: 70000, y: 48000 });
  assert.throws(() => leggiZxy("amdem://abc"));
});
test("tessera LiDAR: WMS 1.1.1 in Web Mercator, 256 px, PNG trasparente, riquadro della tessera", () => {
  const u = urlTesseraLidar({ url: "http://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/servizi-LiDAR/LIDAR_MARCHE.map", livelli: "EL.LIDAR.MARCHE.1x1.DTM" }, 15, 17556, 11997);
  assert.match(u, /&SERVICE=WMS&VERSION=1\.1\.1&REQUEST=GetMap&LAYERS=EL\.LIDAR\.MARCHE\.1x1\.DTM&STYLES=&SRS=EPSG:3857&BBOX=/);
  assert.match(u, /&WIDTH=256&HEIGHT=256&FORMAT=image\/png&TRANSPARENT=true$/);
  const bb = /BBOX=([^&]+)/.exec(u)[1].split(",").map(Number);
  assert.ok(Math.abs(bb[2] - bb[0] - 1222.99) < 0.01 && Math.abs(bb[3] - bb[1] - 1222.99) < 0.01, bb.join(","));
});
test("l'indirizzo senza punto interrogativo ne riceve uno", () => {
  assert.match(urlTesseraLidar({ url: "https://x.it/wms", livelli: "a" }, 1, 0, 0), /^https:\/\/x\.it\/wms\?SERVICE=WMS/);
});

console.log("testo della quota");
test("metri interi, senza decimali (il dato è a 10 m)", () => {
  assert.equal(testoQuota(322.08), "322 m s.l.m."); assert.equal(testoQuota(0.4), "0 m s.l.m."); assert.equal(testoQuota(-2.6), "-3 m s.l.m.");
});
test("con l'esagerazione la quota letta si divide per il fattore", () => {
  assert.equal(testoQuota(644.16, 2), "322 m s.l.m."); assert.equal(testoQuota(966, 3), "322 m s.l.m.");
});
test("senza lettura dice che non c'è", () => {
  assert.equal(testoQuota(null), "quota non disponibile"); assert.equal(testoQuota(NaN), "quota non disponibile"); assert.equal(testoQuota(undefined), "quota non disponibile");
});

console.log(`\n${ok} controlli superati${process.exitCode ? ", ma ce ne sono di falliti" : ""}.`);
