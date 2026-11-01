// Fonti dati: OpenStreetMap (Overpass), Nominatim, Wikipedia/Commons, Internet Archive,
// lettura dei GetCapabilities WMS. Le funzioni "parse*" sono pure e testabili.

import { classifica, dominante, epocaDaAnno } from "./epochs.js";
import { prendi, soloTesto, tronca, urlSicuro, cacheLeggi, cacheScrivi, fetchNativo } from "./util.js";
import { haversine } from "./geo.js";

// ------------------------------------------------------------- categorie OSM

export const CATEGORIE = [
  {
    id: "fort",
    nome: "Castelli e fortificazioni",
    colore: "#a93226",
    filtri: [
      '["historic"~"^(castle|fort|city_gate|citywalls|manor)$"]',
      '["castle_type"]',
      '["man_made"="tower"]["tower:type"="defensive"]',
    ],
  },
  {
    id: "arch",
    nome: "Siti archeologici e rovine",
    colore: "#b9770e",
    filtri: ['["historic"~"^(archaeological_site|ruins)$"]', '["ruins"="yes"]', '["building"="ruins"]'],
  },
  {
    id: "strutt",
    nome: "Strutture storiche",
    colore: "#1f618d",
    filtri: ['["historic"~"^(aqueduct|bridge|mine|charcoal_pile|bunker|battlefield)$"]'],
  },
  {
    id: "relig",
    nome: "Edifici religiosi storici",
    colore: "#7d3c98",
    filtri: ['["historic"~"^(monastery|church|chapel|wayside_shrine)$"]'],
  },
];

export const ENDPOINT_OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export function costruisciQueryOverpass({ lat, lon, raggioM, categorie, limite = 1500 }) {
  const blocchi = [];
  for (const c of CATEGORIE) {
    if (!categorie.includes(c.id)) continue;
    for (const f of c.filtri) {
      blocchi.push(`nwr${f}(around:${Math.round(raggioM)},${lat.toFixed(6)},${lon.toFixed(6)});`);
    }
  }
  if (!blocchi.length) throw new Error("Seleziona almeno una categoria.");
  return `[out:json][timeout:60];(${blocchi.join("")});out tags center ${limite};`;
}

const CIVILTA = {
  ancient_roman: "romano",
  roman: "romano",
  ancient_greek: "greco",
  greek: "greco",
  etruscan: "etrusco",
  medieval: "medioevo",
  prehistoric: "preistoria",
  byzantine: "bizantino",
  lombard: "longobardo",
  phoenician: "fenicio",
  punic: "punico",
};

function annoDa(startDate) {
  if (!startDate) return null;
  const s = String(startDate).trim();
  const sec = /^C(\d{1,2})$/i.exec(s);
  if (sec) return (Number(sec[1]) - 1) * 100 + 50;
  const m = /(-?\d{3,4})/.exec(s);
  return m ? Number(m[1]) : null;
}

function categoriaDi(tags) {
  const h = tags.historic;
  if (/^(castle|fort|city_gate|citywalls|manor)$/.test(h) || tags.castle_type || (tags.man_made === "tower" && tags["tower:type"] === "defensive")) return "fort";
  if (/^(archaeological_site|ruins)$/.test(h) || tags.ruins === "yes" || tags.building === "ruins") return "arch";
  if (/^(monastery|church|chapel|wayside_shrine)$/.test(h)) return "relig";
  return "strutt";
}

/** Converte la risposta Overpass in una lista di siti con epoca stimata. */
export function leggiOverpass(json) {
  const visti = new Set();
  const siti = [];
  for (const el of json?.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = `${el.type}/${el.id}`;
    if (visti.has(id)) continue;
    visti.add(id);
    const t = el.tags ?? {};
    const civ = (t["historic:civilization"] || "").split(";").map((x) => CIVILTA[x.trim()] || x.trim()).join(" ");
    const testo = [t.name, t["name:it"], t.description, t["description:it"], t.inscription, civ, t.period, t["archaeological_site"], t.castle_type, t.historic].filter(Boolean).join(" ");
    let epoca = dominante(classifica(testo));
    if (!epoca) epoca = epocaDaAnno(annoDa(t.start_date));
    siti.push({
      id,
      lat,
      lon,
      nome: t.name || t["name:it"] || "",
      cat: categoriaDi(t),
      epoca,
      tipo: t.historic || t.castle_type || t.ruins || t.building || "",
      wikipedia: t.wikipedia || "",
      url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    });
  }
  return siti;
}

/**
 * Interroga Overpass provando i server in ordine. Restituisce {siti, troncato, avviso, server}.
 */
export async function cercaSitiOSM(params, { impl, endpoint = ENDPOINT_OVERPASS, ttlMs = 24 * 3600 * 1000, forza = false } = {}) {
  const query = costruisciQueryOverpass(params);
  const chiave = "overpass:" + query;
  if (!forza) {
    const c = await cacheLeggi(chiave, ttlMs).catch(() => null);
    if (c) return { ...c, daCache: true };
  }
  let ultimo;
  for (const ep of endpoint) {
    try {
      const json = await prendi(ep, {
        metodo: "POST",
        corpo: "data=" + encodeURIComponent(query),
        intestazioni: { "Content-Type": "application/x-www-form-urlencoded" },
        timeoutMs: 70000,
        impl,
      });
      const siti = leggiOverpass(json);
      const limite = params.limite ?? 1500;
      const res = {
        siti,
        troncato: (json.elements?.length ?? 0) >= limite,
        avviso: json.remark ? String(json.remark) : "",
        server: new URL(ep).host,
        daCache: false,
      };
      if (!res.avviso) await cacheScrivi(chiave, res).catch(() => {});
      return res;
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo ?? new Error("Nessun server Overpass raggiungibile");
}

// ------------------------------------------------- edifici e strade (per i filtri)

const STRADE_ATTUALI = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|road";

export function costruisciQueryEdificiStrade({ lat, lon, raggioM, limite = 6000 }) {
  const a = `(around:${Math.round(raggioM)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  return `[out:json][timeout:60];(way["building"]${a};way["highway"~"^(${STRADE_ATTUALI})$"]${a};);out geom ${limite};`;
}

/** Converte la risposta Overpass (out geom) in poligoni di edifici e linee di strade, in [lat, lon]. */
export function leggiEdificiStrade(json) {
  const edifici = [], strade = [];
  for (const el of json?.elements ?? []) {
    if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const punti = el.geometry.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)).map((p) => [p.lat, p.lon]);
    if (punti.length < 2) continue;
    if (el.tags?.building) { if (punti.length >= 3) edifici.push(punti); }
    else if (el.tags?.highway) strade.push(punti);
  }
  return { edifici, strade };
}

/** Edifici e strade attuali attorno a un punto, per scartare le anomalie che non sono antiche. */
export async function cercaEdificiStrade(params, { impl, endpoint = ENDPOINT_OVERPASS, ttlMs = 24 * 3600 * 1000, forza = false } = {}) {
  const query = costruisciQueryEdificiStrade(params);
  const chiave = "overpass-eds:" + query;
  if (!forza) {
    const c = await cacheLeggi(chiave, ttlMs).catch(() => null);
    if (c) return { ...c, daCache: true };
  }
  let ultimo;
  for (const ep of endpoint) {
    try {
      const json = await prendi(ep, {
        metodo: "POST",
        corpo: "data=" + encodeURIComponent(query),
        intestazioni: { "Content-Type": "application/x-www-form-urlencoded" },
        timeoutMs: 70000,
        impl,
      });
      const { edifici, strade } = leggiEdificiStrade(json);
      const res = { edifici, strade, troncato: (json.elements?.length ?? 0) >= (params.limite ?? 6000), avviso: json.remark ? String(json.remark) : "", daCache: false };
      if (!res.avviso) await cacheScrivi(chiave, res).catch(() => {});
      return res;
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo ?? new Error("Nessun server Overpass raggiungibile");
}

// ---------------------------------------------------------------- Nominatim

export async function cercaLuogo(testo, { impl } = {}) {
  const q = String(testo).trim();
  if (!q) return [];
  // Coordinate scritte a mano: "42.98, 12.5" o "42,98 12,5".
  const m = /^\s*(-?\d{1,2}[.,]\d+)\s*[;,\s]\s*(-?\d{1,3}[.,]\d+)\s*$/.exec(q);
  if (m) {
    const lat = Number(m[1].replace(",", "."));
    const lon = Number(m[2].replace(",", "."));
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return [{ nome: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon, tipo: "coordinate" }];
  }
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=it&accept-language=it&q=${encodeURIComponent(q)}`;
  const r = await prendi(url, { impl });
  return r.map((x) => ({ nome: x.display_name, lat: Number(x.lat), lon: Number(x.lon), tipo: x.type }));
}

// --------------------------------------------------- Biblioteca delle Fonti

const WIKI = "https://it.wikipedia.org/w/api.php";
const COMMONS = "https://commons.wikimedia.org/w/api.php";

const paginaWiki = (titolo) => `https://it.wikipedia.org/wiki/${encodeURIComponent(String(titolo).replace(/ /g, "_"))}`;

function voce(base) {
  const epoca = dominante(classifica(`${base.titolo} ${base.testo ?? ""}`));
  return { ...base, testo: tronca(base.testo ?? "", 320), epoca, url: urlSicuro(base.url), immagine: urlSicuro(base.immagine) };
}

export async function wikipediaVicino(lat, lon, raggioM = 10000, { impl } = {}) {
  const r = Math.min(10000, Math.max(10, Math.round(raggioM)));
  const url = `${WIKI}?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=${r}&gslimit=40&format=json&origin=*`;
  const j = await prendi(url, { impl });
  const elenco = j?.query?.geosearch ?? [];
  const estratti = {};
  for (let i = 0; i < elenco.length; i += 20) {
    const ids = elenco.slice(i, i + 20).map((x) => x.pageid).join("%7C");
    const e = await prendi(`${WIKI}?action=query&prop=extracts&exintro=1&explaintext=1&exsentences=3&exlimit=20&pageids=${ids}&format=json&origin=*`, { impl }).catch(() => null);
    for (const p of Object.values(e?.query?.pages ?? {})) estratti[p.pageid] = p.extract;
  }
  return elenco.map((x) =>
    voce({ fonte: "Wikipedia", titolo: x.title, testo: estratti[x.pageid] ?? "", url: paginaWiki(x.title), lat: x.lat, lon: x.lon, distM: x.dist }),
  );
}

export async function wikipediaCerca(q, { impl } = {}) {
  const j = await prendi(`${WIKI}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=15&format=json&origin=*`, { impl });
  return (j?.query?.search ?? []).map((x) => voce({ fonte: "Wikipedia", titolo: x.title, testo: soloTesto(x.snippet), url: paginaWiki(x.title) }));
}

export async function commonsCerca(q, { impl } = {}) {
  const url = `${COMMONS}?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=240&format=json&origin=*`;
  const j = await prendi(url, { impl });
  return Object.values(j?.query?.pages ?? {}).map((p) => {
    const ii = p.imageinfo?.[0];
    const md = ii?.extmetadata ?? {};
    return voce({
      fonte: "Wikimedia Commons",
      titolo: String(p.title ?? "").replace(/^File:/, ""),
      testo: soloTesto(md.ImageDescription?.value),
      url: ii?.descriptionurl,
      immagine: ii?.thumburl,
      licenza: soloTesto(md.LicenseShortName?.value),
    });
  });
}

export async function commonsVicino(lat, lon, raggioM = 10000, { impl } = {}) {
  const r = Math.min(10000, Math.max(10, Math.round(raggioM)));
  const url = `${COMMONS}?action=query&generator=geosearch&ggscoord=${lat}%7C${lon}&ggsradius=${r}&ggsnamespace=6&ggslimit=20&prop=imageinfo%7Ccoordinates&iiprop=url%7Cextmetadata&iiurlwidth=240&format=json&origin=*`;
  const j = await prendi(url, { impl });
  return Object.values(j?.query?.pages ?? {}).map((p) => {
    const ii = p.imageinfo?.[0];
    const md = ii?.extmetadata ?? {};
    const c = p.coordinates?.[0];
    return voce({
      fonte: "Wikimedia Commons",
      titolo: String(p.title ?? "").replace(/^File:/, ""),
      testo: soloTesto(md.ImageDescription?.value),
      url: ii?.descriptionurl,
      immagine: ii?.thumburl,
      licenza: soloTesto(md.LicenseShortName?.value),
      lat: c?.lat,
      lon: c?.lon,
      distM: c ? haversine(lat, lon, c.lat, c.lon) : undefined,
    });
  });
}

export async function archiveCerca(q, { impl } = {}) {
  const query = `(${q}) AND mediatype:(texts)`;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=creator&rows=15&output=json`;
  const j = await prendi(url, { impl });
  return (j?.response?.docs ?? []).map((d) =>
    voce({
      fonte: "Internet Archive",
      titolo: String(Array.isArray(d.title) ? d.title[0] : d.title ?? d.identifier),
      testo: [d.creator && (Array.isArray(d.creator) ? d.creator.join(", ") : d.creator), d.year].filter(Boolean).join(" · "),
      url: `https://archive.org/details/${encodeURIComponent(d.identifier)}`,
    }),
  );
}

// ------------------------------------------------------ WMS GetCapabilities

const ENTITA = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const decodifica = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITA[m]);

/** Estrae titolo servizio, formati immagine e livelli (con Name) da un GetCapabilities. */
export function leggiCapabilities(xml) {
  const pulito = String(xml).replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "");
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  const pila = [];
  const livelli = [];
  const formati = [];
  let titoloServizio = "";
  const attivi = [];
  let m;
  while ((m = re.exec(pulito))) {
    const [, cdata, chiude, nomeCompleto, , autochiude, testo] = m;
    if (nomeCompleto) {
      const nome = nomeCompleto.includes(":") ? nomeCompleto.split(":").pop() : nomeCompleto;
      if (chiude) {
        const top = pila.pop();
        if (top === "Layer") {
          const l = attivi.pop();
          if (l.name) livelli.push({ name: l.name.trim(), title: (l.title || l.name).trim() });
        }
      } else if (!autochiude) {
        pila.push(nome);
        if (nome === "Layer") attivi.push({ name: "", title: "" });
      }
      continue;
    }
    const contenuto = decodifica(cdata ?? testo ?? "");
    if (!contenuto.trim()) continue;
    const corrente = pila[pila.length - 1];
    const padre = pila[pila.length - 2];
    if (corrente === "Name" && padre === "Layer") attivi[attivi.length - 1].name += contenuto;
    else if (corrente === "Title" && padre === "Layer") attivi[attivi.length - 1].title += contenuto;
    else if (corrente === "Title" && padre === "Service") titoloServizio += contenuto;
    else if (corrente === "Format" && padre === "GetMap") formati.push(contenuto.trim());
  }
  return { titolo: titoloServizio.trim(), formati, livelli };
}

/** URL di GetCapabilities, rispettando eventuali parametri già presenti (es. ?map=...). */
export function urlCapabilities(base, versione = "1.3.0") {
  const u = new URL(base);
  const ha = (n) => [...u.searchParams.keys()].some((k) => k.toLowerCase() === n);
  if (!ha("service")) u.searchParams.set("SERVICE", "WMS");
  if (!ha("request")) u.searchParams.set("REQUEST", "GetCapabilities");
  if (!ha("version")) u.searchParams.set("VERSION", versione);
  return u.href;
}

export async function caricaCapabilities(base, { impl, versione } = {}) {
  const xml = await prendi(urlCapabilities(base, versione), { tipo: "testo", impl: impl ?? fetchNativo() ?? undefined, timeoutMs: 25000 });
  const cap = leggiCapabilities(xml);
  if (!cap.livelli.length) throw new Error("Il servizio ha risposto ma non elenca livelli leggibili.");
  return cap;
}
