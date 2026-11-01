// Ordine dei livelli sovrapposti: quale sta sopra e quale sotto. L'elenco va dall'alto (primo = sopra tutti)
// al basso. Funzioni pure: l'app le usa per decidere la profondità (z-index) di ogni livello sulla mappa.

/**
 * Ordine di partenza, dall'alto al basso: linee (catasto) sopra, poi il dato più fine (il LiDAR, 1 m), poi le
 * ombreggiature a scala larga (TINITALY 10 m, Esri 30 m: sopra il LiDAR lo velerebbero), poi le carte e le immagini.
 */
export const ORDINE_PREDEFINITO = [
  "catasto", "lidar", "ombre", "igm25", "igm100", "ombre-esri", "topoesri", "ortofoto",
  "wb2026", "wb2022", "wb2018", "wb2014",
];

/**
 * Ordine iniziale dei livelli `ids`: quello salvato (togliendo i livelli che non ci sono più e mettendo in cima i nuovi),
 * oppure, se non c'è, quello predefinito con i livelli non previsti in coda.
 */
export function ordineIniziale(ids, salvato) {
  const presenti = new Set(ids);
  if (Array.isArray(salvato)) {
    const tenuti = [...new Set(salvato.filter((x) => presenti.has(x)))];
    const nuovi = ids.filter((x) => !tenuti.includes(x));
    return [...nuovi, ...tenuti];
  }
  const noti = ORDINE_PREDEFINITO.filter((x) => presenti.has(x));
  return [...noti, ...ids.filter((x) => !noti.includes(x))];
}

/**
 * Sposta `id` di un livello in su (direzione -1) o in giù (+1). Un livello acceso passa sopra (o sotto) il
 * prossimo livello acceso, saltando quelli spenti, così il cambio si vede sulla mappa; se non ce ne sono, va in cima
 * (o in fondo). Un livello spento si sposta di un solo posto. Restituisce un nuovo elenco.
 */
export function spostaLivello(ordine, id, direzione, accesi) {
  const i = ordine.indexOf(id);
  if (i < 0) return [...ordine];
  const passo = direzione < 0 ? -1 : 1;
  const fuori = passo < 0 ? i === 0 : i === ordine.length - 1;
  if (fuori) return [...ordine];
  let j = i + passo;
  if (accesi.has(id)) {
    let k = i + passo;
    while (k >= 0 && k < ordine.length && !accesi.has(ordine[k])) k += passo;
    j = k >= 0 && k < ordine.length ? k : passo < 0 ? 0 : ordine.length - 1;
  }
  const out = ordine.filter((x) => x !== id);
  out.splice(j, 0, id);
  return out;
}

/** Profondità sulla mappa: il primo dell'elenco ha la più alta; tutte sopra le mappe di base (che stanno a 1). */
export function zIndexDi(ordine, id) {
  const i = ordine.indexOf(id);
  return i < 0 ? 10 : 10 + (ordine.length - i);
}
