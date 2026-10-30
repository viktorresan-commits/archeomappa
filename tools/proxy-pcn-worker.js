// Proxy gratuito per i servizi WMS del Geoportale nazionale (Cloudflare Workers).
//
// A cosa serve: i servizi del Ministero (LiDAR, ortofoto) sono pensati per http e una pagina https,
// come il sito su GitHub Pages, non può caricarli. Questo piccolo programma sta su internet con un
// indirizzo https, chiede le immagini al Ministero al posto del browser e le restituisce.
//
// Come si usa (una volta sola, circa cinque minuti, anche da telefono):
//  1. Crea un account gratuito su https://dash.cloudflare.com
//  2. Menu «Workers e Pages» → «Crea» → «Crea Worker» → dagli un nome → «Distribuisci».
//  3. «Modifica codice», cancella tutto, incolla questo file, «Distribuisci».
//  4. Copia l'indirizzo del Worker (finisce con .workers.dev) e incollalo nell'app, in
//     Livelli → «Servizi del Ministero: proxy» → Salva.
//
// Limiti: passano solo le richieste verso le mappe WMS del Geoportale (parametro map=/ms_ogc/WMS_v1.3/…),
// quindi non è un proxy aperto. Il piano gratuito di Cloudflare ha un tetto di richieste al giorno.

const UPSTREAM = "http://wms.pcn.minambiente.it";
const INTESTAZIONI_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** Ammette solo /pcn/ogc?map=/ms_ogc/WMS_v1.3/…/nome.map */
export function richiestaAmmessa(url) {
  return url.pathname === "/pcn/ogc" && /^\/ms_ogc\/WMS_v1\.3\/[A-Za-z0-9_\-/]+\.map$/.test(url.searchParams.get("map") ?? "");
}

export default {
  async fetch(request, _env, _ctx, richiedi = fetch) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: INTESTAZIONI_CORS });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Metodo non ammesso", { status: 405, headers: INTESTAZIONI_CORS });
    const url = new URL(request.url);
    if (!richiestaAmmessa(url)) return new Response("Richiesta non ammessa", { status: 404, headers: INTESTAZIONI_CORS });
    let risposta;
    try {
      risposta = await richiedi(`${UPSTREAM}/ogc${url.search}`, { method: request.method, cf: { cacheEverything: true, cacheTtl: 86400 } });
    } catch {
      return new Response("Il servizio del Ministero non risponde", { status: 502, headers: INTESTAZIONI_CORS });
    }
    const intestazioni = new Headers(INTESTAZIONI_CORS);
    const tipo = risposta.headers.get("content-type");
    if (tipo) intestazioni.set("Content-Type", tipo);
    if (risposta.ok) intestazioni.set("Cache-Control", "public, max-age=86400");
    return new Response(risposta.body, { status: risposta.status, headers: intestazioni });
  },
};
