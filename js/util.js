// Utilità generali. Nessun accesso al DOM al momento dell'import (testabile in Node).

/** Restituisce l'URL solo se è http(s); altrimenti null. Evita javascript:, data:, ecc. */
export function urlSicuro(u) {
  if (typeof u !== "string") return null;
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch {
    return null;
  }
}

/** Crea un elemento DOM. I figli stringa diventano testo (mai HTML). */
export function h(tag, attrs, ...figli) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "href") {
      const ok = urlSicuro(v);
      if (ok) el.setAttribute("href", ok);
    } else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const f of figli.flat()) {
    if (f == null || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

/** Riga di dettagli (.meta): ogni testo in un proprio elemento, così nel layout flex restano separati. */
export function meta(...parti) {
  return h("div", { class: "meta" }, ...parti.flat().filter((p) => p != null && p !== false && p !== "").map((p) => (p instanceof Node ? p : h("span", null, p))));
}

/** CSV con escape e protezione dalle formule (=, +, -, @) nei fogli di calcolo. */
export function inCsv(righe, colonne) {
  const cella = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const testa = colonne.map((c) => cella(c.titolo)).join(";");
  const corpo = righe.map((r) => colonne.map((c) => cella(c.valore(r))).join(";"));
  return "﻿" + [testa, ...corpo].join("\r\n");
}

export function scarica(nomeFile, contenuto, mime) {
  const blob = new Blob([contenuto], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeFile;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function ritarda(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** Rimuove i tag HTML e decodifica le entità più comuni. */
export function soloTesto(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function tronca(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

// ------------------------------------------------------------ archiviazione

export const mem = {
  get(chiave, predefinito) {
    try {
      const v = localStorage.getItem(chiave);
      return v == null ? predefinito : JSON.parse(v);
    } catch {
      return predefinito;
    }
  },
  set(chiave, valore) {
    try {
      localStorage.setItem(chiave, JSON.stringify(valore));
      return true;
    } catch {
      return false;
    }
  },
  del(chiave) {
    try {
      localStorage.removeItem(chiave);
    } catch { /* ignora */ }
  },
};

// Cache delle risposte di rete (Cache API, con ripiego in memoria).
const inMemoria = new Map();
const NOME_CACHE = "am-dati-v1";

export async function cacheLeggi(chiave, ttlMs) {
  const adesso = Date.now();
  const m = inMemoria.get(chiave);
  if (m && adesso - m.t < ttlMs) return m.v;
  try {
    if (typeof caches === "undefined") return null;
    const c = await caches.open(NOME_CACHE);
    const r = await c.match(new Request(location.origin + "/__cache/" + encodeURIComponent(chiave)));
    if (!r) return null;
    const rec = await r.json();
    if (adesso - rec.t < ttlMs) {
      inMemoria.set(chiave, rec);
      return rec.v;
    }
  } catch { /* ignora */ }
  return null;
}

export async function cacheScrivi(chiave, valore) {
  const rec = { t: Date.now(), v: valore };
  inMemoria.set(chiave, rec);
  try {
    if (typeof caches === "undefined") return;
    const c = await caches.open(NOME_CACHE);
    await c.put(
      new Request(location.origin + "/__cache/" + encodeURIComponent(chiave)),
      new Response(JSON.stringify(rec), { headers: { "Content-Type": "application/json" } }),
    );
  } catch { /* ignora */ }
}

export async function cacheSvuota() {
  inMemoria.clear();
  try {
    if (typeof caches !== "undefined") await caches.delete(NOME_CACHE);
  } catch { /* ignora */ }
}

// ------------------------------------------------------------------- rete

export class ErroreRete extends Error {
  constructor(msg, codice) {
    super(msg);
    this.codice = codice;
  }
}

/**
 * Dentro l'app Android (Capacitor) le richieste possono passare dal client HTTP nativo, che non
 * è soggetto al blocco CORS e può leggere anche i servizi http. Altrove restituisce null.
 */
export function fetchNativo(win = globalThis) {
  const http = win.Capacitor?.isNativePlatform?.() ? win.Capacitor.Plugins?.CapacitorHttp : null;
  if (!http?.get) return null;
  return async (url) => {
    const r = await http.get({ url, responseType: "text" });
    const testo = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => testo, json: async () => JSON.parse(testo) };
  };
}

export async function prendi(url, { metodo = "GET", corpo, intestazioni, timeoutMs = 30000, tipo = "json", impl = globalThis.fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await impl(url, { method: metodo, body: corpo, headers: intestazioni, signal: ctrl.signal });
    if (!r.ok) throw new ErroreRete(`Il servizio ha risposto ${r.status}`, r.status);
    return tipo === "json" ? await r.json() : await r.text();
  } catch (e) {
    if (e instanceof ErroreRete) throw e;
    if (e?.name === "AbortError") throw new ErroreRete("Il servizio non ha risposto in tempo", "timeout");
    throw new ErroreRete("Servizio non raggiungibile (rete assente o accesso bloccato dal servizio)", "rete");
  } finally {
    clearTimeout(timer);
  }
}
