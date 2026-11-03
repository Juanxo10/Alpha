# -*- coding: utf-8 -*-
"""Montaje del video explicativo del geovisor (1920x1080, 30 fps) sobre timeline.json + mezcla.wav.

    python build_video.py                 -> GEOVISOR_Ventas_y_Cartera_Explicativo.mp4
    PREVIEW=3,20,41.5 python build_video.py   -> solo esos instantes a qc/ para revisar
"""
import json
import math
import os
import subprocess

import cv2
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from guion import PLANOS

BASE = os.path.dirname(os.path.abspath(__file__))
CAP = os.path.join(BASE, "_capturas")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
W, H, FPS = 1920, 1080, 30
FUENTES = os.path.join(os.path.dirname(BASE), "GEOVISOR", "geovisor", "lib", "fonts")
LOGOS = r"C:\Users\ULTRAHD\Downloads\Claude code\ALPHA_Campana\04_Marca_Logos\logos\hires"
TEAL, MENTA = (12, 46, 55), (92, 233, 171)
XF = 0.6           # fundido entre planos
COLA = 2.5         # aire final

tl = json.load(open(os.path.join(BASE, "timeline.json"), encoding="utf-8"))
TOTAL = tl["total"] + COLA
SHOTS = []
for p, s in zip(PLANOS, tl["shots"]):
    d = dict(p)
    d["t0"], d["dur"] = s["start"], s["dur"] + (COLA if p is PLANOS[-1] else 0)
    SHOTS.append(d)


# ---------------------------------------------------------------- utilidades
def fuente(nombre, tam, peso):
    f = ImageFont.truetype(os.path.join(FUENTES, nombre), tam)
    f.set_variation_by_axes([peso] if nombre == "Lexend.ttf" else [peso, 100])
    return f


def suave(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def entra(t, t0, d=0.45):
    return suave((t - t0) / d)


_cache = {}


def imagen(nombre):
    if nombre not in _cache:
        _cache[nombre] = np.array(Image.open(os.path.join(CAP, nombre + ".png")).convert("RGB"))
    return _cache[nombre]


def interp_cam(cam, f):
    """Encuadre [x, y, ancho] interpolado con suavizado entre fotogramas clave."""
    if f <= cam[0][0]:
        return cam[0][1]
    for (fa, a), (fb, b) in zip(cam, cam[1:]):
        if fa <= f <= fb:
            k = suave((f - fa) / max(fb - fa, 1e-6))
            return [a[i] + (b[i] - a[i]) * k for i in range(3)]
    return cam[-1][1]


def camara(img, rect):
    x, y, w = rect
    s = W / w
    M = np.float32([[s, 0, -x * s], [0, s, -y * s]])
    return cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def pegar_rgba(fondo, sprite, x, y, alfa=1.0):
    """Mezcla un sprite RGBA (np uint8) sobre fondo RGB en (x, y), recortando a los bordes."""
    h, w = sprite.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, fondo.shape[1]), min(y + h, fondo.shape[0])
    if x0 >= x1 or y0 >= y1 or alfa <= 0:
        return
    sp = sprite[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32)
    a = sp[..., 3:4] / 255.0 * alfa
    roi = fondo[y0:y1, x0:x1].astype(np.float32)
    fondo[y0:y1, x0:x1] = (roi * (1 - a) + sp[..., :3] * a).astype(np.uint8)


# ---------------------------------------------------------------- elementos gráficos
def sprite_marca(w, h):
    """Recuadro de resaltado: borde menta con halo, esquinas redondeadas."""
    m = 26
    im = Image.new("RGBA", (w + 2 * m, h + 2 * m), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([m - 4, m - 4, m + w + 4, m + h + 4], radius=12, outline=MENTA + (255,), width=10)
    halo = im.filter(ImageFilter.GaussianBlur(9))
    im = Image.new("RGBA", im.size, (0, 0, 0, 0))
    im.alpha_composite(halo)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([m - 4, m - 4, m + w + 4, m + h + 4], radius=12, outline=MENTA + (255,), width=4)
    return np.array(im), m


def sprite_cursor():
    pts = [(0, 0), (0, 34), (9, 26), (15, 40), (21, 37), (15, 24), (27, 24)]
    im = Image.new("RGBA", (40, 50), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    sombra = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(sombra).polygon([(x + 3, y + 4) for x, y in pts], fill=(0, 0, 0, 120))
    im.alpha_composite(sombra.filter(ImageFilter.GaussianBlur(2)))
    d = ImageDraw.Draw(im)
    d.polygon(pts, fill=(255, 255, 255, 255), outline=(16, 38, 44, 255))
    d.line(pts + [pts[0]], fill=(16, 38, 44, 255), width=2)
    return np.array(im.resize((60, 75), Image.LANCZOS))


CURSOR = sprite_cursor()
F_SEC = fuente("Lexend.ttf", 22, 600)
F_TIT = fuente("Lexend.ttf", 40, 600)


def sprite_rotulo(seccion, titulo):
    sec = seccion.upper()
    d0 = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    w = int(max(d0.textlength(titulo, font=F_TIT), d0.textlength(sec, font=F_SEC) * 1.12)) + 74
    im = Image.new("RGBA", (w + 40, 160), (0, 0, 0, 0))
    sombra = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(sombra).rounded_rectangle([14, 18, w + 14, 132], radius=16, fill=(0, 0, 0, 110))
    im.alpha_composite(sombra.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([8, 8, w + 8, 122], radius=16, fill=TEAL + (240,))
    d.rounded_rectangle([8, 8, 20, 122], radius=6, fill=MENTA + (255,))
    x = 44
    for ch in sec:  # tracking manual del sobretítulo
        d.text((x, 26), ch, font=F_SEC, fill=MENTA + (255,))
        x += d.textlength(ch, font=F_SEC) + 2.2
    d.text((44, 56), titulo, font=F_TIT, fill=(255, 255, 255, 255))
    return np.array(im)


def logo(variante, ancho):
    im = Image.open(os.path.join(LOGOS, f"alpha_logo_{variante}_4960.png")).convert("RGBA")
    return np.array(im.resize((ancho, int(im.height * ancho / im.width)), Image.LANCZOS))


# ---------------------------------------------------------------- fondos de título, cierre y documentos
AEREO = imagen("c00_aereo")


def fondo_oscuro(img, cubrir=0.62, lateral=True):
    f = img.astype(np.float32)
    if lateral:
        g = np.linspace(cubrir + 0.18, cubrir - 0.25, W)[None, :, None]
    else:
        g = np.full((1, 1, 1), cubrir)
    teal = np.array(TEAL, np.float32)[None, None, :]
    return (f * (1 - g) + teal * g).astype(np.uint8)


FONDO_DOC = fondo_oscuro(cv2.GaussianBlur(AEREO, (0, 0), 22), 0.80, lateral=False)


def texto_sprite(txt, f, color=(255, 255, 255), tracking=0.0):
    d0 = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    w = int(d0.textlength(txt, font=f) + tracking * len(txt)) + 20
    h = int(f.size * 1.5)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if tracking:
        x = 4
        for ch in txt:
            d.text((x, 4), ch, font=f, fill=color + (255,))
            x += d.textlength(ch, font=f) + tracking
    else:
        d.text((4, 4), txt, font=f, fill=color + (255,))
    return np.array(im)


T_SOBRE = texto_sprite("LOTEO LA MERCED", fuente("Lexend.ttf", 28, 600), MENTA, tracking=4)
T_TIT1 = texto_sprite("Geovisor de ventas", fuente("Lexend.ttf", 92, 600))
T_TIT2 = texto_sprite("y cartera", fuente("Lexend.ttf", 92, 600))
T_SUB = texto_sprite("Toda la contabilidad del loteo, organizada sobre su propio mapa", fuente("Cabin.ttf", 36, 500), (214, 232, 236))
C_TIT = texto_sprite("Geovisor de ventas y cartera", fuente("Lexend.ttf", 58, 600))
C_LEMA = texto_sprite("Control total de cada lote y de cada peso", fuente("Cabin.ttf", 34, 500), MENTA)


def render_titulo(t, dur):
    k = t / dur
    img = camara(AEREO, [60 * k, 34 * k, W - 120 * k])
    img = fondo_oscuro(img, 0.66)
    a = entra(t, 0.6)
    cv2.rectangle(img, (134, 330), (134 + int(110 * a), 336), MENTA[::-1][::-1], -1)
    pegar_rgba(img, T_SOBRE, 130, 360 + int(20 * (1 - a)), a)
    pegar_rgba(img, T_TIT1, 124, 410 + int(30 * (1 - entra(t, 0.85))), entra(t, 0.85))
    pegar_rgba(img, T_TIT2, 124, 520 + int(30 * (1 - entra(t, 1.05))), entra(t, 1.05))
    pegar_rgba(img, T_SUB, 128, 660 + int(20 * (1 - entra(t, 1.5))), entra(t, 1.5))
    return img


def render_cierre(t, dur):
    k = t / dur
    img = camara(AEREO, [80 - 80 * k, 45 - 45 * k, W - 160 + 160 * k])
    img = fondo_oscuro(img, 0.80, lateral=False)
    cx = W // 2
    pegar_rgba(img, T_SOBRE, cx - T_SOBRE.shape[1] // 2, 400 + int(20 * (1 - entra(t, 0.3))), entra(t, 0.3))
    pegar_rgba(img, C_TIT, cx - C_TIT.shape[1] // 2, 450 + int(20 * (1 - entra(t, 0.7))), entra(t, 0.7))
    a = entra(t, 1.3)
    cv2.line(img, (cx - 220, 560), (cx - 220 + int(440 * a), 560), (MENTA[0], MENTA[1], MENTA[2]), 2)
    pegar_rgba(img, C_LEMA, cx - C_LEMA.shape[1] // 2, 585 + int(20 * (1 - entra(t, 1.6))), entra(t, 1.6))
    return img


# ---------------------------------------------------------------- planos de captura
def render_captura(p, t, dur):
    f = t / dur
    # capturas encadenadas con fundido corto
    imgs = p["img"]
    idx = max(i for i, (fi, _) in enumerate(imgs) if fi <= f)
    base = imagen(imgs[idx][1]).copy()
    if idx > 0:
        dt = t - imgs[idx][0] * dur
        if dt < 0.35:
            prev = imagen(imgs[idx - 1][1])
            a = suave(dt / 0.35)
            base = cv2.addWeighted(base, a, prev, 1 - a, 0)
    # foco sobre la marca activa: el resto se oscurece
    marcas = [m for m in p.get("marcas", []) if m[0] <= f]
    if marcas:
        fm, (mx, my, mw, mh) = marcas[-1]
        a = entra(t, fm * dur, 0.5)
        sombra = base.astype(np.float32) * (1 - 0.42 * a)
        sombra[my:my + mh, mx:mx + mw] = base[my:my + mh, mx:mx + mw]
        base = sombra.astype(np.uint8)
        spr, m = p["_spr"][len(marcas) - 1]
        pegar_rgba(base, spr, mx - m, my - m, a)
    # puntero
    cur = p.get("cursor")
    if cur:
        pos, ultimo_clic = None, None
        for (fa, a_, ca), (fb, b_, _) in zip(cur, cur[1:]):
            if fa <= f <= fb:
                k = suave((f - fa) / max(fb - fa, 1e-6))
                pos = (a_[0] + (b_[0] - a_[0]) * k, a_[1] + (b_[1] - a_[1]) * k)
        if pos is None:
            pos = cur[-1][1] if f > cur[-1][0] else cur[0][1]
        for fc, pc, clic in cur:
            if clic and fc <= f:
                ultimo_clic = (fc, pc)
        if ultimo_clic:
            dtc = t - ultimo_clic[0] * dur
            if 0 <= dtc < 0.55:
                r = int(10 + 46 * dtc / 0.55)
                capa = base.copy()
                cv2.circle(capa, tuple(int(v) for v in ultimo_clic[1]), r, (MENTA[0], MENTA[1], MENTA[2]), 5, cv2.LINE_AA)
                al = 1 - dtc / 0.55
                base = cv2.addWeighted(capa, al, base, 1 - al, 0)
        pegar_rgba(base, CURSOR, int(pos[0]) - 4, int(pos[1]) - 3)
    return camara(base, interp_cam(p["cam"], f))


def render_documento(p, t, dur):
    img = FONDO_DOC.copy()
    paginas = p["_pag"]
    n = len(paginas)
    seg = dur / n
    i = min(int(t / seg), n - 1)
    tl_ = t - i * seg
    for j in (i - 1, i):
        if j < 0:
            continue
        pg = paginas[j]
        ph, pw = pg.shape[:2]
        sobra = max(ph - (H - 120), 0)
        if j == i:
            k = suave(min(max((tl_ - 1.5) / max(seg - 2.6, 0.1), 0), 1))
            y = 60 - int(sobra * k)
            entrada = entra(tl_, 0, 0.6) if i > 0 else entra(t, 0.15, 0.6)
            x = (W - pw) // 2 + int(120 * (1 - entrada))
            pegar_rgba(img, p["_sombra"], x - 30, y - 18, entrada * 0.9)
            pegar_rgba(img, pg, x, y, entrada)
        elif tl_ < 0.6:  # la página anterior sale hacia la izquierda
            sal = suave(tl_ / 0.6)
            y = 60 - sobra
            pegar_rgba(img, pg, (W - pw) // 2 - int(160 * sal), y, 1 - sal)
    return img


def preparar():
    for p in SHOTS:
        if p["tipo"] == "captura":
            p["_spr"] = [sprite_marca(m[1][2], m[1][3]) for m in p.get("marcas", [])]
        if p["tipo"] == "documento":
            pags = []
            for nombre in p["paginas"]:
                im = Image.open(os.path.join(CAP, nombre + ".png")).convert("RGBA")
                ancho = 1180 if len(p["paginas"]) == 1 else 860
                im = im.resize((ancho, int(im.height * ancho / im.width)), Image.LANCZOS)
                pags.append(np.array(im))
            p["_pag"] = pags
            ph, pw = pags[0].shape[:2]
            sh = Image.new("RGBA", (pw + 60, ph + 60), (0, 0, 0, 0))
            ImageDraw.Draw(sh).rectangle([30, 36, pw + 30, ph + 30], fill=(0, 0, 0, 150))
            p["_sombra"] = np.array(sh.filter(ImageFilter.GaussianBlur(16)))
        if p.get("rotulo"):
            p["_rot"] = sprite_rotulo(*p["rotulo"])


def render_plano(p, t):
    dur = p["dur"]
    if p["tipo"] == "titulo":
        img = render_titulo(t, dur)
    elif p["tipo"] == "cierre":
        img = render_cierre(t, dur)
    elif p["tipo"] == "documento":
        img = render_documento(p, t, dur)
    else:
        img = render_captura(p, t, dur)
    if p.get("rotulo"):
        fin = min(dur - XF - 0.45, 5.2)  # rótulo breve: presenta la sección y se retira
        a = entra(t, 0.5, 0.5) * (1 - entra(t, fin, 0.45))
        if p.get("rot_der"):
            pegar_rgba(img, p["_rot"], W - p["_rot"].shape[1] - 50 + int(40 * (1 - a)), H - 196, a)
        else:
            pegar_rgba(img, p["_rot"], 56 - int(40 * (1 - a)), H - 196, a)
    return img


def fotograma(t):
    activos = [p for p in SHOTS if p["t0"] <= t < p["t0"] + p["dur"]]
    if not activos:
        activos = [SHOTS[-1]]
    img = render_plano(activos[0], t - activos[0]["t0"])
    if len(activos) > 1:
        nuevo = activos[1]
        a = suave((t - nuevo["t0"]) / XF)
        img = cv2.addWeighted(render_plano(nuevo, t - nuevo["t0"]), a, img, 1 - a, 0)
    # fundido de entrada y salida del video
    g = min(entra(t, 0, 0.8), 1 - entra(t, TOTAL - 1.2, 1.2))
    if g < 1:
        img = (img.astype(np.float32) * g).astype(np.uint8)
    return img


def main():
    preparar()
    prev = os.environ.get("PREVIEW")
    if prev:
        os.makedirs(os.path.join(BASE, "qc"), exist_ok=True)
        for s in prev.split(","):
            t = float(s)
            Image.fromarray(fotograma(t)).save(os.path.join(BASE, "qc", f"t{t:06.2f}.png"))
            print("qc", t)
        return
    salida = os.path.join(BASE, "GEOVISOR_Ventas_y_Cartera_Explicativo.mp4")
    cmd = [FFMPEG, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-", "-i", os.path.join(BASE, "mezcla.wav"), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", salida]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n = int(TOTAL * FPS)
    for i in range(n):
        proc.stdin.write(fotograma(i / FPS).tobytes())
        if i % 300 == 0:
            print(f"{i}/{n}", flush=True)
    proc.stdin.close()
    proc.wait()
    print("OK ->", salida, round(os.path.getsize(salida) / 1e6, 1), "MB")


if __name__ == "__main__":
    main()
