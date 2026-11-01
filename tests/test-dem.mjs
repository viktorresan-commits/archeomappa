// Quote del terreno per la vista 3D: GeoTIFF di TINITALY, ricampionamento, vuoti, formato Terrarium. Esegui con: node tests/test-dem.mjs
import assert from "node:assert/strict";
import {
  ErroreDem, SENZA_DATO, allarga, bboxTessera, codificaTerrarium, componiTessera, decodificaTerrarium, fuoriItalia, leggiGeoTiff,
  qualeFonte, quotaValida, ricampionaSuTessera, ridimensiona, riempiVuoti, urlTerrarium, urlWcsTinitaly,
} from "../js/dem.js";
import { creaTiff } from "./aiuti-tiff.mjs";

let ok = 0;
const test = (nome, fn) => {
  try { fn(); ok++; console.log("  ok  ", nome); } catch (e) { process.exitCode = 1; console.error("  FAIL", nome, "\n      ", e.stack.split("\n").slice(0, 4).join("\n       ")); }
};
const vicino = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} ≠ ${b} (±${tol})`);

const rampa = (w, h, f) => Float32Array.from({ length: w * h }, (_, i) => f(i % w, Math.floor(i / w)));

console.log("lettura del GeoTIFF");
for (const [nome, opz] of [
  ["big-endian a blocchi (come GeoServer)", { le: false, blocchi: 8 }],
  ["little-endian a blocchi", { le: true, blocchi: 8 }],
  ["big-endian a strisce", { le: false, righePerStriscia: 3 }],
  ["little-endian con una sola striscia", { le: true }],
  ["georeferenziazione con ModelPixelScale e Tiepoint", { le: false, blocchi: 8, matrice: false }],
]) {
  test(`${nome}: i valori tornano identici`, () => {
    const w = 13, h = 11, dati = rampa(w, h, (c, r) => 300 + c * 1.5 + r * 0.25);
    const geo = { x0: 1000, y0: 5000, dx: 10, dy: -10 };
    const t = leggiGeoTiff(creaTiff({ w, h, dati, georef: geo, ...opz }));
    assert.equal(t.larghezza, w); assert.equal(t.altezza, h);
    assert.deepEqual(Array.from(t.dati), Array.from(dati));
    assert.deepEqual(t.georef, geo);
    assert.equal(t.nodata, -9999);
  });
}
test("quote di 16 bit con segno", () => {
  const dati = Float32Array.from([-5, 0, 120, 3000]);
  const t = leggiGeoTiff(creaTiff({ w: 2, h: 2, dati, bit: 16, formato: 2, georef: { x0: 0, y0: 0, dx: 1, dy: -1 } }));
  assert.deepEqual(Array.from(t.dati), [-5, 0, 120, 3000]);
});
test("un TIFF compresso viene rifiutato con un messaggio chiaro", () => {
  assert.throws(() => leggiGeoTiff(creaTiff({ w: 4, h: 4, dati: new Float32Array(16), compressione: 5 })), (e) => e instanceof ErroreDem && /compresso/.test(e.message));
});
test("una risposta che non è un TIFF (errore del servizio in XML) viene rifiutata", () => {
  const xml = new TextEncoder().encode('<?xml version="1.0"?><ServiceExceptionReport><ServiceException>boom</ServiceException></ServiceExceptionReport>');
  assert.throws(() => leggiGeoTiff(xml), (e) => e instanceof ErroreDem && /TIFF/.test(e.message));
});
test("una risposta troppo corta viene rifiutata", () => {
  assert.throws(() => leggiGeoTiff(new Uint8Array(4)), ErroreDem);
});
test("senza il tag del valore «senza dato» si assume -9999", () => {
  const t = leggiGeoTiff(creaTiff({ w: 2, h: 2, dati: new Float32Array(4), nodata: null, georef: { x0: 0, y0: 0, dx: 1, dy: -1 } }));
  assert.equal(t.nodata, -9999);
});

console.log("geometria delle tessere");
test("la tessera 0/0/0 è il mondo intero", () => {
  const b = bboxTessera(0, 0, 0);
  vicino(b.ovest, -20037508.342789244, 1e-6); vicino(b.est, 20037508.342789244, 1e-6); vicino(b.nord, 20037508.342789244, 1e-6); vicino(b.sud, -20037508.342789244, 1e-6);
});
test("tessera z13 vicino a Fabriano: larghezza 4891,97 m; il file vero del servizio (angolo 1433121 / 5366720, passo 13,92 m) esce di ~227 m (4,65 %) per lato", () => {
  const b = bboxTessera(13, 4389, 2999);
  vicino(b.est - b.ovest, 4891.969, 0.01);
  vicino(b.ovest, 1433347.15, 0.1, "ovest"); vicino(b.nord, 5366490.88, 0.1, "nord");
  const fuoriO = b.ovest - 1433121.03, fuoriN = 5366720.05 - b.nord, passo = 13.924228;
  vicino(fuoriO / (b.est - b.ovest), 0.0465, 0.0005, "margine ovest"); vicino(fuoriN / (b.nord - b.sud), 0.0465, 0.0005, "margine nord");
  vicino(passo * 384, (b.est - b.ovest) * 1.093, 3, "ampiezza del file vero");
});
test("allarga() aggiunge il margine su ogni lato", () => {
  const b = bboxTessera(13, 4389, 2999), a = allarga(b, 0.04);
  vicino(a.est - a.ovest, (b.est - b.ovest) * 1.08, 1e-6); vicino(a.ovest, b.ovest - (b.est - b.ovest) * 0.04, 1e-6);
});
test("l'indirizzo del WCS ha CRS 3857, bbox con margine e formato GeoTIFF", () => {
  const u = urlWcsTinitaly(13, 4389, 2999);
  assert.match(u, /^https:\/\/tinitaly\.pi\.ingv\.it\/TINItaly_1_1\/wcs\?service=WCS&version=1\.0\.0&request=GetCoverage&coverage=TINItaly_1_1:tinitaly_dem&crs=EPSG:3857&bbox=/);
  assert.match(u, /&width=415&height=415&format=GeoTIFF$/);
  const bb = /bbox=([^&]+)/.exec(u)[1].split(",").map(Number), esatto = allarga(bboxTessera(13, 4389, 2999), 0.04);
  vicino(bb[0], esatto.ovest, 0.001); vicino(bb[3], esatto.nord, 0.001);
});
test("indirizzo della tessera mondiale", () => {
  assert.equal(urlTerrarium(13, 4389, 2999), "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/4389/2999.png");
});
test("Italia sì, Brasile e Croazia centrale no; Sicilia e Alpi sì", () => {
  const tess = (lat, lon, z = 13) => { const n = 2 ** z; return [z, Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n)]; };
  assert.equal(fuoriItalia(...tess(43.337, 12.905)), false);
  assert.equal(fuoriItalia(...tess(37.5, 14.2)), false);
  assert.equal(fuoriItalia(...tess(46.5, 11.8)), false);
  assert.equal(fuoriItalia(...tess(-15, -47)), true);
  assert.equal(fuoriItalia(...tess(52, 0)), true);
  assert.equal(fuoriItalia(...tess(44, 24)), true);
});
test("fonte: TINITALY solo da z12 e in Italia; altrove la tessera mondiale", () => {
  assert.equal(qualeFonte(13, 4389, 2999), "tinitaly");
  assert.equal(qualeFonte(12, 2194, 1499), "tinitaly");
  assert.equal(qualeFonte(11, 1097, 749), "terrarium");
  assert.equal(qualeFonte(13, 2000, 4000), "terrarium"); // fuori Italia
});

console.log("ricampionamento sulla tessera");
// terreno finto: z(x, y) in metri Web Mercator, piano inclinato + una gobba
const terreno = (x, y) => 300 + 0.02 * (x - 1433344) + 0.05 * (y - 5366493) / 10 + 40 * Math.exp(-(((x - 1435000) / 600) ** 2 + ((y - 5364000) / 600) ** 2));
function filePerBbox(bb, passo, margineCelle = 0) {
  const w = Math.ceil((bb.est - bb.ovest) / passo) + 2 * margineCelle, h = Math.ceil((bb.nord - bb.sud) / passo) + 2 * margineCelle;
  const x0 = bb.ovest - margineCelle * passo, y0 = bb.nord + margineCelle * passo;
  const dati = rampa(w, h, (c, r) => terreno(x0 + (c + 0.5) * passo, y0 - (r + 0.5) * passo));
  return { w, h, dati, georef: { x0, y0, dx: passo, dy: -passo } };
}
test("il ricampionamento restituisce la quota vera ai centri dei pixel della tessera (errore < 0,05 m su un terreno liscio)", () => {
  const bb = bboxTessera(13, 4389, 2999), f = filePerBbox(allarga(bb, 0.04), 10);
  const t = leggiGeoTiff(creaTiff({ ...f, blocchi: 64 }));
  const q = ricampionaSuTessera(t, bb, 96, 96);
  let massimo = 0;
  for (let r = 4; r < 92; r += 7) for (let c = 4; c < 92; c += 7) {
    const x = bb.ovest + ((c + 0.5) * (bb.est - bb.ovest)) / 96, y = bb.nord - ((r + 0.5) * (bb.nord - bb.sud)) / 96;
    massimo = Math.max(massimo, Math.abs(q[r * 96 + c] - terreno(x, y)));
  }
  assert.ok(massimo < 0.05, `errore massimo ${massimo}`);
});
test("se il file copre un'area più larga (+9 %, come fa il servizio) la tessera esce comunque nella posizione giusta", () => {
  const bb = bboxTessera(13, 4389, 2999), f = filePerBbox(allarga(bb, 0.0465), 13.92, 0);
  const t = leggiGeoTiff(creaTiff({ ...f, blocchi: 64 }));
  const q = ricampionaSuTessera(t, bb, 128, 128);
  let massimo = 0;
  for (let r = 2; r < 126; r += 5) for (let c = 2; c < 126; c += 5) {
    const x = bb.ovest + ((c + 0.5) * (bb.est - bb.ovest)) / 128, y = bb.nord - ((r + 0.5) * (bb.nord - bb.sud)) / 128;
    massimo = Math.max(massimo, Math.abs(q[r * 128 + c] - terreno(x, y)));
  }
  assert.ok(massimo < 0.1, `errore massimo ${massimo}`);
  // l'errore che si farebbe ignorando la georeferenziazione (scambiando il file per la tessera) è di decine di metri
  const ingenuo = ridimensiona(t.dati, t.larghezza, t.altezza, 128, 128);
  let sbagliato = 0;
  for (let r = 2; r < 126; r += 5) for (let c = 2; c < 126; c += 5) {
    const x = bb.ovest + ((c + 0.5) * (bb.est - bb.ovest)) / 128, y = bb.nord - ((r + 0.5) * (bb.nord - bb.sud)) / 128;
    sbagliato = Math.max(sbagliato, Math.abs(ingenuo[r * 128 + c] - terreno(x, y)));
  }
  assert.ok(sbagliato > 5, `senza georeferenziazione l'errore sarebbe solo ${sbagliato}`);
});
test("la fascia senza dato sul bordo esterno del file sparisce dopo il ritaglio sulla tessera", () => {
  const bb = bboxTessera(13, 4389, 2999), f = filePerBbox(allarga(bb, 0.0465), 13.92, 0);
  const { w, h, dati } = f;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (r < 6 || c < 6 || r >= h - 6 || c >= w - 6) dati[r * w + c] = SENZA_DATO;
  const t = leggiGeoTiff(creaTiff({ ...f, blocchi: 64 }));
  const q = ricampionaSuTessera(t, bb, 128, 128);
  assert.equal(q.filter((v) => !quotaValida(v)).length, 0);
});
test("un vuoto interno non viene mescolato nelle medie: i vicini restano 100 e il pixel vuoto resta vuoto (lo riempirà riempiVuoti)", () => {
  const w = 8, h = 8, dati = new Float32Array(w * h).fill(100);
  dati[3 * w + 3] = SENZA_DATO;
  const t = leggiGeoTiff(creaTiff({ w, h, dati, georef: { x0: 0, y0: 80, dx: 10, dy: -10 }, blocchi: 8 }));
  const q = ricampionaSuTessera(t, { ovest: 0, est: 80, sud: 0, nord: 80 }, 8, 8);
  q.forEach((v, i) => { if (i !== 3 * 8 + 3) vicino(v, 100, 1e-4, `pixel ${i}`); });
  assert.equal(q[3 * 8 + 3], SENZA_DATO);
  riempiVuoti(q, 8, 8, null);
  vicino(q[3 * 8 + 3], 100, 1e-4);
});
test("fra due pixel con un vuoto accanto la media usa solo il vicino valido (nessun -9999 nella media)", () => {
  const dati = Float32Array.from([100, SENZA_DATO, 100, 100]);
  const t = leggiGeoTiff(creaTiff({ w: 4, h: 1, dati, georef: { x0: 0, y0: 10, dx: 10, dy: -10 }, blocchi: 4 }));
  const q = ricampionaSuTessera(t, { ovest: 5, est: 25, sud: 0, nord: 10 }, 2, 1); // centri a 10 e 20: fra il pixel 0-1 e 1-2
  assert.ok(q.every((v) => v === 100), Array.from(q).join(","));
});
test("senza georeferenziazione il ricampionamento si rifiuta", () => {
  const t = leggiGeoTiff(creaTiff({ w: 4, h: 4, dati: new Float32Array(16), georef: null }));
  assert.throws(() => ricampionaSuTessera(t, bboxTessera(13, 1, 1), 4, 4), ErroreDem);
});
test("fuori dal file il risultato è «senza dato»", () => {
  const t = leggiGeoTiff(creaTiff({ w: 4, h: 4, dati: new Float32Array(16).fill(50), georef: { x0: 0, y0: 40, dx: 10, dy: -10 } }));
  const q = ricampionaSuTessera(t, { ovest: 100, est: 140, sud: 0, nord: 40 }, 4, 4);
  assert.ok(q.every((v) => v === SENZA_DATO));
});

console.log("vuoti");
test("i vuoti si riempiono con la tessera mondiale e il mare resta a 0 m", () => {
  const q = Float32Array.from([100, SENZA_DATO, SENZA_DATO, 120]), rip = Float32Array.from([90, 95, -30, 118]);
  const e = riempiVuoti(q, 2, 2, rip);
  assert.deepEqual(Array.from(q), [100, 95, 0, 120]);
  assert.equal(e.vuotiIniziali, 2); assert.equal(e.daRipiego, 2); assert.equal(e.tuttoVuoto, false);
});
test("senza tessera di ripiego i vuoti prendono il valore valido più vicino", () => {
  const q = Float32Array.from({ length: 16 }, () => SENZA_DATO);
  q[0] = 200; q[15] = 300;
  const e = riempiVuoti(q, 4, 4, null);
  assert.ok(q.every((v) => v >= 200 && v <= 300), Array.from(q).join(","));
  assert.equal(e.daVicino, 14);
});
test("se è tutto vuoto e non c'è ripiego, la tessera diventa piana a 0 e lo dichiara", () => {
  const q = new Float32Array(9).fill(SENZA_DATO);
  const e = riempiVuoti(q, 3, 3, null);
  assert.equal(e.tuttoVuoto, true); assert.ok(q.every((v) => v === 0));
});
test("quotaValida rifiuta -9999, NaN e valori assurdi", () => {
  assert.equal(quotaValida(-9999), false); assert.equal(quotaValida(NaN), false); assert.equal(quotaValida(99999), false);
  assert.equal(quotaValida(0), true); assert.equal(quotaValida(-3.5), true); assert.equal(quotaValida(2912), true);
});

console.log("formato Terrarium");
test("valori noti: 0 m → (128,0,0); 1 m → (128,1,0); -1 m → (127,255,0); 0,5 m → (128,0,128)", () => {
  const r = codificaTerrarium(Float32Array.from([0, 1, -1, 0.5]));
  assert.deepEqual([r[0], r[1], r[2], r[3]], [128, 0, 0, 255]);
  assert.deepEqual([r[4], r[5], r[6]], [128, 1, 0]);
  assert.deepEqual([r[8], r[9], r[10]], [127, 255, 0]);
  assert.deepEqual([r[12], r[13], r[14]], [128, 0, 128]);
});
test("andata e ritorno: errore sotto 1/256 m, da -400 a 4800 m", () => {
  const q = Float32Array.from({ length: 5000 }, (_, i) => -400 + (i * 5200) / 5000 + (i % 7) * 0.013);
  const r = decodificaTerrarium(codificaTerrarium(q));
  let massimo = 0;
  for (let i = 0; i < q.length; i++) massimo = Math.max(massimo, Math.abs(r[i] - q[i]));
  assert.ok(massimo <= 1 / 256 + 1e-6, `errore massimo ${massimo}`);
});
test("alfa sempre 255 (la tessera non deve perdere valori con la premoltiplicazione)", () => {
  const r = codificaTerrarium(Float32Array.from({ length: 100 }, (_, i) => i * 3.7));
  for (let i = 3; i < r.length; i += 4) assert.equal(r[i], 255);
});

console.log("tessera completa");
const FILE_TIN = (bb, passo = 13.92, vuotoBordo = 0) => {
  const f = filePerBbox(allarga(bb, 0.0465), passo, 0);
  if (vuotoBordo) for (let r = 0; r < f.h; r++) for (let c = 0; c < f.w; c++) if (r < vuotoBordo || c < vuotoBordo || r >= f.h - vuotoBordo || c >= f.w - vuotoBordo) f.dati[r * f.w + c] = SENZA_DATO;
  return leggiGeoTiff(creaTiff({ ...f, blocchi: 64 }));
};
test("TINITALY intero: fonte «tinitaly», niente vuoti, quote giuste", () => {
  const bb = bboxTessera(13, 4389, 2999);
  const t = componiTessera({ tiff: FILE_TIN(bb, 13.92, 6), z: 13, x: 4389, y: 2999, px: 64 });
  assert.equal(t.fonte, "tinitaly"); assert.equal(t.vuotiIniziali, 0); assert.equal(t.w, 64);
  const x = bb.ovest + (32.5 * (bb.est - bb.ovest)) / 64, y = bb.nord - (32.5 * (bb.nord - bb.sud)) / 64;
  vicino(t.quote[32 * 64 + 32], terreno(x, y), 0.2);
});
test("TINITALY con un buco e tessera mondiale: fonte «misto», il buco è colmato dal ripiego", () => {
  const bb = bboxTessera(13, 4389, 2999), f = filePerBbox(allarga(bb, 0.0465), 13.92, 0);
  for (let r = 0; r < f.h; r++) for (let c = 0; c < f.w; c++) if (r > 80 && r < 140 && c > 80 && c < 140) f.dati[r * f.w + c] = SENZA_DATO;
  const t = componiTessera({ tiff: leggiGeoTiff(creaTiff({ ...f, blocchi: 64 })), z: 13, x: 4389, y: 2999, px: 64, ripiego: new Float32Array(16 * 16).fill(333), ripiegoLato: 16 });
  assert.equal(t.fonte, "misto"); assert.ok(t.vuotiIniziali > 0); assert.ok(t.daRipiego > 0);
  assert.ok(t.quote.every(quotaValida));
});
test("senza TINITALY (fuori Italia o servizio in errore): solo la tessera mondiale, ridimensionata", () => {
  const t = componiTessera({ tiff: null, z: 13, x: 1, y: 1, px: 32, ripiego: Float32Array.from({ length: 16 }, (_, i) => 100 + i), ripiegoLato: 4 });
  assert.equal(t.fonte, "terrarium"); assert.equal(t.w, 32); assert.ok(t.quote.every((v) => v >= 100 && v <= 115));
});
test("TINITALY quasi tutto vuoto (mare, estero): si usa la tessera mondiale", () => {
  const bb = bboxTessera(13, 4403, 2990), w = 32, dati = new Float32Array(w * w).fill(SENZA_DATO);
  const t = leggiGeoTiff(creaTiff({ w, h: w, dati, georef: { x0: bb.ovest, y0: bb.nord, dx: (bb.est - bb.ovest) / w, dy: -(bb.nord - bb.sud) / w }, blocchi: 32 }));
  const r = componiTessera({ tiff: t, z: 13, x: 4403, y: 2990, px: 16, ripiego: new Float32Array(16).fill(-20), ripiegoLato: 4 });
  assert.equal(r.fonte, "terrarium");
});
test("senza nessuna fonte la composizione si rifiuta (il chiamante userà la tessera mondiale originale)", () => {
  assert.throws(() => componiTessera({ tiff: null, z: 13, x: 1, y: 1, px: 8 }), ErroreDem);
});
test("ridimensiona(): una rampa resta una rampa", () => {
  const q = ridimensiona(Float32Array.from([0, 10, 20, 30]), 4, 1, 8, 1);
  for (let i = 1; i < 8; i++) assert.ok(q[i] >= q[i - 1] - 1e-6);
  vicino(q[0], 0, 1e-6); vicino(q[7], 30, 1e-6);
});

console.log(`\n${ok} controlli superati${process.exitCode ? ", ma ce ne sono di falliti" : ""}.`);
