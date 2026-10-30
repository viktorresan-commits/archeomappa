// Web Worker: legge e analizza il rilievo fuori dal thread dell'interfaccia.
import { creaSessione } from "./analisi.js";

const sessione = creaSessione();

self.onmessage = async (ev) => {
  const { id, op, dati } = ev.data ?? {};
  try {
    if (op === "apri") {
      self.postMessage({ id, ok: true, risultato: await sessione.apri(dati.file, dati.opzioni) });
    } else if (op === "apriPixel") {
      self.postMessage({ id, ok: true, risultato: await sessione.apriPixel(dati) });
    } else if (op === "analizza") {
      const r = await sessione.analizza(dati, (testo) => self.postMessage({ id, avanzamento: testo }));
      self.postMessage({ id, ok: true, risultato: r }, r.immagine ? [r.immagine.rgba.buffer] : []);
    } else if (op === "chiudi") {
      sessione.chiudi();
      self.postMessage({ id, ok: true, risultato: null });
    } else {
      self.postMessage({ id, ok: false, messaggio: "Operazione sconosciuta." });
    }
  } catch (e) {
    self.postMessage({ id, ok: false, messaggio: e?.message || "Errore imprevisto nel calcolo." });
  }
};
self.postMessage({ pronto: true });
