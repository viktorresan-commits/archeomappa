// Sessione di analisi del rilievo: apre il file, estrae la finestra attorno al centro, produce la
// visualizzazione per la mappa e, su richiesta, le anomalie. Non tocca il DOM: gira sia in un
// Web Worker (js/worker-rilievo.js) sia, se il worker non parte, nel thread principale.

import { apriRilievo, estraiGriglia } from "./raster.js";
import { metaDaPixel } from "./lidar-servizio.js";
import {
  riempiVuoti, ombreggiatura, direzioni, lrm, svf, pendenza, statisticheRobuste,
  coloraVisualizzazione, riproiettaPerMappa,
} from "./visual.js";
import { rileva, impostazioniPredefinite } from "./detect.js";
import { confrontaConFoto } from "./confronto.js";
import { dequantizza, passoDaLevigare } from "./dettaglio.js";

export const LATO_IMMAGINE_MAX = 2400; // pixel per lato dell'immagine sulla mappa: come prima della 0.5 (5,8 milioni di pixel), per non appesantire i telefoni

/** Esegue `pesante`; se lancia (di solito memoria insufficiente) segnala il fatto in `avvisi` e usa `semplice`. */
export function provaOppureRipiego(pesante, semplice, avvisi, testo) {
  try {
    return pesante();
  } catch (e) {
    avvisi.push(`${testo} (${e?.message ?? e}).`);
    return semplice();
  }
}

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
    servizio: meta.tipo === "servizio",
    relativo: !!meta.relativo, passoM: meta.passoM ?? null, avvisi: [...(meta.avvisi ?? [])],
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

  /** La griglia attorno al centro: quella in cache se centro e raggio non sono cambiati. */
  async function assicuraGriglia(p, avanzamento = () => {}) {
    const chiave = `${p.lat.toFixed(6)},${p.lon.toFixed(6)},${p.raggioM}`;
    if (!cache || cache.chiave !== chiave) {
      avanzamento("Leggo il rilievo…");
      await pausa();
      cache = { chiave, g: await estraiGriglia(meta, p.lat, p.lon, p.raggioM), pieno: null };
    }
    return cache.g;
  }

  return {
    async apri(file, opzioni = {}) {
      meta = await apriRilievo(file, opzioni);
      cache = null;
      return descriviRilievo(meta);
    },

    /** Apre una griglia già scaricata dal servizio: {dati, w, h, bbox, nome, relativo, passoM, avvisi}. */
    async apriPixel(p) {
      meta = metaDaPixel({ ...p, dati: p.dati instanceof Float32Array ? p.dati : new Float32Array(p.dati) });
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
      const g = await assicuraGriglia(p, avanzamento);
      g.unita = meta.relativo ? "livelli" : "m";
      const impEff = { ...impostazioniPredefinite(g.cella), ...(p.imp ?? {}) };
      const t1 = Date.now();
      const out = {
        griglia: { w: g.w, h: g.h, cella: g.cella, k: g.k, unita: g.unita },
        // per i dati del servizio il ricampionamento è già detto altrove: non lo ripeto
        avvisi: g.avvisi.filter((a) => !(meta.tipo === "servizio" && /ricampionato in UTM/.test(a))),
        impEff,
      };

      avanzamento("Preparo la visualizzazione…");
      await pausa();
      const r = riempiVuoti(g.dati, g.w, g.h);
      if (r.vuoto) throw new Error("Il rilievo non contiene quote valide attorno al centro. Sposta il centro o allarga il raggio.");
      // Il servizio dà il terreno a gradini (256 grigi): per la sola visualizzazione si tolgono, restando entro
      // mezzo gradino dal dato (js/dettaglio.js). Il rilevatore di anomalie continua a lavorare sul dato vero.
      let pieno = r.pieno;
      const passo = meta.tipo === "servizio" && p.leviga !== false ? passoDaLevigare(meta) : 0;
      if (passo > 0) {
        avanzamento("Levigo i gradini del servizio…");
        await pausa();
        pieno = provaOppureRipiego(() => {
          const l = dequantizza(r.pieno, r.valido, g.w, g.h, passo);
          out.avvisi.push(`Gradini del servizio levigati per la visualizzazione (un livello = ${passo.toFixed(2).replace(".", ",")} m): le quote restano entro mezzo gradino dal dato.`);
          return l.dati;
        }, () => r.pieno, out.avvisi, "Levigatura dei gradini non eseguita: uso il dato com'è");
      }
      const rgba = calcolaImmagine(g, r.valido, pieno, p.vis ?? { tipo: "multi" }, impEff);
      out.immagine = provaOppureRipiego(
        () => riproiettaPerMappa(rgba, g.w, g.h, g.cella, g.origine, g.proiezione, LATO_IMMAGINE_MAX, { sovracampione: 2 }),
        () => riproiettaPerMappa(rgba, g.w, g.h, g.cella, g.origine, g.proiezione, LATO_IMMAGINE_MAX, { sovracampione: 1 }),
        out.avvisi, "Immagine a risoluzione doppia non riuscita: uso quella normale");
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

    /**
     * Confronta le anomalie già trovate con una foto della stessa zona.
     * p = {lat, lon, raggioM (gli stessi dell'analisi), anomalie, mosaico:{rgba,w,h,merc}, passoFotoM?}
     * Restituisce {risultati, riepilogo, passoFotoM, spostamentoMassimoPx}.
     */
    async confronta(p, avanzamento = () => {}) {
      if (!meta) throw new Error("Nessun rilievo aperto.");
      const g = await assicuraGriglia(p, avanzamento);
      avanzamento("Confronto le anomalie con la foto…");
      await pausa();
      return confrontaConFoto({ anomalie: p.anomalie, g, mosaico: p.mosaico, passoFotoM: p.passoFotoM ?? null });
    },

    chiudi() { meta = null; cache = null; },
  };
}
