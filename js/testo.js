// Testo leggibile da una risposta HTML/XML di un servizio: via i tag, le entità (&#39; &amp; …) tradotte, spazi ridotti.

const NOMI = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Traduce le entità HTML più comuni (nomi e numeri, anche esadecimali). Le sconosciute restano come sono. */
export function decodificaEntita(testo) {
  return String(testo).replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (tutto, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : tutto;
    }
    return NOMI[e.toLowerCase()] ?? tutto;
  });
}

/** Risposta di un servizio ridotta a una riga di testo, lunga al massimo `max` caratteri. */
export function testoDaHtml(contenuto, max = 220) {
  return decodificaEntita(String(contenuto).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, max);
}
