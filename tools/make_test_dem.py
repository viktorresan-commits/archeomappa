#!/usr/bin/env python3
"""Crea rilievi sintetici (GeoTIFF/ASC) con terreno naturale e strutture note, per provare l'app.
Uso: python3 tools/make_test_dem.py CARTELLA_DI_USCITA
Strutture: recinto fortificato quadrato (terrapieno + fossato), tumulo, aggere lineare, collina naturale."""
import sys
from pathlib import Path
import numpy as np
import tifffile

def terreno(n, cella, seme=3):
    rng = np.random.RandomState(seme)
    y, x = np.mgrid[0:n, 0:n].astype("float64") * cella
    z = 300 + 0.02 * x + 0.015 * y
    for _ in range(6):  # ondulazioni naturali a grande scala
        fx, fy, ph, amp = rng.uniform(0.0008, 0.004), rng.uniform(0.0008, 0.004), rng.uniform(0, 6.28), rng.uniform(2, 9)
        z += amp * np.sin(fx * x + ph) * np.cos(fy * y + ph * 0.7)
    z += 25 * np.exp(-(((x - n * cella * 0.15) ** 2 + (y - n * cella * 0.8) ** 2) / (2 * 450.0 ** 2)))  # collina naturale
    z += rng.randn(n, n) * 0.08
    return z, x, y

def aggiungi(z, x, y, cella):
    n = z.shape[0]
    L = n * cella
    # 1) recinto fortificato quadrato: terrapieno 2,5 m largo 12 m, fossato esterno 1,2 m largo 8 m
    cx, cy, lato = L * 0.62, L * 0.35, 160.0
    dx, dy = np.abs(x - cx), np.abs(y - cy)
    d = np.maximum(dx, dy) - lato / 2  # distanza dal perimetro (positiva fuori)
    z += 2.5 * np.exp(-((d + 0) ** 2) / (2 * 4.5 ** 2))
    z -= 1.2 * np.exp(-((d - 10) ** 2) / (2 * 3.5 ** 2))
    # 2) tumulo: diametro ~40 m, alto 3 m
    tx, ty = L * 0.30, L * 0.30
    r2 = (x - tx) ** 2 + (y - ty) ** 2
    z += 3.0 * np.exp(-r2 / (2 * 11.0 ** 2))
    # 3) aggere lineare lungo ~500 m, largo ~8 m, alto 1,8 m, inclinato
    ax0, ay0, ax1, ay1 = L * 0.12, L * 0.10, L * 0.12 + 470, L * 0.10 + 190
    vx, vy = ax1 - ax0, ay1 - ay0
    ln = np.hypot(vx, vy)
    t = np.clip(((x - ax0) * vx + (y - ay0) * vy) / ln ** 2, 0, 1)
    dist = np.hypot(x - (ax0 + t * vx), y - (ay0 + t * vy))
    z += 1.8 * np.exp(-dist ** 2 / (2 * 3.2 ** 2))
    return z

def georef(origine_x, origine_y, cella, epsg):
    return [
        (33550, "d", 3, (cella, cella, 0.0), True),
        (33922, "d", 6, (0.0, 0.0, 0.0, origine_x, origine_y, 0.0), True),
        # GeoKeyDirectory: modello proiettato, raster PixelIsArea, ProjectedCSType=epsg
        (34735, "H", 16, (1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, epsg), True),
        (42113, "s", 0, "-9999", True),
    ]

def main(cartella):
    out = Path(cartella)
    out.mkdir(parents=True, exist_ok=True)
    # TIFF a 2 m: terreno 3 km x 3 km, UTM 32N (zona di Orvieto)
    cella, n = 2.0, 1500
    z, x, y = terreno(n, cella)
    z = aggiungi(z, x, y, cella).astype("float32")
    z[0:40, 0:40] = -9999  # vuoto (nodata)
    ox, oy, epsg = 760000.0, 4735000.0, 32632
    tifffile.imwrite(out / "dtm_2m_deflate.tif", z, compression="zlib", tile=(256, 256), extratags=georef(ox, oy, cella, epsg), photometric="minisblack")
    tifffile.imwrite(out / "dtm_2m_strisce.tif", z, rowsperstrip=64, extratags=georef(ox, oy, cella, epsg), photometric="minisblack")
    tifffile.imwrite(out / "dtm_2m_big.tif", z, bigtiff=True, compression="zlib", tile=(256, 256), extratags=georef(ox, oy, cella, epsg), photometric="minisblack")
    # interi a 16 bit in centimetri con predittore 2
    zi = np.round(np.where(z < -9000, -32768, z) * 100).astype("int16")
    tifffile.imwrite(out / "dtm_2m_int16_pred2.tif", zi, compression="zlib", predictor=2, rowsperstrip=64,
                     extratags=georef(ox, oy, cella, epsg)[:3] + [(42113, "s", 0, "-32768", True)], photometric="minisblack")
    # ASCII Grid
    with open(out / "dtm_2m.asc", "w") as f:
        f.write(f"ncols {n}\nnrows {n}\nxllcorner {ox}\nyllcorner {oy - n * cella}\ncellsize {cella}\nNODATA_value -9999\n")
        for r in range(n):
            f.write(" ".join(f"{v:.2f}" for v in z[r]) + "\n")
    # versione a 10 m (come TINITALY): stessa area, media 5x5
    z10 = z.reshape(n // 5, 5, n // 5, 5).mean(axis=(1, 3)).astype("float32")
    z10[z10 < -1000] = -9999
    tifffile.imwrite(out / "dtm_10m.tif", z10, compression="zlib", tile=(128, 128), extratags=georef(ox, oy, 10.0, epsg), photometric="minisblack")
    # posizioni vere delle strutture (UTM 32N) per i test
    L = n * cella
    pos = {"recinto": [ox + L * 0.62, oy - L * 0.35], "tumulo": [ox + L * 0.30, oy - L * 0.30], "aggere": [ox + L * 0.12 + 235, oy - (L * 0.10 + 95)]}
    import json
    (out / "verita.json").write_text(json.dumps({"epsg": epsg, "cella": cella, "origine": [ox, oy], "strutture": pos}, indent=1))
    print("creati in", out)

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "dem_prova")
