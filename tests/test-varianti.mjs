// Varianti di richiesta per ortofoto e IGM. Esegui con: node tests/test-varianti.mjs
import assert from "node:assert/strict";
import { fusoPerLon, variantiPcn, variantiConPreferita, scegliVariante, fusoCambiato, zoomDiProva, urlConVariante } from "../js/varianti.js";
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

console.log("ingrandimento della prova");
test("la prova parte dall'ingrandimento della mappa, dentro i limiti del livello, e poi sale", () => {
  assert.deepEqual(zoomDiProva(16, { minZoom: 13, maxNativeZoom: 16 }), [16]);
  assert.deepEqual(zoomDiProva(14, { minZoom: 13, maxNativeZoom: 16 }), [14, 15, 16]);
  assert.deepEqual(zoomDiProva(8, { minZoom: 13, maxNativeZoom: 16 }), [13, 14, 15, 16]);
  assert.deepEqual(zoomDiProva(19, { minZoom: 13, maxNativeZoom: 16 }), [16]);
});
test("i tentativi più alti sono al massimo tre", () => {
  assert.equal(zoomDiProva(9, { minZoom: 9, maxNativeZoom: 18 }).length, 4);
});
test("senza limiti noti usa lo zoom della mappa", () => {
  assert.deepEqual(zoomDiProva(15, {}), [15, 16, 17, 18]);
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
test("l'IGM 1:25.000 non si chiede da lontano: il servizio non disegna sotto lo zoom 13 e ferma i dati al 16", () => {
  assert.ok(per("igm25").minZoom > per("igm100").minZoom);
  assert.equal(per("igm25").minZoom, 13);
  assert.equal(per("igm25").maxNativeZoom, 16);
});
test("ci sono il satellite storico Esri (sette rilasci, dal 2014 al 2026, con la data vera) e la carta topografica Esri", () => {
  for (const id of ["wb2014", "wb2016", "wb2018", "wb2020", "wb2022", "wb2024", "wb2026", "topoesri"]) {
    const d = per(id);
    assert.ok(d, id);
    assert.equal(d.tipo, "tile");
    assert.match(d.url, /\{z\}.*\{y\}.*\{x\}|\{z\}\/\{y\}\/\{x\}/);
    if (id.startsWith("wb")) assert.match(d.nota, /\d{1,2} \w+ 20\d\d/, `${id}: la nota dice la data del rilascio`);
  }
  assert.match(per("wb2014").url, /tile\/10\/\{z\}\/\{y\}\/\{x\}$/);
  assert.match(per("wb2026").url, /tile\/32246\/\{z\}\/\{y\}\/\{x\}$/);
  const rilasci = SOVRAPPOSIZIONI.filter((s) => s.id.startsWith("wb")).map((s) => s.url.match(/tile\/(\d+)\//)[1]);
  assert.equal(new Set(rilasci).size, rilasci.length, "ogni anno ha il suo rilascio");
});
test("le ortofoto storiche del Geoportale (1988, 1994, 2006) usano lo stesso meccanismo dei fusi", () => {
  for (const [id, famiglia] of [["orto1988", "OI.ORTOIMMAGINI.1988"], ["orto1994", "OI.ORTOIMMAGINI.1994"], ["orto2006", "OI.ORTOIMMAGINI.2006"]]) {
    const d = per(id);
    assert.ok(d, id);
    assert.equal(d.tipo, "wms");
    assert.equal(d.famiglia, famiglia);
    assert.ok(!d.livelli, "il livello lo decide la variante");
    assert.match(d.url, /^https:\/\/wms\.pcn\.minambiente\.it\/ogc\?map=\/ms_ogc\/WMS_v1\.3\/raster\/ortofoto_.*\.map$/);
  }
});
test("urlConVariante: stessa tessera, altri livelli, altra versione e il nome giusto del parametro del sistema di riferimento", () => {
  const url = "http://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/raster/IGM_25000.map&service=WMS&request=GetMap&layers=CB.IGM25000.32%2CCB.IGM25000.33&styles=&format=image%2Fpng&transparent=true&version=1.3.0&width=512&height=512&crs=EPSG%3A3857&bbox=1100000%2C5400000%2C1200000%2C5500000";
  const [, , c] = variantiPcn("CB.IGM25000", 12.9);
  const u = new URL(urlConVariante(url, c));
  assert.equal(u.searchParams.get("LAYERS"), "CB.IGM25000.33");
  assert.equal(u.searchParams.get("VERSION"), "1.1.1");
  assert.equal(u.searchParams.get("SRS"), "EPSG:3857");
  assert.equal(u.searchParams.get("CRS"), null, "in 1.1.1 il parametro è SRS");
  assert.equal(u.searchParams.get("bbox"), "1100000,5400000,1200000,5500000", "il riquadro non cambia");
  assert.equal(u.searchParams.get("map"), "/ms_ogc/WMS_v1.3/raster/IGM_25000.map");
  assert.equal(u.searchParams.get("layers"), null, "nessun parametro doppio con la maiuscola diversa");
  const [a] = variantiPcn("CB.IGM25000", 12.9);
  const v = new URL(urlConVariante(u.href, a));
  assert.equal(v.searchParams.get("CRS"), "EPSG:3857");
  assert.equal(v.searchParams.get("SRS"), null);
  assert.equal(v.searchParams.get("LAYERS"), "CB.IGM25000.32,CB.IGM25000.33");
});
test("sono «rapidi» (pulsanti sulla mappa) LiDAR, rilievo a colori, ortofoto, IGM, catasto e ombre", () => {
  const rapidi = SOVRAPPOSIZIONI.filter((s) => s.rapido).map((s) => s.id).sort();
  assert.deepEqual(rapidi, ["catasto", "igm25", "lidar", "ombre", "ombre-colori", "ortofoto"]);
});
test("LiDAR del Ministero (grigi) e rilievo a colori sono due livelli distinti, con nomi che lo dicono", () => {
  assert.match(per("lidar").nome, /LiDAR.*grigi/i);
  assert.match(per("ombre").nome, /grigi/i);
  assert.match(per("ombre-colori").nome, /colori/i);
  assert.equal(per("ombre-colori").livelli, "tinitaly_hsv");
  assert.equal(per("ombre").livelli, "tinitaly_hshd");
  assert.notEqual(per("lidar").tipo, per("ombre-colori").tipo);
  for (const id of ["svf", "pendenza"]) assert.equal(per(id).url, per("ombre").url, id);
});
test("cartografia storica regionale: catasto toscano, carta Inghirami, catasto 1858 dell'Alto Adige (WMS 1.3.0 con livello fisso)", () => {
  for (const [id, livello] of [["castore", "r_toscan_cst_fogli"], ["inghirami", "r_toscan_cst_inghirami"], ["bz1858", "p_bz-Cadastre-Historical:Cadastre1858-Map"]]) {
    const d = per(id);
    assert.ok(d, id);
    assert.equal(d.tipo, "wms");
    assert.equal(d.livelli, livello);
    assert.equal(d.versione, "1.3.0");
    assert.match(d.url, /^https:\/\//);
    assert.ok(!d.url.endsWith("&"), `${id}: l'indirizzo non finisce con «&»`);
    assert.match(d.attr, /Toscana|Bolzano/);
  }
  assert.ok(per("inghirami").maxNativeZoom <= 14, "la carta 1:200.000 non ha più dettaglio oltre");
});

console.log(`\n${ok} controlli eseguiti.`);
