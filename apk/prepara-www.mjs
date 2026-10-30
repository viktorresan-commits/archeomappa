// Prepara la cartella www/ con i file dell'app per il pacchetto Android.
// Rispetto al sito: Leaflet viene preso dal pacchetto npm e messo dentro l'app (così parte
// anche senza rete) e il service worker non viene incluso (nell'app i file sono già nel pacchetto).
// Uso: node prepara-www.mjs        Variabili facoltative: WWW_OUT (cartella di uscita), LEAFLET_DIR.
import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const qui = path.dirname(fileURLToPath(import.meta.url));
const radice = path.resolve(qui, "..");
const uscita = path.resolve(process.env.WWW_OUT ?? path.join(qui, "www"));
const leaflet = path.resolve(process.env.LEAFLET_DIR ?? path.join(qui, "node_modules", "leaflet", "dist"));

const primoEsistente = (cartella, nomi) => {
  const trovato = nomi.map((n) => path.join(cartella, n)).find((p) => existsSync(p));
  if (!trovato) throw new Error(`In ${cartella} non trovo nessuno di questi file: ${nomi.join(", ")}`);
  return trovato;
};

await rm(uscita, { recursive: true, force: true });
await mkdir(path.join(uscita, "vendor", "leaflet"), { recursive: true });

for (const f of ["index.html", "manifest.json"]) await cp(path.join(radice, f), path.join(uscita, f));
for (const d of ["css", "js", "icons"]) await cp(path.join(radice, d), path.join(uscita, d), { recursive: true });

await cp(primoEsistente(leaflet, ["leaflet.js", "leaflet.min.js"]), path.join(uscita, "vendor/leaflet/leaflet.js"));
await cp(primoEsistente(leaflet, ["leaflet.css", "leaflet.min.css"]), path.join(uscita, "vendor/leaflet/leaflet.css"));
await cp(path.join(leaflet, "images"), path.join(uscita, "vendor/leaflet/images"), { recursive: true });

// index.html: Leaflet locale al posto della CDN
const file = path.join(uscita, "index.html");
let html = await readFile(file, "utf8");
const sostituzioni = [
  ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "vendor/leaflet/leaflet.css"],
  ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "vendor/leaflet/leaflet.js"],
];
for (const [da, a] of sostituzioni) {
  if (!html.includes(da)) throw new Error(`In index.html non trovo ${da}: aggiorna prepara-www.mjs`);
  html = html.replaceAll(da, a);
}
await writeFile(file, html);

console.log("www pronta in", uscita);
