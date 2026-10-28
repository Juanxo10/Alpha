"""Geovisor multi-cliente: un solo proceso atiende a todas las carpetas de CLIENTES_DIR (cada una con su cliente.json). Variables: CLIENTES_DIR, PORT."""
import os
import sys

import uvicorn

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
import main as api  # noqa: E402

if __name__ == "__main__":
    api.iniciar_todos(os.environ.get("CLIENTES_DIR", "clientes"))
    # shortcut: un solo proceso. Las sesiones ya están en la base, pero base.memo (caché de lecturas) y las tareas de alertas
    # viven en memoria: con varios workers una escritura no invalidaría la caché de los otros. Subir workers tras moverlos a Redis.
    uvicorn.run(api.app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")),
                proxy_headers=True, forwarded_allow_ips="*", workers=1)
