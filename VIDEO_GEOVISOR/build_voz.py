# -*- coding: utf-8 -*-
"""Locucion del video explicativo del geovisor de ventas y cartera.

Para que no suene a maquina, cada lamina se corta en clausulas y cada clausula
se sintetiza por separado con una velocidad ligeramente distinta: la primera
entra normal, las intermedias alternan y la ultima frena, que es lo que hace
una persona al cerrar una idea. Entre clausulas quedan silencios reales en vez
del ritmo plano del TTS.

Escribe timeline.json con la duracion real de cada lamina.

    python build_voz.py
"""
import asyncio
import glob
import json
import os
import re
import subprocess

import numpy as np
import edge_tts
import imageio_ffmpeg

BASE = os.path.dirname(os.path.abspath(__file__))
SEGDIR = os.path.join(BASE, '_voz')
os.makedirs(SEGDIR, exist_ok=True)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

SR = 44100
VOICE = 'es-CO-GonzaloNeural'
PITCH = '-3Hz'          # un poco mas de gravedad

XFADE = 0.6             # cruce entre laminas
PRE = 0.55              # aire antes de que entre la voz
POST = 0.80             # aire despues de la voz antes del corte

PAUSA_PUNTO = 0.40      # silencio tras punto seguido
PAUSA_DOSPUNTOS = 0.30  # tras dos puntos o punto y coma
PAUSA_COMA = 0.24       # tras coma larga

from guion import PLANOS
GUION = [(p['id'], p['texto']) for p in PLANOS]


def clausulas(texto):
    """Parte el texto en clausulas y devuelve [(texto, pausa_despues)]."""
    piezas = re.split(r'(?<=[.:;])\s+', texto.strip())
    out = []
    for p in piezas:
        p = p.strip()
        if not p:
            continue
        # una clausula muy larga se vuelve a partir en la coma mas centrada
        while len(p) > 96:
            comas = [m.start() for m in re.finditer(r',\s', p)]
            if not comas:
                break
            c = min(comas, key=lambda x: abs(x - len(p) // 2))
            if c < 24 or len(p) - c < 24:
                break
            out.append((p[:c + 1], PAUSA_COMA))
            p = p[c + 2:].strip()
        pausa = PAUSA_DOSPUNTOS if p.endswith((':', ';')) else PAUSA_PUNTO
        out.append((p, pausa))
    if out:
        out[-1] = (out[-1][0], 0.0)
    return out


def velocidad(i, total):
    """Cadencia humana: arranca normal, alterna en medio y frena al cerrar."""
    if total == 1:
        return '-3%'
    if i == total - 1:
        return '-7%'          # la ultima clausula se dice mas despacio
    if i == 0:
        return '-1%'
    return '-4%' if i % 2 else '+1%'


async def tts(texto, rate, destino):
    await edge_tts.Communicate(texto, VOICE, rate=rate, pitch=PITCH).save(destino)


def leer_audio(path):
    p = subprocess.run([FFMPEG, '-v', 'error', '-i', path, '-f', 'f32le',
                        '-ac', '1', '-ar', str(SR), '-'], capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr.decode('utf-8', 'replace'))
    return np.frombuffer(p.stdout, dtype=np.float32).astype(np.float64)


def recortar(x, umbral=0.010):
    idx = np.where(np.abs(x) > umbral)[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] - int(0.03 * SR))
    b = min(len(x), idx[-1] + int(0.06 * SR))
    return x[a:b]


def main():
    for f in glob.glob(os.path.join(SEGDIR, 'geo_*')):
        os.remove(f)

    print('voz:', VOICE, 'pitch', PITCH, '| laminas:', len(GUION))
    segs = []
    for sl, texto in GUION:
        cls = clausulas(texto)
        partes = []
        for i, (txt, pausa) in enumerate(cls):
            rate = velocidad(i, len(cls))
            mp3 = os.path.join(SEGDIR, 'geo_%02d_%02d.mp3' % (sl, i))
            asyncio.run(tts(txt, rate, mp3))
            x = recortar(leer_audio(mp3))
            f = int(0.015 * SR)
            x[:f] *= np.linspace(0, 1, f)
            x[-f:] *= np.linspace(1, 0, f)
            partes.append(x)
            if pausa > 0:
                partes.append(np.zeros(int(pausa * SR)))
        seg = np.concatenate(partes)
        pico = np.max(np.abs(seg)) + 1e-9
        seg = seg * (0.80 / pico)
        np.save(os.path.join(SEGDIR, 'geo_%02d.npy' % sl), seg.astype(np.float32))
        segs.append((sl, len(seg) / SR))
        print('  lamina %2d  %5.2f s  %d clausulas  [%s]'
              % (sl, len(seg) / SR, len(cls),
                 ' '.join(velocidad(i, len(cls)) for i in range(len(cls)))))

    dur = [PRE + d + POST for _, d in segs]
    starts = [0.0]
    for k in range(len(dur) - 1):
        starts.append(starts[-1] + dur[k] - XFADE)
    total = starts[-1] + dur[-1]

    tl = {'xfade': XFADE, 'pre': PRE, 'total': total,
          'shots': [{'slide': segs[i][0], 'start': starts[i],
                     'dur': dur[i], 'voz': segs[i][1]} for i in range(len(dur))]}
    with open(os.path.join(BASE, 'timeline.json'), 'w', encoding='utf-8') as fh:
        json.dump(tl, fh, indent=1, ensure_ascii=False)
    print('\nvoz total: %.2f s  (%d laminas)' % (total, len(dur)))


if __name__ == '__main__':
    main()
