// Prova ogni mappa di base e ogni livello del registro (js/layers.js) con una richiesta vera, come farebbe l'app:
// stato HTTP, tipo, peso, intestazione CORS, tessera vuota o «dato non disponibile». Esegui con: node scripts/verifica-livelli.mjs
// (dall'ambiente di sviluppo molti servizi non sono raggiungibili: si lancia da GitHub, «Actions → Verifica livelli»).
import { createHash } from "node:crypto";
import { BASI, SOVRAPPOSIZIONI, urlTessera, tesseraDa } from "../js/layers.js";
import { variantiPcn } from "../js/varianti.js";

const ORIGINE = "https://viktorresan-commits.github.io";
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";
const PUNTI = { predefinito: [["Fabriano", 43.337, 12.905], ["Perugia", 43.11, 12.389]], bz1858: [["Bolzano", 46.4983, 11.3548]], castore: [["Firenze", 43.7696, 11.2558]] };
const ZOOM = [10, 14, 16, 18];

async function scarica(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Origin: ORIGINE, Referer: ORIGINE + "/archeomappa/", Accept: "image/avif,image/webp,image/png,image/*,*/*;q=0.8" }, signal: AbortSignal.timeout(40000) });
    const b = Buffer.from(await r.arrayBuffer());
    return { st: r.status, tipo: (r.headers.get("content-type") ?? "").split(";")[0], cors: r.headers.get("access-control-allow-origin") ?? "—", b, ms: Date.now() - t0 };
  } catch (e) {
    return { st: 0, tipo: "", cors: "—", b: Buffer.from(String(e.message ?? e)), ms: Date.now() - t0 };
  }
}
const testo = (b, n = 150) => b.toString("utf8").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim().slice(0, n);
const md5 = (b) => createHash("md5").update(b).digest("hex").slice(0, 8);
function esito(r) {
  if (r.st !== 200) return `HTTP ${r.st} ${testo(r.b, 80)}`;
  if (!r.tipo.startsWith("image/")) return `risposta non immagine (${r.tipo}): ${testo(r.b)}`;
  const vuota = r.b.length < 600 && r.tipo === "image/png";
  return `${vuota ? "VUOTA " : "immagine "}${r.b.length} byte, CORS ${r.cors}, md5 ${md5(r.b)}, ${r.ms} ms`;
}
const riempi = (m, z, x, y) => m.replace("{z}", z).replace("{x}", x).replace("{y}", y).replace("{s}", "a").replace("{r}", "");

async function tessereXyz(nome, modello, def, punti) {
  const maxZ = def.maxNativeZoom ?? def.maxZoom ?? 18;
  for (const [luogo, lat, lon] of punti) {
    const visti = new Map();
    for (const z of ZOOM.filter((v) => v <= maxZ + 1 && v >= (def.minZoom ?? 0))) {
      const { x, y } = tesseraDa(lat, lon, z);
      const r = await scarica(riempi(modello, z, x, y));
      const h = r.st === 200 ? md5(r.b) : null;
      const segnaposto = h && visti.has(h) ? " ← uguale a z" + visti.get(h) + ": segnaposto?" : "";
      if (h) visti.set(h, z);
      console.log(`   ${nome.padEnd(34)} ${luogo.padEnd(9)} z${String(z).padEnd(2)} ${esito(r)}${segnaposto}`);
    }
  }
}

async function wms(nome, def, livelli, versione, punti, px = 256) {
  for (const [luogo, lat, lon] of punti) {
    const z0 = Math.max(def.minZoom ?? 12, 14);
    for (const z of [z0, Math.min(z0 + 2, def.maxNativeZoom ?? 17)]) {
      const { x, y } = tesseraDa(lat, lon, z);
      const r = await scarica(urlTessera({ url: def.url, livelli, versione, crs: def.crs ?? "EPSG:3857", px }, z, x, y));
      console.log(`   ${nome.padEnd(34)} ${luogo.padEnd(9)} z${String(z).padEnd(2)} ${livelli.slice(0, 38).padEnd(38)} ${esito(r)}`);
    }
  }
}

console.log("== mappe di base");
for (const b of BASI) {
  console.log(`-- ${b.id}: ${b.nome}`);
  await tessereXyz(b.id, b.url, b, PUNTI.predefinito.slice(0, 1));
  if (b.urlRipiego) await tessereXyz(b.id + " (ripiego)", b.urlRipiego, b, PUNTI.predefinito.slice(0, 1));
}
console.log("\n== livelli sovrapposti");
for (const d of SOVRAPPOSIZIONI) {
  console.log(`-- ${d.id}: ${d.nome}`);
  const punti = PUNTI[d.id] ?? PUNTI.predefinito;
  if (d.tipo === "tile") await tessereXyz(d.id, d.url, d, punti.slice(0, 1));
  else if (d.famiglia) {
    for (const v of variantiPcn(d.famiglia, punti[0][2]).slice(0, 3)) await wms(`${d.id} ${v.id}`, d, v.livelli, v.versione, punti.slice(0, 1), v.tile);
  } else if (d.tipo === "wms") await wms(d.id, d, d.livelli, d.versione ?? "1.1.1", punti);
  else if (d.tipo === "wms-regione") {
    for (const [reg, prodotti] of Object.entries(d.prodotti)) {
      const mappa = d.modello.replace("LIDAR_<REGIONE>.map", d.mappe[reg]);
      const luogo = reg === "MARCHE" ? [["Fabriano", 43.337, 12.905]] : [["Perugia", 43.11, 12.389]];
      for (const p of prodotti.slice(0, 2)) await wms(`${d.id} ${reg}`, { ...d, url: mappa }, p.livello, "1.1.1", luogo);
    }
  }
}
