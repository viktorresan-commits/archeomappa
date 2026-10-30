// Confronto a mano fra due livelli della mappa: cursore a tendina (A a sinistra, B a destra di una linea che si
// trascina) oppure lampeggio (si alternano A e B nello stesso punto). Serve a guardare, per esempio, IGM contro
// satellite o LiDAR contro ortofoto senza accendere e spegnere i livelli uno alla volta.
//
// Non crea né rimuove livelli: li riceve già sulla mappa e si limita a tagliarli (clip) o a nasconderli.

/** Valore CSS `clip` per la parte sinistra o destra di un cursore a `frazione` della larghezza. nw/se: angoli della mappa in punti livello. */
export function clipTendina(nw, se, frazione, lato) {
  const x = nw.x + (se.x - nw.x) * frazione;
  return lato === "sinistra"
    ? `rect(${nw.y}px, ${x}px, ${se.y}px, ${nw.x}px)`
    : `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)`;
}

const MIN = 0.02, MAX = 0.98;
const INTERVALLO_MS = 900;

export function creaConfrontoLivelli({
  map, doc = globalThis.document, domEvent = globalThis.L?.DomEvent ?? null,
  ogni = (f, ms) => setInterval(f, ms), annulla = (t) => clearInterval(t),
}) {
  let a = null, b = null; // {nome, layer}
  let modo = null; // "tendina" | "lampeggio"
  let posizione = 0.5;
  let mostra = "A"; // nel lampeggio: quale dei due si vede
  let timer = null;
  let inPausa = false;
  let linea = null;
  let trascina = false;
  let dopo = () => {}; // avvisa l'interfaccia che qualcosa è cambiato

  const contenitore = (x) => x?.layer?.getContainer?.() ?? x?.layer?._container ?? null;

  function applica() {
    if (!a || !b) return;
    const ca = contenitore(a), cb = contenitore(b);
    if (modo === "tendina") {
      const nw = map.containerPointToLayerPoint([0, 0]);
      const se = map.containerPointToLayerPoint(map.getSize());
      if (ca) { ca.style.clip = clipTendina(nw, se, posizione, "sinistra"); ca.style.visibility = ""; }
      if (cb) { cb.style.clip = clipTendina(nw, se, posizione, "destra"); cb.style.visibility = ""; }
    } else if (modo === "lampeggio") {
      if (ca) { ca.style.clip = ""; ca.style.visibility = mostra === "A" ? "" : "hidden"; }
      if (cb) { cb.style.clip = ""; cb.style.visibility = mostra === "B" ? "" : "hidden"; }
    }
  }

  function ripulisciLivelli() {
    for (const x of [a, b]) {
      const c = contenitore(x);
      if (c) { c.style.clip = ""; c.style.visibility = ""; }
    }
  }

  function togliLinea() {
    if (linea) { linea.remove(); linea = null; }
    if (trascina) { trascina = false; map.dragging?.enable?.(); }
  }

  function posizionaLinea() {
    if (!linea) return;
    linea.style.left = `${Math.round(posizione * 1000) / 10}%`;
    linea.setAttribute("aria-valuenow", String(Math.round(posizione * 100)));
  }

  function creaLinea() {
    const el = doc.createElement("div");
    el.className = "tendina";
    el.tabIndex = 0;
    el.setAttribute("role", "slider");
    el.setAttribute("aria-label", "Cursore del confronto: trascinalo o usa le frecce");
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", "100");
    const maniglia = doc.createElement("div");
    maniglia.className = "tendina-maniglia";
    el.appendChild(maniglia);
    map.getContainer().appendChild(el);
    domEvent?.disableClickPropagation?.(el);
    el.addEventListener("pointerdown", (ev) => {
      ev.preventDefault?.();
      ev.stopPropagation?.();
      el.setPointerCapture?.(ev.pointerId);
      trascina = true;
      map.dragging?.disable?.();
    });
    el.addEventListener("pointermove", (ev) => {
      if (!trascina) return;
      const r = map.getContainer().getBoundingClientRect();
      imposta((ev.clientX - r.left) / r.width);
    });
    const fine = () => { if (trascina) { trascina = false; map.dragging?.enable?.(); } };
    el.addEventListener("pointerup", fine);
    el.addEventListener("pointercancel", fine);
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowLeft") { ev.preventDefault?.(); imposta(posizione - 0.05); }
      else if (ev.key === "ArrowRight") { ev.preventDefault?.(); imposta(posizione + 0.05); }
    });
    linea = el;
    posizionaLinea();
  }

  function imposta(f) {
    posizione = Math.min(MAX, Math.max(MIN, f));
    posizionaLinea();
    applica();
    dopo();
  }

  function avviaTimer() {
    if (timer != null) return;
    timer = ogni(() => { mostra = mostra === "A" ? "B" : "A"; applica(); dopo(); }, INTERVALLO_MS);
  }
  function fermaTimer() {
    if (timer != null) { annulla(timer); timer = null; }
  }

  const evMappa = "move zoom zoomend moveend viewreset resize";
  function ascolta() { map.on(evMappa, applica); }
  function nonAscoltare() { map.off(evMappa, applica); }

  function impostaModo(m) {
    if (!a || !b || (m !== "tendina" && m !== "lampeggio")) return;
    fermaTimer();
    togliLinea();
    ripulisciLivelli();
    modo = m;
    inPausa = false;
    if (m === "tendina") creaLinea();
    else { mostra = "A"; avviaTimer(); }
    applica();
    dopo();
  }

  function ferma() {
    if (!a && !b) return;
    fermaTimer();
    togliLinea();
    ripulisciLivelli();
    nonAscoltare();
    a = b = null;
    modo = null;
    inPausa = false;
    dopo();
  }

  return {
    /** a, b: {nome, layer}. I livelli devono essere già sulla mappa. `quando` è chiamata a ogni cambiamento di stato. */
    avvia({ a: livelloA, b: livelloB, modo: m = "tendina", quando = null }) {
      ferma();
      a = livelloA; b = livelloB;
      dopo = quando ?? (() => {});
      posizione = 0.5;
      ascolta();
      impostaModo(m);
    },
    ferma,
    impostaModo,
    impostaPosizione: imposta,
    /** Nel lampeggio: ferma l'alternanza e lascia il livello che si vede. */
    pausa() { if (modo !== "lampeggio" || inPausa) return; inPausa = true; fermaTimer(); dopo(); },
    riprendi() { if (modo !== "lampeggio" || !inPausa) return; inPausa = false; avviaTimer(); dopo(); },
    /** Nel lampeggio: passa a mano all'altro livello. */
    scambia() { if (modo !== "lampeggio") return; mostra = mostra === "A" ? "B" : "A"; applica(); dopo(); },
    etichetta() {
      if (!a || !b) return "";
      if (modo === "tendina") return `Sinistra: ${a.nome} · destra: ${b.nome}`;
      return `Si vede: ${mostra === "A" ? a.nome : b.nome}${inPausa ? " (in pausa)" : ""}`;
    },
    get attivo() { return !!(a && b); },
    get modo() { return modo; },
    get posizione() { return posizione; },
    get mostra() { return mostra; },
    get inPausa() { return inPausa; },
  };
}
