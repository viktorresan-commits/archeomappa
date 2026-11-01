// Quote del terreno per la vista 3D: lettura del GeoTIFF di TINITALY, ricampionamento sulla tessera
// della mappa, riempimento dei vuoti e codifica «Terrarium» (quote in un'immagine RGB) che MapLibre legge.
// Nessun accesso a DOM o rete: tutto verificabile con prove in Node.
//
// Fatti misurati sul servizio (1° novembre 2026, vedi README):
//  - il WCS 1.0.0 di TINITALY risponde un GeoTIFF float32 a quote vere (m), senza compressione, big-endian,
//    a blocchi («tile») da una sola tessera; i pixel senza dato valgono -9999 (tag GDAL_NODATA);
//  - l'estensione della risposta NON coincide con la richiesta: con 384 px su una tessera z13 il passo era
//    13,92 m invece di 12,74 m (+9 %), e una fascia di pochi pixel sul bordo esterno è «senza dato».
//    Per questo non si può assumere che il file copra la tessera chiesta: si legge la georeferenziazione
//    dal file e si ricampiona.

export const SENZA_DATO = -9999;
const QUOTA_MIN = -1000; // sotto questa quota un valore è «senza dato» (nessun luogo d'Italia è così basso)
const QUOTA_MAX = 9000;
export const ZOOM_MIN_TINITALY = 12; // più in alto (tessere più grandi) basta la tessera mondiale
export const PIXEL_TESSERA = 384; // 384 px su una tessera z13 sono ~9,3 m/px: il passo nativo di TINITALY è 10 m
export const MARGINE_RICHIESTA = 0.04; // si chiede il 4 % in più per lato: i bordi della tessera restano dentro
export const ITALIA = { ovest: 6.5, sud: 35.3, est: 18.8, nord: 47.2 }; // riquadro largo: fuori da qui non si interroga TINITALY
export const WCS_TINITALY = "https://tinitaly.pi.ingv.it/TINItaly_1_1/wcs";
export const URL_TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

const M = 20037508.342789244; // metà della circonferenza in Web Mercator

export class ErroreDem extends Error {}

export const quotaValida = (v) => Number.isFinite(v) && v > QUOTA_MIN && v < QUOTA_MAX;

// ------------------------------------------------------------------------------ geometria delle tessere

/** Estensione {ovest, sud, est, nord} in metri Web Mercator della tessera z/x/y. */
export function bboxTessera(z, x, y) {
  const s = (2 * M) / 2 ** z;
  return { ovest: -M + x * s, sud: M - (y + 1) * s, est: -M + (x + 1) * s, nord: M - y * s };
}

export const allarga = (b, f) => {
  const dx = (b.est - b.ovest) * f, dy = (b.nord - b.sud) * f;
  return { ovest: b.ovest - dx, sud: b.sud - dy, est: b.est + dx, nord: b.nord + dy };
};

const mercatoreInGradi = (mx, my) => ({ lon: (mx / M) * 180, lat: (Math.atan(Math.exp((my / M) * Math.PI)) * 360) / Math.PI - 90 });

/** Vero se la tessera non tocca il riquadro dell'Italia (allora TINITALY non ha nulla da dare). */
export function fuoriItalia(z, x, y) {
  const b = bboxTessera(z, x, y);
  const a = mercatoreInGradi(b.ovest, b.sud), c = mercatoreInGradi(b.est, b.nord);
  return c.lon < ITALIA.ovest || a.lon > ITALIA.est || c.lat < ITALIA.sud || a.lat > ITALIA.nord;
}

/** Quale fonte di quote usare per una tessera: «tinitaly» (10 m, se in Italia e abbastanza vicina) o «terrarium» (mondiale, ~30 m). */
export const qualeFonte = (z, x, y) => (z >= ZOOM_MIN_TINITALY && !fuoriItalia(z, x, y) ? "tinitaly" : "terrarium");

/** Indirizzo della richiesta WCS 1.0.0 per una tessera, con un po' di margine per lato. */
export function urlWcsTinitaly(z, x, y, { px = PIXEL_TESSERA, margine = MARGINE_RICHIESTA, base = WCS_TINITALY } = {}) {
  const b = allarga(bboxTessera(z, x, y), margine);
  const n = Math.round(px * (1 + 2 * margine));
  const bb = [b.ovest, b.sud, b.est, b.nord].map((v) => v.toFixed(3)).join(",");
  return `${base}?service=WCS&version=1.0.0&request=GetCoverage&coverage=TINItaly_1_1:tinitaly_dem&crs=EPSG:3857&bbox=${bb}&width=${n}&height=${n}&format=GeoTIFF`;
}

export const urlTerrarium = (z, x, y, modello = URL_TERRARIUM) => modello.replace("{z}", z).replace("{x}", x).replace("{y}", y);

// ------------------------------------------------------------------------------ lettura del GeoTIFF

const DIM_TIPO = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

/**
 * Legge un GeoTIFF a un solo canale, senza compressione, a strisce o a blocchi, con campioni float32 (anche 8/16/32 bit interi).
 * Restituisce {larghezza, altezza, dati: Float32Array, georef: {x0, y0, dx, dy} | null, nodata}.
 * georef: coordinate dell'angolo in alto a sinistra del primo pixel e passo (dy negativo: le righe scendono verso sud).
 */
export function leggiGeoTiff(buffer) {
  const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  if (ab.byteLength < 16) throw new ErroreDem("risposta troppo corta per essere un'immagine TIFF");
  const dv = new DataView(ab);
  const b0 = dv.getUint8(0), b1 = dv.getUint8(1);
  const le = b0 === 0x49 && b1 === 0x49;
  if (!le && !(b0 === 0x4d && b1 === 0x4d)) throw new ErroreDem("la risposta non è un'immagine TIFF");
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  if (u16(2) !== 42) throw new ErroreDem("TIFF di tipo non supportato (BigTIFF)");
  const ifd = u32(4);
  const n = u16(ifd);
  const T = {};
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e), tipo = u16(e + 2), conta = u32(e + 4);
    const dim = DIM_TIPO[tipo] ?? 1;
    const o = dim * conta <= 4 ? e + 8 : u32(e + 8);
    if (tipo === 2) {
      let s = "";
      for (let k = 0; k < conta; k++) { const c = dv.getUint8(o + k); if (c) s += String.fromCharCode(c); }
      T[tag] = s;
      continue;
    }
    const v = new Array(conta);
    for (let k = 0; k < conta; k++) {
      const p = o + k * dim;
      v[k] = tipo === 3 ? u16(p) : tipo === 4 ? u32(p) : tipo === 11 ? dv.getFloat32(p, le) : tipo === 12 ? dv.getFloat64(p, le) : tipo === 1 || tipo === 7 ? dv.getUint8(p) : tipo === 8 ? dv.getInt16(p, le) : tipo === 9 ? dv.getInt32(p, le) : u32(p);
    }
    T[tag] = v;
  }
  const w = T[256]?.[0], h = T[257]?.[0];
  if (!(w > 0 && h > 0)) throw new ErroreDem("TIFF senza dimensioni");
  const bit = T[258]?.[0] ?? 8, formato = T[339]?.[0] ?? 1, campioni = T[277]?.[0] ?? 1;
  if ((T[259]?.[0] ?? 1) !== 1) throw new ErroreDem("TIFF compresso: non supportato");
  if (campioni !== 1) throw new ErroreDem("TIFF con più canali: non supportato");
  if ((T[284]?.[0] ?? 1) !== 1) throw new ErroreDem("TIFF a piani separati: non supportato");
  const leggi = formato === 3 && bit === 32 ? (o) => dv.getFloat32(o, le)
    : formato === 3 && bit === 64 ? (o) => dv.getFloat64(o, le)
    : formato === 2 && bit === 16 ? (o) => dv.getInt16(o, le)
    : formato === 2 && bit === 32 ? (o) => dv.getInt32(o, le)
    : formato === 1 && bit === 16 ? (o) => dv.getUint16(o, le)
    : formato === 1 && bit === 8 ? (o) => dv.getUint8(o)
    : null;
  if (!leggi) throw new ErroreDem(`TIFF con campioni da ${bit} bit (formato ${formato}): non supportato`);
  const byte = bit / 8;
  const dati = new Float32Array(w * h);
  if (T[324] && T[325]) { // a blocchi
    const tw = T[322]?.[0], th = T[323]?.[0];
    if (!(tw > 0 && th > 0)) throw new ErroreDem("TIFF a blocchi senza dimensioni dei blocchi");
    const perRiga = Math.ceil(w / tw);
    T[324].forEach((off, t) => {
      const c0 = (t % perRiga) * tw, r0 = Math.floor(t / perRiga) * th;
      for (let r = 0; r < th && r0 + r < h; r++) for (let c = 0; c < tw && c0 + c < w; c++) dati[(r0 + r) * w + c0 + c] = leggi(off + (r * tw + c) * byte);
    });
  } else if (T[273]) { // a strisce
    const rps = T[278]?.[0] && T[278][0] < h ? T[278][0] : h;
    T[273].forEach((off, s) => {
      const r0 = s * rps;
      for (let r = 0; r < rps && r0 + r < h; r++) for (let c = 0; c < w; c++) dati[(r0 + r) * w + c] = leggi(off + (r * w + c) * byte);
    });
  } else throw new ErroreDem("TIFF senza dati");
  // georeferenziazione
  let georef = null;
  const m = T[34264], scala = T[33550], punto = T[33922];
  if (m?.length >= 8) georef = { x0: m[3], y0: m[7], dx: m[0], dy: m[5] };
  else if (scala?.length >= 2 && punto?.length >= 6) {
    georef = { x0: punto[3] - punto[0] * scala[0], y0: punto[4] + punto[1] * scala[1], dx: scala[0], dy: -scala[1] };
  }
  if (georef && T[34735]) { // GTRasterTypeGeoKey (1025) = 2 (PixelIsPoint): il tiepoint è al centro del pixel
    const g = T[34735];
    for (let i = 4; i + 3 < g.length; i += 4) if (g[i] === 1025 && g[i + 3] === 2) { georef.x0 -= georef.dx / 2; georef.y0 -= georef.dy / 2; }
  }
  const nodata = T[42113] != null ? parseFloat(T[42113]) : SENZA_DATO;
  return { larghezza: w, altezza: h, dati, georef, nodata: Number.isFinite(nodata) ? nodata : SENZA_DATO };
}

// ------------------------------------------------------------------------------ ricampionamento

/**
 * Ricampiona un raster georeferenziato sui centri dei w×h pixel dell'estensione bbox (metri Web Mercator).
 * Interpolazione bilineare che salta i vicini senza dato; dove nessun vicino ha un dato il risultato è SENZA_DATO.
 */
export function ricampionaSuTessera(tiff, bbox, w, h) {
  if (!tiff.georef) throw new ErroreDem("il TIFF non è georeferenziato");
  const { x0, y0, dx, dy } = tiff.georef;
  const { larghezza: W, altezza: H, dati, nodata } = tiff;
  const fuori = new Float32Array(w * h);
  const sx = (bbox.est - bbox.ovest) / w, sy = (bbox.nord - bbox.sud) / h;
  const ok = (v) => quotaValida(v) && v !== nodata;
  for (let r = 0; r < h; r++) {
    const y = bbox.nord - (r + 0.5) * sy;
    const fr = (y - y0) / dy - 0.5;
    const r0 = Math.floor(fr), ty = fr - r0;
    for (let c = 0; c < w; c++) {
      const fc = (bbox.ovest + (c + 0.5) * sx - x0) / dx - 0.5;
      const c0 = Math.floor(fc), tx = fc - c0;
      let somma = 0, peso = 0;
      for (let j = 0; j < 2; j++) {
        const rr = r0 + j;
        if (rr < 0 || rr >= H) continue;
        const wy = j ? ty : 1 - ty;
        for (let i = 0; i < 2; i++) {
          const cc = c0 + i;
          if (cc < 0 || cc >= W) continue;
          const v = dati[rr * W + cc];
          if (!ok(v)) continue;
          const p = wy * (i ? tx : 1 - tx);
          somma += v * p; peso += p;
        }
      }
      fuori[r * w + c] = peso > 1e-6 ? somma / peso : SENZA_DATO;
    }
  }
  return fuori;
}

/** Ricampiona una griglia w×h (stessa estensione) a nw×nh con interpolazione bilineare sui centri dei pixel. */
export function ridimensiona(dati, w, h, nw, nh) {
  if (w === nw && h === nh) return Float32Array.from(dati);
  const fuori = new Float32Array(nw * nh);
  for (let r = 0; r < nh; r++) {
    const fr = Math.min(h - 1, Math.max(0, ((r + 0.5) * h) / nh - 0.5));
    const r0 = Math.floor(fr), r1 = Math.min(h - 1, r0 + 1), ty = fr - r0;
    for (let c = 0; c < nw; c++) {
      const fc = Math.min(w - 1, Math.max(0, ((c + 0.5) * w) / nw - 0.5));
      const c0 = Math.floor(fc), c1 = Math.min(w - 1, c0 + 1), tx = fc - c0;
      fuori[r * nw + c] = dati[r0 * w + c0] * (1 - tx) * (1 - ty) + dati[r0 * w + c1] * tx * (1 - ty) + dati[r1 * w + c0] * (1 - tx) * ty + dati[r1 * w + c1] * tx * ty;
    }
  }
  return fuori;
}

// ------------------------------------------------------------------------------ vuoti

/**
 * Riempie i pixel senza dato: prima con la quota di ripiego (tessera mondiale), poi, dove manca anche quella,
 * con il valore valido più vicino. Il mare (ripiego sotto zero) resta a 0 m: sul 3D l'acqua è piatta.
 * Modifica `quote` sul posto. Restituisce {vuotiIniziali, daRipiego, daVicino, tuttoVuoto}.
 */
export function riempiVuoti(quote, w, h, ripiego = null) {
  let vuoti = 0, daRipiego = 0;
  for (let i = 0; i < quote.length; i++) {
    if (quotaValida(quote[i])) continue;
    vuoti++;
    if (ripiego && quotaValida(ripiego[i])) { quote[i] = Math.max(0, ripiego[i]); daRipiego++; } else quote[i] = NaN;
  }
  let restano = 0;
  for (let i = 0; i < quote.length; i++) if (Number.isNaN(quote[i])) restano++;
  if (restano === quote.length) { quote.fill(0); return { vuotiIniziali: vuoti, daRipiego, daVicino: 0, tuttoVuoto: true }; }
  let daVicino = 0;
  // dilatazione: a ogni giro ogni pixel mancante con almeno un vicino valido (4 direzioni) prende la media dei vicini validi
  for (let giro = 0; restano > 0 && giro < w + h; giro++) {
    const nuovi = [];
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (!Number.isNaN(quote[i])) continue;
      let somma = 0, n = 0;
      if (c > 0 && !Number.isNaN(quote[i - 1])) { somma += quote[i - 1]; n++; }
      if (c < w - 1 && !Number.isNaN(quote[i + 1])) { somma += quote[i + 1]; n++; }
      if (r > 0 && !Number.isNaN(quote[i - w])) { somma += quote[i - w]; n++; }
      if (r < h - 1 && !Number.isNaN(quote[i + w])) { somma += quote[i + w]; n++; }
      if (n) nuovi.push(i, somma / n);
    }
    for (let k = 0; k < nuovi.length; k += 2) quote[nuovi[k]] = nuovi[k + 1];
    daVicino += nuovi.length / 2; restano -= nuovi.length / 2;
  }
  return { vuotiIniziali: vuoti, daRipiego, daVicino, tuttoVuoto: false };
}

// ------------------------------------------------------------------------------ formato «Terrarium»

/** Quote (m) → byte RGBA: quota+32768 = R·256 + G + B/256, alfa 255. Risoluzione 1/256 m. */
export function codificaTerrarium(quote) {
  const rgba = new Uint8ClampedArray(quote.length * 4);
  for (let i = 0; i < quote.length; i++) {
    const v = Math.min(65535.99, Math.max(0, quote[i] + 32768));
    const intero = Math.floor(v);
    rgba[i * 4] = intero >> 8;
    rgba[i * 4 + 1] = intero & 255;
    rgba[i * 4 + 2] = Math.floor((v - intero) * 256);
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** Byte RGBA «Terrarium» → quote (m). */
export function decodificaTerrarium(rgba) {
  const n = rgba.length / 4;
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
  return q;
}

// ------------------------------------------------------------------------------ una tessera completa

/**
 * Compone la tessera di quote da consegnare a MapLibre: dal GeoTIFF di TINITALY (se c'è) e dalla tessera mondiale di ripiego
 * (già in quote, qualsiasi dimensione quadrata, stessa estensione della tessera).
 * Restituisce {quote, w, h, fonte, vuotiIniziali, daRipiego, daVicino}: `fonte` è «tinitaly», «misto» (con ripiego su una parte) o «terrarium».
 */
export function componiTessera({ tiff = null, z, x, y, ripiego = null, ripiegoLato = 0, px = PIXEL_TESSERA }) {
  const bbox = bboxTessera(z, x, y);
  let quote = null;
  if (tiff) quote = ricampionaSuTessera(tiff, bbox, px, px);
  let dalDato = 0;
  if (quote) for (let i = 0; i < quote.length; i++) if (quotaValida(quote[i])) dalDato++;
  const rip = ripiego && ripiegoLato ? ridimensiona(ripiego, ripiegoLato, ripiegoLato, px, px) : null;
  if (!quote || dalDato < quote.length * 0.02) {
    if (!rip) throw new ErroreDem("nessuna quota disponibile per la tessera");
    const q = Float32Array.from(rip);
    return { quote: q, w: px, h: px, fonte: "terrarium", vuotiIniziali: q.length, daRipiego: q.length, daVicino: 0 };
  }
  const esito = riempiVuoti(quote, px, px, rip);
  return { quote, w: px, h: px, fonte: esito.vuotiIniziali ? "misto" : "tinitaly", vuotiIniziali: esito.vuotiIniziali, daRipiego: esito.daRipiego, daVicino: esito.daVicino };
}
