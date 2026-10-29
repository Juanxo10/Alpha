"""Geovisor de escritorio: FastAPI local + ventana propia (pywebview). Sin navegador.

Uso: python escritorio.py [carpeta_cliente]
Como .exe la carpeta clientes\\<id> debe estar junto al programa.
"""
import os
import socket
import sys
import threading
import time

import uvicorn
import webview

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
import main as api  # noqa: E402


def carpeta_cliente():
    if len(sys.argv) > 1:
        return os.path.abspath(sys.argv[1])
    raiz = os.path.join(api.AQUI, "clientes") if getattr(sys, "frozen", False) else \
        os.path.join(api.AQUI, "..", "..", "GEOVISOR_APP_INDEPENDIENTE", "clientes")
    hay = [d for d in sorted(os.listdir(raiz)) if os.path.isfile(os.path.join(raiz, d, "cliente.json"))] if os.path.isdir(raiz) else []
    if len(hay) != 1:
        sys.exit("Debe haber exactamente una carpeta clientes\\<id> con su cliente.json.")
    return os.path.join(raiz, hay[0])


def puerto_libre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


_CSS = """
html,body{margin:0;height:100%;overflow:hidden}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:30px;
background:radial-gradient(circle at 50% 42%,#24574A 0%,#173F35 55%,#0F2B24 100%)}
.l{width:min(340px,70vw);animation:e .9s cubic-bezier(.2,.8,.2,1) both,r 2.6s ease-in-out .9s infinite;filter:drop-shadow(0 8px 28px rgba(127,216,166,.25))}
.l svg{width:100%;height:auto;display:block}
.b{width:132px;height:3px;border-radius:3px;background:rgba(127,216,166,.18);overflow:hidden;animation:a .6s ease .5s both}
.b b{display:block;width:40%;height:100%;border-radius:3px;background:#7FD8A6;animation:s 1.3s ease-in-out infinite}
@keyframes e{from{opacity:0;transform:translateY(14px) scale(.92)}to{opacity:1;transform:none}}
@keyframes r{0%,100%{opacity:1}50%{opacity:.72}}
@keyframes s{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}
@keyframes a{from{opacity:0}to{opacity:1}}
"""


def pantalla_carga():
    """Splash con el logo, igual al de la interfaz: se muestra mientras se conecta a la base."""
    try:
        with open(os.path.join(api.DIST, "alpha", "logo_blanco.svg"), encoding="utf-8") as f:
            logo = f.read()
    except OSError:
        logo = ""
    return f"<style>{_CSS}</style><div class='l'>{logo}</div><div class='b'><b></b></div>"


def arrancar(ventana, carpeta):
    """La ventana ya está abierta mostrando la pantalla de carga; aquí se conecta a Supabase y se le pasa la página real."""
    api.iniciar(carpeta)
    puerto = puerto_libre()
    srv = uvicorn.Server(uvicorn.Config(api.app, host="127.0.0.1", port=puerto, log_level="warning"))
    threading.Thread(target=srv.run, daemon=True).start()
    while not srv.started:
        time.sleep(0.05)
    ventana.load_url(f"http://127.0.0.1:{puerto}")


if __name__ == "__main__":
    carpeta = carpeta_cliente()
    ventana = webview.create_window("Geovisor", html=pantalla_carga(), width=1280, height=800, min_size=(900, 600))
    webview.settings["ALLOW_DOWNLOADS"] = True  # permite guardar los PDF generados
    webview.start(arrancar, (ventana, carpeta))
