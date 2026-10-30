// Tocco lungo sulla mappa. Qui c'è solo la logica, senza DOM né Leaflet, così si prova con i test:
// il riconoscimento del gesto e il collegamento a Google Maps. L'interfaccia sta in js/app.js.

export const DURATA_MS = 550; // tempo di pressione prima che il gesto scatti
export const TOLLERANZA_PX = 10; // quanto si può muovere il dito senza annullare il gesto
export const SOPPRESSIONE_CLICK_MS = 500; // dopo un tocco lungo il «click» di rilascio non deve impostare il centro

/** Collegamento che apre Google Maps (o la sua app) sul punto. Le cifre bastano a circa 10 cm. */
export function urlGoogleMaps(lat, lon) {
  const a = Number(lat);
  const o = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90 || Math.abs(o) > 180) return null;
  return `https://www.google.com/maps/search/?api=1&query=${a.toFixed(6)},${o.toFixed(6)}`;
}

/**
 * Riconosce la pressione prolungata. Riceve eventi già ridotti a {id, x, y} (puntatore e posizione sullo schermo).
 *  - un solo dito fermo per `durata` ms → chiama onLungo({x, y});
 *  - se il dito si sposta oltre `tolleranza` (trascina la mappa) o arriva un secondo dito (zoom) il gesto è annullato;
 *  - dopo che il gesto è scattato, `clickSoppresso()` vale vero finché il dito è giù e per un po' dopo il rilascio.
 * Timer e orologio si possono sostituire nei test.
 */
export function creaRilevatore({
  onLungo, durata = DURATA_MS, tolleranza = TOLLERANZA_PX, soppressione = SOPPRESSIONE_CLICK_MS,
  imposta = (f, ms) => setTimeout(f, ms), annulla = (t) => clearTimeout(t), ora = () => Date.now(),
}) {
  const attivi = new Set();
  let inizio = null;
  let timer = null;
  let scattato = false;
  let soppressoFino = 0;

  const ferma = () => {
    if (timer !== null) { annulla(timer); timer = null; }
    inizio = null;
  };

  return {
    giu(e) {
      attivi.add(e.id);
      ferma();
      if (attivi.size > 1) return; // due dita: è un gesto di zoom
      scattato = false;
      const p = { x: e.x, y: e.y };
      inizio = p;
      timer = imposta(() => {
        timer = null;
        if (inizio !== p) return;
        scattato = true;
        onLungo({ x: p.x, y: p.y });
      }, durata);
    },
    muovi(e) {
      if (!inizio) return;
      if (Math.hypot(e.x - inizio.x, e.y - inizio.y) > tolleranza) ferma();
    },
    su(e) {
      attivi.delete(e.id);
      ferma();
      if (scattato) soppressoFino = ora() + soppressione;
      if (!attivi.size) scattato = false;
    },
    annullato(e) {
      attivi.delete(e.id);
      ferma();
      scattato = false;
    },
    /** Il prossimo «click» della mappa va ignorato? */
    clickSoppresso() {
      return scattato || ora() < soppressoFino;
    },
    /** Il browser ha già dato il suo segnale (evento «contextmenu»): ferma il timer e sopprime il click di rilascio. */
    segnala() {
      ferma();
      if (attivi.size) scattato = true;
      else soppressoFino = ora() + soppressione;
    },
    /** Il gesto è in attesa (dito giù, timer in corso)? Per i test. */
    inAttesa() {
      return timer !== null;
    },
  };
}
