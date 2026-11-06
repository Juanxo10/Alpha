# -*- coding: utf-8 -*-
r"""
servir.py — Servidor del Geovisor de ventas y cartera del loteo.

Sirve la interfaz (carpeta geovisor/) y la API JSON sobre datos/contabilidad.sqlite. Toda la API exige iniciar
sesión; las operaciones sensibles de un operador quedan pendientes hasta que un dueño las apruebe.
La lógica de negocio vive en la carpeta nucleo/ (un módulo por área).

Uso:  python servir.py                  -> primer puerto libre entre 8100 y 8110
      python servir.py 8200             -> puerto fijo
      python servir.py --db otra.sqlite -> otra base (pruebas)
      python servir.py --sin-navegador  --sin-tareas
"""
import datetime as dt
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

from nucleo import (registro, alertas, base, cartera, cobranza, comisiones, documentos, exportar, finanzas, prospectos,
                    seguridad)
from nucleo.base import ErrorNegocio, bitacora, config, hoy

NAVEGADORES = [r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
               r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
               r"C:\Program Files\Google\Chrome\Application\chrome.exe"]
MODULOS = [cartera.acciones, comisiones.acciones_comisiones, finanzas.acciones, cobranza.acciones, documentos.acciones,
           prospectos.acciones, registro.acciones]


# ---------------------------------------------------------------- operaciones
def guardar_config(c, usuario, d):
    cambiadas = []
    for k, v in d.items():
        if k in base.CONFIG_INICIAL and k not in base.CONFIG_SECRETA and k not in base.CONFIG_SISTEMA:
            base.set_config(c, k, v)
            cambiadas.append(k)
    bitacora(c, usuario, "CONFIG", None, {k: d[k] for k in cambiadas})
    return {"ok": True}


def ejecutar(c, usuario, ruta, d):
    """Ejecuta una operación de negocio (directa o ya aprobada por un dueño)."""
    if ruta == "/api/config":
        return guardar_config(c, usuario, d)
    for modulo in MODULOS:
        r = modulo(c, usuario, ruta, d)
        if r is not None:
            return r
    raise ErrorNegocio("Operación desconocida.")


def config_publica(c):
    cfg = config(c)
    out = {k: v for k, v in cfg.items() if k not in base.CONFIG_SECRETA}
    out["telegram_configurado"] = bool(cfg.get("telegram_token"))
    out["smtp_configurado"] = bool(cfg.get("smtp_usuario") and cfg.get("smtp_clave"))
    return out


# ---------------------------------------------------------------- PDF con el navegador sin ventana
DOCS_PDF = {
    "ficha": lambda c, i: f"Ficha_integral_{i}_{_nombre_lote(c, i)}",
    "comisionista": lambda c, i: f"Comisiones_{_limpio(comisiones.detalle_comisionista(c, int(i))['comisionista']['nombre'])}",
    "promesa": lambda c, i: f"Promesa_compraventa_{_venta(c, i)}",
    "pazysalvo": lambda c, i: f"Paz_y_salvo_{_venta(c, i)}",
    "certificado": lambda c, i: f"Certificado_pagos_{_venta(c, i)}",
    "cotizacion": lambda c, i: f"Cotizacion_COT-{int(c.execute('SELECT numero FROM cotizaciones WHERE id=?', (int(i),)).fetchone()[0]):05d}",
    "recibo": lambda c, i: f"Recibo_{int(i):06d}",
    "egreso": lambda c, i: f"Comprobante_egreso_CE{int(i):06d}",
    "estado": lambda c, i: f"Estado_de_cuenta_{i}_{_nombre_lote(c, i)}",
    "informe": lambda c, i: "Informe_general_ventas_y_cartera",
}


def _limpio(t):
    return re.sub(r"[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ ]+", "", t or "").strip().replace(" ", "_")[:40]


def _nombre_lote(c, id_lote):
    v = c.execute("SELECT cl.nombre FROM ventas v JOIN clientes cl ON cl.id=v.cliente_id WHERE v.id_lote=? AND v.estado='ACTIVA'",
                  (id_lote,)).fetchone()
    return _limpio(v[0]) if v else "disponible"


def _venta(c, vid):
    v = c.execute("SELECT v.id_lote, cl.nombre FROM ventas v JOIN clientes cl ON cl.id=v.cliente_id WHERE v.id=?", (int(vid),)).fetchone()
    if not v:
        raise ErrorNegocio("Venta no encontrada.")
    return f"{v[0]}_{_limpio(v[1])}"


def generar_pdf(puerto, c, doc, id_):
    nav = next((n for n in NAVEGADORES if os.path.exists(n)), None)
    if not nav:
        raise ErrorNegocio("No se encontró Microsoft Edge ni Chrome para generar el PDF.")
    if doc not in DOCS_PDF:
        raise ErrorNegocio("Documento desconocido.")
    os.makedirs(base.INFORMES, exist_ok=True)
    destino = os.path.join(base.INFORMES, f"{DOCS_PDF[doc](c, id_)}_{hoy():%Y%m%d}.pdf")
    tok = seguridad.token_interno(c)
    url = f"http://127.0.0.1:{puerto}/?sinusuario&doc={doc}&id={quote(str(id_))}&t={tok}"
    with tempfile.TemporaryDirectory() as perfil:
        subprocess.run([nav, "--headless=new", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer",
                        f"--user-data-dir={perfil}", "--virtual-time-budget=12000", f"--print-to-pdf={destino}", url],
                       timeout=120, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    seguridad.cerrar(tok)
    if not os.path.exists(destino) or os.path.getsize(destino) < 2000:
        raise ErrorNegocio("No se pudo generar el PDF.")
    return destino


# ---------------------------------------------------------------- HTTP
class Manejador(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".geojson": "application/geo+json",
                      ".json": "application/json", ".js": "text/javascript", ".pbf": "application/x-protobuf",
                      ".svg": "image/svg+xml", ".ttf": "font/ttf", ".webp": "image/webp"}

    def end_headers(self):
        if self.path.startswith("/api/") or self.path.split("?")[0] in ("/", "/index.html") or self.path.endswith((".js", ".css")):
            self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    def _json(self, obj, codigo=200):
        cuerpo = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def _archivo(self, datos, tipo, nombre, adjunto=True):
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Disposition", f"{'attachment' if adjunto else 'inline'}; filename*=UTF-8''{quote(nombre)}")
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def _token(self, q):
        return self.headers.get("X-Sesion") or q.get("t")

    def _ip(self):
        return self.client_address[0] if self.client_address else ""

    # ---------------------------------------------------------- GET
    def do_GET(self):
        u = urlparse(self.path)
        if not u.path.startswith("/api/"):
            return super().do_GET()
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            with base.conectar(self.server.db) as c:
                if u.path == "/api/sesion/estado":
                    s = seguridad.validar(c, self._token(q))
                    return self._json({"configurado": seguridad.hay_usuarios(c), "sesion": s and
                                       {k: s[k] for k in ("usuario_id", "nombre", "usuario", "rol")},
                                       "proyecto": config(c).get("proyecto")})
                s = seguridad.validar(c, self._token(q))
                if not s:
                    return self._json({"error": "Sesión vencida. Ingrese de nuevo.", "sesion": False}, 401)
                return self._get(c, s, u.path, q)
        except ErrorNegocio as e:
            return self._json({"error": str(e)}, 400)
        except Exception as e:  # noqa: BLE001
            return self._json({"error": f"Error interno: {e}"}, 500)

    def _get(self, c, s, ruta, q):
        dueno = s["rol"] == "DUENO"
        simples = {
            "/api/lotes": lambda: cartera.resumen_lotes(c),
            "/api/resumen": lambda: cartera.resumen_general(c),
            "/api/lote": lambda: cartera.detalle_lote(c, q.get("id", "")),
            "/api/config": lambda: config_publica(c),
            "/api/pagos": lambda: [dict(r) for r in c.execute(
                "SELECT p.*, cl.nombre cliente, cl.documento FROM pagos p JOIN ventas v ON v.id=p.venta_id "
                "JOIN clientes cl ON cl.id=v.cliente_id ORDER BY p.recibo DESC")],
            "/api/recibo": lambda: cartera.recibo(c, int(q["n"])),
            "/api/comisionistas": lambda: comisiones.resumen_comisionistas(c),
            "/api/comisionista": lambda: comisiones.detalle_comisionista(c, int(q.get("id", 0))),
            "/api/comprobante": lambda: comisiones.comprobante_egreso(c, int(q.get("n", 0))),
            "/api/egreso": lambda: finanzas.egreso(c, int(q.get("n", 0))),
            "/api/gastos": lambda: {"gastos": finanzas.listar_gastos(c), "categorias": finanzas.CATEGORIAS},
            "/api/flujo": lambda: finanzas.flujo(c),
            "/api/conciliacion": lambda: finanzas.resumen_conciliacion(c),
            "/api/cobranza": lambda: cobranza.agenda(c, int(q.get("dias", 15))),
            "/api/prospectos": lambda: prospectos.listar(c) | {"estados": prospectos.ESTADOS, "origenes": prospectos.ORIGENES},
            "/api/documento": lambda: documentos.datos_documento(c, q.get("tipo"), q.get("id")),
            "/api/clientes": lambda: [dict(r) for r in c.execute(
                "SELECT * FROM clientes WHERE nombre LIKE ? OR documento LIKE ? ORDER BY nombre LIMIT 12",
                (f"%{q.get('q', '').strip()}%",) * 2)],
            "/api/solicitudes": lambda: [dict(r) for r in c.execute(
                "SELECT * FROM solicitudes " + ("" if dueno else f"WHERE solicitante_id={int(s['usuario_id'])} ") +
                "ORDER BY estado='PENDIENTE' DESC, id DESC LIMIT 200")],
            "/api/notificaciones": lambda: {
                "avisos": [dict(r) for r in c.execute("SELECT id, asunto, texto, estado, creado FROM notificaciones "
                                                      "WHERE canal='app' AND destino=? ORDER BY id DESC LIMIT 40", (str(s["usuario_id"]),))],
                "no_leidas": c.execute("SELECT COUNT(*) FROM notificaciones WHERE canal='app' AND destino=? AND estado='NO_LEIDA'",
                                       (str(s["usuario_id"]),)).fetchone()[0],
                "aprobaciones": c.execute("SELECT COUNT(*) FROM solicitudes WHERE estado='PENDIENTE'").fetchone()[0] if dueno else 0,
                "mis_pendientes": c.execute("SELECT COUNT(*) FROM solicitudes WHERE estado='PENDIENTE' AND solicitante_id=?",
                                            (s["usuario_id"],)).fetchone()[0]},
            "/api/cuenta": lambda: seguridad.publico(c.execute("SELECT * FROM usuarios WHERE id=?", (s["usuario_id"],)).fetchone())
            | {"codigo_vinculo": c.execute("SELECT codigo_vinculo FROM usuarios WHERE id=?", (s["usuario_id"],)).fetchone()[0]},
        }
        if ruta in simples:
            return self._json(simples[ruta]())
        if ruta == "/api/usuarios":
            if not dueno:
                raise ErrorNegocio("Solo los dueños administran usuarios.")
            return self._json([seguridad.publico(u) for u in c.execute("SELECT * FROM usuarios ORDER BY rol, nombre")])
        if ruta == "/api/alertas/estado":
            if not dueno:
                raise ErrorNegocio("Solo los dueños ven el estado de las alertas.")
            return self._json(alertas.estado_canales(c))
        if ruta == "/api/auditoria":
            if s["rol"] == "OPERADOR":
                raise ErrorNegocio("La auditoría la consultan los dueños y el usuario de consulta.")
            sql, par = "SELECT id, fecha, usuario, accion, id_lote, detalle, hash FROM bitacora WHERE 1=1", []
            for campo, op in (("desde", "substr(fecha,1,10) >= ?"), ("hasta", "substr(fecha,1,10) <= ?"),
                              ("accion", "accion = ?"), ("usuario", "usuario LIKE ?")):
                if q.get(campo):
                    sql += f" AND {op}"
                    par.append(q[campo] if campo != "usuario" else f"%{q[campo]}%")
            if q.get("q"):
                sql += " AND (detalle LIKE ? OR id_lote LIKE ?)"
                par += [f"%{q['q']}%"] * 2
            filas = [dict(r) for r in c.execute(sql + " ORDER BY id DESC LIMIT ?", (*par, int(q.get("limite", 500))))]
            acciones = [r[0] for r in c.execute("SELECT DISTINCT accion FROM bitacora ORDER BY 1")]
            return self._json({"filas": filas, "acciones": acciones, "integridad": seguridad.verificar_integridad(c)})
        if ruta == "/api/adjunto":
            _, nombre, tipo, datos, integro = documentos.archivo_adjunto(c, int(q.get("id", 0)))
            if not integro:
                raise ErrorNegocio("El archivo fue modificado después de subirlo (no coincide su huella).")
            return self._archivo(datos, tipo, nombre, adjunto=q.get("ver") != "1")
        if ruta == "/api/pdf":
            ruta_pdf = generar_pdf(self.server.server_address[1], c, q.get("doc"), q.get("id", ""))
            with open(ruta_pdf, "rb") as f:
                return self._archivo(f.read(), "application/pdf", os.path.basename(ruta_pdf))
        if ruta.startswith("/api/exportar/"):
            nombre = ruta.rsplit("/", 1)[1]
            if nombre == "auditoria.csv" and s["rol"] == "OPERADOR":
                raise ErrorNegocio("Sin permiso.")
            texto = exportar.exportar(c, nombre).encode("utf-8")
            return self._archivo(texto, "text/csv; charset=utf-8", f"{nombre[:-4]}_{hoy():%Y%m%d}.csv")
        return self._json({"error": "Ruta no encontrada"}, 404)

    # ---------------------------------------------------------- POST
    def do_POST(self):
        u = urlparse(self.path)
        try:
            largo = int(self.headers.get("Content-Length") or 0)
            if largo > 30 * 1024 * 1024:
                raise ErrorNegocio("La información enviada es demasiado grande.")
            d = json.loads(self.rfile.read(largo) or b"{}")
            with base.LOCK, base.conectar(self.server.db) as c:
                return self._json(self._post(c, u.path, d))
        except ErrorNegocio as e:
            return self._json({"error": str(e)}, 400)
        except PermissionError as e:
            return self._json({"error": str(e), "sesion": False}, 401)
        except Exception as e:  # noqa: BLE001
            return self._json({"error": f"Error interno: {e}"}, 500)

    def _post(self, c, ruta, d):
        if ruta == "/api/sesion/entrar":
            tok, u = seguridad.iniciar_sesion(c, d.get("usuario"), d.get("clave"), self._ip())
            return {"ok": True, "token": tok, "usuario": u}
        if ruta == "/api/sesion/configurar":
            if seguridad.hay_usuarios(c):
                raise ErrorNegocio("El sistema ya tiene usuarios.")
            seguridad.guardar_usuario(c, "Configuración inicial", {**d, "rol": "DUENO"})
            tok, u = seguridad.iniciar_sesion(c, d.get("usuario"), d.get("clave"), self._ip())
            return {"ok": True, "token": tok, "usuario": u}
        s = seguridad.validar(c, self.headers.get("X-Sesion"))
        if not s:
            raise PermissionError("Sesión vencida. Ingrese de nuevo.")
        if ruta == "/api/sesion/salir":
            seguridad.cerrar(s["token"])
            return {"ok": True}
        if ruta in seguridad.SIEMPRE:
            return seguridad.acciones(c, s, ruta, d)
        if ruta.startswith("/api/usuarios/"):
            if s["rol"] != "DUENO":
                raise ErrorNegocio("Solo los dueños administran usuarios.")
            return seguridad.acciones(c, s, ruta, d)
        if ruta == "/api/solicitud/resolver":
            seguridad.evaluar(c, s, ruta, d)
            return seguridad.resolver_solicitud(c, s["nombre"], int(d["id"]), bool(d.get("aprobar")), d.get("motivo"), ejecutar)
        if ruta == "/api/notificaciones/leer":
            c.execute("UPDATE notificaciones SET estado='LEIDA' WHERE canal='app' AND destino=? AND estado='NO_LEIDA'",
                      (str(s["usuario_id"]),))
            return {"ok": True}
        if ruta == "/api/integridad/verificar":
            integ = seguridad.verificar_integridad(c)
            alertas.revisar_integridad(c, integ)
            return integ
        if ruta == "/api/respaldo":
            return {"ok": True, "archivo": os.path.basename(base.respaldar("manual"))}
        if ruta in ("/api/config/secreta", "/api/alertas/probar", "/api/alertas/resumen", "/api/alertas/recordatorios"):
            if s["rol"] != "DUENO":
                raise ErrorNegocio("Solo un dueño puede hacer esto.")
            if ruta == "/api/config/secreta":
                for k in ("telegram_token", "smtp_clave"):
                    if k in d:
                        base.set_config(c, k, (d[k] or "").strip())
                bitacora(c, s["nombre"], "CONFIG_SECRETA", None, {"claves": [k for k in d if k in ("telegram_token", "smtp_clave")]})
                return {"ok": True}
            if ruta == "/api/alertas/probar":
                hechos = alertas.probar_canales(c, s)
                if not hechos:
                    raise ErrorNegocio("No hay canal listo: configure Telegram (y vincule su chat) o el correo, y registre su correo en Mi cuenta.")
                return {"ok": True, "canales": hechos}
            if ruta == "/api/alertas/resumen":
                alertas.enviar_resumen(c)
                return {"ok": True}
            return {"ok": True, "enviados": alertas.generar_recordatorios(c, forzar=True)}
        # operaciones de negocio: permiso, aprobación o ejecución directa
        decision = seguridad.evaluar(c, s, ruta, d)
        alertas.revisar_horario(c, s, ruta)
        if decision == "aprobacion":
            return seguridad.crear_solicitud(c, s, ruta, d)
        res = ejecutar(c, s["nombre"], ruta, d)
        alertas.accion_de_dueno(c, s, ruta, d)
        return res


def ip_local():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as so:
            so.connect(("8.8.8.8", 80))
            return so.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def main():
    args = sys.argv[1:]
    if "--db" in args:  # base alterna (pruebas): sus respaldos, expedientes e informes quedan junto a ella
        base.DB = os.path.abspath(args[args.index("--db") + 1])
        carpeta = os.path.dirname(base.DB)
        base.RESPALDOS = os.path.join(carpeta, "respaldos")
        base.EXPEDIENTES = os.path.join(carpeta, "expedientes")
        base.INFORMES = os.path.join(carpeta, "INFORMES")
    base.iniciar_base()
    alertas.EJECUTOR = ejecutar
    with base.conectar() as c:
        red = config(c).get("acceso_red") == "1"
    numeros = [a for a in args if a.isdigit()]
    srv = None
    for puerto in ([int(numeros[0])] if numeros else range(8100, 8111)):
        try:
            srv = ThreadingHTTPServer(("0.0.0.0" if red else "127.0.0.1", puerto), partial(Manejador, directory=base.WEB))
            break
        except OSError:
            continue
    if srv is None:
        sys.exit("No hay un puerto libre entre 8100 y 8110.")
    srv.db = base.DB
    if "--sin-tareas" not in args:
        alertas.arrancar()
    url = f"http://localhost:{puerto}"
    print(f"Geovisor de ventas abierto en {url}", flush=True)
    if red:
        print(f"Acceso en la red local: http://{ip_local()}:{puerto}", flush=True)
    print(f"Base contable: {base.DB}", flush=True)
    print("Deje esta ventana abierta mientras usa el geovisor. Para cerrarlo: Ctrl+C o cierre la ventana.", flush=True)
    if "--sin-navegador" not in args:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
