// Lettura di rilievi (DTM/DSM) in GeoTIFF (classico e BigTIFF) e ASCII Grid, senza librerie.
// Legge solo la finestra richiesta: un file da vari GB non viene mai caricato per intero.
//
// Supportati: strisce e tessere; compressione nessuna, LZW, Deflate, PackBits; predittore 2 e 3;
// interi a 8/16/32 bit e float a 32/64 bit; georeferenziazione con scala+punto o matrice senza rotazione.
// Non supportati (errore chiaro): JPEG nel TIFF, rotazioni, Gauss-Boaga, unità diverse dal metro.

import { creaProiezione, utmDiretta } from "./proj.js";

const DIM_TIPO = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 0, 0, 0, 8, 8, 8];
export const NODATA_MIN = -500; // sotto questa quota (m) il valore non è un terreno reale
export const NODATA_MAX = 9000;

export class ErroreRaster extends Error {}

// ------------------------------------------------------------ decompressione

export function decodificaPackBits(src, attesi) {
  const out = new Uint8Array(attesi);
  let i = 0, o = 0;
  while (i < src.length && o < attesi) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) {
      const c = n + 1;
      for (let k = 0; k < c && o < attesi; k++) out[o++] = src[i++];
    } else if (n !== -128) {
      const c = 1 - n, v = src[i++];
      for (let k = 0; k < c && o < attesi; k++) out[o++] = v;
    }
  }
  return out;
}

/** LZW del TIFF (codici da 9 a 12 bit, MSB per primo, cambio di larghezza anticipato). */
export function decodificaLZW(src, attesi) {
  const out = new Uint8Array(attesi);
  const prefisso = new Int32Array(4096);
  const suffisso = new Uint8Array(4096);
  const lunghezza = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) { suffisso[i] = i; lunghezza[i] = 1; prefisso[i] = -1; }
  let prossimo = 258, larghezza = 9, bitBuf = 0, bitN = 0, pos = 0, o = 0, prec = -1;
  const leggi = () => {
    while (bitN < larghezza) {
      if (pos >= src.length) return 257;
      bitBuf = ((bitBuf << 8) | src[pos++]) >>> 0;
      bitN += 8;
    }
    const code = (bitBuf >>> (bitN - larghezza)) & ((1 << larghezza) - 1);
    bitN -= larghezza;
    bitBuf &= (1 << bitN) - 1;
    return code;
  };
  const scrivi = (code) => {
    const len = lunghezza[code];
    let c = code;
    for (let k = len - 1; k >= 0; k--) {
      if (o + k < attesi) out[o + k] = suffisso[c];
      c = prefisso[c];
    }
    o += len;
    return len;
  };
  const primo = (code) => {
    let c = code;
    while (prefisso[c] !== -1) c = prefisso[c];
    return suffisso[c];
  };
  while (o < attesi) {
    const code = leggi();
    if (code === 257) break;
    if (code === 256) {
      prossimo = 258; larghezza = 9; prec = -1;
      continue;
    }
    if (prec === -1) {
      if (code > 255) throw new ErroreRaster("Dati LZW non validi.");
      scrivi(code);
      prec = code;
      continue;
    }
    if (code < prossimo) {
      scrivi(code);
      if (prossimo < 4096) { prefisso[prossimo] = prec; suffisso[prossimo] = primo(code); lunghezza[prossimo] = lunghezza[prec] + 1; prossimo++; }
    } else if (code === prossimo && prossimo < 4096) {
      prefisso[prossimo] = prec; suffisso[prossimo] = primo(prec); lunghezza[prossimo] = lunghezza[prec] + 1; prossimo++;
      scrivi(code);
    } else {
      throw new ErroreRaster("Dati LZW non validi.");
    }
    prec = code;
    if (prossimo >= 511 && larghezza === 9) larghezza = 10;
    else if (prossimo >= 1023 && larghezza === 10) larghezza = 11;
    else if (prossimo >= 2047 && larghezza === 11) larghezza = 12;
  }
  return out;
}

async function inflate(src) {
  const flusso = new Blob([src]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(flusso).arrayBuffer());
}

/** Annulla il predittore a virgola mobile (3): i byte di ogni riga sono divisi in piani, MSB per primo. */
export function annullaPredittoreFloat(buf, righe, campioniPerRiga, byteCampione, passo, littleEndian) {
  const bytesRiga = campioniPerRiga * byteCampione;
  const tmp = new Uint8Array(bytesRiga);
  for (let r = 0; r < righe; r++) {
    const base = r * bytesRiga;
    for (let i = passo; i < bytesRiga; i++) buf[base + i] = (buf[base + i] + buf[base + i - passo]) & 255;
    tmp.set(buf.subarray(base, base + bytesRiga));
    const n = campioniPerRiga / passo;
    for (let c = 0; c < campioniPerRiga; c++) {
      for (let b = 0; b < byteCampione; b++) {
        const dest = littleEndian ? byteCampione - 1 - b : b;
        buf[base + c * byteCampione + dest] = tmp[b * (campioniPerRiga) + c];
      }
    }
    void n;
  }
  return buf;
}

// ------------------------------------------------------------ lettura IFD

async function leggiBytes(blob, da, n) {
  if (da + n > blob.size) throw new ErroreRaster("Il file è troncato o danneggiato.");
  return new DataView(await blob.slice(da, da + n).arrayBuffer());
}

function leggiNumero(dv, off, tipo, le) {
  switch (tipo) {
    case 1: case 7: return dv.getUint8(off);
    case 6: return dv.getInt8(off);
    case 3: return dv.getUint16(off, le);
    case 8: return dv.getInt16(off, le);
    case 4: return dv.getUint32(off, le);
    case 9: return dv.getInt32(off, le);
    case 11: return dv.getFloat32(off, le);
    case 12: return dv.getFloat64(off, le);
    case 16: case 18: return Number(dv.getBigUint64(off, le));
    case 17: return Number(dv.getBigInt64(off, le));
    default: return NaN;
  }
}

async function leggiIFD(blob, big, le) {
  const intest = await leggiBytes(blob, 0, 16);
  let off = big ? Number(intest.getBigUint64(8, le)) : intest.getUint32(4, le);
  const nCampo = big ? 8 : 2, dimVoce = big ? 20 : 12, dimInline = big ? 8 : 4;
  const testa = await leggiBytes(blob, off, nCampo);
  const n = big ? Number(testa.getBigUint64(0, le)) : testa.getUint16(0, le);
  const voci = await leggiBytes(blob, off + nCampo, n * dimVoce);
  const tag = {};
  for (let i = 0; i < n; i++) {
    const p = i * dimVoce;
    const id = voci.getUint16(p, le);
    const tipo = voci.getUint16(p + 2, le);
    const conteggio = big ? Number(voci.getBigUint64(p + 4, le)) : voci.getUint32(p + 4, le);
    const pv = p + (big ? 12 : 8);
    const dim = (DIM_TIPO[tipo] || 0) * conteggio;
    if (!dim) continue;
    let dv, base;
    if (dim <= dimInline) { dv = voci; base = pv; }
    else {
      const o2 = big ? Number(voci.getBigUint64(pv, le)) : voci.getUint32(pv, le);
      dv = await leggiBytes(blob, o2, dim);
      base = 0;
    }
    if (tipo === 2) {
      let s = "";
      for (let k = 0; k < conteggio; k++) { const c = dv.getUint8(base + k); if (c === 0) break; s += String.fromCharCode(c); }
      tag[id] = s;
    } else if (tipo === 5 || tipo === 10) {
      tag[id] = Array.from({ length: conteggio }, (_, k) => dv.getUint32(base + k * 8, le) / dv.getUint32(base + k * 8 + 4, le));
    } else {
      const sz = DIM_TIPO[tipo];
      tag[id] = Array.from({ length: conteggio }, (_, k) => leggiNumero(dv, base + k * sz, tipo, le));
    }
  }
  return tag;
}

function leggiGeo(tag) {
  const out = { epsg: null, puntoPixel: false, unitaMetri: true, modello: null };
  const dir = tag[34735];
  if (dir && dir.length >= 4) {
    const nChiavi = dir[3];
    for (let i = 0; i < nChiavi; i++) {
      const [id, loc, , val] = dir.slice(4 + i * 4, 8 + i * 4);
      if (loc !== 0) continue;
      if (id === 1024) out.modello = val;
      else if (id === 1025) out.puntoPixel = val === 2;
      else if (id === 2048 && val !== 32767 && !out.epsg) out.epsg = val;
      else if (id === 3072 && val !== 32767) out.epsg = val;
      else if (id === 3076 && val !== 9001) out.unitaMetri = false;
    }
  }
  return out;
}

// ----------------------------------------------------------------- rilievo

/**
 * Apre un rilievo da un File/Blob. `opzioni.epsg` serve per i file senza georeferenziazione (ASCII Grid).
 * Restituisce un oggetto con i metadati e il metodo `leggiFinestra`.
 */
export async function apriRilievo(file, opzioni = {}) {
  const nome = String(file.name ?? "").toLowerCase();
  if (/\.(asc|txt|grd)$/.test(nome)) return apriAscii(file, opzioni);
  return apriTiff(file, opzioni);
}

async function apriTiff(blob, opzioni) {
  if (blob.size < 16) throw new ErroreRaster("Il file è troppo piccolo per essere un GeoTIFF.");
  const intest = await leggiBytes(blob, 0, 16);
  const ordine = String.fromCharCode(intest.getUint8(0), intest.getUint8(1));
  if (ordine !== "II" && ordine !== "MM") throw new ErroreRaster("Il file non è un TIFF. Usa un GeoTIFF (.tif) o un ASCII Grid (.asc).");
  const le = ordine === "II";
  const magic = intest.getUint16(2, le);
  if (magic !== 42 && magic !== 43) throw new ErroreRaster("Il file non è un TIFF valido.");
  const big = magic === 43;
  const tag = await leggiIFD(blob, big, le);

  const W = tag[256]?.[0], H = tag[257]?.[0];
  if (!W || !H) throw new ErroreRaster("Il TIFF non indica le dimensioni dell'immagine.");
  const bps = tag[258]?.[0] ?? 8;
  const spp = tag[277]?.[0] ?? 1;
  const comp = tag[259]?.[0] ?? 1;
  const formato = tag[339]?.[0] ?? 1;
  const predittore = tag[317]?.[0] ?? 1;
  const planare = tag[284]?.[0] ?? 1;
  if (![1, 5, 8, 32946, 32773].includes(comp)) {
    throw new ErroreRaster(`Compressione TIFF non supportata (codice ${comp}). Riesporta il file senza compressione, con LZW o con Deflate (ad esempio con QGIS).`);
  }
  const valido = (formato === 3 && (bps === 32 || bps === 64)) || ((formato === 1 || formato === 2) && [8, 16, 32].includes(bps));
  if (!valido) throw new ErroreRaster(`Formato dei valori non supportato (${bps} bit, tipo ${formato}).`);

  const tessere = !!tag[322];
  const bw = tessere ? tag[322][0] : W;
  const bh = tessere ? tag[323][0] : Math.min(tag[278]?.[0] ?? H, H);
  const offsets = tessere ? tag[324] : tag[273];
  const conteggi = tessere ? tag[325] : tag[279];
  if (!offsets || !conteggi) throw new ErroreRaster("Il TIFF non contiene i dati dell'immagine.");
  const blocchiX = Math.ceil(W / bw), blocchiY = Math.ceil(H / bh);

  // Georeferenziazione
  const geo = leggiGeo(tag);
  let origine, pixel;
  if (tag[34264] && tag[34264].length >= 16) {
    const m = tag[34264];
    if (Math.abs(m[1]) > 1e-12 || Math.abs(m[4]) > 1e-12) throw new ErroreRaster("Il rilievo è ruotato: non supportato. Riproiettalo con QGIS.");
    origine = { x: m[3], y: m[7] };
    pixel = { dx: Math.abs(m[0]), dy: Math.abs(m[5]) };
  } else if (tag[33550] && tag[33922]) {
    const [sx, sy] = tag[33550];
    const [i, j, , x, y] = tag[33922];
    origine = { x: x - i * sx, y: y + j * sy };
    pixel = { dx: sx, dy: sy };
  } else if (opzioni.epsg && opzioni.origine && opzioni.pixel) {
    origine = opzioni.origine;
    pixel = opzioni.pixel;
  } else {
    throw new ErroreRaster("Il TIFF non è georeferenziato (mancano i tag GeoTIFF). Esportalo da QGIS come GeoTIFF.");
  }
  if (geo.puntoPixel) { origine = { x: origine.x - pixel.dx / 2, y: origine.y + pixel.dy / 2 }; }
  const epsg = geo.epsg ?? opzioni.epsg ?? null;
  if (!geo.unitaMetri) throw new ErroreRaster("Unità di misura diverse dal metro: non supportate.");
  if (!epsg) throw new ErroreRaster("Non riesco a leggere il sistema di coordinate del file. Riesportalo in UTM WGS84 (EPSG:32632 o 32633) da QGIS.");
  const proiezione = creaProiezione(epsg);
  if (!proiezione) {
    throw new ErroreRaster(`Sistema di coordinate EPSG:${epsg} non supportato. Sono supportati UTM WGS84/ETRS89 (326xx, 258xx), WGS84 (4326) e Web Mercator. Per Gauss-Boaga riproietta il file in UTM 32N (EPSG:32632) con QGIS.`);
  }
  let nodata = null;
  if (tag[42113] != null) {
    const v = parseFloat(String(tag[42113]));
    nodata = Number.isFinite(v) || /nan/i.test(String(tag[42113])) ? v : null;
  }

  const meta = {
    tipo: "tiff", larghezza: W, altezza: H, bande: spp, bitPerCampione: bps, formato, compressione: comp, predittore,
    origine, pixel, epsg, proiezione, nodata, tessere, nome: blob.name ?? "",
  };

  const byteCamp = bps / 8;
  const campioniPerPixel = planare === 1 ? spp : 1;

  async function decodificaBlocco(idx, banda) {
    const iBlocco = planare === 2 ? banda * blocchiX * blocchiY + idx : idx;
    const off = offsets[iBlocco], len = conteggi[iBlocco];
    const bx = idx % blocchiX, by = Math.floor(idx / blocchiX);
    const larg = tessere ? bw : W;
    const alt = tessere ? bh : Math.min(bh, H - by * bh);
    const campioni = larg * alt * campioniPerPixel;
    const attesi = campioni * byteCamp;
    const compresso = new Uint8Array(await blob.slice(off, off + len).arrayBuffer());
    let dati;
    if (comp === 1) dati = compresso.length >= attesi ? compresso.slice(0, attesi) : Object.assign(new Uint8Array(attesi), compresso);
    else if (comp === 5) dati = decodificaLZW(compresso, attesi);
    else if (comp === 8 || comp === 32946) dati = await inflate(compresso);
    else dati = decodificaPackBits(compresso, attesi);
    if (dati.length < attesi) dati = Object.assign(new Uint8Array(attesi), dati);
    else if (dati.length > attesi) dati = dati.subarray(0, attesi);
    if (predittore === 3) {
      dati = dati.slice();
      annullaPredittoreFloat(dati, alt, larg * campioniPerPixel, byteCamp, campioniPerPixel, le);
    }
    // Conversione in array tipizzato (endianness del file)
    const copia = dati.byteOffset === 0 && dati.byteLength === dati.buffer.byteLength ? dati.buffer : dati.slice().buffer;
    let arr;
    const TIPI = { "1_8": Uint8Array, "2_8": Int8Array, "1_16": Uint16Array, "2_16": Int16Array, "1_32": Uint32Array, "2_32": Int32Array, "3_32": Float32Array, "3_64": Float64Array };
    const T = TIPI[`${formato}_${bps}`];
    if (le) arr = new T(copia);
    else {
      const dv = new DataView(copia);
      arr = new T(campioni);
      for (let i = 0; i < campioni; i++) {
        arr[i] = bps === 8 ? (formato === 2 ? dv.getInt8(i) : dv.getUint8(i)) :
          bps === 16 ? (formato === 2 ? dv.getInt16(i * 2, false) : dv.getUint16(i * 2, false)) :
          bps === 32 ? (formato === 3 ? dv.getFloat32(i * 4, false) : formato === 2 ? dv.getInt32(i * 4, false) : dv.getUint32(i * 4, false)) :
          dv.getFloat64(i * 8, false);
      }
    }
    if (predittore === 2) {
      const ps = campioniPerPixel;
      for (let r = 0; r < alt; r++) {
        const b = r * larg * ps;
        for (let i = ps; i < larg * ps; i++) arr[b + i] = arr[b + i] + arr[b + i - ps];
      }
    }
    return { arr, larg, alt, bx, by };
  }

  /**
   * Legge la finestra [x0,x0+w)×[y0,y0+h) della banda indicata, ridotta per media di blocchi k×k.
   * Restituisce {dati: Float32Array (NaN dove manca il terreno), w, h}.
   */
  meta.leggiFinestra = async (x0, y0, w, h, { k = 1, banda = 0 } = {}) => {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    w = Math.min(W - x0, Math.floor(w)); h = Math.min(H - y0, Math.floor(h));
    if (w <= 0 || h <= 0) throw new ErroreRaster("La finestra richiesta è fuori dal rilievo.");
    const ow = Math.ceil(w / k), oh = Math.ceil(h / k);
    const somma = new Float32Array(ow * oh), cnt = new Uint16Array(ow * oh);
    const bxA = Math.floor(x0 / bw), bxB = Math.floor((x0 + w - 1) / bw);
    const byA = Math.floor(y0 / bh), byB = Math.floor((y0 + h - 1) / bh);
    for (let by = byA; by <= byB; by++) {
      for (let bx = bxA; bx <= bxB; bx++) {
        const blk = await decodificaBlocco(by * blocchiX + bx, banda);
        const colI = bx * bw, rigaI = by * bh;
        const cA = Math.max(x0, colI), cB = Math.min(x0 + w, colI + blk.larg, W);
        const rA = Math.max(y0, rigaI), rB = Math.min(y0 + h, rigaI + blk.alt, H);
        for (let r = rA; r < rB; r++) {
          const oy = Math.floor((r - y0) / k);
          for (let c = cA; c < cB; c++) {
            const v = blk.arr[((r - rigaI) * blk.larg + (c - colI)) * campioniPerPixel + (planare === 1 ? banda : 0)];
            if (v === nodata || !(v >= NODATA_MIN && v <= NODATA_MAX)) continue;
            const o = oy * ow + Math.floor((c - x0) / k);
            somma[o] += v;
            cnt[o]++;
          }
        }
      }
    }
    const dati = new Float32Array(ow * oh);
    for (let i = 0; i < dati.length; i++) dati[i] = cnt[i] ? somma[i] / cnt[i] : NaN;
    return { dati, w: ow, h: oh };
  };
  return completaMeta(meta);
}

async function apriAscii(blob, opzioni) {
  if (blob.size > 300e6) throw new ErroreRaster("Il file ASCII è troppo grande (oltre 300 MB): ritaglialo o convertilo in GeoTIFF.");
  const testo = await blob.text();
  const mHead = {};
  let pos = 0;
  const righe = [];
  while (righe.length < 6) {
    const fine = testo.indexOf("\n", pos);
    const riga = testo.slice(pos, fine < 0 ? undefined : fine).trim();
    const m = /^([A-Za-z_]+)\s+(\S+)$/.exec(riga);
    if (!m) break;
    mHead[m[1].toLowerCase()] = parseFloat(m[2]);
    righe.push(riga);
    pos = fine < 0 ? testo.length : fine + 1;
  }
  const W = mHead.ncols, H = mHead.nrows;
  const cella = mHead.cellsize ?? mHead.dx;
  if (!W || !H || !cella) throw new ErroreRaster("Intestazione ASCII Grid non valida (servono ncols, nrows, cellsize).");
  if (W * H > 60e6) throw new ErroreRaster("Il file ASCII supera i 60 milioni di celle: ritaglialo.");
  const xll = mHead.xllcorner ?? (mHead.xllcenter != null ? mHead.xllcenter - cella / 2 : null);
  const yll = mHead.yllcorner ?? (mHead.yllcenter != null ? mHead.yllcenter - cella / 2 : null);
  if (xll == null || yll == null) throw new ErroreRaster("Intestazione ASCII Grid senza xllcorner/yllcorner.");
  const epsg = opzioni.epsg;
  if (!epsg) throw new ErroreRaster("Per un file ASCII indica il sistema di coordinate (di solito UTM 32N o 33N).");
  const proiezione = creaProiezione(epsg);
  if (!proiezione) throw new ErroreRaster(`Sistema di coordinate EPSG:${epsg} non supportato.`);
  const nodata = mHead.nodata_value ?? -9999;

  const dati = new Float32Array(W * H);
  let n = 0, i = pos;
  const L = testo.length;
  while (n < dati.length && i < L) {
    let c = testo.charCodeAt(i);
    while (i < L && (c === 32 || c === 10 || c === 13 || c === 9)) c = testo.charCodeAt(++i);
    if (i >= L) break;
    const ini = i;
    while (i < L && c !== 32 && c !== 10 && c !== 13 && c !== 9) c = testo.charCodeAt(++i);
    const v = Number(testo.slice(ini, i));
    dati[n++] = v;
  }
  if (n < dati.length) throw new ErroreRaster("Il file ASCII è incompleto: mancano dei valori.");

  const meta = {
    tipo: "asc", larghezza: W, altezza: H, bande: 1, bitPerCampione: 32, formato: 3, compressione: 1, predittore: 1,
    origine: { x: xll, y: yll + H * cella }, pixel: { dx: cella, dy: cella }, epsg, proiezione, nodata, tessere: false, nome: blob.name ?? "",
  };
  meta.leggiFinestra = async (x0, y0, w, h, { k = 1 } = {}) => {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    w = Math.min(W - x0, Math.floor(w)); h = Math.min(H - y0, Math.floor(h));
    if (w <= 0 || h <= 0) throw new ErroreRaster("La finestra richiesta è fuori dal rilievo.");
    const ow = Math.ceil(w / k), oh = Math.ceil(h / k);
    const somma = new Float32Array(ow * oh), cnt = new Uint16Array(ow * oh);
    for (let r = y0; r < y0 + h; r++) {
      const oy = Math.floor((r - y0) / k);
      for (let c = x0; c < x0 + w; c++) {
        const v = dati[r * W + c];
        if (v === nodata || !(v >= NODATA_MIN && v <= NODATA_MAX)) continue;
        const o = oy * ow + Math.floor((c - x0) / k);
        somma[o] += v;
        cnt[o]++;
      }
    }
    const out = new Float32Array(ow * oh);
    for (let q = 0; q < out.length; q++) out[q] = cnt[q] ? somma[q] / cnt[q] : NaN;
    return { dati: out, w: ow, h: oh };
  };
  return completaMeta(meta);
}

/** Aggiunge copertura geografica e dimensione del pixel in metri. */
function completaMeta(meta) {
  const { origine, pixel, larghezza: W, altezza: H, proiezione } = meta;
  const angoli = [[0, 0], [W, 0], [W, H], [0, H]].map(([c, r]) => proiezione.aLatLon(origine.x + c * pixel.dx, origine.y - r * pixel.dy));
  const lats = angoli.map((a) => a[0]), lons = angoli.map((a) => a[1]);
  meta.copertura = { sud: Math.min(...lats), nord: Math.max(...lats), ovest: Math.min(...lons), est: Math.max(...lons) };
  const latC = (meta.copertura.sud + meta.copertura.nord) / 2;
  meta.pixelMetri = proiezione.gradi
    ? { dx: pixel.dx * 111320 * Math.cos((latC * Math.PI) / 180), dy: pixel.dy * 110574 }
    : proiezione.zona ? { dx: pixel.dx, dy: pixel.dy } : { dx: pixel.dx * Math.cos((latC * Math.PI) / 180), dy: pixel.dy * Math.cos((latC * Math.PI) / 180) };
  return meta;
}

// ---------------------------------------------------------- griglia di analisi

/**
 * Estrae dal rilievo una griglia quadrata in metri (UTM) attorno a (lat, lon), entro raggioM.
 * Se il rilievo è in gradi o Web Mercator, o ha pixel non quadrati, viene ricampionato.
 * Se i pixel sono troppi, riduce la risoluzione per media di blocchi (k×k) e lo segnala.
 */
export async function estraiGriglia(meta, lat, lon, raggioM, { maxPixel = 6e6 } = {}) {
  const P = meta.proiezione;
  const nativo = !!P.zona && Math.abs(meta.pixel.dx - meta.pixel.dy) / meta.pixel.dx < 0.01;
  const avvisi = [];
  if (nativo) {
    const [X, Y] = P.daLatLon(lat, lon);
    const col = (X - meta.origine.x) / meta.pixel.dx, riga = (meta.origine.y - Y) / meta.pixel.dy;
    const rpx = raggioM / meta.pixel.dx;
    const x0 = Math.max(0, Math.floor(col - rpx)), x1 = Math.min(meta.larghezza, Math.ceil(col + rpx));
    const y0 = Math.max(0, Math.floor(riga - rpx)), y1 = Math.min(meta.altezza, Math.ceil(riga + rpx));
    if (x1 - x0 < 8 || y1 - y0 < 8) throw new ErroreRaster("Il centro è fuori dalla copertura del rilievo.");
    const k = Math.max(1, Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / maxPixel)));
    if (k > 1) avvisi.push(`Rilievo a ${(meta.pixel.dx * k).toFixed(1).replace(".", ",")} m invece di ${meta.pixel.dx.toFixed(1).replace(".", ",")} m: per tenere il dettaglio riduci il raggio.`);
    const f = await meta.leggiFinestra(x0, y0, x1 - x0, y1 - y0, { k });
    return {
      dati: f.dati, w: f.w, h: f.h, cella: meta.pixel.dx * k,
      origine: { x: meta.origine.x + x0 * meta.pixel.dx, y: meta.origine.y - y0 * meta.pixel.dy },
      proiezione: P, avvisi, k,
    };
  }
  // Ricampionamento in una griglia UTM locale
  const zona = Math.floor((lon + 180) / 6) + 1;
  const sud = lat < 0;
  const epsgUtm = (sud ? 32700 : 32600) + zona;
  const U = creaProiezione(epsgUtm);
  const cella0 = Math.max(0.5, Math.round(Math.min(meta.pixelMetri.dx, meta.pixelMetri.dy) * 10) / 10);
  const [ux, uy] = U.daLatLon(lat, lon);
  const n0 = Math.ceil((2 * raggioM) / cella0);
  const k = Math.max(1, Math.ceil(Math.sqrt((n0 * n0) / maxPixel)));
  const cella = cella0 * k;
  const n = Math.ceil((2 * raggioM) / cella);
  const origine = { x: ux - (n * cella) / 2, y: uy + (n * cella) / 2 };
  // finestra sorgente che copre l'area
  const angoli = [[0, 0], [n, 0], [n, n], [0, n]].map(([c, r]) => P.daLatLon(...U.aLatLon(origine.x + c * cella, origine.y - r * cella)));
  const colS = angoli.map((a) => (a[0] - meta.origine.x) / meta.pixel.dx), rigS = angoli.map((a) => (meta.origine.y - a[1]) / meta.pixel.dy);
  const sx0 = Math.max(0, Math.floor(Math.min(...colS)) - 2), sx1 = Math.min(meta.larghezza, Math.ceil(Math.max(...colS)) + 2);
  const sy0 = Math.max(0, Math.floor(Math.min(...rigS)) - 2), sy1 = Math.min(meta.altezza, Math.ceil(Math.max(...rigS)) + 2);
  if (sx1 - sx0 < 4 || sy1 - sy0 < 4) throw new ErroreRaster("Il centro è fuori dalla copertura del rilievo.");
  const ks = Math.max(1, Math.floor(cella / Math.max(meta.pixelMetri.dx, meta.pixelMetri.dy)));
  const f = await meta.leggiFinestra(sx0, sy0, sx1 - sx0, sy1 - sy0, { k: Math.min(ks, 4) });
  const kk = Math.min(ks, 4);
  const dati = new Float32Array(n * n).fill(NaN);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const [la, lo] = U.aLatLon(origine.x + (c + 0.5) * cella, origine.y - (r + 0.5) * cella);
      const [X, Y] = P.daLatLon(la, lo);
      const fx = ((X - meta.origine.x) / meta.pixel.dx - sx0) / kk - 0.5;
      const fy = ((meta.origine.y - Y) / meta.pixel.dy - sy0) / kk - 0.5;
      const i0 = Math.floor(fx), j0 = Math.floor(fy);
      if (i0 < 0 || j0 < 0 || i0 + 1 >= f.w || j0 + 1 >= f.h) continue;
      const tx = fx - i0, ty = fy - j0;
      const a = f.dati[j0 * f.w + i0], b = f.dati[j0 * f.w + i0 + 1], cc = f.dati[(j0 + 1) * f.w + i0], d = f.dati[(j0 + 1) * f.w + i0 + 1];
      if (!(a === a && b === b && cc === cc && d === d)) continue;
      dati[r * n + c] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + cc * (1 - tx) * ty + d * tx * ty;
    }
  }
  avvisi.push("Rilievo ricampionato in UTM: la precisione dei bordi è ridotta rispetto al file originale.");
  if (k > 1) avvisi.push(`Risoluzione ridotta a ${cella.toFixed(1).replace(".", ",")} m: per tenere il dettaglio riduci il raggio.`);
  return { dati, w: n, h: n, cella, origine, proiezione: U, avvisi, k };
}

export { utmDiretta };
