// Visualizzazioni del rilievo per l'archeologia: ombreggiatura (anche da più direzioni), pendenza,
// modello di rilievo locale (LRM) e sky-view factor (SVF). Funzioni pure su array Float32.
// Convenzione: dati[r*w+c], righe verso sud, colonne verso est, NaN = nessun terreno.

import { mercatoreDiretta, mercatoreInversa } from "./proj.js";

/** Riempie i vuoti col valore del pixel valido più vicino (BFS). Restituisce {pieno, valido}. */
export function riempiVuoti(dati, w, h) {
  const n = w * h;
  const pieno = new Float32Array(dati);
  const valido = new Uint8Array(n);
  const coda = new Int32Array(n);
  let testa = 0, fine = 0;
  for (let i = 0; i < n; i++) {
    if (dati[i] === dati[i]) { valido[i] = 1; coda[fine++] = i; }
  }
  if (fine === 0) return { pieno, valido, vuoto: true };
  if (fine === n) return { pieno, valido, vuoto: false };
  const visto = new Uint8Array(valido);
  while (testa < fine) {
    const i = coda[testa++];
    const r = (i / w) | 0, c = i - r * w;
    const vicini = [c > 0 ? i - 1 : -1, c < w - 1 ? i + 1 : -1, r > 0 ? i - w : -1, r < h - 1 ? i + w : -1];
    for (const j of vicini) {
      if (j < 0 || visto[j]) continue;
      visto[j] = 1;
      pieno[j] = pieno[i];
      coda[fine++] = j;
    }
  }
  return { pieno, valido, vuoto: false };
}

function sfocaBoxOrizz(src, dst, w, h, r) {
  const d = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const b = y * w;
    let somma = 0;
    for (let k = -r; k <= r; k++) somma += src[b + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      dst[b + x] = somma / d;
      somma += src[b + Math.min(w - 1, x + r + 1)] - src[b + Math.max(0, x - r)];
    }
  }
}
function sfocaBoxVert(src, dst, w, h, r) {
  const d = 2 * r + 1;
  for (let x = 0; x < w; x++) {
    let somma = 0;
    for (let k = -r; k <= r; k++) somma += src[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = somma / d;
      somma += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
}

/** Sfocatura gaussiana approssimata con tre sfocature a scatola (errore trascurabile per l'LRM). */
export function sfocaGauss(src, w, h, sigma) {
  if (!(sigma > 0.5)) return new Float32Array(src);
  const n = 3;
  const wIdeale = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeale);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  let a = new Float32Array(src), b = new Float32Array(src.length);
  for (let i = 0; i < n; i++) {
    const r = ((i < m ? wl : wu) - 1) / 2;
    sfocaBoxOrizz(a, b, w, h, r);
    sfocaBoxVert(b, a, w, h, r);
  }
  return a;
}

const px = (z, w, h, c, r) => z[Math.min(h - 1, Math.max(0, r)) * w + Math.min(w - 1, Math.max(0, c))];

/** Gradienti di Horn: ddx verso est, ddy verso nord (m/m). */
function gradienti(z, w, h, cella) {
  const gx = new Float32Array(z.length), gy = new Float32Array(z.length);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const a = px(z, w, h, c - 1, r - 1), b = px(z, w, h, c, r - 1), cc = px(z, w, h, c + 1, r - 1);
      const d = px(z, w, h, c - 1, r), f = px(z, w, h, c + 1, r);
      const g = px(z, w, h, c - 1, r + 1), hh = px(z, w, h, c, r + 1), i = px(z, w, h, c + 1, r + 1);
      const o = r * w + c;
      gx[o] = (cc + 2 * f + i - (a + 2 * d + g)) / (8 * cella);
      gy[o] = -(g + 2 * hh + i - (a + 2 * b + cc)) / (8 * cella); // le righe crescono verso sud
    }
  }
  return { gx, gy };
}

/** Pendenza in gradi. */
export function pendenza(z, w, h, cella) {
  const { gx, gy } = gradienti(z, w, h, cella);
  const out = new Float32Array(z.length);
  for (let i = 0; i < out.length; i++) out[i] = (Math.atan(Math.hypot(gx[i], gy[i])) * 180) / Math.PI;
  return out;
}

/** Ombreggiatura 0..1 per una o più direzioni (azimut orario da nord, gradi). */
export function ombreggiatura(z, w, h, cella, { azimut = [315], altezza = 35, esagerazione = 1 } = {}) {
  const { gx, gy } = gradienti(z, w, h, cella);
  const out = new Float32Array(z.length);
  const alt = (altezza * Math.PI) / 180;
  const luci = azimut.map((a) => {
    const az = (a * Math.PI) / 180;
    return [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)];
  });
  for (let i = 0; i < out.length; i++) {
    const nx = -gx[i] * esagerazione, ny = -gy[i] * esagerazione;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    let s = 0;
    for (const [lx, ly, lz] of luci) s += Math.max(0, (nx * lx + ny * ly + lz) * inv);
    out[i] = s / luci.length;
  }
  return out;
}

export const direzioni = (n) => Array.from({ length: n }, (_, i) => (i * 360) / n);

/** Modello di rilievo locale: quota meno quota "di fondo" (sfocatura di raggio sigma pixel). */
export function lrm(pieno, w, h, sigmaPx) {
  const fondo = sfocaGauss(pieno, w, h, sigmaPx);
  const out = new Float32Array(pieno.length);
  for (let i = 0; i < out.length; i++) out[i] = pieno[i] - fondo[i];
  return out;
}

/** Sky-view factor: 1 = cielo tutto visibile, valori bassi = fossati e depressioni. */
export function svf(z, w, h, cella, raggioPx = 10, nDir = 16) {
  const out = new Float32Array(z.length);
  const passi = Math.max(1, Math.round(raggioPx));
  const dx = [], dy = [];
  for (let d = 0; d < nDir; d++) {
    const a = (2 * Math.PI * d) / nDir;
    dx.push(Math.cos(a)); dy.push(Math.sin(a));
  }
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const z0 = z[r * w + c];
      let somma = 0;
      for (let d = 0; d < nDir; d++) {
        let tmax = 0;
        for (let s = 1; s <= passi; s++) {
          const cc = Math.round(c + dx[d] * s), rr = Math.round(r + dy[d] * s);
          if (cc < 0 || rr < 0 || cc >= w || rr >= h) break;
          const dist = Math.hypot((cc - c), (rr - r)) * cella;
          const t = (z[rr * w + cc] - z0) / dist;
          if (t > tmax) tmax = t;
        }
        somma += tmax / Math.sqrt(1 + tmax * tmax);
      }
      out[r * w + c] = 1 - somma / nDir;
    }
  }
  return out;
}

// ------------------------------------------------------------------ statistiche

/** Mediana e MAD robusti su un campione degli elementi validi. */
export function statisticheRobuste(arr, valido, campione = 120000) {
  const passo = Math.max(1, Math.floor(arr.length / campione));
  const v = [];
  for (let i = 0; i < arr.length; i += passo) if (!valido || valido[i]) v.push(arr[i]);
  if (!v.length) return { mediana: 0, sigma: 0, p02: 0, p98: 0 };
  v.sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))))];
  const mediana = q(0.5);
  const dev = v.map((x) => Math.abs(x - mediana)).sort((a, b) => a - b);
  const mad = dev[Math.floor(dev.length / 2)];
  return { mediana, sigma: 1.4826 * mad, p02: q(0.02), p98: q(0.98) };
}

// ------------------------------------------------------------------- colori

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Trasforma una visualizzazione in RGBA (Uint8ClampedArray).
 * tipo: "ombre" | "lrm" | "svf" | "pendenza" | "combinata". `opzioni.scalaLrm` in metri (±).
 */
export function coloraVisualizzazione(tipo, v, valido, w, h, opzioni = {}) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const imposta = (i, r, g, b) => { rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = valido[i] ? 255 : 0; };
  if (tipo === "lrm") {
    const scala = opzioni.scalaLrm || Math.max(0.05, 2.5 * statisticheRobuste(v, valido).sigma);
    for (let i = 0; i < v.length; i++) {
      const t = clamp(v[i] / scala, -1, 1);
      // blu (depressioni) → bianco → arancio (rilievi)
      if (t < 0) imposta(i, 255 + t * 175, 255 + t * 105, 255 + t * 20);
      else imposta(i, 255, 255 - t * 130, 255 - t * 230);
    }
  } else if (tipo === "svf") {
    const { p02, p98 } = statisticheRobuste(v, valido);
    const span = Math.max(1e-6, p98 - p02);
    for (let i = 0; i < v.length; i++) { const g = clamp(((v[i] - p02) / span), 0, 1) * 255; imposta(i, g, g, g); }
  } else if (tipo === "pendenza") {
    for (let i = 0; i < v.length; i++) { const g = 255 - clamp(v[i] / 40, 0, 1) * 255; imposta(i, g, g, g); }
  } else { // ombre, combinata: v già in 0..1
    for (let i = 0; i < v.length; i++) { const g = clamp(v[i], 0, 1) * 255; imposta(i, g, g, g); }
  }
  return rgba;
}

// ---------------------------------------------------------- per la mappa

/**
 * Riproietta un'immagine RGBA dalla griglia UTM a una griglia uniforme in Web Mercator,
 * così Leaflet la sovrappone senza sfasamenti. Restituisce {rgba, w, h, bounds:[[sud,ovest],[nord,est]]}.
 */
export function riproiettaPerMappa(rgba, w, h, cella, origine, proiezione, maxLato = 2400) {
  const angoli = [[0, 0], [w, 0], [w, h], [0, h]].map(([c, r]) => proiezione.aLatLon(origine.x + c * cella, origine.y - r * cella));
  const lats = angoli.map((a) => a[0]), lons = angoli.map((a) => a[1]);
  const sud = Math.min(...lats), nord = Math.max(...lats), ovest = Math.min(...lons), est = Math.max(...lons);
  const [xO] = mercatoreDiretta(sud, ovest), [xE, yN] = mercatoreDiretta(nord, est), [, yS] = mercatoreDiretta(sud, ovest);
  const larg = xE - xO, alt = yN - yS;
  const scala = Math.min(1, maxLato / Math.max(w, h));
  const w2 = Math.max(2, Math.round(Math.max(w, h) * scala * (larg >= alt ? 1 : larg / alt)));
  const h2 = Math.max(2, Math.round(w2 * (alt / larg)));
  const out = new Uint8ClampedArray(w2 * h2 * 4);
  for (let r2 = 0; r2 < h2; r2++) {
    const y = yN - ((r2 + 0.5) / h2) * alt;
    const lat = mercatoreInversa(0, y)[0];
    for (let c2 = 0; c2 < w2; c2++) {
      const lon = ovest + ((c2 + 0.5) / w2) * (est - ovest);
      const [X, Y] = proiezione.daLatLon(lat, lon);
      const c = Math.floor((X - origine.x) / cella), r = Math.floor((origine.y - Y) / cella);
      if (c < 0 || r < 0 || c >= w || r >= h) continue;
      const s = (r * w + c) * 4, d = (r2 * w2 + c2) * 4;
      out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
    }
  }
  return { rgba: out, w: w2, h: h2, bounds: [[sud, ovest], [nord, est]] };
}
