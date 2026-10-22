# -*- coding: utf-8 -*-
r"""
servir.py — Servidor del Geovisor de ventas y cartera del loteo.

Una instancia por empresa: la interfaz es común (app/web) y cada cliente aporta su carpeta (clientes/<id>) con
cliente.json, marca/, cartografia/ y datos/. Sin sesión no se entrega nada salvo la pantalla de ingreso: ni el código
del geovisor, ni la cartografía, ni la ortofoto, ni la API. Las operaciones sensibles de un operador quedan
pendientes hasta que un dueño las apruebe. La lógica de negocio vive en nucleo/ (un módulo por área).

Uso:  python servir.py --cliente ..\clientes\merced          -> primer puerto libre entre 8100 y 8110
      python servir.py 8200 --cliente ...                    -> puerto fijo
      python servir.py --cliente ... --db otra.sqlite        -> otra base (pruebas)
      python servir.py --cliente ... --sin-navegador --sin-tareas
En el servidor (Docker) se configura con variables: GEOVISOR_CLIENTE, PORT, GEOVISOR_HOST=0.0.0.0.
"""
import datetime as dt
import functools
import hmac
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

from nucleo import (alertas, base, cartera, cobranza, comisiones, documentos, exportar, finanzas, prospectos,
                    seguridad)
from nucleo.base import ErrorNegocio, bitacora, config, hoy

NAVEGADORES = [os.environ.get("GEOVISOR_NAVEGADOR", ""),
               r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
               r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
               r"C:\Program Files\Google\Chrome\Application\chrome.exe",
               "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]
MODULOS = [cartera.acciones, comisiones.acciones_comisiones, finanzas.acciones, cobranza.acciones, documentos.acciones,
           prospectos.acciones]


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
    out["empresa"] = base.CLIENTE_CFG.get("empresa") or cfg.get("proyecto")
    out["crs_nombre"] = base.CLIENTE_CFG.get("crs_nombre", "")
    out["capas_extra"] = base.CLIENTE_CFG.get("capas_extra", [])
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
    nav = next((n for n in NAVEGADORES if n and os.path.exists(n)), None)
    if not nav:
        raise ErrorNegocio("No se encontró Microsoft Edge ni Chrome para generar el PDF.")
    if doc not in DOCS_PDF:
        raise ErrorNegocio("Documento desconocido.")
    os.makedirs(base.INFORMES, exist_ok=True)
    destino = os.path.join(base.INFORMES, f"{DOCS_PDF[doc](c, id_)}_{hoy():%Y%m%d}.pdf")
    tok = seguridad.token_interno(c)
    # /i/<token>/ deja entrar al navegador sin ventana a los archivos protegidos sin necesidad de cookie
    url = f"http://127.0.0.1:{puerto}/i/{tok}/?sinusuario&doc={doc}&id={quote(str(id_))}&t={tok}"
    extra = [] if os.name == "nt" else ["--no-sandbox", "--disable-dev-shm-usage"]
    with tempfile.TemporaryDirectory() as perfil:
        subprocess.run([nav, "--headless=new", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer", *extra,
                        f"--user-data-dir={perfil}", "--virtual-time-budget=12000", f"--print-to-pdf={destino}", url],
                       timeout=120, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    seguridad.cerrar(tok)
    if not os.path.exists(destino) or os.path.getsize(destino) < 2000:
        raise ErrorNegocio("No se pudo generar el PDF.")
    return destino


# ---------------------------------------------------------------- HTTP
# ---------------------------------------------------------------- marca de cada empresa
# La interfaz se escribe con la paleta por defecto; al servirla se cambian esos colores por los de la empresa.
PALETA_BASE = {"primario": "#0C2E37", "acento": "#5CE9AB"}
PUBLICOS = ("/", "/index.html", "/sw.js", "/manifest.webmanifest", "/js/arranque.js", "/favicon.ico")
PREFIJOS_PUBLICOS = ("/css/", "/lib/", "/marca/")


def _rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _hex(rgb):
    return "#" + "".join(f"{max(0, min(255, round(v))):02X}" for v in rgb)


def _mezcla(h, otro, t):
    a, b = _rgb(h), _rgb(otro)
    return _hex([a[i] + (b[i] - a[i]) * t for i in range(3)])


def paleta():
    col = {**PALETA_BASE, **(base.CLIENTE_CFG.get("colores") or {})}
    p, a = col["primario"].upper(), col["acento"].upper()
    w, k = "#FFFFFF", "#000000"
    return {  # color por defecto en el código -> color derivado de la marca de la empresa
        "#0C2E37": p, "#123C47": _mezcla(p, w, .07), "#1B4E5B": _mezcla(p, w, .15), "#16505E": _mezcla(p, w, .18),
        "#081F25": _mezcla(p, k, .35), "#A9C2C8": _mezcla(p, w, .62),
        "#5CE9AB": a, "#17A974": _mezcla(a, k, .32), "#4EE6D2": a,
        "#ECFBF4": _mezcla(a, w, .9), "#F0FBF6": _mezcla(a, w, .92), "#C9F2DE": _mezcla(a, w, .72), "#C9F5E1": _mezcla(a, w, .7),
        "rgba(92,233,171,": "rgba({},{},{},".format(*_rgb(a)),
    }


_RE_COLOR = None


@functools.lru_cache(maxsize=256)
def _con_marca(ruta, mtime):
    """Archivo de la interfaz con los colores de la empresa (en memoria; se recalcula si el archivo cambia)."""
    global _RE_COLOR
    with open(ruta, encoding="utf-8") as f:
        texto = f.read()
    tabla = {k.upper(): v for k, v in paleta().items()}
    if _RE_COLOR is None:
        _RE_COLOR = re.compile("|".join(re.escape(k) for k in sorted(tabla, key=len, reverse=True)), re.I)
    return _RE_COLOR.sub(lambda m: tabla[m.group(0).upper()], texto).encode("utf-8")


def manifiesto():
    cfg = base.CLIENTE_CFG
    col = {**PALETA_BASE, **(cfg.get("colores") or {})}
    nombre = cfg.get("empresa") or cfg.get("proyecto") or "Ventas y cartera"
    return {
        "name": f"{nombre} · Ventas y cartera", "short_name": cfg.get("nombre_corto") or nombre[:12],
        "description": f"Geovisor de ventas y cartera de {nombre}", "lang": "es-CO",
        "start_url": "/", "scope": "/", "display": "standalone", "orientation": "any",
        "background_color": col["primario"], "theme_color": col["primario"],
        "icons": [{"src": "/marca/icono-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                  {"src": "/marca/icono-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                  {"src": "/marca/icono-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
    }


class Manejador(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".geojson": "application/geo+json",
                      ".json": "application/json", ".js": "text/javascript", ".pbf": "application/x-protobuf",
                      ".svg": "image/svg+xml", ".ttf": "font/ttf", ".webp": "image/webp"}

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
        reenviada = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        return reenviada or (self.client_address[0] if self.client_address else "")

    # ---------------------------------------------------------- archivos de la interfaz, la marca y la cartografía
    def translate_path(self, path):
        p = urlparse(path).path
        for pref, raiz in (("/data/", base.CARTO), ("/marca/", base.MARCA)):
            if p.startswith(pref):
                return self._en(raiz, path[len(pref) - 1:])
        return self._en(base.WEB, path)

    def _en(self, raiz, path):
        antes, self.directory = self.directory, raiz
        try:
            return super().translate_path(path)
        finally:
            self.directory = antes

    def list_directory(self, path):   # nunca se listan carpetas
        self.send_error(404)
        return None

    def do_HEAD(self):
        self.send_error(405)

    def _cookie_sesion(self):
        for parte in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = parte.strip().partition("=")
            if k == "gv":
                return v
        return ""

    def _estatico(self, u):
        ruta, tok = u.path, self._cookie_sesion()
        m = re.match(r"^/i/([A-Za-z0-9_\-]{20,})(/.*)$", ruta)
        if m:  # acceso del navegador sin ventana que genera los PDF
            tok, ruta = m.group(1), m.group(2)
        if ruta == "/manifest.webmanifest":
            datos = json.dumps(manifiesto(), ensure_ascii=False).encode("utf-8")
            return self._archivo(datos, "application/manifest+json", "manifest.webmanifest", adjunto=False)
        publico = ruta in PUBLICOS or ruta.startswith(PREFIJOS_PUBLICOS)
        if not publico:
            with base.conectar(self.server.db) as c:
                if not seguridad.validar(c, tok):
                    return self._json({"error": "Inicie sesión para ver este contenido."}, 401)
        self.path = ruta + (f"?{u.query}" if u.query else "")
        archivo = self.translate_path(ruta)
        if os.path.isdir(archivo):
            archivo = os.path.join(archivo, "index.html")
        if archivo.endswith((".html", ".js", ".css")) and os.path.isfile(archivo):
            datos = _con_marca(archivo, os.path.getmtime(archivo))
            tipo = {"html": "text/html", "js": "text/javascript", "css": "text/css"}[archivo.rsplit(".", 1)[1]]
            self.send_response(200)
            self.send_header("Content-Type", tipo + "; charset=utf-8")
            self.send_header("Content-Length", str(len(datos)))
            self.end_headers()
            self.wfile.write(datos)
            return None
        return super().do_GET()

    def end_headers(self):
        if getattr(self, "_cookie", None) is not None:
            seguro = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
            vence = "; Max-Age=0" if self._cookie == "" else ""
            self.send_header("Set-Cookie", f"gv={self._cookie}; Path=/; HttpOnly; SameSite=Strict{seguro}{vence}")
            self._cookie = None
        self._encabezados_base()

    def _encabezados_base(self):
        p = self.path.split("?")[0]
        if p.startswith(("/api/", "/i/")) or p in ("/", "/index.html", "/sw.js") or p.endswith((".js", ".css", ".geojson", ".json")):
            self.send_header("Cache-Control", "no-store")
        elif p.startswith("/data/"):
            self.send_header("Cache-Control", "private, max-age=604800")   # teselas de la ortofoto: 7 días en el equipo
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "same-origin")
        SimpleHTTPRequestHandler.end_headers(self)

    # ---------------------------------------------------------- GET
    def do_GET(self):
        u = urlparse(self.path)
        if not u.path.startswith("/api/"):
            return self._estatico(u)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            with base.conectar(self.server.db) as c:
                if u.path == "/api/sesion/estado":
                    s = seguridad.validar(c, self._token(q))
                    cli = base.CLIENTE_CFG
                    configurado = seguridad.hay_usuarios(c)
                    return self._json({"configurado": configurado, "sesion": s and
                                       {k: s[k] for k in ("usuario_id", "nombre", "usuario", "rol")},
                                       "proyecto": config(c).get("proyecto"),
                                       "marca": {"empresa": cli.get("empresa") or config(c).get("proyecto"),
                                                 "logo": os.path.exists(os.path.join(base.MARCA, "logo_claro.png")),
                                                 "pide_codigo": not configurado and bool(cli.get("codigo_instalacion"))}})
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
            self._cookie = tok
            return {"ok": True, "token": tok, "usuario": u}
        if ruta == "/api/sesion/configurar":
            if seguridad.hay_usuarios(c):
                raise ErrorNegocio("El sistema ya tiene usuarios.")
            codigo = base.CLIENTE_CFG.get("codigo_instalacion")
            if codigo and not hmac.compare_digest(str(d.get("codigo") or "").strip(), str(codigo)):
                raise ErrorNegocio("El código de instalación no es correcto.")
            seguridad.guardar_usuario(c, "Configuración inicial", {**d, "rol": "DUENO"})
            tok, u = seguridad.iniciar_sesion(c, d.get("usuario"), d.get("clave"), self._ip())
            self._cookie = tok
            return {"ok": True, "token": tok, "usuario": u}
        s = seguridad.validar(c, self.headers.get("X-Sesion"))
        if not s:
            self._cookie = ""
            raise PermissionError("Sesión vencida. Ingrese de nuevo.")
        if ruta == "/api/sesion/salir":
            seguridad.cerrar(s["token"])
            self._cookie = ""
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
    carpeta = args[args.index("--cliente") + 1] if "--cliente" in args else os.environ.get("GEOVISOR_CLIENTE")
    if not carpeta:  # si solo hay un cliente, se usa ese
        raiz_clientes = os.path.join(os.path.dirname(base.RAIZ), "clientes")
        hay = [d for d in sorted(os.listdir(raiz_clientes)) if os.path.isfile(os.path.join(raiz_clientes, d, "cliente.json"))] \
            if os.path.isdir(raiz_clientes) else []
        if len(hay) != 1:
            sys.exit("Indique el cliente: python servir.py --cliente ..\\clientes\\<id>")
        carpeta = os.path.join(raiz_clientes, hay[0])
    base.usar_cliente(carpeta)
    if "--db" in args:  # base alterna (pruebas): sus respaldos, expedientes e informes quedan junto a ella
        base.DB = os.path.abspath(args[args.index("--db") + 1])
        carpeta = os.path.dirname(base.DB)
        base.RESPALDOS = os.path.join(carpeta, "respaldos")
        base.EXPEDIENTES = os.path.join(carpeta, "expedientes")
        base.INFORMES = os.path.join(carpeta, "informes")
    base.iniciar_base()
    alertas.EJECUTOR = ejecutar
    with base.conectar() as c:
        red = config(c).get("acceso_red") == "1"
    numeros = [a for a in args if a.isdigit()] or ([os.environ["PORT"]] if os.environ.get("PORT") else [])
    host = os.environ.get("GEOVISOR_HOST") or ("0.0.0.0" if red else "127.0.0.1")
    srv = None
    for puerto in ([int(numeros[0])] if numeros else range(8100, 8111)):
        try:
            srv = ThreadingHTTPServer((host, puerto), partial(Manejador, directory=base.WEB))
            break
        except OSError:
            continue
    if srv is None:
        sys.exit("No hay un puerto libre entre 8100 y 8110.")
    srv.db = base.DB
    if "--sin-tareas" not in args:
        alertas.arrancar()
    url = f"http://localhost:{puerto}"
    print(f"Geovisor de {base.CLIENTE_CFG.get('empresa', '')} abierto en {url}", flush=True)
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
