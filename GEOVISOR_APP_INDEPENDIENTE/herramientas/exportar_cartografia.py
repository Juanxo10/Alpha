# -*- coding: utf-8 -*-
r"""Exporta la cartografía de un cliente (GeoPackage en coordenadas planas, metros) a GeoJSON WGS84 para el geovisor.

Uso (Python de QGIS):
  python herramientas\exportar_cartografia.py --cliente clientes\merced --gpkg "D:\ruta\LOTEO.gpkg"

Capas del GeoPackage (nombres en MAYÚSCULA):
  LOTES          obligatoria: id_lote (MZ01-L001), manzana, lote, area_m2, frente_m, fondo_m
  MANZANAS       obligatoria: id_manzana (MZ01), manzana, n_lotes, area_m2
  LIMITE_LOTEO   obligatoria: límite del predio completo (base del % de participación)
  VIAS, ZONAS_VERDES (campo tipo: si dice RONDA o HIDRICA se pinta como protección hídrica), HIDROGRAFIA (o CANO)
                 opcionales
  capas_extra    las que liste cliente.json (capa_gpkg → archivo)
Solo toca la geometría y los datos técnicos del lote; la contabilidad vive en datos\contabilidad.sqlite.
"""
import argparse
import json
import os

Q = r"C:\Program Files\QGIS 3.40.2"
os.environ.setdefault("PROJ_DATA", Q + r"\share\proj")
os.environ.setdefault("GDAL_DATA", Q + r"\apps\gdal\share\gdal")
from osgeo import gdal  # noqa: E402

gdal.UseExceptions()
ap = argparse.ArgumentParser()
ap.add_argument("--cliente", required=True, help="carpeta del cliente (clientes\\<id>)")
ap.add_argument("--gpkg", help="GeoPackage del loteo (por defecto, el anotado en cliente.json → fuente_gpkg)")
ARGS = ap.parse_args()
with open(os.path.join(ARGS.cliente, "cliente.json"), encoding="utf-8") as f:
    CLIENTE = json.load(f)
GPKG = ARGS.gpkg or CLIENTE.get("fuente_gpkg")
if not GPKG or not os.path.exists(GPKG):
    raise SystemExit("Indique el GeoPackage del loteo con --gpkg")
SALIDA = os.path.join(ARGS.cliente, "cartografia")
OBLIGATORIAS = {"lotes": ["LOTES"], "manzanas": ["MANZANAS"], "limite": ["LIMITE_LOTEO"]}
OPCIONALES = {"vias": ["VIAS"], "zonas_verdes": ["ZONAS_VERDES"], "hidrografia": ["HIDROGRAFIA", "CANO"]}
OPCIONALES.update({os.path.splitext(x["archivo"])[0]: [x["capa_gpkg"]] for x in CLIENTE.get("capas_extra", []) if x.get("capa_gpkg")})
_ds = gdal.OpenEx(GPKG)
EXISTENTES = {_ds.GetLayer(i).GetName().upper(): _ds.GetLayer(i).GetName() for i in range(_ds.GetLayerCount())}
_ds = None

os.makedirs(SALIDA, exist_ok=True)
for nombre, candidatas in {**OBLIGATORIAS, **OPCIONALES}.items():
    capa = next((EXISTENTES[c] for c in candidatas if c in EXISTENTES), None)
    destino = os.path.join(SALIDA, nombre + ".geojson")
    if capa is None:
        if nombre in OBLIGATORIAS:
            raise SystemExit(f"El GeoPackage no tiene la capa obligatoria {candidatas[0]}")
        if os.path.exists(destino):
            os.remove(destino)
        continue
    if os.path.exists(destino):
        os.remove(destino)
    opciones = dict(format="GeoJSON", dstSRS="EPSG:4326", reproject=True,
                    layerCreationOptions=["COORDINATE_PRECISION=7", "RFC7946=YES"])
    if nombre == "lotes":   # del lote solo salen los datos técnicos (nunca datos de compradores que traiga el GeoPackage)
        _ds = gdal.OpenEx(GPKG)
        defn = _ds.GetLayerByName(capa).GetLayerDefn()
        hay = {defn.GetFieldDefn(i).GetName() for i in range(defn.GetFieldCount())}
        geom = _ds.GetLayerByName(capa).GetGeometryColumn() or "geom"
        _ds = None
        faltan = {"id_lote", "manzana", "lote", "area_m2"} - hay
        if faltan:
            raise SystemExit(f"A la capa LOTES le faltan los campos: {', '.join(sorted(faltan))}")
        campos = [f for f in ("id_lote", "manzana", "lote", "origen_num", "area_m2", "frente_m", "fondo_m") if f in hay]
        opciones["SQLStatement"] = f"SELECT {', '.join(campos)}, {geom} FROM {capa}"
    else:
        opciones["layers"] = [capa]
    gdal.VectorTranslate(destino, GPKG, options=gdal.VectorTranslateOptions(**opciones))
    with open(destino, encoding="utf-8") as f:
        n = len(json.load(f)["features"])
    print(f"{nombre:13s} {n:5d} entidades  {os.path.getsize(destino) / 1024:7.0f} KB")

# Un punto de etiqueta por manzana (las que el caño parte en dos traen varias piezas)
from shapely.geometry import shape, mapping  # noqa: E402
from shapely.ops import polylabel  # noqa: E402

with open(os.path.join(SALIDA, "manzanas.geojson"), encoding="utf-8") as f:
    manz = json.load(f)
puntos = []
for ft in manz["features"]:
    g = shape(ft["geometry"])
    pieza = max(getattr(g, "geoms", [g]), key=lambda p: p.area)
    puntos.append({"type": "Feature", "properties": ft["properties"],
                   "geometry": mapping(polylabel(pieza, tolerance=1e-6))})
with open(os.path.join(SALIDA, "manzanas_etq.geojson"), "w", encoding="utf-8") as f:
    json.dump({"type": "FeatureCollection", "features": puntos}, f, ensure_ascii=False)
print(f"manzanas_etq  {len(puntos):5d} puntos de etiqueta")

# ------------------------------------------------------------------------------------------------
# Datos técnicos de cada lote (calculada en EPSG:3116): perímetro, centroide y cuadro de linderos
# ------------------------------------------------------------------------------------------------
import math  # noqa: E402

from osgeo import ogr  # noqa: E402
from shapely import STRtree, wkb  # noqa: E402
from shapely.geometry import Point  # noqa: E402
from shapely.geometry.polygon import orient  # noqa: E402

ogr.UseExceptions()
gp = ogr.Open(GPKG)


def leer(capa, campo):
    lyr = gp.GetLayerByName(capa)
    if lyr is None:   # capa opcional que el cliente no tiene
        return []
    nombres = [lyr.GetLayerDefn().GetFieldDefn(i).GetName() for i in range(lyr.GetLayerDefn().GetFieldCount())]
    return [(f.GetField(campo) if campo in nombres else None, wkb.loads(bytes(f.GetGeometryRef().ExportToWkb()))) for f in lyr]


lotes3116 = leer("LOTES", "id_lote")
vias3116 = [g for _, g in leer("VIAS", "id_via")]
zonas3116 = leer("ZONAS_VERDES", "tipo")
arbol = STRtree([g for _, g in lotes3116])
ids = [i for i, _ in lotes3116]
RUMBO = [(45, 135, "Norte"), (135, 225, "Occidente"), (225, 315, "Sur")]


def rumbo(nx, ny):
    a = math.degrees(math.atan2(ny, nx)) % 360
    for ini, fin, nom in RUMBO:
        if ini <= a < fin:
            return nom
    return "Oriente"


def colindante(p, propio):
    for k in arbol.query(p, predicate="intersects"):
        if ids[k] != propio:
            return ids[k]
    if any(v.intersects(p) for v in vias3116):
        return "Vía"
    for tipo, z in zonas3116:
        if z.intersects(p):
            if any(k in str(tipo).upper() for k in ("RONDA", "HIDRIC")):   # se nombra como venga en el plano: «Ronda hídrica del caño»
                t = str(tipo).strip().lower().replace("hidrica", "hídrica")
                return t[:1].upper() + t[1:]
            return "Zona verde / cesión"
    return "Límite del loteo"


def linderos(id_lote, poly):
    anillo = list(orient(poly.simplify(0.05), 1.0).exterior.coords)[:-1]
    # unir tramos casi alineados (menos de 10°) para obtener los costados del lote
    costados = []
    for i in range(len(anillo)):
        p, q = anillo[i], anillo[(i + 1) % len(anillo)]
        ang = math.atan2(q[1] - p[1], q[0] - p[0])
        if costados and abs((ang - costados[-1]["ang"] + math.pi) % (2 * math.pi) - math.pi) < math.radians(10):
            costados[-1]["q"] = q
        else:
            costados.append({"p": p, "q": q, "ang": ang})
    if len(costados) > 1 and abs((costados[0]["ang"] - costados[-1]["ang"] + math.pi) % (2 * math.pi) - math.pi) < math.radians(10):
        costados[0]["p"] = costados.pop()["p"]
    salida = []
    for c in costados:
        (x1, y1), (x2, y2) = c["p"], c["q"]
        largo = math.hypot(x2 - x1, y2 - y1)
        if largo < 0.3:
            continue
        nx, ny = (y2 - y1) / largo, -(x2 - x1) / largo  # normal exterior de un anillo antihorario
        vecinos = []
        for t in (0.2, 0.5, 0.8):
            punto = Point(x1 + (x2 - x1) * t + nx * 0.6, y1 + (y2 - y1) * t + ny * 0.6)
            v = colindante(punto, id_lote)
            if v not in vecinos:
                vecinos.append(v)
        salida.append({"rumbo": rumbo(nx, ny), "longitud_m": round(largo, 2), "colinda": vecinos})
    return salida


# participación de cada lote en el área total del predio (polígono LIMITE_LOTEO), para escrituración
area_predio = sum(g.area for _, g in leer("LIMITE_LOTEO", "nombre"))
tecnico = {}
for id_lote, g in lotes3116:
    c = g.centroid
    tecnico[id_lote] = {"perimetro_m": round(g.length, 2), "este": round(c.x, 2), "norte": round(c.y, 2),
                        "pct_predio": round(g.area / area_predio * 100, 6), "area_predio_m2": round(area_predio, 2),
                        "linderos": linderos(id_lote, g)}
ruta = os.path.join(SALIDA, "lotes.geojson")
with open(ruta, encoding="utf-8") as f:
    fc = json.load(f)
for ft in fc["features"]:
    ft["properties"].update(tecnico[ft["properties"]["id_lote"]])
with open(ruta, "w", encoding="utf-8") as f:
    json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))
print(f"predio        {area_predio:,.2f} m²; los lotes suman {sum(t['pct_predio'] for t in tecnico.values()):.4f} %")
print(f"lotes         perímetro, coordenadas, % del predio y linderos calculados ({os.path.getsize(ruta) / 1024:.0f} KB)")
