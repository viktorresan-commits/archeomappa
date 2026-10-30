// Confronto fra le anomalie trovate nel LiDAR e una fotografia della stessa zona (satellite, ortofoto).
//
// Domanda a cui risponde, per ogni anomalia: «nella foto si vede qualcosa che le corrisponde?»
//
// Come: si porta la foto (Web Mercator) sulla stessa griglia del rilievo (UTM), poi si misurano due cose
// sul punto dell'anomalia: quanto cambia la luminosità fra l'interno della forma e un anello attorno,
// e quanto sono marcati i contorni lungo il bordo. Un numero da solo non dice nulla (ogni foto ha la sua
// trama: campi arati, bosco, ombre), quindi lo si confronta con quello che si otterrebbe mettendo la
// STESSA forma in altri punti della STESSA foto (test di permutazione). Se il punto vero si distingue
// dalla massa degli altri, la foto mostra qualcosa; se è uno dei tanti, no.
//
// Limiti dichiarati, non nascosti:
//  - «non si distingue nulla» non vuol dire «non c'è»: sotto un bosco o con una foto sfocata un segno può esistere
//    e non vedersi. Per questo l'esito ha quattro valori e la vegetazione viene segnalata.
//  - La foto può essere spostata di qualche metro rispetto al LiDAR: si prova qualche piccolo spostamento,
//    sia per il punto vero sia per gli altri (così il confronto resta equo).
//  - Le soglie non sono calibrate su siti reali: sono segnali da verificare, non prove.

import { distanzaDa, rasterizzaLinea, aPixel } from "./detect.js";
import { mercatoreDiretta } from "./proj.js";

export const ETICHETTE_ESITO = {
  "solo-lidar": "Solo nel LiDAR",
  "anche-foto": "Visibile anche nella foto",
  incerto: "Incerto",
  "non-valutabile": "Non valutabile",
};

const SOGLIA_VISIBILE = 0.05;
const SOGLIA_ASSENTE = 0.25;
const SOGLIA_VERDE = 0.08;
const DEV_MIN_FOTO = 1.5; // sotto questa deviazione (livelli 0–255) la foto è considerata uniforme
const PIXEL_MIN_SEGNO = 2.5; // il segno deve essere largo almeno così tanti pixel della foto
const MAX_CAMPIONE = 250;
/** Pixel di foto tenuti attorno alla griglia del rilievo: servono agli anelli delle anomalie vicine al bordo. */
export const MARGINE_PX = 30;

/** Margine, in metri a terra, con cui conviene scaricare la foto attorno al rilievo. */
export const margineFotoM = (g) => MARGINE_PX * g.cella + 10;

// ------------------------------------------------------------------ geometria della foto

const R_TERRA_EQ = 156543.03392; // m per pixel a zoom 0 all'equatore (tessere da 256 px)

/** Zoom delle tessere con cui il pixel della foto non è più grande del pixel del rilievo (10–19). */
export function zoomPerCella(cella, latDeg) {
  const z = Math.ceil(Math.log2((R_TERRA_EQ * Math.cos((latDeg * Math.PI) / 180)) / cella));
  return Math.min(19, Math.max(10, z));
}

/** Riquadro in metri Web Mercator [minX, minY, maxX, maxY] che copre tutta la griglia, con un margine in metri a terra. */
export function riquadroMosaico(g, margineM = 40) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, lat0 = 0;
  const n = 8;
  for (let k = 0; k <= n; k++) {
    for (const [c, r] of [[(k / n) * g.w, 0], [(k / n) * g.w, g.h], [0, (k / n) * g.h], [g.w, (k / n) * g.h]]) {
      const [lat, lon] = g.proiezione.aLatLon(g.origine.x + c * g.cella, g.origine.y - r * g.cella);
      const [X, Y] = mercatoreDiretta(lat, lon);
      if (X < minX) minX = X; if (X > maxX) maxX = X; if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
      lat0 = lat;
    }
  }
  const m = margineM / Math.cos((lat0 * Math.PI) / 180);
  return [minX - m, minY - m, maxX + m, maxY + m];
}

/**
 * Porta il mosaico (Web Mercator, {rgba, w, h, merc:[minX,minY,maxX,maxY]}) sulla griglia del rilievo.
 * Restituisce {rgba, w, h} con alfa 0 dove il mosaico non arriva. La corrispondenza fra i due sistemi
 * si calcola su un reticolo rado (ogni 16 pixel) e si interpola: fra un nodo e l'altro è liscia.
 */
export function campionaMosaico(m, g) {
  const { w, h } = g;
  const PASSO = 16;
  const xs = [], ys = [];
  for (let c = 0; c < w; c += PASSO) xs.push(c);
  xs.push(w);
  for (let r = 0; r < h; r += PASSO) ys.push(r);
  ys.push(h);
  const nx = xs.length, ny = ys.length;
  const U = new Float64Array(nx * ny), V = new Float64Array(nx * ny);
  const sx = m.w / (m.merc[2] - m.merc[0]), sy = m.h / (m.merc[3] - m.merc[1]);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const [lat, lon] = g.proiezione.aLatLon(g.origine.x + xs[i] * g.cella, g.origine.y - ys[j] * g.cella);
      const [X, Y] = mercatoreDiretta(lat, lon);
      U[j * nx + i] = (X - m.merc[0]) * sx;
      V[j * nx + i] = (m.merc[3] - Y) * sy;
    }
  }
  // quanti pixel del mosaico stanno in un pixel del rilievo (al centro)
  const ic = nx >> 1, jc = ny >> 1;
  const i2 = Math.min(nx - 1, ic + 1), j2 = Math.min(ny - 1, jc);
  const scala = Math.hypot(U[jc * nx + i2] - U[jc * nx + ic], V[jc * nx + i2] - V[jc * nx + ic]) / Math.max(1, xs[i2] - xs[ic]);
  const k = scala < 1.5 ? 1 : Math.min(4, Math.round(scala));
  const sub = [];
  for (let a = 0; a < k; a++) sub.push(((a + 0.5) / k - 0.5) * scala);

  const out = new Uint8ClampedArray(w * h * 4);
  const src = m.rgba, mw = m.w, mh = m.h;
  // indice del nodo per ogni colonna e riga
  const colI = new Int32Array(w), colT = new Float64Array(w);
  for (let c = 0; c < w; c++) {
    let i = Math.min(nx - 2, Math.floor((c + 0.5) / PASSO));
    while (i < nx - 2 && c + 0.5 > xs[i + 1]) i++;
    colI[c] = i;
    colT[c] = (c + 0.5 - xs[i]) / (xs[i + 1] - xs[i]);
  }
  for (let r = 0; r < h; r++) {
    let j = Math.min(ny - 2, Math.floor((r + 0.5) / PASSO));
    while (j < ny - 2 && r + 0.5 > ys[j + 1]) j++;
    const tj = (r + 0.5 - ys[j]) / (ys[j + 1] - ys[j]);
    for (let c = 0; c < w; c++) {
      const i = colI[c], ti = colT[c];
      const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
      const u = (U[a] * (1 - ti) + U[b] * ti) * (1 - tj) + (U[cc] * (1 - ti) + U[d] * ti) * tj;
      const v = (V[a] * (1 - ti) + V[b] * ti) * (1 - tj) + (V[cc] * (1 - ti) + V[d] * ti) * tj;
      let R = 0, G = 0, B = 0, n = 0;
      for (let p = 0; p < k; p++) {
        const vv = Math.floor(v + sub[p]);
        if (vv < 0 || vv >= mh) continue;
        for (let q = 0; q < k; q++) {
          const uu = Math.floor(u + sub[q]);
          if (uu < 0 || uu >= mw) continue;
          const o = (vv * mw + uu) * 4;
          if (src[o + 3] < 128) continue;
          R += src[o]; G += src[o + 1]; B += src[o + 2]; n++;
        }
      }
      if (n * 2 >= k * k && n > 0) {
        const o = (r * w + c) * 4;
        out[o] = R / n; out[o + 1] = G / n; out[o + 2] = B / n; out[o + 3] = 255;
      }
    }
  }
  return { rgba: out, w, h };
}

/** Luminosità 0–255 per pixel (NaN dove la foto manca). */
export function luminanzaRgba(rgba) {
  const n = rgba.length >> 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = rgba[o + 3] < 128 ? NaN : 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
  }
  return out;
}

/** Indice di verde (2G − R − B) / (R + G + B): alto su erba e chioma, vicino a zero su terra e pietra. */
export function indiceVerde(rgba) {
  const n = rgba.length >> 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const s = rgba[o] + rgba[o + 1] + rgba[o + 2];
    out[i] = rgba[o + 3] < 128 || s === 0 ? NaN : (2 * rgba[o + 1] - rgba[o] - rgba[o + 2]) / s;
  }
  return out;
}

/** Modulo del gradiente (Sobel) della luminosità; NaN ai bordi e dove manca la foto. */
function gradiente(lum, w, h) {
  const out = new Float32Array(w * h).fill(NaN);
  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      const i = r * w + c;
      const a = lum[i - w - 1], b = lum[i - w], cc = lum[i - w + 1], d = lum[i - 1], f = lum[i + 1];
      const gg = lum[i + w - 1], hh = lum[i + w], ii = lum[i + w + 1];
      const gx = (cc + 2 * f + ii - (a + 2 * d + gg)) / 8;
      const gy = (gg + 2 * hh + ii - (a + 2 * b + cc)) / 8;
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

// ------------------------------------------------------------------ forma dell'anomalia

function riempiPoligonoLocale(mask, ww, hh, poly) {
  let miny = Infinity, maxy = -Infinity;
  for (const p of poly) { if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }
  for (let r = Math.max(0, Math.floor(miny)); r <= Math.min(hh - 1, Math.ceil(maxy)); r++) {
    const y = r + 0.5, xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let c = Math.max(0, Math.ceil(xs[k] - 0.5)); c <= Math.min(ww - 1, Math.floor(xs[k + 1] - 0.5)); c++) mask[r * ww + c] = 1;
    }
  }
}

/**
 * Forma dell'anomalia in pixel della griglia, come scostamenti (dx, dy) da un pixel di riferimento al suo centro:
 *   dentro = pixel della forma (per una linea: la linea ingrossata alla sua larghezza),
 *   bordo  = fascia di due pixel a cavallo del contorno,
 *   fuori  = anello attorno alla forma, a partire da 2 pixel di distanza.
 * Gli scostamenti sono coppie [dx, dy, dx, dy, …] in un Int32Array; la forma si può quindi spostare dove si vuole.
 */
export function formaDaAnomalia(a, g, { distanzaAnello = 2 } = {}) {
  if (!a.geom?.coord?.length) return null;
  const pts = a.geom.coord.map(([la, lo]) => aPixel(g, la, lo));
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of pts) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  if (![minx, miny, maxx, maxy].every(Number.isFinite)) return null;

  const linea = a.geom.tipo === "linea";
  // larghezza stimata di una linea (area / lunghezza), in pixel; semi-larghezza ≥ 1
  const largPx = linea && a.dimensioneM > 0 ? a.areaM2 / a.dimensioneM / g.cella : 0;
  const mezza = linea ? Math.min(4, Math.max(1, Math.round(largPx / 2))) : 0;
  const pad = Math.ceil(distanzaAnello + 12 + mezza) + 3;
  const x0 = Math.floor(minx) - pad, y0 = Math.floor(miny) - pad;
  const ww = Math.ceil(maxx) - x0 + pad + 1, hh = Math.ceil(maxy) - y0 + pad + 1;
  if (ww * hh > 25e6) return null;

  const forma = new Uint8Array(ww * hh);
  const locali = pts.map(([x, y]) => [x - x0, y - y0]);
  if (linea) {
    rasterizzaLinea(forma, ww, hh, locali.map(([x, y]) => [x - 0.5, y - 0.5]));
  } else {
    riempiPoligonoLocale(forma, ww, hh, locali);
    if (!forma.some((v) => v)) { // poligono più piccolo di un pixel
      const c = Math.floor((minx + maxx) / 2 - x0), r = Math.floor((miny + maxy) / 2 - y0);
      forma[r * ww + c] = 1;
    }
  }
  let dentroMask = forma;
  if (linea) {
    const dl = distanzaDa(forma, ww, hh);
    dentroMask = new Uint8Array(ww * hh);
    for (let i = 0; i < dentroMask.length; i++) dentroMask[i] = dl[i] <= mezza ? 1 : 0;
  }
  let n = 0, bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (let r = 0; r < hh; r++) {
    for (let c = 0; c < ww; c++) {
      if (!dentroMask[r * ww + c]) continue;
      n++;
      if (c < bx0) bx0 = c; if (c > bx1) bx1 = c; if (r < by0) by0 = r; if (r > by1) by1 = r;
    }
  }
  if (!n) return null;

  const dist = distanzaDa(dentroMask, ww, hh);
  const dimPx = linea ? 2 * mezza + 1 : 2 * Math.sqrt(n / Math.PI);
  const largAnello = Math.min(12, Math.max(4, Math.round(dimPx / 2)));
  const ox = Math.floor((bx0 + bx1 + 1) / 2), oy = Math.floor((by0 + by1 + 1) / 2); // pixel di riferimento (in coordinate locali)
  const dentro = [], fuori = [], bordo = [];
  for (let r = 1; r < hh - 1; r++) {
    for (let c = 1; c < ww - 1; c++) {
      const i = r * ww + c;
      const dx = c - ox, dy = r - oy;
      if (dentroMask[i]) {
        dentro.push(dx, dy);
        if (!dentroMask[i - 1] || !dentroMask[i + 1] || !dentroMask[i - ww] || !dentroMask[i + ww]) bordo.push(dx, dy);
      } else {
        const d = dist[i];
        if (d <= 1.34) bordo.push(dx, dy);
        else if (d > distanzaAnello && d <= distanzaAnello + largAnello) fuori.push(dx, dy);
      }
    }
  }
  let estensioneX = 0, estensioneY = 0;
  for (const v of [dentro, fuori, bordo]) {
    for (let i = 0; i < v.length; i += 2) {
      estensioneX = Math.max(estensioneX, Math.abs(v[i]));
      estensioneY = Math.max(estensioneY, Math.abs(v[i + 1]));
    }
  }
  const estensione = Math.max(estensioneX, estensioneY);
  return {
    dentro: Int32Array.from(dentro), fuori: Int32Array.from(fuori), bordo: Int32Array.from(bordo),
    // pixel di riferimento nella griglia
    centro: [x0 + ox, y0 + oy],
    larghezzaPx: bx1 - bx0 + 1, altezzaPx: by1 - by0 + 1, dimPx, estensione, estensioneX, estensioneY,
  };
}

// ------------------------------------------------------------------ confronto

function rng(seme) {
  let a = seme >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Prende al massimo `cap` elementi, ben distribuiti, da un vettore [dx, dy, …]. */
function sottocampiona(v, cap) {
  const n = v.length >> 1;
  const passo = Math.max(1, Math.ceil(n / cap));
  const m = Math.ceil(n / passo);
  const dx = new Int16Array(m), dy = new Int16Array(m);
  for (let k = 0, i = 0; i < n; i += passo, k++) { dx[k] = v[2 * i]; dy[k] = v[2 * i + 1]; }
  return { dx, dy, n: m };
}

function media(arr, w, h, s, cx, cy) {
  let somma = 0, validi = 0;
  for (let k = 0; k < s.n; k++) {
    const c = cx + s.dx[k], r = cy + s.dy[k];
    if (c < 0 || r < 0 || c >= w || r >= h) continue;
    const v = arr[r * w + c];
    if (v === v) { somma += v; validi++; }
  }
  return { media: validi ? somma / validi : NaN, validi };
}

/** Per un punto e uno spostamento: contrasto interno/anello e forza dei contorni. Null se i dati non bastano. */
function misure(lum, grad, w, h, F, cx, cy) {
  const dentro = media(lum, w, h, F.dentro, cx, cy);
  const fuori = media(lum, w, h, F.fuori, cx, cy);
  const bordo = media(grad, w, h, F.bordo, cx, cy);
  if (dentro.validi < 0.6 * F.dentro.n || fuori.validi < 0.5 * F.fuori.n || bordo.validi < 0.5 * F.bordo.n) return null;
  return { contrasto: dentro.media - fuori.media, bordo: bordo.media };
}

/** Massimo, sugli spostamenti ammessi, del contrasto (in valore assoluto) e del bordo. */
function statistica(lum, grad, w, h, F, spostamenti, cx, cy) {
  let tc = -Infinity, te = -Infinity, migliore = null;
  for (const [sx, sy] of spostamenti) {
    const m = misure(lum, grad, w, h, F, cx + sx, cy + sy);
    if (!m) continue;
    const ac = Math.abs(m.contrasto);
    if (ac > tc) { tc = ac; migliore = { sx, sy, contrasto: m.contrasto }; }
    if (m.bordo > te) te = m.bordo;
  }
  return migliore ? { tc, te, migliore } : null;
}

function nonValutabile(a, motivo, extra = {}) {
  return { id: a.id, esito: "non-valutabile", p: null, contrasto: null, bordo: null, vegetazione: false, copertura: extra.copertura ?? null, spostamentoPx: null, motivo };
}

/**
 * @param {object} p
 * @param {Array} p.anomalie  anomalie del rilevatore (con geom.coord in [lat, lon], dimensioneM, areaM2, codice)
 * @param {object} p.g        griglia del rilievo {w, h, cella, origine, proiezione}
 * @param {{rgba:Uint8ClampedArray,w:number,h:number,merc:number[]}} p.mosaico  foto in Web Mercator
 * @param {number} [p.passoFotoM] metri a terra per pixel della foto (se omesso, si ricava dal mosaico)
 * @param {number} [p.permutazioni] quante posizioni casuali confrontare (default 100)
 */
export function confrontaConFoto({ anomalie, g: griglia, mosaico, passoFotoM = null, permutazioni = 100, seme = 20260101 }) {
  // la foto si porta su una griglia un po' più grande di quella del rilievo (le anomalie sul bordo hanno bisogno del loro anello)
  const g = { ...griglia, w: griglia.w + 2 * MARGINE_PX, h: griglia.h + 2 * MARGINE_PX, origine: { x: griglia.origine.x - MARGINE_PX * griglia.cella, y: griglia.origine.y + MARGINE_PX * griglia.cella } };
  const { w, h } = g;
  const camp = campionaMosaico(mosaico, g);
  const lum = luminanzaRgba(camp.rgba);
  const verde = indiceVerde(camp.rgba);
  const grad = gradiente(lum, w, h);

  let passo = passoFotoM;
  if (!(passo > 0)) {
    const [lat] = g.proiezione.aLatLon(g.origine.x + (w * g.cella) / 2, g.origine.y - (h * g.cella) / 2);
    passo = ((mosaico.merc[2] - mosaico.merc[0]) / mosaico.w) * Math.cos((lat * Math.PI) / 180);
  }

  // piccoli spostamenti ammessi fra foto e LiDAR (circa ±2 m)
  const S = Math.min(4, Math.max(1, Math.round(2 / g.cella)));
  const passi = S <= 2 ? Array.from({ length: 2 * S + 1 }, (_, i) => i - S) : [-S, -Math.round(S / 2), 0, Math.round(S / 2), S];
  const spostamenti = [];
  for (const sy of passi) for (const sx of passi) spostamenti.push([sx, sy]);

  const risultati = [];
  for (const a of anomalie) {
    const forma = formaDaAnomalia(a, g);
    if (!forma) { risultati.push(nonValutabile(a, "L'anomalia non ha una forma utilizzabile per il confronto.")); continue; }

    // il segno è abbastanza grande per la risoluzione della foto?
    const largM = a.codice === "lineare" && a.dimensioneM > 0 ? a.areaM2 / a.dimensioneM : a.dimensioneM;
    if (largM / passo < PIXEL_MIN_SEGNO) {
      risultati.push(nonValutabile(a, `La risoluzione della foto è troppo grossolana: un pixel misura circa ${passo.toFixed(1)} m e il segno è largo ${largM.toFixed(1)} m.`));
      continue;
    }

    const F = {
      dentro: sottocampiona(forma.dentro, MAX_CAMPIONE),
      fuori: sottocampiona(forma.fuori, MAX_CAMPIONE),
      bordo: sottocampiona(forma.bordo, 200),
    };
    const [cx, cy] = forma.centro;

    // copertura e uniformità della foto nel punto
    const cD = media(lum, w, h, F.dentro, cx, cy), cF = media(lum, w, h, F.fuori, cx, cy);
    const copertura = F.dentro.n ? cD.validi / F.dentro.n : 0;
    if (cD.validi < 0.8 * F.dentro.n || cF.validi < 0.5 * Math.max(1, F.fuori.n)) {
      risultati.push(nonValutabile(a, `La foto non copre l'anomalia (copertura ${Math.round(copertura * 100)}%).`, { copertura }));
      continue;
    }
    let s1 = 0, s2 = 0, nn = 0, verdeSomma = 0, verdeN = 0;
    for (const s of [F.dentro, F.fuori]) {
      for (let k = 0; k < s.n; k++) {
        const c = cx + s.dx[k], r = cy + s.dy[k];
        if (c < 0 || r < 0 || c >= w || r >= h) continue;
        const v = lum[r * w + c];
        if (v === v) { s1 += v; s2 += v * v; nn++; }
        const ve = verde[r * w + c];
        if (ve === ve) { verdeSomma += ve; verdeN++; }
      }
    }
    const dev = nn > 1 ? Math.sqrt(Math.max(0, s2 / nn - (s1 / nn) ** 2)) : 0;
    if (dev < DEV_MIN_FOTO) {
      risultati.push(nonValutabile(a, "La foto è uniforme in questo punto (nessun dettaglio da confrontare).", { copertura }));
      continue;
    }
    const vegetazione = verdeN > 0 && verdeSomma / verdeN > SOGLIA_VERDE;

    // il punto vero
    const oss = statistica(lum, grad, w, h, F, spostamenti, cx, cy);
    if (!oss) { risultati.push(nonValutabile(a, "La foto non copre l'anomalia in modo sufficiente.", { copertura })); continue; }

    // gli altri punti: stessa forma, posizioni casuali lontane dal punto vero e interamente nel rilievo
    const exX = forma.estensioneX + S + 1, exY = forma.estensioneY + S + 1;
    const lim = { x0: exX, x1: w - 1 - exX, y0: exY, y1: h - 1 - exY };
    if (lim.x1 <= lim.x0 || lim.y1 <= lim.y0) {
      risultati.push(nonValutabile(a, "L'anomalia è troppo grande rispetto all'area analizzata per essere confrontata.", { copertura }));
      continue;
    }
    const rnd = rng(seme + (Number(a.id) || 0) * 7919);
    const escW = 2 * exX, escH = 2 * exY; // due forme non si sovrappongono se i loro ingombri (anelli compresi) sono distinti
    const nulli = { c: [], e: [] };
    for (let prova = 0; prova < permutazioni * 30 && nulli.c.length < permutazioni; prova++) {
      const tx = lim.x0 + Math.floor(rnd() * (lim.x1 - lim.x0 + 1));
      const ty = lim.y0 + Math.floor(rnd() * (lim.y1 - lim.y0 + 1));
      if (Math.abs(tx - cx) < escW && Math.abs(ty - cy) < escH) continue;
      const st = statistica(lum, grad, w, h, F, spostamenti, tx, ty);
      if (!st) continue;
      nulli.c.push(st.tc);
      nulli.e.push(st.te);
    }
    if (nulli.c.length < 30) {
      risultati.push(nonValutabile(a, "Nella foto non c'è abbastanza area libera per confrontare l'anomalia con altri punti.", { copertura }));
      continue;
    }
    const conta = (v, x) => { let n = 0; for (const t of v) if (t >= x) n++; return n; };
    const pc = (1 + conta(nulli.c, oss.tc)) / (1 + nulli.c.length);
    const pe = (1 + conta(nulli.e, oss.te)) / (1 + nulli.e.length);
    const p = Math.min(1, 2 * Math.min(pc, pe)); // due misure: correzione di Bonferroni

    let esito, motivo;
    if (p <= SOGLIA_VISIBILE) {
      esito = "anche-foto";
      motivo = `Nella foto c'è un segno che coincide con l'anomalia (differenza di luminosità ${oss.migliore.contrasto >= 0 ? "+" : ""}${oss.migliore.contrasto.toFixed(0)} su 255, p = ${p.toFixed(2)}). Può essere una costruzione, una strada o una lavorazione del campo: da verificare.`;
    } else if (p >= SOGLIA_ASSENTE) {
      esito = "solo-lidar";
      motivo = `Nella foto non si distingue nessun segno che corrisponda all'anomalia (p = ${p.toFixed(2)}).`;
    } else {
      esito = "incerto";
      motivo = `Nella foto c'è forse una traccia, ma non si distingue con sicurezza dalla normale variazione dell'immagine (p = ${p.toFixed(2)}).`;
    }
    if (vegetazione) motivo += " In questo punto la foto mostra vegetazione: un segno sul terreno potrebbe non vedersi.";
    risultati.push({
      id: a.id, esito, p: Number(p.toFixed(3)), contrasto: Number(oss.migliore.contrasto.toFixed(1)), bordo: Number(oss.te.toFixed(2)),
      vegetazione, copertura: Number(copertura.toFixed(2)), spostamentoPx: [oss.migliore.sx, oss.migliore.sy], motivo,
    });
  }
  const riepilogo = { "solo-lidar": 0, "anche-foto": 0, incerto: 0, "non-valutabile": 0 };
  for (const r of risultati) riepilogo[r.esito]++;
  return { risultati, riepilogo, passoFotoM: passo, spostamentoMassimoPx: S };
}
