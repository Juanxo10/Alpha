# -*- coding: utf-8 -*-
r"""Crea la carpeta de una empresa nueva lista para su geovisor.

Uso (Python de QGIS, desde la carpeta del producto):
  python herramientas\nuevo_cliente.py --id sauces --empresa "Inversiones Los Sauces" --proyecto "Los Sauces" ^
         --ciudad "Acacías, Meta" --gpkg "D:\clientes\sauces\LOTEO.gpkg" [--ortofoto "D:\clientes\sauces\orto.tif"] ^
         [--logo "D:\clientes\sauces\logo_blanco.png" --logo-documentos "D:\clientes\sauces\logo_color.png"] ^
         [--primario "#1F3A5F" --acento "#F2B441"] [--crs "MAGNA-SIRGAS / Origen-Nacional (EPSG:9377)"]

Hace, en orden: carpeta clientes\<id> con cliente.json → cartografía (exportar_cartografia.py) → ortofoto
(agregar_ortofoto.py, si se da) → marca e iconos (marca.py). La base contable se crea sola la primera vez que se
abre el geovisor; el dueño de la empresa crea su cuenta con el CÓDIGO DE INSTALACIÓN que imprime este programa
(sin ese código nadie más puede tomar el control de una instalación nueva).
"""
import argparse
import json
import os
import re
import secrets
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERR = os.path.join(RAIZ, "herramientas")


def correr(*args):
    r = subprocess.run([sys.executable, *args], cwd=RAIZ)
    if r.returncode:
        sys.exit(f"Falló: {' '.join(args)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True, help="nombre corto sin espacios: será la carpeta y el subdominio (sauces.sudominio.com)")
    ap.add_argument("--empresa", required=True)
    ap.add_argument("--proyecto", required=True)
    ap.add_argument("--ciudad", default="")
    ap.add_argument("--gpkg", required=True)
    ap.add_argument("--ortofoto")
    ap.add_argument("--logo")
    ap.add_argument("--logo-documentos")
    ap.add_argument("--primario", default="#1F3A4D")
    ap.add_argument("--acento", default="#5FD3A0")
    ap.add_argument("--crs", default="MAGNA-SIRGAS / Colombia Bogotá (EPSG:3116)")
    a = ap.parse_args()

    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,30}", a.id):
        sys.exit("El id debe ser en minúsculas, sin espacios ni tildes (ej.: sauces, villa-maria).")
    carpeta = os.path.join(RAIZ, "clientes", a.id)
    if os.path.exists(carpeta):
        sys.exit(f"Ya existe {carpeta}")
    for sub in ("marca", "cartografia", "datos"):
        os.makedirs(os.path.join(carpeta, sub))
    codigo = "-".join(secrets.token_hex(2).upper() for _ in range(3))
    ficha = {
        "id": a.id, "empresa": a.empresa, "nombre_corto": a.proyecto[:12], "proyecto": a.proyecto,
        "subtitulo": "Control de ventas y cartera", "ciudad": a.ciudad,
        "colores": {"primario": a.primario, "acento": a.acento}, "crs_nombre": a.crs,
        "dominio": "", "capas_extra": [], "fuente_gpkg": os.path.abspath(a.gpkg),
        "codigo_instalacion": codigo,
    }
    with open(os.path.join(carpeta, "cliente.json"), "w", encoding="utf-8") as f:
        json.dump(ficha, f, ensure_ascii=False, indent=2)

    rel = os.path.relpath(carpeta, RAIZ)
    correr(os.path.join(HERR, "exportar_cartografia.py"), "--cliente", rel, "--gpkg", a.gpkg)
    if a.ortofoto:
        correr(os.path.join(HERR, "agregar_ortofoto.py"), "--cliente", rel, a.ortofoto)
    marca = [os.path.join(HERR, "marca.py"), "--cliente", rel]
    if a.logo:
        marca += ["--logo", a.logo]
    if a.logo_documentos:
        marca += ["--logo-documentos", a.logo_documentos]
    correr(*marca)
    print()
    print(f"Cliente {a.empresa} listo en {carpeta}")
    print(f"CÓDIGO DE INSTALACIÓN para el dueño: {codigo}   (entréguelo solo al dueño de la empresa)")
    print(f"Probar en este equipo:  PROBAR_CLIENTE.bat {a.id}")


if __name__ == "__main__":
    main()
