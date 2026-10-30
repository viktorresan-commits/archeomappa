// Foto di riferimento per il confronto con il LiDAR: scarica le tessere che coprono l'area del rilievo
// e le unisce in un mosaico Web Mercator (vedi confronto.js, che lo porta sulla griglia del rilievo).
//
// Fonti: satellite attuale di Esri, satelliti storici Esri Wayback e ortofoto del Ministero (WMS). Le tessere
// si leggono pixel per pixel, quindi servono un servizio che consenta la lettura dal sito (CORS) oppure
// l'app Android (client HTTP nativo): vale la stessa regola del LiDAR (vedi lidar-servizio.js).

import { SOVRAPPOSIZIONI, BASI, urlTessera } from "./layers.js";

const MEZZO_MONDO = 20037508.342789244;
const LATO_MONDO = 2 * MEZZO_MONDO;

/** Tessere (x0, y0, nx, ny) di zoom zt che coprono il riquadro [minX, minY, maxX, maxY] in metri Web Mercator. */
export function elencoTessere(merc, zt) {
  const n = 2 ** zt;
  const lato = LATO_MONDO / n;
  const cl = (v) => Math.min(n - 1, Math.max(0, v));
  const x0 = cl(Math.floor((merc[0] + MEZZO_MONDO) / lato));
  const x1 = cl(Math.floor((merc[2] + MEZZO_MONDO) / lato - 1e-9));
  const y0 = cl(Math.floor((MEZZO_MONDO - merc[3]) / lato));
  const y1 = cl(Math.floor((MEZZO_MONDO - merc[1]) / lato - 1e-9));
  return { x0, y0, nx: Math.max(1, x1 - x0 + 1), ny: Math.max(1, y1 - y0 + 1) };
}

/** Lo zoom più alto, non oltre zIdeale, per cui le tessere non superano maxTessere. */
export function zoomUtilizzabile(merc, zIdeale, { maxTessere = 150, zMin = 8 } = {}) {
  let zt = zIdeale;
  while (zt > zMin) {
    const t = elencoTessere(merc, zt);
    if (t.nx * t.ny <= maxTessere) break;
    zt--;
  }
  return { zt, ridotto: zt < zIdeale };
}

export function urlDaModello(modello, z, x, y) {
  return modello.replace("{z}", z).replace("{y}", y).replace("{x}", x).replace("{s}", "a");
}

/**
 * Scarica le tessere e le unisce. `scarica(url)` restituisce {w, h, rgba}; `modello` è un indirizzo con {z}/{y}/{x}
 * oppure `url(zt, x, y)` è una funzione (WMS). Una tessera che manca lascia un buco trasparente (contato in `mancanti`);
 * se non ne arriva nessuna, rilancia il primo errore del servizio.
 * Restituisce {rgba, w, h, merc:[minX,minY,maxX,maxY], mancanti, tessere, zt}.
 */
export async function scaricaMosaico({ merc, zt, tilePx = 256, modello, url, scarica, avanzamento = () => {}, parallelo = 6 }) {
  const { x0, y0, nx, ny } = elencoTessere(merc, zt);
  const w = nx * tilePx, h = ny * tilePx;
  if (w * h > 70e6) throw new Error("La foto di riferimento sarebbe troppo grande per il dispositivo: riduci il raggio di analisi.");
  const rgba = new Uint8ClampedArray(w * h * 4);
  const lavori = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) lavori.push([i, j]);
  const totale = lavori.length;
  let fatti = 0, mancanti = 0, primoErrore = null, prossimo = 0;

  async function una([i, j]) {
    try {
      const indirizzo = url ? url(zt, x0 + i, y0 + j) : urlDaModello(modello, zt, x0 + i, y0 + j);
      const img = await scarica(indirizzo);
      if (img.w !== tilePx || img.h !== tilePx) throw new Error(`Il servizio ha restituito un'immagine di ${img.w}×${img.h} pixel invece di ${tilePx}×${tilePx}.`);
      for (let r = 0; r < tilePx; r++) {
        const da = r * tilePx * 4;
        const a = ((j * tilePx + r) * w + i * tilePx) * 4;
        rgba.set(img.rgba.subarray(da, da + tilePx * 4), a);
      }
    } catch (e) {
      mancanti++;
      primoErrore ??= e;
    }
    fatti++;
    if (fatti === totale || fatti % 4 === 0) avanzamento(`Scarico la foto di riferimento: ${fatti} tessere su ${totale}…`);
  }
  async function operaio() {
    while (prossimo < lavori.length) await una(lavori[prossimo++]);
  }
  avanzamento(`Scarico la foto di riferimento: 0 tessere su ${totale}…`);
  await Promise.all(Array.from({ length: Math.min(parallelo, totale) }, operaio));
  if (mancanti === totale) throw primoErrore ?? new Error("Nessuna tessera della foto di riferimento è arrivata.");

  const lato = LATO_MONDO / 2 ** zt;
  return {
    rgba, w, h, mancanti, tessere: totale, zt,
    merc: [-MEZZO_MONDO + x0 * lato, MEZZO_MONDO - (y0 + ny) * lato, -MEZZO_MONDO + (x0 + nx) * lato, MEZZO_MONDO - y0 * lato],
  };
}

// ------------------------------------------------------------------ fonti

const SOLO_TESSERE = (def) => def.tipo === "tile" && /^wb/.test(def.id);
const STORICI = SOVRAPPOSIZIONI.filter(SOLO_TESSERE);

export const ELENCO_RIFERIMENTI = [
  { id: "sat", nome: "Satellite attuale (Esri)" },
  ...STORICI.map((d) => ({ id: d.id, nome: d.nome })),
  { id: "ortofoto", nome: "Ortofoto 2012 (Geoportale nazionale)" },
];

/**
 * Come scaricare la foto di una fonte. `zt(z)` dà lo zoom delle tessere per uno zoom «da 256 px» z;
 * zMax è l'ultimo zoom con immagini vere. Per l'ortofoto serve il servizio scelto (`wms`: {url, livelli, versione, tile}).
 */
export function fonteRiferimento(id, { wms = null } = {}) {
  if (id === "sat") {
    const b = BASI.find((x) => x.id === "sat");
    // Esri a zoom 19 in campagna restituisce spesso un'immagine grigia «dati non disponibili»: meglio fermarsi a 18
    return { id, nome: "Satellite attuale (Esri)", modello: b.url, tilePx: 256, zMax: 18, zt: (z) => z };
  }
  const storico = STORICI.find((d) => d.id === id);
  if (storico) return { id, nome: storico.nome, modello: storico.url, tilePx: 256, zMax: Math.min(18, storico.maxNativeZoom ?? 18), zt: (z) => z };
  if (id === "ortofoto") {
    if (!wms?.url || !wms.livelli) return null;
    const tilePx = wms.tile || 256;
    const def = SOVRAPPOSIZIONI.find((d) => d.id === "ortofoto");
    return {
      id, nome: "Ortofoto 2012 (Geoportale nazionale)", tilePx, zMax: Math.min(18, def?.maxNativeZoom ?? 18),
      // un'immagine da 512 px copre l'area di una tessera da 256 allo zoom precedente
      zt: (z) => (tilePx === 512 ? Math.max(0, z - 1) : z),
      url: (zt, x, y) => urlTessera({ url: wms.url, livelli: wms.livelli, versione: wms.versione, px: tilePx }, zt, x, y),
    };
  }
  return null;
}
