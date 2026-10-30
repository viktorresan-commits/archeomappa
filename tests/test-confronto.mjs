// Confronto fra anomalie del LiDAR e un'immagine (satellite, ortofoto): dati sintetici.
// Esegui con: node tests/test-confronto.mjs
//
// La foto finta è definita nello spazio della griglia (pixel del rilievo), poi disegnata in Web Mercator
// come un vero servizio; se il ricampionamento fosse sbagliato (assi scambiati, scala sbagliata)
// i segni non finirebbero dove stanno le anomalie e i controlli sulla visibilità fallirebbero.
import assert from "node:assert/strict";
import { creaProiezione, mercatoreDiretta, mercatoreInversa } from "../js/proj.js";
import { daPixel } from "../js/detect.js";
import {
  campionaMosaico, luminanzaRgba, indiceVerde, formaDaAnomalia, confrontaConFoto, ETICHETTE_ESITO, zoomPerCella, riquadroMosaico,
} from "../js/confronto.js";

let ok = 0;
const test = (nome, fn) => {
  try { fn(); ok++; console.log("  ok  ", nome); } catch (e) { process.exitCode = 1; console.error("  FAIL", nome, "\n      ", e.stack.split("\n").slice(0, 3).join("\n       ")); }
};

// ---------------------------------------------------------------- strumenti di prova

const proj = creaProiezione(32633);
const LAT0 = 43.34, LON0 = 12.91; // Fabriano
const N = 400;
const [UX, UY] = proj.daLatLon(LAT0, LON0);
const grigliaBase = (cella = 1) => ({ w: N, h: N, cella, origine: { x: UX - (N * cella) / 2, y: UY + (N * cella) / 2 }, proiezione: proj });

function rng(seme) { let a = seme >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * Mosaico Web Mercator che copre la griglia con un margine; il colore di ogni pixel è dato da
 * f(c, r) → [R, G, B] nello spazio della griglia (c = colonna, r = riga).
 */
function mosaico(g, f, { passoM = 0.8, margineM = 60, solo = null } = {}) {
  const half = (g.w * g.cella) / 2 + margineM;
  const k = 1 / Math.cos((LAT0 * Math.PI) / 180);
  const [cx, cy] = mercatoreDiretta(LAT0, LON0);
  const lato = Math.round((2 * half) / passoM);
  const merc = [cx - half * k, cy - half * k, cx + half * k, cy + half * k];
  const rgba = new Uint8ClampedArray(lato * lato * 4);
  const dx = (merc[2] - merc[0]) / lato;
  for (let v = 0; v < lato; v++) {
    for (let u = 0; u < lato; u++) {
      const X = merc[0] + (u + 0.5) * dx, Y = merc[3] - (v + 0.5) * dx;
      const [la, lo] = mercatoreInversa(X, Y);
      const [x, y] = proj.daLatLon(la, lo);
      const c = (x - g.origine.x) / g.cella, r = (g.origine.y - y) / g.cella;
      const i = (v * lato + u) * 4;
      if (solo && !solo(c, r)) { rgba[i + 3] = 0; continue; }
      const [R, G, B] = f(c, r);
      rgba[i] = R; rgba[i + 1] = G; rgba[i + 2] = B; rgba[i + 3] = 255;
    }
  }
  return { rgba, w: lato, h: lato, merc };
}

const grigio = (v) => [v, v, v];
const rumore = (seme, sigma) => { const R = rng(seme); return () => (R() + R() + R() + R() - 2) * sigma * 1.73; };

/** Anomalia circolare di raggio rPx in (c, r) della griglia. */
function anomaliaDisco(g, id, c, r, rPx) {
  const coord = [];
  for (let k = 0; k < 24; k++) { const t = (k / 24) * 2 * Math.PI; coord.push(daPixel(g, c + rPx * Math.cos(t), r + rPx * Math.sin(t))); }
  const [lat, lon] = daPixel(g, c, r);
  return { id, tipo: "Struttura circolare", codice: "circolare", lat, lon, dimensioneM: 2 * rPx * g.cella, areaM2: Math.PI * rPx * rPx * g.cella ** 2, geom: { tipo: "poligono", coord } };
}
function anomaliaLinea(g, id, c0, r0, c1, r1) {
  const coord = [];
  for (let k = 0; k <= 10; k++) coord.push(daPixel(g, c0 + ((c1 - c0) * k) / 10, r0 + ((r1 - r0) * k) / 10));
  const [lat, lon] = daPixel(g, (c0 + c1) / 2, (r0 + r1) / 2);
  return { id, tipo: "Tracciato lineare", codice: "lineare", lat, lon, dimensioneM: Math.hypot(c1 - c0, r1 - r0) * g.cella, areaM2: Math.hypot(c1 - c0, r1 - r0) * g.cella * 4.4 * g.cella, geom: { tipo: "linea", coord } };
}
const esito = (ris, id) => ris.risultati.find((x) => x.id === id);

// ---------------------------------------------------------------- ricampionamento

console.log("ricampionamento del mosaico sulla griglia del rilievo");
test("un disco chiaro disegnato in Web Mercator ricade dove sta nella griglia (assi e scala giusti)", () => {
  const g = grigliaBase();
  const m = mosaico(g, (c, r) => grigio(Math.hypot(c - 120, r - 260) < 15 ? 230 : 90));
  const s = campionaMosaico(m, g);
  assert.equal(s.w, N);
  assert.equal(s.h, N);
  const lum = luminanzaRgba(s.rgba);
  assert.ok(lum[260 * N + 120] > 200, `centro ${lum[260 * N + 120]}`);
  assert.ok(lum[260 * N + 150] < 110, "fuori dal disco");
  assert.ok(lum[120 * N + 260] < 110, "scambio righe e colonne");
  assert.ok(lum[260 * N + 138] < 150 && lum[260 * N + 132] > 200, "bordo a circa 15 pixel");
});
test("dove il mosaico non arriva i pixel risultano non validi (luminanza NaN)", () => {
  const g = grigliaBase();
  const m = mosaico(g, () => grigio(120), { margineM: 0 });
  // si toglie la metà destra del mosaico
  for (let v = 0; v < m.h; v++) for (let u = m.w >> 1; u < m.w; u++) m.rgba[(v * m.w + u) * 4 + 3] = 0;
  const lum = luminanzaRgba(campionaMosaico(m, g).rgba);
  assert.ok(Number.isFinite(lum[200 * N + 50]));
  assert.ok(Number.isNaN(lum[200 * N + 350]));
});
test("indice di verde: erba alta, terra nuda bassa", () => {
  const v = indiceVerde(new Uint8ClampedArray([60, 140, 50, 255, 150, 110, 90, 255]));
  assert.ok(v[0] > 0.2, `${v[0]}`);
  assert.ok(v[1] < 0.05, `${v[1]}`);
});
test("zoom delle tessere: il pixel della foto non è più grande di quello del rilievo", () => {
  assert.equal(zoomPerCella(1, 43.34), 17); // 0,87 m
  assert.equal(zoomPerCella(2, 43.34), 16);
  assert.equal(zoomPerCella(0.5, 43.34), 18);
  assert.ok(zoomPerCella(0.1, 43.34) <= 19);
});
test("riquadro del mosaico: copre la griglia con un margine, in metri Mercatore", () => {
  const g = grigliaBase();
  const r = riquadroMosaico(g, 40);
  const [cx, cy] = mercatoreDiretta(LAT0, LON0);
  assert.ok(r[0] < cx && r[2] > cx && r[1] < cy && r[3] > cy);
  const k = 1 / Math.cos((LAT0 * Math.PI) / 180);
  assert.ok((r[2] - r[0]) / k > N + 70, `${(r[2] - r[0]) / k}`);
});

// ---------------------------------------------------------------- forme

console.log("forma dell'anomalia in pixel");
test("un disco di raggio 10: nucleo ≈ 314 px, anello e bordo attorno, tutto relativo al centro", () => {
  const g = grigliaBase();
  const f = formaDaAnomalia(anomaliaDisco(g, 1, 200, 200, 10), g);
  assert.ok(f.dentro.length / 2 > 220 && f.dentro.length / 2 < 330, `dentro ${f.dentro.length / 2}`);
  assert.ok(f.fuori.length / 2 > 50, `fuori ${f.fuori.length / 2}`);
  assert.ok(f.bordo.length / 2 > 40, `bordo ${f.bordo.length / 2}`);
  let sx = 0, sy = 0;
  for (let i = 0; i < f.dentro.length; i += 2) { sx += f.dentro[i]; sy += f.dentro[i + 1]; }
  assert.ok(Math.abs(sx / (f.dentro.length / 2)) < 1.2 && Math.abs(sy / (f.dentro.length / 2)) < 1.2, "centrato");
});
test("una linea: dentro è la linea stessa, fuori sta ai lati e non la tocca", () => {
  const g = grigliaBase();
  const f = formaDaAnomalia(anomaliaLinea(g, 1, 50, 300, 350, 300), g);
  assert.ok(f.dentro.length / 2 >= 280, `${f.dentro.length / 2}`);
  const occupato = new Set();
  for (let i = 0; i < f.dentro.length; i += 2) occupato.add(`${f.dentro[i]},${f.dentro[i + 1]}`);
  assert.ok(f.fuori.length / 2 > 500, `${f.fuori.length / 2}`);
  for (let i = 0; i < f.fuori.length; i += 2) {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) assert.ok(!occupato.has(`${f.fuori[i] + a},${f.fuori[i + 1] + b}`), "l'anello non tocca la linea");
  }
});

// ---------------------------------------------------------------- confronto

console.log("confronto con la foto");
const confronta = (g, m, anomalie, extra = {}) => confrontaConFoto({ anomalie, g, mosaico: m, passoFotoM: 0.8, ...extra });

test("un tumulo che si vede anche nella foto è «visibile anche nella foto»", () => {
  const g = grigliaBase();
  const R = rumore(7, 4);
  const m = mosaico(g, (c, r) => grigio(Math.round((Math.hypot(c - 200, r - 200) < 12 ? 150 : 110) + R())));
  const ris = confronta(g, m, [anomaliaDisco(g, 1, 200, 200, 12)]);
  const e = esito(ris, 1);
  assert.equal(e.esito, "anche-foto", JSON.stringify(e));
  assert.ok(e.p <= 0.05, `p ${e.p}`);
});
test("su una foto senza alcun segno la maggior parte delle anomalie risulta «solo nel LiDAR» e quasi nessuna «visibile»", () => {
  // «nessun segno» non è dimostrabile con una sola forma (il p di un'assenza è casuale): si guarda l'insieme
  const g = grigliaBase();
  const R = rumore(8, 4);
  const m = mosaico(g, () => grigio(Math.round(110 + R())));
  const P = rng(21);
  const an = [];
  for (let i = 1; i <= 20; i++) an.push(anomaliaDisco(g, i, 50 + Math.floor(P() * 300), 50 + Math.floor(P() * 300), 8 + Math.floor(P() * 8)));
  const ris = confronta(g, m, an);
  assert.ok(ris.riepilogo["solo-lidar"] >= 11, JSON.stringify(ris.riepilogo));
  assert.ok(ris.riepilogo["anche-foto"] <= 3, JSON.stringify(ris.riepilogo));
  for (const x of ris.risultati.filter((y) => y.esito === "solo-lidar")) assert.ok(x.p >= 0.25);
});
test("una trama forte ovunque (bosco, campi lavorati) non fa credere che le anomalie si vedano", () => {
  const g = grigliaBase();
  const R = rumore(9, 25);
  const m = mosaico(g, (c, r) => grigio(Math.round(120 + 30 * Math.sin(c / 2.2) * Math.sin(r / 2.7) + R())));
  const P = rng(31);
  const an = [];
  for (let i = 1; i <= 12; i++) an.push(anomaliaDisco(g, i, 50 + Math.floor(P() * 300), 50 + Math.floor(P() * 300), 8 + Math.floor(P() * 8)));
  const ris = confronta(g, m, an);
  assert.ok(ris.riepilogo["anche-foto"] <= 2, JSON.stringify(ris.riepilogo));
  const ps = ris.risultati.filter((x) => x.p != null).map((x) => x.p).sort((a, b) => a - b);
  assert.ok(ps[Math.floor(ps.length / 2)] > 0.2, `p mediano ${ps[Math.floor(ps.length / 2)]}`);
});
test("una strada che si vede nella foto lungo il tracciato è visibile; senza la strada no", () => {
  const g = grigliaBase();
  const R = rumore(10, 4);
  const con = mosaico(g, (c, r) => grigio(Math.round((Math.abs(r - 300) < 2.2 && c > 40 && c < 360 ? 175 : 110) + R())));
  const senza = mosaico(g, () => grigio(Math.round(110 + R())));
  const an = [anomaliaLinea(g, 1, 50, 300, 350, 300)];
  assert.equal(esito(confronta(g, con, an), 1).esito, "anche-foto");
  assert.equal(esito(confronta(g, senza, an), 1).esito, "solo-lidar");
});
test("se la foto non copre l'anomalia, o è uniforme, non si giudica", () => {
  const g = grigliaBase();
  const m = mosaico(g, () => grigio(110), { solo: (c) => c < 150 });
  const e1 = esito(confronta(g, m, [anomaliaDisco(g, 1, 300, 200, 12)]), 1);
  assert.equal(e1.esito, "non-valutabile");
  assert.match(e1.motivo, /non copre/i);
  const uniforme = mosaico(g, () => grigio(255));
  const e2 = esito(confronta(g, uniforme, [anomaliaDisco(g, 2, 200, 200, 12)]), 2);
  assert.equal(e2.esito, "non-valutabile");
  assert.match(e2.motivo, /uniform/i);
});
test("se la foto è troppo grossolana per la forma, non si giudica", () => {
  const g = grigliaBase();
  const R = rumore(11, 4);
  const m = mosaico(g, () => grigio(Math.round(110 + R())));
  const e = esito(confrontaConFoto({ anomalie: [anomaliaDisco(g, 1, 200, 200, 2.5)], g, mosaico: m, passoFotoM: 5 }), 1);
  assert.equal(e.esito, "non-valutabile");
  assert.match(e.motivo, /grossolana/i);
});
test("vegetazione: una foto verde lo dice, una foto di terra nuda no", () => {
  const g = grigliaBase();
  const R = rumore(12, 4);
  const verde = mosaico(g, () => [Math.round(60 + R()), Math.round(140 + R()), Math.round(50 + R())]);
  const terra = mosaico(g, () => [Math.round(150 + R()), Math.round(120 + R()), Math.round(95 + R())]);
  const an = [anomaliaDisco(g, 1, 200, 200, 12)];
  assert.equal(esito(confronta(g, verde, an), 1).vegetazione, true);
  assert.equal(esito(confronta(g, terra, an), 1).vegetazione, false);
  assert.match(esito(confronta(g, verde, an), 1).motivo, /vegetazione/i);
});
test("risultato ripetibile: stessi dati, stesso esito e stesso p", () => {
  const g = grigliaBase();
  const R = rumore(13, 4);
  const m = mosaico(g, (c, r) => grigio(Math.round((Math.hypot(c - 200, r - 200) < 12 ? 125 : 110) + R())));
  const an = [anomaliaDisco(g, 1, 200, 200, 12)];
  const a = esito(confronta(g, m, an), 1), b = esito(confronta(g, m, an), 1);
  assert.deepEqual(a, b);
});
test("riepilogo: conta gli esiti e dà un'etichetta per ciascuno", () => {
  const g = grigliaBase();
  const R = rumore(14, 4);
  const m = mosaico(g, (c, r) => grigio(Math.round((Math.hypot(c - 100, r - 100) < 12 ? 160 : 110) + R())));
  const ris = confronta(g, m, [anomaliaDisco(g, 1, 100, 100, 12), anomaliaDisco(g, 2, 300, 300, 12)]);
  assert.equal(ris.riepilogo["anche-foto"], 1);
  const somma = Object.values(ris.riepilogo).reduce((a, b) => a + b, 0);
  assert.equal(somma, 2);
  assert.equal(esito(ris, 1).esito, "anche-foto");
  assert.notEqual(esito(ris, 2).esito, "anche-foto");
  for (const k of ["solo-lidar", "anche-foto", "incerto", "non-valutabile"]) assert.ok(ETICHETTE_ESITO[k], k);
});

console.log("affidabilità statistica");
test("su una foto senza segni, pochi falsi «visibili»: al più il 15% di 40 forme casuali", () => {
  const g = grigliaBase();
  const R = rumore(15, 6);
  const m = mosaico(g, () => grigio(Math.round(110 + R())));
  const P = rng(99);
  const an = [];
  for (let i = 1; i <= 40; i++) an.push(anomaliaDisco(g, i, 40 + Math.floor(P() * 320), 40 + Math.floor(P() * 320), 6 + Math.floor(P() * 10)));
  const ris = confronta(g, m, an);
  const visibili = ris.risultati.filter((x) => x.esito === "anche-foto").length;
  assert.ok(visibili <= 6, `${visibili} falsi visibili su 40`);
});
test("con un segno di contrasto medio (3 volte il rumore) lo riconosce almeno nel 90% dei casi", () => {
  const g = grigliaBase();
  const R = rumore(16, 5);
  const P = rng(5);
  const centri = [];
  for (let i = 1; i <= 20; i++) centri.push([50 + Math.floor(P() * 300), 50 + Math.floor(P() * 300), 7 + Math.floor(P() * 8)]);
  const m = mosaico(g, (c, r) => {
    let dentro = false;
    for (const [cc, rr, rad] of centri) if (Math.hypot(c - cc, r - rr) < rad) dentro = true;
    return grigio(Math.round((dentro ? 126 : 110) + R()));
  });
  const ris = confronta(g, m, centri.map(([c, r, rad], i) => anomaliaDisco(g, i + 1, c, r, rad)));
  const visibili = ris.risultati.filter((x) => x.esito === "anche-foto").length;
  assert.ok(visibili >= 17, `${visibili} riconosciuti su 20`);
});
test("100 anomalie su 400×400 si confrontano in pochi secondi", () => {
  const g = grigliaBase();
  const R = rumore(17, 4);
  const m = mosaico(g, () => grigio(Math.round(110 + R())));
  const P = rng(3);
  const an = [];
  for (let i = 1; i <= 100; i++) an.push(anomaliaDisco(g, i, 40 + Math.floor(P() * 320), 40 + Math.floor(P() * 320), 5 + Math.floor(P() * 12)));
  const t0 = Date.now();
  confronta(g, m, an);
  const ms = Date.now() - t0;
  assert.ok(ms < 8000, `${ms} ms`);
});

console.log(`\n${ok} controlli eseguiti.`);
