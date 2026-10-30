// Levigatura dei gradini a 8 bit del servizio. Esegui con: node tests/test-dettaglio.mjs
import assert from "node:assert/strict";
import { dequantizza, passoDaLevigare, PASSO_MIN_M } from "../js/dettaglio.js";
import { ombreggiatura, direzioni, riempiVuoti } from "../js/visual.js";

let ok = 0;
const test = (nome, fn) => { try { fn(); ok++; console.log("  ok  ", nome); } catch (e) { process.exitCode = 1; console.log("  FAIL", nome, "\n      ", e.message); } };

const N = 240;
const cella = 1;
const griglia = (f) => { const a = new Float32Array(N * N); for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) a[r * N + c] = f(c, r); return a; };

// Terreno di prova: colline dolci, un versante lungo, un fossato stretto e un argine basso (dettagli da archeologia).
const fossato = (c) => -0.7 * Math.exp(-((c - 120) ** 2) / (2 * 1.6 ** 2)); // profondo 0,7 m, largo ~4 m
const argine = (r) => 0.45 * Math.exp(-((r - 60) ** 2) / (2 * 2.2 ** 2));
const vero = griglia((c, r) => 4 * Math.sin(c / 55) * Math.cos(r / 40) + 0.035 * c + 0.015 * r + (r > 100 && r < 200 ? fossato(c) : 0) + (c > 20 && c < 100 ? argine(r) : 0));
const quantizza = (z, passo) => z.map((v) => Math.round(v / passo) * passo);
const tutti = new Uint8Array(N * N).fill(1);

const luce = (z) => ombreggiatura(z, N, N, cella, { azimut: direzioni(8), altezza: 40, esagerazione: 2 });
const rms = (a, b, margine = 6) => {
  let s = 0, n = 0;
  for (let r = margine; r < N - margine; r++) for (let c = margine; c < N - margine; c++) { const d = a[r * N + c] - b[r * N + c]; s += d * d; n++; }
  return Math.sqrt(s / n);
};

console.log("levigatura dei gradini");
for (const passo of [0.25, 0.5, 1]) {
  test(`gradino ${passo} m: dopo la levigatura resta dentro mezzo gradino dal dato del servizio`, () => {
    const q = quantizza(vero, passo);
    const r = dequantizza(q, tutti, N, N, passo);
    assert.ok(r.scostamentoMax <= passo / 2 + 1e-4, `scostamento ${r.scostamentoMax}`);
  });
  test(`gradino ${passo} m: la superficie è più vicina al vero terreno di quella a gradini (errore in metri)`, () => {
    const q = quantizza(vero, passo);
    const l = dequantizza(q, tutti, N, N, passo).dati;
    const eq = rms(q, vero), el = rms(l, vero);
    console.log(`        errore sulle quote: gradini ${eq.toFixed(3)} m → levigato ${el.toFixed(3)} m`);
    assert.ok(el < eq * 0.85, `${el} non è < 85% di ${eq}`);
  });
  test(`gradino ${passo} m: l'ombreggiatura si avvicina a quella del vero terreno`, () => {
    const q = quantizza(vero, passo);
    const l = dequantizza(q, tutti, N, N, passo).dati;
    const sv = luce(vero);
    const eq = rms(luce(q), sv), el = rms(luce(l), sv);
    console.log(`        errore sulle ombre: gradini ${eq.toFixed(4)} → levigato ${el.toFixed(4)} (${(100 * (1 - el / eq)).toFixed(0)}% in meno)`);
    assert.ok(el < eq * 0.6, `${el} non è < 60% di ${eq}`);
  });
}

test("il fossato (0,7 m) resta profondo quasi quanto nel dato a gradini (non viene spianato)", () => {
  const passo = 0.5;
  const q = quantizza(vero, passo);
  const l = dequantizza(q, tutti, N, N, passo).dati;
  const riga = 150;
  const profondita = (z) => {
    let fuori = 0, k = 0;
    for (const c of [100, 101, 102, 138, 139, 140]) { fuori += z[riga * N + c]; k++; }
    return fuori / k - z[riga * N + 120];
  };
  const pq = profondita(q), pl = profondita(l), pv = profondita(vero);
  console.log(`        profondità del fossato: vero ${pv.toFixed(2)} m, gradini ${pq.toFixed(2)} m, levigato ${pl.toFixed(2)} m`);
  assert.ok(pl > pv - 0.3, `levigato ${pl}, vero ${pv}`);
});

test("un argine basso (0,45 m) non perde altezza rispetto al dato a gradini, a nessun gradino", () => {
  const altezza = (z) => z[60 * N + 60] - (z[50 * N + 60] + z[70 * N + 60]) / 2;
  for (const passo of [0.25, 0.5, 1]) {
    const q = quantizza(vero, passo);
    const l = dequantizza(q, tutti, N, N, passo).dati;
    console.log(`        argine, gradino ${passo} m: vero ${altezza(vero).toFixed(2)} m, gradini ${altezza(q).toFixed(2)} m, levigato ${altezza(l).toFixed(2)} m`);
    assert.ok(Math.abs(altezza(l) - altezza(vero)) <= Math.abs(altezza(q) - altezza(vero)) + 0.06, `gradino ${passo}`);
  }
});

test("un muro alto più di un gradino resta un muro (il bordo non si sfuma oltre mezzo gradino)", () => {
  const passo = 0.5;
  const z = griglia((c) => (c < N / 2 ? 0 : 2));
  const l = dequantizza(quantizza(z, passo), tutti, N, N, passo).dati;
  const r = 100, c0 = N / 2;
  assert.ok(Math.abs(l[r * N + c0 - 1] - 0) <= passo / 2 + 1e-4);
  assert.ok(Math.abs(l[r * N + c0] - 2) <= passo / 2 + 1e-4);
});

test("un terreno già continuo (gradino molto piccolo) non cambia in modo sensibile", () => {
  const passo = 0.01;
  const q = quantizza(vero, passo);
  const l = dequantizza(q, tutti, N, N, passo).dati;
  assert.ok(rms(l, q) < 0.006);
});

test("i pixel senza dato (riempiti) non vincolano e non vengono spostati", () => {
  const z = quantizza(vero, 0.5);
  const buco = new Float32Array(z);
  for (let r = 80; r < 100; r++) for (let c = 80; c < 100; c++) buco[r * N + c] = NaN;
  const { pieno, valido } = riempiVuoti(buco, N, N);
  const l = dequantizza(pieno, valido, N, N, 0.5);
  assert.ok(l.dati.every((v) => v === v));
  for (let r = 80; r < 100; r++) for (let c = 80; c < 100; c++) assert.equal(l.dati[r * N + c], pieno[r * N + c]);
});

test("passo nullo o non valido: restituisce il rilievo com'è", () => {
  const z = quantizza(vero, 0.5);
  for (const p of [0, -1, NaN, undefined]) {
    const r = dequantizza(z, tutti, N, N, p);
    assert.equal(r.iterazioni, 0);
    assert.deepEqual(Array.from(r.dati.slice(0, 50)), Array.from(z.slice(0, 50)));
  }
});

test("non modifica l'array di ingresso", () => {
  const z = quantizza(vero, 0.5);
  const copia = new Float32Array(z);
  dequantizza(z, tutti, N, N, 0.5);
  assert.deepEqual(z, copia);
});

console.log("gradino da levigare");
test("rilievo in metri: il gradino è un livello di grigio, ma solo se conta", () => {
  assert.equal(passoDaLevigare({ relativo: false, passoM: 0.8 }), 0.8);
  assert.equal(passoDaLevigare({ relativo: false, passoM: PASSO_MIN_M }), PASSO_MIN_M);
  assert.equal(passoDaLevigare({ relativo: false, passoM: 0.02 }), 0);
  assert.equal(passoDaLevigare({ relativo: false, passoM: null }), 0);
});
test("rilievo in livelli di grigio relativi: il gradino è 1", () => {
  assert.equal(passoDaLevigare({ relativo: true, passoM: null }), 1);
});

console.log(process.exitCode ? "\nPROVE FALLITE" : `\nTutte le prove della levigatura superate (${ok}).`);
