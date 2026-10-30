// Test della logica pura (nessun browser). Esegui con: node tests/test.mjs
import assert from "node:assert/strict";
import { haversine, compass, projector, bboxAround, delaunay, triQuality, triArea, formatDist, pointInPolygon } from "../js/geo.js";
import { calcolaZone, PARAMETRI_BASE, zoneInGeoJSON } from "../js/potential.js";
import { classifica, dominante, epocaDaAnno, profilo } from "../js/epochs.js";
import { leggiOverpass, costruisciQueryOverpass, leggiCapabilities, urlCapabilities, cercaLuogo, costruisciQueryEdificiStrade, leggiEdificiStrade } from "../js/sources.js";
import { urlSicuro, inCsv, soloTesto, tronca } from "../js/util.js";
import { urlProva } from "../js/layers.js";

let ok = 0;
const pendenti = [];
const segna = (nome) => { ok++; console.log("  ok  ", nome); };
const fallisce = (nome, e) => { console.error("  FAIL", nome, "\n      ", e.message); process.exitCode = 1; };
const test = (nome, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === "function") pendenti.push(r.then(() => segna(nome), (e) => fallisce(nome, e)));
    else segna(nome);
  } catch (e) {
    fallisce(nome, e);
  }
};

// Generatore pseudo-casuale riproducibile.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

console.log("geo");
test("haversine Roma–Milano ≈ 477 km", () => {
  const d = haversine(41.9028, 12.4964, 45.4642, 9.19) / 1000;
  assert.ok(d > 475 && d < 480, String(d));
});
test("haversine stesso punto = 0", () => assert.equal(haversine(42, 12, 42, 12), 0));
test("direzione: nord e est", () => {
  assert.equal(compass(42, 12, 43, 12), "N");
  assert.equal(compass(42, 12, 42, 13), "E");
  assert.equal(compass(42, 12, 41, 11), "SO");
});
test("proiezione locale andata e ritorno", () => {
  const p = projector(42.5, 12.5);
  const [x, y] = p.toXY(42.6, 12.7);
  const [la, lo] = p.toLatLon(x, y);
  assert.ok(Math.abs(la - 42.6) < 1e-9 && Math.abs(lo - 12.7) < 1e-9);
});
test("proiezione: 1 km a nord ≈ 1000 m", () => {
  const p = projector(42, 12);
  const [, y] = p.toXY(42 + 1000 / 111195, 12);
  assert.ok(Math.abs(y - 1000) < 5, String(y));
});
test("bbox attorno al punto contiene il raggio", () => {
  const [s, o, n, e] = bboxAround(42, 12, 5000);
  assert.ok(Math.abs(haversine(42, 12, n, 12) - 5000) < 5);
  assert.ok(Math.abs(haversine(42, 12, 42, e) - 5000) < 5);
  assert.ok(s < 42 && o < 12);
});
test("formatDist", () => {
  assert.equal(formatDist(430), "430 m");
  assert.equal(formatDist(1500), "1,50 km");
  assert.equal(formatDist(25000), "25.0 km".replace(".", ","));
});
test("qualità triangolo: equilatero=1, degenere=0", () => {
  const eq = triQuality([0, 0], [1, 0], [0.5, Math.sqrt(3) / 2]);
  assert.ok(Math.abs(eq - 1) < 1e-9);
  assert.equal(triQuality([0, 0], [1, 0], [2, 0]), 0);
  assert.equal(triArea([0, 0], [4, 0], [0, 3]), 6);
});
test("punto in poligono", () => {
  const q = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.ok(pointInPolygon([2, 2], q));
  assert.ok(!pointInPolygon([5, 2], q));
});

function involucroConvesso(pts) {
  const p = pts.map((v, i) => [v[0], v[1], i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const low = [];
  for (const q of p) { while (low.length >= 2 && cross(low.at(-2), low.at(-1), q) <= 0) low.pop(); low.push(q); }
  const up = [];
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return low.length + up.length - 2;
}

test("Delaunay: n triangoli = 2n − 2 − h (punti casuali)", () => {
  for (const seme of [1, 2, 3, 4, 5]) {
    const r = rng(seme);
    const pts = Array.from({ length: 60 }, () => [r() * 10000, r() * 10000]);
    const tri = delaunay(pts);
    const h = involucroConvesso(pts);
    assert.equal(tri.length, 2 * pts.length - 2 - h, `seme ${seme}`);
  }
});
test("Delaunay: proprietà del cerchio vuoto", () => {
  const r = rng(42);
  const pts = Array.from({ length: 40 }, () => [r() * 5000, r() * 5000]);
  for (const [a, b, c] of delaunay(pts)) {
    const A = pts[a], B = pts[b], C = pts[c];
    const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
    const ux = ((A[0] ** 2 + A[1] ** 2) * (B[1] - C[1]) + (B[0] ** 2 + B[1] ** 2) * (C[1] - A[1]) + (C[0] ** 2 + C[1] ** 2) * (A[1] - B[1])) / d;
    const uy = ((A[0] ** 2 + A[1] ** 2) * (C[0] - B[0]) + (B[0] ** 2 + B[1] ** 2) * (A[0] - C[0]) + (C[0] ** 2 + C[1] ** 2) * (B[0] - A[0])) / d;
    const raggio = Math.hypot(A[0] - ux, A[1] - uy);
    pts.forEach((p, i) => {
      if (i === a || i === b || i === c) return;
      assert.ok(Math.hypot(p[0] - ux, p[1] - uy) >= raggio - 1e-6, "punto dentro il cerchio circoscritto");
    });
  }
});
test("Delaunay: meno di 3 punti → nessun triangolo", () => {
  assert.deepEqual(delaunay([]), []);
  assert.deepEqual(delaunay([[0, 0], [1, 1]]), []);
});

console.log("zone di potenziale");
const centro = { lat: 42.5, lon: 12.5 };
function sitiSintetici(seme, n, raggioKm) {
  const r = rng(seme);
  const p = projector(centro.lat, centro.lon);
  return Array.from({ length: n }, () => {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * raggioKm * 1000;
    const [lat, lon] = p.toLatLon(Math.cos(a) * d, Math.sin(a) * d);
    return { lat, lon };
  });
}
test("meno di 3 siti → nessuna zona e avviso (fail closed)", () => {
  const r = calcolaZone([{ lat: 42.5, lon: 12.5 }, { lat: 42.51, lon: 12.51 }], centro, 5000);
  assert.equal(r.zone.length, 0);
  assert.match(r.avviso, /almeno 3 siti/);
});
test("zone: punteggi in [0,1], ordinate, soglie e buffer rispettati", () => {
  const siti = sitiSintetici(7, 45, 6);
  const r = calcolaZone(siti, centro, 6000);
  assert.ok(r.nTriangoli > 0);
  assert.ok(r.zone.length > 0, "attese zone");
  const p = projector(centro.lat, centro.lon);
  const xy = siti.map((s) => p.toXY(s.lat, s.lon));
  let prec = Infinity;
  for (const z of r.zone) {
    assert.ok(z.punteggio >= PARAMETRI_BASE.sogliaMinima && z.punteggio <= 1);
    assert.ok(z.punteggio <= prec);
    prec = z.punteggio;
    assert.equal(z.classe, z.punteggio >= PARAMETRI_BASE.sogliaAlta ? "alta" : "media");
    const [x, y] = p.toXY(z.lat, z.lon);
    const minD = Math.min(...xy.map(([sx, sy]) => Math.hypot(sx - x, sy - y)));
    assert.ok(minD >= PARAMETRI_BASE.bufferSitoM - 1, `zona a ${minD} m da un sito`);
    assert.ok(Math.hypot(x, y) <= 6000 + 1);
    assert.equal(z.vertici.length, 3);
  }
});
test("zone: separazione minima tra zone", () => {
  const r = calcolaZone(sitiSintetici(11, 60, 6), centro, 6000);
  const p = projector(centro.lat, centro.lon);
  for (let i = 0; i < r.zone.length; i++)
    for (let j = i + 1; j < r.zone.length; j++) {
      const a = p.toXY(r.zone[i].lat, r.zone[i].lon), b = p.toXY(r.zone[j].lat, r.zone[j].lon);
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) >= PARAMETRI_BASE.separazioneMinimaM - 1);
    }
});
test("zone: ring di siti attorno a un vuoto → zona proposta nel vuoto", () => {
  const p = projector(centro.lat, centro.lon);
  const anello = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * 2 * Math.PI;
    const [lat, lon] = p.toLatLon(Math.cos(a) * 1300, Math.sin(a) * 1300);
    return { lat, lon };
  });
  const r = calcolaZone(anello, centro, 3000);
  assert.ok(r.zone.length > 0, "attesa almeno una zona");
  assert.ok(r.zone.every((z) => z.vicinoM >= 700));
});
test("zone: sito isolato lontano non genera triangoli oltre il lato massimo", () => {
  const lontano = [{ lat: 42.5, lon: 12.5 }, { lat: 42.6, lon: 12.5 }, { lat: 42.5, lon: 12.62 }];
  const r = calcolaZone(lontano, centro, 20000);
  assert.equal(r.zone.length, 0);
  assert.ok(r.scarti.lato >= 1);
});
test("zone: pesi normalizzati (somma ≠ 1 funziona) e somma 0 rifiutata", () => {
  const siti = sitiSintetici(3, 40, 5);
  const a = calcolaZone(siti, centro, 5000, { pesoVicini: 3, pesoMedia: 2.5, pesoQualita: 2.5, pesoDensita: 2 });
  const b = calcolaZone(siti, centro, 5000);
  assert.equal(a.zone.length, b.zone.length);
  assert.throws(() => calcolaZone(siti, centro, 5000, { pesoVicini: 0, pesoMedia: 0, pesoQualita: 0, pesoDensita: 0 }));
});
test("zone: soglia più alta → meno o uguali zone", () => {
  const siti = sitiSintetici(5, 50, 6);
  const bassa = calcolaZone(siti, centro, 6000, { sogliaMinima: 0.2 });
  const alta = calcolaZone(siti, centro, 6000, { sogliaMinima: 0.5 });
  assert.ok(alta.zone.length <= bassa.zone.length);
});
test("zone: GeoJSON valido (poligoni chiusi, [lon,lat])", () => {
  const r = calcolaZone(sitiSintetici(7, 45, 6), centro, 6000);
  const g = zoneInGeoJSON(r.zone, { generato: "test" });
  assert.equal(g.type, "FeatureCollection");
  for (const f of g.features) {
    const anello = f.geometry.coordinates[0];
    assert.equal(anello.length, 4);
    assert.deepEqual(anello[0], anello[3]);
    assert.ok(anello[0][0] > 11 && anello[0][0] < 14, "lon prima di lat");
    assert.ok(anello[0][1] > 41 && anello[0][1] < 44);
  }
});
test("zone: duplicati e coordinate non valide ignorati", () => {
  const s = [{ lat: 42.5, lon: 12.5 }, { lat: 42.5, lon: 12.5 }, { lat: NaN, lon: 1 }, { lat: 42.52, lon: 12.5 }];
  const r = calcolaZone(s, centro, 3000);
  assert.equal(r.nSiti, 2);
});

console.log("epoche");
test("parole chiave principali", () => {
  assert.equal(dominante(classifica("Villa romana con mosaici")), "romano");
  assert.equal(dominante(classifica("Necropoli etrusca di Tarquinia")), "etrusco");
  assert.equal(dominante(classifica("Castello medievale")), "medioevo");
  assert.equal(dominante(classifica("Insediamento neolitico")), "preistoria");
  assert.equal(dominante(classifica("Nuraghe Santu Antine")), "protostoria");
  assert.equal(dominante(classifica("Tempio greco di Paestum, Magna Grecia")), "greco");
  assert.equal(dominante(classifica("Tomba longobarda")), "altomedioevo");
  assert.equal(dominante(classifica("Chiesa romanica")), "medioevo");
  assert.equal(dominante(classifica("Catacombe paleocristiane")), "tardoantico");
});
test("accenti e maiuscole non contano", () => {
  assert.equal(dominante(classifica("ETÀ DEL BRONZO")), "protostoria");
});
test("'Linea Gotica' è Novecento, non gotico medievale", () => {
  assert.equal(dominante(classifica("Bunker della Linea Gotica")), "contemporaneo");
});
test("'romanico' non è 'romano'", () => {
  const p = classifica("Pieve romanica");
  assert.ok(!p.romano);
});
test("testo senza indizi → nessuna epoca", () => {
  assert.equal(dominante(classifica("Podere Il Sasso")), null);
  assert.equal(dominante(classifica("")), null);
});
test("epoca da anno: casi ambigui restano null", () => {
  assert.equal(epocaDaAnno(-3000), "preistoria");
  assert.equal(epocaDaAnno(-1000), "protostoria");
  assert.equal(epocaDaAnno(0), null);
  assert.equal(epocaDaAnno(1250), "medioevo");
  assert.equal(epocaDaAnno(1800), "moderno");
  assert.equal(epocaDaAnno(1943), "contemporaneo");
  assert.equal(epocaDaAnno(NaN), null);
});
test("profilo percentuale", () => {
  const p = profilo(["romano", "romano", "medioevo", null]);
  assert.equal(p.totale, 4);
  assert.equal(p.classificati, 3);
  assert.equal(p.nonClassificati, 1);
  assert.ok(Math.abs(p.percentuali.romano - 66.666) < 0.01);
  const somma = Object.values(p.percentuali).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(somma - 100) < 1e-9);
});

console.log("fonti");
test("query Overpass: filtri, raggio e limite", () => {
  const q = costruisciQueryOverpass({ lat: 42.98, lon: 25.2694, raggioM: 5000, categorie: ["fort"], limite: 200 });
  assert.match(q, /^\[out:json\]\[timeout:60\];\(/);
  assert.match(q, /around:5000,42\.980000,25\.269400/);
  assert.match(q, /castle\|fort/);
  assert.match(q, /out tags center 200;$/);
  assert.ok(!q.includes("archaeological_site"));
  assert.throws(() => costruisciQueryOverpass({ lat: 1, lon: 1, raggioM: 1, categorie: [] }));
});
test("lettura risposta Overpass", () => {
  const siti = leggiOverpass({
    elements: [
      { type: "node", id: 1, lat: 42.1, lon: 12.1, tags: { historic: "castle", name: "Rocca Malatestiana" } },
      { type: "way", id: 2, center: { lat: 42.2, lon: 12.2 }, tags: { historic: "archaeological_site", "historic:civilization": "ancient_roman", name: "Villa" } },
      { type: "way", id: 3, center: { lat: 42.3, lon: 12.3 }, tags: { historic: "ruins", start_date: "1250" } },
      { type: "node", id: 1, lat: 42.1, lon: 12.1, tags: { historic: "castle" } }, // duplicato
      { type: "relation", id: 4, tags: { historic: "fort" } }, // senza coordinate
      { type: "node", id: 5, lat: 42.4, lon: 12.4, tags: { historic: "monastery" } },
    ],
  });
  assert.equal(siti.length, 4);
  assert.equal(siti[0].cat, "fort");
  assert.equal(siti[0].epoca, "medioevo");
  assert.equal(siti[1].cat, "arch");
  assert.equal(siti[1].epoca, "romano");
  assert.equal(siti[2].epoca, "medioevo"); // da start_date
  assert.equal(siti[3].cat, "relig");
  assert.equal(siti[3].nome, "");
  assert.equal(siti[0].url, "https://www.openstreetmap.org/node/1");
});
test("lettura risposta vuota o malformata non lancia", () => {
  assert.deepEqual(leggiOverpass({}), []);
  assert.deepEqual(leggiOverpass(null), []);
});
test("query e lettura di edifici e strade attuali", () => {
  const q = costruisciQueryEdificiStrade({ lat: 42.98, lon: 12.2, raggioM: 1500.4, limite: 100 });
  assert.match(q, /way\["building"\]\(around:1500,42\.980000,12\.200000\)/);
  assert.match(q, /highway"~"\^\(motorway\|/);
  assert.ok(!q.includes("track") && !q.includes("path"), "sentieri e carrarecce non vanno esclusi");
  assert.match(q, /out geom 100;$/);
  const r = leggiEdificiStrade({
    elements: [
      { type: "way", id: 1, tags: { building: "yes" }, geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }, { lat: 1, lon: 1 }] },
      { type: "way", id: 2, tags: { highway: "residential" }, geometry: [{ lat: 1, lon: 1 }, { lat: 1.5, lon: 1.5 }] },
      { type: "way", id: 3, tags: { building: "yes" }, geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }] }, // troppo corto per un poligono
      { type: "way", id: 4, tags: { highway: "primary" } }, // senza geometria
      { type: "node", id: 5, lat: 1, lon: 1, tags: { building: "yes" } },
      { type: "way", id: 6, tags: { highway: "service" }, geometry: [{ lat: 1, lon: 1 }, { lat: NaN, lon: 1 }, { lat: 3, lon: 3 }] },
    ],
  });
  assert.equal(r.edifici.length, 1);
  assert.equal(r.strade.length, 2);
  assert.deepEqual(r.strade[1], [[1, 1], [3, 3]]);
  assert.deepEqual(leggiEdificiStrade(null), { edifici: [], strade: [] });
});

const CAP = `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Service><Name>WMS</Name><Title>Servizio &amp; prova</Title></Service>
  <Capability>
    <Request><GetMap><Format>image/png</Format><Format>image/jpeg</Format></GetMap></Request>
    <Layer>
      <Title>Radice senza nome</Title>
      <Layer queryable="1"><Name>CP.CadastralParcel</Name><Title>Particelle</Title>
        <Style><Name>default</Name><Title>stile</Title></Style></Layer>
      <Layer><Name>CP.CadastralZoning</Name><Title><![CDATA[Zone & fogli]]></Title></Layer>
      <Layer/>
    </Layer>
  </Capability>
</WMS_Capabilities>`;
test("GetCapabilities: titolo, formati, livelli (ignora gli stili)", () => {
  const c = leggiCapabilities(CAP);
  assert.equal(c.titolo, "Servizio & prova");
  assert.deepEqual(c.formati, ["image/png", "image/jpeg"]);
  assert.deepEqual(c.livelli, [
    { name: "CP.CadastralParcel", title: "Particelle" },
    { name: "CP.CadastralZoning", title: "Zone & fogli" },
  ]);
});
test("GetCapabilities con prefissi di namespace", () => {
  const c = leggiCapabilities(`<wms:WMS_Capabilities><wms:Capability><wms:Layer><wms:Name>a</wms:Name><wms:Title>A</wms:Title></wms:Layer></wms:Capability></wms:WMS_Capabilities>`);
  assert.deepEqual(c.livelli, [{ name: "a", title: "A" }]);
});
test("URL GetCapabilities mantiene ?map= e non duplica i parametri", () => {
  const u = new URL(urlCapabilities("https://x.it/ogc?map=/ms/a.map"));
  assert.equal(u.searchParams.get("map"), "/ms/a.map");
  assert.equal(u.searchParams.get("REQUEST"), "GetCapabilities");
  const v = urlCapabilities("https://x.it/ows?service=WMS&request=GetCapabilities");
  assert.equal((v.match(/request=/gi) || []).length, 1);
});
test("URL GetMap di prova", () => {
  const u = new URL(urlProva("https://x.it/ogc?map=/a.map", "L1"));
  assert.equal(u.searchParams.get("REQUEST"), "GetMap");
  assert.equal(u.searchParams.get("LAYERS"), "L1");
  assert.equal(u.searchParams.get("CRS"), "EPSG:3857");
  assert.equal(u.searchParams.get("map"), "/a.map");
  const [x0, y0, x1, y1] = u.searchParams.get("BBOX").split(",").map(Number);
  assert.ok(x1 > x0 && y1 > y0 && x0 > 1.3e6 && x0 < 1.4e6);
  assert.equal(new URL(urlProva("https://x.it/w", "L", "1.1.1")).searchParams.get("SRS"), "EPSG:3857");
});

test("ricerca luogo: coordinate scritte a mano (senza rete)", async () => {
  const r = await cercaLuogo("42,98 25,2694");
  assert.equal(r.length, 1);
  assert.equal(r[0].lat, 42.98);
  assert.equal(r[0].lon, 25.2694);
  const s = await cercaLuogo("42.98, 25.2694");
  assert.equal(s[0].lon, 25.2694);
});

console.log("utilità");
test("urlSicuro accetta solo http(s)", () => {
  assert.ok(urlSicuro("https://it.wikipedia.org/wiki/Roma"));
  assert.equal(urlSicuro("javascript:alert(1)"), null);
  assert.equal(urlSicuro("data:text/html,<script>"), null);
  assert.equal(urlSicuro("non è un url"), null);
  assert.equal(urlSicuro(null), null);
});
test("CSV: separatore, virgolette, BOM e protezione formule", () => {
  const csv = inCsv(
    [{ a: 'x;y', b: '=SOMMA(A1)' }, { a: 'ciao "mondo"', b: "ok" }],
    [{ titolo: "A", valore: (r) => r.a }, { titolo: "B", valore: (r) => r.b }],
  );
  assert.ok(csv.startsWith("﻿A;B\r\n"));
  assert.ok(csv.includes('"x;y";\'=SOMMA(A1)'));
  assert.ok(csv.includes('"ciao ""mondo"""'));
});
test("soloTesto e tronca", () => {
  assert.equal(soloTesto('<span class="searchmatch">Villa</span> &amp; foro&quot;'), 'Villa & foro"');
  assert.equal(tronca("abcdefgh", 5), "abcd…");
  assert.equal(tronca("abc", 5), "abc");
});

await Promise.all(pendenti);
console.log(process.exitCode ? "\nTEST FALLITI" : `\nTutti i test superati (${ok}).`);
