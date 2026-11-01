// Ripetizione delle tessere in errore. Esegui con: node tests/test-tessere-robuste.mjs
import assert from "node:assert/strict";
import { conRiprova, creaGestoreRiprove, pianoRimedi, rendiRobusto, ATTESE_RIPROVA } from "../js/tessere-robuste.js";
import { spiegaErroreServizio } from "../js/tessere.js";

let ok = 0;
const test = async (nome, fn) => {
  try { await fn(); ok++; console.log("  ok  ", nome); } catch (e) { process.exitCode = 1; console.error("  FAIL", nome, "\n      ", e.stack.split("\n").slice(0, 3).join("\n       ")); }
};

/** Livello finto: createTile crea una «tessera» che registra gli src assegnati; il test fa da browser chiamando t.fine(...). */
function livelloFinto({ alternative = null, win = {}, gestore, serieMax } = {}) {
  const assegnati = [];
  const pausa = [];
  const layer = {
    getTileUrl: (c) => `https://s/wms?z=${c.z}&x=${c.x}&y=${c.y}`,
    createTile(coords, fatto) {
      const t = { isConnected: true, naturalWidth: 256, fine: (err) => fatto(err, t) };
      Object.defineProperty(t, "src", { set(v) { assegnati.push(v); t._src = v; }, get() { return t._src; } });
      layer.ultima = t;
      return t;
    },
  };
  const stato = {};
  const g = rendiRobusto(layer, { win, stato, alternative, gestore: gestore ?? creaGestoreRiprove({ serieMax }), timer: (f, ms) => pausa.push({ f, ms }) });
  const chiusure = [];
  const crea = (c = { z: 5, x: 1, y: 2 }) => {
    const t = layer.createTile(c, (err, tt) => chiusure.push({ err, t: tt }));
    return t;
  };
  return { layer, stato, g, assegnati, pausa, chiusure, crea };
}

console.log("piano dei rimedi");
await test("conRiprova aggiunge un parametro (con ? o con &)", () => {
  assert.equal(conRiprova("https://s/a", 1), "https://s/a?amr=1");
  assert.equal(conRiprova("https://s/a?x=1", 2), "https://s/a?x=1&amr=2");
});
await test("nel browser: ripetizione dopo una pausa, altri formati subito, ultima ripetizione dopo una pausa più lunga", () => {
  const p = pianoRimedi("https://s/t?x=1", { alternative: ["https://s/alt1", "https://s/alt2"] });
  assert.deepEqual(p.map((v) => [v.url, v.attesa, v.nativo]), [
    ["https://s/t?x=1&amr=1", ATTESE_RIPROVA[0], false],
    ["https://s/alt1", 0, false],
    ["https://s/alt2", 0, false],
    ["https://s/t?x=1&amr=2", ATTESE_RIPROVA[1], false],
  ]);
});
await test("nell'app Android il primo rimedio è subito, con il client nativo", () => {
  const p = pianoRimedi("https://s/t", { conNativo: true });
  assert.deepEqual(p[0], { url: "https://s/t", attesa: 0, nativo: true });
  assert.ok(p.every((v) => v.nativo));
});
await test("il gestore: dopo una serie di tessere perse smette di insistere per la pausa, poi riprova", () => {
  let ora = 1000;
  const g = creaGestoreRiprove({ serieMax: 3, pausa: 500, adesso: () => ora });
  g.persa(); g.persa();
  assert.ok(g.puoRiprovare());
  g.persa();
  assert.ok(!g.puoRiprovare());
  ora += 499; assert.ok(!g.puoRiprovare());
  ora += 2; assert.ok(g.puoRiprovare());
  g.persa(); g.riuscita();
  assert.equal(g.serie, 0);
});

console.log("tessere nel browser");
await test("tessera che riesce subito: nessun rimedio", () => {
  const m = livelloFinto();
  const t = m.crea();
  t.fine(null);
  assert.equal(m.chiusure.length, 1);
  assert.equal(m.chiusure[0].err, null);
  assert.equal(m.stato.ok, 1);
  assert.equal(m.pausa.length, 0);
});
await test("un errore, poi la ripetizione dopo la pausa riesce: la tessera si chiude senza errore", () => {
  const m = livelloFinto();
  const t = m.crea();
  t.fine(new Error("x"));
  assert.equal(m.chiusure.length, 0, "non si chiude subito");
  assert.equal(m.pausa.length, 1);
  assert.equal(m.pausa[0].ms, ATTESE_RIPROVA[0]);
  m.pausa[0].f();
  assert.match(m.assegnati[0], /&amr=1$/);
  t.fine(null);
  assert.equal(m.chiusure.length, 1);
  assert.equal(m.chiusure[0].err, null);
  assert.equal(m.stato.riprese, 1);
});
await test("gli alternativi si provano subito, dopo la prima ripetizione, e sono al massimo due", () => {
  const m = livelloFinto({ alternative: (url) => ["A", "B", "C"] });
  const t = m.crea();
  t.fine(new Error("e1"));
  m.pausa.shift().f();            // amr=1
  t.fine(new Error("e2"));        // → «A» subito
  t.fine(new Error("e3"));        // → «B» subito
  t.fine(new Error("e4"));        // → ultima ripetizione dopo la pausa
  assert.deepEqual(m.assegnati.slice(1, 3), ["A", "B"]);
  assert.equal(m.pausa.length, 1);
  assert.equal(m.pausa[0].ms, ATTESE_RIPROVA[1]);
  m.pausa.shift().f();
  assert.match(m.assegnati.at(-1), /amr=2$/);
  assert.equal(m.chiusure.length, 0);
  const ultimo = new Error("e5");
  t.fine(ultimo);
  assert.equal(m.chiusure.length, 1);
  assert.equal(m.chiusure[0].err.message, "e1", "si riporta l'errore della prima richiesta");
});
await test("una tessera tolta dalla mappa durante la pausa non viene più toccata né chiusa", () => {
  const m = livelloFinto();
  const t = m.crea();
  t.fine(new Error("e"));
  t.isConnected = false;
  m.pausa.shift().f();
  assert.equal(m.assegnati.length, 0);
  assert.equal(m.chiusure.length, 0);
});
await test("l'immagine 1×1 che Leaflet mette per annullare una tessera non conta come riuscita", () => {
  const g = creaGestoreRiprove({ serieMax: 5 });
  const m = livelloFinto({ gestore: g });
  g.persa(); g.persa();
  const t = m.crea();
  t.naturalWidth = 1;
  t.fine(null);
  assert.equal(g.serie, 2, "la serie non si azzera");
  assert.equal(m.stato.ok, undefined);
  assert.equal(m.chiusure.length, 1);
});
await test("servizio che sbaglia in serie: dopo la serie massima le nuove tessere falliscono subito, senza insistere", () => {
  const m = livelloFinto({ serieMax: 2 });
  for (let i = 0; i < 2; i++) {
    const t = m.crea({ z: 5, x: i, y: 0 });
    t.fine(new Error("e"));
    for (let k = 0; k < 6 && m.chiusure.length <= i; k++) { m.pausa.shift()?.f(); t.fine(new Error("e")); }
  }
  assert.equal(m.chiusure.length, 2);
  const prima = m.assegnati.length;
  const t = m.crea({ z: 5, x: 9, y: 9 });
  t.fine(new Error("e"));
  assert.equal(m.chiusure.length, 3, "chiusa subito con errore");
  assert.equal(m.assegnati.length, prima, "nessuna richiesta in più");
});
await test("un livello senza createTile non si tocca", () => {
  assert.equal(rendiRobusto({}), null);
});

console.log("tessere nell'app Android (client nativo)");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const html = (t) => Buffer.from(`<?xml version='1.0'?><ServiceExceptionReport><ServiceException>${t}</ServiceException></ServiceExceptionReport>`).toString("base64");
const winNativa = (risposte) => ({
  Capacitor: { isNativePlatform: () => true, Plugins: { CapacitorHttp: { get: async ({ url }) => risposte.shift()(url) } } },
});
await test("il primo rimedio è il client nativo: se dà un'immagine la tessera la mostra", async () => {
  const win = winNativa([() => ({ status: 200, headers: { "Content-Type": "image/png" }, data: PNG })]);
  const m = livelloFinto({ win });
  const t = m.crea();
  t.fine(new Error("e"));
  await new Promise((r) => setTimeout(r, 5));
  assert.match(m.assegnati[0], /^data:image\/png;base64,/);
  assert.equal(m.stato.nativo, 1);
  t.fine(null);
  assert.equal(m.chiusure[0].err, null);
});
await test("se il server risponde con un errore interno lo si spiega e si passa al rimedio dopo", async () => {
  const msg = "msDrawMap(): Image handling error. Failed to draw layer named &#39;CB.IGM25000.33&#39;. msShapefileOpen(): Unable to access file.";
  const win = winNativa([
    () => ({ status: 200, headers: { "Content-Type": "application/vnd.ogc.se_xml" }, data: html(msg) }),
    () => ({ status: 200, headers: { "Content-Type": "application/vnd.ogc.se_xml" }, data: html(msg) }),
  ]);
  const m = livelloFinto({ win });
  const t = m.crea();
  t.fine(new Error("e"));
  await new Promise((r) => setTimeout(r, 5));
  assert.match(m.stato.messaggio, /guasto del servizio, non dell'app/);
  assert.match(m.stato.messaggio, /'CB\.IGM25000\.33'/, "l'apostrofo è vero, non «&#39;»");
  assert.equal(m.pausa.length, 1, "il rimedio successivo aspetta la pausa");
  m.pausa.shift().f();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(m.pausa.length, 1, "e poi l'ultimo");
});

console.log("messaggi dei servizi");
await test("l'errore msShapefileOpen e quello del mosaico si spiegano; il resto resta com'è", () => {
  assert.match(spiegaErroreServizio("msShapefileOpen(): Unable to access file. (WGS84_33\\TILEINDEX\\tile_33_BN88.shp)"), /file di indice/);
  assert.match(spiegaErroreServizio("msDrawRasterLayerLow(): Unable to access file. Corrupt, empty or missing file 'ETRF89_33\\mosaico.vrt'"), /mosaico/);
  assert.equal(spiegaErroreServizio("qualcos'altro"), "qualcos'altro");
  assert.equal(spiegaErroreServizio(undefined), "");
});

console.log(`\n${ok} controlli eseguiti.`);
