import assert from "node:assert/strict";
import { riempiVuoti, sfocaGauss, pendenza, ombreggiatura, lrm, svf, statisticheRobuste, coloraVisualizzazione, riproiettaPerMappa, direzioni } from "../js/visual.js";
import { creaProiezione } from "../js/proj.js";

let ok = 0;
const test = (nome, fn) => { try { fn(); ok++; console.log("  ok  ", nome); } catch (e) { process.exitCode = 1; console.log("  FAIL", nome, "\n      ", e.message); } };
const griglia = (w, h, f) => { const a = new Float32Array(w * h); for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) a[r * w + c] = f(c, r); return a; };

console.log("visualizzazioni");
test("riempi vuoti: copia il valore valido più vicino e segna la maschera", () => {
  const d = griglia(6, 6, (c) => c);
  d[2 * 6 + 2] = NaN; d[2 * 6 + 3] = NaN;
  const { pieno, valido } = riempiVuoti(d, 6, 6);
  assert.ok(pieno.every((v) => v === v));
  assert.equal(valido[2 * 6 + 2], 0); assert.equal(valido[0], 1);
  assert.ok(Math.abs(pieno[2 * 6 + 2] - 2) <= 1 && Math.abs(pieno[2 * 6 + 3] - 3) <= 1);
  assert.equal(riempiVuoti(new Float32Array(9).fill(NaN), 3, 3).vuoto, true);
});
test("sfocatura: conserva una costante e la media di un impulso", () => {
  const c = new Float32Array(50 * 50).fill(7);
  assert.ok(sfocaGauss(c, 50, 50, 4).every((v) => Math.abs(v - 7) < 1e-4));
  const imp = new Float32Array(81 * 81); imp[40 * 81 + 40] = 1;
  const s = sfocaGauss(imp, 81, 81, 5);
  let tot = 0; for (const v of s) tot += v;
  assert.ok(Math.abs(tot - 1) < 1e-3, String(tot));
  assert.ok(s[40 * 81 + 40] > s[40 * 81 + 50]);
});
test("pendenza di un piano inclinato del 10%: ≈5,71 gradi", () => {
  const z = griglia(20, 20, (c) => 0.1 * c * 5); // cella 5 m: 0,5 m ogni pixel
  const p = pendenza(z, 20, 20, 5);
  assert.ok(Math.abs(p[10 * 20 + 10] - Math.atan(0.1) * 180 / Math.PI) < 1e-3, String(p[210]));
});
test("ombreggiatura: un versante rivolto a ovest è chiaro con luce da ovest e scuro da est", () => {
  const z = griglia(20, 20, (c) => 0.2 * c); // sale verso est: il versante guarda a ovest
  const da270 = ombreggiatura(z, 20, 20, 1, { azimut: [270] })[210];
  const da90 = ombreggiatura(z, 20, 20, 1, { azimut: [90] })[210];
  // valori attesi con pendenza 11,3° e sole a 35°: cos(43,7°)=0,72 da ovest, 0,40 da est
  assert.ok(Math.abs(da270 - 0.723) < 0.01 && Math.abs(da90 - 0.402) < 0.01, `${da270} ${da90}`);
});
test("ombreggiatura: piano orizzontale = seno dell'altezza del sole, e il nord è in alto", () => {
  const piano = new Float32Array(100).fill(10);
  assert.ok(Math.abs(ombreggiatura(piano, 10, 10, 1, { altezza: 30 })[55] - 0.5) < 1e-6);
  const z = griglia(20, 20, (c, r) => 0.2 * (19 - r)); // quota cresce verso nord (righe in alto)
  const dalSud = ombreggiatura(z, 20, 20, 1, { azimut: [180] })[210]; // versante rivolto a sud
  const dalNord = ombreggiatura(z, 20, 20, 1, { azimut: [0] })[210];
  assert.ok(dalSud > dalNord, `${dalSud} ${dalNord}`);
});
test("direzioni equispaziate", () => assert.deepEqual(direzioni(4), [0, 90, 180, 270]));
test("LRM: piano ≈ 0, dosso > 0, buca < 0", () => {
  const w = 120, h = 120;
  const base = griglia(w, h, (c, r) => 0.05 * c + 0.03 * r);
  const dosso = griglia(w, h, (c, r) => base[r * w + c] + 2 * Math.exp(-((c - 60) ** 2 + (r - 60) ** 2) / (2 * 4 ** 2)));
  const buca = griglia(w, h, (c, r) => base[r * w + c] - 2 * Math.exp(-((c - 60) ** 2 + (r - 60) ** 2) / (2 * 4 ** 2)));
  const l0 = lrm(base, w, h, 12), l1 = lrm(dosso, w, h, 12), l2 = lrm(buca, w, h, 12);
  assert.ok(Math.abs(l0[60 * w + 60]) < 0.02);
  assert.ok(l1[60 * w + 60] > 1.2 && l2[60 * w + 60] < -1.2);
});
test("SVF: 1 su piano e su cima, basso in una buca profonda", () => {
  const piano = new Float32Array(41 * 41);
  assert.ok(svf(piano, 41, 41, 1, 8, 16)[20 * 41 + 20] > 0.999);
  const buca = griglia(41, 41, (c, r) => -6 * Math.exp(-((c - 20) ** 2 + (r - 20) ** 2) / (2 * 4 ** 2)));
  const cima = griglia(41, 41, (c, r) => 6 * Math.exp(-((c - 20) ** 2 + (r - 20) ** 2) / (2 * 4 ** 2)));
  assert.ok(svf(buca, 41, 41, 1, 12, 16)[20 * 41 + 20] < 0.9);
  assert.ok(svf(cima, 41, 41, 1, 12, 16)[20 * 41 + 20] > 0.99);
});
test("statistiche robuste ignorano i valori anomali", () => {
  let seme = 7;
  const unif = () => ((seme = (seme * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(unif() + 1e-12)) * Math.cos(2 * Math.PI * unif());
  const a = Float32Array.from({ length: 20000 }, () => 0.1 * gauss());
  for (let i = 0; i < 200; i++) a[i * 100] = 300; // 1% di valori assurdi
  const s = statisticheRobuste(a, null, 20000);
  assert.ok(Math.abs(s.mediana) < 0.01 && Math.abs(s.sigma - 0.1) < 0.02, JSON.stringify(s));
});
test("colori: nodata trasparente, LRM blu/arancio, scala simmetrica", () => {
  const v = Float32Array.from([-1, 0, 1, 0]);
  const valido = Uint8Array.from([1, 1, 1, 0]);
  const rgba = coloraVisualizzazione("lrm", v, valido, 4, 1, { scalaLrm: 1 });
  assert.equal(rgba[3 * 4 + 3], 0); assert.equal(rgba[3], 255);
  assert.ok(rgba[2] > rgba[0], "negativo bluastro");
  assert.ok(rgba[8] > rgba[10], "positivo arancio");
  assert.deepEqual([...rgba.slice(4, 7)], [255, 255, 255]);
});
// Baricentro (pesato dall'opacità) di ciò che è stato disegnato nell'immagine riproiettata, in gradi.
function baricentro(out) {
  const [[sud, ovest], [nord, est]] = out.bounds;
  let sa = 0, sc = 0, sr = 0;
  for (let i = 0; i < out.w * out.h; i++) { const a = out.rgba[i * 4 + 3]; if (!a) continue; sa += a; sc += a * (i % out.w + 0.5); sr += a * (Math.floor(i / out.w) + 0.5); }
  return { lon: ovest + (sc / sa / out.w) * (est - ovest), lat: nord - (sr / sa / out.h) * (nord - sud), massa: sa };
}
const rosso = (w, h, c, r) => { const a = new Uint8ClampedArray(w * h * 4); const o = (r * w + c) * 4; a[o] = 255; a[o + 3] = 255; return a; };

test("riproiezione: un pixel noto finisce nel punto giusto della mappa (baricentro entro 1/4 di pixel)", () => {
  const P = creaProiezione(32632);
  const w = 100, h = 100, cella = 2, origine = { x: 760000, y: 4735000 };
  const cm = 70, rm = 30;
  const out = riproiettaPerMappa(rosso(w, h, cm, rm), w, h, cella, origine, P);
  const b = baricentro(out);
  const attesa = P.aLatLon(origine.x + (cm + 0.5) * cella, origine.y - (rm + 0.5) * cella);
  const gradiPerM = 1 / 111195;
  assert.ok(Math.abs(b.lon - attesa[1]) < cella * 0.25 * gradiPerM / Math.cos(attesa[0] * Math.PI / 180), `lon ${b.lon} vs ${attesa[1]}`);
  assert.ok(Math.abs(b.lat - attesa[0]) < cella * 0.25 * gradiPerM, `lat ${b.lat} vs ${attesa[0]}`);
  assert.ok(out.rgba.every((v, i) => i % 4 !== 0 || v === 0 || v === 255 || out.rgba[i + 3] > 0), "colore solo dove c'è opacità");
});
test("riproiezione: il colore resta puro anche dove l'opacità è parziale (niente alone scuro ai bordi)", () => {
  const P = creaProiezione(32632);
  const w = 60, h = 60, origine = { x: 760000, y: 4735000 };
  const out = riproiettaPerMappa(rosso(w, h, 30, 30), w, h, 2, origine, P);
  for (let i = 0; i < out.w * out.h; i++) {
    if (out.rgba[i * 4 + 3] > 0) { assert.equal(out.rgba[i * 4], 255); assert.equal(out.rgba[i * 4 + 1], 0); }
  }
});
test("riproiezione: un tratto dritto resta dritto (niente scala di gradini dovuta alla rotazione UTM-Mercatore)", () => {
  const P = creaProiezione(32633); // Fabriano è nel fuso 33, a ~2° dal meridiano centrale: la griglia è ruotata di ~1,4°
  const w = 400, h = 400, cella = 1, origine = { x: 330000, y: 4810000 };
  const a = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) for (let c = 195; c < 205; c++) { const o = (r * w + c) * 4; a[o] = 200; a[o + 1] = 200; a[o + 2] = 200; a[o + 3] = 255; }
  const out = riproiettaPerMappa(a, w, h, cella, origine, P, 2400, { sovracampione: 1 });
  // la striscia è un segmento: la sua larghezza misurata in orizzontale non deve oscillare a salti di un pixel intero
  const larghezze = [];
  for (let r = 40; r < out.h - 40; r += 10) {
    let somma = 0; for (let c = 0; c < out.w; c++) somma += out.rgba[(r * out.w + c) * 4 + 3] / 255;
    larghezze.push(somma);
  }
  const min = Math.min(...larghezze), max = Math.max(...larghezze);
  assert.ok(max - min < 0.35, `larghezza da ${min.toFixed(2)} a ${max.toFixed(2)} pixel`);
});
test("riproiezione: con il sovracampionamento l'immagine ha più pixel, entro il lato massimo", () => {
  const P = creaProiezione(32632);
  const w = 100, h = 100, origine = { x: 760000, y: 4735000 };
  const a1 = riproiettaPerMappa(rosso(w, h, 50, 50), w, h, 1, origine, P, 3000);
  const a2 = riproiettaPerMappa(rosso(w, h, 50, 50), w, h, 1, origine, P, 3000, { sovracampione: 2 });
  assert.ok(Math.abs(a2.w / a1.w - 2) < 0.05, `${a1.w} → ${a2.w}`);
  const a3 = riproiettaPerMappa(rosso(w, h, 50, 50), w, h, 1, origine, P, 150, { sovracampione: 2 });
  assert.ok(a3.w <= 150 + 1, `tetto ${a3.w}`);
  const a4 = riproiettaPerMappa(rosso(w, h, 50, 50), w, h, 1, origine, P, 50);
  assert.ok(a4.w <= 51, `riduzione ${a4.w}`);
});
test("riproiezione: fuori dall'area sorgente resta trasparente e il baricentro di un pixel è lo stesso a 1× e 2×", () => {
  const P = creaProiezione(32632);
  const w = 100, h = 100, cella = 2, origine = { x: 760000, y: 4735000 };
  const b1 = baricentro(riproiettaPerMappa(rosso(w, h, 70, 30), w, h, cella, origine, P, 3000));
  const b2 = baricentro(riproiettaPerMappa(rosso(w, h, 70, 30), w, h, cella, origine, P, 3000, { sovracampione: 2 }));
  assert.ok(Math.abs(b1.lon - b2.lon) < 4e-6 && Math.abs(b1.lat - b2.lat) < 3e-6, `${b1.lon},${b1.lat} / ${b2.lon},${b2.lat}`);
});

console.log(process.exitCode ? "\nPROVE FALLITE" : `\nTutte le prove delle visualizzazioni superate (${ok}).`);
