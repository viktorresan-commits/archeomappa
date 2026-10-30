// Foto di riferimento per il confronto: tessere, mosaico, fonti. Esegui con: node tests/test-riferimenti.mjs
import assert from "node:assert/strict";
import { mercatoreDiretta } from "../js/proj.js";
import { elencoTessere, zoomUtilizzabile, scaricaMosaico, urlDaModello, fonteRiferimento, ELENCO_RIFERIMENTI } from "../js/riferimenti.js";

let ok = 0;
const test = (nome, fn) => {
  const f = async () => fn();
  return f().then(() => { ok++; console.log("  ok  ", nome); }, (e) => { process.exitCode = 1; console.error("  FAIL", nome, "\n      ", e.stack.split("\n").slice(0, 3).join("\n       ")); });
};

const [cx, cy] = mercatoreDiretta(43.34, 12.91);
const merc = [cx - 700, cy - 700, cx + 700, cy + 700]; // circa 1,4 km di lato in metri Mercatore

console.log("tessere");
await test("a zoom 0 il mondo è una tessera; a zoom 1 sono quattro", () => {
  assert.deepEqual(elencoTessere([-1000, -1000, 1000, 1000], 0), { x0: 0, y0: 0, nx: 1, ny: 1 });
  const t = elencoTessere([-1000, -1000, 1000, 1000], 1);
  assert.deepEqual(t, { x0: 0, y0: 0, nx: 2, ny: 2 });
});
await test("a zoom 17 un riquadro di 1,4 km (Mercatore) richiede una griglia di tessere che lo contiene", () => {
  const t = elencoTessere(merc, 17);
  const lato = 40075016.686 / 2 ** 17; // ≈ 306 m
  assert.ok(t.nx * lato >= 1400 && t.nx * lato <= 1400 + 2 * lato, `${t.nx}`);
  assert.ok(t.ny * lato >= 1400 && t.ny * lato <= 1400 + 2 * lato, `${t.ny}`);
});
await test("se le tessere sarebbero troppe, lo zoom scende finché ci stanno", () => {
  const a = zoomUtilizzabile(merc, 19, { maxTessere: 50 });
  const t = elencoTessere(merc, a.zt);
  assert.ok(t.nx * t.ny <= 50);
  assert.ok(a.zt < 19);
  assert.equal(a.ridotto, true);
  const b = zoomUtilizzabile(merc, 15, { maxTessere: 50 });
  assert.equal(b.zt, 15);
  assert.equal(b.ridotto, false);
});
await test("il modello dell'indirizzo sostituisce z, y e x", () => {
  assert.equal(urlDaModello("https://s/{z}/{y}/{x}", 17, 4, 9), "https://s/17/9/4");
  assert.equal(urlDaModello("https://s/{z}/{x}/{y}.png", 3, 1, 2), "https://s/3/1/2.png");
});

console.log("mosaico");
const tesseraFinta = (url) => {
  const [, z, y, x] = /\/(\d+)\/(\d+)\/(\d+)$/.exec(url).map(Number);
  const px = 256;
  const rgba = new Uint8ClampedArray(px * px * 4);
  for (let i = 0; i < px * px; i++) { rgba[i * 4] = (x * 37) % 256; rgba[i * 4 + 1] = (y * 53) % 256; rgba[i * 4 + 2] = z; rgba[i * 4 + 3] = 255; }
  return { w: px, h: px, rgba };
};
await test("le tessere vanno al loro posto e il riquadro del mosaico è allineato alle tessere", async () => {
  const chiamate = [];
  const m = await scaricaMosaico({
    merc, zt: 17, tilePx: 256, modello: "https://s/{z}/{y}/{x}", scarica: async (u) => { chiamate.push(u); return tesseraFinta(u); },
  });
  const t = elencoTessere(merc, 17);
  assert.equal(m.w, t.nx * 256);
  assert.equal(m.h, t.ny * 256);
  assert.equal(chiamate.length, t.nx * t.ny);
  assert.equal(m.rgba[0], (t.x0 * 37) % 256);
  assert.equal(m.rgba[1], (t.y0 * 53) % 256);
  const ultimo = ((m.h - 1) * m.w + (m.w - 1)) * 4;
  assert.equal(m.rgba[ultimo], ((t.x0 + t.nx - 1) * 37) % 256);
  assert.equal(m.rgba[ultimo + 1], ((t.y0 + t.ny - 1) * 53) % 256);
  assert.ok(m.merc[0] <= merc[0] && m.merc[1] <= merc[1] && m.merc[2] >= merc[2] && m.merc[3] >= merc[3]);
  const lato = 40075016.686 / 2 ** 17;
  assert.ok(Math.abs((m.merc[2] - m.merc[0]) - t.nx * lato) < 0.01);
});
await test("tessere da 512 pixel: il mosaico ha il doppio dei pixel per tessera", async () => {
  const m = await scaricaMosaico({
    merc, zt: 16, tilePx: 512, modello: "https://s/{z}/{y}/{x}",
    scarica: async (u) => { const t = tesseraFinta(u); const rgba = new Uint8ClampedArray(512 * 512 * 4).fill(255); return { w: 512, h: 512, rgba }; },
  });
  const t = elencoTessere(merc, 16);
  assert.equal(m.w, t.nx * 512);
});
await test("una tessera che manca lascia un buco trasparente e viene contata; le altre restano", async () => {
  let n = 0;
  const m = await scaricaMosaico({
    merc, zt: 17, tilePx: 256, modello: "https://s/{z}/{y}/{x}",
    scarica: async (u) => { if (++n === 2) throw new Error("tessera assente"); return tesseraFinta(u); },
  });
  assert.equal(m.mancanti, 1);
  let trasparenti = 0;
  for (let i = 3; i < m.rgba.length; i += 4) if (m.rgba[i] === 0) trasparenti++;
  assert.equal(trasparenti, 256 * 256);
});
await test("se nessuna tessera arriva, l'errore del servizio viene riportato", async () => {
  await assert.rejects(
    scaricaMosaico({ merc, zt: 17, tilePx: 256, modello: "https://s/{z}/{y}/{x}", scarica: async () => { throw new Error("Il servizio ha risposto 403."); } }),
    /403/,
  );
});
await test("l'avanzamento viene comunicato e le richieste sono limitate in parallelo", async () => {
  let attive = 0, massimo = 0;
  const testi = [];
  await scaricaMosaico({
    merc, zt: 17, tilePx: 256, modello: "https://s/{z}/{y}/{x}", parallelo: 3, avanzamento: (t) => testi.push(t),
    scarica: async (u) => { attive++; massimo = Math.max(massimo, attive); await new Promise((r) => setTimeout(r, 1)); attive--; return tesseraFinta(u); },
  });
  assert.ok(massimo <= 3, `${massimo}`);
  assert.ok(testi.length >= 2);
});

console.log("fonti");
await test("ci sono il satellite attuale, i quattro storici e l'ortofoto del Ministero", () => {
  const ids = ELENCO_RIFERIMENTI.map((f) => f.id);
  for (const id of ["sat", "wb2014", "wb2018", "wb2022", "wb2026", "ortofoto"]) assert.ok(ids.includes(id), id);
});
await test("satellite: tessere da 256 px, zoom massimo 18 (oltre, Esri mette un'immagine segnaposto)", () => {
  const f = fonteRiferimento("sat");
  assert.equal(f.tilePx, 256);
  assert.equal(f.zMax, 18);
  assert.match(f.modello, /World_Imagery.*\{z\}\/\{y\}\/\{x\}/);
});
await test("ortofoto: usa la variante scelta; con tessere da 512 px lo zoom delle tessere è uno in meno", () => {
  const f = fonteRiferimento("ortofoto", { wms: { url: "https://pcn/ogc?map=x.map", livelli: "OI.ORTOIMMAGINI.2012.33", versione: "1.3.0", tile: 512 } });
  assert.equal(f.tilePx, 512);
  assert.equal(f.zt(17), 16);
  assert.equal(typeof f.url, "function");
  const u = f.url(16, 2200, 1500);
  assert.match(u, /WIDTH=512&HEIGHT=512/);
  assert.match(u, /LAYERS=OI\.ORTOIMMAGINI\.2012\.33/);
  const g = fonteRiferimento("ortofoto", { wms: { url: "https://pcn/ogc?map=x.map", livelli: "L", versione: "1.1.1", tile: 256 } });
  assert.equal(g.zt(17), 17);
});
await test("ortofoto senza servizio noto, o fonte sconosciuta: nessuna fonte", () => {
  assert.equal(fonteRiferimento("ortofoto"), null);
  assert.equal(fonteRiferimento("boh"), null);
});

console.log(`\n${ok} controlli eseguiti.`);
