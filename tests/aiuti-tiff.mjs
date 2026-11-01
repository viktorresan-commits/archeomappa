// Aiuti per le prove: costruisce un GeoTIFF come quello che dà GeoServer (una sola banda, senza compressione).
export function creaTiff({ w, h, dati, le = false, blocchi = null, righePerStriscia = null, georef = null, nodata = "-9999.0", compressione = 1, bit = 32, formato = 3, matrice = true }) {
  const voci = []; // {tag, tipo, valori}
  voci.push({ tag: 256, tipo: 3, v: [w] }, { tag: 257, tipo: 3, v: [h] }, { tag: 258, tipo: 3, v: [bit] }, { tag: 259, tipo: 3, v: [compressione] }, { tag: 262, tipo: 3, v: [1] }, { tag: 277, tipo: 3, v: [1] });
  const byte = bit / 8;
  const nB = blocchi ? Math.ceil(w / blocchi) * Math.ceil(h / blocchi) : righePerStriscia ? Math.ceil(h / righePerStriscia) : 1;
  voci.push({ tag: 339, tipo: 3, v: [formato] });
  if (blocchi) voci.push({ tag: 322, tipo: 3, v: [blocchi] }, { tag: 323, tipo: 3, v: [blocchi] }, { tag: 324, tipo: 4, v: new Array(nB).fill(0) }, { tag: 325, tipo: 4, v: new Array(nB).fill(blocchi * blocchi * byte) });
  else voci.push({ tag: 273, tipo: 4, v: new Array(nB).fill(0) }, { tag: 278, tipo: 3, v: [righePerStriscia ?? h] }, { tag: 279, tipo: 4, v: new Array(nB).fill(0) });
  if (georef) {
    if (matrice) voci.push({ tag: 34264, tipo: 12, v: [georef.dx, 0, 0, georef.x0, 0, georef.dy, 0, georef.y0, 0, 0, 0, 0, 0, 0, 0, 1] });
    else voci.push({ tag: 33550, tipo: 12, v: [georef.dx, -georef.dy, 0] }, { tag: 33922, tipo: 12, v: [0, 0, 0, georef.x0, georef.y0, 0] });
    voci.push({ tag: 34735, tipo: 3, v: [1, 1, 2, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3857] });
  }
  if (nodata != null) voci.push({ tag: 42113, tipo: 2, v: nodata });
  voci.sort((a, b) => a.tag - b.tag);
  const dim = { 2: 1, 3: 2, 4: 4, 12: 8 };
  const nVoci = voci.length;
  let fine = 8 + 2 + nVoci * 12 + 4;
  for (const e of voci) { const n = e.tipo === 2 ? e.v.length + 1 : e.v.length; e.n = n; e.fuori = dim[e.tipo] * n > 4; if (e.fuori) { e.off = fine; fine += dim[e.tipo] * n; if (fine % 2) fine++; } }
  const inizioDati = fine;
  const buf = new ArrayBuffer(inizioDati + nB * (blocchi ? blocchi * blocchi : (righePerStriscia ?? h) * w) * byte);
  const dv = new DataView(buf);
  dv.setUint8(0, le ? 0x49 : 0x4d); dv.setUint8(1, le ? 0x49 : 0x4d);
  dv.setUint16(2, 42, le); dv.setUint32(4, 8, le); dv.setUint16(8, nVoci, le);
  const scrivi = (o, tipo, x) => (tipo === 3 ? dv.setUint16(o, x, le) : tipo === 4 ? dv.setUint32(o, x, le) : dv.setFloat64(o, x, le));
  // posizioni dei blocchi di dati
  const dimBlocco = (blocchi ? blocchi * blocchi : (righePerStriscia ?? h) * w) * byte;
  for (const e of voci) { if (e.tag === 324 || e.tag === 273) e.v = e.v.map((_, i) => inizioDati + i * dimBlocco); }
  voci.forEach((e, i) => {
    const o = 10 + i * 12;
    dv.setUint16(o, e.tag, le); dv.setUint16(o + 2, e.tipo, le); dv.setUint32(o + 4, e.n, le);
    let p = e.fuori ? e.off : o + 8;
    if (e.fuori) dv.setUint32(o + 8, e.off, le);
    if (e.tipo === 2) { for (let k = 0; k < e.v.length; k++) dv.setUint8(p + k, e.v.charCodeAt(k)); }
    else e.v.forEach((x, k) => scrivi(p + k * dim[e.tipo], e.tipo, x));
  });
  dv.setUint32(10 + nVoci * 12, 0, le);
  const scriviCampione = (o, v) => (formato === 3 && bit === 32 ? dv.setFloat32(o, v, le) : formato === 2 && bit === 16 ? dv.setInt16(o, v, le) : dv.setUint8(o, v));
  if (blocchi) {
    const perRiga = Math.ceil(w / blocchi);
    for (let t = 0; t < nB; t++) {
      const c0 = (t % perRiga) * blocchi, r0 = Math.floor(t / perRiga) * blocchi;
      for (let r = 0; r < blocchi; r++) for (let c = 0; c < blocchi; c++) {
        const v = r0 + r < h && c0 + c < w ? dati[(r0 + r) * w + c0 + c] : 0;
        scriviCampione(inizioDati + t * dimBlocco + (r * blocchi + c) * byte, v);
      }
    }
  } else for (let i = 0; i < w * h; i++) scriviCampione(inizioDati + i * byte, dati[i]);
  return buf;
}

