# -*- coding: utf-8 -*-
"""Cliente (inquilino) de la petición en curso: cada empresa con su carpeta, su schema, su candado, su caché y su pool."""
import contextvars
import json
import os
import re
import threading

ID_VALIDO = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
TENANTS = {}                                  # id -> Tenant
_ACTUAL = contextvars.ContextVar("tenant", default=None)
_POOLS = {}                                   # datos de conexión -> ConnectionPool compartido entre los clientes de esa base
_LOCK_POOLS = threading.Lock()


class Tenant:
    def __init__(self, carpeta):
        self.carpeta = os.path.abspath(carpeta)
        ficha = os.path.join(self.carpeta, "cliente.json")
        if not os.path.exists(ficha):
            raise SystemExit(f"No existe {ficha}: la carpeta no es de un cliente.")
        with open(ficha, encoding="utf-8") as f:
            self.cfg = json.load(f)
        self.id = str(self.cfg.get("id") or os.path.basename(self.carpeta)).lower()
        if not ID_VALIDO.match(self.id):
            raise SystemExit(f"Id de cliente no válido: {self.id!r} (minúsculas, números y _).")
        self.carto = os.path.join(self.carpeta, "cartografia")
        self.marca = os.path.join(self.carpeta, "marca")
        self.datos = os.path.join(self.carpeta, "datos")
        self.expedientes = os.path.join(self.datos, "expedientes")
        self.informes = os.path.join(self.datos, "informes")
        ficha_pg = os.path.join(self.datos, "supabase.json")      # host, port, dbname, user, password
        env_pg = os.environ.get(f"PG_{self.id.upper()}")          # en Render/Vercel la clave va en una variable de entorno, no en un archivo
        if env_pg:
            self.pg = json.loads(env_pg)
        elif os.path.exists(ficha_pg):
            with open(ficha_pg, encoding="utf-8") as f:
                self.pg = json.load(f)
        else:
            raise SystemExit(f"Faltan los datos de Postgres de {self.id}: {ficha_pg} o la variable PG_{self.id.upper()}.")
        # con "schema" en cliente.json, este cliente vive en su propio schema dentro de una base compartida
        self.schema = f"t_{self.id}" if self.cfg.get("schema") else None
        self.lock = threading.RLock()       # una escritura a la vez POR CLIENTE (HTTP + tareas programadas)
        self.version = [0]                  # sube con cada escritura; invalida el memo de este cliente y de ningún otro
        self.memo = {}
        self.cache = {}                     # cachés propias de módulos (p. ej. lotes.geojson)

    @property
    def clave_pool(self):
        return tuple(sorted((k, str(v)) for k, v in self.pg.items()))


def registrar(carpeta):
    t = Tenant(carpeta)
    if t.id in TENANTS:
        raise SystemExit(f"Cliente repetido: {t.id}")
    # compartir base exige que todos usen schema propio: si no, un search_path anterior se filtraría a otro cliente
    for o in TENANTS.values():
        if o.clave_pool == t.clave_pool and (o.schema is None or t.schema is None):
            raise SystemExit(f"{t.id} y {o.id} comparten base: ambos deben usar \"schema\": true en cliente.json.")
    TENANTS[t.id] = t
    return t


def actual():
    t = _ACTUAL.get()
    if t is None:
        raise RuntimeError("No hay cliente activo en esta petición.")
    return t


def fijar(t):
    """Activa un cliente en el contexto actual (hilos de fondo y arranque). Devuelve el token para restaurar."""
    return _ACTUAL.set(t)


def por_host(host):
    """merced.plataforma.com -> 'merced'. Con un solo cliente registrado, cualquier host (localhost, *.fly.dev) lo usa."""
    sub = (host or "").split(":")[0].split(".")[0].lower()
    if sub in TENANTS:
        return TENANTS[sub]
    return next(iter(TENANTS.values())) if len(TENANTS) == 1 else None


def pool(t):
    from psycopg_pool import ConnectionPool
    with _LOCK_POOLS:
        p = _POOLS.get(t.clave_pool)
        if p is None:
            # shortcut: 2-4 conexiones por base; con muchos clientes en una base subir max_size o poner pgbouncer delante
            p = _POOLS[t.clave_pool] = ConnectionPool(open=True, min_size=2, max_size=4,
                                                      kwargs={"sslmode": "require", **t.pg, "autocommit": True})      # sslmode se puede bajar en supabase.json (pruebas locales)
        return p
