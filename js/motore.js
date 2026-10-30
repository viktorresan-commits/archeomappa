// Interfaccia verso il calcolo del rilievo: usa un Web Worker se il browser lo permette,
// altrimenti calcola nel thread principale (più lento, con l'interfaccia ferma durante il calcolo).

import { creaSessione } from "./analisi.js";

export function creaMotore({ crea = (url) => new Worker(url, { type: "module" }), attesaMs = 5000 } = {}) {
  let worker = null;
  let locale = null;
  let pronto = null;
  let id = 0;
  const attese = new Map();
  let modalita = "da-avviare";
  let ultimaApertura = null; // per riaprire il file se il worker viene ricreato dopo un arresto
  let daRiaprire = false;

  const fallisciTutto = (messaggio) => {
    for (const a of attese.values()) a.rifiuta(new Error(messaggio));
    attese.clear();
  };

  function avvia() {
    if (pronto) return pronto;
    pronto = new Promise((risolvi) => {
      const usaLocale = (motivo) => {
        try { worker?.terminate(); } catch { /* già chiuso */ }
        worker = null;
        locale = creaSessione();
        modalita = "thread";
        risolvi(motivo);
      };
      try {
        worker = crea(new URL("./worker-rilievo.js", import.meta.url));
      } catch (e) {
        usaLocale(e);
        return;
      }
      const timer = setTimeout(() => usaLocale("timeout"), attesaMs);
      worker.onmessage = (ev) => {
        const m = ev.data ?? {};
        if (m.pronto) { clearTimeout(timer); modalita = "worker"; risolvi("ok"); return; }
        const a = attese.get(m.id);
        if (!a) return;
        if (m.avanzamento) { a.avanzamento?.(m.avanzamento); return; }
        attese.delete(m.id);
        if (m.ok) a.risolvi(m.risultato); else a.rifiuta(new Error(m.messaggio || "Errore nel calcolo."));
      };
      worker.onerror = (ev) => {
        ev.preventDefault?.();
        if (modalita === "da-avviare") { clearTimeout(timer); usaLocale(ev); return; }
        fallisciTutto("Il calcolo si è interrotto, forse per mancanza di memoria. Riduci il raggio di analisi e riprova.");
        modalita = "da-avviare"; pronto = null; daRiaprire = !!ultimaApertura;
        try { worker.terminate(); } catch { /* già chiuso */ }
        worker = null;
      };
    });
    return pronto;
  }

  async function chiama(op, dati, avanzamento) {
    await avvia();
    if (daRiaprire && op === "analizza" && !locale) {
      daRiaprire = false;
      await chiama("apri", ultimaApertura);
    }
    if (locale) {
      if (op === "apri") return locale.apri(dati.file, dati.opzioni);
      if (op === "analizza") return locale.analizza(dati, avanzamento);
      return locale.chiudi();
    }
    return new Promise((risolvi, rifiuta) => {
      const n = ++id;
      attese.set(n, { risolvi, rifiuta, avanzamento });
      worker.postMessage({ id: n, op, dati });
    });
  }

  return {
    apri: (file, opzioni = {}) => { ultimaApertura = { file, opzioni }; return chiama("apri", ultimaApertura); },
    analizza: (parametri, avanzamento) => chiama("analizza", parametri, avanzamento),
    chiudi: () => chiama("chiudi", null),
    get modalita() { return modalita; },
    pronto: () => avvia(),
  };
}
