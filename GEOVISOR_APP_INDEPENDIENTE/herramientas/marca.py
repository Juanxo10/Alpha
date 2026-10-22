# -*- coding: utf-8 -*-
r"""Genera la marca de un cliente: iconos de la app (celular y computador) y logos.

Uso:
  python herramientas\marca.py --cliente clientes\merced
  python herramientas\marca.py --cliente clientes\merced --logo "D:\logos\merced.png" [--logo-documentos "D:\logos\merced_color.png"]

Sin --logo, los iconos llevan las iniciales de la empresa con sus colores (cliente.json → colores).
--logo:            logo para fondo oscuro (encabezado de la app). Se usa también en los documentos si no hay otro.
--logo-documentos: logo para fondo blanco (recibos, contratos, informes).
Deja en clientes\<id>\marca\: icono-192.png, icono-512.png, icono-maskable-512.png, apple-touch-icon.png,
favicon.png y, si se dieron, logo_claro.png y logo_documentos.png.
"""
import argparse
import json
import os

from PIL import Image, ImageDraw, ImageFont

FUENTE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "web", "lib", "fonts", "Lexend.ttf")


def iniciales(nombre):
    palabras = [p for p in nombre.replace("-", " ").split() if p[:1].isalnum() and p.lower() not in ("de", "del", "la", "el", "los", "las", "y", "sas", "s.a.s.")]
    return ("".join(p[0] for p in palabras[:2]) or nombre[:2]).upper()


def monograma(lado, texto, fondo, color, margen=0.0):
    im = Image.new("RGB", (lado, lado), fondo)
    d = ImageDraw.Draw(im)
    util = lado * (1 - 2 * margen)
    tam = int(util * (0.46 if len(texto) > 1 else 0.6))
    f = ImageFont.truetype(FUENTE, tam)
    caja = d.textbbox((0, 0), texto, font=f)
    w, h = caja[2] - caja[0], caja[3] - caja[1]
    d.text(((lado - w) / 2 - caja[0], (lado - h) / 2 - caja[1]), texto, font=f, fill=color)
    # línea de acento bajo las iniciales
    y = (lado + h) / 2 + util * 0.07
    d.rounded_rectangle([lado / 2 - util * 0.14, y, lado / 2 + util * 0.14, y + max(2, util * 0.035)], radius=util * 0.02, fill=color)
    return im


def con_logo(lado, logo, fondo, margen):
    im = Image.new("RGB", (lado, lado), fondo)
    lg = logo.copy()
    util = int(lado * (1 - 2 * margen))
    lg.thumbnail((util, util), Image.LANCZOS)
    im.paste(lg, ((lado - lg.width) // 2, (lado - lg.height) // 2), lg if lg.mode == "RGBA" else None)
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cliente", required=True)
    ap.add_argument("--logo")
    ap.add_argument("--logo-documentos")
    a = ap.parse_args()
    with open(os.path.join(a.cliente, "cliente.json"), encoding="utf-8") as f:
        cli = json.load(f)
    col = cli.get("colores") or {}
    fondo, acento = col.get("primario", "#0C2E37"), col.get("acento", "#5CE9AB")
    destino = os.path.join(a.cliente, "marca")
    os.makedirs(destino, exist_ok=True)
    logo = Image.open(a.logo).convert("RGBA") if a.logo else None
    if logo:
        logo.save(os.path.join(destino, "logo_claro.png"))
    doc = a.logo_documentos or a.logo
    if doc:
        Image.open(doc).convert("RGBA").save(os.path.join(destino, "logo_documentos.png"))
    texto = iniciales(cli.get("empresa") or cli.get("proyecto") or "GV")
    for nombre, lado, margen in (("icono-192.png", 192, .12), ("icono-512.png", 512, .12), ("apple-touch-icon.png", 180, .12),
                                 ("favicon.png", 64, .06), ("icono-maskable-512.png", 512, .22)):
        im = con_logo(lado, logo, fondo, margen) if logo else monograma(lado, texto, fondo, acento, margen)
        im.save(os.path.join(destino, nombre))
    print(f"Marca de {cli.get('empresa')}: iconos {'con el logo' if logo else 'con las iniciales ' + texto} en {destino}")


if __name__ == "__main__":
    main()
