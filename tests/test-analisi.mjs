// Prove della sessione di analisi e del motore (worker/thread). Uso: node tests/test-analisi.mjs [cartella-dtm]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { creaSessione, VISUALIZZAZIONI, descriviRilievo } from "../js/analisi.js";
import { creaMotore } from "../js/motore.js";

const qui = dirname(fileURLToPath(import.meta.url));
let cartella = process.argv[2];
if (!cartella) {
  cartella = mkdtempSync(join(tmpdir(), "dem-"));
  try { execFileSync("python3", [join(qui, "..", "tools", "make_test_dem.py"), cartella], { stdio: "ignore" }); }
  catch { console.log("Python con numpy/tifffile non disponibile: prove saltate."); process.exit(0); }
}
const aFile = (nome) => Object.assign(new Blob([readFileSync(join(cartella, nome))]), { name: nome });

let ok = 0;
const pendenti = [];
const test = (nome, fn) => pendenti.push(Promise.resolve().then(fn).then(() => { ok++; console.log("  ok  ", nome); }, (e) => { process.exitCode = 1; console.log("  FAIL", nome, "\n      ", e.stack.split("\n").slice(0, 3).join("\n       ")); }));

const C = { lat: 0, lon: 0 };
{
  const s0 = creaSessione();
  const info = await s0.apri(aFile("dtm_2m_deflate.tif"));
  const m = { x: 761500, y: 4733500 };
  // centro del rilievo
  const { creaProiezione } = await import("../js/proj.js");
  [C.lat, C.lon] = creaProiezione(32632).aLatLon(m.x, m.y);
}

console.log("sessione di analisi");
test("apri: i metadati sono copiabili (structuredClone) e corretti", async () => {
  const s = creaSessione();
  const info = await s.apri(aFile("dtm_2m_deflate.tif"));
  assert.doesNotThrow(() => structuredClone(info));
  assert.equal(info.larghezza, 1500); assert.equal(info.epsg, 32632); assert.equal(info.pixelM, 2);
  assert.ok(info.copertura.nord > info.copertura.sud && info.copertura.est > info.copertura.ovest);
  assert.match(info.proiezione, /UTM|32632/i);
});
for (const v of VISUALIZZAZIONI) {
  test(`visualizzazione «${v.id}»: immagine valida e copiabile`, async () => {
    const s = creaSessione();
    await s.apri(aFile("dtm_2m_deflate.tif"));
    const r = await s.analizza({ ...C, raggioM: 500, vis: { tipo: v.id, esagerazione: 2 } });
    const im = r.immagine;
    assert.equal(im.rgba.length, im.w * im.h * 4);
    let opachi = 0, chiari = 0, scuri = 0;
    for (let i = 3; i < im.rgba.length; i += 4) if (im.rgba[i] === 255) { opachi++; const g = im.rgba[i - 3]; if (g > 200) chiari++; if (g < 60) scuri++; }
    assert.ok(opachi > im.w * im.h * 0.6, `pochi pixel opachi: ${opachi}/${im.w * im.h}`);
    assert.ok(new Set(Array.from(im.rgba.filter((_, i) => i % 4 === 0))).size > 20, "immagine quasi uniforme");
    const [[s0, o0], [n0, e0]] = im.bounds;
    assert.ok(s0 < C.lat && n0 > C.lat && o0 < C.lon && e0 > C.lon);
    assert.ok(n0 - s0 > 0.008 && n0 - s0 < 0.012, `altezza ${n0 - s0}°`); // ~1 km ≈ 0,009°
    assert.doesNotThrow(() => structuredClone(r));
    assert.equal(r.rilevamento, undefined);
  });
}
test("cercaAnomalie: restituisce recinto, tumulo e aggere sulla finestra intera", async () => {
  const s = creaSessione();
  await s.apri(aFile("dtm_2m_deflate.tif"));
  const fasi = [];
  const r = await s.analizza({ ...C, raggioM: 1500, vis: { tipo: "multi" }, cercaAnomalie: true }, (t) => fasi.push(t));
  const codici = r.rilevamento.anomalie.map((a) => a.codice).sort();
  assert.ok(codici.includes("recinto") && codici.includes("circolare") && codici.includes("lineare"), codici.join(","));
  assert.deepEqual(fasi, ["Leggo il rilievo…", "Preparo la visualizzazione…", "Cerco le anomalie…"]);
  assert.ok(r.rilevamento.regole.length >= 5);
  assert.doesNotThrow(() => structuredClone(r));
});
test("la griglia è tenuta in cache se centro e raggio non cambiano", async () => {
  const s = creaSessione();
  await s.apri(aFile("dtm_2m_deflate.tif"));
  const a = await s.analizza({ ...C, raggioM: 600, vis: { tipo: "ombre" } });
  const fasi = [];
  const b = await s.analizza({ ...C, raggioM: 600, vis: { tipo: "pendenza" } }, (t) => fasi.push(t));
  assert.ok(!fasi.includes("Leggo il rilievo…"));
  assert.equal(a.griglia.w, b.griglia.w);
  const c = await s.analizza({ ...C, raggioM: 700, vis: { tipo: "pendenza" } }, (t) => fasi.push(t));
  assert.ok(fasi.includes("Leggo il rilievo…") && c.griglia.w > a.griglia.w);
});
test("le impostazioni dell'utente prevalgono su quelle predefinite", async () => {
  const s = creaSessione();
  await s.apri(aFile("dtm_2m_deflate.tif"));
  const r = await s.analizza({ ...C, raggioM: 1500, vis: { tipo: "lrm" }, cercaAnomalie: true, imp: { contrastoM: 50 } });
  assert.equal(r.impEff.contrastoM, 50);
  assert.equal(r.rilevamento.anomalie.length, 0);
});
test("centro fuori dal rilievo → errore in italiano", async () => {
  const s = creaSessione();
  await s.apri(aFile("dtm_2m_deflate.tif"));
  await assert.rejects(() => s.analizza({ lat: 40, lon: 12, raggioM: 500, vis: { tipo: "multi" } }), /fuori dalla copertura/);
});
test("senza file aperto → errore chiaro", async () => {
  await assert.rejects(() => creaSessione().analizza({ ...C, raggioM: 500 }), /Nessun rilievo/);
});

test("GeoTIFF in gradi (EPSG:4326, come i DTM del PST): ricampionato e anomalie al posto giusto", async () => {
  const { haversine } = await import("../js/geo.js");
  const v = JSON.parse(readFileSync(join(cartella, "verita.json"), "utf8")).geo4326;
  const s = creaSessione();
  const info = await s.apri(aFile("dtm_4326.tif"));
  assert.equal(info.epsg, 4326);
  assert.ok(info.pixelM > 1.3 && info.pixelM < 1.7, `pixel ${info.pixelM}`);
  const r = await s.analizza({ lat: v.centro[0], lon: v.centro[1], raggioM: 1450, vis: { tipo: "combinata" }, cercaAnomalie: true });
  assert.ok(r.avvisi.some((a) => /ricampionato in UTM/.test(a)));
  const vicino = (codice, nome, tol) => r.rilevamento.anomalie.some((a) => a.codice === codice && haversine(a.lat, a.lon, ...v.strutture[nome]) < tol);
  assert.ok(vicino("recinto", "recinto", 25), "recinto non trovato");
  assert.ok(vicino("circolare", "tumulo", 15), "tumulo non trovato");
  assert.ok(r.rilevamento.anomalie.some((a) => a.codice === "lineare" && a.dimensioneM > 350 && a.geom.coord.some(([la, lo]) => haversine(la, lo, ...v.strutture.aggere) < 20)), "aggere non trovato");
  assert.ok(r.rilevamento.anomalie.length <= 4, `troppi risultati: ${r.rilevamento.anomalie.length}`);
  const [[s0, o0], [n0, e0]] = r.immagine.bounds;
  assert.ok(s0 < v.centro[0] && n0 > v.centro[0] && o0 < v.centro[1] && e0 > v.centro[1]);
});


test("confronta: su un rilievo vero, il segno presente nella foto finta risulta «visibile», il resto no (e il risultato è copiabile)", async () => {
  const { mercatoreDiretta } = await import("../js/proj.js");
  const s = creaSessione();
  await s.apri(aFile("dtm_2m_deflate.tif"));
  const p = { ...C, raggioM: 1500 };
  const r = await s.analizza({ ...p, vis: { tipo: "multi" }, cercaAnomalie: true });
  const an = r.rilevamento.anomalie;
  assert.ok(an.length >= 3, `anomalie: ${an.length}`);
  const bersaglio = an.find((a) => a.codice === "circolare") ?? an[0];
  const k = 1 / Math.cos((C.lat * Math.PI) / 180);
  const [cx, cy] = mercatoreDiretta(C.lat, C.lon);
  const [X0, Y0] = mercatoreDiretta(bersaglio.lat, bersaglio.lon);
  const meta = 1900 * k, passo = 2 * k; // pixel della foto: 2 m a terra
  const lato = Math.round((2 * meta) / passo);
  const rgba = new Uint8ClampedArray(lato * lato * 4);
  let seme = 12345;
  const casuale = () => { seme = (Math.imul(seme, 1664525) + 1013904223) >>> 0; return seme / 4294967296; };
  const raggio = (bersaglio.dimensioneM / 2) * k;
  for (let v = 0; v < lato; v++) {
    for (let u = 0; u < lato; u++) {
      const X = cx - meta + (u + 0.5) * passo, Y = cy + meta - (v + 0.5) * passo;
      const dentro = Math.hypot(X - X0, Y - Y0) < raggio;
      const val = Math.round(110 + (dentro ? 60 : 0) + (casuale() + casuale() - 1) * 10);
      const o = (v * lato + u) * 4;
      rgba[o] = rgba[o + 1] = rgba[o + 2] = val; rgba[o + 3] = 255;
    }
  }
  const mosaico = { rgba, w: lato, h: lato, merc: [cx - meta, cy - meta, cx + meta, cy + meta] };
  const fasi = [];
  const c = await s.confronta({ ...p, anomalie: an, mosaico }, (t) => fasi.push(t));
  assert.doesNotThrow(() => structuredClone(c));
  assert.equal(c.risultati.length, an.length);
  const e = c.risultati.find((x) => x.id === bersaglio.id);
  assert.equal(e.esito, "anche-foto", JSON.stringify(e));
  assert.ok(c.risultati.some((x) => x.id !== bersaglio.id && x.esito !== "anche-foto"), "le altre anomalie non dovrebbero risultare tutte visibili");
  assert.ok(fasi.includes("Confronto le anomalie con la foto…"));
});
test("senza file aperto, confronta dà un errore chiaro", async () => {
  await assert.rejects(() => creaSessione().confronta({ ...C, raggioM: 500, anomalie: [], mosaico: {} }), /Nessun rilievo/);
});

console.log("motore");
const CREA_FALLISCE = () => { throw new Error("Worker non disponibile"); };
test("senza Web Worker usa il thread principale e funziona", async () => {
  const m = creaMotore({ crea: CREA_FALLISCE });
  const info = await m.apri(aFile("dtm_2m_deflate.tif"));
  assert.equal(m.modalita, "thread");
  assert.equal(info.larghezza, 1500);
  const r = await m.analizza({ ...C, raggioM: 400, vis: { tipo: "multi" } });
  assert.ok(r.immagine.w > 100);
});
test("un worker che dà errore all'avvio → ripiego sul thread principale", async () => {
  const falso = { terminate() {}, postMessage() {}, set onerror(f) { setTimeout(() => f({ preventDefault() {} }), 5); }, set onmessage(_) {} };
  const m = creaMotore({ crea: () => falso, attesaMs: 2000 });
  await m.apri(aFile("dtm_2m_deflate.tif"));
  assert.equal(m.modalita, "thread");
});
test("un worker che non risponde entro il tempo → ripiego sul thread principale", async () => {
  const muto = { terminate() {}, postMessage() {}, set onerror(_) {}, set onmessage(_) {} };
  const m = creaMotore({ crea: () => muto, attesaMs: 50 });
  await m.apri(aFile("dtm_2m_deflate.tif"));
  assert.equal(m.modalita, "thread");
});
test("protocollo del worker: avanzamento, risposta e arresto improvviso", async () => {
  const log = [];
  const falso = {
    terminate() { log.push("terminate"); },
    postMessage(msg) {
      log.push(msg.op);
      queueMicrotask(() => {
        if (msg.op === "apri") this.onmessage({ data: { id: msg.id, ok: true, risultato: { larghezza: 5 } } });
        else if (msg.op === "analizza" && log.filter((x) => x === "analizza").length === 1) {
          this.onmessage({ data: { id: msg.id, avanzamento: "Leggo il rilievo…" } });
          this.onerror({ preventDefault() {} });
        } else if (msg.op === "analizza") this.onmessage({ data: { id: msg.id, ok: true, risultato: { fatto: true } } });
      });
    },
    onmessage: null, onerror: null,
  };
  let creati = 0;
  const m = creaMotore({ crea: () => { creati++; const w = Object.create(falso); w.onmessage = null; queueMicrotask(() => w.onmessage({ data: { pronto: true } })); return w; } });
  const fasi = [];
  assert.deepEqual(await m.apri({ name: "x.tif" }), { larghezza: 5 });
  assert.equal(m.modalita, "worker");
  await assert.rejects(() => m.analizza({ lat: 1, lon: 1, raggioM: 1 }, (t) => fasi.push(t)), /interrotto/);
  assert.deepEqual(fasi, ["Leggo il rilievo…"]);
  // dopo l'arresto il motore ricrea il worker e riapre da solo il file
  const r = await m.analizza({ lat: 1, lon: 1, raggioM: 1 });
  assert.deepEqual(r, { fatto: true });
  assert.equal(creati, 2);
  assert.deepEqual(log.filter((x) => x === "apri").length, 2);
});

await Promise.all(pendenti);
console.log(process.exitCode ? "\nAlcune prove NON superate." : `\nTutte le prove di analisi e motore superate (${ok}).`);
