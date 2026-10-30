// Ritocca il progetto Android generato da «npx cap add android»:
//  - permessi di posizione (per il pulsante «Vai alla mia posizione»);
//  - traffico http consentito (i servizi del Ministero rispondono in http);
//  - icona dell'app e numero di versione.
// Uso: node applica-android.mjs        Variabili: BUILD_NUMBER (numero di versione), ANDROID_DIR.
import { readFile, writeFile, cp } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const qui = path.dirname(fileURLToPath(import.meta.url));
const radice = path.resolve(qui, "..");
const android = path.resolve(process.env.ANDROID_DIR ?? path.join(qui, "android"));
const app = path.join(android, "app");
const res = path.join(app, "src/main/res");
const manifestPath = path.join(app, "src/main/AndroidManifest.xml");

// 1) Manifest
let manifest = await readFile(manifestPath, "utf8");
const permessi = ["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"];
for (const p of permessi) {
  if (!manifest.includes(p)) manifest = manifest.replace("</manifest>", `    <uses-permission android:name="${p}" />\n</manifest>`);
}
if (!/usesCleartextTraffic/.test(manifest)) manifest = manifest.replace("<application", '<application\n        android:usesCleartextTraffic="true"');
await writeFile(manifestPath, manifest);

// 2) Icona: l'immagine «maskable» ha già i margini di sicurezza richiesti dalle icone adattive
const icona = path.join(radice, "icons", "maskable-512.png");
for (const cartella of readdirSync(res).filter((d) => d.startsWith("mipmap-") && !d.includes("anydpi"))) {
  for (const nome of ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]) {
    if (existsSync(path.join(res, cartella, nome))) await cp(icona, path.join(res, cartella, nome));
  }
}
await writeFile(
  path.join(res, "values", "ic_launcher_background.xml"),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1F3A2E</color>\n</resources>\n',
);

// 3) Versione: numero progressivo e nome dalla versione dell'app
const gradlePath = path.join(app, "build.gradle");
let gradle = await readFile(gradlePath, "utf8");
const versione = JSON.parse(await readFile(path.join(qui, "package.json"), "utf8")).version;
const numero = Number(process.env.BUILD_NUMBER ?? 1) || 1;
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${numero}`).replace(/versionName\s+"[^"]*"/, `versionName "${versione}"`);
await writeFile(gradlePath, gradle);

console.log(`Android pronto: versione ${versione} (${numero}), permessi di posizione, http consentito, icona.`);
