// Livelli del Ministero, adattamento http/https, proxy e client nativo. Esegui con: node tests/test-layers.mjs
import assert from "node:assert/strict";
import {
  SOVRAPPOSIZIONI, BASI, WMS_PCN, PCN_HOST, ambiente, normalizzaProxy, urlPerAmbiente, usaPcn, urlRegione, prodottiRegione, urlProva, creaLivello, urlTessera, tesseraDa,
} from "../js/layers.js";
import { fetchNativo } from "../js/util.js";
import { caricaCapabilities } from "../js/sources.js";
import worker, { richiestaAmmessa } from "../tools/proxy-pcn-worker.js";

let ok = 0;
const pendenti = [];
const segna = (n) => { ok++; console.log("  ok  ", n); };
const fallisce = (n, e) => { console.error("  FAIL", n, "\n      ", e.message); process.exitCode = 1; };
const test = (nome, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === "function") pendenti.push(r.then(() => segna(nome), (e) => fallisce(nome, e)));
    else segna(nome);
  } catch (e) {
    fallisce(nome, e);
  }
};

const lidar = SOVRAPPOSIZIONI.find((s) => s.id === "lidar");

console.log("ambiente");
test("pagina https: l'http non è consentito", () => {
  assert.deepEqual(ambiente({ location: { protocol: "https:" } }), { nativa: false, httpConsentito: false });
});
test("app Android (Capacitor su http://localhost): http consentito", () => {
  const amb = ambiente({ location: { protocol: "http:" }, Capacitor: { isNativePlatform: () => true } });
  assert.deepEqual(amb, { nativa: true, httpConsentito: true });
});
test("senza finestra (Node) si comporta come https", () => {
  assert.equal(ambiente({}).httpConsentito, false);
});

console.log("indirizzi del Ministero");
const marche = WMS_PCN + "servizi-LiDAR/LIDAR_MARCHE.map";
test("su https resta https", () => {
  assert.equal(urlPerAmbiente(marche, { amb: { httpConsentito: false } }), marche);
});
test("dove l'http è consentito diventa http, con ?map= intatto", () => {
  const u = urlPerAmbiente(marche, { amb: { httpConsentito: true } });
  assert.equal(u, `http://${PCN_HOST}/ogc?map=/ms_ogc/WMS_v1.3/servizi-LiDAR/LIDAR_MARCHE.map`);
});
test("con il proxy passa dal proxy, qualunque sia l'ambiente", () => {
  for (const httpConsentito of [true, false]) {
    assert.equal(urlPerAmbiente(marche, { amb: { httpConsentito }, proxy: " https://p.example.workers.dev/ " }),
      "https://p.example.workers.dev/pcn/ogc?map=/ms_ogc/WMS_v1.3/servizi-LiDAR/LIDAR_MARCHE.map");
  }
});
test("un proxy non https viene ignorato", () => {
  assert.equal(normalizzaProxy("http://p.example"), "");
  assert.equal(urlPerAmbiente(marche, { amb: { httpConsentito: false }, proxy: "http://p.example" }), marche);
});
test("gli altri servizi non vengono toccati", () => {
  const u = "https://wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php";
  assert.equal(urlPerAmbiente(u, { amb: { httpConsentito: true }, proxy: "https://p.example" }), u);
  assert.equal(urlPerAmbiente(undefined), undefined);
  assert.equal(usaPcn("non è un indirizzo"), false);
});

console.log("LiDAR: regioni e livelli");
test("Marche e Umbria hanno i livelli presi dall'app che li usa", () => {
  assert.deepEqual(prodottiRegione(lidar, "MARCHE").map((p) => p.livello), [
    "EL.LIDAR.MARCHE.1x1.DTM", "EL.LIDAR.MARCHE.1x1.DSM_LAST", "EL.LIDAR.MARCHE.1x1.DSM_FIRST", "EL.LIDAR.MARCHE.2x2.DTM",
  ]);
  assert.deepEqual(prodottiRegione(lidar, "UMBRIA").map((p) => p.livello), [
    "EL.LIDAR.UMBRIA.1x1.DTM", "EL.LIDAR.UMBRIA.1x1.T1.DTM", "EL.LIDAR.UMBRIA.1x1.T1.DSM_FIRST",
  ]);
  assert.deepEqual(prodottiRegione(lidar, "LAZIO"), []);
});
test("il file dell'Umbria è LIDAR_UMBRIA_2.map, gli altri seguono il modello", () => {
  assert.ok(urlRegione(lidar, "UMBRIA").endsWith("servizi-LiDAR/LIDAR_UMBRIA_2.map"));
  assert.ok(urlRegione(lidar, "MARCHE").endsWith("servizi-LiDAR/LIDAR_MARCHE.map"));
  assert.ok(urlRegione(lidar, "LAZIO").endsWith("servizi-LiDAR/LIDAR_LAZIO.map"));
});
test("ogni regione elencata ha un indirizzo valido; nessun duplicato", () => {
  assert.equal(new Set(lidar.regioni).size, lidar.regioni.length);
  for (const r of lidar.regioni) assert.doesNotThrow(() => new URL(urlRegione(lidar, r)));
});
test("il GetMap di prova usa SRS=EPSG:3857 con WMS 1.1.1 e il raggio richiesto", () => {
  const u = new URL(urlProva(urlRegione(lidar, "MARCHE"), "EL.LIDAR.MARCHE.1x1.DTM", "1.1.1", 250));
  assert.equal(u.searchParams.get("map"), "/ms_ogc/WMS_v1.3/servizi-LiDAR/LIDAR_MARCHE.map");
  assert.equal(u.searchParams.get("SRS"), "EPSG:3857");
  assert.equal(u.searchParams.get("CRS"), null);
  const [x0, y0, x1, y1] = u.searchParams.get("BBOX").split(",").map(Number);
  assert.ok(Math.abs(x1 - x0 - 500) < 1e-6 && Math.abs(y1 - y0 - 500) < 1e-6);
});
test("creaLivello costruisce un WMS 1.1.1 con livello e zoom nativo", () => {
  let visto;
  const L = { tileLayer: { wms: (url, o) => { visto = { url, o }; return {}; } } };
  creaLivello(L, lidar, { url: urlPerAmbiente(urlRegione(lidar, "MARCHE"), { amb: { httpConsentito: true } }), livelli: "EL.LIDAR.MARCHE.1x1.DTM" });
  assert.equal(visto.o.version, "1.1.1");
  assert.equal(visto.o.layers, "EL.LIDAR.MARCHE.1x1.DTM");
  assert.equal(visto.o.maxNativeZoom, 17);
  assert.ok(visto.url.startsWith("http://wms.pcn.minambiente.it/ogc?map="));
});
test("l'ortofoto ha la famiglia di livelli nota (uno per fuso): non serve leggere il servizio", () => {
  const o = SOVRAPPOSIZIONI.find((s) => s.id === "ortofoto");
  assert.equal(o.famiglia, "OI.ORTOIMMAGINI.2012");
  assert.match(o.url, /raster\/ortofoto_colore_12\.map$/);
});

console.log("tessere nel formato dell'app che già funziona");
// formule copiate dall'app di riferimento (piattaforma.js, remoteTileUrl)
const MEZZO = 20037508.342789244;
const bboxRif = (z, x, y) => { const size = (2 * MEZZO) / 2 ** z; const minx = -MEZZO + x * size, maxy = MEZZO - y * size; return [minx, maxy - size, minx + size, maxy].map((v) => v.toFixed(3)).join(","); };
const parametri = (u) => Object.fromEntries([...new URL(u).searchParams.entries()]);
test("tessera 3857: stessi parametri dell'app di riferimento", () => {
  const base = "http://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/servizi-LiDAR/LIDAR_MARCHE.map";
  const u = urlTessera({ url: base, livelli: "EL.LIDAR.MARCHE.1x1.DTM", versione: "1.1.1" }, 17, 70233, 48000);
  const rif = `${base}&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=EL.LIDAR.MARCHE.1x1.DTM&STYLES=&SRS=EPSG:3857&BBOX=${bboxRif(17, 70233, 48000)}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true`;
  assert.equal(u, rif);
});
test("tessera EPSG:4258 (catasto): stessi parametri e stesso ordine degli assi dell'app di riferimento", () => {
  const z = 17, x = 70233, y = 48000, n = 2 ** z;
  const lat = (yy) => Math.atan(Math.sinh(Math.PI * (1 - 2 * yy / n))) * 180 / Math.PI, lng = (xx) => xx / n * 360 - 180;
  const rif = `https://wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=&LAYERS=CP.CadastralParcel,fabbricati,strade,acque&CRS=EPSG:4258&BBOX=${lat(y + 1).toFixed(7)},${lng(x).toFixed(7)},${lat(y).toFixed(7)},${lng(x + 1).toFixed(7)}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true`;
  const c = SOVRAPPOSIZIONI.find((o) => o.id === "catasto");
  const u = urlTessera({ url: c.url, livelli: c.livelli, versione: c.versione, crs: c.crs }, z, x, y);
  assert.deepEqual(parametri(u), parametri(rif));
  assert.equal(c.livelli, "CP.CadastralParcel,fabbricati,strade,acque");
});
test("il catasto usa un livello con tessere calcolate in gradi (non il WMS di Leaflet)", () => {
  const c = SOVRAPPOSIZIONI.find((o) => o.id === "catasto");
  let creato = null;
  const L = { TileLayer: { extend: (proto) => class { constructor(u, o) { creato = { u, o, proto: this }; Object.assign(this, proto); this._getZoomForUrl = () => 17; } } }, tileLayer: { wms: () => { throw new Error("non doveva usare il WMS di Leaflet"); } } };
  const layer = creaLivello(L, c, { url: c.url, livelli: c.livelli });
  assert.equal(creato.o.minZoom, 15);
  const u = layer.getTileUrl({ x: 70233, y: 48000 });
  assert.match(u, /CRS=EPSG:4258&BBOX=43\.\d+,12\.\d+,43\.\d+,12\.\d+&WIDTH=256/);
});
test("tesseraDa: il punto sta dentro la tessera trovata", () => {
  for (const [lat, lon, z] of [[43.3, 12.9, 17], [41.9, 12.5, 12], [46.5, 11.3, 15]]) {
    const { x, y } = tesseraDa(lat, lon, z);
    const n = 2 ** z;
    const la = (yy) => Math.atan(Math.sinh(Math.PI * (1 - 2 * yy / n))) * 180 / Math.PI, lo = (xx) => xx / n * 360 - 180;
    assert.ok(lat <= la(y) && lat >= la(y + 1) && lon >= lo(x) && lon <= lo(x + 1), `${lat},${lon} z${z}`);
  }
});
test("la nota dell'IGM spiega che l'errore sugli indici è del server del Ministero", () => {
  const igm = SOVRAPPOSIZIONI.find((o) => o.id === "igm25");
  assert.equal(igm.famiglia, "CB.IGM25000");
  assert.match(igm.nota, /msShapefileOpen/);
});
test("il LiDAR sulla mappa chiede le tessere al doppio dei pixel (512 per una tessera da 256)", () => {
  const wms = { wmsParams: { width: 256, height: 256 } };
  const L = { tileLayer: { wms: () => wms } };
  creaLivello(L, lidar, { url: "http://x.example/ogc?map=a", livelli: "EL.LIDAR.MARCHE.1x1.DTM" });
  assert.equal(lidar.risoluzione, 2);
  assert.deepEqual([wms.wmsParams.width, wms.wmsParams.height], [512, 512]);
});
test("un livello senza «risoluzione» resta alla dimensione normale", () => {
  const wms = { wmsParams: { width: 256, height: 256 } };
  const L = { tileLayer: { wms: () => wms } };
  creaLivello(L, SOVRAPPOSIZIONI.find((o) => o.id === "ortofoto"), { livelli: "OI.ORTOIMMAGINI.2012.33", versione: "1.3.0" });
  assert.deepEqual([wms.wmsParams.width, wms.wmsParams.height], [256, 256]);
});
test("le «Ombre» usano TINITALY a 10 m (WMS 1.1.1, livello tinitaly_hshd, https) e Esri resta come ripiego", () => {
  const o = SOVRAPPOSIZIONI.find((s) => s.id === "ombre");
  assert.equal(o.tipo, "wms");
  assert.equal(o.livelli, "tinitaly_hshd");
  assert.equal(o.versione, "1.1.1");
  assert.match(o.url, /^https:\/\/tinitaly\.pi\.ingv\.it\/TINItaly_1_1\/wms$/);
  assert.equal(o.rapido, true);
  assert.match(o.attr, /INGV/);
  assert.match(o.attr, /CC BY 4\.0/);
  const e = SOVRAPPOSIZIONI.find((s) => s.id === "ombre-esri");
  assert.equal(e.tipo, "tile");
  assert.ok(!e.rapido);
  const p = parametri(urlProva(o.url, o.livelli, o.versione));
  assert.equal(p.SRS, "EPSG:3857");
  assert.equal(p.LAYERS, "tinitaly_hshd");
});
test("la richiesta TINITALY di prova è nello stesso formato di quella dell'app di riferimento", () => {
  const o = SOVRAPPOSIZIONI.find((s) => s.id === "ombre");
  const p = parametri(urlProva(o.url, o.livelli, o.versione));
  assert.deepEqual([p.SERVICE, p.VERSION, p.REQUEST, p.LAYERS, p.STYLES, p.FORMAT, p.TRANSPARENT.toUpperCase()], ["WMS", "1.1.1", "GetMap", "tinitaly_hshd", "", "image/png", "TRUE"]);
});

console.log("mappe di base");
test("ci sono otto mappe di base, con id unici, indirizzo con {z}/{x}/{y} e nome", () => {
  assert.equal(BASI.length, 8);
  assert.equal(new Set(BASI.map((b) => b.id)).size, BASI.length);
  for (const b of BASI) {
    assert.ok(b.nome && b.attr, b.id);
    assert.match(b.url, /^https:\/\//, `${b.id}: https`);
    assert.match(b.url, /\{z\}/); assert.match(b.url, /\{x\}/); assert.match(b.url, /\{y\}/);
  }
});
test("le nuove basi libere ci sono: CyclOSM, OSM Umanitaria, CARTO Voyager e Positron, Sentinel-2 senza nuvole", () => {
  const per = (id) => BASI.find((b) => b.id === id);
  for (const id of ["cyclosm", "hot", "voyager", "positron", "s2"]) assert.ok(per(id), id);
  assert.match(per("cyclosm").url, /tile-cyclosm\.openstreetmap\.fr\/cyclosm\//);
  assert.match(per("hot").url, /tile\.openstreetmap\.fr\/hot\//);
  assert.match(per("voyager").url, /basemaps\.cartocdn\.com\/rastertiles\/voyager\//);
  assert.match(per("positron").url, /basemaps\.cartocdn\.com\/light_all\//);
  assert.match(per("s2").url, /tiles\.maps\.eox\.at\/wmts\/1\.0\.0\/s2cloudless-2020_3857\/default\/g\/\{z\}\/\{y\}\/\{x\}\.jpg$/);
  assert.match(per("s2").nota, /non commerciale/i);
});
test("le basi senza CORS non chiedono crossOrigin (altrimenti il browser le rifiuta); le altre sì", () => {
  const visti = {};
  const L = { tileLayer: (url, o) => { visti[url] = o; return {}; } };
  for (const b of BASI) creaLivello(L, { ...b, tipo: "tile" });
  for (const b of BASI) assert.equal(visti[b.url].crossOrigin, !b.senzaCors, b.id);
  assert.ok(BASI.some((b) => b.senzaCors), "almeno una base senza CORS");
});

test("creaLivello passa versione e dimensione della tessera al WMS", () => {
  let visto = null;
  const L = { tileLayer: { wms: (url, o) => { visto = { url, o }; return {}; } } };
  creaLivello(L, SOVRAPPOSIZIONI.find((o) => o.id === "ortofoto"), { livelli: "OI.ORTOIMMAGINI.2012.33", versione: "1.3.0", tileSize: 512 });
  assert.equal(visto.o.version, "1.3.0");
  assert.equal(visto.o.tileSize, 512);
  assert.equal(visto.o.minZoom, 9);
  assert.equal(visto.o.layers, "OI.ORTOIMMAGINI.2012.33");
});

console.log("client nativo (app Android)");
test("fuori dall'app non c'è client nativo", () => {
  assert.equal(fetchNativo({}), null);
  assert.equal(fetchNativo({ Capacitor: { isNativePlatform: () => false } }), null);
});
test("nell'app il GetCapabilities passa dal client nativo", async () => {
  const chiamate = [];
  const win = {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { CapacitorHttp: { get: async (o) => { chiamate.push(o); return { status: 200, data: "<WMS_Capabilities><Capability><Layer><Name>x.y</Name><Title>X</Title></Layer></Capability></WMS_Capabilities>" }; } } },
    },
  };
  const f = fetchNativo(win);
  const cap = await caricaCapabilities("http://wms.example/ogc?map=/a.map", { impl: f });
  assert.deepEqual(cap.livelli, [{ name: "x.y", title: "X" }]);
  assert.equal(chiamate[0].responseType, "text");
  assert.ok(chiamate[0].url.includes("GetCapabilities") && chiamate[0].url.includes("map="));
});
test("il client nativo segnala gli errori HTTP", async () => {
  const f = fetchNativo({ Capacitor: { isNativePlatform: () => true, Plugins: { CapacitorHttp: { get: async () => ({ status: 503, data: "" }) } } } });
  await assert.rejects(caricaCapabilities("http://wms.example/ogc", { impl: f }), /503/);
});

console.log("proxy (tools/proxy-pcn-worker.js)");
const richiesta = (url, metodo = "GET") => new Request(url, { method: metodo });
const MAPPA = "https://p.example.workers.dev/pcn/ogc?map=/ms_ogc/WMS_v1.3/servizi-LiDAR/LIDAR_MARCHE.map&SERVICE=WMS&REQUEST=GetMap&LAYERS=EL.LIDAR.MARCHE.1x1.DTM";
test("ammette solo le mappe WMS del Geoportale", () => {
  assert.equal(richiestaAmmessa(new URL(MAPPA)), true);
  assert.equal(richiestaAmmessa(new URL("https://p.example/pcn/ogc?map=/etc/passwd")), false);
  assert.equal(richiestaAmmessa(new URL("https://p.example/pcn/ogc?map=/ms_ogc/WMS_v1.3/../../x.map")), false);
  assert.equal(richiestaAmmessa(new URL("https://p.example/pcn/ogc")), false);
  assert.equal(richiestaAmmessa(new URL("https://p.example/altro?map=/ms_ogc/WMS_v1.3/a.map")), false);
});
test("inoltra la richiesta al Ministero e aggiunge CORS", async () => {
  let inoltrato;
  const r = await worker.fetch(richiesta(MAPPA), {}, {}, async (u, o) => { inoltrato = { u, o }; return new Response("PNG", { status: 200, headers: { "content-type": "image/png" } }); });
  assert.equal(inoltrato.u, "http://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/servizi-LiDAR/LIDAR_MARCHE.map&SERVICE=WMS&REQUEST=GetMap&LAYERS=EL.LIDAR.MARCHE.1x1.DTM");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal(await r.text(), "PNG");
});
test("rifiuta richieste non ammesse senza chiamare il Ministero", async () => {
  let chiamato = false;
  const f = async () => { chiamato = true; return new Response("x"); };
  assert.equal((await worker.fetch(richiesta("https://p.example/pcn/ogc?map=/etc/passwd"), {}, {}, f)).status, 404);
  assert.equal((await worker.fetch(richiesta(MAPPA, "POST"), {}, {}, f)).status, 405);
  assert.equal(chiamato, false);
});
test("risponde alla verifica preliminare del browser (OPTIONS)", async () => {
  const r = await worker.fetch(richiesta(MAPPA, "OPTIONS"), {});
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});
test("se il Ministero non risponde restituisce 502 con CORS", async () => {
  const r = await worker.fetch(richiesta(MAPPA), {}, {}, async () => { throw new Error("rete"); });
  assert.equal(r.status, 502);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

await Promise.all(pendenti);
console.log(`\n${ok} controlli eseguiti${process.exitCode ? ", CON ERRORI" : ", tutti superati"}.`);
