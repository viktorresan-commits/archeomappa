// Varianti di richiesta per ortofoto e IGM. Esegui con: node tests/test-varianti.mjs
import assert from "node:assert/strict";
import { fusoPerLon, variantiPcn, variantiConPreferita, scegliVariante, fusoCambiato } from "../js/varianti.js";
import { SOVRAPPOSIZIONI, urlTessera, WMS_PCN } from "../js/layers.js";
import { tuttoTrasparente } from "../js/tessere.js";

let ok = 0;
const segna = (n) => { ok++; console.log("  ok  ", n); };
const test = (nome, fn) => {
  try { fn(); segna(nome); } catch (e) { console.error("  FAIL", nome, "\n      ", e.message); process.exitCode = 1; }
};

console.log("fusi e varianti");
test("il fuso cambia a 12° est (Fabriano, 12,9° E, è nel 33; Torino nel 32)", () => {
  assert.equal(fusoPerLon(12.9), 33);
  assert.equal(fusoPerLon(7.7), 32);
  assert.equal(fusoPerLon(12), 33);
  assert.equal(fusoPerLon(11.99), 32);
});
test("cinque varianti, la prima è quella della app Grok (1.3.0, fusi insieme, 512 px)", () => {
  const v = variantiPcn("OI.ORTOIMMAGINI.2012", 12.9);
  assert.equal(v.length, 5);
  assert.deepEqual([v[0].versione, v[0].livelli, v[0].tile], ["1.3.0", "OI.ORTOIMMAGINI.2012.32,OI.ORTOIMMAGINI.2012.33", 512]);
});
test("le varianti a fuso singolo usano il fuso della longitudine, poi l'altro", () => {
  const v = variantiPcn("CB.IGM25000", 12.9);
  assert.equal(v[1].livelli, "CB.IGM25000.33");
  assert.equal(v[2].livelli, "CB.IGM25000.33");
  assert.equal(v[4].livelli, "CB.IGM25000.32");
  const w = variantiPcn("CB.IGM25000", 8);
  assert.equal(w[1].livelli, "CB.IGM25000.32");
  assert.equal(w[4].livelli, "CB.IGM25000.33");
});
test("c'è la variante dell'app di riferimento (1.1.1, un fuso, 256 px)", () => {
  const c = variantiPcn("OI.ORTOIMMAGINI.2012", 12.9).find((x) => x.id === "C");
  assert.deepEqual([c.versione, c.tile, c.livelli], ["1.1.1", 256, "OI.ORTOIMMAGINI.2012.33"]);
});
test("la variante già scelta passa in testa senza perdere le altre", () => {
  const v = variantiConPreferita("OI.ORTOIMMAGINI.2012", 12.9, "C");
  assert.equal(v[0].id, "C");
  assert.equal(v.length, 5);
  assert.deepEqual(v.map((x) => x.id).sort(), ["A", "B", "C", "D", "E"]);
  assert.equal(variantiConPreferita("OI.ORTOIMMAGINI.2012", 12.9, "Z")[0].id, "A");
});
test("scelta: la prima con immagine non vuota; se tutte vuote la prima che risponde; se nessuna, guasto", () => {
  const A = { id: "A" }, B = { id: "B" }, C = { id: "C" };
  assert.deepEqual(scegliVariante([{ variante: A, ok: false }, { variante: B, ok: true, vuota: false }, { variante: C, ok: true }]), { variante: B, stato: "ok" });
  assert.deepEqual(scegliVariante([{ variante: A, ok: true, vuota: true }, { variante: B, ok: true, vuota: true }]), { variante: A, stato: "vuota" });
  assert.deepEqual(scegliVariante([{ variante: A, ok: false }, { variante: B, ok: false }]), { variante: null, stato: "guasto" });
});

test("se il centro passa nell'altro fuso, una variante a fuso singolo va scelta di nuovo; quelle con i due fusi no", () => {
  const v = variantiPcn("OI.ORTOIMMAGINI.2012", 12.9);
  assert.equal(v[1].fuso, 33);
  assert.equal(v[0].fuso, null);
  assert.equal(fusoCambiato(v[1], 11.5), true);
  assert.equal(fusoCambiato(v[1], 12.5), false);
  assert.equal(fusoCambiato(v[0], 11.5), false);
  assert.equal(fusoCambiato(null, 11.5), false);
});

test("un'immagine tutta trasparente è «vuota»; un solo pixel opaco no", () => {
  const a = new Uint8ClampedArray(64 * 4);
  assert.equal(tuttoTrasparente(a), true);
  a[10 * 4 + 3] = 255;
  assert.equal(tuttoTrasparente(a), false);
});

console.log("richiesta a 512 px");
test("urlTessera accetta la dimensione dell'immagine e la scrive in WIDTH e HEIGHT", () => {
  const u = urlTessera({ url: WMS_PCN + "raster/ortofoto_colore_12.map", livelli: "OI.ORTOIMMAGINI.2012.33", versione: "1.3.0", px: 512 }, 12, 2200, 1500);
  assert.match(u, /VERSION=1\.3\.0/);
  assert.match(u, /CRS=EPSG:3857/);
  assert.match(u, /WIDTH=512&HEIGHT=512/);
  assert.match(urlTessera({ url: WMS_PCN, livelli: "x" }, 12, 1, 1), /WIDTH=256&HEIGHT=256/);
});

console.log("definizioni dei livelli");
const per = (id) => SOVRAPPOSIZIONI.find((s) => s.id === id);
test("ortofoto e IGM hanno una famiglia di livelli con i due fusi e uno zoom minimo", () => {
  assert.equal(per("ortofoto").famiglia, "OI.ORTOIMMAGINI.2012");
  assert.equal(per("igm25").famiglia, "CB.IGM25000");
  assert.equal(per("igm100").famiglia, "MB.IGM100000");
  for (const id of ["ortofoto", "igm25", "igm100"]) {
    assert.ok(per(id).minZoom >= 8, id);
    assert.equal(per(id).tipo, "wms");
    assert.ok(!per(id).livelli, `${id}: il livello lo decide la variante`);
  }
});
test("l'IGM 1:25.000 non si chiede da lontano (compare solo da vicino)", () => {
  assert.ok(per("igm25").minZoom > per("igm100").minZoom);
});
test("ci sono il satellite storico Esri (quattro rilasci) e la carta topografica Esri", () => {
  for (const id of ["wb2014", "wb2018", "wb2022", "wb2026", "topoesri"]) {
    const d = per(id);
    assert.ok(d, id);
    assert.equal(d.tipo, "tile");
    assert.match(d.url, /\{z\}.*\{y\}.*\{x\}|\{z\}\/\{y\}\/\{x\}/);
  }
  assert.match(per("wb2014").url, /tile\/10\/\{z\}\/\{y\}\/\{x\}$/);
  assert.match(per("wb2026").url, /tile\/32246\/\{z\}\/\{y\}\/\{x\}$/);
});
test("sono «rapidi» (pulsanti sulla mappa) LiDAR, ortofoto, IGM, catasto e ombre", () => {
  const rapidi = SOVRAPPOSIZIONI.filter((s) => s.rapido).map((s) => s.id).sort();
  assert.deepEqual(rapidi, ["catasto", "igm25", "lidar", "ombre", "ortofoto"]);
});

console.log(`\n${ok} controlli eseguiti.`);
