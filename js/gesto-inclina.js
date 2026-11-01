// Gesto per inclinare la mappa: due dita che scorrono INSIEME verso l'alto (come in Google Maps).
//
// Perché un modulo a parte: Leaflet non sa inclinare. Il gesto viene riconosciuto qui, in modo che l'app apra la vista 3D
// (MapLibre, che inclina davvero) al posto del pulsante «3D». Il modulo non tocca il DOM: riceve i punti di contatto e dice
// quando il gesto è un'inclinazione; così si prova con dati finti.
//
// Che cosa distingue l'inclinazione dagli altri gesti a due dita:
//  - pizzico (zoom): le dita si allontanano o si avvicinano -> la distanza cambia;
//  - rotazione: le dita girano attorno a un centro -> spostamenti opposti;
//  - trascinamento a due dita: stesso verso ma in orizzontale o in diagonale;
//  - inclinazione: stesso verso, quasi tutto in verticale, distanza fra le dita quasi invariata.

export const SOGLIE = {
  spostamento: 36, // px: quanto devono salire le dita (in media) prima di decidere
  verticale: 2, // lo spostamento verticale deve essere almeno 2 volte quello orizzontale
  distanza: 0.14, // la distanza fra le dita può cambiare al massimo del 14% (e comunque di 14 px)
  distanzaAssoluta: 14,
  pizzico: 0.25, // oltre il 25% di variazione il gesto è uno zoom e non diventerà più un'inclinazione
  accordo: 0.45, // la dita più lenta deve fare almeno il 45% dello spostamento della più veloce
  minimaDistanza: 40, // px: dita troppo vicine (un solo polpastrello) non contano come due
  mouse: 70, // px verso l'alto con Ctrl premuto (computer)
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Riconoscitore del gesto con le dita. Si alimenta con `aggiorna(fase, punti)`:
 *   fase: "inizio" | "movimento" | "fine"; punti: [{id, x, y}, …] = tutte le dita appoggiate in quel momento.
 * Restituisce {tipo: "inclina", spostamento, centro:{x,y}} una sola volta per gesto, altrimenti null.
 */
export function creaRiconoscitore(soglie = {}) {
  const S = { ...SOGLIE, ...soglie };
  let g = null; // {a, b, d0, annullato, fatto}
  const annulla = () => { if (g) g.annullato = true; };
  return {
    aggiorna(fase, punti) {
      if (fase === "fine") { if (!punti.length) g = null; else annulla(); return null; }
      if (fase === "inizio") {
        if (punti.length === 2) {
          const [a, b] = punti, d0 = dist(a, b);
          g = { a: { ...a }, b: { ...b }, d0, annullato: d0 < S.minimaDistanza, fatto: false };
        } else if (punti.length > 2) annulla();
        else g = null; // un dito solo: non è il nostro gesto
        return null;
      }
      if (!g || g.annullato || g.fatto) return null;
      if (punti.length !== 2) { annulla(); return null; }
      const a = punti.find((p) => p.id === g.a.id), b = punti.find((p) => p.id === g.b.id);
      if (!a || !b) { annulla(); return null; }
      const d = dist(a, b), variazione = Math.abs(d - g.d0);
      if (variazione > S.pizzico * g.d0) { annulla(); return null; } // è uno zoom (o una rotazione)
      const dxa = a.x - g.a.x, dya = a.y - g.a.y, dxb = b.x - g.b.x, dyb = b.y - g.b.y;
      const dy = (dya + dyb) / 2, dx = (dxa + dxb) / 2;
      if (Math.abs(dy) < S.spostamento) return null; // ancora presto per decidere
      const tollerata = variazione <= Math.max(S.distanzaAssoluta, S.distanza * g.d0);
      const stessoVerso = dya * dyb > 0;
      const accordo = Math.min(Math.abs(dya), Math.abs(dyb)) >= S.accordo * Math.max(Math.abs(dya), Math.abs(dyb));
      const verticale = Math.abs(dy) >= S.verticale * Math.abs(dx);
      if (!(tollerata && stessoVerso && accordo && verticale)) { annulla(); return null; }
      if (dy > 0) { annulla(); return null; } // verso il basso non inclina (la mappa è già a 0°)
      g.fatto = true;
      return { tipo: "inclina", spostamento: -dy, centro: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    },
    reset() { g = null; },
  };
}

/** Computer: tasto Ctrl premuto e trascinamento del mouse verso l'alto. Stessa idea, un solo punto. */
export function creaRiconoscitoreMouse(soglie = {}) {
  const S = { ...SOGLIE, ...soglie };
  let g = null;
  return {
    aggiorna(fase, p = {}) {
      if (fase === "inizio") { g = p.ctrl ? { x: p.x, y: p.y, fatto: false } : null; return null; }
      if (fase === "fine") { g = null; return null; }
      if (!g || g.fatto || !p.ctrl) return null;
      const dy = p.y - g.y, dx = p.x - g.x;
      if (-dy < S.mouse) return null;
      if (Math.abs(dx) > Math.abs(dy)) { g.fatto = true; return null; }
      g.fatto = true;
      return { tipo: "inclina", spostamento: -dy, centro: { x: p.x, y: p.y } };
    },
    reset() { g = null; },
  };
}

/** Inclinazione (gradi) con cui aprire il 3D, secondo quanto le dita sono salite: da 40° a 65°. */
export const inclinazioneIniziale = (spostamento) => {
  const extra = Number.isFinite(Number(spostamento)) ? (Number(spostamento) - SOGLIE.spostamento) * 0.25 : 0;
  return Math.round(Math.max(40, Math.min(65, 40 + extra)));
};

/**
 * Collega i riconoscitori agli eventi del contenitore della mappa. `quandoInclina({tipo, spostamento, centro})` viene
 * chiamata una volta per gesto. Non blocca né modifica nessun evento: Leaflet continua a lavorare e la vista 3D,
 * quando si chiude, rimette la mappa dove l'utente è arrivato. Restituisce la funzione che scollega tutto.
 */
export function collegaGestoInclina(contenitore, quandoInclina, { win = globalThis } = {}) {
  const dita = creaRiconoscitore(), topo = creaRiconoscitoreMouse();
  const punti = (ev) => Array.from(ev.touches ?? [], (t) => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
  const passa = (r) => { if (r) quandoInclina(r); };
  const inizio = (ev) => passa(dita.aggiorna("inizio", punti(ev)));
  const mov = (ev) => passa(dita.aggiorna("movimento", punti(ev)));
  const fine = (ev) => passa(dita.aggiorna("fine", punti(ev)));
  const giu = (ev) => { if (ev.button === 0 || ev.button == null) topo.aggiorna("inizio", { x: ev.clientX, y: ev.clientY, ctrl: ev.ctrlKey || ev.metaKey }); };
  const muovi = (ev) => passa(topo.aggiorna("movimento", { x: ev.clientX, y: ev.clientY, ctrl: ev.ctrlKey || ev.metaKey }));
  const su = () => topo.aggiorna("fine");
  const opz = { passive: true };
  contenitore.addEventListener("touchstart", inizio, opz);
  win.addEventListener("touchmove", mov, { passive: true, capture: true });
  win.addEventListener("touchend", fine, { passive: true, capture: true });
  win.addEventListener("touchcancel", fine, { passive: true, capture: true });
  contenitore.addEventListener("mousedown", giu);
  win.addEventListener("mousemove", muovi);
  win.addEventListener("mouseup", su);
  return () => {
    contenitore.removeEventListener("touchstart", inizio, opz);
    win.removeEventListener("touchmove", mov, { capture: true });
    win.removeEventListener("touchend", fine, { capture: true });
    win.removeEventListener("touchcancel", fine, { capture: true });
    contenitore.removeEventListener("mousedown", giu);
    win.removeEventListener("mousemove", muovi);
    win.removeEventListener("mouseup", su);
    dita.reset(); topo.reset();
  };
}
