// Confronto a mano fra due livelli: cursore a tendina e lampeggio. Esegui con: node tests/test-tendina.mjs
import assert from "node:assert/strict";
import { clipTendina, creaConfrontoLivelli } from "../js/tendina.js";

let ok = 0;
const test = (nome, fn) => {
  try { fn(); ok++; console.log("  ok  ", nome); } catch (e) { process.exitCode = 1; console.error("  FAIL", nome, "\n      ", e.stack.split("\n").slice(0, 3).join("\n       ")); }
};

// ------------------------------------------------------------- finti: documento, mappa, livelli
function elemento() {
  const el = {
    style: {}, className: "", children: [], attributi: {}, ascoltatori: {}, tabIndex: 0, rimosso: false, textContent: "",
    appendChild(c) { el.children.push(c); c.genitore = el; return c; },
    remove() { el.rimosso = true; if (el.genitore) el.genitore.children = el.genitore.children.filter((x) => x !== el); },
    setAttribute(k, v) { el.attributi[k] = v; },
    addEventListener(t, f) { (el.ascoltatori[t] ??= []).push(f); },
    removeEventListener(t, f) { el.ascoltatori[t] = (el.ascoltatori[t] ?? []).filter((x) => x !== f); },
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 100, width: 800 }),
    emetti(t, ev = {}) { for (const f of el.ascoltatori[t] ?? []) f({ preventDefault() {}, stopPropagation() {}, pointerId: 1, ...ev }); },
  };
  return el;
}
function mappaFinta() {
  const contenitore = elemento();
  const gestori = {};
  const m = {
    scostamento: { x: 10, y: 20 }, trascinamento: true,
    getContainer: () => contenitore,
    getSize: () => ({ x: 800, y: 600 }),
    containerPointToLayerPoint(p) { const [x, y] = Array.isArray(p) ? p : [p.x, p.y]; return { x: x + m.scostamento.x, y: y + m.scostamento.y }; }, // come Leaflet: punto o coppia
    on(ev, f) { for (const e of ev.split(" ")) (gestori[e] ??= []).push(f); return m; },
    off(ev, f) { for (const e of ev.split(" ")) gestori[e] = (gestori[e] ?? []).filter((x) => x !== f); return m; },
    emetti(ev) { for (const f of gestori[ev] ?? []) f(); },
    nGestori: () => Object.values(gestori).reduce((a, v) => a + v.length, 0),
    dragging: { disable() { m.trascinamento = false; }, enable() { m.trascinamento = true; } },
  };
  return m;
}
const livello = (nome) => { const c = elemento(); return { nome, layer: { getContainer: () => c }, c }; };
const doc = { createElement: () => elemento() };

console.log("clip");
test("clipTendina: sinistra e destra di un cursore a metà, riferite al punto in alto a sinistra della mappa", () => {
  const nw = { x: 10, y: 20 }, se = { x: 810, y: 620 };
  assert.equal(clipTendina(nw, se, 0.5, "sinistra"), "rect(20px, 410px, 620px, 10px)");
  assert.equal(clipTendina(nw, se, 0.5, "destra"), "rect(20px, 810px, 620px, 410px)");
  assert.equal(clipTendina(nw, se, 0.25, "sinistra"), "rect(20px, 210px, 620px, 10px)");
});

console.log("cursore a tendina");
test("avvio: A tagliato a sinistra, B a destra; linea sulla mappa a metà", () => {
  const m = mappaFinta(), a = livello("Satellite"), b = livello("IGM");
  const c = creaConfrontoLivelli({ map: m, doc });
  c.avvia({ a, b, modo: "tendina" });
  assert.equal(a.c.style.clip, "rect(20px, 410px, 620px, 10px)");
  assert.equal(b.c.style.clip, "rect(20px, 810px, 620px, 410px)");
  const linea = m.getContainer().children[0];
  assert.equal(linea.style.left, "50%");
  assert.equal(c.attivo, true);
  assert.equal(c.modo, "tendina");
});
test("spostando la mappa o cambiando lo zoom il taglio segue", () => {
  const m = mappaFinta(), a = livello("A"), b = livello("B");
  creaConfrontoLivelli({ map: m, doc }).avvia({ a, b, modo: "tendina" });
  m.scostamento = { x: -40, y: 5 };
  m.emetti("move");
  assert.equal(a.c.style.clip, "rect(5px, 360px, 605px, -40px)");
  m.emetti("zoomend");
  assert.equal(b.c.style.clip, "rect(5px, 760px, 605px, 360px)");
});
test("trascinando la linea cambia la posizione (e la mappa non si sposta mentre si trascina)", () => {
  const m = mappaFinta(), a = livello("A"), b = livello("B");
  const c = creaConfrontoLivelli({ map: m, doc });
  c.avvia({ a, b, modo: "tendina" });
  const linea = m.getContainer().children[0];
  linea.emetti("pointerdown", { clientX: 500 });
  assert.equal(m.trascinamento, false);
  linea.emetti("pointermove", { clientX: 100 + 800 * 0.25 });
  assert.equal(Math.round(c.posizione * 100), 25);
  assert.equal(a.c.style.clip, "rect(20px, 210px, 620px, 10px)");
  assert.equal(linea.style.left, "25%");
  linea.emetti("pointerup");
  assert.equal(m.trascinamento, true);
  linea.emetti("pointermove", { clientX: 700 });
  assert.equal(Math.round(c.posizione * 100), 25, "dopo il rilascio non si muove più");
});
test("la posizione resta fra il 2% e il 98%; da tastiera le frecce spostano del 5%", () => {
  const m = mappaFinta(), a = livello("A"), b = livello("B");
  const c = creaConfrontoLivelli({ map: m, doc });
  c.avvia({ a, b, modo: "tendina" });
  c.impostaPosizione(-1); assert.equal(c.posizione, 0.02);
  c.impostaPosizione(3); assert.equal(c.posizione, 0.98);
  c.impostaPosizione(0.5);
  const linea = m.getContainer().children[0];
  linea.emetti("keydown", { key: "ArrowLeft" });
  assert.equal(Math.round(c.posizione * 100), 45);
  linea.emetti("keydown", { key: "ArrowRight" });
  linea.emetti("keydown", { key: "ArrowRight" });
  assert.equal(Math.round(c.posizione * 100), 55);
});
test("ferma: livelli di nuovo interi, linea e ascoltatori tolti", () => {
  const m = mappaFinta(), a = livello("A"), b = livello("B");
  const c = creaConfrontoLivelli({ map: m, doc });
  c.avvia({ a, b, modo: "tendina" });
  assert.ok(m.nGestori() > 0);
  c.ferma();
  assert.equal(a.c.style.clip, "");
  assert.equal(b.c.style.clip, "");
  assert.equal(m.getContainer().children.length, 0);
  assert.equal(m.nGestori(), 0);
  assert.equal(c.attivo, false);
  assert.doesNotThrow(() => c.ferma());
});

console.log("lampeggio");
test("a ogni intervallo si alternano A e B; i livelli non restano tagliati", () => {
  const m = mappaFinta(), a = livello("A"), b = livello("B");
  let tick = null, annullato = false;
  const c = creaConfrontoLivelli({ map: m, doc, ogni: (f, ms) => { tick = f; assert.ok(ms >= 400 && ms <= 2000); return 7; }, annulla: (t) => { assert.equal(t, 7); annullato = true; } });
  c.avvia({ a, b, modo: "lampeggio" });
  assert.equal(a.c.style.clip, "");
  assert.equal(a.c.style.visibility, "");
  assert.equal(b.c.style.visibility, "hidden");
  assert.equal(c.mostra, "A");
  tick();
  assert.equal(a.c.style.visibility, "hidden");
  assert.equal(b.c.style.visibility, "");
  assert.equal(c.mostra, "B");
  assert.equal(m.getContainer().children.length, 0, "nessuna linea nel lampeggio");
  c.ferma();
  assert.equal(annullato, true);
  assert.equal(a.c.style.visibility, "");
  assert.equal(b.c.style.visibility, "");
});
test("pausa ferma l'alternanza, scambia cambia a mano, riprendi la fa ripartire", () => {
  const m = mappaFinta(), a = livello("A"), b = livello("B");
  let tick = null, avviati = 0, annullati = 0;
  const c = creaConfrontoLivelli({ map: m, doc, ogni: (f) => { tick = f; avviati++; return avviati; }, annulla: () => { annullati++; } });
  c.avvia({ a, b, modo: "lampeggio" });
  c.pausa();
  assert.equal(c.inPausa, true);
  assert.equal(annullati, 1);
  c.scambia();
  assert.equal(c.mostra, "B");
  assert.equal(a.c.style.visibility, "hidden");
  c.riprendi();
  assert.equal(c.inPausa, false);
  assert.equal(avviati, 2);
});
test("passando da lampeggio a tendina (e viceversa) lo stato si ripulisce", () => {
  const m = mappaFinta(), a = livello("A"), b = livello("B");
  const c = creaConfrontoLivelli({ map: m, doc, ogni: () => 1, annulla: () => {} });
  c.avvia({ a, b, modo: "lampeggio" });
  c.impostaModo("tendina");
  assert.equal(a.c.style.visibility, "");
  assert.equal(b.c.style.visibility, "");
  assert.equal(a.c.style.clip, "rect(20px, 410px, 620px, 10px)");
  assert.equal(m.getContainer().children.length, 1);
  c.impostaModo("lampeggio");
  assert.equal(a.c.style.clip, "");
  assert.equal(m.getContainer().children.length, 0);
});
test("avviare un secondo confronto ferma il primo", () => {
  const m = mappaFinta(), a = livello("A"), b = livello("B"), c2 = livello("C"), d = livello("D");
  const c = creaConfrontoLivelli({ map: m, doc });
  c.avvia({ a, b, modo: "tendina" });
  c.avvia({ a: c2, b: d, modo: "tendina" });
  assert.equal(a.c.style.clip, "");
  assert.equal(m.getContainer().children.length, 1);
  assert.equal(c2.c.style.clip, "rect(20px, 410px, 620px, 10px)");
});
test("un livello senza contenitore (non ancora disegnato) non fa fallire il confronto", () => {
  const m = mappaFinta();
  const c = creaConfrontoLivelli({ map: m, doc });
  assert.doesNotThrow(() => c.avvia({ a: { nome: "A", layer: {} }, b: livello("B"), modo: "tendina" }));
});
test("etichetta: dice quale livello si vede (lampeggio) o i due livelli (cursore)", () => {
  const m = mappaFinta();
  const c = creaConfrontoLivelli({ map: m, doc, ogni: () => 1, annulla: () => {} });
  c.avvia({ a: livello("Satellite"), b: livello("IGM"), modo: "tendina" });
  assert.match(c.etichetta(), /Satellite.*IGM/);
  c.impostaModo("lampeggio");
  assert.match(c.etichetta(), /Satellite/);
  c.scambia();
  assert.match(c.etichetta(), /IGM/);
});

console.log(`\n${ok} controlli eseguiti.`);
