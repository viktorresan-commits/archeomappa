// ArcheoMappa Italia: interfaccia. Tutto il testo mostrato è costruito con textContent
// (funzione h), mai con innerHTML, perché una parte dei dati arriva da servizi esterni.

import { haversine, compass, formatDist, projector, delaunay } from "./geo.js";
import { calcolaZone, primeZone, zoneInGeoJSON, PARAMETRI_BASE } from "./potential.js";
import { EPOCHE, profilo } from "./epochs.js";
import {
  CATEGORIE, cercaSitiOSM, cercaLuogo, caricaCapabilities, urlCapabilities,
  wikipediaVicino, wikipediaCerca, commonsCerca, commonsVicino, archiveCerca, europeanaCerca,
} from "./sources.js";
import {
  BASI, SOVRAPPOSIZIONI, SERVIZI_NOTI, creaLivello, risolviLivelli, urlRegione, prodottiRegione,
  ambiente, normalizzaProxy, urlPerAmbiente, usaPcn, urlTessera, tesseraDa,
} from "./layers.js";
import { h, meta, mem, inCsv, scarica, urlSicuro, cacheLeggi, cacheScrivi, cacheSvuota } from "./util.js";
import { iniziaRilievo } from "./rilievo-ui.js";
import { aggiungiRipiegoNativo, provaTessera } from "./tessere.js";
import { variantiConPreferita, scegliVariante, fusoCambiato, zoomDiProva } from "./varianti.js";
import { ordineIniziale, spostaLivello, zIndexDi } from "./ordine.js";
import { creaConfrontoLivelli } from "./tendina.js";
import { creaRilevatore, urlGoogleMaps } from "./tocco-lungo.js";
import { decidiSpegniTutto, ricordatiValidi } from "./interruttore.js";

const VERSIONE = "0.5.2";
let rilievo = null; // scheda «Rilievo» (js/rilievo-ui.js)
const $ = (id) => document.getElementById(id);
const EPOCA = Object.fromEntries(EPOCHE.map((e) => [e.id, e]));
const CAT = Object.fromEntries(CATEGORIE.map((c) => [c.id, c]));
const SETTE_GIORNI = 7 * 24 * 3600 * 1000;

// ------------------------------------------------------------ impostazioni

const IMP_BASE = { modo: "ente", wNear: 30, wMean: 25, wTri: 25, wDens: 20, low: 0.25, high: 0.55, buffer: 700, europeana: "" };
let imp = { ...IMP_BASE, ...mem.get("am.imp", {}) };
const salvaImp = () => mem.set("am.imp", imp);

// ---------------------------------------------------------------- messaggi

let timerToast;
function toast(msg, ms = 3800) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(timerToast);
  timerToast = setTimeout(() => t.classList.remove("on"), ms);
}

function occupato(btn, on) {
  btn.setAttribute("aria-busy", on ? "true" : "false");
  btn.disabled = on;
}

function stato(id, testo, errore = false) {
  const el = $(id);
  el.textContent = testo;
  el.classList.toggle("err", errore);
}

// Unisce frammenti in una frase per riga di stato: iniziale maiuscola e punto finale.
const frase = (parti) => parti.filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(". ") + ".";

// Dopo una ricerca porta lo stato in vista, così chi usa il telefono vede l'esito.
function mostraEsito(id) {
  document.getElementById(id).scrollIntoView({ block: "nearest" });
}

const messaggioErrore = (e) => (e?.message ? e.message : "Errore imprevisto");

// Generalizzazione delle coordinate nella modalità pubblica (circa 1 km).
const pubblica = () => imp.modo === "pubblica";
const gen = (v) => (pubblica() ? Math.round(v * 100) / 100 : v);
const fmtCoord = (lat, lon) => `${gen(lat).toFixed(pubblica() ? 2 : 5)}, ${gen(lon).toFixed(pubblica() ? 2 : 5)}`;

// ------------------------------------------------------------------ dialoghi

function scegli(titolo, opzioni) {
  return new Promise((risolvi) => {
    const dlg = $("chooserDialog");
    $("chooserTitle").textContent = titolo;
    const lista = $("chooserList");
    lista.replaceChildren(
      ...opzioni.map((o) =>
        h("button", { type: "button", class: "btn", onclick: () => chiudi(o.valore) }, o.etichetta),
      ),
    );
    const chiudi = (v) => {
      dlg.close();
      risolvi(v);
    };
    $("btnChooserCancel").onclick = () => chiudi(null);
    dlg.oncancel = () => risolvi(null);
    dlg.showModal();
  });
}

// --------------------------------------------------------------------- mappa

if (!window.L) {
  document.querySelector(".mapwrap").append(
    h("div", { class: "mapmsg" },
      h("p", null, "Non riesco a caricare la libreria della mappa (Leaflet). Controlla la connessione e riapri l'app."),
    ),
  );
  throw new Error("Leaflet non disponibile");
}

const map = L.map("map", { zoomControl: false, preferCanvas: true, worldCopyJump: false, minZoom: 5 });
L.control.zoom({ position: "bottomright", zoomInTitle: "Ingrandisci", zoomOutTitle: "Riduci" }).addTo(map);
L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);

function vistaIniziale() {
  const m = /^#(\d{1,2})\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(location.hash);
  if (m) return { z: Number(m[1]), lat: Number(m[2]), lon: Number(m[3]) };
  return mem.get("am.vista", { z: 6, lat: 42.5, lon: 12.5 });
}
{
  const v = vistaIniziale();
  map.setView([v.lat, v.lon], v.z);
}
map.on("moveend", () => {
  const c = map.getCenter();
  const z = map.getZoom();
  mem.set("am.vista", { z, lat: c.lat, lon: c.lng });
  try {
    history.replaceState(null, "", `#${z}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`);
  } catch { /* ignora */ }
});

new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($("map"));
map.on("zoomend", () => disegnaRapidi());
map.on("moveend", () => controllaFuso());

// Mappe di base
const livelliBase = new Map();
let baseAttiva = mem.get("am.base", "osm");
if (!BASI.some((b) => b.id === baseAttiva)) baseAttiva = "osm";
for (const b of BASI) livelliBase.set(b.id, creaLivello(L, { ...b, tipo: "tile" }));
livelliBase.get(baseAttiva).addTo(map);

function cambiaBase(id) {
  if (sessioneConfronto && !confrontoOccupato) fermaConfronto(); // la mappa di base cambia: il confronto finisce (la parte sincrona rimette la base)
  if (id === baseAttiva) return;
  map.removeLayer(livelliBase.get(baseAttiva));
  baseAttiva = id;
  livelliBase.get(baseAttiva).addTo(map).bringToBack();
  mem.set("am.base", baseAttiva);
  disegnaBasi();
}

function disegnaBasi() {
  $("baseList").replaceChildren(
    ...BASI.map((b) => {
      const id = "base-" + b.id;
      const r = h("input", { type: "radio", name: "base", id, checked: b.id === baseAttiva ? true : null, onchange: () => cambiaBase(b.id) });
      return h("div", { class: "opt" }, h("label", { for: id }, r, h("span", null, b.nome, b.nota ? h("span", { class: "nota" }, b.nota) : null)));
    }),
  );
  disegnaRapidi();
}

// ------------------------------------------------------------ livelli sovrapposti

const sovr = new Map(); // id -> { def, layer, on, opacita, stato }
const adattaUrl = (url) => urlPerAmbiente(url, { proxy: mem.get("am.proxyPcn", "") });
const nomeRegione = (x) => x.replaceAll("_", " ").toLowerCase().replace(/^\w|\s\w/g, (m) => m.toUpperCase());
const salvati = mem.get("am.sovr", {});
const personalizzati = mem.get("am.wmsCustom", []);

function registraSovr(def) {
  const s = salvati[def.id] ?? {};
  sovr.set(def.id, {
    def,
    layer: null,
    on: false,
    opacita: s.opacita ?? def.opacita ?? 1,
    wantOn: !!s.on,
    stato: def.daVerificare ? "da verificare" : "",
    salute: "", // esito dell'ultima verifica: «risponde», «non risponde», «non verificabile»
    errori: 0,
    avvisato: false, // l'avviso per le tessere in errore compare una volta sola, non a ogni zoom
    problema: false, // il livello ha dato errori: lo si vede anche sul pulsante della mappa
    occupato: false, // sta scegliendo il formato di richiesta o costruendo il livello
    variante: null, // formato di richiesta scelto (livelli con famiglia di fusi): {id, etichetta, versione, livelli, tile, fuso}
    esitiVarianti: [],
    urlEffettivo: adattaUrl(def.url),
    livelliEffettivi: def.livelli,
  });
}
SOVRAPPOSIZIONI.forEach(registraSovr);
personalizzati.forEach(registraSovr);

// ordine dei livelli: il primo dell'elenco sta sopra tutti gli altri sulla mappa (ricordato fra una sessione e l'altra)
// «am.ordine2»: l'ordine salvato dalla 0.5.0 («am.ordine») metteva «Ombre» sopra il LiDAR e viene lasciato da parte
let ordineSovr = ordineIniziale([...sovr.keys()], mem.get("am.ordine2", null));
const salvaOrdine = () => mem.set("am.ordine2", ordineSovr);

// «Spegni tutto» è un interruttore: i livelli che spegne si ricordano, per riaccenderli al tocco successivo
let spentiDa = ricordatiValidi(mem.get("am.spenti", []), new Set(sovr.keys()));
const salvaSpenti = () => mem.set("am.spenti", spentiDa);
function applicaOrdine() {
  for (const r of sovr.values()) r.layer?.setZIndex?.(zIndexDi(ordineSovr, r.def.id));
}
function muoviLivello(r, direzione) {
  const accesi = new Set([...sovr.values()].filter((x) => x.on).map((x) => x.def.id));
  ordineSovr = spostaLivello(ordineSovr, r.def.id, direzione, accesi);
  salvaOrdine();
  applicaOrdine();
  disegnaSovr();
}

function salvaSovr() {
  const o = {};
  for (const [id, r] of sovr) o[id] = { on: r.on, opacita: r.opacita };
  mem.set("am.sovr", o);
}

/** Prima le regioni di cui si conoscono i livelli, poi le altre in ordine alfabetico. */
function elencoRegioni(d) {
  const note = d.regioni.filter((x) => d.prodotti?.[x]);
  const altre = d.regioni.filter((x) => !d.prodotti?.[x]).sort();
  return [
    ...note.map((x) => ({ etichetta: nomeRegione(x), valore: x })),
    ...altre.map((x) => ({ etichetta: `${nomeRegione(x)} (da verificare)`, valore: x })),
  ];
}

function messaggioTessere(r) {
  if (r.messaggio) return `«${r.def.nome}»: ${r.messaggio}. Tocca «Perché non si vede?» qui sotto per i dettagli.`;
  if (usaPcn(r.urlEffettivo) && !ambiente().httpConsentito) {
    return `«${r.def.nome}»: il servizio del Ministero non risponde da una pagina https. Usa l'app Android oppure imposta un proxy (riquadro «Servizi del Ministero» qui sotto).`;
  }
  return `«${r.def.nome}» non risponde in quest'area o a questo ingrandimento. Tocca «Perché non si vede?» qui sotto per i dettagli.`;
}

/** Regione e livello del LiDAR: usa la scelta salvata, altrimenti la chiede. Restituisce false se annullata. */
async function sceglieLidar(r) {
  const d = r.def;
  const regione = mem.get("am.lidarRegione", null) ?? (await scegli("Scegli la regione", elencoRegioni(d)));
  if (!regione) return false;
  r.urlEffettivo = adattaUrl(urlRegione(d, regione));
  const prodotti = prodottiRegione(d, regione);
  let prodotto = null;
  if (prodotti.length) {
    const salvato = mem.get("am.lidarLivello", null);
    prodotto = prodotti.find((p) => p.livello === salvato) ?? (prodotti.length === 1 ? prodotti[0] : null);
    if (!prodotto) {
      const scelto = await scegli("Quale livello?", prodotti.map((q) => ({ etichetta: q.nome, valore: q.livello })));
      prodotto = prodotti.find((p) => p.livello === scelto) ?? null;
    }
    if (!prodotto) return false;
    r.livelliEffettivi = prodotto.livello;
    mem.set("am.lidarLivello", prodotto.livello);
  } else {
    toast("Leggo i livelli del servizio…");
    r.livelliEffettivi = await risolviLivelli({ scegli: /lidar|dtm|dsm|ombr|hillshade/i }, r.urlEffettivo);
  }
  mem.set("am.lidarRegione", regione);
  r.stato = `${nomeRegione(regione)}${prodotto ? " – " + prodotto.nome.replace(/ \(consigliato\)/, "") : ""}`;
  return true;
}

/** Per la scheda Rilievo: indirizzo e livello del LiDAR scelto nei Livelli (lo chiede se manca). */
async function sorgenteLidar() {
  const r = sovr.get("lidar");
  if (!r) return null;
  const scelta = mem.get("am.lidarRegione", null);
  if (!scelta || !r.livelliEffettivi) {
    if (!(await sceglieLidar(r))) return null;
    disegnaSovr();
  } else {
    r.urlEffettivo = adattaUrl(urlRegione(r.def, scelta)); // il proxy può essere cambiato
  }
  return { base: r.urlEffettivo, livello: r.livelliEffettivi, nome: `LiDAR ${r.stato}` };
}

/** Testo «Marche – DTM 1 m» della scelta salvata, senza chiedere nulla. */
function fonteLidar() {
  const regione = mem.get("am.lidarRegione", null);
  if (!regione) return "";
  const d = sovr.get("lidar")?.def;
  const livello = mem.get("am.lidarLivello", null);
  const p = d ? prodottiRegione(d, regione).find((x) => x.livello === livello) : null;
  return `${nomeRegione(regione)}${p ? " – " + p.nome.replace(/ \(consigliato\)/, "") : ""}`;
}

async function cambiaFonteLidar() {
  const r = sovr.get("lidar");
  if (r) await cambiaRegione(r);
}

// ---- livelli del Ministero con un livello per fuso (ortofoto, IGM): il formato di richiesta si sceglie provando

/** Tessera di prova di una variante: quella al centro della mappa, allo zoom z (di norma uno a cui il livello disegna davvero). */
function urlProvaVariante(r, v, z) {
  const zt = v.tile === 512 ? Math.max(0, z - 1) : z; // un'immagine da 512 px copre l'area di una tessera da 256 allo zoom precedente
  const c = map.getCenter();
  const { x, y } = tesseraDa(c.lat, c.lng, zt);
  return urlTessera({ url: r.urlEffettivo, livelli: v.livelli, versione: v.versione, px: v.tile }, zt, x, y);
}

/**
 * Prova le varianti una dopo l'altra e si ferma alla prima che dà un'immagine non vuota. Se tutte rispondono con
 * un'immagine vuota (il servizio non disegna a quell'ingrandimento) ripete la prova a ingrandimenti più alti;
 * se rispondono con errori non ha senso ripeterla, perché l'errore non dipende dall'ingrandimento.
 */
async function provaVarianti(r, { tutte = false } = {}) {
  const elenco = variantiConPreferita(r.def.famiglia, map.getCenter().lng, mem.get("am.variante." + r.def.id, null));
  let esiti = [];
  for (const z of zoomDiProva(map.getZoom(), r.def)) {
    esiti = [];
    for (const v of elenco) {
      const e = await provaTessera({ url: urlProvaVariante(r, v, z), win: window });
      esiti.push({ variante: v, zoomProva: z, ...e });
      if (e.ok && !e.vuota && !tutte) break;
    }
    if (esiti.some((e) => e.ok && !e.vuota) || !esiti.some((e) => e.ok)) break;
  }
  return esiti;
}

/** Sceglie (provando) il formato di richiesta. Restituisce true se un formato risponde con un'immagine. */
async function assicuraVariante(r, { forza = false } = {}) {
  if (r.variante && !forza) return true;
  const esiti = await provaVarianti(r);
  r.esitiVarianti = esiti;
  const { variante, stato } = scegliVariante(esiti);
  r.messaggio = "";
  if (!variante) {
    r.variante = null;
    r.livelliEffettivi = undefined;
    r.salute = "non risponde";
    r.messaggio = esiti[0]?.dettaglio ?? "";
    return false;
  }
  r.variante = variante;
  r.livelliEffettivi = variante.livelli;
  mem.set("am.variante." + r.def.id, variante.id);
  r.salute = stato === "ok" ? "risponde" : "risponde, ma senza immagine qui";
  return true;
}

/** Per il confronto con l'ortofoto del Ministero: servizio e formato di richiesta scelti (o il primo, se non ancora provati). */
function fonteWmsOrtofoto(lon) {
  const r = sovr.get("ortofoto");
  if (!r?.def.famiglia) return null;
  const idPref = r.variante?.id ?? mem.get("am.variante.ortofoto", null);
  const v = variantiConPreferita(r.def.famiglia, lon ?? map.getCenter().lng, idPref)[0];
  return { url: r.urlEffettivo, livelli: v.livelli, versione: v.versione, tile: v.tile };
}

function messaggioVarianti(r) {
  if (usaPcn(r.urlEffettivo) && !ambiente().httpConsentito) return messaggioTessere(r);
  const n = r.esitiVarianti.length;
  const primo = r.esitiVarianti[0]?.dettaglio;
  return `«${r.def.nome}»: nessuno dei ${n} formati di richiesta provati ha restituito un'immagine.${primo ? ` Messaggio del servizio: ${primo}.` : ""} Tocca «Perché non si vede?» per l'elenco completo.`;
}

async function costruisciLivelloSovr(r) {
  const d = r.def;
  if (d.tipo === "wms-regione") {
    if (!(await sceglieLidar(r))) return null;
  } else if (d.famiglia) {
    if (!(await assicuraVariante(r))) {
      r.problema = true;
      toast(messaggioVarianti(r), 12000);
      return null;
    }
  } else if (d.tipo === "wms" && !r.livelliEffettivi) {
    toast("Leggo i livelli del servizio…");
    r.livelliEffettivi = await risolviLivelli(d, r.urlEffettivo);
  }
  const v = r.variante;
  const layer = creaLivello(L, d, { url: r.urlEffettivo, livelli: r.livelliEffettivi, versione: v?.versione, tileSize: v?.tile });
  layer.setOpacity(r.opacita);
  layer.setZIndex(zIndexDi(ordineSovr, d.id));
  if (d.tipo !== "tile") {
    r.ok = 0; r.nativo = 0; r.messaggio = r.messaggio ?? "";
    aggiungiRipiegoNativo(layer, { win: window, stato: r });
    layer.on("tileerror", () => {
      // un solo avviso per livello: zoomando i fallimenti si ripetono e un messaggio a ogni zoom disturba soltanto
      if (++r.errori >= 4 && !r.avvisato) {
        r.avvisato = true;
        r.problema = true;
        toast(messaggioTessere(r), 9000);
        disegnaSovr();
      }
    });
    layer.on("tileload", () => { r.errori = 0; });
  }
  return layer;
}

/** Accende o spegne un livello sovrapposto (dalla lista dei Livelli o dai pulsanti sulla mappa). */
async function alternaSovr(r, acceso) {
  if (sessioneConfronto && !confrontoOccupato) {
    await fermaConfronto(); // l'utente cambia i livelli: il confronto finisce e i livelli tornano come prima
    if (r.on === acceso) return;
  }
  if (r.occupato) return;
  if (!acceso) {
    if (r.layer) map.removeLayer(r.layer);
    r.on = false;
    salvaSovr();
    disegnaSovr();
    return;
  }
  if (r.on) return;
  r.occupato = true;
  r.avvisato = false;
  r.problema = false;
  disegnaSovr();
  try {
    if (!r.layer) r.layer = await costruisciLivelloSovr(r);
    if (!r.layer) return;
    r.layer.addTo(map);
    r.on = true;
    if (r.def.minZoom && map.getZoom() < r.def.minZoom) toast(`«${r.def.nome}» si vede da ingrandimento ${r.def.minZoom}.`);
  } catch (e) {
    r.on = false;
    r.stato = "non risponde";
    r.problema = true;
    toast(r.def.id === "lidar"
      ? `«${r.def.nome}»: ${messaggioErrore(e)}. Per usare il LiDAR carica un file (GeoTIFF) nella scheda Rilievo.`
      : `«${r.def.nome}»: ${messaggioErrore(e)}. Se conosci il nome del livello, aggiungilo a mano da «Aggiungi un servizio WMS».`, 8000);
  } finally {
    r.occupato = false;
    salvaSovr();
    disegnaSovr();
  }
}

/** Passando in un altro fuso UTM i livelli a fuso singolo chiedono il livello sbagliato: li sceglie di nuovo. */
let timerFuso;
function controllaFuso() {
  clearTimeout(timerFuso);
  timerFuso = setTimeout(async () => {
    const lon = map.getCenter().lng;
    for (const r of sovr.values()) {
      if (!r.def.famiglia || !r.on || r.occupato || !fusoCambiato(r.variante, lon)) continue;
      r.occupato = true;
      try {
        if (r.layer) map.removeLayer(r.layer);
        r.layer = null;
        r.variante = null;
        const buona = await assicuraVariante(r, { forza: true });
        if (buona) {
          r.layer = await costruisciLivelloSovr(r);
          r.layer?.addTo(map);
        }
        r.on = !!r.layer;
      } finally {
        r.occupato = false;
        disegnaSovr();
      }
    }
  }, 900);
}

async function cambiaRegione(r) {
  if (r.layer) map.removeLayer(r.layer);
  r.layer = null;
  r.on = false;
  r.stato = "";
  mem.del("am.lidarRegione");
  mem.del("am.lidarLivello");
  disegnaSovr();
  await alternaSovr(r, true);
}

/** Il proxy è cambiato: i livelli del Ministero vanno ricostruiti con il nuovo indirizzo. */
function riapplicaProxy() {
  const daRiaccendere = [];
  for (const r of sovr.values()) {
    if (!(r.def.tipo === "wms-regione" || usaPcn(r.def.url))) continue;
    if (r.on) daRiaccendere.push(r);
    if (r.layer) map.removeLayer(r.layer);
    r.layer = null;
    r.on = false;
    r.errori = 0;
    r.salute = "";
    r.variante = null;
    r.urlEffettivo = adattaUrl(r.def.url);
    r.livelliEffettivi = r.def.famiglia ? undefined : r.def.livelli;
  }
  disegnaSovr();
  for (const r of daRiaccendere) alternaSovr(r, true);
}

function iniziaProxy() {
  const campo = $("proxyPcn");
  const msg = $("proxyMsg");
  if (ambiente().nativa) $("boxProxy").hidden = true; // nell'app Android non serve
  campo.value = mem.get("am.proxyPcn", "");
  const applica = (valore) => {
    const v = normalizzaProxy(valore);
    if (valore.trim() && !v) {
      msg.textContent = "L'indirizzo deve essere completo e iniziare con https://";
      return;
    }
    if (v) mem.set("am.proxyPcn", v); else mem.del("am.proxyPcn");
    campo.value = v;
    riapplicaProxy();
    msg.textContent = v ? "Proxy salvato: i livelli del Ministero ora passano da lì." : "Proxy tolto.";
  };
  $("btnProxy").addEventListener("click", () => applica(campo.value));
  $("btnProxyNo").addEventListener("click", () => applica(""));
}

function rimuoviPersonalizzato(r) {
  if (r.layer) map.removeLayer(r.layer);
  sovr.delete(r.def.id);
  ordineSovr = ordineSovr.filter((x) => x !== r.def.id);
  salvaOrdine();
  personalizzati.splice(0, personalizzati.length, ...personalizzati.filter((p) => p.id !== r.def.id));
  mem.set("am.wmsCustom", personalizzati);
  salvaSovr();
  disegnaSovr();
}

function disegnaSovr() {
  const nelOrdine = ordineSovr.map((id) => sovr.get(id)).filter(Boolean);
  $("overlayList").replaceChildren(
    ...nelOrdine.map((r, i) => {
      const id = "ov-" + r.def.id;
      const cb = h("input", { type: "checkbox", id, checked: r.on || r.occupato ? true : null, disabled: r.occupato ? true : null });
      cb.addEventListener("change", () => alternaSovr(r, cb.checked));
      const classeSalute = r.salute === "risponde" ? "stato ok" : r.salute === "non risponde" ? "stato ko" : "stato";
      return h("div", { class: "opt" },
        h("label", { for: id }, cb,
          h("span", null, r.def.nome,
            r.def.nota ? h("span", { class: "nota" }, r.def.nota) : null,
            r.variante ? h("span", { class: "nota" }, `Formato di richiesta scelto: ${r.variante.etichetta}.`) : null)),
        r.stato ? h("span", { class: r.stato === "non risponde" ? "stato ko" : "stato" }, r.stato) : null,
        r.salute ? h("span", { class: classeSalute }, r.salute) : null,
        r.problema && !r.salute ? h("span", { class: "stato ko" }, "errori nelle tessere") : null,
        r.on
          ? h("input", {
              type: "range", min: "0.1", max: "1", step: "0.05", value: String(r.opacita), "aria-label": `Trasparenza di ${r.def.nome}`,
              oninput: (e) => { r.opacita = Number(e.target.value); r.layer?.setOpacity(r.opacita); },
              onchange: salvaSovr,
            })
          : null,
        r.def.custom ? h("button", { type: "button", class: "link", "aria-label": `Rimuovi ${r.def.nome}`, onclick: () => rimuoviPersonalizzato(r) }, "Rimuovi") : null,
        r.def.tipo === "wms-regione" && mem.get("am.lidarRegione", null)
          ? h("button", { type: "button", class: "link", onclick: () => cambiaRegione(r) }, "Cambia zona o livello")
          : null,
        h("div", { class: "ord", role: "group", "aria-label": `Posizione di ${r.def.nome}` },
          h("button", {
            type: "button", class: "ordbtn", title: "Porta sopra", "aria-label": `Porta «${r.def.nome}» più in alto`,
            disabled: i === 0 ? true : null, onclick: () => muoviLivello(r, -1),
          }, "▲"),
          h("button", {
            type: "button", class: "ordbtn", title: "Porta sotto", "aria-label": `Porta «${r.def.nome}» più in basso`,
            disabled: i === nelOrdine.length - 1 ? true : null, onclick: () => muoviLivello(r, 1),
          }, "▼")),
      );
    }),
  );
  disegnaRapidi();
}

// ------------------------------------------------- pulsanti sulla mappa

const BASE_BREVE = { osm: "Mappa", topo: "Rilievo", sat: "Satellite", cyclosm: "CyclOSM", hot: "Umanitaria", voyager: "Voyager", positron: "Positron", s2: "Sentinel-2" };

/** Apre l'elenco delle mappe di base, perché con otto mappe scorrerle una alla volta non è comodo. */
async function scegliBase() {
  const id = await scegli("Mappa di base", BASI.map((b) => ({ etichetta: b.id === baseAttiva ? `✓ ${b.nome}` : b.nome, valore: b.id })));
  if (id) cambiaBase(id);
}

/**
 * Interruttore del tasto tondo: spegne tutti i livelli sovrapposti accesi (le mappe di base restano) e ne ricorda
 * l'elenco; se non ce ne sono di accesi, riaccende quelli che aveva spento.
 */
async function alternaTutti() {
  if (sessioneConfronto && !confrontoOccupato) await fermaConfronto(); // il confronto usa dei livelli: finisce prima
  const accesi = [...sovr.values()].filter((r) => r.on);
  const { azione, ids } = decidiSpegniTutto(accesi.map((r) => r.def.id), spentiDa);
  if (azione === "spegni") {
    for (const r of accesi) {
      if (r.layer) map.removeLayer(r.layer);
      r.on = false;
    }
    spentiDa = ids;
    salvaSpenti();
    salvaSovr();
    disegnaSovr();
    toast("Livelli spenti. Tocca di nuovo il tasto per riaccenderli.");
  } else if (azione === "riaccendi") {
    spentiDa = [];
    salvaSpenti();
    disegnaRapidi();
    for (const id of ids) {
      const r = sovr.get(id);
      if (r && !r.on) await alternaSovr(r, true); // uno alla volta: il LiDAR può chiedere la zona
    }
    toast("Livelli riaccesi.");
  }
}

/** Barra di pulsanti sopra la mappa: accende e spegne i livelli senza aprire il pannello Livelli. */
function disegnaRapidi() {
  const barra = $("quick");
  if (!barra) return;
  const spegni = $("btnSpegni");
  if (spegni) {
    const accesi = [...sovr.values()].some((r) => r.on);
    const riaccende = !accesi && spentiDa.length > 0;
    const testo = accesi ? "Spegni tutti i livelli sovrapposti" : riaccende ? "Riaccendi i livelli spenti" : "Nessun livello sovrapposto acceso";
    spegni.disabled = !accesi && !riaccende;
    spegni.classList.toggle("riaccendi", riaccende); // stessa icona, senza la barra che la taglia
    spegni.title = testo;
    spegni.setAttribute("aria-label", testo);
  }
  const z = map.getZoom();
  const rapidi = [...sovr.values()].filter((r) => r.def.rapido);
  const nomeBase = BASE_BREVE[baseAttiva] ?? baseAttiva;
  barra.replaceChildren(
    h("button", { type: "button", class: "chip", title: "Scegli la mappa di base", "aria-label": `Mappa di base: ${nomeBase}. Tocca per sceglierne un'altra`, onclick: scegliBase }, `Base: ${nomeBase}`),
    ...rapidi.map((r) => {
      const fuori = r.on && r.def.minZoom && z < r.def.minZoom;
      const nome = r.def.etichettaRapida ?? r.def.nome;
      return h("button", {
        type: "button", class: "chip" + (r.problema ? " avviso" : "") + (fuori ? " fuori" : ""),
        "aria-pressed": r.on ? "true" : "false", "aria-busy": r.occupato ? "true" : null, disabled: r.occupato ? true : null,
        title: fuori ? `${r.def.nome}: si vede da ingrandimento ${r.def.minZoom}` : r.problema ? `${r.def.nome}: il servizio ha dato errori` : r.def.nome,
        "aria-label": `${r.def.nome}: ${r.on ? "acceso" : "spento"}${fuori ? `, si vede da ingrandimento ${r.def.minZoom}` : ""}${r.problema ? ", con errori" : ""}`,
        onclick: () => alternaSovr(r, !r.on),
      }, nome, fuori ? ` (zoom ${r.def.minZoom}+)` : null, r.problema ? " !" : null);
    }),
    h("button", {
      type: "button", class: "chip", "aria-pressed": confrontoLivelli.attivo ? "true" : "false",
      title: "Confronta due livelli con un cursore o a lampeggio",
      onclick: () => (confrontoLivelli.attivo ? fermaConfronto() : apriConfronto()),
    }, confrontoLivelli.attivo ? "Ferma confronto" : "Confronta"),
  );
}

// ------------------------------------------- confronto a mano fra due livelli (cursore a tendina, lampeggio)

const confrontoLivelli = creaConfrontoLivelli({ map });
let sessioneConfronto = null; // {accesi, baseTolta, baseAggiunte, sovrUsati}
let confrontoOccupato = false; // vero mentre l'app stessa accende e spegne livelli per il confronto

const opzioniConfronto = () => [
  ...BASI.map((b) => ({ id: "base:" + b.id, nome: b.nome })),
  ...[...sovr.values()].map((r) => ({ id: r.def.id, nome: r.def.nome })),
];

/** Riempie i due elenchi del confronto, tenendo le scelte già fatte (o l'ultima salvata). */
function riempiConfronto() {
  const elenco = opzioniConfronto();
  const salvato = mem.get("am.confronto", { a: "base:sat", b: "igm25" });
  for (const [campo, chiave, predefinito] of [["cmpA", "a", "base:sat"], ["cmpB", "b", "igm25"]]) {
    const el = $(campo);
    if (!el) continue;
    const corrente = el.value || salvato[chiave];
    el.replaceChildren(...elenco.map((o) => h("option", { value: o.id }, o.nome)));
    el.value = elenco.some((o) => o.id === corrente) ? corrente : predefinito;
  }
}

function aggiornaBarraConfronto() {
  const c = confrontoLivelli;
  $("cmpBarra").hidden = !c.attivo;
  $("btnSpegni")?.classList.toggle("alto", c.attivo); // la barra del confronto sta in basso: il tasto si alza
  if (c.attivo) {
    $("cmpEtichetta").textContent = c.etichetta();
    $("btnCmpModo").textContent = c.modo === "tendina" ? "Passa al lampeggio" : "Passa al cursore";
    $("btnCmpPausa").hidden = $("btnCmpScambia").hidden = c.modo !== "lampeggio";
    $("btnCmpPausa").textContent = c.inPausa ? "Riprendi" : "Pausa";
  }
  disegnaRapidi();
}

function apriConfronto() {
  mostraScheda("layers");
  $("boxConfronta").open = true;
  statoSheet("half");
  $("boxConfronta").scrollIntoView?.({ block: "start", behavior: "smooth" });
}

async function avviaConfronto(modo) {
  const idA = $("cmpA").value, idB = $("cmpB").value;
  const msg = $("cmpMsg");
  if (idA === idB) { msg.textContent = "Scegli due livelli diversi."; return; }
  mem.set("am.confronto", { a: idA, b: idB });
  await fermaConfronto();
  confrontoOccupato = true;
  msg.textContent = "Preparo i due livelli…";
  const s = { accesi: [...sovr.values()].filter((r) => r.on).map((r) => r.def.id), baseTolta: livelliBase.get(baseAttiva), baseAggiunte: [], sovrUsati: [] };
  sessioneConfronto = s;
  try {
    // si vedono solo i due livelli scelti: gli altri e la mappa di base si tolgono e tornano alla fine
    for (const r of sovr.values()) if (r.on) { if (r.layer) map.removeLayer(r.layer); r.on = false; }
    map.removeLayer(s.baseTolta);
    const prendi = async (id) => {
      if (id.startsWith("base:")) {
        const l = livelliBase.get(id.slice(5));
        l.addTo(map).bringToBack();
        s.baseAggiunte.push(l);
        return { nome: BASI.find((b) => b.id === id.slice(5))?.nome ?? id, layer: l };
      }
      const r = sovr.get(id);
      if (!r) return null;
      await alternaSovr(r, true);
      if (!r.on || !r.layer) return null;
      s.sovrUsati.push(r);
      return { nome: r.def.nome, layer: r.layer };
    };
    const A = await prendi(idA);
    const B = A ? await prendi(idB) : null;
    if (!A || !B) {
      confrontoOccupato = false;
      await fermaConfronto();
      msg.textContent = "Uno dei due livelli non risponde: guarda l'avviso e prova con «Perché non si vede?».";
      return;
    }
    confrontoLivelli.avvia({ a: A, b: B, modo, quando: aggiornaBarraConfronto });
    const minimi = [idA, idB].map((id) => sovr.get(id)?.def.minZoom ?? 0);
    const serve = Math.max(...minimi);
    msg.textContent = serve && map.getZoom() < serve ? `Ingrandisci la mappa (da ingrandimento ${serve}) per vedere entrambi i livelli.` : "";
    aggiornaBarraConfronto();
    statoSheet("closed");
  } finally {
    confrontoOccupato = false;
  }
}

/** Chiude il confronto e rimette mappa di base e livelli come prima. La parte che rimette la base è sincrona. */
async function fermaConfronto() {
  confrontoLivelli.ferma();
  const s = sessioneConfronto;
  sessioneConfronto = null;
  if (!s) { aggiornaBarraConfronto(); return; }
  const era = confrontoOccupato;
  confrontoOccupato = true;
  try {
    for (const l of s.baseAggiunte) map.removeLayer(l);
    livelliBase.get(baseAttiva).addTo(map).bringToBack();
    for (const r of s.sovrUsati) { if (r.layer) map.removeLayer(r.layer); r.on = false; }
    aggiornaBarraConfronto();
    for (const id of s.accesi) {
      const r = sovr.get(id);
      if (r && !r.on) await alternaSovr(r, true);
    }
  } finally {
    confrontoOccupato = era;
    salvaSovr();
    disegnaSovr();
    aggiornaBarraConfronto();
  }
}

function iniziaConfronto() {
  riempiConfronto();
  $("btnCmpTendina").addEventListener("click", () => avviaConfronto("tendina"));
  $("btnCmpLampeggio").addEventListener("click", () => avviaConfronto("lampeggio"));
  $("btnCmpModo").addEventListener("click", () => confrontoLivelli.impostaModo(confrontoLivelli.modo === "tendina" ? "lampeggio" : "tendina"));
  $("btnCmpPausa").addEventListener("click", () => (confrontoLivelli.inPausa ? confrontoLivelli.riprendi() : confrontoLivelli.pausa()));
  $("btnCmpScambia").addEventListener("click", () => confrontoLivelli.scambia());
  $("btnCmpFerma").addEventListener("click", () => fermaConfronto());
}

/** Tessera di prova di un livello: quella al centro della mappa, a un ingrandimento in cui il livello risponde. */
function urlProvaTessera(r) {
  const d = r.def;
  const z = Math.max(d.minZoom ?? 0, Math.min(map.getZoom(), d.maxNativeZoom ?? 19));
  const c = map.getCenter();
  const { x, y } = tesseraDa(c.lat, c.lng, z);
  return urlTessera({ url: r.urlEffettivo, livelli: r.livelliEffettivi, versione: d.versione ?? "1.3.0", crs: d.crs ?? "EPSG:3857" }, z, x, y);
}

/** Ricostruisce il livello acceso con la variante appena scelta. */
async function ricostruisciLivello(r) {
  if (r.layer) map.removeLayer(r.layer);
  r.layer = await costruisciLivelloSovr(r);
  if (r.layer) r.layer.addTo(map); else r.on = false;
}

/**
 * «Verifica servizi» / «Perché non si vede?»: per ogni servizio WMS chiede la tessera vera al centro della mappa
 * e racconta che cosa risponde (anche il messaggio del servizio, se è un errore), con miniatura e indirizzo.
 * Per i livelli con un livello per fuso (ortofoto, IGM) prova tutti i formati di richiesta e usa il primo che funziona.
 */
async function verificaServizi() {
  const btns = [$("btnProbe"), $("btnDiag")];
  btns.forEach((b) => occupato(b, true));
  const box = $("diagMsg");
  $("probeMsg").textContent = "Provo i servizi al centro della mappa…";
  box.replaceChildren();
  const wms = [...sovr.values()].filter((r) => r.def.tipo !== "tile");
  const schede = [];
  let ok = 0;
  try {
    for (const r of wms) {
      let e = null;
      let nota = "";
      let righe = [];
      r.avvisato = false;
      try {
        if (r.def.tipo === "wms-regione") {
          if (!mem.get("am.lidarRegione", null)) throw Object.assign(new Error("regione non ancora scelta"), { sceltaMancante: true });
          if (!r.livelliEffettivi) await sceglieLidar(r);
          else r.urlEffettivo = adattaUrl(urlRegione(r.def, mem.get("am.lidarRegione", null)));
          e = await provaTessera({ url: urlProvaTessera(r), win: window });
        } else if (r.def.famiglia) {
          const esiti = await provaVarianti(r, { tutte: true });
          r.esitiVarianti = esiti;
          righe = esiti.map((x) => ({ ok: x.ok && !x.vuota, testo: `${x.variante.id}. ${x.variante.etichetta} (zoom ${x.zoomProva}): ${x.ok ? (x.vuota ? "risponde ma l'immagine è vuota" : "immagine ricevuta") : x.dettaglio}.` }));
          const { variante, stato } = scegliVariante(esiti);
          if (variante) {
            const cambiata = r.variante?.id !== variante.id;
            r.variante = variante;
            r.livelliEffettivi = variante.livelli;
            mem.set("am.variante." + r.def.id, variante.id);
            e = esiti.find((x) => x.variante.id === variante.id);
            nota = `Formato scelto: ${variante.etichetta}${stato === "vuota" ? ". Nessun formato ha disegnato qualcosa in questo punto: avvicinati o sposta la mappa" : ""}.`;
            if (cambiata && r.on) await ricostruisciLivello(r);
          } else {
            r.variante = null;
            e = { ...esiti[0], ok: false };
            nota = "Nessun formato di richiesta ha restituito un'immagine. Se il messaggio parla di file di indici (msShapefileOpen), il guasto è sul server del Ministero.";
          }
        } else {
          if (!r.livelliEffettivi) r.livelliEffettivi = await risolviLivelli(r.def, r.urlEffettivo);
          e = await provaTessera({ url: urlProvaTessera(r), win: window });
        }
        r.salute = e.ok ? (e.vuota ? "risponde, ma senza immagine qui" : "risponde") : "non risponde";
        r.problema = !e.ok;
        if (e.ok) ok++;
      } catch (err) {
        r.salute = err.sceltaMancante ? "scegli la regione" : "non verificabile";
        nota = err.sceltaMancante ? "Accendi il livello una volta per scegliere regione e livello, poi riprova." : `L'elenco dei livelli non è leggibile da qui: ${messaggioErrore(err)}.`;
      }
      if (r.stato === "da verificare" && e) r.stato = "";
      schede.push(h("div", { class: "card" },
        h("div", { class: "pt" }, `${r.def.nome}${r.stato ? " – " + r.stato : ""}`),
        e
          ? h("div", { class: e.ok ? "pm" : "pm stato ko" }, e.ok ? `Risponde: ${e.dettaglio}.` : `Non risponde bene: ${e.dettaglio}.`)
          : null,
        nota ? h("div", { class: "hint" }, nota) : null,
        righe.length ? h("details", null, h("summary", null, `Formati provati (${righe.length})`), ...righe.map((x) => h("div", { class: x.ok ? "hint" : "hint stato ko" }, x.testo))) : null,
        e ? h("div", { class: "hint" }, `Prova fatta con: ${e.via}.${r.on ? ` Tessere mostrate finora: ${r.ok ?? 0}${r.nativo ? ` (${r.nativo} con il ripiego dell'app)` : ""}.` : ""}${r.messaggio ? " Ultimo messaggio: " + r.messaggio + "." : ""}`) : null,
        e?.miniatura ? h("img", { src: e.miniatura, alt: "Tessera ricevuta dal servizio", width: "96", height: "96", style: "background:#888;border:1px solid #666;margin:4px 0" }) : null,
        e ? h("details", null, h("summary", null, "Indirizzo provato"), h("code", { style: "word-break:break-all;font-size:11px" }, e.url)) : null,
      ));
    }
  } catch (err) {
    schede.push(h("p", { class: "hint" }, `Prova non riuscita: ${messaggioErrore(err)}`));
  } finally {
    disegnaSovr();
    box.replaceChildren(...schede);
    btns.forEach((b) => occupato(b, false));
    $("probeMsg").textContent = `${ok} su ${wms.length} rispondono con un'immagine alla tessera al centro della mappa. «Risponde» non garantisce che ci siano dati in ogni zona.`;
  }
}

// ---------------------------------------------------------- servizio WMS manuale

function iniziaWms() {
  iniziaProxy();
  const sel = $("wmsKnown");
  sel.replaceChildren(h("option", { value: "" }, "— scegli un servizio —"), ...SERVIZI_NOTI.map((s) => h("option", { value: s.url }, s.nome)));
  sel.addEventListener("change", () => {
    $("wmsUrl").value = sel.value;
    if (sel.value) $("wmsName").value = SERVIZI_NOTI.find((s) => s.url === sel.value)?.nome.split(" (")[0] ?? "";
  });

  $("btnCaps").addEventListener("click", async () => {
    const url = urlSicuro($("wmsUrl").value.trim());
    const msg = $("wmsMsg");
    if (!url) { msg.textContent = "Inserisci un indirizzo che inizi con https://"; return; }
    if (location.protocol === "https:" && url.startsWith("http:")) {
      msg.textContent = "Il browser blocca i servizi http quando l'app è aperta su https. Serve l'indirizzo https del servizio.";
      return;
    }
    const link = $("capsLink");
    link.href = urlCapabilities(url);
    link.hidden = false;
    const btn = $("btnCaps");
    occupato(btn, true);
    msg.textContent = "Leggo il servizio…";
    try {
      const cap = await caricaCapabilities(url);
      $("capsList").replaceChildren(...cap.livelli.map((l) => h("option", { value: l.name }, `${l.title} (${l.name})`)));
      $("wmsLayers").hidden = false;
      msg.textContent = `${cap.titolo || "Servizio"}: ${cap.livelli.length} livelli trovati.`;
    } catch (e) {
      $("wmsLayers").hidden = true;
      msg.textContent = `Non riesco a leggere i livelli (${messaggioErrore(e)}). Il servizio potrebbe non consentire la lettura dal browser: apri il GetCapabilities qui sopra, copia il nome del livello e scrivilo nel campo «Nome del livello».`;
    } finally {
      occupato(btn, false);
    }
  });

  $("btnAddWms").addEventListener("click", async () => {
    const msg = $("wmsMsg");
    const url = urlSicuro($("wmsUrl").value.trim());
    const livello = $("wmsManual").value.trim() || ($("wmsLayers").hidden ? "" : $("capsList").value);
    if (!url) { msg.textContent = "Inserisci l'indirizzo del servizio."; return; }
    if (location.protocol === "https:" && url.startsWith("http:")) { msg.textContent = "Il browser blocca i servizi http su una pagina https."; return; }
    if (!livello) { msg.textContent = "Scegli un livello oppure scrivi il suo nome."; return; }
    const def = {
      id: "custom-" + Date.now().toString(36),
      nome: $("wmsName").value.trim() || livello,
      tipo: "wms", url, livelli: livello, opacita: 0.9, custom: true,
      attr: "Servizio WMS aggiunto dall'utente",
    };
    personalizzati.push({ ...def });
    mem.set("am.wmsCustom", personalizzati);
    registraSovr(def);
    ordineSovr = [def.id, ...ordineSovr]; // un livello nuovo parte in cima
    salvaOrdine();
    const r = sovr.get(def.id);
    r.stato = "";
    disegnaSovr();
    await alternaSovr(r, true);
    msg.textContent = "Aggiunto. Lo trovi in «Livelli sovrapposti».";
  });
}

// -------------------------------------------------------- centro di ricerca

const gruppoCentro = L.layerGroup().addTo(map);
let centro = mem.get("am.centro", null);
let marcatoreCentro = null;
let cerchio = null;
let raggioCerchioKm = 0;

const SVG_PIN = '<svg viewBox="0 0 26 26" width="26" height="26" aria-hidden="true"><path d="M13 25S4 16.5 4 10a9 9 0 0 1 18 0c0 6.500-9 15-9 15Z" fill="#1f3a2e" stroke="#fff" stroke-width="1.6"/><circle cx="13" cy="10" r="3.4" fill="#5fd1a8"/></svg>';

function aggiornaTestoCentro() {
  $("centerText").textContent = centro ? `Centro: ${fmtCoord(centro.lat, centro.lon)}` : "Centro non impostato. Tocca la mappa.";
}

function aggiornaCerchio() {
  if (cerchio) { gruppoCentro.removeLayer(cerchio); cerchio = null; }
  if (centro && raggioCerchioKm > 0) {
    cerchio = L.circle([centro.lat, centro.lon], {
      radius: raggioCerchioKm * 1000, color: "#1f3a2e", weight: 1.5, dashArray: "6 6", fillColor: "#1f3a2e", fillOpacity: 0.04, interactive: false,
    }).addTo(gruppoCentro);
  }
}

function impostaCentro(lat, lon, { zoom, vola } = {}) {
  centro = { lat, lon };
  mem.set("am.centro", centro);
  if (!marcatoreCentro) {
    marcatoreCentro = L.marker([lat, lon], {
      draggable: true, keyboard: false, zIndexOffset: 1000, bubblingMouseEvents: false,
      icon: L.divIcon({ className: "pin", html: SVG_PIN, iconSize: [26, 26], iconAnchor: [13, 25] }),
    }).addTo(gruppoCentro);
    marcatoreCentro.bindTooltip("Centro di ricerca", { direction: "top", offset: [0, -24], className: "pinLabel" });
    marcatoreCentro.on("dragend", () => {
      const p = marcatoreCentro.getLatLng();
      impostaCentro(p.lat, p.lng);
    });
  } else {
    marcatoreCentro.setLatLng([lat, lon]);
  }
  aggiornaCerchio();
  aggiornaTestoCentro();
  if (zoom) (vola ? map.flyTo([lat, lon], zoom) : map.setView([lat, lon], zoom));
}

function ottieniCentro() {
  if (!centro) {
    const c = map.getCenter();
    impostaCentro(c.lat, c.lng);
    toast("Ho usato il centro della mappa come punto di ricerca.");
  }
  return centro;
}

// --- tocco lungo: coordinate del punto, copia e «Apri in Google Maps»

let popupPunto = null;
let ultimaAperturaPunto = 0;

function apriPuntoMappa(latlng) {
  if (Date.now() - ultimaAperturaPunto < 900) return; // tocco lungo e menu del browser possono arrivare insieme
  ultimaAperturaPunto = Date.now();
  const testo = fmtCoord(latlng.lat, latlng.lng);
  const url = urlGoogleMaps(gen(latlng.lat), gen(latlng.lng));
  const copia = async () => {
    try {
      await navigator.clipboard.writeText(testo);
      toast("Coordinate copiate.");
    } catch {
      toast("Non riesco a copiare: selezionale e copiale a mano.");
    }
  };
  const contenuto = h("div", { class: "pt-lungo" },
    h("div", { class: "pt" }, "Punto sulla mappa"),
    h("div", { class: "coord", "data-coordinate": testo }, testo),
    pubblica() ? h("div", { class: "pm" }, "Modalità pubblica: posizione generalizzata (circa 1 km).") : null,
    h("div", { class: "azioni" },
      url ? h("a", { class: "btn primary", href: url, target: "_blank", rel: "noopener noreferrer", "data-azione": "google" }, "Apri in Google Maps") : null,
      h("button", { type: "button", class: "btn", "data-azione": "copia", onclick: copia }, "Copia"),
      h("button", {
        type: "button", class: "btn", "data-azione": "centro",
        onclick: () => { impostaCentro(latlng.lat, latlng.lng); map.closePopup(popupPunto); },
      }, "Usa come centro"),
    ),
  );
  const segno = L.circleMarker(latlng, { radius: 7, color: "#fff", weight: 2, fillColor: "#b3541e", fillOpacity: 0.95, interactive: false, pane: "markerPane" }).addTo(map);
  // closeOnClick spento: il «click» di rilascio dopo il tocco lungo chiuderebbe subito il riquadro
  popupPunto = L.popup({ className: "popupPunto", minWidth: 210, maxWidth: 280, autoPanPadding: [16, 80], closeButton: true, closeOnClick: false })
    .setLatLng(latlng)
    .setContent(contenuto);
  popupPunto.on("remove", () => segno.remove());
  popupPunto.openOn(map);
}

const toccoLungo = creaRilevatore({
  onLungo: ({ x, y }) => apriPuntoMappa(map.containerPointToLatLng([x, y])),
});
{
  const contenitore = map.getContainer();
  const dentroComando = (t) => t instanceof Element && t.closest(".leaflet-control, .leaflet-popup, .leaflet-marker-icon");
  const punto = (e) => {
    const r = contenitore.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top };
  };
  contenitore.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (dentroComando(e.target)) return;
    toccoLungo.giu(punto(e));
  });
  contenitore.addEventListener("pointermove", (e) => toccoLungo.muovi(punto(e)));
  contenitore.addEventListener("pointerup", (e) => toccoLungo.su(punto(e)));
  contenitore.addEventListener("pointercancel", (e) => toccoLungo.annullato(punto(e)));
  // Il menu del browser (tasto destro, o pressione lunga di Android) lascia il posto al nostro riquadro.
  contenitore.addEventListener("contextmenu", (e) => {
    if (dentroComando(e.target)) return;
    e.preventDefault();
    toccoLungo.segnala();
    const r = contenitore.getBoundingClientRect();
    apriPuntoMappa(map.containerPointToLatLng([e.clientX - r.left, e.clientY - r.top]));
  });
}

map.on("click", (e) => {
  if (toccoLungo.clickSoppresso()) return;
  if (popupPunto) map.closePopup(popupPunto);
  impostaCentro(e.latlng.lat, e.latlng.lng);
});
$("btnCenterMap").addEventListener("click", () => {
  const c = map.getCenter();
  impostaCentro(c.lat, c.lng);
});

function localizza() {
  if (!navigator.geolocation) { toast("Questo dispositivo non fornisce la posizione."); return; }
  toast("Cerco la tua posizione…");
  navigator.geolocation.getCurrentPosition(
    (p) => impostaCentro(p.coords.latitude, p.coords.longitude, { zoom: 14, vola: true }),
    (err) => toast(err.code === 1 ? "Permesso di posizione negato: abilitalo nelle impostazioni del browser." : "Posizione non disponibile al momento."),
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
  );
}
$("btnLocate").addEventListener("click", localizza);

$("searchForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const q = $("searchInput").value.trim();
  if (!q) return;
  try {
    const ris = await cercaLuogo(q);
    if (!ris.length) { toast("Nessun risultato. Prova con un nome più preciso."); return; }
    let sel = ris[0];
    if (ris.length > 1) {
      sel = await scegli("Quale luogo?", ris.map((r) => ({ etichetta: r.nome, valore: r })));
      if (!sel) return;
    }
    impostaCentro(sel.lat, sel.lon, { zoom: sel.tipo === "coordinate" ? 15 : 13, vola: true });
    document.activeElement?.blur();
  } catch (e) {
    toast(`Ricerca non riuscita: ${messaggioErrore(e)}`);
  }
});

// ---------------------------------------------------------- scambio di dati

function haCoordinate(s) { return Number.isFinite(s.lat) && Number.isFinite(s.lon); }

function puntoGeoJSON(s, extra) {
  return { type: "Feature", properties: extra, geometry: { type: "Point", coordinates: [gen(s.lon), gen(s.lat)] } };
}

function metaEsportazione() {
  return {
    generato: new Date().toISOString(),
    app: `ArcheoMappa Italia ${VERSIONE}`,
    modalita: imp.modo,
    centro: centro ? [gen(centro.lat), gen(centro.lon)] : null,
    avvertenza: "Dati di ricerca, non verificati sul terreno. Non costituiscono autorizzazione a effettuare ricerche archeologiche.",
  };
}

const nomeFile = (base, est) => `${base}-${new Date().toISOString().slice(0, 10)}.${est}`;

// ------------------------------------------------------------- dintorni

const gruppoSiti = L.layerGroup().addTo(map);
let siti = [];
let filtroEpoca = new Set();
const marcatori = new Map();

const etichettaCat = (s) => CAT[s.cat]?.nome ?? "Luogo storico";
const etichettaEpoca = (id) => (id ? EPOCA[id]?.nome ?? id : "Epoca non indicata");

function popupSito(s) {
  return h("div", null,
    h("div", { class: "pt" }, s.nome || etichettaCat(s)),
    h("div", { class: "pm" }, `${etichettaCat(s)}${s.tipo ? " · " + s.tipo : ""}`),
    h("div", { class: "pm" }, `${etichettaEpoca(s.epoca)} (stima dal testo)`),
    h("div", { class: "pm" }, `${formatDist(s.distM)} a ${s.dir} dal centro`),
    h("div", { class: "pm" }, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, "Scheda su OpenStreetMap")),
  );
}

function sitiVisibili() {
  return siti.filter((s) => !filtroEpoca.size || filtroEpoca.has(s.epoca ?? "nd"));
}

function disegnaFiltriEpoca() {
  const conteggi = {};
  for (const s of siti) conteggi[s.epoca ?? "nd"] = (conteggi[s.epoca ?? "nd"] || 0) + 1;
  const ids = [...EPOCHE.map((e) => e.id), "nd"].filter((id) => conteggi[id]);
  $("nearFilters").replaceChildren(
    ...ids.map((id) =>
      h("button", {
        type: "button", class: "chip", "aria-pressed": filtroEpoca.has(id) ? "true" : "false",
        onclick: () => {
          if (filtroEpoca.has(id)) filtroEpoca.delete(id); else filtroEpoca.add(id);
          disegnaFiltriEpoca();
          disegnaSiti();
        },
      }, h("span", { class: "dot", style: `background:${EPOCA[id]?.colore ?? "#9aa5a0"}` }), `${id === "nd" ? "Non indicata" : EPOCA[id].nome} (${conteggi[id]})`),
    ),
  );
}

function disegnaSiti() {
  gruppoSiti.clearLayers();
  marcatori.clear();
  const vis = sitiVisibili();
  for (const s of vis) {
    const m = L.circleMarker([gen(s.lat), gen(s.lon)], {
      radius: 6.5, weight: 1.6, color: "#ffffff", fillColor: CAT[s.cat]?.colore ?? "#555", fillOpacity: 0.95, bubblingMouseEvents: false,
    });
    m.bindPopup(() => popupSito(s));
    m.addTo(gruppoSiti);
    marcatori.set(s.id, m);
  }
  const MAX = 200;
  $("nearList").replaceChildren(
    ...vis.slice(0, MAX).map((s) =>
      h("li", { class: "card" },
        h("button", {
          type: "button", class: "titolo",
          onclick: () => { map.flyTo([gen(s.lat), gen(s.lon)], Math.max(map.getZoom(), 16)); marcatori.get(s.id)?.openPopup(); },
        }, s.nome || etichettaCat(s)),
        meta(
          h("span", { class: "dot", style: `background:${CAT[s.cat]?.colore ?? "#555"}` }),
          etichettaCat(s), `${formatDist(s.distM)} ${s.dir}`, etichettaEpoca(s.epoca)),
      ),
    ),
    ...(vis.length > MAX ? [h("li", { class: "hint" }, `Elenco ridotto ai primi ${MAX} su ${vis.length}: tutti sono sulla mappa e nei file scaricabili.`)] : []),
  );
  $("btnNearGeo").disabled = $("btnNearCsv").disabled = vis.length === 0;
}

function disegnaCategorie() {
  const salvate = mem.get("am.cats", CATEGORIE.map((c) => c.id));
  $("nearCats").replaceChildren(
    ...CATEGORIE.map((c) =>
      h("label", { class: "check" },
        h("input", { type: "checkbox", value: c.id, checked: salvate.includes(c.id) ? true : null }),
        h("span", { class: "dot", style: `background:${c.colore}` }), c.nome),
    ),
  );
}

const categorieScelte = () => [...$("nearCats").querySelectorAll("input:checked")].map((i) => i.value);

async function cercaDintorni() {
  const c = ottieniCentro();
  const cats = categorieScelte();
  if (!cats.length) { toast("Seleziona almeno una categoria."); return; }
  mem.set("am.cats", cats);
  const raggioM = Number($("nearRadius").value) * 1000;
  const btn = $("btnNear");
  occupato(btn, true);
  stato("nearStatus", "Interrogo OpenStreetMap…");
  try {
    const res = await cercaSitiOSM({ lat: c.lat, lon: c.lon, raggioM, categorie: cats, limite: 1500 });
    siti = res.siti
      .map((s) => ({ ...s, distM: haversine(c.lat, c.lon, s.lat, s.lon), dir: compass(c.lat, c.lon, s.lat, s.lon) }))
      .filter((s) => s.distM <= raggioM * 1.001)
      .sort((a, b) => a.distM - b.distM);
    filtroEpoca = new Set();
    disegnaFiltriEpoca();
    disegnaSiti();
    const parti = [`${siti.length} luoghi entro ${formatDist(raggioM)}`];
    if (res.troncato) parti.push("elenco incompleto: riduci il raggio");
    if (res.daCache) parti.push("dati salvati sul dispositivo");
    if (res.avviso) parti.push(res.avviso);
    stato("nearStatus", frase(parti), res.troncato || !!res.avviso);
    if (!siti.length) stato("nearStatus", "Nessun luogo censito in OpenStreetMap entro questo raggio. Non significa che non ci sia nulla: i dati sono volontari e incompleti.");
    else map.fitBounds(L.latLng(c.lat, c.lon).toBounds(raggioM * 2), { padding: [20, 20] });
  } catch (e) {
    stato("nearStatus", `Ricerca non riuscita: ${messaggioErrore(e)}. Riprova fra poco.`, true);
  } finally {
    occupato(btn, false);
    mostraEsito("nearStatus");
  }
}

function esportaDintorni(tipo) {
  const vis = sitiVisibili();
  if (tipo === "geo") {
    const fc = {
      type: "FeatureCollection",
      properties: { ...metaEsportazione(), fonte: "© collaboratori di OpenStreetMap (ODbL)" },
      features: vis.map((s) => puntoGeoJSON(s, { id: s.id, nome: s.nome, categoria: etichettaCat(s), tipo: s.tipo, epoca_stimata: etichettaEpoca(s.epoca), distanza_m: Math.round(s.distM), osm: s.url })),
    };
    scarica(nomeFile("dintorni", "geojson"), JSON.stringify(fc, null, 1), "application/geo+json");
  } else {
    scarica(nomeFile("dintorni", "csv"), inCsv(vis, [
      { titolo: "id", valore: (s) => s.id },
      { titolo: "nome", valore: (s) => s.nome },
      { titolo: "categoria", valore: etichettaCat },
      { titolo: "tipo", valore: (s) => s.tipo },
      { titolo: "epoca_stimata", valore: (s) => etichettaEpoca(s.epoca) },
      { titolo: "lat", valore: (s) => gen(s.lat) },
      { titolo: "lon", valore: (s) => gen(s.lon) },
      { titolo: "distanza_m", valore: (s) => Math.round(s.distM) },
      { titolo: "osm", valore: (s) => s.url },
    ]), "text/csv;charset=utf-8");
  }
}

// ------------------------------------------------------------------- zone

const gruppoZone = L.layerGroup().addTo(map);
let ultimeZone = null;
let sitiZone = [];

function popupZona(z) {
  const f = z.fattori;
  const pct = (v) => `${Math.round(v * 100)}%`;
  return h("div", null,
    h("div", { class: "pt" }, `Zona ${z.id}: potenziale ${z.classe}`),
    h("div", { class: "pm" }, `Punteggio ${z.punteggio.toFixed(2).replace(".", ",")} su 1`),
    h("div", { class: "pm" }, `Siti vicini ${pct(f.vicini)} · distanza media ${pct(f.media)} · forma ${pct(f.qualita)} · densità ${pct(f.densita)}`),
    z.vicinoM != null ? h("div", { class: "pm" }, `Sito noto più vicino: ${formatDist(z.vicinoM)}`) : null,
    h("div", { class: "pm" }, "Ipotesi di studio: da verificare con fonti e autorizzazioni, non una scoperta."),
  );
}

function disegnaZone(res, mostraRete) {
  gruppoZone.clearLayers();
  if (mostraRete && sitiZone.length >= 3 && centro) {
    const pr = projector(centro.lat, centro.lon);
    const pts = sitiZone.map((s) => pr.toXY(s.lat, s.lon));
    const visti = new Set();
    for (const t of delaunay(pts)) {
      for (let e = 0; e < 3; e++) {
        const a = t[e], b = t[(e + 1) % 3];
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (visti.has(k)) continue;
        visti.add(k);
        L.polyline([[sitiZone[a].lat, sitiZone[a].lon], [sitiZone[b].lat, sitiZone[b].lon]], { color: "#4a5a50", weight: 1, opacity: 0.45, interactive: false }).addTo(gruppoZone);
      }
    }
    for (const s of sitiZone) L.circleMarker([s.lat, s.lon], { radius: 2.5, weight: 0, fillColor: "#33433a", fillOpacity: 0.8, interactive: false }).addTo(gruppoZone);
  }
  for (const z of res.zone) {
    const alta = z.classe === "alta";
    L.polygon(z.vertici, {
      color: alta ? "#0b7a64" : "#4aa893", weight: alta ? 2 : 1.2, fillColor: alta ? "#0f9f82" : "#7bcfba", fillOpacity: alta ? 0.45 : 0.3, bubblingMouseEvents: false,
    }).bindPopup(() => popupZona(z)).addTo(gruppoZone);
  }
}

function disegnaLegendaZone(res) {
  const alte = res.zone.filter((z) => z.classe === "alta").length;
  const medie = res.zone.length - alte;
  $("zonesLegend").replaceChildren(
    h("span", null, h("i", { style: "background:#0f9f82" }), `Potenziale alto (${alte})`),
    h("span", null, h("i", { style: "background:#7bcfba" }), `Potenziale medio (${medie})`),
    h("span", null, h("i", { style: "background:#33433a;border-radius:50%" }), `Siti noti usati (${res.nSiti})`),
  );
  $("zonesTop").replaceChildren(
    ...primeZone(res.zone, 3).map((z) =>
      h("li", { class: "card" },
        h("button", {
          type: "button", class: "titolo",
          onclick: () => { map.flyTo([z.lat, z.lon], Math.max(map.getZoom(), 15)); },
        }, `Zona ${z.id}: potenziale ${z.classe}, punteggio ${z.punteggio.toFixed(2).replace(".", ",")}`),
        h("div", { class: "meta" }, `${fmtCoord(z.lat, z.lon)} · area ${(z.areaKm2 * 100).toFixed(1).replace(".", ",")} ettari`),
      ),
    ),
  );
}

async function calcolaZoneUI() {
  if (pubblica()) { stato("zonesStatus", "Le zone di potenziale sono disattivate nella modalità pubblica.", true); return; }
  const c = ottieniCentro();
  const raggioM = Number($("zonesRadius").value) * 1000;
  const btn = $("btnZones");
  occupato(btn, true);
  stato("zonesStatus", "Raccolgo i siti noti da OpenStreetMap…");
  try {
    const r = await cercaSitiOSM({ lat: c.lat, lon: c.lon, raggioM: raggioM + 3000, categorie: CATEGORIE.map((x) => x.id), limite: 3000 });
    sitiZone = r.siti;
    const res = calcolaZone(r.siti, c, raggioM, {
      pesoVicini: imp.wNear / 100, pesoMedia: imp.wMean / 100, pesoQualita: imp.wTri / 100, pesoDensita: imp.wDens / 100,
      sogliaMinima: imp.low, sogliaAlta: Math.max(imp.high, imp.low), bufferSitoM: imp.buffer,
    });
    ultimeZone = { res, centro: { ...c }, raggioM };
    disegnaZone(res, $("zonesExtra").checked);
    disegnaLegendaZone(res);
    $("btnZonesGeo").disabled = res.zone.length === 0;
    const s = res.scarti;
    const parti = [`${res.zone.length} zone da ${res.nSiti} siti noti (${res.nTriangoli} triangoli)`];
    if (res.avviso) parti.push(res.avviso);
    if (r.troncato) parti.push("siti troppi per una sola richiesta: risultato incompleto, riduci il raggio");
    parti.push(`Scartati: ${s.vicinoASito} vicini a siti noti, ${s.punteggioBasso} sotto soglia, ${s.lato} troppo ampi, ${s.vicine} sovrapposti`);
    stato("zonesStatus", frase(parti), !res.zone.length || r.troncato);
    if (res.zone.length) map.fitBounds(L.latLng(c.lat, c.lon).toBounds(raggioM * 2), { padding: [20, 20] });
  } catch (e) {
    stato("zonesStatus", `Calcolo non riuscito: ${messaggioErrore(e)}.`, true);
  } finally {
    occupato(btn, false);
    mostraEsito("zonesStatus");
  }
}

function esportaZone() {
  if (!ultimeZone) return;
  const fc = zoneInGeoJSON(ultimeZone.res.zone, {
    ...metaEsportazione(),
    raggio_m: ultimeZone.raggioM,
    parametri: { ...PARAMETRI_BASE, pesi: [imp.wNear, imp.wMean, imp.wTri, imp.wDens], sogliaMinima: imp.low, sogliaAlta: imp.high, bufferSitoM: imp.buffer },
    fonte_siti: "© collaboratori di OpenStreetMap (ODbL)",
  });
  scarica(nomeFile("zone-potenziale", "geojson"), JSON.stringify(fc, null, 1), "application/geo+json");
}

// ------------------------------------------------------ biblioteca delle fonti

let fonti = [];
let filtroFonte = new Set();

function fontiVisibili() {
  return fonti.filter((f) => (!filtroFonte.size || filtroFonte.has(f.fonte)) && (!$("libHide").checked || f.epoca));
}

function disegnaProfilo(vis) {
  const p = profilo(vis.map((f) => f.epoca));
  const box = $("libProfile");
  if (!vis.length || !p.classificati) { box.replaceChildren(); return; }
  const ordine = EPOCHE.filter((e) => p.percentuali[e.id]);
  box.replaceChildren(
    h("div", { class: "barra", role: "img", "aria-label": "Distribuzione per epoca: " + ordine.map((e) => `${e.nome} ${Math.round(p.percentuali[e.id])}%`).join(", ") },
      ...ordine.map((e) => h("span", { style: `width:${p.percentuali[e.id]}%;background:${e.colore}`, title: `${e.nome} ${Math.round(p.percentuali[e.id])}%` }))),
    h("div", { class: "nota" }, ordine.map((e) => `${e.nome} ${Math.round(p.percentuali[e.id])}%`).join(" · ")),
    h("div", { class: "nota" }, `Stima dalle parole dei testi su ${p.classificati} risultati con indizi di epoca (${p.nonClassificati} senza). Non è una datazione.`),
  );
}

function disegnaFonti() {
  const conteggi = {};
  for (const f of fonti) conteggi[f.fonte] = (conteggi[f.fonte] || 0) + 1;
  $("libChips").replaceChildren(
    ...Object.entries(conteggi).map(([nome, n]) =>
      h("button", {
        type: "button", class: "chip", "aria-pressed": filtroFonte.has(nome) ? "true" : "false",
        onclick: () => { if (filtroFonte.has(nome)) filtroFonte.delete(nome); else filtroFonte.add(nome); disegnaFonti(); },
      }, `${nome} (${n})`),
    ),
  );
  const vis = fontiVisibili();
  disegnaProfilo(vis);
  $("libList").replaceChildren(
    ...vis.slice(0, 150).map((f) =>
      h("li", { class: "card" },
        f.url ? h("a", { href: f.url, target: "_blank", rel: "noopener noreferrer" }, f.titolo) : h("strong", null, f.titolo),
        meta(f.fonte, f.epoca ? etichettaEpoca(f.epoca) : null, f.distM != null ? formatDist(f.distM) : null, f.licenza || null),
        f.testo ? h("p", null, f.testo) : null,
        f.immagine ? h("img", { src: f.immagine, alt: f.titolo, loading: "lazy", referrerpolicy: "no-referrer" }) : null,
      ),
    ),
  );
  $("btnLibJson").disabled = $("btnLibCsv").disabled = vis.length === 0;
}

async function cercaFonti(vicino) {
  const q = $("libQuery").value.trim();
  let c = null;
  if (vicino) c = ottieniCentro();
  else if (!q) { toast("Scrivi un argomento o un luogo da cercare."); return; }
  const raggio = Math.min(10000, Number($("nearRadius").value) * 1000);
  const chiave = vicino ? `fonti:vicino:${c.lat.toFixed(3)},${c.lon.toFixed(3)}:${raggio}` : `fonti:testo:${q.toLowerCase()}:${imp.europeana ? "e" : ""}`;
  const btn = vicino ? $("btnLibPin") : $("btnLib");
  occupato(btn, true);
  stato("libStatus", "Interrogo le fonti…");
  try {
    if (!$("libForce").checked) {
      const salvato = await cacheLeggi(chiave, SETTE_GIORNI);
      if (salvato) {
        fonti = salvato;
        filtroFonte = new Set();
        disegnaFonti();
        stato("libStatus", `${fonti.length} risultati (salvati sul dispositivo).`);
        return;
      }
    }
    const lavori = vicino
      ? [["Wikipedia", wikipediaVicino(c.lat, c.lon, raggio)], ["Wikimedia Commons", commonsVicino(c.lat, c.lon, raggio)]]
      : [["Wikipedia", wikipediaCerca(q)], ["Wikimedia Commons", commonsCerca(q)], ["Internet Archive", archiveCerca(q)], ...(imp.europeana ? [["Europeana", europeanaCerca(q, imp.europeana)]] : [])];
    const esiti = await Promise.allSettled(lavori.map((l) => l[1]));
    const falliti = [];
    fonti = [];
    esiti.forEach((e, i) => {
      if (e.status === "fulfilled") fonti.push(...e.value); else falliti.push(lavori[i][0]);
    });
    filtroFonte = new Set();
    disegnaFonti();
    if (fonti.length) await cacheScrivi(chiave, fonti);
    const parti = [`${fonti.length} risultati`];
    if (falliti.length) parti.push(`non hanno risposto: ${falliti.join(", ")}`);
    if (!imp.europeana && !vicino) parti.push("per Europeana serve una chiave (sezione Info)");
    stato("libStatus", frase(parti), !!falliti.length && !fonti.length);
  } catch (e) {
    stato("libStatus", `Ricerca non riuscita: ${messaggioErrore(e)}.`, true);
  } finally {
    occupato(btn, false);
    mostraEsito("libStatus");
  }
}

function esportaFonti(tipo) {
  const vis = fontiVisibili();
  if (tipo === "json") {
    scarica(nomeFile("fonti", "json"), JSON.stringify({ ...metaEsportazione(), risultati: vis }, null, 1), "application/json");
  } else {
    scarica(nomeFile("fonti", "csv"), inCsv(vis, [
      { titolo: "fonte", valore: (f) => f.fonte },
      { titolo: "titolo", valore: (f) => f.titolo },
      { titolo: "epoca_stimata", valore: (f) => etichettaEpoca(f.epoca) },
      { titolo: "testo", valore: (f) => f.testo },
      { titolo: "licenza", valore: (f) => f.licenza },
      { titolo: "url", valore: (f) => f.url },
    ]), "text/csv;charset=utf-8");
  }
}

// ----------------------------------------------------- impostazioni (UI)

function mostraImp() {
  $("setMode").value = imp.modo;
  for (const [id, k] of [["wNear", "wNear"], ["wMean", "wMean"], ["wTri", "wTri"], ["wDens", "wDens"]]) {
    $(id).value = imp[k];
    $(id + "Out").textContent = imp[k];
  }
  $("setLow").value = imp.low;
  $("setHigh").value = imp.high;
  $("setBuffer").value = imp.buffer;
  $("setEuropeana").value = imp.europeana;
  $("btnZones").disabled = pubblica();
  aggiornaTestoCentro();
}

function iniziaImp() {
  $("setMode").addEventListener("change", (e) => {
    imp.modo = e.target.value === "pubblica" ? "pubblica" : "ente";
    salvaImp();
    mostraImp();
    if (pubblica()) { gruppoZone.clearLayers(); ultimeZone = null; $("btnZonesGeo").disabled = true; stato("zonesStatus", "Le zone di potenziale sono disattivate nella modalità pubblica."); }
    else stato("zonesStatus", "");
    disegnaSiti();
    rilievo?.modoCambiato();
    toast(pubblica() ? "Modalità pubblica: posizioni generalizzate." : "Modalità ente: coordinate esatte.");
  });
  for (const k of ["wNear", "wMean", "wTri", "wDens"]) {
    $(k).addEventListener("input", (e) => {
      imp[k] = Number(e.target.value);
      $(k + "Out").textContent = imp[k];
      if (!imp.wNear && !imp.wMean && !imp.wTri && !imp.wDens) { imp[k] = 1; $(k).value = 1; $(k + "Out").textContent = 1; }
      salvaImp();
    });
  }
  const numero = (id, k, min, max) => $(id).addEventListener("change", (e) => {
    const v = Number(e.target.value);
    imp[k] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : IMP_BASE[k];
    e.target.value = imp[k];
    salvaImp();
  });
  numero("setLow", "low", 0, 1);
  numero("setHigh", "high", 0, 1);
  numero("setBuffer", "buffer", 0, 3000);
  $("setEuropeana").addEventListener("change", (e) => { imp.europeana = e.target.value.trim(); salvaImp(); });
  $("btnResetSettings").addEventListener("click", () => { imp = { ...IMP_BASE }; salvaImp(); mostraImp(); toast("Impostazioni ripristinate."); });
  $("btnClearCache").addEventListener("click", async () => { await cacheSvuota(); toast("Dati salvati cancellati."); });
}

// ------------------------------------------------- pannello a schede

const mobile = () => !matchMedia("(min-width: 900px)").matches;
const sheet = $("sheet");
const schede = [...$("tabs").querySelectorAll("button")];
let schedaAttiva = mem.get("am.scheda", "layers");
if (!schede.some((b) => b.dataset.tab === schedaAttiva)) schedaAttiva = "layers";
sheet.dataset.state = mem.get("am.sheet", "half");

function mostraScheda(nome) {
  schedaAttiva = nome;
  mem.set("am.scheda", nome);
  for (const b of schede) b.setAttribute("aria-selected", String(b.dataset.tab === nome));
  for (const p of document.querySelectorAll(".panel")) p.hidden = p.id !== "panel-" + nome;
  document.querySelector(".panels").scrollTop = 0;
  raggioCerchioKm = nome === "near" ? Number($("nearRadius").value) : nome === "zones" ? Number($("zonesRadius").value) : nome === "relief" ? (rilievo?.raggioKm() ?? 0) : 0;
  aggiornaCerchio();
}

function statoSheet(s) {
  sheet.dataset.state = s;
  mem.set("am.sheet", s);
}

for (const b of schede) {
  b.addEventListener("click", () => {
    if (b.dataset.tab === schedaAttiva && mobile()) {
      statoSheet(sheet.dataset.state === "closed" ? "half" : "closed");
      return;
    }
    mostraScheda(b.dataset.tab);
    if (sheet.dataset.state === "closed") statoSheet("half");
  });
  b.addEventListener("keydown", (e) => {
    const i = schede.indexOf(b);
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (n == null) return;
    e.preventDefault();
    const t = schede[(n + schede.length) % schede.length];
    t.focus();
    t.click();
  });
}
$("grip").addEventListener("click", () => statoSheet(sheet.dataset.state === "full" ? "half" : sheet.dataset.state === "half" ? "full" : "half"));

// ------------------------------------------------ installazione e rete

let promptInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  promptInstall = e;
  $("btnInstall").hidden = false;
});
window.addEventListener("appinstalled", () => { $("btnInstall").hidden = true; promptInstall = null; toast("App installata."); });
$("btnInstall").addEventListener("click", async () => {
  if (!promptInstall) return;
  promptInstall.prompt();
  await promptInstall.userChoice.catch(() => {});
  promptInstall = null;
  $("btnInstall").hidden = true;
});
{
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installata = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  $("iosHint").hidden = !(ios && !installata);
}

function aggiornaRete() { $("netBadge").hidden = navigator.onLine; }
window.addEventListener("online", aggiornaRete);
window.addEventListener("offline", () => { aggiornaRete(); toast("Senza connessione: restano le mappe già viste e i dati salvati."); });

// ------------------------------------------------------------- ritrovamenti

async function apriRitrovamento() {
  const dlg = $("foundDialog");
  const c = centro ?? { lat: map.getCenter().lat, lon: map.getCenter().lng };
  $("foundCoords").textContent = `Posizione di riferimento: ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`;
  dlg.showModal();
  navigator.geolocation?.getCurrentPosition(
    (p) => { $("foundCoords").textContent = `Posizione del dispositivo: ${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`; },
    () => {},
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
  );
}
$("btnFound").addEventListener("click", apriRitrovamento);
$("btnFoundClose").addEventListener("click", () => $("foundDialog").close());
$("btnCopyCoords").addEventListener("click", async () => {
  const m = /(-?\d+\.\d+), (-?\d+\.\d+)/.exec($("foundCoords").textContent);
  try {
    await navigator.clipboard.writeText(m ? `${m[1]}, ${m[2]}` : $("foundCoords").textContent);
    toast("Coordinate copiate.");
  } catch {
    toast("Non riesco a copiare: selezionale e copiale a mano.");
  }
});

// ----------------------------------------------------------------- avvio

function avvia() {
  $("appVersion").textContent = VERSIONE;
  disegnaBasi();
  disegnaSovr();
  disegnaCategorie();
  iniziaWms();
  iniziaConfronto();
  $("btnSpegni").addEventListener("click", alternaTutti);
  iniziaImp();
  mostraImp();
  aggiornaRete();
  rilievo = iniziaRilievo({
    map, $, toast, occupato, stato, mostraEsito, messaggioErrore, ottieniCentro, getCentro: () => centro, impostaCentro,
    fmtCoord, gen, pubblica, metaEsportazione, nomeFile, sorgenteLidar, fonteLidar, cambiaFonteLidar, fonteWmsOrtofoto,
    cerchio: (km) => { if (schedaAttiva === "relief") { raggioCerchioKm = km; aggiornaCerchio(); } },
  });

  $("nearRadius").addEventListener("input", (e) => {
    $("nearRadiusOut").textContent = `${e.target.value} km`;
    if (schedaAttiva === "near") { raggioCerchioKm = Number(e.target.value); aggiornaCerchio(); }
  });
  $("zonesRadius").addEventListener("input", (e) => {
    $("zonesRadiusOut").textContent = `${e.target.value} km`;
    if (schedaAttiva === "zones") { raggioCerchioKm = Number(e.target.value); aggiornaCerchio(); }
  });
  $("zonesExtra").addEventListener("change", () => { if (ultimeZone) disegnaZone(ultimeZone.res, $("zonesExtra").checked); });
  $("btnProbe").addEventListener("click", verificaServizi);
  $("btnDiag").addEventListener("click", verificaServizi);
  $("btnNear").addEventListener("click", cercaDintorni);
  $("btnNearGeo").addEventListener("click", () => esportaDintorni("geo"));
  $("btnNearCsv").addEventListener("click", () => esportaDintorni("csv"));
  $("btnZones").addEventListener("click", calcolaZoneUI);
  $("btnZonesGeo").addEventListener("click", esportaZone);
  $("btnLib").addEventListener("click", () => cercaFonti(false));
  $("btnLibPin").addEventListener("click", () => cercaFonti(true));
  $("libQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); cercaFonti(false); } });
  $("libHide").addEventListener("change", disegnaFonti);
  $("btnLibJson").addEventListener("click", () => esportaFonti("json"));
  $("btnLibCsv").addEventListener("click", () => esportaFonti("csv"));

  if (centro) impostaCentro(centro.lat, centro.lon);
  mostraScheda(schedaAttiva);
  // Riattiva i livelli sovrapposti lasciati accesi nell'ultima sessione.
  for (const r of sovr.values()) {
    if (!r.wantOn || r.def.tipo === "wms-regione" && !mem.get("am.lidarRegione", null)) continue;
    alternaSovr(r, true);
  }

  const legale = $("legalDialog");
  if (!mem.get("am.legale", false)) {
    legale.showModal();
    $("btnLegalOk").addEventListener("click", () => { mem.set("am.legale", true); legale.close(); }, { once: true });
  }

  if ("serviceWorker" in navigator && location.protocol !== "file:" && !ambiente().nativa) { // nell'app Android i file sono già dentro il pacchetto
    const aveva = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (aveva) toast("App aggiornata. Riaprila per usare l'ultima versione.", 6000); });
  }
}

avvia();
