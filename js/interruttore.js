// «Spegni tutto» come interruttore. Funzioni pure: l'app le usa per decidere che cosa fa il tasto tondo.
//
// Primo tocco: spegne i livelli sovrapposti accesi e ne ricorda l'elenco. Tocco successivo (se nel frattempo
// non se ne è acceso nessuno): li riaccende. Se l'utente nel frattempo ne accende altri, il tocco successivo
// spegne quelli (e ricorda quelli): non si riaccende mai un elenco vecchio sopra uno nuovo.

/**
 * @param accesi    id dei livelli sovrapposti accesi adesso
 * @param ricordati id dei livelli che il tocco precedente ha spento
 * @returns {azione: "spegni"|"riaccendi"|"niente", ids}
 */
export function decidiSpegniTutto(accesi, ricordati) {
  if (accesi.length) return { azione: "spegni", ids: [...accesi] };
  if (ricordati.length) return { azione: "riaccendi", ids: [...ricordati] };
  return { azione: "niente", ids: [] };
}

/** L'elenco ricordato (anche letto da un salvataggio rovinato) ridotto ai livelli che esistono ancora, senza doppioni. */
export function ricordatiValidi(valore, presenti) {
  if (!Array.isArray(valore)) return [];
  return [...new Set(valore.filter((x) => typeof x === "string" && presenti.has(x)))];
}
