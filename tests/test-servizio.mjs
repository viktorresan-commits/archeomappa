// Rilievo dal LiDAR del servizio: indirizzi, blocchi, calibrazione in metri e analisi completa
// contro un servizio simulato. Esegui con: node tests/test-servizio.mjs
import assert from "node:assert/strict";
import {
  finestra, urlGetMap, urlQuota, leggiQuotaGfi, luminanza, unisciBlocchi, scegliPunti, regressione, calibra,
  scaricaFinestra, scaricaImmagine, scaricaTesto, ErroreServizio, metaDaPixel, statisticheGriglia,
} from "../js/lidar-servizio.js";
import { creaSessione, provaOppureRipiego, LATO_IMMAGINE_MAX } from "../js/analisi.js";
import { creaMotore } from "../js/motore.js";
import { mercatoreDiretta } from "../js/proj.js";

let ok = 0;
const pendenti = [];
const test = (nome, fn) => pendenti.push(Promise.resolve().then(fn).then(() => { ok++; console.log("  ok  ", nome); }, (e) => { process.exitCode = 1; console.log("  FAIL", nome, "\n      ", e.stack.split("\n").slice(0, 4).join("\n       ")); }));

// ------------------------------------------------------------ servizio simulato
const LAT = 43.3, LON = 12.9; // zona Marche
const [CX, CY] = mercatoreDiretta(LAT, LON);
const K = 1 / Math.cos((LAT * Math.PI) / 180);
const BASE = "http://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/servizi-LiDAR/LIDAR_MARCHE.map";
const LIV = "EL.LIDAR.MARCHE.1x1.DTM";

/** Quota vera (m) nel punto (dx, dy) in metri a terra dal centro: pendio, ondulazione, tumulo, recinto, aggere. */
function quota(dx, dy) {
  let z = 250 + 0.02 * dx + 0.012 * dy + 1.5 * Math.sin(dx / 60) * Math.cos(dy / 80);
  const d1 = Math.hypot(dx + 150, dy - 100); // tumulo: diametro 36 m, alto 2,2 m
  if (d1 < 18) z += 2.2 * 0.5 * (1 + Math.cos((Math.PI * d1) / 18));
  const ax = Math.abs(dx - 120), ay = Math.abs(dy + 90); // recinto 90×70 m: argine largo 6 m, alto 1,3 m, fossato fuori
  const lato = Math.max(ax / 45, ay / 35);
  const fuori = Math.max(ax - 45, ay - 35);
  if (lato <= 1 && fuori > -6) z += 1.3;
  else if (fuori > 0 && fuori < 4) z -= 0.9;
  const u = (dx + 220) * Math.cos(0.5) + (dy - 40) * Math.sin(0.5), v = -(dx + 220) * Math.sin(0.5) + (dy - 40) * Math.cos(0.5); // aggere 260×8 m
  if (u > 0 && u < 260 && Math.abs(v) < 4) z += 1.0;
  return z;
}
const zMerc = (X, Y) => quota((X - CX) / K, (Y - CY) / K);

/** modo "fisso": grigio = (z−zmin)/(zmax−zmin) sempre uguale; "auto": minimo e massimo di ogni richiesta. */
function servizio({ modo = "fisso", zmin = 200, zmax = 330, maxLato = Infinity, vuotoSopra = null, colore = false } = {}) {
  const richieste = [];
  const parametri = (url) => Object.fromEntries(new URL(url).searchParams.entries());
  const scarica = async (url) => {
    const p = parametri(url);
    richieste.push(url);
    const [x0, y0, x1, y1] = p.BBOX.split(",").map(Number);
    const w = Number(p.WIDTH), h = Number(p.HEIGHT);
    if (w > maxLato || h > maxLato) throw new ErroreServizio(`Il servizio ha risposto con un messaggio invece che con un'immagine: «msWMSLoadGetMapParams(): WMS server error. Image size out of range, WIDTH and HEIGHT must be between 1 and ${maxLato}».`, { dimensione: true });
    const z = new Float32Array(w * h);
    let mn = Infinity, mx = -Infinity;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const X = x0 + ((c + 0.5) * (x1 - x0)) / w, Y = y1 - ((r + 0.5) * (y1 - y0)) / h;
      const v = zMerc(X, Y);
      z[r * w + c] = v; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    const a = modo === "auto" ? mn : zmin, b = modo === "auto" ? mx : zmax;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const g = Math.round((255 * (z[i] - a)) / (b - a));
      const Y = y1 - ((Math.floor(i / w) + 0.5) * (y1 - y0)) / h;
      const vuoto = vuotoSopra != null && Y > vuotoSopra;
      rgba[i * 4] = g; rgba[i * 4 + 1] = colore ? 255 - g : g; rgba[i * 4 + 2] = colore ? 0 : g; rgba[i * 4 + 3] = vuoto ? 0 : 255;
    }
    return { w, h, rgba };
  };
  const leggiTesto = async (url) => {
    const p = parametri(url);
    richieste.push(url);
    const [x0, y0, x1, y1] = p.BBOX.split(",").map(Number);
    const v = zMerc((x0 + x1) / 2, (y0 + y1) / 2);
    return `GetFeatureInfo results:\n\nLayer '${LIV}'\n  Stretched value;Pixel Value;\n  ${Math.round(((v - zmin) / (zmax - zmin)) * 255)};${v.toFixed(2)};\n`;
  };
  return { scarica, leggiTesto, richieste, parametri };
}

console.log("indirizzi");
test("GetMap nello stesso formato dell'app che già funziona", () => {
  const u = urlGetMap(BASE, LIV, [1480000.1234, 5400000.5, 1480200.1234, 5400200.5], 256, 256);
  assert.equal(u, `${BASE}&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${LIV}&STYLES=&SRS=EPSG:3857&BBOX=1480000.123,5400000.500,1480200.123,5400200.500&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true`);
});
test("senza «?» nell'indirizzo base ne aggiunge uno", () => {
  assert.ok(urlGetMap("http://x.example/wms", "L", [0, 0, 1, 1], 8, 8).startsWith("http://x.example/wms?SERVICE=WMS"));
});
test("la richiesta di quota è la stessa dell'app che già funziona (3×3 pixel, text/plain)", () => {
  const u = new URL(urlQuota(BASE, LIV, 1000, 2000));
  assert.equal(u.searchParams.get("map"), "/ms_ogc/WMS_v1.3/servizi-LiDAR/LIDAR_MARCHE.map");
  assert.equal(u.searchParams.get("REQUEST"), "GetFeatureInfo");
  assert.equal(u.searchParams.get("QUERY_LAYERS"), LIV);
  assert.equal(u.searchParams.get("BBOX"), "998.500,1998.500,1001.500,2001.500");
  assert.deepEqual(["WIDTH", "HEIGHT", "X", "Y", "INFO_FORMAT"].map((k) => u.searchParams.get(k)), ["3", "3", "1", "1", "text/plain"]);
});
test("la quota si legge come fa l'altra app: secondo numero dopo «Stretched value;Pixel Value;»", () => {
  assert.equal(leggiQuotaGfi("Layer 'x'\n  Stretched value;Pixel Value;\n  143;245.32;\n"), 245.32);
  assert.equal(leggiQuotaGfi("Stretched value;Pixel Value; 12;-3.5;"), -3.5);
  assert.equal(leggiQuotaGfi("Stretched value;Pixel Value;\n 0;-9999;"), null, "valore «senza dato»");
  assert.equal(leggiQuotaGfi("<ServiceException>Invalid layer</ServiceException>"), null);
  assert.equal(leggiQuotaGfi(undefined), null);
});
test("la finestra è quadrata a terra e rispetta il limite di pixel", () => {
  const f = finestra(LAT, LON, 500);
  assert.equal(f.n, 1000);
  assert.ok(Math.abs((f.bbox[2] - f.bbox[0]) - (f.bbox[3] - f.bbox[1])) < 1e-6);
  assert.ok(Math.abs((f.bbox[2] - f.bbox[0]) * Math.cos((LAT * Math.PI) / 180) - 1000) < 0.01, "1000 m a terra");
  const g = finestra(LAT, LON, 3000);
  assert.equal(g.n, 2400); assert.ok(g.cellaTerraM > 2.4 && g.cellaTerraM < 2.6);
});

console.log("pixel e blocchi");
test("la luminosità ignora i pixel trasparenti e riconosce i grigi", () => {
  const rgba = new Uint8ClampedArray([100, 100, 100, 255, 0, 0, 0, 0, 255, 0, 0, 255, 50, 52, 49, 255]);
  const l = luminanza(rgba, 4, 1);
  assert.ok(Number.isNaN(l.dati[1]));
  assert.equal(l.validi, 3); assert.equal(l.grigi, 2);
  assert.ok(Math.abs(l.dati[0] - 100) < 1e-4);
  const s = statisticheGriglia(l.dati);
  assert.equal(s.livelli, 3);
});
test("i blocchi con grigi adattati a ogni richiesta vengono riportati alla stessa scala", () => {
  const n = 200, vero = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) vero[r * n + c] = 100 + 0.3 * c + 8 * Math.sin(r / 7) * Math.cos(c / 9);
  const taglia = (r0, c0, w, h, a, g) => {
    const d = new Float32Array(w * h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) d[r * w + c] = a + g * vero[(r0 + r) * n + c0 + c];
    return { dati: d, w, h, r0, c0 };
  };
  const { dati, correzioni } = unisciBlocchi([taglia(0, 0, 120, 200, 0, 1), taglia(0, 96, 104, 200, 37, 1.4)], n);
  let massimo = 0;
  for (let i = 0; i < dati.length; i++) massimo = Math.max(massimo, Math.abs(dati[i] - vero[i]));
  assert.ok(massimo < 0.05, `errore massimo ${massimo}`);
  assert.ok(Math.abs(correzioni[1].g - 1 / 1.4) < 0.01);
});
test("regressione: retta esatta e dati senza relazione", () => {
  const r = regressione([0, 10, 20, 30, 40, 50].map((g) => ({ g, z: 3 + 0.25 * g })));
  assert.ok(Math.abs(r.a - 3) < 1e-9 && Math.abs(r.b - 0.25) < 1e-9 && r.r2 > 0.999999);
  const q = regressione([{ g: 1, z: 5 }, { g: 2, z: -3 }, { g: 3, z: 8 }, { g: 4, z: -9 }, { g: 5, z: 2 }]);
  assert.ok(q.r2 < 0.2);
});

console.log("calibrazione in metri");
for (const modo of ["fisso", "auto"]) {
  test(`griglia scaricata a blocchi (${modo}): quote in metri vicine al vero, passo misurato`, async () => {
    const sv = servizio({ modo });
    const r = await scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: 450, scarica: sv.scarica, leggiTesto: sv.leggiTesto, blocchi: [400] });
    assert.equal(r.relativo, false, JSON.stringify(r.calibrazione));
    assert.ok(r.calibrazione.ok && r.calibrazione.r2 > 0.99, JSON.stringify(r.calibrazione));
    assert.ok(r.avvisi.some((a) => /blocchi/.test(a)), r.avvisi.join(" | "));
    // errore rispetto alla quota vera (esclusi i bordi dove ci sono ricampionamenti)
    const { n = r.w } = {};
    let somma = 0, cnt = 0;
    const px = (r.bbox[2] - r.bbox[0]) / r.w;
    for (let rr = 20; rr < r.h - 20; rr += 7) for (let c = 20; c < r.w - 20; c += 7) {
      const v = r.dati[rr * r.w + c];
      if (v !== v) continue;
      const vero = zMerc(r.bbox[0] + (c + 0.5) * px, r.bbox[3] - (rr + 0.5) * px);
      somma += (v - vero) ** 2; cnt++;
    }
    const rms = Math.sqrt(somma / cnt);
    assert.ok(rms < 0.35, `errore quadratico medio ${rms.toFixed(3)} m (passo ${r.passoM?.toFixed(3)} m)`);
    assert.ok(n === r.w);
    if (modo === "fisso") assert.ok(Math.abs(r.passoM - 130 / 255) < 0.03, `passo ${r.passoM}`);
  });
}
test("servizio con grigi poco fini: il passo è misurato e il limite è dichiarato", async () => {
  const sv = servizio({ modo: "fisso", zmin: 0, zmax: 330 }); // 1,3 m per livello
  const r = await scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: 450, scarica: sv.scarica, leggiTesto: sv.leggiTesto, blocchi: [500] });
  assert.equal(r.relativo, false, JSON.stringify(r.calibrazione));
  assert.ok(Math.abs(r.passoM - 330 / 255) < 0.05, `passo ${r.passoM}`);
  assert.ok(r.avvisi.some((a) => /sotto 1 m non si distinguono/.test(a)), r.avvisi.join(" | "));
});
test("servizio con grigi molto grossolani: pochi livelli, nessuna conversione, avvisi onesti", async () => {
  const sv = servizio({ modo: "fisso", zmin: 0, zmax: 1500 }); // 5,9 m per livello: l'area ne usa 3-4
  const r = await scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: 300, scarica: sv.scarica, leggiTesto: sv.leggiTesto });
  assert.equal(r.relativo, true);
  assert.equal(r.calibrazione.ok, false);
  assert.ok(r.avvisi.some((a) => /solo \d+ livelli di grigio/.test(a)), r.avvisi.join(" | "));
  assert.ok(r.avvisi.some((a) => /Quote non convertite in metri/.test(a)), r.avvisi.join(" | "));
});
test("se il servizio non dà le quote, i valori restano livelli e l'app lo dichiara", async () => {
  const sv = servizio();
  const r = await scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: 300, scarica: sv.scarica, leggiTesto: async () => { throw new Error("rete"); } });
  assert.equal(r.relativo, true);
  assert.equal(r.calibrazione.ok, false);
  assert.ok(r.avvisi.some((a) => /Quote non convertite in metri/.test(a) && /livelli di grigio, relativi/.test(a)), r.avvisi.join(" | "));
  const sv2 = servizio();
  const r2 = await scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: 300, scarica: sv2.scarica, leggiTesto: async () => "<ServiceException>Invalid layer</ServiceException>" });
  assert.equal(r2.relativo, true);
  assert.match(r2.calibrazione.motivo, /0 punti|punti su/);
});
test("la calibrazione rifiuta grigi che non seguono la quota", async () => {
  const sv = servizio();
  const r = await scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: 300, scarica: sv.scarica, leggiTesto: async (u) => {
    const t = await sv.leggiTesto(u);
    return t.replace(/;(-?\d+\.\d+);/, (_, v) => `;${(Number(v) * 7919 % 97).toFixed(2)};`); // quote scollegate dai grigi
  } });
  assert.equal(r.relativo, true);
  assert.match(r.calibrazione.motivo, /lineare|punti/);
});
test("calibra: terreno piatto → non calibra e spiega perché", async () => {
  const n = 120, dati = new Float32Array(n * n).fill(120);
  const c = await calibra({ dati, n, bbox: [0, 0, 120, 120], base: BASE, livello: LIV, leggiTesto: async () => "" });
  assert.equal(c.ok, false); assert.match(c.motivo, /uniforme|piana/);
  assert.equal((await calibra({ dati, n, bbox: [0, 0, 1, 1], base: BASE, livello: LIV })).ok, false);
});
test("i punti di calibrazione stanno in zone piane e a grigi diversi", () => {
  const n = 200, dati = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dati[r * n + c] = Math.floor(c / 10) * 6;
  const p = scegliPunti(dati, n, 9);
  assert.ok(p.length >= 7);
  const g = p.map((x) => x.g);
  assert.ok(Math.max(...g) - Math.min(...g) > 60);
});

console.log("richieste al servizio");
test("l'area è chiesta a blocchi che si sovrappongono e coprono tutto", async () => {
  const sv = servizio();
  await scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: 600, scarica: sv.scarica, leggiTesto: sv.leggiTesto, calibrare: false, blocchi: [500] });
  const mappe = sv.richieste.filter((u) => /GetMap/.test(u)).map((u) => sv.parametri(u));
  assert.equal(mappe.length, 9);
  assert.ok(mappe.every((p) => p.SRS === "EPSG:3857" && p.VERSION === "1.1.1" && p.LAYERS === LIV && p.map?.endsWith("LIDAR_MARCHE.map")));
  const xs = mappe.flatMap((p) => p.BBOX.split(",").map(Number).filter((_, i) => i % 2 === 0));
  const f = finestra(LAT, LON, 600);
  assert.ok(Math.min(...xs) <= f.bbox[0] + 1e-3 && Math.max(...xs) >= f.bbox[2] - 1e-3);
});
test("se il servizio rifiuta le richieste grandi passa a blocchi più piccoli", async () => {
  const sv = servizio({ maxLato: 300 });
  const r = await scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: 300, scarica: sv.scarica, leggiTesto: sv.leggiTesto, calibrare: false });
  assert.equal(r.w, 600);
  const lati = sv.richieste.map((u) => Number(sv.parametri(u).WIDTH));
  assert.equal(lati[0], 600, "il primo tentativo prende tutta l'area");
  assert.ok(lati.slice(-9).every((l) => l <= 256), `ultime richieste: ${lati.slice(-9)}`);
  assert.equal(lati.length, 1 + 1 + 9, "il rifiuto arriva alla prima richiesta di ogni giro; poi 9 blocchi da 256");
  assert.ok(r.statistiche.frazioneValidi > 0.99);
});
test("un errore del servizio diverso dalla dimensione viene riportato com'è", async () => {
  const scarica = async () => { throw new ErroreServizio("Il servizio ha risposto con un messaggio invece che con un'immagine: «Invalid layer(s) given in the LAYERS parameter».", { dimensione: false }); };
  await assert.rejects(scaricaFinestra({ base: BASE, livello: "SBAGLIATO", lat: LAT, lon: LON, raggioM: 300, scarica }), /Invalid layer/);
});
test("fuori copertura: immagine vuota → errore chiaro", async () => {
  const sv = servizio({ vuotoSopra: -1e9 });
  await assert.rejects(scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: 300, scarica: sv.scarica, leggiTesto: sv.leggiTesto }), /fuori dalla copertura/);
});
test("immagine a colori: avvertimento", async () => {
  const sv = servizio({ colore: true });
  const r = await scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: 300, scarica: sv.scarica, calibrare: false });
  assert.ok(r.avvisi.some((a) => /a colori/.test(a)));
});
test("raggio grande: pixel più grossi e avviso", async () => {
  const sv = servizio();
  const r = await scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: 2500, scarica: sv.scarica, calibrare: false, blocchi: [1000] });
  assert.equal(r.w, 2400);
  assert.ok(r.avvisi.some((a) => /Pixel da 2,1 m/.test(a)), r.avvisi.join(" | "));
});
test("app Android: la risposta di errore del servizio (XML) arriva leggibile all'utente", async () => {
  const win = { Capacitor: { isNativePlatform: () => true, Plugins: { CapacitorHttp: { get: async () => ({
    status: 200, headers: { "Content-Type": "text/xml" },
    data: Buffer.from('<?xml version="1.0"?><ServiceExceptionReport><ServiceException> msWMSLoadGetMapParams(): WMS server error. Image size out of range, WIDTH and HEIGHT must be between 1 and 2048 pixels. </ServiceException></ServiceExceptionReport>').toString("base64"),
  }) } } } };
  await assert.rejects(scaricaImmagine("http://x", { win }), (e) => e instanceof ErroreServizio && e.dimensione === true && /Image size out of range/.test(e.message));
  win.Capacitor.Plugins.CapacitorHttp.get = async () => ({ status: 503, headers: {}, data: "" });
  await assert.rejects(scaricaImmagine("http://x", { win }), /503/);
  win.Capacitor.Plugins.CapacitorHttp.get = async () => { throw new Error("timeout"); };
  await assert.rejects(scaricaImmagine("http://x", { win }), /non risponde \(timeout\)/);
  win.Capacitor.Plugins.CapacitorHttp.get = async () => ({ status: 200, headers: {}, data: "SSsrOQ==" });
  assert.equal(await scaricaTesto("http://x", { win }), "SSsrOQ==");
});
test("da una pagina web senza CORS il messaggio spiega app Android e proxy", async () => {
  const win = { fetch: async () => { throw new TypeError("Failed to fetch"); } };
  await assert.rejects(scaricaImmagine("https://x", { win }), /app Android[^]*proxy/);
});

console.log("analisi dal servizio");
const raggio = 450;
async function griglia(opz) {
  const sv = servizio(opz);
  return scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: raggio, scarica: sv.scarica, leggiTesto: sv.leggiTesto, blocchi: [500] });
}
test("apriPixel: metadati copiabili e coerenti", async () => {
  const g = await griglia({ modo: "auto" });
  const s = creaSessione();
  const info = await s.apriPixel(g);
  assert.doesNotThrow(() => structuredClone(info));
  assert.equal(info.servizio, true); assert.equal(info.epsg, 3857); assert.equal(info.relativo, false);
  assert.ok(Math.abs(info.pixelM - 1) < 0.01, `pixel ${info.pixelM}`); // il pixel è di 1 m a terra (più largo in metri Mercatore)
  assert.ok(info.copertura.sud < LAT && info.copertura.nord > LAT && info.copertura.ovest < LON && info.copertura.est > LON);
});
test("la visualizzazione si calcola dal servizio e la griglia è in metri", async () => {
  const g = await griglia({ modo: "fisso" });
  const s = creaSessione();
  await s.apriPixel(g);
  const r = await s.analizza({ lat: LAT, lon: LON, raggioM: 300, vis: { tipo: "multi", esagerazione: 2 } });
  assert.equal(r.griglia.unita, "m");
  assert.equal(r.immagine.rgba.length, r.immagine.w * r.immagine.h * 4);
  assert.ok(!r.avvisi.some((a) => /ricampionato in UTM/.test(a)));
  assert.doesNotThrow(() => structuredClone(r));
});
test("cerca tumulo, recinto e aggere nel LiDAR simulato (grigi adattati a ogni richiesta)", async () => {
  const g = await griglia({ modo: "auto" });
  const s = creaSessione();
  await s.apriPixel(g);
  const r = await s.analizza({ lat: LAT, lon: LON, raggioM: raggio, vis: { tipo: "lrm" }, cercaAnomalie: true, imp: { distSitiM: 0, escludiEdifici: false, escludiStrade: false } });
  const per = {};
  for (const a of r.rilevamento.anomalie) (per[a.codice] ??= []).push(a);
  const vicino = (a, dx, dy) => Math.hypot((a.lon - LON) * 111320 * Math.cos((LAT * Math.PI) / 180) - dx, (a.lat - LAT) * 111140 - dy);
  assert.ok((per.circolare ?? []).some((a) => vicino(a, -150, 100) < 25), `tumulo non trovato: ${JSON.stringify(Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.length])))}`);
  assert.ok((per.recinto ?? []).some((a) => vicino(a, 120, -90) < 30), `recinto non trovato: ${JSON.stringify(Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.length])))}`);
  assert.ok((per.lineare ?? []).length >= 1, "aggere non trovato");
  assert.ok(r.rilevamento.regole.some((t) => /Contrasto minimo: [\d,]+ m /.test(t)), r.rilevamento.regole.join(" | "));
});
test("in livelli relativi il rilevatore lavora lo stesso e dichiara l'unità", async () => {
  const sv = servizio({ modo: "auto" });
  const g = await scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: raggio, scarica: sv.scarica, leggiTesto: async () => "", blocchi: [500] });
  assert.equal(g.relativo, true);
  const s = creaSessione();
  const info = await s.apriPixel(g);
  assert.equal(info.relativo, true);
  const r = await s.analizza({ lat: LAT, lon: LON, raggioM: raggio, vis: { tipo: "lrm" }, cercaAnomalie: true, imp: { distSitiM: 0, escludiEdifici: false, escludiStrade: false } });
  assert.equal(r.griglia.unita, "livelli");
  assert.ok(r.rilevamento.regole.some((t) => /Contrasto minimo: [\d,]+ livelli/.test(t)), r.rilevamento.regole.join(" | "));
  assert.ok(r.rilevamento.anomalie.length >= 2, `${r.rilevamento.anomalie.length} anomalie`);
});
test("il motore (modalità thread) riapre il rilievo del servizio", async () => {
  const g = await griglia({ modo: "fisso" });
  const m = creaMotore({ crea: () => { throw new Error("niente worker in Node"); } });
  const info = await m.apriPixel(g);
  assert.equal(info.servizio, true);
  const r = await m.analizza({ lat: LAT, lon: LON, raggioM: 300, vis: { tipo: "ombre", esagerazione: 1 } });
  assert.ok(r.immagine.w > 100);
  assert.equal(m.modalita, "thread");
  await m.chiudi();
});
test("la visualizzazione dal servizio leviga i gradini a 8 bit e lo dice; si può disattivare", async () => {
  const g = await griglia({ modo: "fisso" });
  assert.ok(g.passoM > 0.4 && g.passoM < 0.6, `gradino ${g.passoM}`);
  const s = creaSessione();
  await s.apriPixel(g);
  const con = await s.analizza({ lat: LAT, lon: LON, raggioM: 300, vis: { tipo: "multi", esagerazione: 2 } });
  assert.ok(con.avvisi.some((a) => /Gradini del servizio levigati.*0,5\d m/.test(a)), con.avvisi.join(" | "));
  const senza = await s.analizza({ lat: LAT, lon: LON, raggioM: 300, vis: { tipo: "multi", esagerazione: 2 }, leviga: false });
  assert.ok(!senza.avvisi.some((a) => /levigati/.test(a)));
  // le due immagini hanno la stessa forma ma non gli stessi pixel
  assert.equal(con.immagine.w, senza.immagine.w);
  let diversi = 0;
  for (let i = 0; i < con.immagine.rgba.length; i += 4 * 97) if (Math.abs(con.immagine.rgba[i] - senza.immagine.rgba[i]) > 2) diversi++;
  assert.ok(diversi > 20, `${diversi} campioni diversi`);
});
test("l'immagine sulla mappa ha il doppio dei pixel del rilievo (entro il tetto) e non perde la copertura", async () => {
  const g = await griglia({ modo: "fisso" });
  const s = creaSessione();
  await s.apriPixel(g);
  const r = await s.analizza({ lat: LAT, lon: LON, raggioM: 300, vis: { tipo: "ombre" } });
  assert.ok(r.immagine.w >= r.griglia.w * 1.8 && r.immagine.w <= LATO_IMMAGINE_MAX, `${r.griglia.w} → ${r.immagine.w}`);
  let opachi = 0;
  for (let i = 3; i < r.immagine.rgba.length; i += 4) if (r.immagine.rgba[i] > 200) opachi++;
  assert.ok(opachi / (r.immagine.w * r.immagine.h) > 0.8, `${opachi / (r.immagine.w * r.immagine.h)}`);
});
test("l'immagine sulla mappa non supera 2400 pixel per lato nemmeno con aree grandi (memoria dei telefoni)", async () => {
  assert.equal(LATO_IMMAGINE_MAX, 2400);
  const sv = servizio({ modo: "fisso" });
  const g = await scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: 1000, scarica: sv.scarica, leggiTesto: sv.leggiTesto, blocchi: [1000, 500, 256] });
  const s = creaSessione();
  await s.apriPixel(g);
  const r = await s.analizza({ lat: LAT, lon: LON, raggioM: 1000, vis: { tipo: "ombre" } });
  assert.ok(r.griglia.w >= 1900, `griglia ${r.griglia.w}`);
  assert.ok(r.immagine.w <= 2400 && r.immagine.h <= 2400, `${r.immagine.w}×${r.immagine.h}`);
  assert.ok(r.immagine.rgba.length <= 2400 * 2400 * 4);
});
test("dati relativi (grigi che non sono quote): nessuna levigatura, niente avviso sui gradini", async () => {
  const sv = servizio();
  const g = await scaricaFinestra({ base: BASE, livello: LIV, lat: LAT, lon: LON, raggioM: 300, scarica: sv.scarica, leggiTesto: async () => { throw new Error("rete"); } });
  assert.equal(g.relativo, true);
  const s = creaSessione();
  await s.apriPixel(g);
  const r = await s.analizza({ lat: LAT, lon: LON, raggioM: 300, vis: { tipo: "multi", esagerazione: 2 } });
  assert.ok(!r.avvisi.some((a) => /levigati/.test(a)), r.avvisi.join(" | "));
  assert.ok(r.immagine.w > 100);
});
test("provaOppureRipiego: se il calcolo pesante fallisce (memoria) usa quello semplice e lo dice", () => {
  const avvisi = [];
  const v = provaOppureRipiego(() => { throw new RangeError("Array buffer allocation failed"); }, () => "semplice", avvisi, "Calcolo pesante non riuscito");
  assert.equal(v, "semplice");
  assert.equal(avvisi.length, 1);
  assert.match(avvisi[0], /Calcolo pesante non riuscito.*Array buffer allocation failed/);
  const ok2 = [];
  assert.equal(provaOppureRipiego(() => "pesante", () => "semplice", ok2, "x"), "pesante");
  assert.deepEqual(ok2, []);
});
test("provaOppureRipiego: se fallisce anche quello semplice l'errore arriva all'utente", () => {
  assert.throws(() => provaOppureRipiego(() => { throw new Error("a"); }, () => { throw new Error("b"); }, [], "x"), /b/);
});
test("metaDaPixel: la copertura è la finestra scaricata", async () => {
  const g = await griglia({ modo: "fisso" });
  const m = metaDaPixel(g);
  assert.ok(Math.abs((m.copertura.nord - m.copertura.sud) * 111140 - 2 * raggio) < 4, `${(m.copertura.nord - m.copertura.sud) * 111140} m`);
  assert.equal(m.tipo, "servizio");
});

await Promise.all(pendenti);
console.log(`\n${ok} controlli eseguiti${process.exitCode ? ", CON ERRORI" : ", tutti superati"}.`);
