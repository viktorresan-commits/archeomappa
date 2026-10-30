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
  BASI, SOVRAPPOSIZIONI, SERVIZI_NOTI, creaLivello, risolviLivelli, provaServizio, urlRegione,
} from "./layers.js";
import { h, meta, mem, inCsv, scarica, urlSicuro, cacheLeggi, cacheScrivi, cacheSvuota } from "./util.js";
import { iniziaRilievo } from "./rilievo-ui.js";

const VERSIONE = "0.2.1";
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

// Mappe di base
const livelliBase = new Map();
let baseAttiva = mem.get("am.base", "osm");
if (!BASI.some((b) => b.id === baseAttiva)) baseAttiva = "osm";
for (const b of BASI) livelliBase.set(b.id, creaLivello(L, { ...b, tipo: "tile" }));
livelliBase.get(baseAttiva).addTo(map);

function disegnaBasi() {
  $("baseList").replaceChildren(
    ...BASI.map((b) => {
      const id = "base-" + b.id;
      const r = h("input", {
        type: "radio", name: "base", id, checked: b.id === baseAttiva ? true : null,
        onchange: () => {
          map.removeLayer(livelliBase.get(baseAttiva));
          baseAttiva = b.id;
          livelliBase.get(baseAttiva).addTo(map).bringToBack();
          mem.set("am.base", baseAttiva);
        },
      });
      return h("div", { class: "opt" }, h("label", { for: id }, r, b.nome));
    }),
  );
}

// ------------------------------------------------------------ livelli sovrapposti

const sovr = new Map(); // id -> { def, layer, on, opacita, stato }
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
    errori: 0,
    urlEffettivo: def.url,
    livelliEffettivi: def.livelli,
  });
}
SOVRAPPOSIZIONI.forEach(registraSovr);
personalizzati.forEach(registraSovr);

function salvaSovr() {
  const o = {};
  for (const [id, r] of sovr) o[id] = { on: r.on, opacita: r.opacita };
  mem.set("am.sovr", o);
}

let zCont = 10;
async function costruisciLivelloSovr(r) {
  const d = r.def;
  if (d.tipo === "wms-regione") {
    const scelta = mem.get("am.lidarRegione", null);
    const regione = scelta ?? (await scegli("Scegli la regione", d.regioni.map((x) => ({ etichetta: x.replaceAll("_", " ").toLowerCase().replace(/^\w|\s\w/g, (m) => m.toUpperCase()), valore: x }))));
    if (!regione) return null;
    r.urlEffettivo = urlRegione(d, regione);
    toast("Leggo i livelli del servizio…");
    r.livelliEffettivi = await risolviLivelli({ scegli: /lidar|dtm|dsm|ombr|hillshade/i }, r.urlEffettivo);
    mem.set("am.lidarRegione", regione);
    r.stato = "regione: " + regione.replaceAll("_", " ").toLowerCase();
  } else if (d.tipo === "wms" && !r.livelliEffettivi) {
    toast("Leggo i livelli del servizio…");
    r.livelliEffettivi = await risolviLivelli(d, r.urlEffettivo);
  }
  const layer = creaLivello(L, d, { url: r.urlEffettivo, livelli: r.livelliEffettivi });
  layer.setOpacity(r.opacita);
  layer.setZIndex(++zCont);
  if (d.tipo !== "tile") {
    layer.on("tileerror", () => {
      if (++r.errori === 4) toast(`«${d.nome}» non risponde in quest'area o a questo ingrandimento.`);
    });
    layer.on("tileload", () => { r.errori = 0; });
  }
  return layer;
}

async function alternaSovr(r, casella) {
  if (!casella.checked) {
    if (r.layer) map.removeLayer(r.layer);
    r.on = false;
    salvaSovr();
    disegnaSovr();
    return;
  }
  casella.disabled = true;
  try {
    if (!r.layer) r.layer = await costruisciLivelloSovr(r);
    if (!r.layer) {
      casella.checked = false;
      return;
    }
    r.layer.addTo(map);
    r.on = true;
    if (r.def.minZoom && map.getZoom() < r.def.minZoom) toast(`«${r.def.nome}» si vede da ingrandimento ${r.def.minZoom}.`);
  } catch (e) {
    casella.checked = false;
    r.on = false;
    r.stato = "non risponde";
    toast(r.def.id === "lidar"
      ? `«${r.def.nome}»: ${messaggioErrore(e)}. Per usare il LiDAR carica un file (GeoTIFF) nella scheda Rilievo.`
      : `«${r.def.nome}»: ${messaggioErrore(e)}. Se conosci il nome del livello, aggiungilo a mano da «Aggiungi un servizio WMS».`, 8000);
  } finally {
    casella.disabled = false;
    salvaSovr();
    disegnaSovr();
  }
}

function rimuoviPersonalizzato(r) {
  if (r.layer) map.removeLayer(r.layer);
  sovr.delete(r.def.id);
  personalizzati.splice(0, personalizzati.length, ...personalizzati.filter((p) => p.id !== r.def.id));
  mem.set("am.wmsCustom", personalizzati);
  salvaSovr();
  disegnaSovr();
}

function disegnaSovr() {
  $("overlayList").replaceChildren(
    ...[...sovr.values()].map((r) => {
      const id = "ov-" + r.def.id;
      const cb = h("input", { type: "checkbox", id, checked: r.on ? true : null });
      cb.addEventListener("change", () => alternaSovr(r, cb));
      const classe = r.stato === "risponde" ? "stato ok" : r.stato === "non risponde" ? "stato ko" : "stato";
      return h("div", { class: "opt" },
        h("label", { for: id }, cb,
          h("span", null, r.def.nome, r.def.nota ? h("span", { class: "nota" }, r.def.nota) : null)),
        r.stato ? h("span", { class: classe }, r.stato) : null,
        r.on
          ? h("input", {
              type: "range", min: "0.1", max: "1", step: "0.05", value: String(r.opacita), "aria-label": `Trasparenza di ${r.def.nome}`,
              oninput: (e) => { r.opacita = Number(e.target.value); r.layer?.setOpacity(r.opacita); },
              onchange: salvaSovr,
            })
          : null,
        r.def.custom ? h("button", { type: "button", class: "link", "aria-label": `Rimuovi ${r.def.nome}`, onclick: () => rimuoviPersonalizzato(r) }, "Rimuovi") : null,
      );
    }),
  );
}

async function verificaServizi() {
  const btn = $("btnProbe");
  occupato(btn, true);
  $("probeMsg").textContent = "Provo i servizi…";
  const wms = [...sovr.values()].filter((r) => r.def.tipo !== "tile");
  let ok = 0;
  await Promise.all(wms.map(async (r) => {
    try {
      if (r.def.tipo === "wms-regione" && !r.layer) { r.stato = "scegli la regione"; return; }
      const livelli = r.livelliEffettivi ?? (await risolviLivelli(r.def, r.urlEffettivo));
      r.livelliEffettivi = livelli;
      const esito = await provaServizio(r.urlEffettivo, livelli, r.def.versione ?? "1.3.0");
      r.stato = esito === "ok" ? "risponde" : "non risponde";
      if (esito === "ok") ok++;
    } catch {
      r.stato = "non risponde";
    }
  }));
  disegnaSovr();
  occupato(btn, false);
  $("probeMsg").textContent = `${ok} su ${wms.length} rispondono. «Risponde» non garantisce che ci siano dati in ogni zona.`;
}

// ---------------------------------------------------------- servizio WMS manuale

function iniziaWms() {
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
    const r = sovr.get(def.id);
    r.stato = "";
    disegnaSovr();
    const cb = $("ov-" + def.id);
    cb.checked = true;
    await alternaSovr(r, cb);
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

map.on("click", (e) => impostaCentro(e.latlng.lat, e.latlng.lng));
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
  iniziaImp();
  mostraImp();
  aggiornaRete();
  rilievo = iniziaRilievo({
    map, $, toast, occupato, stato, mostraEsito, messaggioErrore, ottieniCentro, getCentro: () => centro, impostaCentro,
    fmtCoord, gen, pubblica, metaEsportazione, nomeFile,
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
    const cb = $("ov-" + r.def.id);
    if (cb) { cb.checked = true; alternaSovr(r, cb); }
  }

  const legale = $("legalDialog");
  if (!mem.get("am.legale", false)) {
    legale.showModal();
    $("btnLegalOk").addEventListener("click", () => { mem.set("am.legale", true); legale.close(); }, { once: true });
  }

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    const aveva = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (aveva) toast("App aggiornata. Riaprila per usare l'ultima versione.", 6000); });
  }
}

avvia();
