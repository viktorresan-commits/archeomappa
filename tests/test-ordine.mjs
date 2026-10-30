// Ordine dei livelli sovrapposti (sopra/sotto). Esegui con: node tests/test-ordine.mjs
import assert from "node:assert/strict";
import { ORDINE_PREDEFINITO, ordineIniziale, spostaLivello, zIndexDi } from "../js/ordine.js";

let ok = 0;
const test = (nome, fn) => {
  try { fn(); ok++; console.log("  ok  ", nome); } catch (e) { process.exitCode = 1; console.error("  FAIL", nome, "\n      ", e.stack.split("\n").slice(0, 3).join("\n       ")); }
};

console.log("ordine iniziale");
test("senza ordine salvato: quello predefinito, poi i livelli non previsti in coda", () => {
  const o = ordineIniziale(["ombre", "catasto", "xyz", "lidar"], null);
  assert.equal(new Set(o).size, 4);
  assert.ok(o.indexOf("catasto") < o.indexOf("ombre"), "il catasto sta sopra l'ombreggiatura");
  assert.equal(o.at(-1), "xyz");
});
test("l'ordine salvato vince; i livelli nuovi vanno in cima; quelli spariti si tolgono", () => {
  const o = ordineIniziale(["a", "b", "c", "nuovo"], ["c", "gone", "a", "b"]);
  assert.deepEqual(o, ["nuovo", "c", "a", "b"]);
});
test("un ordine salvato rovinato (non è un elenco) si ignora", () => {
  const o = ordineIniziale(["catasto", "ombre"], { x: 1 });
  assert.equal(o.length, 2);
});
test("il catasto, il LiDAR e l'IGM stanno sopra l'ortofoto e i satelliti storici", () => {
  const o = ordineIniziale(["wb2014", "ortofoto", "igm25", "lidar", "catasto"], null);
  for (const alto of ["catasto", "igm25", "lidar"]) assert.ok(o.indexOf(alto) < o.indexOf("ortofoto"), alto);
  assert.ok(o.indexOf("ortofoto") < o.indexOf("wb2014"));
});

console.log("spostamento");
test("su: passa sopra il vicino", () => {
  assert.deepEqual(spostaLivello(["a", "b", "c"], "b", -1, new Set(["a", "b", "c"])), ["b", "a", "c"]);
});
test("giù: passa sotto il vicino", () => {
  assert.deepEqual(spostaLivello(["a", "b", "c"], "b", 1, new Set(["a", "b", "c"])), ["a", "c", "b"]);
});
test("un livello acceso salta quelli spenti: cambia davvero la sovrapposizione che si vede", () => {
  const acceso = new Set(["a", "d"]);
  assert.deepEqual(spostaLivello(["a", "b", "c", "d"], "d", -1, acceso), ["d", "a", "b", "c"]);
  assert.deepEqual(spostaLivello(["a", "b", "c", "d"], "a", 1, acceso), ["b", "c", "d", "a"]);
});
test("un livello spento si sposta di un posto", () => {
  assert.deepEqual(spostaLivello(["a", "b", "c", "d"], "c", -1, new Set(["a", "d"])), ["a", "c", "b", "d"]);
});
test("ai bordi non si muove; un livello sconosciuto non cambia nulla", () => {
  assert.deepEqual(spostaLivello(["a", "b"], "a", -1, new Set()), ["a", "b"]);
  assert.deepEqual(spostaLivello(["a", "b"], "b", 1, new Set()), ["a", "b"]);
  assert.deepEqual(spostaLivello(["a", "b"], "zz", 1, new Set()), ["a", "b"]);
});
test("se sopra (o sotto) non ci sono altri livelli accesi, un livello acceso va in cima (o in fondo)", () => {
  assert.deepEqual(spostaLivello(["a", "b", "c"], "c", -1, new Set(["c"])), ["c", "a", "b"]);
  assert.deepEqual(spostaLivello(["a", "b", "c"], "a", 1, new Set(["a"])), ["b", "c", "a"]);
});
test("l'elenco di partenza non viene modificato", () => {
  const o = ["a", "b", "c"];
  spostaLivello(o, "b", -1, new Set());
  assert.deepEqual(o, ["a", "b", "c"]);
});

console.log("profondità");
test("il primo dell'elenco ha la profondità maggiore, tutte diverse e sopra le mappe di base", () => {
  const o = ["a", "b", "c"];
  assert.ok(zIndexDi(o, "a") > zIndexDi(o, "b") && zIndexDi(o, "b") > zIndexDi(o, "c"));
  assert.ok(zIndexDi(o, "c") >= 10);
  assert.equal(zIndexDi(o, "sconosciuto"), 10);
});

console.log(`\n${ok} controlli eseguiti.`);
