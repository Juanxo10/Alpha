# -*- coding: utf-8 -*-
r"""Convierte la ortofoto del loteo en teselas locales para el geovisor.

Uso (Python de QGIS):
  python herramientas\agregar_ortofoto.py --cliente clientes\merced "D:\ruta\ortofoto.tif"
  opciones:  --zoom-max 21      limita el zoom máximo (por defecto, el que da la resolución de la ortofoto, máx. 22)
             --descripcion "Ortofoto dron oct-2026"

Deja las teselas en clientes\<id>\cartografia\orto\{z}\{x}\{y}.webp (o .png) y un orto.json con los límites y zooms.
Al recargar el geovisor aparece la base «Ortofoto» y queda activa por defecto.
"""
import argparse
import datetime as dt
import json
import math
import os
import shutil
import sys

Q = r"C:\Program Files\QGIS 3.40.2"
os.environ.setdefault("PROJ_DATA", Q + r"\share\proj")
os.environ.setdefault("GDAL_DATA", Q + r"\apps\gdal\share\gdal")
from osgeo import gdal, osr  # noqa: E402
from osgeo_utils import gdal2tiles  # noqa: E402

gdal.UseExceptions()
DESTINO = None


def main():
    global DESTINO
    ap = argparse.ArgumentParser()
    ap.add_argument("--cliente", required=True)
    ap.add_argument("raster")
    ap.add_argument("--zoom-min", type=int, default=15)
    ap.add_argument("--zoom-max", type=int)
    ap.add_argument("--descripcion", default="Ortofoto del loteo")
    a = ap.parse_args()
    DESTINO = os.path.join(a.cliente, "cartografia", "orto")

    ds = gdal.Open(a.raster)
    if ds is None:
        sys.exit(f"No se pudo abrir {a.raster}")
    srs = osr.SpatialReference(wkt=ds.GetProjection())
    if not ds.GetProjection():
        sys.exit("La ortofoto no tiene sistema de coordenadas definido.")
    gt = ds.GetGeoTransform()
    # resolución en metros y límites en WGS84
    w84 = osr.SpatialReference()
    w84.ImportFromEPSG(4326)
    w84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    tr = osr.CoordinateTransformation(srs, w84)
    xs = [gt[0], gt[0] + gt[1] * ds.RasterXSize]
    ys = [gt[3], gt[3] + gt[5] * ds.RasterYSize]
    esquinas = [tr.TransformPoint(x, y)[:2] for x in xs for y in ys]
    lon = [p[0] for p in esquinas]
    lat = [p[1] for p in esquinas]
    bounds = [min(lon), min(lat), max(lon), max(lat)]
    if srs.IsProjected():
        res = abs(gt[1]) * srs.GetLinearUnits()
    else:
        res = abs(gt[1]) * 111320 * math.cos(math.radians(sum(lat) / 2))
    natural = math.ceil(math.log2(156543.03392 * math.cos(math.radians(sum(lat) / 2)) / res))
    zmax = min(a.zoom_max or natural, 22)
    print(f"Ortofoto: {ds.RasterXSize} x {ds.RasterYSize} px · {ds.RasterCount} bandas · {res * 100:.1f} cm/px")
    print(f"Teselas: zoom {a.zoom_min} a {zmax}")

    ext = "webp" if gdal.GetDriverByName("WEBP") else "png"
    if os.path.isdir(DESTINO):
        shutil.rmtree(DESTINO)
    os.makedirs(DESTINO)
    argv = ["gdal2tiles", "--xyz", f"--zoom={a.zoom_min}-{zmax}", f"--processes={min(os.cpu_count() or 4, 16)}", "--webviewer=none",
            "--resampling=bilinear", "--exclude"]
    if ext == "webp":
        argv += ["--tiledriver=WEBP", "--webp-quality=85"]
    argv += [a.raster, DESTINO]
    gdal2tiles.main(argv)

    n = sum(len(f) for _, _, f in os.walk(DESTINO))
    meta = {"minzoom": a.zoom_min, "maxzoom": zmax, "bounds": [round(b, 7) for b in bounds], "scheme": "xyz",
            "ext": ext, "descripcion": a.descripcion, "resolucion_cm": round(res * 100, 1),
            "origen": os.path.basename(a.raster), "generado": dt.datetime.now().strftime("%Y-%m-%d %H:%M")}
    with open(os.path.join(DESTINO, "orto.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"Listo: {n} teselas .{ext} en {DESTINO}")
    print("Recargue el geovisor (F5) para ver la ortofoto.")


if __name__ == "__main__":
    main()
