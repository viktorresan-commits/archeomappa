// «Spegni tutto» come interruttore: spegne i livelli accesi e al tocco successivo li riaccende. Esegui con: node tests/test-interruttore.mjs
import assert from "node:assert/strict";
import { decidiSpegniTutto, ricordatiValidi } from "../js/interruttore.js";

let ok = 0;
const test = (nome, fn) => {
  try { fn(); ok++; console.log("  ok  ", nome); } catch (e) { process.exitCode = 1; console.error("  FAIL", nome, "\n      ", e.stack.split("\n").slice(0, 3).join("\n       ")); }
};

console.log("che cosa fa il tocco");
test("con livelli accesi: li spegne e li ricorda", () => {
  assert.deepEqual(decidiSpegniTutto(["lidar", "catasto"], []), { azione: "spegni", ids: ["lidar", "catasto"] });
});
test("con livelli accesi e un elenco vecchio: vale quello di adesso (non si riaccende roba stantia)", () => {
  assert.deepEqual(decidiSpegniTutto(["igm25"], ["lidar", "ombre"]), { azione: "spegni", ids: ["igm25"] });
});
test("senza livelli accesi e con un elenco ricordato: li riaccende, nell'ordine in cui erano", () => {
  assert.deepEqual(decidiSpegniTutto([], ["catasto", "lidar"]), { azione: "riaccendi", ids: ["catasto", "lidar"] });
});
test("senza livelli accesi e nulla da riaccendere: non fa niente", () => {
  assert.deepEqual(decidiSpegniTutto([], []), { azione: "niente", ids: [] });
});
test("due tocchi di fila tornano al punto di partenza", () => {
  const partenza = ["lidar", "ortofoto"];
  const uno = decidiSpegniTutto(partenza, []);
  const due = decidiSpegniTutto([], uno.ids);
  assert.equal(due.azione, "riaccendi");
  assert.deepEqual(due.ids, partenza);
});
test("non modifica gli elenchi ricevuti", () => {
  const a = ["x"], r = ["y"];
  decidiSpegniTutto(a, r); decidiSpegniTutto([], r);
  assert.deepEqual(a, ["x"]); assert.deepEqual(r, ["y"]);
});

console.log("elenco ricordato");
test("toglie i livelli spariti (servizi personalizzati cancellati) e i doppioni", () => {
  assert.deepEqual(ricordatiValidi(["lidar", "gone", "lidar", "catasto"], new Set(["lidar", "catasto"])), ["lidar", "catasto"]);
});
test("un valore salvato rovinato (non è un elenco) diventa un elenco vuoto", () => {
  for (const v of [null, undefined, "lidar", { a: 1 }, 7]) assert.deepEqual(ricordatiValidi(v, new Set(["lidar"])), []);
});
test("ignora voci che non sono testo", () => {
  assert.deepEqual(ricordatiValidi(["lidar", 3, null, {}], new Set(["lidar"])), ["lidar"]);
});

console.log(`\n${ok} controlli eseguiti${process.exitCode ? ", CON ERRORI" : ", tutti superati"}.`);
