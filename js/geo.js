// Geometria e geodesia: funzioni pure, nessuna dipendenza dal browser.

export const R_TERRA = 6371008.8; // metri

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Distanza in metri tra due coordinate (formula dell'emisenoverso). */
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_TERRA * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Direzione (N, NE, E, ...) dal punto 1 al punto 2. */
export function compass(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  const b = (deg(Math.atan2(y, x)) + 360) % 360;
  const nomi = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return nomi[Math.round(b / 45) % 8];
}

/** Proiezione piana locale (equirettangolare) centrata su (lat0, lon0), in metri. */
export function projector(lat0, lon0) {
  const k = Math.cos(rad(lat0));
  return {
    toXY(lat, lon) {
      return [rad(lon - lon0) * k * R_TERRA, rad(lat - lat0) * R_TERRA];
    },
    toLatLon(x, y) {
      return [lat0 + deg(y / R_TERRA), lon0 + deg(x / (R_TERRA * k))];
    },
  };
}

/** Riquadro [sud, ovest, nord, est] attorno a un punto, raggio in metri. */
export function bboxAround(lat, lon, raggioM) {
  const dLat = deg(raggioM / R_TERRA);
  const dLon = deg(raggioM / (R_TERRA * Math.cos(rad(lat))));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

export function formatDist(m) {
  if (!Number.isFinite(m)) return "–";
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1).replace(".", ",")} km`;
}

// ---------------------------------------------------------------- triangoli

export function triArea(a, b, c) {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
}

/** Qualità del triangolo in [0,1]: 1 = equilatero, 0 = degenere. */
export function triQuality(a, b, c) {
  const l2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
  const somma = l2(a, b) + l2(b, c) + l2(c, a);
  if (somma === 0) return 0;
  return Math.min(1, (4 * Math.sqrt(3) * triArea(a, b, c)) / somma);
}

export function centroid(a, b, c) {
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Il punto p è dentro la circonferenza circoscritta del triangolo (a,b,c)? */
function inCircle(p, a, b, c) {
  const ax = a[0] - p[0], ay = a[1] - p[1];
  const bx = b[0] - p[0], by = b[1] - p[1];
  const cx = c[0] - p[0], cy = c[1] - p[1];
  const det =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay);
  return orient(a, b, c) > 0 ? det > 0 : det < 0;
}

/**
 * Triangolazione di Delaunay (Bowyer–Watson), O(n²) nel caso peggiore:
 * adeguata per qualche migliaio di punti.
 * @param {Array<[number, number]>} punti coordinate piane (metri)
 * @returns {Array<[number, number, number]>} indici dei vertici di ogni triangolo
 */
export function delaunay(punti) {
  const n = punti.length;
  if (n < 3) return [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of punti) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const dmax = Math.max(maxX - minX, maxY - minY) || 1;
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;

  // Super-triangolo che contiene tutti i punti.
  const pts = punti.slice();
  pts.push([mx - 20 * dmax, my - dmax]);
  pts.push([mx, my + 20 * dmax]);
  pts.push([mx + 20 * dmax, my - dmax]);
  const S0 = n, S1 = n + 1, S2 = n + 2;

  let tri = [[S0, S1, S2]];

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const cattivi = [];
    const buoni = [];
    for (const t of tri) {
      if (inCircle(p, pts[t[0]], pts[t[1]], pts[t[2]])) cattivi.push(t);
      else buoni.push(t);
    }
    // Contorno del poligono: spigoli che compaiono una sola volta.
    const conteggio = new Map();
    const chiave = (u, v) => (u < v ? `${u}_${v}` : `${v}_${u}`);
    for (const t of cattivi) {
      for (let e = 0; e < 3; e++) {
        const u = t[e], v = t[(e + 1) % 3];
        const k = chiave(u, v);
        const rec = conteggio.get(k);
        if (rec) rec.n++;
        else conteggio.set(k, { u, v, n: 1 });
      }
    }
    tri = buoni;
    for (const { u, v, n: cnt } of conteggio.values()) {
      if (cnt === 1) tri.push([u, v, i]);
    }
  }

  return tri.filter((t) => t[0] < n && t[1] < n && t[2] < n);
}

/** Punto in poligono (ray casting); poligono come [[x,y], ...]. */
export function pointInPolygon(p, poly) {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      dentro = !dentro;
    }
  }
  return dentro;
}
