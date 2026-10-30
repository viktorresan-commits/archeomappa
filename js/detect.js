// Rilevatore di anomalie nel rilievo (DTM/LiDAR): trova rilievi e depressioni artificiali per forma.
// Tutte le regole sono qui e si leggono: nulla è nascosto in un modello opaco. Restituisce ipotesi
// da verificare con fonti, ortofoto e sopralluoghi autorizzati, non scoperte.
//
// Passi: (1) rilievo locale (LRM) = quota meno quota "di fondo"; (2) soglia sul contrasto (m);
// (3) chiusura morfologica per ricucire rampa e fossato; (4) componenti connesse;
// (5) misura della forma (area, allungamento, vuoti interni, rettangolarità, circolarità);
// (6) tre tipi: recinto, struttura circolare, tracciato lineare, ciascuno con un punteggio 0–1;
// (7) esclusioni: siti già noti, edifici e strade attuali.

import { riempiVuoti, lrm, statisticheRobuste } from "./visual.js";

export function impostazioniPredefinite(cella) {
  const fine = cella <= 3;
  return {
    profilo: fine ? "dettaglio" : "grossolano",
    contrastoM: null, // null = automatico (kSigma volte la variabilità robusta del rilievo locale)
    kSigma: fine ? 2.5 : 2.0,
    scalaFondoM: fine ? 50 : 100,
    chiusuraM: fine ? 4 : 20,
    recinti: true, circolari: true, lineari: true,
    recintoMinM: fine ? 40 : 100, recintoMaxM: fine ? 400 : 800,
    circMinM: fine ? 8 : 30, circMaxM: fine ? 80 : 200,
    lineareMinM: fine ? 60 : 200, lineareMaxM: fine ? 1000 : 800, lineareLarghMaxM: fine ? 25 : 50,
    confidenzaMin: 0.5,
    distSitiM: 500,
    escludiEdifici: true, buffEdificiM: fine ? 15 : 40,
    escludiStrade: true, buffStradeM: fine ? 12 : 40,
    maxRisultati: 300,
  };
}

/** Elenco leggibile delle regole applicate, da mostrare e da salvare con i risultati. */
export function descriviRegole(imp, cella, soglia) {
  const m = (v) => `${Math.round(v)} m`;
  const r = [
    `Rilievo locale: quota meno quota di fondo su scala ${m(imp.scalaFondoM)}.`,
    `Contrasto minimo: ${soglia != null ? soglia.toFixed(2).replace(".", ",") + " m" : "automatico"}${imp.contrastoM == null ? ` (${String(imp.kSigma).replace(".", ",")} volte la variabilità del rilievo)` : " (impostato a mano)"}.`,
    `Ricucitura di frammenti vicini: ${m(imp.chiusuraM)}.`,
    `Confidenza minima: ${Math.round(imp.confidenzaMin * 100)}%.`,
  ];
  if (imp.recinti) r.push(`Recinti: contorno chiuso con spazio interno, lato equivalente da ${m(imp.recintoMinM)} a ${m(imp.recintoMaxM)}.`);
  if (imp.circolari) r.push(`Strutture circolari: diametro da ${m(imp.circMinM)} a ${m(imp.circMaxM)}, forma poco allungata e tondeggiante.`);
  if (imp.lineari) r.push(`Tracciati lineari: lunghezza da ${m(imp.lineareMinM)} a ${m(imp.lineareMaxM)}, larghezza fino a ${m(imp.lineareLarghMaxM)}, molto allungati (le valli naturali più lunghe vengono ignorate).`);
  r.push(imp.distSitiM > 0 ? `Scartate le anomalie entro ${m(imp.distSitiM)} da un sito già noto.` : "Anomalie vicine a siti noti non scartate.");
  if (imp.escludiEdifici) r.push(`Scartate le anomalie sopra edifici attuali (margine ${m(imp.buffEdificiM)}).`);
  if (imp.escludiStrade) r.push(`Scartate le anomalie lungo strade attuali (margine ${m(imp.buffStradeM)}).`);
  r.push(`Pixel del rilievo: ${String(cella).replace(".", ",")} m.`);
  return r;
}

// ------------------------------------------------------------ morfologia

function dilata(m, w, h, r) {
  if (r <= 0) return m;
  const tmp = new Uint8Array(m.length), out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (m[y * w + k]) { v = 1; break; }
      tmp[y * w + x] = v;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (tmp[k * w + x]) { v = 1; break; }
      out[y * w + x] = v;
    }
  }
  return out;
}
function erodi(m, w, h, r) {
  if (r <= 0) return m;
  const inv = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) inv[i] = m[i] ? 0 : 1;
  const d = dilata(inv, w, h, r);
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = d[i] ? 0 : 1;
  return out;
}

/** Distanza (in pixel) dal pixel acceso più vicino: trasformata a distanza 3-4. */
export function distanzaDa(maschera, w, h) {
  const INF = 1e9;
  const d = new Float32Array(maschera.length);
  for (let i = 0; i < d.length; i++) d[i] = maschera[i] ? 0 : INF;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = d[i] >= INF ? Infinity : d[i] / 3;
  return d;
}

/** Componenti connesse (8-connessione). Restituisce {etichette, n} con etichette 1..n (0 = sfondo). */
export function etichetta(maschera, w, h) {
  const lab = new Int32Array(maschera.length);
  const parent = [0];
  const trova = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const unisci = (a, b) => { a = trova(a); b = trova(b); if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; } };
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!maschera[i]) continue;
      const vicini = [];
      if (x > 0 && lab[i - 1]) vicini.push(lab[i - 1]);
      if (y > 0) {
        if (lab[i - w]) vicini.push(lab[i - w]);
        if (x > 0 && lab[i - w - 1]) vicini.push(lab[i - w - 1]);
        if (x < w - 1 && lab[i - w + 1]) vicini.push(lab[i - w + 1]);
      }
      if (!vicini.length) { n++; parent.push(n); lab[i] = n; }
      else {
        let m = vicini[0];
        for (const v of vicini) if (v < m) m = v;
        lab[i] = m;
        for (const v of vicini) unisci(m, v);
      }
    }
  }
  const mappa = new Int32Array(n + 1);
  let k = 0;
  for (let i = 1; i <= n; i++) if (trova(i) === i) mappa[i] = ++k;
  for (let i = 1; i <= n; i++) mappa[i] = mappa[trova(i)];
  for (let i = 0; i < lab.length; i++) if (lab[i]) lab[i] = mappa[lab[i]];
  return { etichette: lab, n: k };
}

// ------------------------------------------------------------ geometria

function involucro(punti) {
  const p = punti.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const basso = [];
  for (const q of p) { while (basso.length >= 2 && cross(basso[basso.length - 2], basso[basso.length - 1], q) <= 0) basso.pop(); basso.push(q); }
  const alto = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (alto.length >= 2 && cross(alto[alto.length - 2], alto[alto.length - 1], q) <= 0) alto.pop(); alto.push(q); }
  alto.pop(); basso.pop();
  return basso.concat(alto);
}
const areaPoligono = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
const perimetro = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += Math.hypot(a[0] - b[0], a[1] - b[1]); } return s; };

function rettangoloMinimo(hull) {
  let best = { area: Infinity, a: 0, b: 0 };
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len === 0) continue;
    const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const s of hull) {
      const du = (s[0] - p[0]) * ux + (s[1] - p[1]) * uy, dv = -(s[0] - p[0]) * uy + (s[1] - p[1]) * ux;
      if (du < u0) u0 = du; if (du > u1) u1 = du; if (dv < v0) v0 = dv; if (dv > v1) v1 = dv;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) best = { area, a: Math.max(u1 - u0, v1 - v0), b: Math.min(u1 - u0, v1 - v0) };
  }
  return best;
}

/** Misura la forma di un insieme di pixel (indici in griglia w×h). Le lunghezze escono in pixel. */
export function misuraForma(pix, w, lrmV) {
  const n = pix.length;
  let sx = 0, sy = 0, minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity, pos = 0, somAbs = 0, somma = 0;
  for (const i of pix) {
    const y = (i / w) | 0, x = i - y * w;
    sx += x; sy += y;
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
    const v = lrmV[i];
    if (v > 0) pos++;
    somAbs += Math.abs(v); somma += v;
  }
  const cx = sx / n, cy = sy / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const i of pix) { const y = (i / w) | 0, x = i - y * w; sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
  sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(ang), uy = Math.sin(ang);

  // maschera locale con bordo di 1 pixel per il riempimento dei vuoti
  const bw = maxx - minx + 3, bh = maxy - miny + 3;
  const loc = new Uint8Array(bw * bh);
  for (const i of pix) { const y = (i / w) | 0, x = i - y * w; loc[(y - miny + 1) * bw + (x - minx + 1)] = 1; }
  const fuori = new Uint8Array(bw * bh);
  const pila = [0];
  fuori[0] = 1;
  while (pila.length) {
    const q = pila.pop();
    const qy = (q / bw) | 0, qx = q - qy * bw;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = qx + dx, ny = qy + dy;
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      const j = ny * bw + nx;
      if (loc[j] || fuori[j]) continue;
      fuori[j] = 1; pila.push(j);
    }
  }
  let vuoti = 0;
  for (let j = 0; j < loc.length; j++) if (!loc[j] && !fuori[j]) vuoti++;
  const piena = n + vuoti;

  // contorno: pixel con un vicino a 4 fuori dall'insieme → spigoli dei pixel per l'involucro
  const pt = [];
  for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
    if (!loc[y * bw + x]) continue;
    if (loc[y * bw + x - 1] && loc[y * bw + x + 1] && loc[(y - 1) * bw + x] && loc[(y + 1) * bw + x]) continue;
    pt.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]);
  }
  const hull = involucro(pt);
  const aHull = Math.max(1, areaPoligono(hull));
  const pHull = perimetro(hull);
  const rett = rettangoloMinimo(hull);

  // scostamento quadratico medio dall'asse maggiore (per i tracciati lineari)
  let rms = 0;
  for (const i of pix) { const y = (i / w) | 0, x = i - y * w; const d = -(x - cx) * uy + (y - cy) * ux; rms += d * d; }
  rms = Math.sqrt(rms / n);

  return {
    area: n, piena, vuotiFrazione: vuoti / piena, centro: [cx, cy], bbox: [minx, miny, maxx, maxy],
    allungamento: Math.sqrt(l1 / l2), lunghezza: rett.a, larghezza: rett.b, aHull, pHull,
    solidita: Math.min(1, piena / aHull), rettangolarita: Math.min(1, piena / Math.max(1, rett.area)),
    circolarita: Math.min(1, (4 * Math.PI * aHull) / (pHull * pHull)),
    positivi: pos / n, contrasto: somAbs / n, mediaLrm: somma / n, rms, asse: [ux, uy], hull,
  };
}

// ------------------------------------------------------------- punteggio

const lim = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
/** Fra 0 e 1: 1 al centro dell'intervallo [min,max] in scala logaritmica, 0.5 ai bordi. */
const adeguatezza = (v, min, max) => lim(1 - 0.5 * (Math.abs(Math.log(v / Math.sqrt(min * max))) / (Math.log(max / min) / 2)), 0, 1);

/**
 * Valuta una regione in metri. `m` ha: area, piena, vuotiFrazione, allungamento, lunghezza, larghezza,
 * solidita, rettangolarita, circolarita, positivi, contrasto, rms (tutte in unità fisiche: m e m²).
 * Restituisce {tipo, codice, punteggio, polarita} oppure null.
 */
export function valuta(m, imp, soglia) {
  const candidati = [];
  const polar = m.positivi >= 0.7 ? "positiva" : m.positivi <= 0.3 ? "negativa" : "mista";
  const contrasto = lim((m.contrasto / soglia - 1) / 2);

  if (imp.recinti) {
    const lato = Math.sqrt(m.piena);
    if (lato >= imp.recintoMinM && lato <= imp.recintoMaxM && m.vuotiFrazione >= 0.2 && m.allungamento <= 3.5) {
      const anello = lim((m.vuotiFrazione - 0.2) / 0.5);
      const regolare = lim((Math.max(m.rettangolarita, m.solidita) - 0.5) / 0.4);
      const punteggio = 0.45 * anello + 0.25 * regolare + 0.2 * contrasto + 0.1 * adeguatezza(lato, imp.recintoMinM, imp.recintoMaxM);
      candidati.push({ tipo: "Recinto", codice: "recinto", punteggio });
    }
  }
  if (imp.circolari) {
    const d = Math.sqrt((4 * m.piena) / Math.PI);
    if (d >= imp.circMinM && d <= imp.circMaxM && m.allungamento <= 1.7 && m.circolarita >= 0.75 && m.solidita >= 0.7) {
      const nome = polar === "positiva" ? "Tumulo o rilievo circolare" : polar === "negativa" ? "Depressione circolare" : "Struttura circolare con fossato";
      const punteggio = 0.4 * lim((m.circolarita - 0.7) / 0.28) + 0.25 * lim(1.7 - m.allungamento) + 0.2 * contrasto + 0.15 * adeguatezza(d, imp.circMinM, imp.circMaxM);
      candidati.push({ tipo: nome, codice: "circolare", punteggio });
    }
  }
  if (imp.lineari) {
    if (m.lunghezza >= imp.lineareMinM && m.lunghezza <= imp.lineareMaxM && m.larghezza <= imp.lineareLarghMaxM && m.allungamento >= 4 && m.vuotiFrazione < 0.2) {
      const nome = polar === "positiva" ? "Aggere o terrapieno lineare" : polar === "negativa" ? "Fossato o strada incassata" : "Tracciato lineare";
      const dritto = lim(1 - m.rms / (0.15 * m.lunghezza));
      const punteggio = 0.35 * lim((m.allungamento - 3) / 7) + 0.25 * lim(m.lunghezza / (3 * imp.lineareMinM)) + 0.25 * contrasto + 0.15 * dritto;
      candidati.push({ tipo: nome, codice: "lineare", punteggio });
    }
  }
  if (!candidati.length) return null;
  // La confidenza cresce con il contrasto: una forma che supera la soglia di poco non può essere affidabile.
  for (const c of candidati) c.punteggio *= 0.7 + 0.3 * contrasto;
  candidati.sort((a, b) => b.punteggio - a.punteggio);
  return { ...candidati[0], polarita: polar };
}

// -------------------------------------------------------- vettori → maschere

function segna(maschera, w, h, pt) {
  const c = Math.round(pt[0]), r = Math.round(pt[1]);
  if (c >= 0 && r >= 0 && c < w && r < h) maschera[r * w + c] = 1;
}
function rasterizzaLinea(maschera, w, h, linea) {
  for (let i = 0; i + 1 < linea.length; i++) {
    const [x0, y0] = linea[i], [x1, y1] = linea[i + 1];
    const passi = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= passi; s++) segna(maschera, w, h, [x0 + ((x1 - x0) * s) / passi, y0 + ((y1 - y0) * s) / passi]);
  }
}
function rasterizzaPoligono(maschera, w, h, poly) {
  let miny = Infinity, maxy = -Infinity;
  for (const p of poly) { if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }
  for (let r = Math.max(0, Math.floor(miny)); r <= Math.min(h - 1, Math.ceil(maxy)); r++) {
    const y = r + 0.5, xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let c = Math.max(0, Math.round(xs[k] - 0.5)); c <= Math.min(w - 1, Math.round(xs[k + 1] - 0.5)); c++) maschera[r * w + c] = 1;
  }
  rasterizzaLinea(maschera, w, h, poly.concat([poly[0]]));
}

/** Converte coordinate (lat, lon) in pixel della griglia. */
export function aPixel(griglia, lat, lon) {
  const [x, y] = griglia.proiezione.daLatLon(lat, lon);
  return [(x - griglia.origine.x) / griglia.cella, (griglia.origine.y - y) / griglia.cella];
}
export function daPixel(griglia, c, r) {
  return griglia.proiezione.aLatLon(griglia.origine.x + c * griglia.cella, griglia.origine.y - r * griglia.cella);
}

// ------------------------------------------------------------------ rilevatore

/**
 * @param {{dati:Float32Array,w:number,h:number,cella:number,origine:{x:number,y:number},proiezione:object}} g
 * @param {object} imp impostazioni (vedi impostazioniPredefinite)
 * @param {{siti?:Array<{lat:number,lon:number}>, edifici?:number[][][], strade?:number[][][]}} [esterni]
 *        edifici = poligoni [[lat,lon],...]; strade = polilinee [[lat,lon],...]
 */
export function rileva(g, imp, esterni = {}) {
  const { w, h, cella } = g;
  const out = { anomalie: [], scartate: { edificio: 0, strada: 0, sitoNoto: 0, confidenza: 0, forma: 0 }, soglia: 0, sigma: 0, regole: [], avvisi: [], nComponenti: 0 };
  const { pieno, valido, vuoto } = riempiVuoti(g.dati, w, h);
  if (vuoto) { out.avvisi.push("Il rilievo non contiene quote valide in quest'area."); return out; }

  const sigmaPx = Math.max(1.5, imp.scalaFondoM / cella);
  const L = lrm(pieno, w, h, sigmaPx);
  const st = statisticheRobuste(L, valido);
  out.sigma = st.sigma;
  const soglia = imp.contrastoM != null ? imp.contrastoM : Math.max(0.05, imp.kSigma * st.sigma);
  out.soglia = soglia;
  out.regole = descriviRegole(imp, cella, soglia);

  let mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = valido[i] && Math.abs(L[i]) > soglia ? 1 : 0;
  const rc = Math.round(imp.chiusuraM / cella / 2);
  if (rc > 0) mask = erodi(dilata(mask, w, h, rc), w, h, rc);
  for (let i = 0; i < mask.length; i++) if (!valido[i]) mask[i] = 0;

  const { etichette, n } = etichetta(mask, w, h);
  out.nComponenti = n;
  if (!n) return out;

  // prima passata: area e riquadro per scartare subito ciò che è fuori scala
  const area = new Int32Array(n + 1);
  for (let i = 0; i < etichette.length; i++) if (etichette[i]) area[etichette[i]]++;
  const a2 = cella * cella;
  const aMin = 6; // minimo assoluto: 6 pixel
  const aMaxM2 = Math.max(imp.recintoMaxM ** 2, imp.lineareMaxM * imp.lineareLarghMaxM);
  const buoni = new Map();
  for (let l = 1; l <= n; l++) if (area[l] >= aMin && area[l] * a2 <= aMaxM2 * 1.5) buoni.set(l, []);
  for (let i = 0; i < etichette.length; i++) { const l = etichette[i]; if (l && buoni.has(l)) buoni.get(l).push(i); }

  // maschere di esclusione
  let distEdifici = null, distStrade = null;
  if (imp.escludiEdifici && esterni.edifici?.length) {
    const m = new Uint8Array(w * h);
    for (const poly of esterni.edifici) rasterizzaPoligono(m, w, h, poly.map(([la, lo]) => aPixel(g, la, lo)));
    distEdifici = distanzaDa(m, w, h);
  }
  if (imp.escludiStrade && esterni.strade?.length) {
    const m = new Uint8Array(w * h);
    for (const l of esterni.strade) rasterizzaLinea(m, w, h, l.map(([la, lo]) => aPixel(g, la, lo)));
    distStrade = distanzaDa(m, w, h);
  }
  const sitiPx = (esterni.siti ?? []).map((s) => aPixel(g, s.lat, s.lon));

  const frazioneVicina = (pix, dist, buffM) => {
    if (!dist) return 0;
    const r = buffM / cella;
    let c = 0;
    for (const i of pix) if (dist[i] <= r) c++;
    return c / pix.length;
  };

  for (const [, pix] of buoni) {
    const f = misuraForma(pix, w, L);
    // conversione in metri
    const mm = {
      ...f, area: f.area * a2, piena: f.piena * a2, lunghezza: f.lunghezza * cella, larghezza: f.larghezza * cella, rms: f.rms * cella,
    };
    const v = valuta(mm, imp, soglia);
    if (!v) { out.scartate.forma++; continue; }
    const tocca = f.bbox[0] <= 1 || f.bbox[1] <= 1 || f.bbox[2] >= w - 2 || f.bbox[3] >= h - 2;
    const punteggio = v.punteggio * (tocca ? 0.75 : 1);
    if (punteggio < imp.confidenzaMin) { out.scartate.confidenza++; continue; }
    if (distEdifici && frazioneVicina(pix, distEdifici, imp.buffEdificiM) >= 0.35) { out.scartate.edificio++; continue; }
    if (distStrade && frazioneVicina(pix, distStrade, imp.buffStradeM) >= 0.5) { out.scartate.strada++; continue; }
    let sitoM = null;
    for (const [sc, sr] of sitiPx) {
      const d = Math.hypot(sc - f.centro[0], sr - f.centro[1]) * cella;
      if (sitoM == null || d < sitoM) sitoM = d;
    }
    if (imp.distSitiM > 0 && sitoM != null && sitoM < imp.distSitiM) { out.scartate.sitoNoto++; continue; }

    // geometria da mostrare
    let geom;
    if (v.codice === "lineare") {
      const [ux, uy] = f.asse;
      const bins = new Map();
      for (const i of pix) {
        const y = (i / w) | 0, x = i - y * w;
        const t = Math.round(((x - f.centro[0]) * ux + (y - f.centro[1]) * uy) / 3);
        const b = bins.get(t) ?? [0, 0, 0];
        b[0] += x + 0.5; b[1] += y + 0.5; b[2]++;
        bins.set(t, b);
      }
      const linea = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => daPixel(g, b[0] / b[2], b[1] / b[2]));
      geom = { tipo: "linea", coord: linea };
    } else {
      geom = { tipo: "poligono", coord: f.hull.map(([c, r]) => daPixel(g, c, r)) };
    }
    const [lat, lon] = daPixel(g, f.centro[0] + 0.5, f.centro[1] + 0.5);
    out.anomalie.push({
      tipo: v.tipo, codice: v.codice, punteggio, polarita: v.polarita, lat, lon,
      dimensioneM: v.codice === "lineare" ? mm.lunghezza : Math.sqrt(v.codice === "circolare" ? (4 * mm.piena) / Math.PI : mm.piena),
      areaM2: mm.piena, contrastoM: f.contrasto, allungamento: f.allungamento, vuotiFrazione: f.vuotiFrazione,
      circolarita: f.circolarita, sitoNotoM: sitoM, tagliata: tocca, geom,
    });
  }
  out.anomalie.sort((a, b) => b.punteggio - a.punteggio);
  out.anomalie = out.anomalie.slice(0, imp.maxRisultati).map((a, i) => ({ id: i + 1, ...a }));
  return out;
}

export function anomalieInGeoJSON(anomalie, meta = {}) {
  return {
    type: "FeatureCollection",
    properties: meta,
    features: anomalie.map((a) => ({
      type: "Feature",
      properties: {
        id: a.id, tipo: a.tipo, codice: a.codice, confidenza: Number(a.punteggio.toFixed(3)), polarita: a.polarita,
        dimensione_m: Math.round(a.dimensioneM), area_m2: Math.round(a.areaM2), contrasto_m: Number(a.contrastoM.toFixed(2)),
        sito_noto_piu_vicino_m: a.sitoNotoM == null ? null : Math.round(a.sitoNotoM), tagliata_dal_bordo: a.tagliata,
        centro_lat: Number(a.lat.toFixed(6)), centro_lon: Number(a.lon.toFixed(6)),
      },
      geometry: a.geom.tipo === "linea"
        ? { type: "LineString", coordinates: a.geom.coord.map(([la, lo]) => [lo, la]) }
        : { type: "Polygon", coordinates: [[...a.geom.coord, a.geom.coord[0]].map(([la, lo]) => [lo, la])] },
    })),
  };
}
