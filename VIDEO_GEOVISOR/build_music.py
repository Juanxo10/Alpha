# -*- coding: utf-8 -*-
"""Cama musical del video a Presidencia: pasaje llanero suave.

Musica instrumental colombiana. Las versiones anteriores sumaban senos y por
eso sonaban a MIDI: un seno no tiene arco, ni pua, ni caja. Aqui las cuerdas
se generan por modelo fisico (Karplus-Strong), que es una linea de retardo con
perdidas -es decir, como se comporta una cuerda de verdad-, y por eso los
armonicos agudos se apagan antes que el fundamental, igual que en un arpa.

Instrumentacion: arpa llanera (arpegios y melodia), cuatro (rasgueo), bordones
del arpa (bajo) y capachos (maracas). Forma de pasaje en 3/4, en re menor, que
abre a re mayor en el climax de las cifras y resuelve en mayor.

    DUR=160.29 python build_music.py   ->  musica_bed_160.wav
"""
import os
import wave

import numpy as np

SR = 44100
DUR = float(os.environ.get('DUR', 160.29))
n = int(SR * DUR)

BARS = 84                      # 3/4; la pieza cierra exactamente con el video
bar = DUR / BARS
beat = bar / 3.0
print('pasaje 3/4  |  %.1f BPM  |  compas %.3f s  |  %d compases'
      % (60.0 / beat, bar, BARS))

arpa = np.zeros(n)     # arpegios y melodia
cuatro = np.zeros(n)   # rasgueo de acompanamiento
bajo = np.zeros(n)     # bordones
per = np.zeros(n)      # capachos


def hz(s):
    """Semitonos desde A4 -> Hz."""
    return 440.0 * 2 ** (s / 12.0)


def suave(x, k):
    return np.convolve(x, np.ones(k) / k, mode='same')


def boxcar(x, k):
    """Media movil en O(n), para filtrar la pista entera sin esperar."""
    k = max(1, int(k))
    if k < 2:
        return x.copy()
    pad = k // 2
    y = np.concatenate([np.zeros(pad), x, np.zeros(k - pad)])
    c = np.cumsum(np.concatenate([[0.0], y]))
    return (c[k:k + len(x)] - c[:len(x)]) / k


def _win(t0, dur_s):
    i0 = max(0, int(t0 * SR))     # el micro-desfase puede adelantar el compas 0
    if i0 >= n or dur_s <= 0:
        return None, None, None
    ln = min(int(dur_s * SR), n - i0)
    if ln <= 0:
        return None, None, None
    return i0, ln, np.arange(ln) / SR


_SEED = [0]
_H = np.random.default_rng(20260820)


def humano(t0, amp, fuerza=1.0):
    """Nadie toca en cuadricula. Micro-desfase y desigualdad de pulsacion.

    Es el segundo delator del sonido de maquina, despues del timbre: el ritmo
    perfectamente cuantizado no existe en una interpretacion real.
    """
    return (t0 + _H.normal(0, 0.0075) * fuerza,
            amp * (1.0 + _H.normal(0, 0.11) * fuerza))


def caja(x, picos, corte=9000.0):
    """Cuerpo del instrumento: la cuerda excita una caja de madera.

    Sin esto queda la cuerda desnuda, que es justo lo que suena a sintetizador.
    Se aplica como curva sobre el espectro completo: es fase cero y no cuesta.
    """
    F = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1.0 / SR)
    f[0] = 1e-6
    H = np.ones(len(f))
    for fc, q, g in picos:
        H += g * np.exp(-(np.log2(f / fc) ** 2) / (2.0 * (1.0 / q) ** 2))
    H *= 1.0 / (1.0 + (f / corte) ** 2)          # la madera no brilla arriba
    return np.fft.irfft(F * H, len(x))


def pulsada(f, dur_s, t0, amp, buf, decay=0.998, brillo=0.7, damp=0.2):
    """Cuerda pulsada por Karplus-Strong.

    decay  = perdida por vuelta de la cuerda. Como el grave da menos vueltas
             por segundo, suena mas tiempo: igual que en el instrumento real.
    brillo = cuanto filo conserva la pulsacion (0 = pulgar, 1 = una).
    damp   = cuanto apaga los agudos el filtro del lazo. 0,5 es el valor
             clasico y suena a almohada; el arpa necesita 0,10-0,20.
    """
    i0, ln, t = _win(t0, dur_s)
    if i0 is None:
        return
    N = max(4, int(round(SR / f)))
    _SEED[0] += 1
    rng = np.random.default_rng((_SEED[0] * 7919 + N) % 999983)
    exc = rng.normal(0, 1, N)
    k = max(1, int((1.0 - brillo) ** 2 * N * 0.40))
    if k > 1:                                   # media movil circular
        c = np.cumsum(np.concatenate([[0.0], np.tile(exc, 2)]))
        exc = (c[k:k + N] - c[:N]) / k
    exc -= exc.mean()                           # sin esto queda un zumbido
    exc = exc / (np.max(np.abs(exc)) + 1e-9)

    a, bq = decay * (1.0 - damp), decay * damp
    nb = ln // N + 2
    out = np.empty(nb * N)
    out[:N] = exc
    prev, carry = exc, 0.0
    for j in range(1, nb):
        cur = a * prev + bq * np.concatenate(([carry], prev[:-1]))
        out[j * N:(j + 1) * N] = cur
        carry = prev[-1]
        prev = cur

    env = np.ones(ln)
    r = min(int(0.14 * SR), ln)
    env[-r:] = np.linspace(1, 0, r) ** 1.6
    buf[i0:i0 + ln] += out[:ln] * env * amp


def rasgueo(notas, t0, amp, arriba=True, dur_s=0.62):
    """Rasgueo de cuatro: las cuerdas no suenan a la vez, van en abanico."""
    orden = notas if arriba else notas[::-1]
    for j, s in enumerate(orden):
        pulsada(hz(s), dur_s, t0 + j * 0.0075, amp * (1.0 - 0.09 * j),
                cuatro, decay=0.9925, brillo=0.82, damp=0.24)


def capacho(t0, amp, dur_s=0.11):
    """Capachos: semilla seca, transitorio corto y mucho aire arriba."""
    i0, ln, t = _win(t0, dur_s)
    if i0 is None:
        return
    _SEED[0] += 1
    rng = np.random.default_rng((_SEED[0] * 104729) % 999983)
    x = rng.normal(0, 1, ln)
    x = x - suave(x, 11)                                 # se va el cuerpo
    env = np.exp(-t * 30.0) * (1.0 - np.exp(-t * 1100.0))
    per[i0:i0 + ln] += x * env * amp


# --------------------------------------------------------------- armonia
# Semitonos desde A4. Re menor, con giro a re mayor.
ACORDE = {
    'Dm': dict(b=-19, n=[-7, -4, 0, 5, 8]),      # D  F  A  D  F
    'Gm': dict(b=-14, n=[-2, 1, 5, 10, 13]),     # G  Bb D  G  Bb
    'A7': dict(b=-12, n=[0, 4, 7, 10, 12]),      # A  C# E  G  A
    'F':  dict(b=-16, n=[-4, 0, 3, 8, 12]),      # F  A  C  F  A
    'Bb': dict(b=-11, n=[1, 5, 8, 13, 17]),      # Bb D  F  Bb D
    'D':  dict(b=-19, n=[-7, -3, 0, 5, 9]),      # D  F# A  D  F#
    'G':  dict(b=-14, n=[-2, 2, 5, 10, 14]),     # G  B  D  G  B
    'A':  dict(b=-12, n=[0, 4, 7, 12, 16]),      # A  C# E  A  C#
}

# g_mix es el volumen general de la seccion: sin el, el arco no se oye por
# mucho que se sumen instrumentos.
SECCIONES = [
    # bar0 bar1  ciclo                      g_mix arpa cuatro capacho melodia modo
    (0,  10, ['Dm', 'Dm', 'Gm', 'A7'], 0.42, 0.34, 0.00, 0.00, 0.00, 'menor'),
    (10, 26, ['Dm', 'Gm', 'A7', 'Dm'], 0.66, 0.62, 0.34, 0.00, 0.00, 'menor'),
    (26, 42, ['Dm', 'Gm', 'A7', 'Dm'], 0.88, 0.84, 0.58, 0.50, 0.58, 'menor'),
    (42, 58, ['D', 'G', 'A', 'D'],     1.25, 1.10, 0.85, 1.00, 1.00, 'mayor'),
    (58, 72, ['Bb', 'F', 'G', 'D'],    0.98, 0.88, 0.60, 0.62, 0.74, 'mayor'),
    (72, 80, ['G', 'D', 'A', 'D'],     0.74, 0.76, 0.42, 0.32, 0.52, 'mayor'),
    (80, 84, ['D', 'D', 'D', 'D'],     0.52, 0.58, 0.20, 0.00, 0.00, 'mayor'),
]

# arpegio del arpa: seis corcheas por compas sobre las notas del acorde
PATRON = [0, 2, 4, 3, 2, 1]

# tema: (semitono desde A4, compas del ciclo, negra de entrada, duracion)
TEMA = [
    (12, 0, 0.00, 1.5), (10, 0, 1.50, 1.5),
    (8,  1, 0.00, 2.0), (7,  1, 2.00, 1.0),
    (5,  2, 0.00, 1.5), (7,  2, 1.50, 0.75), (8, 2, 2.25, 0.75),
    (5,  3, 0.00, 3.0),
]


def a_mayor(s):
    """La misma melodia leida en modo mayor: F->F#, Bb->B."""
    return s + 1 if s % 12 in (8, 1) else s


for b0, b1, ciclo, g_mix, g_arp, g_cua, g_cap, g_mel, modo in SECCIONES:
    for b in range(b0, b1):
        t0 = b * bar
        if t0 >= DUR:
            break
        rel = (b - b0) % 4
        ac = ACORDE[ciclo[rel]]

        # bordones: tonica en el uno, quinta en el dos y medio. La octava
        # grave da fundamento; sola sonaria a barro, por eso va discreta.
        tt, aa = humano(t0, 0.40 * g_mix, 0.6)
        pulsada(hz(ac['b']), bar * 1.5, tt, aa, bajo,
                decay=0.9988, brillo=0.55, damp=0.38)
        pulsada(hz(ac['b'] - 12), bar * 1.5, tt + 0.006, aa * 0.30, bajo,
                decay=0.9993, brillo=0.34, damp=0.44)
        tt, aa = humano(t0 + beat * 1.5, 0.22 * g_mix, 0.7)
        pulsada(hz(ac['b'] + 7), bar * 0.85, tt, aa, bajo,
                decay=0.9986, brillo=0.50, damp=0.36)

        # arpegio del arpa; en la seccion de apertura va espaciado.
        # El contratiempo entra un pelo tarde: es el balanceo del pasaje.
        paso = 1 if g_cua > 0 else 2
        for j in range(0, 6, paso):
            idx = PATRON[j]
            sw = beat * 0.5 * (0.11 if j % 2 else 0.0)
            tt, aa = humano(t0 + j * beat * 0.5 + sw,
                            0.22 * g_mix * g_arp * (1.0 if j % 3 == 0 else 0.74))
            pulsada(hz(ac['n'][idx] + 12), beat * 1.35, tt, aa, arpa,
                    decay=0.9974, brillo=0.78, damp=0.15)

        # cuatro: golpe abajo en el uno, arriba en el dos y el tres
        if g_cua > 0:
            for gb, gam, arr in ((0.0, 0.115, False), (1.0, 0.082, True),
                                 (2.0, 0.095, True)):
                tt, aa = humano(t0 + gb * beat, gam * g_mix * g_cua, 0.8)
                rasgueo(ac['n'][:4], tt, aa, arriba=arr)

        # capachos: dos por negra, el contratiempo mas suave
        if g_cap > 0:
            for j in range(6):
                sw = beat * 0.5 * (0.11 if j % 2 else 0.0)
                tt, aa = humano(t0 + j * beat * 0.5 + sw,
                                (0.34 if j % 2 == 0 else 0.19) * g_mix * g_cap)
                capacho(tt, aa)

        # melodia del arpa
        if g_mel > 0:
            for s, cb, cbeat, ln_b in TEMA:
                if cb != rel:
                    continue
                ss = a_mayor(s) if modo == 'mayor' else s
                tt, aa = humano(t0 + cbeat * beat, 0.34 * g_mix * g_mel, 0.9)
                pulsada(hz(ss), beat * ln_b * 1.3, tt, aa, arpa,
                        decay=0.9980, brillo=0.86, damp=0.11)
                pulsada(hz(ss - 12), beat * ln_b * 0.95, tt + 0.011, aa * 0.35,
                        arpa, decay=0.9978, brillo=0.62, damp=0.20)

# resolucion: re mayor abierto, dejado sonar
tf = 80 * bar
for s in (-19, -7, -3, 0, 5, 9, 12, 17):
    pulsada(hz(s), DUR - tf, tf, 0.20, arpa,
            decay=0.9986, brillo=0.66, damp=0.18)

# ------------------------------------------------------------------ mezcla
# Cada instrumento por su caja: el arpa es una tabla grande y honda, el cuatro
# una caja chica que suena en los medios.
arpa = caja(arpa, [(240, 1.4, 0.40), (430, 1.2, 0.35), (1150, 1.0, 0.25)],
            corte=12000)
cuatro = caja(cuatro, [(280, 1.5, 0.40), (620, 1.2, 0.38),
                       (1900, 0.9, 0.25)], corte=10000)
bajo = caja(bajo, [(110, 1.6, 0.30), (200, 1.3, 0.22)], corte=4200)
per = suave(per, 2)

buf = arpa * 1.55 + cuatro * 1.05 + bajo * 0.40 + per * 0.70
buf = buf - boxcar(buf, int(0.44 * SR / 38))   # fuera el retumbe sub-grave

# Compresion rapida: una cuerda pulsada es casi todo transitorio, y bajo la
# locucion eso desaparece. Al domar el pico sube el cuerpo. La ventana es
# corta (30 ms) para que aplaste la pulsacion pero respete el arco de la obra.
ev = boxcar(np.abs(buf), int(0.03 * SR)) + 1e-9
thr = 0.22 * np.max(ev)
g = np.where(ev > thr, (thr / ev) ** (1 - 1.0 / 2.6), 1.0)
buf = buf * boxcar(g, int(0.05 * SR))

fi = int(2.0 * SR)
buf[:fi] *= np.linspace(0, 1, fi) ** 1.4
fo = int(5.0 * SR)
buf[-fo:] *= np.linspace(1, 0, fo) ** 1.3

buf /= np.max(np.abs(buf)) + 1e-9
buf *= 0.38

# Estereo por sala, no por retardo. Retrasar un canal respecto del otro abre
# la imagen en audifonos pero al sumar a mono cancela cada 245 Hz: filtro
# peine, y eso suena hueco. Aqui los dos canales llevan la misma senal directa
# y solo cambian las reflexiones, que van bajas y no cancelan nada audible.
TAPS = (((0.019, 0.30), (0.043, 0.22), (0.071, 0.16), (0.109, 0.11), (0.163, 0.07)),
        ((0.025, 0.28), (0.037, 0.24), (0.063, 0.17), (0.097, 0.12), (0.151, 0.06)))
canales = []
for taps in TAPS:
    rev = np.zeros(n)
    for d_s, g in taps:
        d = int(d_s * SR)
        rev[d:] += buf[:-d] * g
    canales.append(buf + suave(rev, 24) * 0.42)

est = np.stack(canales, axis=1)
est /= np.max(np.abs(est)) + 1e-9
est *= 0.38
out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   'musica_bed_%d.wav' % round(DUR))
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((est * 32767).astype(np.int16).tobytes())
print('OK ->', out, os.path.getsize(out) // 1024, 'KB')
