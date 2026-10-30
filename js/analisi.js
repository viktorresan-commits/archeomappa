// Sessione di analisi del rilievo: apre il file, estrae la finestra attorno al centro, produce la
// visualizzazione per la mappa e, su richiesta, le anomalie. Non tocca il DOM: gira sia in un
// Web Worker (js/worker-rilievo.js) sia, se il worker non parte, nel thread principale.

import { apriRilievo, estraiGriglia } from "./raster.js";
import {
  riempiVuoti, ombreggiatura, direzioni, lrm, svf, pendenza, statisticheRobuste,
  coloraVisualizzazione, riproiettaPerMappa,
} from "./visual.js";
import { rileva, impostazioniPredefinite } from "./detect.js";

export const VISUALIZZAZIONI = [
  { id: "multi", nome: "Ombreggiatura multidirezionale" },
  { id: "ombre", nome: "Ombreggiatura da nord-ovest" },
  { id: "lrm", nome: "Rilievo locale (arancio = rialzo, blu = avvallamento)" },
  { id: "svf", nome: "Cielo visibile (fossati e depressioni scuri)" },
  { id: "pendenza", nome: "Pendenza" },
  { id: "combinata", nome: "Combinata: ombre e cielo visibile" },
];

const lim = (v, a, b) => Math.min(b, Math.max(a, v));
const pausa = () => new Promise((r) => setTimeout(r, 0));

/** Parte dei metadati che si può copiare fra worker e pagina (niente funzioni). */
export function descriviRilievo(meta) {
  return {
    nome: meta.nome ?? "", tipo: meta.tipo ?? "tiff", larghezza: meta.larghezza, altezza: meta.altezza,
    epsg: meta.epsg ?? null, proiezione: meta.proiezione?.nome ?? "", pixelM: Math.min(meta.pixelMetri.dx, meta.pixelMetri.dy),
    copertura: { ...meta.copertura },
  };
}

/** Calcola l'immagine (RGBA sulla griglia) per il tipo di visualizzazione scelto. */
export function calcolaImmagine(g, valido, pieno, vis, impEff) {
  const { w, h, cella } = g;
  const esag = lim(Number(vis.esagerazione) || 1, 0.5, 10);
  const tipo = vis.tipo;
  const sigmaPx = Math.max(1.5, impEff.scalaFondoM / cella);
  const multi = () => ombreggiatura(pieno, w, h, cella, { azimut: direzioni(8), altezza: 40, esagerazione: esag });
  if (tipo === "ombre") return coloraVisualizzazione("ombre", ombreggiatura(pieno, w, h, cella, { azimut: [315], altezza: 35, esagerazione: esag }), valido, w, h);
  if (tipo === "lrm") return coloraVisualizzazione("lrm", lrm(pieno, w, h, sigmaPx), valido, w, h);
  if (tipo === "svf") return coloraVisualizzazione("svf", svf(pieno, w, h, cella, lim(Math.round(30 / cella), 4, 12), 16), valido, w, h);
  if (tipo === "pendenza") return coloraVisualizzazione("pendenza", pendenza(pieno, w, h, cella), valido, w, h);
  if (tipo === "combinata") {
    const m = multi();
    const s = svf(pieno, w, h, cella, lim(Math.round(30 / cella), 4, 12), 16);
    const { p02, p98 } = statisticheRobuste(s, valido);
    const span = Math.max(1e-6, p98 - p02);
    const v = new Float32Array(m.length);
    for (let i = 0; i < v.length; i++) v[i] = 0.6 * m[i] + 0.4 * lim((s[i] - p02) / span, 0, 1);
    return coloraVisualizzazione("combinata", v, valido, w, h);
  }
  return coloraVisualizzazione("ombre", multi(), valido, w, h);
}

export function creaSessione() {
  let meta = null;
  let cache = null; // {chiave, g}

  return {
    async apri(file, opzioni = {}) {
      meta = await apriRilievo(file, opzioni);
      cache = null;
      return descriviRilievo(meta);
    },

    /**
     * p = {lat, lon, raggioM, vis:{tipo, esagerazione}, cercaAnomalie, imp, esterni}
     * Restituisce {immagine:{rgba,w,h,bounds}, griglia:{w,h,cella,k}, avvisi, ms, impEff, rilevamento?}
     */
    async analizza(p, avanzamento = () => {}) {
      if (!meta) throw new Error("Nessun rilievo aperto.");
      const t0 = Date.now();
      const chiave = `${p.lat.toFixed(6)},${p.lon.toFixed(6)},${p.raggioM}`;
      if (!cache || cache.chiave !== chiave) {
        avanzamento("Leggo il rilievo…");
        await pausa();
        cache = { chiave, g: await estraiGriglia(meta, p.lat, p.lon, p.raggioM), pieno: null };
      }
      const g = cache.g;
      const impEff = { ...impostazioniPredefinite(g.cella), ...(p.imp ?? {}) };
      const t1 = Date.now();
      const out = { griglia: { w: g.w, h: g.h, cella: g.cella, k: g.k }, avvisi: [...g.avvisi], impEff };

      avanzamento("Preparo la visualizzazione…");
      await pausa();
      const r = riempiVuoti(g.dati, g.w, g.h);
      if (r.vuoto) throw new Error("Il rilievo non contiene quote valide attorno al centro. Sposta il centro o allarga il raggio.");
      const rgba = calcolaImmagine(g, r.valido, r.pieno, p.vis ?? { tipo: "multi" }, impEff);
      out.immagine = riproiettaPerMappa(rgba, g.w, g.h, g.cella, g.origine, g.proiezione, 2400);
      const t2 = Date.now();

      if (p.cercaAnomalie) {
        avanzamento("Cerco le anomalie…");
        await pausa();
        const ris = rileva(g, impEff, p.esterni ?? {});
        out.rilevamento = ris;
        out.avvisi.push(...ris.avvisi);
      }
      out.ms = { lettura: t1 - t0, immagine: t2 - t1, rilevamento: Date.now() - t2 };
      return out;
    },

    chiudi() { meta = null; cache = null; },
  };
}
