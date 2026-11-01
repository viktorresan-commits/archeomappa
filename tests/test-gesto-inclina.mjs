// Gesto per inclinare la mappa (due dita insieme verso l'alto). Esegui con: node tests/test-gesto-inclina.mjs
import assert from "node:assert/strict";
import { SOGLIE, collegaGestoInclina, creaRiconoscitore, creaRiconoscitoreMouse, inclinazioneIniziale } from "../js/gesto-inclina.js";

let ok = 0;
const test = (nome, fn) => {
  try { fn(); ok++; console.log("  ok  ", nome); } catch (e) { process.exitCode = 1; console.error("  FAIL", nome, "\n      ", e.stack.split("\n").slice(0, 3).join("\n       ")); }
};

// due dita a 120 px l'una dall'altra, in orizzontale, a metà di uno schermo da 390×780
const A0 = { id: 1, x: 140, y: 400 }, B0 = { id: 2, x: 260, y: 400 };
const due = (da, db) => [{ ...A0, x: A0.x + da[0], y: A0.y + da[1] }, { ...B0, x: B0.x + db[0], y: B0.y + db[1] }];
/** Esegue un gesto passo per passo: al passo k le dita sono a f(k) dal punto di partenza. Restituisce tutti i risultati non nulli. */
function esegui(r, passi, f) {
  const out = [];
  r.aggiorna("inizio", due([0, 0], [0, 0]));
  for (let k = 1; k <= passi; k++) { const e = r.aggiorna("movimento", f(k)); if (e) out.push(e); }
  r.aggiorna("fine", []);
  return out;
}

console.log("inclinazione riconosciuta");
test("due dita che salgono insieme in verticale: un'inclinazione, una sola volta", () => {
  const out = esegui(creaRiconoscitore(), 40, (k) => due([0, -3 * k], [0, -3 * k]));
  assert.equal(out.length, 1); assert.equal(out[0].tipo, "inclina");
  assert.ok(out[0].spostamento >= SOGLIE.spostamento && out[0].spostamento < SOGLIE.spostamento + 4, String(out[0].spostamento));
  assert.ok(Math.abs(out[0].centro.x - 200) < 1);
});
test("un po' di diagonale e una dita più veloce dell'altra vanno bene (come nella realtà)", () => {
  const out = esegui(creaRiconoscitore(), 40, (k) => due([k * 0.8, -3 * k], [k * 1.2, -2.2 * k]));
  assert.equal(out.length, 1);
});
test("anche con la distanza fra le dita che cambia un po' (≤14%)", () => {
  const out = esegui(creaRiconoscitore(), 40, (k) => due([-0.1 * k, -3 * k], [0.1 * k, -3 * k]));
  assert.equal(out.length, 1);
});
test("le dita salgono a scatti irregolari: decide una volta sola, quando supera la soglia", () => {
  const r = creaRiconoscitore(); r.aggiorna("inizio", due([0, 0], [0, 0]));
  assert.equal(r.aggiorna("movimento", due([0, -10], [0, -12])), null);
  assert.equal(r.aggiorna("movimento", due([0, -30], [0, -33])), null);
  assert.ok(r.aggiorna("movimento", due([0, -40], [0, -44])));
  assert.equal(r.aggiorna("movimento", due([0, -90], [0, -95])), null);
});

console.log("gesti che NON sono un'inclinazione");
test("pizzico per ingrandire: nessuna inclinazione", () => {
  assert.equal(esegui(creaRiconoscitore(), 40, (k) => due([-3 * k, -k], [3 * k, -k])).length, 0);
});
test("pizzico per rimpicciolire", () => {
  assert.equal(esegui(creaRiconoscitore(), 40, (k) => due([2 * k, -2 * k], [-2 * k, -2 * k])).length, 0);
});
test("trascinamento a due dita in orizzontale: no", () => {
  assert.equal(esegui(creaRiconoscitore(), 40, (k) => due([4 * k, 0], [4 * k, 0])).length, 0);
});
test("trascinamento a due dita in diagonale (≥45°): no", () => {
  assert.equal(esegui(creaRiconoscitore(), 40, (k) => due([3 * k, -3 * k], [3 * k, -3 * k])).length, 0);
});
test("due dita verso il basso: no (la mappa è già vista dall'alto)", () => {
  assert.equal(esegui(creaRiconoscitore(), 40, (k) => due([0, 3 * k], [0, 3 * k])).length, 0);
});
test("una dita su e una giù (rotazione): no", () => {
  assert.equal(esegui(creaRiconoscitore(), 40, (k) => due([0, -3 * k], [0, 3 * k])).length, 0);
});
test("una sola dita ferma e l'altra che sale: no", () => {
  assert.equal(esegui(creaRiconoscitore(), 40, (k) => due([0, 0], [0, -3 * k])).length, 0);
});
test("una dita sola che sale: no", () => {
  const r = creaRiconoscitore(); r.aggiorna("inizio", [A0]);
  for (let k = 1; k <= 40; k++) assert.equal(r.aggiorna("movimento", [{ ...A0, y: A0.y - 3 * k }]), null);
});
test("dita troppo vicine (un polpastrello grosso): no", () => {
  const r = creaRiconoscitore(); const a = { id: 1, x: 200, y: 400 }, b = { id: 2, x: 220, y: 400 };
  r.aggiorna("inizio", [a, b]);
  assert.equal(r.aggiorna("movimento", [{ ...a, y: 300 }, { ...b, y: 300 }]), null);
});
test("prima un pizzico e poi si sale in verticale: lo zoom ha la precedenza, nessuna inclinazione", () => {
  const r = creaRiconoscitore(); r.aggiorna("inizio", due([0, 0], [0, 0]));
  for (let k = 1; k <= 20; k++) r.aggiorna("movimento", due([-4 * k, 0], [4 * k, 0]));
  for (let k = 1; k <= 40; k++) assert.equal(r.aggiorna("movimento", due([-80, -3 * k], [80, -3 * k])), null);
});
test("una terza dita annulla il gesto", () => {
  const r = creaRiconoscitore(); r.aggiorna("inizio", due([0, 0], [0, 0]));
  assert.equal(r.aggiorna("movimento", [...due([0, -10], [0, -10]), { id: 3, x: 50, y: 50 }]), null);
  assert.equal(r.aggiorna("movimento", due([0, -80], [0, -80])), null);
});
test("se una dita si stacca a metà, il gesto finisce senza inclinare", () => {
  const r = creaRiconoscitore(); r.aggiorna("inizio", due([0, 0], [0, 0]));
  r.aggiorna("movimento", due([0, -10], [0, -10]));
  r.aggiorna("fine", [due([0, -10], [0, -10])[0]]);
  assert.equal(r.aggiorna("movimento", due([0, -80], [0, -80])), null);
});

console.log("più gesti di seguito");
test("dopo un gesto finito se ne può fare un altro", () => {
  const r = creaRiconoscitore();
  assert.equal(esegui(r, 40, (k) => due([0, -3 * k], [0, -3 * k])).length, 1);
  assert.equal(esegui(r, 40, (k) => due([0, -3 * k], [0, -3 * k])).length, 1);
});
test("un gesto annullato non impedisce il successivo", () => {
  const r = creaRiconoscitore();
  assert.equal(esegui(r, 40, (k) => due([-3 * k, 0], [3 * k, 0])).length, 0);
  assert.equal(esegui(r, 40, (k) => due([0, -3 * k], [0, -3 * k])).length, 1);
});

console.log("computer (Ctrl + trascinamento)");
test("Ctrl premuto e trascinamento verso l'alto: inclina", () => {
  const m = creaRiconoscitoreMouse(); m.aggiorna("inizio", { x: 300, y: 500, ctrl: true });
  assert.equal(m.aggiorna("movimento", { x: 302, y: 470, ctrl: true }), null);
  const e = m.aggiorna("movimento", { x: 305, y: 420, ctrl: true });
  assert.equal(e.tipo, "inclina"); assert.equal(m.aggiorna("movimento", { x: 305, y: 300, ctrl: true }), null);
});
test("senza Ctrl il trascinamento è lo spostamento normale della mappa", () => {
  const m = creaRiconoscitoreMouse(); m.aggiorna("inizio", { x: 300, y: 500, ctrl: false });
  assert.equal(m.aggiorna("movimento", { x: 300, y: 200, ctrl: false }), null);
});
test("Ctrl + trascinamento orizzontale o verso il basso: no", () => {
  const m = creaRiconoscitoreMouse(); m.aggiorna("inizio", { x: 300, y: 500, ctrl: true });
  assert.equal(m.aggiorna("movimento", { x: 100, y: 480, ctrl: true }), null);
  m.aggiorna("fine");
  m.aggiorna("inizio", { x: 300, y: 500, ctrl: true });
  assert.equal(m.aggiorna("movimento", { x: 300, y: 700, ctrl: true }), null);
});

console.log("inclinazione con cui si apre il 3D");
test("da 40° (gesto appena riconosciuto) fino a 65° (gesto lungo)", () => {
  assert.equal(inclinazioneIniziale(SOGLIE.spostamento), 40);
  assert.equal(inclinazioneIniziale(SOGLIE.spostamento + 40), 50);
  assert.equal(inclinazioneIniziale(1000), 65); assert.equal(inclinazioneIniziale(0), 40); assert.equal(inclinazioneIniziale(NaN), 40);
});

console.log("collegamento agli eventi");
test("eventi touch veri sul contenitore: il 3D si apre una volta e nessun evento viene bloccato", () => {
  const contenitore = new EventTarget(), finestra = new EventTarget(); const aperture = []; let bloccato = 0;
  const scollega = collegaGestoInclina(contenitore, (g) => aperture.push(g), { win: finestra });
  const evento = (tipo, touches) => { const ev = Object.assign(new Event(tipo, { cancelable: true }), { touches: touches.map((t) => ({ identifier: t.id, clientX: t.x, clientY: t.y })) }); const pd = ev.preventDefault.bind(ev); ev.preventDefault = () => { bloccato++; pd(); }; return ev; };
  contenitore.dispatchEvent(evento("touchstart", [A0])); // prima dita
  contenitore.dispatchEvent(evento("touchstart", [A0, B0])); // seconda dita
  for (let k = 1; k <= 30; k++) finestra.dispatchEvent(evento("touchmove", due([0, -3 * k], [0, -3 * k])));
  finestra.dispatchEvent(evento("touchend", []));
  assert.equal(aperture.length, 1); assert.equal(bloccato, 0);
  scollega();
  contenitore.dispatchEvent(evento("touchstart", [A0, B0]));
  for (let k = 1; k <= 30; k++) finestra.dispatchEvent(evento("touchmove", due([0, -3 * k], [0, -3 * k])));
  assert.equal(aperture.length, 1, "dopo lo scollegamento non reagisce più");
});
test("il mouse con Ctrl sul contenitore apre il 3D", () => {
  const contenitore = new EventTarget(), finestra = new EventTarget(); const aperture = [];
  collegaGestoInclina(contenitore, (g) => aperture.push(g), { win: finestra });
  const m = (tipo, x, y, ctrl = true) => Object.assign(new Event(tipo), { clientX: x, clientY: y, ctrlKey: ctrl, button: 0 });
  contenitore.dispatchEvent(m("mousedown", 300, 500)); finestra.dispatchEvent(m("mousemove", 300, 450)); finestra.dispatchEvent(m("mousemove", 300, 400)); finestra.dispatchEvent(m("mouseup", 300, 400));
  assert.equal(aperture.length, 1);
});

console.log(`\n${ok} controlli superati${process.exitCode ? ", ma ce ne sono di falliti" : ""}.`);
