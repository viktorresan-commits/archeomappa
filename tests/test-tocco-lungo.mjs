// Tocco lungo: riconoscimento del gesto e collegamento a Google Maps. Esegui con: node tests/test-tocco-lungo.mjs
import assert from "node:assert/strict";
import { creaRilevatore, urlGoogleMaps, DURATA_MS, TOLLERANZA_PX } from "../js/tocco-lungo.js";

let ok = 0;
const segna = (n) => { ok++; console.log("  ok  ", n); };
const test = (nome, fn) => {
  try { fn(); segna(nome); } catch (e) { console.error("  FAIL", nome, "\n      ", e.message); process.exitCode = 1; }
};

// Orologio e timer finti: il tempo avanza solo quando lo decide il test.
function banco() {
  let t = 0;
  let prossimo = 1;
  const timer = new Map();
  const lunghi = [];
  const r = creaRilevatore({
    onLungo: (p) => lunghi.push(p),
    imposta: (f, ms) => { const id = prossimo++; timer.set(id, { f, quando: t + ms }); return id; },
    annulla: (id) => timer.delete(id),
    ora: () => t,
  });
  const avanza = (ms) => {
    t += ms;
    for (const [id, x] of [...timer]) if (x.quando <= t) { timer.delete(id); x.f(); }
  };
  return { r, lunghi, avanza };
}

console.log("collegamento a Google Maps");
test("il collegamento usa l'indirizzo ufficiale «search» con latitudine e longitudine", () => {
  assert.equal(urlGoogleMaps(43.3358, 12.9066), "https://www.google.com/maps/search/?api=1&query=43.335800,12.906600");
});
test("le coordinate negative restano con il segno", () => {
  assert.equal(urlGoogleMaps(-33.8688, -70.5), "https://www.google.com/maps/search/?api=1&query=-33.868800,-70.500000");
});
test("valori non validi non producono un collegamento", () => {
  assert.equal(urlGoogleMaps(NaN, 12), null);
  assert.equal(urlGoogleMaps(91, 12), null);
  assert.equal(urlGoogleMaps(43, 181), null);
  assert.equal(urlGoogleMaps(undefined, 12), null);
  assert.equal(urlGoogleMaps("abc", "def"), null);
});
test("anche coordinate date come testo numerico funzionano", () => {
  assert.equal(urlGoogleMaps("43.5", "12.5"), "https://www.google.com/maps/search/?api=1&query=43.500000,12.500000");
});

console.log("riconoscimento del gesto");
test("un dito fermo per la durata scatta una volta sola, nel punto toccato", () => {
  const { r, lunghi, avanza } = banco();
  r.giu({ id: 1, x: 120, y: 340 });
  avanza(DURATA_MS - 1);
  assert.equal(lunghi.length, 0);
  avanza(1);
  assert.deepEqual(lunghi, [{ x: 120, y: 340 }]);
  avanza(5000);
  assert.equal(lunghi.length, 1);
});
test("un tocco breve non scatta e non sopprime il click", () => {
  const { r, lunghi, avanza } = banco();
  r.giu({ id: 1, x: 10, y: 10 });
  avanza(150);
  r.su({ id: 1 });
  avanza(2000);
  assert.equal(lunghi.length, 0);
  assert.equal(r.clickSoppresso(), false);
});
test("piccoli spostamenti del dito (entro la tolleranza) non annullano il gesto", () => {
  const { r, lunghi, avanza } = banco();
  r.giu({ id: 1, x: 100, y: 100 });
  avanza(200);
  r.muovi({ id: 1, x: 100 + TOLLERANZA_PX - 1, y: 100 });
  avanza(DURATA_MS);
  assert.equal(lunghi.length, 1);
});
test("trascinare la mappa oltre la tolleranza annulla il gesto", () => {
  const { r, lunghi, avanza } = banco();
  r.giu({ id: 1, x: 100, y: 100 });
  avanza(100);
  r.muovi({ id: 1, x: 100, y: 100 + TOLLERANZA_PX + 2 });
  avanza(DURATA_MS * 3);
  assert.equal(lunghi.length, 0);
  assert.equal(r.inAttesa(), false);
});
test("la tolleranza si misura in linea retta (diagonale)", () => {
  const { r, lunghi, avanza } = banco();
  r.giu({ id: 1, x: 0, y: 0 });
  r.muovi({ id: 1, x: 8, y: 8 }); // distanza 11,3 > 10
  avanza(DURATA_MS * 2);
  assert.equal(lunghi.length, 0);
});
test("un secondo dito (zoom a due dita) annulla il gesto, anche se il primo era fermo", () => {
  const { r, lunghi, avanza } = banco();
  r.giu({ id: 1, x: 100, y: 100 });
  avanza(300);
  r.giu({ id: 2, x: 200, y: 200 });
  avanza(DURATA_MS * 2);
  assert.equal(lunghi.length, 0);
  assert.equal(r.inAttesa(), false);
});
test("dopo uno zoom a due dita un nuovo tocco lungo con un dito funziona di nuovo", () => {
  const { r, lunghi, avanza } = banco();
  r.giu({ id: 1, x: 1, y: 1 });
  r.giu({ id: 2, x: 50, y: 50 });
  r.su({ id: 2 });
  r.su({ id: 1 });
  r.giu({ id: 3, x: 30, y: 40 });
  avanza(DURATA_MS);
  assert.deepEqual(lunghi, [{ x: 30, y: 40 }]);
});
test("se il browser annulla il puntatore (pointercancel) il gesto non scatta", () => {
  const { r, lunghi, avanza } = banco();
  r.giu({ id: 1, x: 5, y: 5 });
  avanza(300);
  r.annullato({ id: 1 });
  avanza(DURATA_MS * 2);
  assert.equal(lunghi.length, 0);
});
test("rilasciare prima della scadenza spegne il timer", () => {
  const { r, lunghi, avanza } = banco();
  r.giu({ id: 1, x: 5, y: 5 });
  avanza(DURATA_MS - 10);
  r.su({ id: 1 });
  avanza(100);
  assert.equal(lunghi.length, 0);
  assert.equal(r.inAttesa(), false);
});

console.log("click dopo il tocco lungo");
test("finché il dito è giù e per un po' dopo il rilascio il click è soppresso, poi no", () => {
  const { r, avanza } = banco();
  r.giu({ id: 1, x: 5, y: 5 });
  avanza(DURATA_MS);
  assert.equal(r.clickSoppresso(), true);
  r.su({ id: 1 });
  assert.equal(r.clickSoppresso(), true);
  avanza(499);
  assert.equal(r.clickSoppresso(), true);
  avanza(2);
  assert.equal(r.clickSoppresso(), false);
});
test("un tocco normale subito dopo un tocco lungo (oltre la soppressione) imposta di nuovo il centro", () => {
  const { r, avanza } = banco();
  r.giu({ id: 1, x: 5, y: 5 });
  avanza(DURATA_MS);
  r.su({ id: 1 });
  avanza(600);
  r.giu({ id: 1, x: 70, y: 80 });
  avanza(100);
  r.su({ id: 1 });
  assert.equal(r.clickSoppresso(), false);
});
test("più tocchi lunghi consecutivi scattano ciascuno una volta", () => {
  const { r, lunghi, avanza } = banco();
  for (const x of [10, 20, 30]) {
    r.giu({ id: 1, x, y: 0 });
    avanza(DURATA_MS);
    r.su({ id: 1 });
    avanza(700);
  }
  assert.deepEqual(lunghi.map((p) => p.x), [10, 20, 30]);
});

console.log("segnale del browser (contextmenu)");
test("se il browser dà il segnale con il dito giù, il timer si ferma e il click di rilascio è soppresso", () => {
  const { r, lunghi, avanza } = banco();
  r.giu({ id: 1, x: 5, y: 5 });
  avanza(300);
  r.segnala();
  avanza(DURATA_MS * 2);
  assert.equal(lunghi.length, 0, "non scatta una seconda volta");
  assert.equal(r.clickSoppresso(), true);
  r.su({ id: 1 });
  assert.equal(r.clickSoppresso(), true);
  avanza(600);
  assert.equal(r.clickSoppresso(), false);
});
test("clic destro del mouse (nessun dito giù): il click che segue per un attimo è soppresso, poi no", () => {
  const { r, avanza } = banco();
  r.segnala();
  assert.equal(r.clickSoppresso(), true);
  avanza(501);
  assert.equal(r.clickSoppresso(), false);
});

console.log(`\n${ok} controlli eseguiti.`);
