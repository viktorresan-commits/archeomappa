// Tessere che non si caricano: l'app riprova da sola prima di arrivare a un errore.
//
// Perché: i servizi del Ministero rispondono a intermittenza (a volte con un errore interno del server, a volte con
// l'immagine) e, zoomando, la mappa ne chiede decine insieme. Una tessera che fallisce resta un buco per tutto lo
// zoom. Qui ogni tessera in errore viene ritentata con calma (e, nell'app Android, con il client nativo, che legge
// anche il messaggio del servizio); per i livelli a più formati di richiesta si prova anche un altro formato.
// Se il servizio continua a sbagliare in serie, il livello smette di insistere per mezzo minuto, così non si
// martella un server già in difficoltà e la mappa non rallenta.

import { clienteNativo, scaricaTessera } from "./tessere.js";

export const ATTESE_RIPROVA = [900, 2600]; // ms prima della prima e della seconda ripetizione
export const SERIE_MASSIMA = 10; // tessere perse una dopo l'altra, senza nemmeno una riuscita, dopo cui si smette di insistere
export const PAUSA_DOPO_SERIE = 30000; // ms

/** Aggiunge all'indirizzo un parametro che cambia a ogni ripetizione: il browser non riusa la risposta sbagliata in cache. */
export function conRiprova(url, n) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}amr=${n}`;
}

/** Tiene il conto delle tessere perse di seguito per un livello. `adesso` si può sostituire nelle prove. */
export function creaGestoreRiprove({ serieMax = SERIE_MASSIMA, pausa = PAUSA_DOPO_SERIE, adesso = () => Date.now() } = {}) {
  let serie = 0;
  let fermoFinoA = 0;
  return {
    riuscita() { serie = 0; fermoFinoA = 0; },
    persa() {
      serie += 1;
      if (serie >= serieMax) { fermoFinoA = adesso() + pausa; serie = 0; }
    },
    puoRiprovare() { return adesso() >= fermoFinoA; },
    get serie() { return serie; },
  };
}

/**
 * Piano dei rimedi per una tessera, nell'ordine. Ogni voce: {url, attesa, nativo}.
 * - nell'app Android, prima di tutto, la stessa richiesta con il client nativo (subito);
 * - poi la stessa richiesta dopo una pausa, con un parametro che aggira la cache;
 * - poi, se ci sono, gli altri formati di richiesta (subito);
 * - infine un'ultima ripetizione dopo una pausa più lunga.
 */
export function pianoRimedi(url, { attese = ATTESE_RIPROVA, alternative = [], conNativo = false } = {}) {
  const piano = [];
  if (conNativo) piano.push({ url, attesa: 0, nativo: true });
  piano.push({ url: conRiprova(url, 1), attesa: attese[0] ?? 0, nativo: conNativo });
  for (const alt of alternative) piano.push({ url: alt, attesa: 0, nativo: conNativo });
  if (attese[1] != null) piano.push({ url: conRiprova(url, 2), attesa: attese[1], nativo: conNativo });
  return piano;
}

/** Vera immagine di tessera: quella che Leaflet mette al posto delle tessere annullate è di 1×1 pixel e non conta. */
const eImmagineVera = (t) => !(t && t.naturalWidth != null && t.naturalWidth <= 1);

/**
 * Rende robusto un livello Leaflet: ogni tessera in errore segue il piano dei rimedi prima di arrendersi.
 * `stato` è un oggetto del chiamante: vi si aggiornano ok, nativo, riprese (tessere salvate dai rimedi) e messaggio.
 * `alternative(url, coords, layer)` può dare altri indirizzi da provare per la stessa tessera.
 * Restituisce il gestore (vedi creaGestoreRiprove) oppure null se il livello non crea tessere.
 */
export function rendiRobusto(layer, {
  win = globalThis, stato = {}, alternative = null, gestore = creaGestoreRiprove(), attese = ATTESE_RIPROVA,
  timer = (f, ms) => setTimeout(f, ms),
} = {}) {
  if (typeof layer.createTile !== "function") return null;
  const http = clienteNativo(win);
  const conNativo = !!http?.get;
  const originale = layer.createTile.bind(layer);

  layer.createTile = function (coords, fatto) {
    let piano = null;
    let passo = 0;
    let primoErrore = null;
    const collegato = (t) => t.isConnected !== false; // una tessera tolta dalla mappa non va più toccata né chiusa

    const arrenditi = (t) => {
      if (!collegato(t)) return;
      gestore.persa();
      stato.messaggio ||= "l'immagine ricevuta non è leggibile";
      fatto(primoErrore, t);
    };

    const prossimo = (t) => {
      if (!collegato(t)) return;
      if (!piano) {
        if (!gestore.puoRiprovare()) return arrenditi(t); // il servizio sta sbagliando in serie: niente insistenze
        const url = this.getTileUrl(coords);
        let alt = [];
        try { alt = (alternative?.(url, coords, this) ?? []).slice(0, 2); } catch { alt = []; }
        piano = pianoRimedi(url, { attese, alternative: alt, conNativo });
      }
      const voce = piano[passo++];
      if (!voce) return arrenditi(t);
      const vai = () => {
        if (!collegato(t)) return;
        if (voce.nativo) {
          scaricaTessera(http, voce.url).then((esito) => {
            if (!collegato(t)) return;
            if (esito.src) { stato.nativo = (stato.nativo ?? 0) + 1; t.src = esito.src; return; } // il «load» chiude il giro
            stato.messaggio = esito.errore;
            prossimo(t);
          });
        } else {
          t.src = voce.url; // «load» o «error» richiamano questa funzione
        }
      };
      if (voce.attesa > 0) timer(vai, voce.attesa); else vai();
    };

    return originale(coords, (err, t) => {
      if (!err) {
        if (eImmagineVera(t)) {
          gestore.riuscita();
          stato.ok = (stato.ok ?? 0) + 1;
          if (piano) stato.riprese = (stato.riprese ?? 0) + 1;
        }
        return fatto(null, t);
      }
      primoErrore ||= err;
      prossimo(t);
    });
  };
  return gestore;
}
