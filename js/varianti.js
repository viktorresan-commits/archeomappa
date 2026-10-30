// Varianti di richiesta per i servizi raster del Ministero (ortofoto, IGM).
//
// Perché: questi servizi hanno un livello per ogni fuso UTM (nome.32 e nome.33) e non sempre rispondono
// a ogni formato di richiesta. Dal sito del Ministero non si può sapere in anticipo quale variante
// funzioni (l'ambiente di sviluppo non lo raggiunge), quindi l'app le prova sul telefono, nell'ordine
// qui sotto, e usa la prima che restituisce un'immagine. Le prime due sono il formato dell'app Grok
// dell'utente (WMS 1.3.0, tessere da 512 px); la terza è il formato dell'app Android di riferimento.

/** Fuso UTM (32 = 6–12° E, 33 = 12–18° E) in cui cade la longitudine. */
export const fusoPerLon = (lon) => (lon < 12 ? 32 : 33);

/**
 * Varianti da provare per una famiglia di livelli (es. «OI.ORTOIMMAGINI.2012», che esiste come .32 e .33).
 * Restituisce [{id, etichetta, versione, livelli, tile, fuso}], dalla più probabile alla meno
 * (fuso = null se la richiesta include entrambi i fusi).
 */
export function variantiPcn(famiglia, lon) {
  const f = fusoPerLon(lon);
  const altro = f === 32 ? 33 : 32;
  const entrambi = `${famiglia}.32,${famiglia}.33`;
  return [
    { id: "A", etichetta: "WMS 1.3.0, fusi 32 e 33 insieme, immagini da 512 px", versione: "1.3.0", livelli: entrambi, tile: 512, fuso: null },
    { id: "B", etichetta: `WMS 1.3.0, solo il fuso ${f}, immagini da 512 px`, versione: "1.3.0", livelli: `${famiglia}.${f}`, tile: 512, fuso: f },
    { id: "C", etichetta: `WMS 1.1.1, solo il fuso ${f}, tessere da 256 px`, versione: "1.1.1", livelli: `${famiglia}.${f}`, tile: 256, fuso: f },
    { id: "D", etichetta: "WMS 1.1.1, fusi 32 e 33 insieme, tessere da 256 px", versione: "1.1.1", livelli: entrambi, tile: 256, fuso: null },
    { id: "E", etichetta: `WMS 1.3.0, solo il fuso ${altro}, immagini da 512 px`, versione: "1.3.0", livelli: `${famiglia}.${altro}`, tile: 512, fuso: altro },
  ];
}

/** Come variantiPcn, ma con la variante già scelta in testa (se esiste ancora nell'elenco). */
export function variantiConPreferita(famiglia, lon, idPreferita) {
  const tutte = variantiPcn(famiglia, lon);
  const i = tutte.findIndex((v) => v.id === idPreferita);
  return i > 0 ? [tutte[i], ...tutte.slice(0, i), ...tutte.slice(i + 1)] : tutte;
}

/** Sceglie la prima variante che restituisce un'immagine non vuota; se tutte sono vuote, la prima che risponde. */
export function scegliVariante(esiti) {
  const buona = esiti.find((e) => e.ok && !e.vuota);
  if (buona) return { variante: buona.variante, stato: "ok" };
  const vuota = esiti.find((e) => e.ok);
  if (vuota) return { variante: vuota.variante, stato: "vuota" };
  return { variante: null, stato: "guasto" };
}

/** La variante scelta chiede un solo fuso e il centro della mappa è passato nell'altro: conviene sceglierla di nuovo. */
export const fusoCambiato = (variante, lon) => !!variante && variante.fuso != null && variante.fuso !== fusoPerLon(lon);
