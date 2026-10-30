// Proiezioni usate dai rilievi italiani: UTM su WGS84/ETRS89 (serie di Krüger, errore sotto il millimetro),
// coordinate geografiche e Web Mercator. Nessuna dipendenza esterna.

const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const N = F / (2 - F);
const N2 = N * N, N3 = N2 * N, N4 = N3 * N, N5 = N4 * N, N6 = N5 * N;
const RAGGIO = (A / (1 + N)) * (1 + N2 / 4 + N4 / 64 + N6 / 256);

const ALFA = [
  N / 2 - (2 / 3) * N2 + (5 / 16) * N3 + (41 / 180) * N4 - (127 / 288) * N5 + (7891 / 37800) * N6,
  (13 / 48) * N2 - (3 / 5) * N3 + (557 / 1440) * N4 + (281 / 630) * N5 - (1983433 / 1935360) * N6,
  (61 / 240) * N3 - (103 / 140) * N4 + (15061 / 26880) * N5 + (167603 / 181440) * N6,
  (49561 / 161280) * N4 - (179 / 168) * N5 + (6601661 / 7257600) * N6,
  (34729 / 80640) * N5 - (3418889 / 1995840) * N6,
  (212378941 / 319334400) * N6,
];
const BETA = [
  N / 2 - (2 / 3) * N2 + (37 / 96) * N3 - (1 / 360) * N4 - (81 / 512) * N5 + (96199 / 604800) * N6,
  (1 / 48) * N2 + (1 / 15) * N3 - (437 / 1440) * N4 + (46 / 105) * N5 - (1118711 / 3870720) * N6,
  (17 / 480) * N3 - (37 / 840) * N4 - (209 / 4480) * N5 + (5569 / 90720) * N6,
  (4397 / 161280) * N4 - (11 / 504) * N5 - (830251 / 7257600) * N6,
  (4583 / 161280) * N5 - (108847 / 3991680) * N6,
  (20648693 / 638668800) * N6,
];
const DELTA = [
  2 * N - (2 / 3) * N2 - 2 * N3 + (116 / 45) * N4 + (26 / 45) * N5 - (2854 / 675) * N6,
  (7 / 3) * N2 - (8 / 5) * N3 - (227 / 45) * N4 + (2704 / 315) * N5 + (2323 / 945) * N6,
  (56 / 15) * N3 - (136 / 35) * N4 - (1262 / 105) * N5 + (73814 / 2835) * N6,
  (4279 / 630) * N4 - (332 / 35) * N5 - (399572 / 14175) * N6,
  (4174 / 315) * N5 - (144838 / 6237) * N6,
  (601676 / 22275) * N6,
];

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** UTM diretta: (lat, lon) in gradi → [est, nord] in metri. */
export function utmDiretta(lat, lon, zona, sud = false) {
  const lon0 = rad(zona * 6 - 183);
  const phi = rad(lat);
  const dl = rad(lon) - lon0;
  const e = Math.sqrt(F * (2 - F));
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi1 = Math.atan2(t, Math.cos(dl));
  const eta1 = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let xi = xi1, eta = eta1;
  for (let j = 1; j <= 6; j++) {
    xi += ALFA[j - 1] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1);
    eta += ALFA[j - 1] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1);
  }
  return [500000 + K0 * RAGGIO * eta, (sud ? 10000000 : 0) + K0 * RAGGIO * xi];
}

/** UTM inversa: [est, nord] → [lat, lon] in gradi. */
export function utmInversa(est, nord, zona, sud = false) {
  const lon0 = rad(zona * 6 - 183);
  const xi = (nord - (sud ? 10000000 : 0)) / (K0 * RAGGIO);
  const eta = (est - 500000) / (K0 * RAGGIO);
  let xi1 = xi, eta1 = eta;
  for (let j = 1; j <= 6; j++) {
    xi1 -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  for (let j = 1; j <= 6; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lam = lon0 + Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  return [deg(phi), deg(lam)];
}

const R_MERC = 6378137;
export const mercatoreDiretta = (lat, lon) => [R_MERC * rad(lon), R_MERC * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))];
export const mercatoreInversa = (x, y) => [deg(2 * Math.atan(Math.exp(y / R_MERC)) - Math.PI / 2), deg(x / R_MERC)];

/**
 * Crea la proiezione per un codice EPSG supportato, oppure restituisce null.
 * Supportati: 4326/4258 (gradi), 32601–32660 e 32701–32760 (UTM WGS84), 25828–25838 (UTM ETRS89), 3857.
 * Gauss-Boaga (3003/3004) NON è supportato: richiede una trasformazione di datum.
 */
export function creaProiezione(epsg) {
  if (epsg === 4326 || epsg === 4258) {
    return { nome: `EPSG:${epsg}`, gradi: true, daLatLon: (la, lo) => [lo, la], aLatLon: (x, y) => [y, x] };
  }
  if (epsg === 3857 || epsg === 900913) {
    return { nome: "EPSG:3857", gradi: false, daLatLon: mercatoreDiretta, aLatLon: mercatoreInversa };
  }
  let zona = null, sud = false;
  if (epsg >= 32601 && epsg <= 32660) zona = epsg - 32600;
  else if (epsg >= 32701 && epsg <= 32760) { zona = epsg - 32700; sud = true; }
  else if (epsg >= 25828 && epsg <= 25838) zona = epsg - 25800;
  if (zona == null) return null;
  return {
    nome: `EPSG:${epsg}`,
    gradi: false,
    zona,
    daLatLon: (la, lo) => utmDiretta(la, lo, zona, sud),
    aLatLon: (x, y) => utmInversa(x, y, zona, sud),
  };
}
