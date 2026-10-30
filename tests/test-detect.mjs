// Prove del rilevatore di anomalie. Le prime sono su forme disegnate a mano (senza Python),
// le ultime sul rilievo sintetico (recinto, tumulo, aggere, collina naturale).
// Uso: node tests/test-detect.mjs [cartella-con-dtm]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { apriRilievo, estraiGriglia } from "../js/raster.js";
import { etichetta, distanzaDa, misuraForma, valuta, rileva, impostazioniPredefinite, descriviRegole, anomalieInGeoJSON, aPixel, daPixel } from "../js/detect.js";

let ok = 0;
const pendenti = [];
const test = (nome, fn) => pendenti.push(Promise.resolve().then(fn).then(() => { ok++; console.log("  ok  ", nome); }, (e) => { process.exitCode = 1; console.log("  FAIL", nome, "\n      ", e.stack.split("\n").slice(0, 3).join("\n       ")); }));

console.log("forme e morfologia");
test("etichetta: 8-connessione e due blocchi distinti", () => {
  const w = 8, h = 6, m = new Uint8Array(w * h);
  for (const [x, y] of [[0, 0], [1, 1], [2, 2], [6, 4], [7, 4], [7, 5]]) m[y * w + x] = 1;
  const { etichette, n } = etichetta(m, w, h);
  assert.equal(n, 2);
  assert.equal(etichette[0], etichette[2 * w + 2]);
  assert.notEqual(etichette[0], etichette[4 * w + 6]);
  assert.equal(etichette[w * 3 + 3], 0);
});
test("etichetta: forma a U si unisce in una sola componente", () => {
  const w = 7, h = 6, m = new Uint8Array(w * h);
  for (let y = 0; y < 5; y++) { m[y * w + 1] = 1; m[y * w + 5] = 1; }
  for (let x = 1; x <= 5; x++) m[4 * w + x] = 1;
  assert.equal(etichetta(m, w, h).n, 1);
});
test("distanzaDa: distanza in pixel dal punto acceso", () => {
  const w = 21, h = 21, m = new Uint8Array(w * h);
  m[10 * w + 10] = 1;
  const d = distanzaDa(m, w, h);
  assert.equal(d[10 * w + 10], 0);
  assert.ok(Math.abs(d[10 * w + 15] - 5) < 0.01);
  assert.ok(Math.abs(d[15 * w + 15] - 5 * Math.SQRT2) < 5 * 0.1, `${d[15 * w + 15]}`); // 3-4 sovrastima fino ~6%
  const vuota = distanzaDa(new Uint8Array(9), 3, 3);
  assert.equal(vuota[4], Infinity);
});

const forma = (w, h, f) => { const pix = []; const L = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y); if (v) { pix.push(y * w + x); L[y * w + x] = v; } } return { pix, L }; };

test("misuraForma: anello quadrato → molti vuoti interni, solidità alta, allungamento ~1", () => {
  const { pix, L } = forma(60, 60, (x, y) => { const d = Math.max(Math.abs(x - 30), Math.abs(y - 30)); return d <= 15 && d > 11 ? 1 : 0; });
  const f = misuraForma(pix, 60, L);
  assert.ok(f.vuotiFrazione > 0.35 && f.vuotiFrazione < 0.6, `vuoti ${f.vuotiFrazione}`);
  assert.ok(f.solidita > 0.9, `solidità ${f.solidita}`);
  assert.ok(f.allungamento < 1.15, `allungamento ${f.allungamento}`);
  assert.ok(f.rettangolarita > 0.9);
  assert.equal(f.positivi, 1);
});
test("misuraForma: il contorno è in pixel della griglia (non della finestra locale della forma)", () => {
  const { pix, L } = forma(200, 200, (x, y) => (Math.hypot(x - 150, y - 120) <= 10 ? 1 : 0));
  const f = misuraForma(pix, 200, L);
  const xs = f.hull.map((p) => p[0]), ys = f.hull.map((p) => p[1]);
  assert.ok(Math.min(...xs) >= 139 && Math.max(...xs) <= 162, `x ${Math.min(...xs)}–${Math.max(...xs)}`);
  assert.ok(Math.min(...ys) >= 109 && Math.max(...ys) <= 132, `y ${Math.min(...ys)}–${Math.max(...ys)}`);
});
test("misuraForma: segmento lungo → allungamento alto, lunghezza ~100, larghezza ~3", () => {
  const { pix, L } = forma(140, 40, (x, y) => (x >= 20 && x < 120 && y >= 18 && y < 21 ? -1 : 0));
  const f = misuraForma(pix, 140, L);
  assert.ok(f.allungamento > 10, `${f.allungamento}`);
  assert.ok(Math.abs(f.lunghezza - 100) < 3 && Math.abs(f.larghezza - 3) < 1, `${f.lunghezza}×${f.larghezza}`);
  assert.equal(f.positivi, 0);
  assert.ok(f.rms < 1.2);
});
test("misuraForma: disco → circolarità alta, nessun vuoto", () => {
  const { pix, L } = forma(60, 60, (x, y) => ((x - 30) ** 2 + (y - 30) ** 2 <= 100 ? 1 : 0));
  const f = misuraForma(pix, 60, L);
  assert.ok(f.circolarita > 0.8, `${f.circolarita}`);
  assert.ok(f.vuotiFrazione === 0 && f.allungamento < 1.1);
  assert.ok(Math.abs(f.centro[0] - 30) < 0.5 && Math.abs(f.centro[1] - 30) < 0.5);
});

console.log("regole di classificazione");
const impF = impostazioniPredefinite(2);
const base = { area: 0, piena: 0, vuotiFrazione: 0, allungamento: 1, lunghezza: 0, larghezza: 0, solidita: 1, rettangolarita: 1, circolarita: 0.9, positivi: 1, contrasto: 0.5, rms: 1 };
test("valuta: anello di 160 m con contorno chiuso → recinto", () => {
  const v = valuta({ ...base, piena: 160 * 160, area: 160 * 160 * 0.3, vuotiFrazione: 0.7, allungamento: 1.05, positivi: 0.6 }, impF, 0.2);
  assert.equal(v?.codice, "recinto");
});
test("valuta: disco di 40 m positivo → tumulo; negativo → depressione", () => {
  const A = Math.PI * 20 * 20;
  assert.match(valuta({ ...base, piena: A, area: A }, impF, 0.2).tipo, /Tumulo/);
  assert.match(valuta({ ...base, piena: A, area: A, positivi: 0 }, impF, 0.2).tipo, /Depressione/);
});
test("valuta: striscia 500×8 m → lineare; un blocco 50×50 pieno e non circolare viene scartato", () => {
  const v = valuta({ ...base, piena: 4000, area: 4000, lunghezza: 500, larghezza: 8, allungamento: 15, circolarita: 0.1, solidita: 0.8 }, impF, 0.2);
  assert.equal(v?.codice, "lineare");
  assert.equal(valuta({ ...base, piena: 2500, area: 2500, circolarita: 0.78, solidita: 1, allungamento: 1.1, lunghezza: 50, larghezza: 50 }, { ...impF, circMaxM: 40 }, 0.2), null);
});
test("valuta: le categorie spente non producono risultati", () => {
  const A = Math.PI * 20 * 20;
  assert.equal(valuta({ ...base, piena: A, area: A }, { ...impF, circolari: false }, 0.2), null);
});
test("descriviRegole: elenco leggibile in italiano con soglia e dimensioni", () => {
  const r = descriviRegole(impF, 2, 0.23).join("\n");
  assert.match(r, /0,23 m/); assert.match(r, /Recinti/); assert.match(r, /Pixel del rilievo: 2 m/);
});

// ------------------------------------------------------------------ rilievo sintetico
const qui = dirname(fileURLToPath(import.meta.url));
let cartella = process.argv[2];
if (!cartella) {
  cartella = mkdtempSync(join(tmpdir(), "dem-"));
  try { execFileSync("python3", [join(qui, "..", "tools", "make_test_dem.py"), cartella], { stdio: "ignore" }); }
  catch { console.log("Python con numpy/tifffile non disponibile: prove sul rilievo sintetico saltate."); await Promise.all(pendenti); console.log(`\nSuperate ${ok} prove (senza rilievo sintetico).`); process.exit(process.exitCode ?? 0); }
}
const aFile = (nome) => Object.assign(new Blob([readFileSync(join(cartella, nome))]), { name: nome });
const verita = JSON.parse(readFileSync(join(cartella, "verita.json"), "utf8"));
console.log("rilievo sintetico (2 m)");

let meta, griglia, ris, t0;
const prepara = async () => {
  if (ris) return;
  meta = await apriRilievo(aFile("dtm_2m_deflate.tif"));
  const [lat, lon] = meta.proiezione.aLatLon(761500, 4733500);
  griglia = await estraiGriglia(meta, lat, lon, 1500);
  t0 = performance.now();
  ris = rileva(griglia, impostazioniPredefinite(griglia.cella));
  ris.ms = performance.now() - t0;
};
const posizione = (nome) => { const [x, y] = verita.strutture[nome]; return [x, y]; };
const distUtm = (a, lat, lon, g) => { const [x, y] = g.proiezione.daLatLon(lat, lon); return Math.hypot(x - a[0], y - a[1]); };

test("il contorno di ogni anomalia sta attorno al suo centro (non in un angolo dell'area)", async () => {
  await prepara();
  assert.ok(ris.anomalie.length >= 2);
  for (const a of ris.anomalie) {
    for (const [la, lo] of a.geom.coord) {
      const d = distUtm(griglia.proiezione.daLatLon(a.lat, a.lon), la, lo, griglia);
      assert.ok(d <= a.dimensioneM, `anomalia ${a.id} (${a.codice}): un vertice dista ${d.toFixed(0)} m dal centro, dimensione ${a.dimensioneM.toFixed(0)} m`);
    }
  }
});
test("GeoJSON con il confronto con la foto: esito, p e nota per ogni anomalia; senza confronto nessuna proprietà foto", () => {
  const a = { id: 7, tipo: "Struttura circolare", codice: "circolare", punteggio: 0.8, polarita: "positiva", dimensioneM: 30, areaM2: 700, contrastoM: 0.4, sitoNotoM: null, tagliata: false, lat: 43.3, lon: 12.9, geom: { tipo: "poligono", coord: [[43.3, 12.9], [43.3, 12.901], [43.301, 12.9]] } };
  const senza = anomalieInGeoJSON([a], {}, "m");
  assert.ok(!Object.keys(senza.features[0].properties).some((k) => k.startsWith("foto_")));
  const con = anomalieInGeoJSON([a], {}, "m", new Map([[7, { esito: "solo-lidar", p: 0.61, contrasto: 1.2, vegetazione: true, spostamentoPx: [1, -1], motivo: "Nessun segno." }]]));
  const p = con.features[0].properties;
  assert.equal(p.foto_esito, "solo-lidar");
  assert.equal(p.foto_p, 0.61);
  assert.equal(p.foto_vegetazione, true);
  assert.equal(p.foto_spostamento_px, "1,-1");
  assert.equal(p.foto_nota, "Nessun segno.");
});
test("trova il recinto entro 20 m dal centro vero", async () => {
  await prepara();
  const r = ris.anomalie.filter((a) => a.codice === "recinto").map((a) => ({ a, d: distUtm(posizione("recinto"), a.lat, a.lon, griglia) })).sort((p, q) => p.d - q.d)[0];
  assert.ok(r, `nessun recinto; trovati: ${ris.anomalie.map((a) => a.tipo).join(", ")}`);
  assert.ok(r.d < 20, `distanza ${r.d.toFixed(1)} m`);
  assert.ok(r.a.dimensioneM > 130 && r.a.dimensioneM < 200, `dimensione ${r.a.dimensioneM}`);
});
test("trova il tumulo entro 12 m dal centro vero e lo dice positivo", async () => {
  await prepara();
  const r = ris.anomalie.filter((a) => a.codice === "circolare").map((a) => ({ a, d: distUtm(posizione("tumulo"), a.lat, a.lon, griglia) })).sort((p, q) => p.d - q.d)[0];
  assert.ok(r, `nessuna struttura circolare; trovati: ${ris.anomalie.map((a) => a.tipo + " " + Math.round(a.dimensioneM)).join(", ")}`);
  assert.ok(r.d < 12, `distanza ${r.d.toFixed(1)} m`);
  assert.equal(r.a.polarita, "positiva");
});
test("trova l'aggere: la linea passa entro 15 m dal punto centrale vero", async () => {
  await prepara();
  const lin = ris.anomalie.filter((a) => a.codice === "lineare");
  assert.ok(lin.length, "nessun tracciato lineare");
  const p = posizione("aggere");
  let migliore = Infinity;
  for (const a of lin) for (const [la, lo] of a.geom.coord) { const [x, y] = griglia.proiezione.daLatLon(la, lo); migliore = Math.min(migliore, Math.hypot(x - p[0], y - p[1])); }
  assert.ok(migliore < 15, `distanza minima ${migliore.toFixed(1)} m`);
  assert.ok(Math.max(...lin.map((a) => a.dimensioneM)) > 350, "aggere troppo corto");
});
test("la collina naturale e le ondulazioni non diventano anomalie (falsi positivi ≤ 1)", async () => {
  await prepara();
  const veri = ["recinto", "tumulo", "aggere"].map(posizione);
  const estranei = ris.anomalie.filter((a) => !veri.some((p) => distUtm(p, a.lat, a.lon, griglia) < 250));
  assert.ok(estranei.length <= 1, `estranei: ${estranei.map((a) => `${a.tipo} ${Math.round(a.dimensioneM)}m @${distUtm([760000 + 0.15 * 3000, 4735000 - 0.8 * 3000], a.lat, a.lon, griglia).toFixed(0)}m dalla collina`).join("; ")}`);
});
test("le tre strutture sono fra le prime posizioni per confidenza", async () => {
  await prepara();
  assert.ok(ris.anomalie.length >= 3 && ris.anomalie.length <= 8, `${ris.anomalie.length} risultati`);
  assert.ok(ris.anomalie[0].punteggio >= ris.anomalie.at(-1).punteggio);
  assert.deepEqual(ris.anomalie.map((a) => a.id), ris.anomalie.map((_, i) => i + 1));
});
test("tempo: 2,25 milioni di pixel in meno di 20 s in Node", async () => {
  await prepara();
  assert.ok(ris.ms < 20000, `${(ris.ms / 1000).toFixed(1)} s`);
  console.log(`        (${(ris.ms / 1000).toFixed(1)} s, soglia ${ris.soglia.toFixed(3)} m, ${ris.nComponenti} componenti, ${ris.anomalie.length} risultati)`);
});

console.log("filtri");
test("sito noto vicino al tumulo → scartato e contato", async () => {
  await prepara();
  const [x, y] = posizione("tumulo");
  const [lat, lon] = griglia.proiezione.aLatLon(x + 50, y);
  const r = rileva(griglia, impostazioniPredefinite(griglia.cella), { siti: [{ lat, lon }] });
  assert.ok(!r.anomalie.some((a) => a.codice === "circolare" && distUtm(posizione("tumulo"), a.lat, a.lon, griglia) < 30));
  assert.ok(r.scartate.sitoNoto >= 1);
  assert.equal(r.anomalie.length, ris.anomalie.length - r.scartate.sitoNoto);
});
test("edificio sopra il recinto → scartato (e solo lui)", async () => {
  await prepara();
  const [x, y] = posizione("recinto");
  const ang = [[-100, -100], [100, -100], [100, 100], [-100, 100]].map(([dx, dy]) => griglia.proiezione.aLatLon(x + dx, y + dy));
  const r = rileva(griglia, impostazioniPredefinite(griglia.cella), { edifici: [ang] });
  assert.ok(!r.anomalie.some((a) => a.codice === "recinto"));
  assert.ok(r.scartate.edificio >= 1);
  assert.ok(r.anomalie.some((a) => a.codice === "circolare") && r.anomalie.some((a) => a.codice === "lineare"));
});
test("strada lungo l'aggere → aggere scartato; strada altrove no", async () => {
  await prepara();
  const L = 3000, ox = 760000, oy = 4735000;
  const a = griglia.proiezione.aLatLon(ox + L * 0.12, oy - L * 0.10), b = griglia.proiezione.aLatLon(ox + L * 0.12 + 470, oy - (L * 0.10 + 190));
  const r = rileva(griglia, impostazioniPredefinite(griglia.cella), { strade: [[a, b]] });
  assert.ok(!r.anomalie.some((q) => q.codice === "lineare" && q.dimensioneM > 350));
  assert.ok(r.scartate.strada >= 1);
  const c = griglia.proiezione.aLatLon(ox + 2000, oy - 2800), d = griglia.proiezione.aLatLon(ox + 2900, oy - 2800);
  const r2 = rileva(griglia, impostazioniPredefinite(griglia.cella), { strade: [[c, d]] });
  assert.equal(r2.anomalie.length, ris.anomalie.length);
});
test("soglia di contrasto impostata a mano molto alta → nessun risultato; categorie spente → assenti", async () => {
  await prepara();
  assert.equal(rileva(griglia, { ...impostazioniPredefinite(2), contrastoM: 50 }).anomalie.length, 0);
  const r = rileva(griglia, { ...impostazioniPredefinite(2), recinti: false, lineari: false });
  assert.ok(r.anomalie.every((a) => a.codice === "circolare"));
});
test("conversioni pixel↔lat/lon coerenti", async () => {
  await prepara();
  const [c, r] = aPixel(griglia, ...griglia.proiezione.aLatLon(761500, 4733500));
  const [lat, lon] = daPixel(griglia, c, r);
  const [x, y] = griglia.proiezione.daLatLon(lat, lon);
  assert.ok(Math.hypot(x - 761500, y - 4733500) < 1e-3);
});

console.log("esportazione e casi limite");
test("GeoJSON: tipi di geometria validi, anelli chiusi, coordinate [lon,lat] italiane", async () => {
  await prepara();
  const gj = anomalieInGeoJSON(ris.anomalie, { sorgente: "prova" });
  assert.equal(gj.type, "FeatureCollection");
  assert.equal(gj.features.length, ris.anomalie.length);
  for (const f of gj.features) {
    const g = f.geometry;
    assert.ok(g.type === "LineString" || g.type === "Polygon");
    if (g.type === "Polygon") assert.deepEqual(g.coordinates[0][0], g.coordinates[0].at(-1));
    const [lon, lat] = g.type === "Polygon" ? g.coordinates[0][0] : g.coordinates[0];
    assert.ok(lon > 6 && lon < 19 && lat > 36 && lat < 48);
    assert.ok(f.properties.confidenza >= 0.5 && f.properties.confidenza <= 1);
  }
});
test("rilievo tutto nodata o piatto → nessun risultato e nessun errore", async () => {
  await prepara();
  const n = 100 * 100;
  const proiezione = griglia.proiezione;
  const g0 = { dati: new Float32Array(n).fill(NaN), w: 100, h: 100, cella: 2, origine: { x: 760000, y: 4735000 }, proiezione };
  const r0 = rileva(g0, impostazioniPredefinite(2));
  assert.equal(r0.anomalie.length, 0); assert.ok(r0.avvisi.length);
  const g1 = { ...g0, dati: new Float32Array(n).fill(300) };
  assert.equal(rileva(g1, impostazioniPredefinite(2)).anomalie.length, 0);
});

console.log("rilievo sintetico (10 m, profilo grossolano)");
test("a 10 m (profilo grossolano) restano visibili recinto, tumulo e aggere, senza estranei", async () => {
  const m = await apriRilievo(aFile("dtm_10m.tif"));
  const [lat, lon] = m.proiezione.aLatLon(761500, 4733500);
  const g = await estraiGriglia(m, lat, lon, 1500);
  assert.equal(g.cella, 10);
  const imp = impostazioniPredefinite(g.cella);
  assert.equal(imp.profilo, "grossolano");
  const r = rileva(g, imp);
  console.log(`        (10 m: soglia ${r.soglia.toFixed(2)} m, ${r.anomalie.length} risultati: ${r.anomalie.map((a) => a.tipo + " " + Math.round(a.dimensioneM) + "m").join(", ") || "—"})`);
  const vicino = (nome, codice, tol) => r.anomalie.some((a) => a.codice === codice && distUtm(posizione(nome), a.lat, a.lon, g) < tol);
  assert.ok(vicino("recinto", "recinto", 30), "recinto non trovato a 10 m");
  assert.ok(vicino("tumulo", "circolare", 25), "tumulo non trovato a 10 m");
  assert.ok(r.anomalie.some((a) => a.codice === "lineare" && a.dimensioneM > 350), "aggere non trovato a 10 m");
  assert.ok(r.anomalie.length <= 4, `troppi risultati: ${r.anomalie.length}`);
});

await Promise.all(pendenti);
console.log(process.exitCode ? "\nAlcune prove NON superate." : `\nTutte le prove del rilevatore superate (${ok}).`);
