// Rilievo dal LiDAR del servizio (WMS del Geoportale nazionale): nessun file da caricare.
//
// Come funziona, passo per passo:
//  1. si scarica dal servizio l'immagine del livello DTM attorno al centro (a blocchi, se serve);
//  2. la luminosità di ogni pixel è una «quota in livelli di grigio» (la stessa idea del filtro di
//     microrilievo di altre app che usano questi servizi);
//  3. si chiede al servizio la quota vera in alcuni punti (GetFeatureInfo) e si confronta con i grigi:
//     se i due valori seguono una retta, i grigi diventano metri; altrimenti restano «livelli» e
//     l'app lo dice.
// La griglia entra poi nella stessa analisi dei file GeoTIFF.
//
// Limite da dire sempre: l'immagine del servizio ha solo 256 livelli. Quanti metri valga un livello
// dipende da come il servizio la prepara, e qui lo si misura invece di supporlo.

import { mercatoreDiretta, creaProiezione } from "./proj.js";
import { completaMeta } from "./raster.js";

export class ErroreServizio extends Error {
  constructor(messaggio, { dimensione = false } = {}) {
    super(messaggio);
    this.name = "ErroreServizio";
    this.dimensione = dimensione; // la richiesta potrebbe essere troppo grande per il servizio
  }
}

export const CELLA_M = 1; // il DTM del servizio è a 1 m
export const LATO_MAX = 2400; // pixel per lato dell'area (2,4 km a 1 m): sotto il tetto di raster.js, così non si riduce due volte
export const BLOCCHI = [1000, 500, 256]; // lati di richiesta da provare, dal più grande
export const SOVRAPPOSIZIONE = 24; // pixel in comune fra blocchi vicini, per allinearli
const QUOTA_MIN = -500, QUOTA_MAX = 9000; // fuori da qui è un valore «senza dato», non una quota

const ERRORE_DIMENSIONE = /size|dimension|width|height|out of range|too large|maxsize|exceed/i;

// ------------------------------------------------------------------ geometria e indirizzi

/** Quadrato di lato 2×raggioM a terra, in metri di Web Mercator, e numero di pixel per lato. */
export function finestra(lat, lon, raggioM, { latoMax = LATO_MAX } = {}) {
  const [cx, cy] = mercatoreDiretta(lat, lon);
  const k = 1 / Math.cos((lat * Math.PI) / 180); // metri Mercatore per metro a terra
  const mezzo = raggioM * k;
  const n = Math.max(16, Math.min(latoMax, Math.ceil((2 * raggioM) / CELLA_M)));
  return { bbox: [cx - mezzo, cy - mezzo, cx + mezzo, cy + mezzo], n, cellaTerraM: (2 * raggioM) / n };
}

const unisci = (base) => (base.includes("?") ? "&" : "?");

/** Richiesta GetMap, con lo stesso formato che usano le app che già caricano questi servizi. */
export function urlGetMap(base, livello, bbox, w, h) {
  return `${base}${unisci(base)}SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${livello}&STYLES=&SRS=EPSG:3857&BBOX=${bbox.map((v) => v.toFixed(3)).join(",")}&WIDTH=${w}&HEIGHT=${h}&FORMAT=image/png&TRANSPARENT=true`;
}

/** Lettura della quota in un punto (x, y in Web Mercator): finestra 3×3 pixel attorno al punto. */
export function urlQuota(base, livello, x, y) {
  const bbox = [x - 1.5, y - 1.5, x + 1.5, y + 1.5].map((v) => v.toFixed(3)).join(",");
  return `${base}${unisci(base)}SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=${livello}&QUERY_LAYERS=${livello}&STYLES=&SRS=EPSG:3857&BBOX=${bbox}&WIDTH=3&HEIGHT=3&X=1&Y=1&INFO_FORMAT=text/plain`;
}

/** Quota vera da una risposta del servizio («Stretched value;Pixel Value;» come nell'app che la usa). */
export function leggiQuotaGfi(testo) {
  const m = /Stretched value;Pixel Value;\s*-?[\d.]+;(-?[\d.]+);/.exec(String(testo ?? ""));
  if (!m) return null;
  const z = parseFloat(m[1]);
  return Number.isFinite(z) && z > QUOTA_MIN && z < QUOTA_MAX ? z : null;
}

// ------------------------------------------------------------------ pixel

/** Da RGBA a luminosità; i pixel trasparenti (fuori copertura) diventano NaN. */
export function luminanza(rgba, w, h) {
  const dati = new Float32Array(w * h);
  let validi = 0, grigi = 0;
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    if (rgba[i * 4 + 3] < 128) { dati[i] = NaN; continue; }
    dati[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    validi++;
    if (Math.abs(r - g) <= 6 && Math.abs(g - b) <= 6) grigi++;
  }
  return { dati, validi, grigi };
}

/** Statistiche di una griglia: copertura, livelli distinti, minimo e massimo. */
export function statisticheGriglia(dati) {
  const visti = new Uint8Array(256);
  let validi = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < dati.length; i++) {
    const v = dati[i];
    if (v !== v) continue;
    validi++;
    visti[Math.max(0, Math.min(255, Math.round(v)))] = 1;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  let livelli = 0;
  for (const x of visti) livelli += x;
  return { validi, frazioneValidi: dati.length ? validi / dati.length : 0, livelli, min, max };
}

/**
 * Unisce blocchi sovrapposti in un unico mosaico. Ogni blocco viene riportato alla scala di quelli già
 * messi con una retta (offset e guadagno) calcolata sui pixel in comune: serve se il servizio adatta
 * i grigi a ogni richiesta; se non lo fa la correzione risulta nulla.
 */
export function unisciBlocchi(blocchi, n) {
  const mosaico = new Float32Array(n * n).fill(NaN);
  const correzioni = [];
  for (const b of blocchi) {
    let cnt = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let r = 0; r < b.h; r++) {
      for (let c = 0; c < b.w; c++) {
        const v = b.dati[r * b.w + c];
        const m = mosaico[(b.r0 + r) * n + b.c0 + c];
        if (v === v && m === m) { cnt++; sx += v; sy += m; sxx += v * v; sxy += v * m; }
      }
    }
    let a = 0, g = 1;
    if (cnt >= 200) {
      const mx = sx / cnt, my = sy / cnt;
      const varx = sxx / cnt - mx * mx;
      if (varx > 9) g = Math.min(2, Math.max(0.5, (sxy / cnt - mx * my) / varx));
      a = my - g * mx;
    }
    correzioni.push({ a, g, cnt });
    for (let r = 0; r < b.h; r++) {
      for (let c = 0; c < b.w; c++) {
        const v = b.dati[r * b.w + c];
        const i = (b.r0 + r) * n + b.c0 + c;
        if (v === v && mosaico[i] !== mosaico[i]) mosaico[i] = a + g * v;
      }
    }
  }
  return { dati: mosaico, correzioni };
}

// ------------------------------------------------------------------ calibrazione in metri

/** Sceglie punti in zone piane (dove il confronto con la quota vera è affidabile) a livelli di grigio diversi. */
export function scegliPunti(dati, n, quanti = 9) {
  const passo = Math.max(4, Math.floor(n / 40));
  const cand = [];
  for (let r = 4; r < n - 4; r += passo) {
    for (let c = 4; c < n - 4; c += passo) {
      let min = Infinity, max = -Infinity, s = 0, ok = true;
      for (let dr = -2; dr <= 2 && ok; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const v = dati[(r + dr) * n + c + dc];
          if (v !== v) { ok = false; break; }
          if (v < min) min = v;
          if (v > max) max = v;
          s += v;
        }
      }
      if (ok && max - min <= 2) cand.push({ r, c, g: s / 25 });
    }
  }
  cand.sort((a, b) => a.g - b.g);
  const scelti = [];
  for (let i = 0; i < quanti; i++) {
    const p = cand[Math.round((i * (cand.length - 1)) / Math.max(1, quanti - 1))];
    if (p && !scelti.some((o) => Math.abs(o.g - p.g) < 3)) scelti.push(p);
  }
  return scelti;
}

/** Retta z = a + b·g ai minimi quadrati, con R² e scarto quadratico medio dei residui. */
export function regressione(coppie) {
  const n = coppie.length;
  let sg = 0, sz = 0, sgg = 0, sgz = 0, szz = 0;
  for (const { g, z } of coppie) { sg += g; sz += z; sgg += g * g; sgz += g * z; szz += z * z; }
  const den = n * sgg - sg * sg;
  if (n < 2 || Math.abs(den) < 1e-9) return { a: 0, b: 0, r2: 0, rms: Infinity };
  const b = (n * sgz - sg * sz) / den;
  const a = (sz - b * sg) / n;
  let ss = 0;
  for (const { g, z } of coppie) ss += (z - (a + b * g)) ** 2;
  const vz = szz - (sz * sz) / n;
  return { a, b, r2: vz > 1e-9 ? 1 - ss / vz : 0, rms: Math.sqrt(ss / n) };
}

/**
 * Prova a trasformare i grigi in metri confrontandoli con la quota vera del servizio in alcuni punti.
 * Non fallisce mai: se qualcosa non torna restituisce {ok:false, motivo}.
 */
export async function calibra({ dati, n, bbox, base, livello, leggiTesto, quanti = 9, r2Min = 0.98 }) {
  if (typeof leggiTesto !== "function") return { ok: false, motivo: "lettura delle quote non disponibile" };
  const punti = scegliPunti(dati, n, quanti);
  if (punti.length < 5) return { ok: false, motivo: "terreno troppo uniforme per confrontare i grigi con le quote" };
  if (punti[punti.length - 1].g - punti[0].g < 20) return { ok: false, motivo: "area troppo piana: pochi livelli di grigio diversi" };
  const px = (bbox[2] - bbox[0]) / n;
  const letture = await Promise.all(punti.map(async (p) => {
    const x = bbox[0] + (p.c + 0.5) * px, y = bbox[3] - (p.r + 0.5) * px;
    try {
      const z = leggiQuotaGfi(await leggiTesto(urlQuota(base, livello, x, y)));
      return z == null ? null : { g: p.g, z };
    } catch { return null; }
  }));
  const coppie = letture.filter(Boolean);
  if (coppie.length < 5) return { ok: false, motivo: `il servizio ha dato la quota in ${coppie.length} punti su ${punti.length}` };
  const { a, b, r2, rms } = regressione(coppie);
  if (!(Math.abs(b) > 1e-6)) return { ok: false, motivo: "i grigi non variano con la quota" };
  if (!(r2 >= r2Min)) return { ok: false, motivo: `i grigi non seguono la quota in modo lineare (R² ${r2.toFixed(2)})` };
  return { ok: true, a, b, r2, rms, n: coppie.length };
}

// ------------------------------------------------------------------ metadati per l'analisi

/** Metadati compatibili con estraiGriglia (raster.js) per una griglia in Web Mercator in memoria. */
export function metaDaPixel({ dati, w, h, bbox, nome, relativo = true, passoM = null, avvisi = [] }) {
  const meta = {
    nome, tipo: "servizio", epsg: 3857, relativo, passoM, avvisi,
    proiezione: creaProiezione(3857), larghezza: w, altezza: h,
    origine: { x: bbox[0], y: bbox[3] },
    pixel: { dx: (bbox[2] - bbox[0]) / w, dy: (bbox[3] - bbox[1]) / h },
  };
  meta.leggiFinestra = async (x0, y0, ww, hh, { k = 1 } = {}) => {
    const ow = Math.floor(ww / k), oh = Math.floor(hh / k);
    const out = new Float32Array(ow * oh);
    for (let r = 0; r < oh; r++) {
      for (let c = 0; c < ow; c++) {
        let s = 0, q = 0;
        for (let dy = 0; dy < k; dy++) {
          for (let dx = 0; dx < k; dx++) {
            const v = dati[(y0 + r * k + dy) * w + x0 + c * k + dx];
            if (v === v) { s += v; q++; }
          }
        }
        out[r * ow + c] = q === k * k ? s / q : NaN;
      }
    }
    return { dati: out, w: ow, h: oh };
  };
  return completaMeta(meta);
}

// ------------------------------------------------------------------ rete

const daBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const clienteNativo = (win) => (win.Capacitor?.isNativePlatform?.() ? win.Capacitor.Plugins?.CapacitorHttp : null);
const MSG_CORS = "Da una pagina web non riesco a leggere i pixel del servizio del Ministero (il browser non lo consente). Usa l'app Android oppure imposta il proxy nel pannello Livelli.";

/** Testo di una risposta, senza tag, abbreviato per essere mostrato all'utente. */
const breve = (byte) => new TextDecoder().decode(byte.slice(0, 700)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);

/**
 * Scarica un'immagine e ne restituisce i pixel. Nell'app Android usa il client HTTP nativo (nessun
 * blocco CORS, anche in http); da una pagina web serve un servizio che consenta la lettura (proxy).
 * Se il servizio risponde con un messaggio di errore invece che con un'immagine, lo riporta.
 */
export async function scaricaImmagine(url, { win = globalThis, timeoutMs = 90000 } = {}) {
  const http = clienteNativo(win);
  let byte, tipo;
  if (http?.get) {
    let r;
    try {
      r = await http.get({ url, responseType: "blob", connectTimeout: 20000, readTimeout: timeoutMs });
    } catch (e) {
      throw new ErroreServizio(`Il servizio non risponde (${e?.message ?? "rete"}).`);
    }
    tipo = String(r.headers?.["Content-Type"] ?? r.headers?.["content-type"] ?? "");
    byte = typeof r.data === "string" ? daBase64(r.data) : new Uint8Array(0);
    if (r.status !== 200) throw new ErroreServizio(`Il servizio ha risposto ${r.status}${byte.length ? ": " + breve(byte) : ""}.`);
  } else {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await win.fetch(url, { signal: ctrl.signal });
      tipo = r.headers.get("content-type") ?? "";
      byte = new Uint8Array(await r.arrayBuffer());
      if (!r.ok) throw new ErroreServizio(`Il servizio ha risposto ${r.status}.`);
    } catch (e) {
      if (e instanceof ErroreServizio) throw e;
      throw new ErroreServizio(MSG_CORS);
    } finally {
      clearTimeout(t);
    }
  }
  if (!/^image\//i.test(tipo)) {
    const testo = breve(byte);
    throw new ErroreServizio(`Il servizio ha risposto con un messaggio invece che con un'immagine: «${testo || tipo || "risposta vuota"}».`, { dimensione: ERRORE_DIMENSIONE.test(testo) });
  }
  const bmp = await win.createImageBitmap(new Blob([byte], { type: tipo }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const cv = win.document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, rgba: cx.getImageData(0, 0, bmp.width, bmp.height).data };
}

/** Testo di una risposta (per le quote). Stesse regole di scaricaImmagine per rete e CORS. */
export async function scaricaTesto(url, { win = globalThis, timeoutMs = 30000 } = {}) {
  const http = clienteNativo(win);
  if (http?.get) {
    const r = await http.get({ url, responseType: "text", connectTimeout: 15000, readTimeout: timeoutMs });
    if (r.status !== 200) throw new ErroreServizio(`Il servizio ha risposto ${r.status}.`);
    return typeof r.data === "string" ? r.data : JSON.stringify(r.data);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await win.fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new ErroreServizio(`Il servizio ha risposto ${r.status}.`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------------ operazione completa

/**
 * Scarica il LiDAR del servizio attorno al centro, a blocchi sovrapposti che prova di dimensione
 * decrescente se il servizio rifiuta le richieste grandi, e prova a convertire i grigi in metri.
 * `scarica` e `leggiTesto` si sostituiscono nei test.
 * Restituisce {dati, w, h, bbox, nome, relativo, passoM, calibrazione, avvisi, statistiche}.
 */
export async function scaricaFinestra({
  base, livello, lat, lon, raggioM, nome = "LiDAR del servizio", avanzamento = () => {},
  scarica = scaricaImmagine, leggiTesto = scaricaTesto, calibrare = true, latoMax = LATO_MAX, blocchi = BLOCCHI,
}) {
  const { bbox, n, cellaTerraM } = finestra(lat, lon, raggioM, { latoMax });
  const px = (bbox[2] - bbox[0]) / n;
  const avvisi = [];
  if (cellaTerraM > 1.2) avvisi.push(`Pixel da ${cellaTerraM.toFixed(1).replace(".", ",")} m invece di 1 m: per tenere il dettaglio riduci il raggio.`);

  const aBlocchi = async (lato) => {
    const passo = Math.max(1, lato - SOVRAPPOSIZIONE);
    const nb = n <= lato ? 1 : Math.ceil((n - SOVRAPPOSIZIONE) / passo);
    const parti = [];
    let fatti = 0, grigi = 0, validi = 0;
    for (let br = 0; br < nb; br++) {
      for (let bc = 0; bc < nb; bc++) {
        const c0 = bc * passo, r0 = br * passo;
        const c1 = Math.min(n, c0 + lato), r1 = Math.min(n, r0 + lato);
        const bb = [bbox[0] + c0 * px, bbox[3] - r1 * px, bbox[0] + c1 * px, bbox[3] - r0 * px];
        avanzamento(nb === 1 ? "Scarico il LiDAR dal servizio…" : `Scarico il LiDAR dal servizio… (${++fatti} di ${nb * nb})`);
        const im = await scarica(urlGetMap(base, livello, bb, c1 - c0, r1 - r0));
        if (im.w !== c1 - c0 || im.h !== r1 - r0) {
          throw new ErroreServizio(`Il servizio ha restituito un'immagine di ${im.w}×${im.h} pixel invece di ${c1 - c0}×${r1 - r0}.`, { dimensione: true });
        }
        const l = luminanza(im.rgba, im.w, im.h);
        grigi += l.grigi; validi += l.validi;
        parti.push({ dati: l.dati, w: im.w, h: im.h, c0, r0 });
      }
    }
    if (nb === 1) return { dati: parti[0].dati, grigio: validi ? grigi / validi : 0, nb };
    const { dati, correzioni } = unisciBlocchi(parti, n);
    const mosse = correzioni.filter((c) => c.cnt >= 200 && (Math.abs(c.a) > 0.5 || Math.abs(c.g - 1) > 0.02)).length;
    avvisi.push(`L'area è stata scaricata in ${nb * nb} blocchi${mosse ? ` e ${mosse} sono stati riallineati (il servizio adatta i grigi a ogni richiesta)` : " (nessun riallineamento necessario)"}.`);
    return { dati, grigio: validi ? grigi / validi : 0, nb };
  };

  let esito = null;
  let ultimoErrore = null;
  for (const lato of blocchi) {
    try {
      esito = await aBlocchi(lato);
      break;
    } catch (e) {
      ultimoErrore = e;
      if (!(e instanceof ErroreServizio && e.dimensione)) throw e;
      avvisi.length = 0;
      if (cellaTerraM > 1.2) avvisi.push(`Pixel da ${cellaTerraM.toFixed(1).replace(".", ",")} m invece di 1 m: per tenere il dettaglio riduci il raggio.`);
    }
  }
  if (!esito) throw ultimoErrore ?? new ErroreServizio("Il servizio non ha restituito l'immagine.");

  const stat = statisticheGriglia(esito.dati);
  if (stat.frazioneValidi < 0.05) throw new ErroreServizio("L'immagine è quasi vuota: il centro è fuori dalla copertura del LiDAR di questo livello. Sposta il centro o scegli un altro livello.");
  if (esito.grigio < 0.9) avvisi.push("L'immagine del servizio è a colori e non in scala di grigi: la luminosità potrebbe non seguire la quota, risultati da prendere con cautela.");
  if (stat.livelli < 24) avvisi.push(`L'immagine ha solo ${stat.livelli} livelli di grigio: i rilievi bassi possono perdersi.`);

  let dati = esito.dati;
  let relativo = true, passoM = null, calibrazione = null;
  if (calibrare) {
    avanzamento("Confronto i grigi con le quote vere del servizio…");
    calibrazione = await calibra({ dati, n, bbox, base, livello, leggiTesto });
    if (calibrazione.ok) {
      const { a, b } = calibrazione;
      const metri = new Float32Array(dati.length);
      for (let i = 0; i < dati.length; i++) metri[i] = dati[i] === dati[i] ? a + b * dati[i] : NaN;
      dati = metri;
      relativo = false;
      passoM = Math.abs(b);
      if (passoM > 0.5) avvisi.push(`Un livello di grigio vale circa ${passoM.toFixed(1).replace(".", ",")} m: i dislivelli sotto 1 m non si distinguono. Un raggio più piccolo può dare passi più fini, se il servizio adatta i grigi all'area.`);
    } else {
      avvisi.push(`Quote non convertite in metri (${calibrazione.motivo}): i valori sono livelli di grigio, relativi. Le forme si leggono, le altezze no.`);
    }
  }
  return { dati, w: n, h: n, bbox, nome, relativo, passoM, calibrazione, avvisi, statistiche: stat };
}
