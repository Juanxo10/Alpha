# -*- coding: utf-8 -*-
"""Mezcla la locucion sobre la cama musical. -> mezcla.wav

La voz pasa por una cadena que le quita el sonido de cabina digital:
pasa-altos, calidez en medios-graves, control de sibilancia, compresion suave
y una reverberacion de sala corta. Despues la musica se aparta con ducking.
"""
import json
import os
import subprocess
import wave

import numpy as np
import imageio_ffmpeg

BASE = os.path.dirname(os.path.abspath(__file__))
SEGDIR = os.path.join(BASE, '_voz')
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
SR = 44100

INTRO = 0.0     # el primer plano (título) ya trae su propio aire
TAIL = 2.5      # aire final para que la musica resuelva

tl = json.load(open(os.path.join(BASE, 'timeline.json'), encoding='utf-8'))
TOTAL = INTRO + tl['total'] + TAIL
n = int(SR * TOTAL)


def boxcar(x, k):
    """Media movil en O(n): sirve de pasa-bajos crudo."""
    k = max(1, int(k))
    if k < 2:
        return x.copy()
    pad = k // 2
    y = np.concatenate([np.zeros(pad), x, np.zeros(k - pad)])
    c = np.cumsum(np.concatenate([[0.0], y]))
    return (c[k:k + len(x)] - c[:len(x)]) / k


def k_de(fc):
    """Ancho de ventana equivalente a un corte en fc Hz."""
    return max(2, int(0.44 * SR / fc))


def tratar_voz(x):
    x = x - boxcar(x, k_de(85))                       # fuera retumbe de sala
    calor = boxcar(x, k_de(400)) - boxcar(x, k_de(150))
    x = x + 0.22 * calor                              # cuerpo en medios-graves
    agudo = x - boxcar(x, k_de(5200))
    sib = boxcar(np.abs(agudo), int(0.012 * SR))
    x = x - agudo * np.clip(sib / 0.06, 0, 1) * 0.55  # de-esser dinamico

    env = boxcar(np.abs(x), int(0.015 * SR))
    env = boxcar(env, int(0.06 * SR)) + 1e-6
    thr, ratio = 0.10, 3.0
    g = np.where(env > thr, (thr / env) ** (1 - 1.0 / ratio), 1.0)
    x = x * boxcar(g, int(0.03 * SR)) * 1.7           # compresion suave

    rev = np.zeros(len(x))
    for d_s, gg in ((0.017, 0.30), (0.029, 0.22), (0.047, 0.15), (0.071, 0.09)):
        d = int(d_s * SR)
        rev[d:] += x[:-d] * gg
    return x + boxcar(rev, 30) * 0.16                 # sala corta, poco humeda


voz = np.zeros(n)
for sh in tl['shots']:
    x = np.load(os.path.join(SEGDIR, 'geo_%02d.npy' % sh['slide'])).astype(np.float64)
    x = tratar_voz(x)
    p = np.max(np.abs(x)) + 1e-9
    x *= 0.82 / p
    i0 = int((INTRO + sh['start'] + tl['pre']) * SR)
    ln = min(len(x), n - i0)
    if ln > 0:
        voz[i0:i0 + ln] += x[:ln]


def leer(path, canales=1):
    p = subprocess.run([FFMPEG, '-v', 'error', '-i', path, '-f', 'f32le',
                        '-ac', str(canales), '-ar', str(SR), '-'],
                       capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr.decode('utf-8', 'replace'))
    x = np.frombuffer(p.stdout, dtype=np.float32).astype(np.float64)
    return x.reshape(-1, canales) if canales > 1 else x


# La cama entra en estereo y se queda en estereo: si se sumara a mono se
# perderia la sala, y el ancho es lo que hace que no suene a maqueta.
bed = os.path.join(BASE, 'musica_bed_%d.wav' % round(TOTAL))
mus = leer(bed, 2)
mus = mus[:n] if len(mus) >= n else np.pad(mus, ((0, n - len(mus)), (0, 0)))

env = np.clip(boxcar(np.abs(voz), int(0.05 * SR)) / 0.35, 0, 1)
env = np.clip(boxcar(env, int(0.35 * SR)) * 2.2, 0, 1)
# la musica cede, no desaparece; la voz va al centro
est = mus * (1.0 - 0.58 * env)[:, None] + (voz * 0.95)[:, None]

# Margen para el codificador: el AAC reconstruye picos entre muestras y se
# pasa alrededor de 1 dB. Dejar el WAV en 0,97 hace que el MP4 recorte.
est *= 0.84 / (np.max(np.abs(est)) + 1e-9)
out = os.path.join(BASE, 'mezcla.wav')
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((est * 32767).astype(np.int16).tobytes())
print('OK ->', out, os.path.getsize(out) // 1024, 'KB |', round(TOTAL, 2), 's')
