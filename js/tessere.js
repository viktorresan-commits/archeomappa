// Tessere WMS: ripiego con il client HTTP nativo (app Android) e diagnosi leggibile.
//
// Perché: un livello WMS normalmente mostra le tessere con un semplice <img>. Se il WebView non le carica
// (blocchi di rete, risposte non immagine, ecc.) l'utente vede solo «non si carica» senza sapere perché.
// Nell'app Android si può riprovare con il client nativo, che aggira i blocchi del WebView e permette di
// leggere la risposta del servizio: così, quando c'è un errore del servizio, lo si riporta com'è.

const daBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const brevi = (testo) => String(testo).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);

export const clienteNativo = (win = globalThis) => (win.Capacitor?.isNativePlatform?.() ? win.Capacitor.Plugins?.CapacitorHttp ?? null : null);

/** Scarica una tessera con il client nativo. Restituisce {src, tipo, byte, stato}; se non è un'immagine, {errore}. */
export async function scaricaTessera(http, url) {
  let r;
  try {
    r = await http.get({ url, responseType: "blob", connectTimeout: 15000, readTimeout: 30000 });
  } catch (e) {
    return { errore: `il servizio non risponde (${e?.message ?? "rete"})`, stato: 0 };
  }
  const tipo = String(r.headers?.["Content-Type"] ?? r.headers?.["content-type"] ?? "").split(";")[0].trim();
  const dati = typeof r.data === "string" ? r.data : "";
  if (r.status !== 200) return { errore: `il servizio ha risposto ${r.status}`, stato: r.status, tipo };
  if (!/^image\//i.test(tipo)) {
    let testo = "";
    try { testo = brevi(new TextDecoder().decode(daBase64(dati))); } catch { /* non è testo */ }
    return { errore: `il servizio risponde con un messaggio invece che con un'immagine${testo ? `: «${testo}»` : ` (${tipo || "tipo sconosciuto"})`}`, stato: r.status, tipo };
  }
  return { src: `data:${tipo};base64,${dati}`, tipo, byte: Math.floor((dati.length * 3) / 4), stato: r.status };
}

/**
 * Se si è nell'app Android, fa riprovare con il client nativo ogni tessera che il WebView non carica.
 * `stato` è un oggetto del chiamante: vi si aggiornano ok, errori, nativo e messaggio.
 * Restituisce true se il ripiego è attivo.
 */
export function aggiungiRipiegoNativo(layer, { win = globalThis, stato = {} } = {}) {
  const http = clienteNativo(win);
  if (!http?.get || typeof layer.createTile !== "function") return false;
  const originale = layer.createTile.bind(layer);
  layer.createTile = function (coords, fatto) {
    let tentato = false;
    const tile = originale(coords, (err, t) => {
      if (!err) { stato.ok = (stato.ok ?? 0) + 1; return fatto(null, t); }
      if (tentato) { stato.messaggio ||= "l'immagine ricevuta non è leggibile"; return fatto(err, t); }
      tentato = true;
      const url = this.getTileUrl(coords);
      scaricaTessera(http, url).then((esito) => {
        if (esito.src) {
          stato.nativo = (stato.nativo ?? 0) + 1;
          t.src = esito.src; // il «load» originale chiude il giro e segnala la tessera come caricata
        } else {
          stato.messaggio = esito.errore;
          fatto(err, t);
        }
      });
    });
    return tile;
  };
  return true;
}

/**
 * Prova una tessera del livello (quella al centro della mappa) e racconta che cosa succede.
 * Restituisce {url, via, ok, dettaglio, miniatura?}.
 */
export async function provaTessera({ url, win = globalThis }) {
  const http = clienteNativo(win);
  if (http?.get) {
    const e = await scaricaTessera(http, url);
    return e.src
      ? { url, via: "client nativo dell'app", ok: true, dettaglio: `immagine ${e.tipo}, ${Math.max(1, Math.round(e.byte / 1024))} KB`, miniatura: e.src }
      : { url, via: "client nativo dell'app", ok: false, dettaglio: e.errore };
  }
  return new Promise((risolvi) => {
    const img = new win.Image();
    const t = setTimeout(() => risolvi({ url, via: "browser", ok: false, dettaglio: "nessuna risposta entro 15 secondi" }), 15000);
    img.onload = () => { clearTimeout(t); risolvi({ url, via: "browser", ok: true, dettaglio: `immagine ${img.naturalWidth}×${img.naturalHeight}`, miniatura: url }); };
    img.onerror = () => {
      clearTimeout(t);
      const https = win.location?.protocol === "https:";
      const http_ = url.startsWith("http://");
      risolvi({
        url, via: "browser", ok: false,
        dettaglio: https && http_
          ? "il browser blocca le immagini http dentro una pagina https"
          : "il browser non ha ricevuto un'immagine (servizio che non risponde, che non accetta https o che risponde con un errore); il browser non dice quale",
      });
    };
    img.src = url;
  });
}
