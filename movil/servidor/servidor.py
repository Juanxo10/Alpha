"""Geovisor en servidor (nube): mismo backend que el de escritorio, sin ventana. Variables: CLIENTE_DIR, PORT."""
import os
import sys

import uvicorn

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
import main as api  # noqa: E402

if __name__ == "__main__":
    api.iniciar(os.environ.get("CLIENTE_DIR", "clientes/merced"))
    # shortcut: un solo proceso (sesiones en memoria + LOCK + tareas de alertas), subir a Postgres/Redis para escalar
    uvicorn.run(api.app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")),
                proxy_headers=True, forwarded_allow_ips="*", workers=1)
