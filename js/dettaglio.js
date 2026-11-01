// Rifinitura del rilievo che arriva dal servizio. Funzioni pure su array Float32.
//
// Il servizio del Ministero dà il terreno come immagine a 256 livelli di grigio: in metri sono gradini
// (un livello vale qualche decimetro, o più). Un'ombreggiatura calcolata su gradini mostra curve di livello
// al posto del terreno: è questo che fa sembrare il LiDAR «grossolano».
//
// `dequantizza` toglie i gradini senza inventare quote: alterna una leggera sfocatura a una correzione che
// riporta ogni pixel dentro l'intervallo di arrotondamento da cui è nato (valore letto ± mezzo gradino).
// Il vero terreno sta per costruzione in quell'intervallo, quindi il risultato non si allontana dal dato
// del servizio di più di mezzo gradino; dove il terreno sale di più di un gradino per pixel (muri, scarpate,
// bordi di fossato) la correzione tiene il dato com'è e i contorni restano.
// Non aggiunge dettagli più piccoli di un gradino: li rende solo leggibili senza le false curve di livello.

import { sfocaGauss } from "./visual.js";

export const PASSO_MIN_M = 0.04; // sotto questo gradino (in metri) i gradini non si vedono nemmeno nelle ombre

/**
 * @param pieno  quote senza vuoti (vedi riempiVuoti)
 * @param valido maschera dei pixel con dato vero (gli altri restano come sono)
 * @param passo  valore di un gradino, nelle stesse unità delle quote (metri, oppure 1 per i livelli di grigio)
 * @returns {dati, iterazioni, scostamentoMax}
 */
export function dequantizza(pieno, valido, w, h, passo, { iterazioni = 6, sigma = 1.0 } = {}) {
  const n = w * h;
  const out = new Float32Array(pieno);
  if (!(passo > 0) || n === 0) return { dati: out, iterazioni: 0, scostamentoMax: 0 };
  const mezzo = passo / 2;
  const lo = new Float32Array(n), hi = new Float32Array(n);
  for (let i = 0; i < n; i++) { lo[i] = pieno[i] - mezzo; hi[i] = pieno[i] + mezzo; }
  let fatte = 0;
  for (; fatte < iterazioni; fatte++) {
    const s = sfocaGauss(out, w, h, sigma);
    let mossa = 0;
    for (let i = 0; i < n; i++) {
      if (!valido[i]) continue; // i pixel riempiti non hanno un dato da rispettare
      const v = s[i] < lo[i] ? lo[i] : s[i] > hi[i] ? hi[i] : s[i];
      const d = Math.abs(v - out[i]);
      if (d > mossa) mossa = d;
      out[i] = v;
    }
    if (mossa < passo * 0.002) { fatte++; break; } // non cambia più
  }
  let scostamentoMax = 0;
  for (let i = 0; i < n; i++) if (valido[i]) scostamentoMax = Math.max(scostamentoMax, Math.abs(out[i] - pieno[i]));
  return { dati: out, iterazioni: fatte, scostamentoMax };
}

/**
 * Il gradino da levigare per un rilievo del servizio: un livello di grigio in metri, ma solo se la conversione
 * in metri è riuscita. Con i grigi relativi non si sa che cosa valga un livello (e il servizio del Geoportale
 * manda di solito un rilievo già ombreggiato, non una scala di quote): niente da levigare, risponde 0.
 * Risponde 0 anche se il gradino è troppo piccolo per contare.
 */
export function passoDaLevigare({ relativo, passoM }) {
  if (relativo) return 0;
  return passoM >= PASSO_MIN_M ? passoM : 0;
}
