"""Copia el diseño original (CSS, fuentes, íconos) al frontend con los colores de la empresa aplicados.
Uso: python preparar_marca.py <carpeta_cliente> [carpeta_web_original]
"""
import json
import os
import re
import shutil
import sys

cliente = sys.argv[1]
web = sys.argv[2] if len(sys.argv) > 2 else os.path.join("..", "GEOVISOR_APP_INDEPENDIENTE", "app", "web")
destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
BASE = {"primario": "#0C2E37", "acento": "#5CE9AB"}


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mezcla(h, otro, t):
    a, b = rgb(h), rgb(otro)
    return "#" + "".join(f"{max(0, min(255, round(a[i] + (b[i] - a[i]) * t))):02X}" for i in range(3))


col = {**BASE, **(json.load(open(os.path.join(cliente, "cliente.json"), encoding="utf-8")).get("colores") or {})}
p, a, w, k = col["primario"].upper(), col["acento"].upper(), "#FFFFFF", "#000000"
tabla = {
    "#0C2E37": p, "#123C47": mezcla(p, w, .07), "#1B4E5B": mezcla(p, w, .15), "#16505E": mezcla(p, w, .18),
    "#081F25": mezcla(p, k, .35), "#A9C2C8": mezcla(p, w, .62),
    "#5CE9AB": a, "#17A974": mezcla(a, k, .32), "#4EE6D2": a,
    "#ECFBF4": mezcla(a, w, .9), "#F0FBF6": mezcla(a, w, .92), "#C9F2DE": mezcla(a, w, .72), "#C9F5E1": mezcla(a, w, .7),
    "rgba(92,233,171,": "rgba({},{},{},".format(*rgb(a)),
}
tabla = {x.upper(): v for x, v in tabla.items()}
patron = re.compile("|".join(re.escape(x) for x in sorted(tabla, key=len, reverse=True)), re.I)
css = open(os.path.join(web, "css", "app.css"), encoding="utf-8").read().replace("../lib/fonts/", "/fonts/")
open(os.path.join(destino, "src", "app.css"), "w", encoding="utf-8").write(patron.sub(lambda m: tabla[m.group(0).upper()], css))
for origen, sub in ((os.path.join(web, "lib", "fonts"), "fonts"), (os.path.join(cliente, "marca"), "marca")):
    shutil.copytree(origen, os.path.join(destino, "public", sub), dirs_exist_ok=True)
