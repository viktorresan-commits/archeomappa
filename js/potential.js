// Zone di potenziale: triangolazione di Delaunay dei siti noti e punteggio dei
// triangoli (metodo ispirato a DetectLab, riscritto per questo prototipo).
// Principio "fail closed": nel dubbio la zona viene scartata, non proposta.

import { delaunay, projector, centroid, triQuality, triArea } from "./geo.js";

export const PARAMETRI_BASE = Object.freeze({
  pesoVicini: 0.3, // siti entro 1,5 km dal baricentro
  pesoMedia: 0.25, // distanza media dai 5 siti più vicini (entro 3 km)
  pesoQualita: 0.25, // regolarità del triangolo
  pesoDensita: 0.2, // siti entro 3 km
  raggioViciniM: 1500,
  normVicini: 6,
  raggioDensitaM: 3000,
  normDensita: 8,
  sogliaMinima: 0.25, // sotto: scartata
  sogliaAlta: 0.55, // da qui: potenziale alto
  bufferSitoM: 700, // entro questa distanza da un sito noto: scartata
  latoMassimoM: 6000, // triangoli con lati più lunghi: scartati
  separazioneMinimaM: 350, // zone più vicine di così: resta la migliore
  maxSiti: 3000,
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * @param {Array<{lat:number, lon:number}>} siti siti noti (con coordinate WGS84)
 * @param {{lat:number, lon:number}} centro
 * @param {number} raggioM raggio entro cui cercare le zone
 * @param {Partial<typeof PARAMETRI_BASE>} [opzioni]
 */
export function calcolaZone(siti, centro, raggioM, opzioni = {}) {
  const p = { ...PARAMETRI_BASE, ...opzioni };
  const somma = p.pesoVicini + p.pesoMedia + p.pesoQualita + p.pesoDensita;
  if (!(somma > 0)) throw new Error("La somma dei pesi deve essere maggiore di zero.");
  const w = {
    vicini: p.pesoVicini / somma,
    media: p.pesoMedia / somma,
    qualita: p.pesoQualita / somma,
    densita: p.pesoDensita / somma,
  };

  const out = {
    zone: [],
    scarti: { raggio: 0, lato: 0, vicinoASito: 0, punteggioBasso: 0, vicine: 0 },
    nSiti: 0,
    nTriangoli: 0,
    avviso: "",
  };

  const proj = projector(centro.lat, centro.lon);
  let punti = siti
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => proj.toXY(s.lat, s.lon));

  // Rimozione dei duplicati (stessi metri) e limite massimo.
  const visti = new Set();
  punti = punti.filter(([x, y]) => {
    const k = `${Math.round(x)}_${Math.round(y)}`;
    if (visti.has(k)) return false;
    visti.add(k);
    return true;
  });
  if (punti.length > p.maxSiti) {
    punti.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
    punti = punti.slice(0, p.maxSiti);
    out.avviso = `Troppi siti: considerati i ${p.maxSiti} più vicini al centro.`;
  }
  out.nSiti = punti.length;
  if (punti.length < 3) {
    out.avviso = "Servono almeno 3 siti noti nell'area per calcolare le zone.";
    return out;
  }

  // Indice a griglia per cercare i vicini senza confrontare tutto con tutto.
  const CELLA = 1500;
  const griglia = new Map();
  const cella = (v) => Math.floor(v / CELLA);
  punti.forEach((pt, i) => {
    const k = `${cella(pt[0])}_${cella(pt[1])}`;
    if (!griglia.has(k)) griglia.set(k, []);
    griglia.get(k).push(i);
  });
  const entro = (x, y, r) => {
    const res = [];
    const c = Math.ceil(r / CELLA);
    const cx = cella(x), cy = cella(y);
    for (let i = cx - c; i <= cx + c; i++) {
      for (let j = cy - c; j <= cy + c; j++) {
        const lista = griglia.get(`${i}_${j}`);
        if (!lista) continue;
        for (const idx of lista) {
          const d = Math.hypot(punti[idx][0] - x, punti[idx][1] - y);
          if (d <= r) res.push(d);
        }
      }
    }
    return res.sort((a, b) => a - b);
  };

  const triangoli = delaunay(punti);
  out.nTriangoli = triangoli.length;

  const candidati = [];
  for (const [ia, ib, ic] of triangoli) {
    const A = punti[ia], B = punti[ib], C = punti[ic];
    const lati = [
      Math.hypot(A[0] - B[0], A[1] - B[1]),
      Math.hypot(B[0] - C[0], B[1] - C[1]),
      Math.hypot(C[0] - A[0], C[1] - A[1]),
    ];
    if (Math.max(...lati) > p.latoMassimoM) { out.scarti.lato++; continue; }

    const [cx, cy] = centroid(A, B, C);
    if (Math.hypot(cx, cy) > raggioM) { out.scarti.raggio++; continue; }

    const vicini = entro(cx, cy, p.raggioDensitaM); // già ordinati
    if (vicini.length && vicini[0] < p.bufferSitoM) { out.scarti.vicinoASito++; continue; }

    const nVicini = vicini.filter((d) => d <= p.raggioViciniM).length;
    const cinque = vicini.slice(0, 5);
    const media = cinque.length ? cinque.reduce((s, d) => s + d, 0) / cinque.length : p.raggioDensitaM;

    const f = {
      vicini: clamp01(nVicini / p.normVicini),
      media: clamp01(1 - media / p.raggioDensitaM),
      qualita: clamp01(triQuality(A, B, C)),
      densita: clamp01(vicini.length / p.normDensita),
    };
    const punteggio = w.vicini * f.vicini + w.media * f.media + w.qualita * f.qualita + w.densita * f.densita;
    if (punteggio < p.sogliaMinima) { out.scarti.punteggioBasso++; continue; }

    const [lat, lon] = proj.toLatLon(cx, cy);
    candidati.push({
      lat, lon, x: cx, y: cy,
      punteggio,
      classe: punteggio >= p.sogliaAlta ? "alta" : "media",
      fattori: f,
      vicinoM: vicini.length ? vicini[0] : null,
      areaKm2: triArea(A, B, C) / 1e6,
      vertici: [A, B, C].map((v) => proj.toLatLon(v[0], v[1])),
    });
  }

  // Separazione minima: tra zone troppo vicine resta la migliore.
  candidati.sort((a, b) => b.punteggio - a.punteggio);
  const tenute = [];
  for (const z of candidati) {
    if (tenute.some((t) => Math.hypot(t.x - z.x, t.y - z.y) < p.separazioneMinimaM)) {
      out.scarti.vicine++;
      continue;
    }
    tenute.push(z);
  }
  out.zone = tenute.map((z, i) => {
    const { x, y, ...resto } = z;
    return { id: i + 1, ...resto };
  });
  if (!out.zone.length && !out.avviso) {
    out.avviso = "Nessuna zona supera le soglie: nel dubbio non viene proposto nulla.";
  }
  return out;
}

/** Le prime n zone per punteggio (già ordinate). */
export function primeZone(zone, n = 3) {
  return zone.slice(0, n);
}

export function zoneInGeoJSON(zone, meta = {}) {
  return {
    type: "FeatureCollection",
    properties: meta,
    features: zone.map((z) => ({
      type: "Feature",
      properties: {
        id: z.id,
        classe: z.classe,
        punteggio: Number(z.punteggio.toFixed(3)),
        area_km2: Number(z.areaKm2.toFixed(3)),
        sito_noto_piu_vicino_m: z.vicinoM == null ? null : Math.round(z.vicinoM),
        centro_lat: Number(z.lat.toFixed(6)),
        centro_lon: Number(z.lon.toFixed(6)),
        ...Object.fromEntries(Object.entries(z.fattori).map(([k, v]) => [`f_${k}`, Number(v.toFixed(3))])),
      },
      geometry: {
        type: "Polygon",
        coordinates: [[...z.vertici, z.vertici[0]].map(([la, lo]) => [lo, la])],
      },
    })),
  };
}
