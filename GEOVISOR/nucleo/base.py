# -*- coding: utf-8 -*-
"""Base común del sistema: rutas, esquema de la base de datos, migraciones, utilidades y bitácora sellada."""
import calendar
import datetime as dt
import hashlib
import json
import os
import secrets
import sqlite3
import threading

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(RAIZ, "geovisor")
DATOS = os.path.join(RAIZ, "datos")
RESPALDOS = os.path.join(DATOS, "respaldos")
EXPEDIENTES = os.path.join(DATOS, "expedientes")
INFORMES = os.path.join(RAIZ, "INFORMES")
DB = os.path.join(DATOS, "contabilidad.sqlite")
MAX_RESPALDOS = 60
LOCK = threading.RLock()           # una sola escritura a la vez (HTTP + tareas programadas)

ESQUEMA = """
CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS lotes (
  id_lote TEXT PRIMARY KEY, manzana INTEGER, lote INTEGER, area_m2 REAL,
  precio_lista REAL, bloqueado INTEGER DEFAULT 0, nota TEXT);
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, tipo_doc TEXT DEFAULT 'CC',
  documento TEXT, telefono TEXT, email TEXT, direccion TEXT, creado TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cliente_doc ON clientes(documento) WHERE documento IS NOT NULL AND documento <> '';
CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, id_lote TEXT NOT NULL REFERENCES lotes(id_lote),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  etapa TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'ACTIVA',
  fecha_separacion TEXT, fecha_limite_separacion TEXT, fecha_venta TEXT,
  valor_venta REAL, cuota_inicial REAL DEFAULT 0, n_cuotas INTEGER DEFAULT 0,
  fecha_primera_cuota TEXT, vendedor TEXT, observacion TEXT,
  fecha_escritura TEXT, numero_escritura TEXT, notaria TEXT,
  fecha_desistimiento TEXT, motivo_desistimiento TEXT, creado TEXT);
CREATE INDEX IF NOT EXISTS ix_ventas_lote ON ventas(id_lote);
CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, venta_id INTEGER NOT NULL REFERENCES ventas(id),
  id_lote TEXT NOT NULL, recibo INTEGER UNIQUE, fecha TEXT NOT NULL, valor REAL NOT NULL,
  concepto TEXT, medio TEXT, referencia TEXT, observacion TEXT,
  anulado INTEGER DEFAULT 0, motivo_anulacion TEXT, fecha_anulacion TEXT, usuario TEXT, creado TEXT);
CREATE INDEX IF NOT EXISTS ix_pagos_venta ON pagos(venta_id);
CREATE TABLE IF NOT EXISTS reestructuraciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, venta_id INTEGER NOT NULL REFERENCES ventas(id), fecha TEXT NOT NULL,
  pagado_al_momento REAL NOT NULL, saldo REAL NOT NULL, n_cuotas INTEGER NOT NULL, fecha_primera TEXT NOT NULL,
  motivo TEXT, plan_anterior TEXT, usuario TEXT, creado TEXT);
CREATE TABLE IF NOT EXISTS comisionistas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, tipo_persona TEXT DEFAULT 'NATURAL',
  tipo_doc TEXT DEFAULT 'CC', documento TEXT, telefono TEXT, email TEXT, direccion TEXT, ciudad TEXT,
  vinculo TEXT DEFAULT 'INDEPENDIENTE', porcentaje_defecto REAL DEFAULT 3, regla_causacion TEXT DEFAULT 'RECAUDO',
  retencion_pct REAL DEFAULT 0, banco TEXT, tipo_cuenta TEXT, numero_cuenta TEXT, titular_cuenta TEXT,
  estado TEXT DEFAULT 'ACTIVO', fecha_ingreso TEXT, observacion TEXT, creado TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS ux_comisionista_doc ON comisionistas(documento) WHERE documento IS NOT NULL AND documento <> '';
CREATE TABLE IF NOT EXISTS comisiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, venta_id INTEGER NOT NULL REFERENCES ventas(id),
  comisionista_id INTEGER NOT NULL REFERENCES comisionistas(id), porcentaje REAL NOT NULL, regla TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'ACTIVA', observacion TEXT, motivo_anulacion TEXT, creado TEXT);
CREATE INDEX IF NOT EXISTS ix_comisiones_venta ON comisiones(venta_id);
CREATE TABLE IF NOT EXISTS pagos_comision (
  id INTEGER PRIMARY KEY AUTOINCREMENT, comisionista_id INTEGER NOT NULL REFERENCES comisionistas(id),
  comprobante INTEGER UNIQUE, fecha TEXT NOT NULL, valor_bruto REAL NOT NULL, retencion_pct REAL DEFAULT 0,
  retencion REAL DEFAULT 0, valor_neto REAL NOT NULL, medio TEXT, referencia TEXT, observacion TEXT,
  anulado INTEGER DEFAULT 0, motivo_anulacion TEXT, fecha_anulacion TEXT, usuario TEXT, creado TEXT);
CREATE TABLE IF NOT EXISTS pagos_comision_detalle (
  pago_id INTEGER NOT NULL REFERENCES pagos_comision(id), comision_id INTEGER NOT NULL REFERENCES comisiones(id),
  valor REAL NOT NULL);
CREATE TABLE IF NOT EXISTS gastos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, comprobante INTEGER UNIQUE, fecha TEXT NOT NULL, categoria TEXT NOT NULL,
  proveedor TEXT, documento_proveedor TEXT, factura TEXT, descripcion TEXT,
  valor_bruto REAL NOT NULL, retencion REAL DEFAULT 0, valor_neto REAL NOT NULL, medio TEXT, referencia TEXT,
  anulado INTEGER DEFAULT 0, motivo_anulacion TEXT, fecha_anulacion TEXT, conciliado INTEGER DEFAULT 0,
  conciliacion_ref TEXT, usuario TEXT, creado TEXT);
CREATE TABLE IF NOT EXISTS presupuesto (categoria TEXT PRIMARY KEY, valor REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS conciliaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, banco TEXT, archivo TEXT, movimientos INTEGER,
  conciliados INTEGER, usuario TEXT, creado TEXT);
CREATE TABLE IF NOT EXISTS gestiones_cobro (
  id INTEGER PRIMARY KEY AUTOINCREMENT, venta_id INTEGER NOT NULL REFERENCES ventas(id), id_lote TEXT,
  fecha TEXT NOT NULL, tipo TEXT NOT NULL, resultado TEXT, compromiso_fecha TEXT, compromiso_valor REAL,
  usuario TEXT, creado TEXT);
CREATE TABLE IF NOT EXISTS adjuntos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, id_lote TEXT NOT NULL, venta_id INTEGER, tipo TEXT NOT NULL,
  nombre TEXT NOT NULL, archivo TEXT NOT NULL, tamano INTEGER, sha256 TEXT, descripcion TEXT,
  eliminado INTEGER DEFAULT 0, motivo_eliminacion TEXT, usuario TEXT, creado TEXT);
CREATE TABLE IF NOT EXISTS cotizaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, numero INTEGER UNIQUE, id_lote TEXT NOT NULL, nombre TEXT, telefono TEXT,
  email TEXT, prospecto_id INTEGER, precio_lista REAL, valor REAL, cuota_inicial REAL, n_cuotas INTEGER,
  fecha_primera TEXT, validez_dias INTEGER, observacion TEXT, usuario TEXT, creado TEXT);
CREATE TABLE IF NOT EXISTS prospectos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, telefono TEXT, email TEXT, documento TEXT,
  origen TEXT, comisionista_id INTEGER, lotes_interes TEXT, presupuesto REAL, estado TEXT DEFAULT 'NUEVO',
  fecha_proxima TEXT, proxima_accion TEXT, notas TEXT, motivo_perdida TEXT, venta_id INTEGER,
  usuario TEXT, creado TEXT, actualizado TEXT);
CREATE TABLE IF NOT EXISTS prospecto_notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, prospecto_id INTEGER NOT NULL REFERENCES prospectos(id), fecha TEXT,
  tipo TEXT, nota TEXT, usuario TEXT);
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, usuario TEXT NOT NULL UNIQUE, clave_hash TEXT NOT NULL,
  sal TEXT NOT NULL, rol TEXT NOT NULL, activo INTEGER DEFAULT 1, email TEXT, telefono TEXT, telegram_chat_id TEXT,
  codigo_vinculo TEXT, intentos_fallidos INTEGER DEFAULT 0, bloqueado_hasta TEXT, ultimo_acceso TEXT, creado TEXT);
CREATE TABLE IF NOT EXISTS solicitudes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ruta TEXT NOT NULL, datos TEXT NOT NULL, resumen TEXT, id_lote TEXT,
  solicitante_id INTEGER, solicitante TEXT, estado TEXT NOT NULL DEFAULT 'PENDIENTE', creado TEXT,
  resuelto_por TEXT, resuelto_en TEXT, motivo_rechazo TEXT, resultado TEXT);
CREATE TABLE IF NOT EXISTS notificaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, canal TEXT NOT NULL, destino TEXT NOT NULL, asunto TEXT, texto TEXT,
  extra TEXT, estado TEXT NOT NULL DEFAULT 'PENDIENTE', intentos INTEGER DEFAULT 0, error TEXT, creado TEXT, enviado TEXT);
CREATE TABLE IF NOT EXISTS marcas (clave TEXT PRIMARY KEY, fecha TEXT);
CREATE TABLE IF NOT EXISTS bitacora (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, usuario TEXT, accion TEXT, id_lote TEXT, detalle TEXT);
"""

# columnas agregadas a tablas que ya existían en bases anteriores
COLUMNAS_NUEVAS = [
    ("bitacora", "hash", "TEXT"), ("bitacora", "hash_prev", "TEXT"),
    ("pagos", "conciliado", "INTEGER DEFAULT 0"), ("pagos", "conciliacion_ref", "TEXT"),
    ("pagos_comision", "conciliado", "INTEGER DEFAULT 0"), ("pagos_comision", "conciliacion_ref", "TEXT"),
]

CONFIG_INICIAL = {
    # proyecto y vendedor
    "proyecto": "Loteo La Merced", "subtitulo": "Control de ventas y cartera", "ciudad": "Villavicencio, Meta",
    "vendedor_razon_social": "", "vendedor_nit": "", "vendedor_direccion": "", "vendedor_telefono": "",
    "vendedor_email": "", "cuenta_bancaria": "", "vendedor_representante": "", "vendedor_representante_doc": "",
    # consecutivos
    "consecutivo_recibo": "1", "consecutivo_egreso": "1", "consecutivo_cotizacion": "1",
    # cartera
    "dias_gracia": "0", "tasa_mora_mensual": "0",
    # comercial
    "comision_max_pct": "10", "descuento_max_operador": "0", "cotizacion_validez_dias": "15",
    # contratos
    "promesa_penalidad_pct": "10", "promesa_plazo_escritura_meses": "6", "notaria_escrituracion": "",
    # seguridad y alertas
    "sesion_minutos": "45", "horario_inicio": "07:00", "horario_fin": "19:00", "umbral_efectivo": "5000000",
    "alertas_acciones_duenos": "1", "resumen_diario_hora": "18:00",
    "telegram_token": "", "smtp_servidor": "smtp.gmail.com", "smtp_puerto": "587", "smtp_usuario": "",
    "smtp_clave": "", "smtp_remitente": "",
    # recordatorios a compradores
    "recordatorios_activos": "0", "recordatorio_dias_antes": "3", "recordatorio_mora_dias": "1,15,30",
    "recordatorio_hora": "08:00", "confirmacion_pago_email": "0",
    # respaldos y red
    "carpeta_respaldo_externa": "", "respaldo_correo": "0", "acceso_red": "0",
}
# claves que nunca se devuelven al navegador en claro ni se cambian por la ruta de configuración genérica
CONFIG_SECRETA = {"smtp_clave", "telegram_token", "clave_interna"}
CONFIG_SISTEMA = {"consecutivo_recibo", "consecutivo_egreso", "consecutivo_cotizacion", "clave_interna",
                  "integridad_ultima"}


class ErrorNegocio(Exception):
    pass


# ---------------------------------------------------------------- utilidades
def ahora():
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def hoy():
    return dt.date.today()


def fecha(s):
    return dt.date.fromisoformat(str(s)[:10]) if s else None


def sumar_meses(d, n):
    m = d.month - 1 + n
    a, m = d.year + m // 12, m % 12 + 1
    return dt.date(a, m, min(d.day, calendar.monthrange(a, m)[1]))


def num(v, defecto=0.0):
    if v in (None, ""):
        return defecto
    return float(str(v).replace(",", "."))


def conectar(ruta=None):
    c = sqlite3.connect(ruta or DB, timeout=20)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def config(c):
    return {r["clave"]: r["valor"] for r in c.execute("SELECT * FROM config")}


def set_config(c, clave, valor):
    c.execute("INSERT INTO config (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor",
              (clave, str(valor)))


def siguiente_consecutivo(c, clave):
    n = int(config(c).get(clave) or 1)
    set_config(c, clave, n + 1)
    return n


def marca_hecha(c, clave):
    return c.execute("SELECT 1 FROM marcas WHERE clave=?", (clave,)).fetchone() is not None


def marcar(c, clave):
    c.execute("INSERT OR IGNORE INTO marcas (clave, fecha) VALUES (?,?)", (clave, ahora()))


# ---------------------------------------------------------------- bitácora sellada
def _sello(prev, fecha_, usuario, accion, id_lote, detalle):
    base = "|".join(str(x or "") for x in (prev, fecha_, usuario, accion, id_lote, detalle))
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def bitacora(c, usuario, accion, id_lote, detalle):
    """Registra un movimiento encadenado al anterior: si alguien altera la bitácora, la cadena se rompe."""
    prev = c.execute("SELECT hash FROM bitacora ORDER BY id DESC LIMIT 1").fetchone()
    prev = prev[0] if prev else ""
    f = ahora()
    det = json.dumps(detalle, ensure_ascii=False, default=str)
    h = _sello(prev, f, usuario, accion, id_lote, det)
    c.execute("INSERT INTO bitacora (fecha, usuario, accion, id_lote, detalle, hash, hash_prev) VALUES (?,?,?,?,?,?,?)",
              (f, usuario, accion, id_lote, det, h, prev))


def sellar_bitacora_antigua(c):
    """Sella las filas de bitácora creadas antes de que existiera la cadena (solo la primera vez)."""
    prev = ""
    for r in c.execute("SELECT * FROM bitacora ORDER BY id").fetchall():
        if r["hash"]:
            prev = r["hash"]
            continue
        h = _sello(prev, r["fecha"], r["usuario"], r["accion"], r["id_lote"], r["detalle"])
        c.execute("UPDATE bitacora SET hash=?, hash_prev=? WHERE id=?", (h, prev, r["id"]))
        prev = h


def verificar_cadena(c):
    rotos, prev = [], ""
    for r in c.execute("SELECT * FROM bitacora ORDER BY id"):
        if (r["hash_prev"] or "") != prev or r["hash"] != _sello(prev, r["fecha"], r["usuario"], r["accion"],
                                                                 r["id_lote"], r["detalle"]):
            rotos.append(r["id"])
        prev = r["hash"] or ""
    return rotos


# ---------------------------------------------------------------- inicio y respaldos
def agregar_columnas(c):
    for tabla, col, tipo in COLUMNAS_NUEVAS:
        cols = {r[1] for r in c.execute(f"PRAGMA table_info({tabla})")}
        if col not in cols:
            c.execute(f"ALTER TABLE {tabla} ADD COLUMN {col} {tipo}")


def iniciar_base():
    os.makedirs(RESPALDOS, exist_ok=True)
    os.makedirs(EXPEDIENTES, exist_ok=True)
    nueva = not os.path.exists(DB)
    if not nueva:
        respaldar("inicio")           # antes de migrar, por si acaso
    with conectar() as c:
        c.executescript(ESQUEMA)
        from . import registro
        registro.iniciar(c)
        agregar_columnas(c)
        for k, v in CONFIG_INICIAL.items():
            c.execute("INSERT OR IGNORE INTO config VALUES (?,?)", (k, v))
        c.execute("INSERT OR IGNORE INTO config VALUES ('clave_interna', ?)", (secrets.token_hex(32),))
        with open(os.path.join(WEB, "data", "lotes.geojson"), encoding="utf-8") as f:
            for ft in json.load(f)["features"]:
                p = ft["properties"]
                c.execute("INSERT OR IGNORE INTO lotes (id_lote, manzana, lote, area_m2) VALUES (?,?,?,?)",
                          (p["id_lote"], p["manzana"], p["lote"], p["area_m2"]))
        sellar_bitacora_antigua(c)


def respaldar(motivo="manual", carpeta=None):
    if not os.path.exists(DB):
        return None
    carpeta = carpeta or RESPALDOS
    os.makedirs(carpeta, exist_ok=True)
    destino = os.path.join(carpeta, f"contabilidad_{dt.datetime.now():%Y%m%d_%H%M%S}_{motivo}.sqlite")
    with conectar() as src, sqlite3.connect(destino) as dst:
        src.backup(dst)
    if carpeta == RESPALDOS:
        viejos = sorted(f for f in os.listdir(RESPALDOS) if f.endswith(".sqlite"))
        for f in viejos[:-MAX_RESPALDOS]:
            os.remove(os.path.join(RESPALDOS, f))
    return destino
