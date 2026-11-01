// Testo dei messaggi dei servizi: tag tolti, entità tradotte. Esegui con: node tests/test-testo.mjs
import assert from "node:assert/strict";
import { decodificaEntita, testoDaHtml } from "../js/testo.js";

let ok = 0;
const test = (nome, fn) => {
  try { fn(); ok++; console.log("  ok  ", nome); } catch (e) { process.exitCode = 1; console.error("  FAIL", nome, "\n      ", e.stack.split("\n").slice(0, 3).join("\n       ")); }
};

test("l'apostrofo numerico (&#39;) diventa un apostrofo: il messaggio vero del Ministero", () => {
  const msg = "msDrawMap(): Image handling error. Failed to draw layer named &#39;CB.IGM25000.32&#39;. msShapefileOpen(): Unable to access file.";
  assert.equal(testoDaHtml(msg), "msDrawMap(): Image handling error. Failed to draw layer named 'CB.IGM25000.32'. msShapefileOpen(): Unable to access file.");
});
test("entità con nome, decimali ed esadecimali", () => {
  assert.equal(decodificaEntita("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#233; &#xE9; &#x1F600;"), "a & b <c> \"d\" 'e' é é 😀");
});
test("le entità sconosciute o fuori misura restano come sono", () => {
  assert.equal(decodificaEntita("&boh; &#0; &#99999999; &"), "&boh; &#0; &#99999999; &");
});
test("i tag spariscono prima: «&lt;b&gt;» non diventa un tag da togliere dopo, resta testo", () => {
  assert.equal(testoDaHtml("<html><body><b>Errore</b> &lt;b&gt;x&lt;/b&gt;</body></html>"), "Errore <b>x</b>");
});
test("spazi e a capo si riducono; il testo si taglia alla lunghezza chiesta", () => {
  assert.equal(testoDaHtml("  uno \n\n  due\t tre  "), "uno due tre");
  assert.equal(testoDaHtml("abcdefghij", 4), "abcd");
});
test("valori non stringa non fanno cadere nulla", () => {
  assert.equal(testoDaHtml(null), "null");
  assert.equal(testoDaHtml(undefined, 5), "undef");
});

console.log(`\n${ok} controlli superati${process.exitCode ? ", ma ce ne sono di falliti" : ""}.`);
