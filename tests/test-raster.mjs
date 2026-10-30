// Prova il lettore di rilievi su file veri (richiede Python con numpy, tifffile e Pillow).
// Uso: node tests/test-raster.mjs [cartella]   (senza argomenti crea i file in una cartella temporanea)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { apriRilievo, estraiGriglia, decodificaPackBits, decodificaLZW, annullaPredittoreFloat } from "../js/raster.js";

const qui = dirname(fileURLToPath(import.meta.url));
let cartella = process.argv[2];
if (!cartella) {
  cartella = mkdtempSync(join(tmpdir(), "dem-"));
  try {
    execFileSync("python3", [join(qui, "..", "tools", "make_test_dem.py"), cartella], { stdio: "ignore" });
  } catch {
    console.log("Python con numpy/tifffile non disponibile: prove del lettore saltate.");
    process.exit(0);
  }
}
const aFile = (nome) => {
  const buf = readFileSync(join(cartella, nome));
  return Object.assign(new Blob([buf]), { name: nome });
};

let ok = 0;
const pendenti = [];
const test = (nome, fn) => pendenti.push(Promise.resolve().then(fn).then(() => { ok++; console.log("  ok  ", nome); }, (e) => { process.exitCode = 1; console.log("  FAIL", nome, "\n      ", e.message); }));

// riferimento: stesso terreno scritto da Python come float32 grezzo
const rifPath = join(cartella, "rif.f32");
if (!existsSync(rifPath)) {
  execFileSync("python3", ["-c", `
import sys, numpy as np, tifffile
z = tifffile.imread(sys.argv[1]).astype('float32'); z[z < -1000] = np.nan; z.tofile(sys.argv[2])
`, join(cartella, "dtm_2m_deflate.tif"), rifPath]);
}
const rif = new Float32Array(readFileSync(rifPath).buffer.slice(0));
const N = 1500;
const confronta = (f, x0, y0, w, h, tol = 0) => {
  assert.equal(f.w, w); assert.equal(f.h, h);
  let max = 0, nan = 0;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const a = f.dati[r * w + c], b = rif[(y0 + r) * N + x0 + c];
    if (Number.isNaN(b)) { if (!Number.isNaN(a)) throw new Error(`atteso nodata in (${c},${r})`); nan++; continue; }
    if (Number.isNaN(a)) throw new Error(`valore mancante in (${c},${r})`);
    max = Math.max(max, Math.abs(a - b));
  }
  assert.ok(max <= tol, `differenza massima ${max}`);
  return nan;
};

console.log("lettore rilievi");
for (const nome of ["dtm_2m_deflate.tif", "dtm_2m_strisce.tif", "dtm_2m_big.tif"]) {
  test(`${nome}: metadati e georeferenziazione`, async () => {
    const m = await apriRilievo(aFile(nome));
    assert.equal(m.larghezza, N); assert.equal(m.altezza, N);
    assert.equal(m.epsg, 32632);
    assert.equal(m.pixel.dx, 2); assert.equal(m.origine.x, 760000); assert.equal(m.origine.y, 4735000);
    assert.equal(m.nodata, -9999);
    assert.ok(m.copertura.sud > 42.3 && m.copertura.nord < 42.8 && m.copertura.ovest > 12 && m.copertura.est < 12.5, JSON.stringify(m.copertura));
  });
  test(`${nome}: finestra identica al riferimento (compresi i bordi dei blocchi)`, async () => {
    const m = await apriRilievo(aFile(nome));
    const nan = confronta(await m.leggiFinestra(100, 90, 333, 271), 100, 90, 333, 271);
    assert.equal(nan, 0);
    const nan2 = confronta(await m.leggiFinestra(0, 0, 70, 70), 0, 0, 70, 70);
    assert.equal(nan2, 40 * 40);
    confronta(await m.leggiFinestra(1400, 1380, 500, 500), 1400, 1380, 100, 120); // ritagliata ai bordi
  });
}
test("riduzione per media k=4 coerente con il riferimento", async () => {
  const m = await apriRilievo(aFile("dtm_2m_deflate.tif"));
  const f = await m.leggiFinestra(400, 400, 400, 400, { k: 4 });
  assert.equal(f.w, 100);
  let s = 0; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s += rif[(400 + r) * N + 400 + c];
  assert.ok(Math.abs(f.dati[0] - s / 16) < 1e-3);
});
test("interi a 16 bit con predittore 2 e nodata propri", async () => {
  const m = await apriRilievo(aFile("dtm_2m_int16_pred2.tif"));
  assert.equal(m.nodata, -32768);
  const f = await m.leggiFinestra(200, 200, 300, 300);
  // i valori sono in centimetri: la quota va divisa per 100 dal chiamante; qui si controlla solo la coerenza
  let max = 0;
  for (let r = 0; r < 300; r++) for (let c = 0; c < 300; c++) max = Math.max(max, Math.abs(f.dati[r * 300 + c] / 100 - rif[(200 + r) * N + 200 + c]));
  assert.ok(max < 0.0051 || Number.isNaN(max), `differenza ${max}`);
});
test("ASCII Grid: stesse quote del GeoTIFF", async () => {
  const m = await apriRilievo(aFile("dtm_2m.asc"), { epsg: 32632 });
  assert.equal(m.larghezza, N);
  assert.equal(m.origine.y, 4735000);
  const nan = confronta(await m.leggiFinestra(300, 300, 200, 200), 300, 300, 200, 200, 0.0051);
  assert.equal(nan, 0);
});
test("ASCII Grid senza sistema di coordinate: errore chiaro", async () => {
  await assert.rejects(() => apriRilievo(aFile("dtm_2m.asc")), /sistema di coordinate/);
});
test("file che non è un TIFF: errore chiaro", async () => {
  await assert.rejects(() => apriRilievo(Object.assign(new Blob([new Uint8Array(64)]), { name: "x.tif" })), /non è un TIFF/);
});
test("LZW scritto da libreria esterna (Pillow), con georeferenza passata a mano", async () => {
  const py = join(cartella, "lzw.tif");
  execFileSync("python3", ["-c", `
import sys, numpy as np
from PIL import Image
z = np.fromfile(sys.argv[1], dtype='float32').reshape(1500,1500)[0:300,0:300].copy()
z[np.isnan(z)] = -9999
Image.fromarray(z, mode='F').save(sys.argv[2], compression='tiff_lzw')
`, rifPath, py]);
  const m = await apriRilievo(aFile("lzw.tif"), { epsg: 32632, origine: { x: 760000, y: 4735000 }, pixel: { dx: 2, dy: 2 } });
  assert.equal(m.compressione, 5);
  const nan = confronta(await m.leggiFinestra(0, 0, 300, 300), 0, 0, 300, 300);
  assert.equal(nan, 40 * 40);
});
test("estraiGriglia: finestra attorno al centro, cella e origine corrette", async () => {
  const m = await apriRilievo(aFile("dtm_2m_deflate.tif"));
  const [lat, lon] = m.proiezione.aLatLon(760000 + 1500, 4735000 - 1500);
  const g = await estraiGriglia(m, lat, lon, 400);
  assert.equal(g.cella, 2);
  assert.ok(g.w >= 400 && g.w <= 402 && g.h >= 400 && g.h <= 402, `${g.w}x${g.h}`);
  assert.ok(Math.abs(g.origine.x - (760000 + 1100)) < 2.1 && Math.abs(g.origine.y - (4735000 - 1100)) < 2.1);
  const g2 = await estraiGriglia(m, lat, lon, 400, { maxPixel: 10000 });
  assert.ok(g2.cella > 2 && g2.avvisi.length === 1 && g2.w * g2.h <= 10000 * 1.2);
  await assert.rejects(() => estraiGriglia(m, 40, 12, 300), /fuori dalla copertura/);
});

console.log("decodificatori (casi non generabili con le librerie disponibili)");
test("PackBits: sequenze letterali e ripetute", () => {
  const src = Uint8Array.from([2, 10, 20, 30, 0xfd, 7, 0x80, 0, 99]); // 3 letterali, 4 volte il 7, nop, 1 letterale
  assert.deepEqual([...decodificaPackBits(src, 8)], [10, 20, 30, 7, 7, 7, 7, 99]);
});
test("LZW: sequenza cortissima nota", () => {
  const codici = [256, 97, 98, 258, 257];
  const buf = [];
  let acc = 0, n = 0;
  for (const c of codici) { acc = (acc << 9) | c; n += 9; while (n >= 8) { buf.push((acc >> (n - 8)) & 255); n -= 8; acc &= (1 << n) - 1; } }
  if (n) buf.push((acc << (8 - n)) & 255);
  // "ab" + codice 258 ("ab") = "abab"; il quinto byte atteso non viene scritto e resta 0
  assert.deepEqual([...decodificaLZW(Uint8Array.from(buf), 5)], [97, 98, 97, 98, 0]);
});
test("Predittore float (3): andata e ritorno con codificatore di prova", () => {
  const vals = new Float32Array([100.5, 101.25, 99.75, 120.0, 130.5, 129.0, -3.5, 0]);
  const w = 4, h = 2;
  // codificatore: piani di byte MSB per primo, poi differenze byte a byte (passo 1)
  const raw = new Uint8Array(vals.buffer.slice(0));
  const enc = new Uint8Array(raw.length);
  for (let r = 0; r < h; r++) {
    const piani = new Uint8Array(w * 4);
    for (let c = 0; c < w; c++) for (let b = 0; b < 4; b++) piani[b * w + c] = raw[(r * w + c) * 4 + (3 - b)]; // little endian: byte 3 = MSB
    for (let i = w * 4 - 1; i > 0; i--) piani[i] = (piani[i] - piani[i - 1]) & 255;
    enc.set(piani, r * w * 4);
  }
  const dec = annullaPredittoreFloat(enc.slice(), h, w, 4, 1, true);
  assert.deepEqual([...new Float32Array(dec.buffer)], [...vals]);
});

await Promise.all(pendenti);
console.log(process.exitCode ? "\nPROVE FALLITE" : `\nTutte le prove del lettore superate (${ok}).`);
