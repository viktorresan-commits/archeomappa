// Scheda «Rilievo»: carica un DTM/LiDAR (GeoTIFF o ASCII Grid), lo mostra sulla mappa in varie
// visualizzazioni e cerca anomalie (recinti, strutture circolari, tracciati lineari).
// Il file resta sul dispositivo: viene letto a pezzi da un Web Worker e non viene mai inviato altrove.

import { h, meta, mem, inCsv, scarica } from "./util.js";
import { creaMotore } from "./motore.js";
import { VISUALIZZAZIONI } from "./analisi.js";
import { impostazioniPredefinite, anomalieInGeoJSON } from "./detect.js";
import { cercaSitiOSM, cercaEdificiStrade, CATEGORIE } from "./sources.js";
import { formatDist } from "./geo.js";

const SISTEMI = [
  [32632, "UTM 32N WGS84 (EPSG:32632)"], [32633, "UTM 33N WGS84 (EPSG:32633)"], [32634, "UTM 34N WGS84 (EPSG:32634)"],
  [25832, "UTM 32N ETRS89 (EPSG:25832)"], [25833, "UTM 33N ETRS89 (EPSG:25833)"], [25834, "UTM 34N ETRS89 (EPSG:25834)"],
  [4326, "WGS84 in gradi (EPSG:4326)"], [4258, "ETRS89 in gradi (EPSG:4258)"], [3857, "Web Mercator (EPSG:3857)"],
];

const COLORI = { recinto: "#b5532a", circolare: "#7d3c98", lineare: "#1f6fb2" };
const NOMI_CLASSE = { recinto: "Recinti", circolare: "Strutture circolari", lineare: "Tracciati lineari" };

// Ogni riga è una regola visibile e modificabile del rilevatore (vedi detect.js).
const GRUPPI = [
  { titolo: "Sensibilità", campi: [
    { k: "kSigma", etichetta: "Soglia automatica: multiplo della variabilità del terreno (più basso = più anomalie)", min: 1, max: 6, step: 0.1 },
    { k: "contrastoM", etichetta: "Contrasto minimo in metri (vuoto = automatico)", min: 0.05, max: 30, step: 0.05, opz: true },
    { k: "confidenzaMin", etichetta: "Confidenza minima (%)", min: 20, max: 95, step: 5, perc: true },
    { k: "scalaFondoM", etichetta: "Scala del terreno di fondo (m)", min: 10, max: 600, step: 10 },
    { k: "chiusuraM", etichetta: "Ricucitura di frammenti vicini (m)", min: 0, max: 80, step: 2 },
  ] },
  { titolo: "Cosa cercare", campi: [
    { k: "recinti", etichetta: "Recinti con rampa e fossato", bool: true },
    { k: "circolari", etichetta: "Tumuli e strutture circolari", bool: true },
    { k: "lineari", etichetta: "Aggeri, strade e terrazzamenti lineari", bool: true },
  ] },
  { titolo: "Dimensioni (m)", campi: [
    { k: "recintoMinM", etichetta: "Recinto: lato minimo", min: 10, max: 2000, step: 5 },
    { k: "recintoMaxM", etichetta: "Recinto: lato massimo", min: 20, max: 3000, step: 10 },
    { k: "circMinM", etichetta: "Struttura circolare: diametro minimo", min: 3, max: 500, step: 1 },
    { k: "circMaxM", etichetta: "Struttura circolare: diametro massimo", min: 5, max: 800, step: 5 },
    { k: "lineareMinM", etichetta: "Tracciato: lunghezza minima", min: 20, max: 2000, step: 10 },
    { k: "lineareMaxM", etichetta: "Tracciato: lunghezza massima", min: 50, max: 4000, step: 50 },
    { k: "lineareLarghMaxM", etichetta: "Tracciato: larghezza massima", min: 3, max: 200, step: 1 },
  ] },
  { titolo: "Cosa scartare", campi: [
    { k: "distSitiM", etichetta: "Distanza minima da un sito già noto (m, 0 = non scartare)", min: 0, max: 3000, step: 50 },
    { k: "escludiEdifici", etichetta: "Scarta ciò che sta sugli edifici attuali", bool: true },
    { k: "buffEdificiM", etichetta: "Margine attorno agli edifici (m)", min: 0, max: 200, step: 1 },
    { k: "escludiStrade", etichetta: "Scarta ciò che segue le strade attuali", bool: true },
    { k: "buffStradeM", etichetta: "Margine attorno alle strade (m)", min: 0, max: 200, step: 1 },
    { k: "maxRisultati", etichetta: "Numero massimo di risultati", min: 10, max: 1000, step: 10 },
  ] },
];

const fmtNum = (v, d = 1) => Number(v).toFixed(d).replace(".", ",");
const pct = (v) => `${Math.round(v * 100)}%`;
const frasePuntata = (parti) => parti.filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(". ") + ".";

function dentroCopertura(c, cop) {
  return c.lat >= cop.sud && c.lat <= cop.nord && c.lon >= cop.ovest && c.lon <= cop.est;
}

export function iniziaRilievo(ctx) {
  const { map, $, toast, occupato, stato, mostraEsito, messaggioErrore, ottieniCentro, getCentro, impostaCentro, fmtCoord, gen, pubblica, metaEsportazione, nomeFile, cerchio } = ctx;
  const motore = creaMotore();
  const base = { raggioKm: 1, vis: "multi", esag: 2, opacita: 75, epsg: 32632, overrides: {} };
  const salvato = { ...base, ...mem.get("am.rilievo", {}) };
  salvato.overrides = { dettaglio: {}, grossolano: {}, ...salvato.overrides };
  const salva = () => mem.set("am.rilievo", salvato);

  map.createPane?.("rilievo");
  if (map.getPane?.("rilievo")) map.getPane("rilievo").style.zIndex = 250;
  const gruppo = L.layerGroup().addTo(map);
  const gruppoCopertura = L.layerGroup().addTo(map);
  let overlay = null;
  let urlImmagine = null;
  let file = null;
  let info = null;
  let ultimi = null; // risultato dell'ultima ricerca di anomalie
  let inCorso = false;

  // ---------------------------------------------------------------- impostazioni
  const profilo = () => impostazioniPredefinite(info?.pixelM ?? 2).profilo;
  const predefiniti = () => impostazioniPredefinite(info?.pixelM ?? 2);
  const sovrascritti = () => salvato.overrides[profilo()];
  const effettivi = () => ({ ...predefiniti(), ...sovrascritti() });

  function imposta(k, v) {
    const def = predefiniti()[k];
    if (v === undefined || v === def) delete sovrascritti()[k]; else sovrascritti()[k] = v;
    salva();
  }

  function campo(spec) {
    const k = spec.k;
    const eff = effettivi();
    if (spec.bool) {
      const cb = h("input", { type: "checkbox", checked: eff[k] ? true : null });
      cb.addEventListener("change", () => imposta(k, cb.checked));
      return h("label", { class: "check" }, cb, spec.etichetta);
    }
    const scala = spec.perc ? 100 : 1;
    const inp = h("input", { type: "number", inputmode: "decimal", min: spec.min, max: spec.max, step: spec.step, placeholder: spec.opz ? "automatico" : null });
    const mostra = () => { const v = effettivi()[k]; inp.value = v == null ? "" : String(Math.round(v * scala * 1000) / 1000); };
    mostra();
    inp.addEventListener("change", () => {
      const testo = inp.value.trim();
      if (testo === "" && spec.opz) { delete sovrascritti()[k]; salva(); mostra(); return; }
      const n = Number(testo.replace(",", "."));
      if (!Number.isFinite(n)) { mostra(); return; }
      imposta(k, Math.min(spec.max, Math.max(spec.min, n)) / scala);
      mostra();
    });
    return h("label", { class: "field" }, spec.etichetta, inp);
  }

  function disegnaImpostazioni() {
    $("relSettings").replaceChildren(
      ...GRUPPI.flatMap((g) => [h("h3", null, g.titolo), ...g.campi.map(campo)]),
      h("p", { class: "hint" }, info
        ? `Valori per il profilo «${profilo() === "dettaglio" ? "dettaglio" : "grossolano"}», scelto dal pixel del file (${fmtNum(info.pixelM)} m). Ogni profilo ricorda le sue modifiche.`
        : "I valori dipendono dal pixel del file: carica un rilievo per vedere quelli del suo profilo."),
      h("div", { class: "row" }, h("button", { type: "button", class: "btn", onclick: () => { salvato.overrides[profilo()] = {}; salva(); disegnaImpostazioni(); toast("Impostazioni del rilevatore ripristinate."); } }, "Ripristina questo profilo")),
    );
  }

  // --------------------------------------------------------------------- file
  function notaRisoluzione(px) {
    if (px <= 3) return "Pixel fine: adatto a recinti, tumuli, fossati e aggeri.";
    if (px <= 8) return "Pixel medio: si vedono bene solo forme di alcune decine di metri.";
    return `Con pixel da ${fmtNum(px, 0)} m si vedono solo forme grandi (oltre 100 m circa) e il risultato cambia un po' con il raggio di analisi: prova più raggi. Per tumuli, fossati e piccoli forti servono dati da 1–2 m, come i DTM LiDAR del PST o i rilievi regionali.`;
  }

  function mostraInfo() {
    if (!info) { $("relInfo").replaceChildren(); return; }
    const c = info.copertura;
    $("relInfo").replaceChildren(
      h("div", { class: "pt" }, info.nome || "Rilievo"),
      h("div", { class: "hint" }, `${info.larghezza}×${info.altezza} pixel · pixel da ${fmtNum(info.pixelM)} m · ${info.proiezione || "EPSG:" + info.epsg}`),
      h("div", { class: "hint" }, `Copre da ${fmtNum(c.sud, 3)}° a ${fmtNum(c.nord, 3)}° N e da ${fmtNum(c.ovest, 3)}° a ${fmtNum(c.est, 3)}° E`),
      h("div", { class: "hint" }, notaRisoluzione(info.pixelM)),
      h("button", { type: "button", class: "link", onclick: vaiAlRilievo }, "Vai al rilievo"),
    );
  }

  function vaiAlRilievo() {
    if (!info) return;
    const c = info.copertura;
    map.fitBounds([[c.sud, c.ovest], [c.nord, c.est]]);
    const centro = { lat: (c.sud + c.nord) / 2, lon: (c.ovest + c.est) / 2 };
    impostaCentro(centro.lat, centro.lon);
  }

  function disegnaCopertura() {
    gruppoCopertura.clearLayers();
    if (!info) return;
    const c = info.copertura;
    L.polygon([[c.sud, c.ovest], [c.sud, c.est], [c.nord, c.est], [c.nord, c.ovest]], { color: "#5b6b61", weight: 1.5, dashArray: "5 5", fill: false, interactive: false }).addTo(gruppoCopertura);
  }

  function pulisciRisultati() {
    gruppo.clearLayers();
    ultimi = null;
    $("relList").replaceChildren();
    $("relLegend").replaceChildren();
    $("relRules").replaceChildren(h("p", { class: "hint" }, "Dopo una ricerca qui compare l'elenco esatto delle regole usate."));
    $("btnRelGeo").disabled = $("btnRelCsv").disabled = true;
  }

  function togliImmagine() {
    if (overlay) map.removeLayer(overlay);
    overlay = null;
    if (urlImmagine) URL.revokeObjectURL(urlImmagine);
    urlImmagine = null;
  }

  async function apriFile(f, epsg) {
    const asc = /\.(asc|txt|grd)$/i.test(f.name);
    const box = $("relCrsBox");
    stato("relStatus", "Apro il file…");
    try {
      const opzioni = asc || epsg ? { epsg: epsg ?? Number($("relEpsg").value) } : {};
      const i = await motore.apri(f, opzioni);
      file = f; info = i;
      box.hidden = !asc;
      pulisciRisultati();
      togliImmagine();
      disegnaCopertura();
      mostraInfo();
      disegnaImpostazioni();
      abilita();
      const c = getCentro();
      if (!c || !dentroCopertura(c, i.copertura)) {
        vaiAlRilievo();
        stato("relStatus", "Rilievo aperto. Ho portato il centro di ricerca sul rilievo: scegli la visualizzazione e tocca «Mostra il rilievo».");
      } else {
        stato("relStatus", "Rilievo aperto. Scegli la visualizzazione e tocca «Mostra il rilievo».");
      }
    } catch (e) {
      file = null; info = null;
      mostraInfo(); abilita(); disegnaCopertura();
      const msg = messaggioErrore(e);
      box.hidden = !(asc || /sistema di coordinate/i.test(msg));
      stato("relStatus", `Non riesco ad aprire il file: ${msg}`, true);
    } finally {
      mostraEsito("relStatus");
    }
  }

  function abilita() {
    const pronto = !!info && !inCorso;
    $("btnRelShow").disabled = !pronto;
    $("btnRelFind").disabled = !pronto || pubblica();
    $("relModeNote").hidden = !pubblica();
  }

  // ----------------------------------------------------------------- analisi
  async function mostraImmagine(im) {
    const cv = document.createElement("canvas");
    cv.width = im.w; cv.height = im.h;
    cv.getContext("2d").putImageData(new ImageData(im.rgba, im.w, im.h), 0, 0);
    const blob = await new Promise((ok) => cv.toBlob(ok, "image/png"));
    if (!blob) throw new Error("Non riesco a disegnare l'immagine del rilievo.");
    const url = URL.createObjectURL(blob);
    togliImmagine();
    urlImmagine = url;
    overlay = L.imageOverlay(url, im.bounds, { opacity: salvato.opacita / 100, pane: "rilievo", interactive: false }).addTo(map);
  }

  async function raccogliEsterni(c, raggioM, eff) {
    const esterni = {};
    const avvisi = [];
    const r = raggioM * 1.45 + 200;
    const lavori = [];
    if (eff.distSitiM > 0) {
      lavori.push(cercaSitiOSM({ lat: c.lat, lon: c.lon, raggioM: r, categorie: CATEGORIE.map((x) => x.id), limite: 1500 })
        .then((res) => { esterni.siti = res.siti.map((s) => ({ lat: s.lat, lon: s.lon })); if (res.troncato) avvisi.push("siti noti incompleti"); })
        .catch(() => avvisi.push("siti noti non scaricati")));
    }
    if (eff.escludiEdifici || eff.escludiStrade) {
      lavori.push(cercaEdificiStrade({ lat: c.lat, lon: c.lon, raggioM: r })
        .then((res) => {
          if (eff.escludiEdifici) esterni.edifici = res.edifici;
          if (eff.escludiStrade) esterni.strade = res.strade;
          if (res.troncato) avvisi.push("edifici o strade incompleti: riduci il raggio");
        })
        .catch(() => avvisi.push("edifici e strade non scaricati")));
    }
    await Promise.all(lavori);
    return { esterni, avvisi };
  }

  async function esegui(cerca) {
    if (!info || inCorso) return;
    if (cerca && pubblica()) { stato("relStatus", "Il rilevatore è disattivato nella modalità pubblica.", true); return; }
    const c = ottieniCentro();
    if (!dentroCopertura(c, info.copertura)) {
      stato("relStatus", "Il centro di ricerca è fuori dal rilievo. Tocca «Vai al rilievo» oppure sposta il centro dentro l'area tratteggiata.", true);
      mostraEsito("relStatus");
      return;
    }
    const raggioM = salvato.raggioKm * 1000;
    const eff = effettivi();
    inCorso = true;
    occupato($("btnRelShow"), true); occupato($("btnRelFind"), true);
    try {
      let esterni = {}, avvisiEst = [];
      if (cerca) {
        stato("relStatus", "Scarico siti noti, edifici e strade da OpenStreetMap…");
        ({ esterni, avvisi: avvisiEst } = await raccogliEsterni(c, raggioM, eff));
      }
      const t0 = performance.now();
      const r = await motore.analizza({
        lat: c.lat, lon: c.lon, raggioM,
        vis: { tipo: salvato.vis, esagerazione: salvato.esag },
        cercaAnomalie: cerca, imp: { ...sovrascritti() }, esterni,
      }, (testo) => stato("relStatus", testo));
      await mostraImmagine(r.immagine);
      const parti = [];
      if (cerca) {
        disegnaRisultati(r.rilevamento, r, c, raggioM);
        const rl = r.rilevamento;
        const n = rl.anomalie.length;
        parti.push(n ? `${n} ${n === 1 ? "anomalia" : "anomalie"} su ${fmtNum(2 * raggioM / 1000)} km di lato` : "Nessuna anomalia con queste impostazioni");
        parti.push(`contrasto minimo ${fmtNum(rl.soglia, 2)} m`);
        const s = rl.scartate;
        const scarti = [[s.forma, "per forma"], [s.confidenza, "sotto la confidenza minima"], [s.sitoNoto, "vicino a siti noti"], [s.edificio, "su edifici"], [s.strada, "lungo strade"]].filter(([v]) => v);
        if (scarti.length) parti.push("scartate " + scarti.map(([v, t]) => `${v} ${t}`).join(", "));
        if (avvisiEst.length) parti.push("filtri non completi: " + avvisiEst.join(", "));
      } else {
        parti.push(`Rilievo mostrato (${VISUALIZZAZIONI.find((v) => v.id === salvato.vis)?.nome.toLowerCase()})`);
        parti.push(`pixel da ${fmtNum(r.griglia.cella)} m`);
      }
      parti.push(...r.avvisi.filter((a) => !/non contiene quote/.test(a)));
      parti.push(`${fmtNum((performance.now() - t0) / 1000)} s`);
      stato("relStatus", frasePuntata(parti), cerca && (avvisiEst.length > 0));
      map.fitBounds(r.immagine.bounds);
    } catch (e) {
      stato("relStatus", `Analisi non riuscita: ${messaggioErrore(e)}`, true);
    } finally {
      inCorso = false;
      occupato($("btnRelShow"), false); occupato($("btnRelFind"), false);
      abilita();
      mostraEsito("relStatus");
    }
  }

  // ----------------------------------------------------------------- risultati
  function popup(a) {
    return h("div", null,
      h("div", { class: "pt" }, `${a.id}. ${a.tipo}`),
      h("div", { class: "pm" }, `Confidenza ${pct(a.punteggio)} · ${formatDist(a.dimensioneM)}`),
      h("div", { class: "pm" }, `${a.polarita === "positiva" ? "Rilievo" : a.polarita === "negativa" ? "Avvallamento" : "Rilievo e avvallamento"} · contrasto medio ${fmtNum(a.contrastoM, 2)} m`),
      a.sitoNotoM != null ? h("div", { class: "pm" }, `Sito noto più vicino: ${formatDist(a.sitoNotoM)}`) : null,
      a.tagliata ? h("div", { class: "pm" }, "Tocca il bordo dell'area analizzata: forma incompleta.") : null,
      h("div", { class: "pm" }, "Ipotesi di studio: da verificare con ortofoto, fonti e un sopralluogo autorizzato. Non indica dove scavare."),
    );
  }

  function disegnaRisultati(rl, r, c, raggioM) {
    gruppo.clearLayers();
    const anomalie = rl.anomalie;
    ultimi = { rl, anomalie, centro: { ...c }, raggioM, impEff: r.impEff, cella: r.griglia.cella, file: info?.nome ?? "" };
    const marcatori = new Map();
    for (const a of anomalie) {
      const col = COLORI[a.codice];
      const opts = { color: col, weight: a.codice === "lineare" ? 3.5 : 2.5, opacity: 0.55 + 0.4 * a.punteggio, fillColor: col, fillOpacity: 0.14, bubblingMouseEvents: false };
      const g = a.geom.tipo === "linea" ? L.polyline(a.geom.coord, opts) : L.polygon(a.geom.coord, opts);
      g.bindPopup(() => popup(a)).addTo(gruppo);
      marcatori.set(a.id, g);
    }
    const conteggi = {};
    for (const a of anomalie) conteggi[a.codice] = (conteggi[a.codice] || 0) + 1;
    $("relLegend").replaceChildren(...Object.keys(COLORI).filter((k) => conteggi[k]).map((k) => h("span", null, h("i", { style: `background:${COLORI[k]}` }), `${NOMI_CLASSE[k]} (${conteggi[k]})`)));
    const MAX = 100;
    $("relList").replaceChildren(
      ...anomalie.slice(0, MAX).map((a) =>
        h("li", { class: "card" },
          h("button", { type: "button", class: "titolo", onclick: () => { map.flyTo([a.lat, a.lon], Math.max(map.getZoom(), 17)); marcatori.get(a.id)?.openPopup(); } },
            `${a.id}. ${a.tipo}, ${formatDist(a.dimensioneM)}, confidenza ${pct(a.punteggio)}`),
          meta(
            h("span", { class: "dot", style: `background:${COLORI[a.codice]}` }),
            fmtCoord(a.lat, a.lon),
            a.sitoNotoM != null ? `sito noto a ${formatDist(a.sitoNotoM)}` : null,
            a.tagliata ? "forma incompleta" : null),
        )),
      ...(anomalie.length > MAX ? [h("li", { class: "hint" }, `Elenco ridotto ai primi ${MAX} su ${anomalie.length}: tutti sono sulla mappa e nei file scaricabili.`)] : []),
    );
    $("relRules").replaceChildren(h("ul", { class: "plain" }, ...rl.regole.map((t) => h("li", null, t))));
    $("btnRelGeo").disabled = $("btnRelCsv").disabled = anomalie.length === 0;
  }

  function esporta(tipo) {
    if (!ultimi?.anomalie.length) return;
    const { anomalie, rl } = ultimi;
    if (tipo === "geo") {
      const fc = anomalieInGeoJSON(anomalie, {
        ...metaEsportazione(), file_rilievo: ultimi.file, pixel_m: ultimi.cella, raggio_m: ultimi.raggioM,
        contrasto_minimo_m: Number(rl.soglia.toFixed(3)), regole: rl.regole, impostazioni: ultimi.impEff,
        avvertenza_rilievo: "Anomalie dedotte dalla forma del terreno: ipotesi da verificare, non scoperte.",
      });
      scarica(nomeFile("anomalie", "geojson"), JSON.stringify(fc, null, 1), "application/geo+json");
    } else {
      scarica(nomeFile("anomalie", "csv"), inCsv(anomalie, [
        { titolo: "id", valore: (a) => a.id },
        { titolo: "tipo", valore: (a) => a.tipo },
        { titolo: "confidenza_pct", valore: (a) => Math.round(a.punteggio * 100) },
        { titolo: "dimensione_m", valore: (a) => Math.round(a.dimensioneM) },
        { titolo: "area_m2", valore: (a) => Math.round(a.areaM2) },
        { titolo: "contrasto_m", valore: (a) => a.contrastoM.toFixed(2) },
        { titolo: "polarita", valore: (a) => a.polarita },
        { titolo: "lat", valore: (a) => gen(a.lat) },
        { titolo: "lon", valore: (a) => gen(a.lon) },
        { titolo: "sito_noto_piu_vicino_m", valore: (a) => (a.sitoNotoM == null ? "" : Math.round(a.sitoNotoM)) },
        { titolo: "forma_incompleta", valore: (a) => (a.tagliata ? "sì" : "no") },
      ]), "text/csv;charset=utf-8");
    }
  }

  // ------------------------------------------------------------------ cablaggio
  $("relVis").replaceChildren(...VISUALIZZAZIONI.map((v) => h("option", { value: v.id }, v.nome)));
  $("relEpsg").replaceChildren(...SISTEMI.map(([e, n]) => h("option", { value: e }, n)));
  $("relVis").value = VISUALIZZAZIONI.some((v) => v.id === salvato.vis) ? salvato.vis : "multi";
  $("relEsag").value = String(salvato.esag);
  $("relEpsg").value = String(salvato.epsg);
  $("relRadius").value = String(salvato.raggioKm);
  $("relOpacity").value = String(salvato.opacita);
  const aggiornaEtichette = () => {
    $("relRadiusOut").textContent = `${fmtNum(salvato.raggioKm, 2)} km`;
    $("relOpacityOut").textContent = `${salvato.opacita}%`;
  };
  aggiornaEtichette();

  $("relFile").addEventListener("change", (e) => { const f = e.target.files?.[0]; if (f) apriFile(f); });
  $("btnRelApri").addEventListener("click", () => {
    salvato.epsg = Number($("relEpsg").value); salva();
    if (file) apriFile(file, salvato.epsg);
    else toast("Scegli prima un file.");
  });
  $("relRadius").addEventListener("input", (e) => {
    salvato.raggioKm = Number(e.target.value); salva(); aggiornaEtichette(); cerchio(salvato.raggioKm);
  });
  $("relVis").addEventListener("change", (e) => { salvato.vis = e.target.value; salva(); if (overlay && info && !inCorso) esegui(false); });
  $("relEsag").addEventListener("change", (e) => { salvato.esag = Number(e.target.value); salva(); if (overlay && info && !inCorso) esegui(false); });
  $("relOpacity").addEventListener("input", (e) => {
    salvato.opacita = Number(e.target.value); salva(); aggiornaEtichette(); overlay?.setOpacity(salvato.opacita / 100);
  });
  $("btnRelShow").addEventListener("click", () => esegui(false));
  $("btnRelFind").addEventListener("click", () => esegui(true));
  $("btnRelGeo").addEventListener("click", () => esporta("geo"));
  $("btnRelCsv").addEventListener("click", () => esporta("csv"));
  disegnaImpostazioni();
  abilita();

  return {
    raggioKm: () => salvato.raggioKm,
    /** Da chiamare quando cambia la modalità ente/pubblica. */
    modoCambiato() {
      if (pubblica()) { pulisciRisultati(); stato("relStatus", "Il rilevatore è disattivato nella modalità pubblica."); }
      abilita();
    },
  };
}
