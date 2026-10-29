"""API del geovisor en FastAPI. La lógica de negocio sigue en nucleo/ (la misma del servidor anterior)."""
import hmac
import logging
import os
import re
import sys
import threading
import time


from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from nucleo import (alertas, base, bienes, bloques, cartera, cobranza, comisiones, contratos, desistimientos, documentos, exportar,
                    finanzas, prospectos, seguridad, tenant)
from nucleo.base import ErrorNegocio, bitacora, config, num

AQUI = os.path.dirname(sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__))
MODULOS = [cartera.acciones, comisiones.acciones_comisiones, finanzas.acciones, cobranza.acciones, documentos.acciones,
           prospectos.acciones, contratos.acciones, bienes.acciones, bloques.acciones, desistimientos.acciones]
LECTURAS = [contratos.get, bienes.get, bloques.get, desistimientos.get]

app = FastAPI(title="Geovisor")


def iniciar(carpeta_cliente):
    t = base.usar_cliente(carpeta_cliente)
    base.iniciar_base()
    with base.conectar() as c:
        for m in (contratos, bienes, bloques, desistimientos):      # tablas propias y reglas de seguridad de cada módulo
            m.iniciar(c)
    alertas.EJECUTOR = ejecutar
    alertas.arrancar()
    threading.Thread(target=lambda: (tenant.fijar(t), lotes(True), resumen(True)), daemon=True).start()     # calienta la memoria antes del primer ingreso


def iniciar_todos(raiz_clientes):
    """Un solo proceso para todos los clientes: cada subcarpeta de raiz_clientes con cliente.json."""
    carpetas = sorted(p for p in (os.path.join(raiz_clientes, n) for n in os.listdir(raiz_clientes))
                      if os.path.isfile(os.path.join(p, "cliente.json")))
    if not carpetas:       # primer despliegue con el disco vacío: se queda vivo para poder copiar los clientes y reiniciar
        print(f"AVISO: no hay clientes en {raiz_clientes}; copie las carpetas de cliente y reinicie.")
    for p in carpetas:
        iniciar(p)


@app.middleware("http")
async def elegir_cliente(r: Request, siguiente):
    """El cliente sale del subdominio (merced.plataforma.com); nunca de un dato que mande el usuario en el cuerpo."""
    # detrás de Vercel el Host es el de Render; el dominio que escribió el usuario llega en X-Forwarded-Host
    if r.url.path == "/salud":
        return await siguiente(r)
    t = tenant.por_host(r.headers.get("x-forwarded-host") or r.headers.get("host"))
    if t is None:
        return JSONResponse({"error": "Cliente no encontrado."}, 404)
    tenant.fijar(t)
    return await siguiente(r)


@app.get("/salud")
def salud():
    return {"ok": True, "clientes": len(tenant.TENANTS)}


@app.exception_handler(ErrorNegocio)
async def _negocio(_: Request, e: ErrorNegocio):
    return JSONResponse({"error": str(e)}, 400)


@app.exception_handler(PermissionError)
async def _permiso(_: Request, e: PermissionError):
    r = JSONResponse({"error": str(e), "sesion": False}, 401)
    r.delete_cookie("gv")
    return r


@app.exception_handler(KeyError)
@app.exception_handler(ValueError)
@app.exception_handler(TypeError)
@app.exception_handler(AttributeError)
async def _dato_invalido(_: Request, e: Exception):
    logging.getLogger("uvicorn.error").warning("Dato no válido en la petición", exc_info=e)   # queda el rastro; el usuario recibe un 400, no un 500
    return JSONResponse({"error": "Dato no válido o faltante: revise el formulario."}, 400)


# ---------------------------------------------------------------- operaciones de negocio
def ejecutar(c, usuario, ruta, d):
    """Operación de negocio, directa o ya aprobada por un dueño."""
    if ruta == "/api/config":
        cambiadas = [k for k in d if k in base.CONFIG_INICIAL and k not in base.CONFIG_SECRETA and k not in base.CONFIG_SISTEMA]
        _validar_mora({**config(c), **{k: d[k] for k in cambiadas}})
        for k in cambiadas:
            base.set_config(c, k, d[k])
        bitacora(c, usuario, "CONFIG", None, {k: d[k] for k in cambiadas})
        return {"ok": True}
    for modulo in MODULOS:
        r = modulo(c, usuario, ruta, d)
        if r is not None:
            return r
    raise ErrorNegocio("Operación desconocida.")


def _validar_mora(cfg):
    ea, mes = num(cfg.get("tasa_usura_ea"), 0), str(cfg.get("tasa_usura_mes") or "")
    if not 0 <= ea <= 100:
        raise ErrorNegocio("La tasa de usura debe estar entre 0 y 100 % efectivo anual.")
    if mes and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", mes):
        raise ErrorNegocio("El mes de vigencia de la tasa de usura debe tener el formato AAAA-MM.")
    tope, tasa = cartera.tope_mora_mensual(cfg), num(cfg.get("tasa_mora_mensual"), 0)
    if tasa < 0:
        raise ErrorNegocio("El interés de mora no puede ser negativo.")
    if tope is not None and tasa > tope + 1e-9:
        raise ErrorNegocio(f"El interés de mora ({tasa:g} % mensual) supera el tope de usura vigente: {tope:g} % mensual ({ea:g} % efectivo anual).")


def config_publica(c):
    cfg = config(c)
    out = {k: v for k, v in cfg.items() if k not in base.CONFIG_SECRETA}
    out["telegram_configurado"] = bool(cfg.get("telegram_token"))
    out["empresa"] = base.CLIENTE_CFG.get("empresa") or cfg.get("proyecto")
    out["capas_extra"] = base.CLIENTE_CFG.get("capas_extra", [])
    out["smtp_configurado"] = bool(cfg.get("smtp_usuario") and cfg.get("smtp_clave"))
    out["tope_mora_mensual"] = cartera.tope_mora_mensual(cfg)
    out["tasa_mora_efectiva"] = cartera.tasa_mora_efectiva(cfg)
    out["usura_vencida"] = out["tope_mora_mensual"] is not None and cfg.get("tasa_usura_mes") != base.hoy().strftime("%Y-%m")
    return out


# ---------------------------------------------------------------- sesión
def _token(r: Request):
    return r.headers.get("X-Sesion") or r.cookies.get("gv")


def _entrar(c, resp: Response, r: Request, d):
    tok, u = seguridad.iniciar_sesion(c, d.get("usuario"), d.get("clave"), _ip(r))
    if tok is None:          # dueño con correo: falta el código; u trae el reto
        return {"ok": True, "codigo_requerido": True, **u}
    return _con_cookie(resp, r, tok, u)


def _ip(r: Request):
    return r.client.host if r.client else ""


def _con_cookie(resp: Response, r: Request, tok, u):
    resp.set_cookie("gv", tok, httponly=True, samesite="strict", secure=r.url.scheme == "https")
    return {"ok": True, "token": tok, "usuario": u}


def _sin_candado_al_fallar(accion):
    err = None
    with base.LOCK, base.conectar() as c:
        try:
            return accion(c)
        except ErrorNegocio as e:
            err = e          # se captura dentro para que la transacción confirme el contador de intentos fallidos
    time.sleep(0.6)          # fuera del candado: no frena al resto de usuarios
    raise err


@app.get("/api/sesion/estado")
def estado(r: Request):
    with base.conectar() as c:
        s = seguridad.validar(c, _token(r))
        cli, configurado = base.CLIENTE_CFG, seguridad.hay_usuarios(c)
        return {"configurado": configurado,
                "sesion": s and {k: s[k] for k in ("usuario_id", "nombre", "usuario", "rol")},
                "proyecto": config(c).get("proyecto"),
                "pide_correo": seguridad.pide_codigo(config(c)),
                "marca": {"empresa": cli.get("empresa") or config(c).get("proyecto"),
                          "logo": os.path.exists(os.path.join(base.MARCA, "logo_claro.png")),
                          "pide_codigo": not configurado and bool(cli.get("codigo_instalacion"))}}


@app.post("/api/sesion/entrar")
def entrar(d: dict, r: Request, resp: Response):
    return _sin_candado_al_fallar(lambda c: _entrar(c, resp, r, d))


@app.post("/api/sesion/codigo")
def codigo(d: dict, r: Request, resp: Response):
    return _sin_candado_al_fallar(
        lambda c: _con_cookie(resp, r, *seguridad.verificar_codigo(c, d.get("reto"), d.get("codigo"), _ip(r))))


@app.post("/api/sesion/reenviar")
def reenviar(d: dict, r: Request):
    return _sin_candado_al_fallar(lambda c: seguridad.reenviar_codigo(c, d.get("reto"), _ip(r)))


@app.post("/api/sesion/configurar")
def configurar(d: dict, r: Request, resp: Response):
    with base.LOCK, base.conectar() as c:
        if seguridad.hay_usuarios(c):
            raise ErrorNegocio("El sistema ya tiene usuarios.")
        codigo = base.CLIENTE_CFG.get("codigo_instalacion")
        if codigo and not hmac.compare_digest(str(d.get("codigo") or "").strip(), str(codigo)):
            raise ErrorNegocio("El código de instalación no es correcto.")
        seguridad.guardar_usuario(c, "Configuración inicial", {**d, "rol": "DUENO"})
        return _entrar(c, resp, r, d)


def sesion(r: Request):
    with base.conectar() as c:
        s = seguridad.validar(c, _token(r))
    if not s:
        raise PermissionError("Sesión vencida. Ingrese de nuevo.")
    return s


@app.post("/api/sesion/salir")
def salir(resp: Response, s=Depends(sesion)):
    with base.conectar() as c:
        seguridad.cerrar(c, s["token"])
    resp.delete_cookie("gv")
    return {"ok": True}


# ---------------------------------------------------------------- lecturas
def _con(f, *a):
    with base.conectar() as c:
        return f(c, *a)


@app.get("/api/resumen")
def resumen(s=Depends(sesion)):
    return base.memo("resumen", lambda: _con(cartera.resumen_general))


@app.get("/api/lotes")
def lotes(s=Depends(sesion)):
    return base.memo("lotes", lambda: _con(cartera.resumen_lotes))


@app.get("/api/lote")
def lote(id: str, s=Depends(sesion)):
    return base.memo(("lote", id), lambda: _con(cartera.detalle_lote, id))


@app.get("/api/config")
def get_config(s=Depends(sesion)):
    with base.conectar() as c:
        return config_publica(c)


@app.get("/api/exportar/{nombre}")
def exportar_csv(nombre: str, s=Depends(sesion)):
    if nombre in ("auditoria.csv", "historial_precios.csv") and s["rol"] == "OPERADOR":
        raise PermissionError("Sin permiso.")
    with base.conectar() as c:
        texto = exportar.exportar(c, nombre)
    return Response(texto.encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{nombre[:-4]}_{base.hoy():%Y%m%d}.csv"'})


@app.get("/api/adjunto")
def adjunto(id: int, ver: str = "", s=Depends(sesion)):
    with base.conectar() as c:
        _, nombre, tipo, datos, integro = documentos.archivo_adjunto(c, id)
    if not integro:
        raise ErrorNegocio("El archivo fue modificado después de subirlo (no coincide su huella).")
    return Response(datos, media_type=tipo, headers={"Content-Disposition": f'{"inline" if ver == "1" else "attachment"}; filename="{nombre}"'})


def _lecturas(c, s, q):
    dueno = s["rol"] == "DUENO"
    uid = int(s["usuario_id"])
    return {
        "pagos": lambda: [dict(r) for r in c.execute(
            "SELECT p.*, cl.nombre cliente, cl.documento FROM pagos p JOIN ventas v ON v.id=p.venta_id "
            "JOIN clientes cl ON cl.id=v.cliente_id ORDER BY p.recibo DESC")],
        "recibo": lambda: cartera.recibo(c, int(q["n"])),
        "comisionistas": lambda: comisiones.resumen_comisionistas(c),
        "comisionista": lambda: comisiones.detalle_comisionista(c, int(q.get("id", 0))),
        "comprobante": lambda: comisiones.comprobante_egreso(c, int(q.get("n", 0))),
        "egreso": lambda: finanzas.egreso(c, int(q.get("n", 0))),
        "gastos": lambda: {"gastos": finanzas.listar_gastos(c), "categorias": finanzas.CATEGORIAS},
        "flujo": lambda: finanzas.flujo(c),
        "conciliacion": lambda: finanzas.resumen_conciliacion(c),
        "conciliacion/detalle": lambda: finanzas.detalle_conciliacion(c, int(q.get("id", 0))),
        "cobranza": lambda: cobranza.agenda(c, int(q.get("dias", 15))),
        "prospectos": lambda: prospectos.listar(c) | {"estados": prospectos.ESTADOS, "origenes": prospectos.ORIGENES},
        "documento": lambda: documentos.datos_documento(c, q.get("tipo"), q.get("id")),
        "clientes": lambda: [dict(r) for r in c.execute(
            "SELECT * FROM clientes WHERE nombre LIKE ? OR documento LIKE ? ORDER BY nombre LIMIT 12",
            (f"%{q.get('q', '').strip()}%",) * 2)],
        "solicitudes": lambda: [dict(r) for r in c.execute(
            "SELECT * FROM solicitudes " + ("" if dueno else f"WHERE solicitante_id={uid} ") +
            "ORDER BY estado='PENDIENTE' DESC, id DESC LIMIT 200")],
        "notificaciones": lambda: {
            "avisos": [dict(r) for r in c.execute("SELECT id, asunto, texto, estado, creado FROM notificaciones "
                                                  "WHERE canal='app' AND destino=? ORDER BY id DESC LIMIT 40", (str(uid),))],
            "no_leidas": c.execute("SELECT COUNT(*) FROM notificaciones WHERE canal='app' AND destino=? AND estado='NO_LEIDA'",
                                   (str(uid),)).fetchone()[0],
            "aprobaciones": c.execute("SELECT COUNT(*) FROM solicitudes WHERE estado='PENDIENTE'").fetchone()[0] if dueno else 0,
            "mis_pendientes": c.execute("SELECT COUNT(*) FROM solicitudes WHERE estado='PENDIENTE' AND solicitante_id=?",
                                        (uid,)).fetchone()[0]},
        "cuenta": lambda: seguridad.publico(c.execute("SELECT * FROM usuarios WHERE id=?", (uid,)).fetchone())
        | {"codigo_vinculo": c.execute("SELECT codigo_vinculo FROM usuarios WHERE id=?", (uid,)).fetchone()[0]},
    }


@app.get("/api/{ruta:path}")
def lectura(ruta: str, r: Request, s=Depends(sesion)):
    q = dict(r.query_params)
    return base.memo((ruta, tuple(sorted(q.items())), s["rol"], s["usuario_id"]), lambda: _leer(ruta, q, s))


def _leer(ruta, q, s):
    dueno = s["rol"] == "DUENO"
    with base.conectar() as c:
        simples = _lecturas(c, s, q)
        if ruta in simples:
            return simples[ruta]()
        if ruta == "usuarios":
            if not dueno:
                raise ErrorNegocio("Solo los dueños administran usuarios.")
            return [seguridad.publico(u) for u in c.execute("SELECT * FROM usuarios ORDER BY rol, nombre")]
        if ruta == "alertas/estado":
            if not dueno:
                raise ErrorNegocio("Solo los dueños ven el estado de las alertas.")
            return alertas.estado_canales(c)
        if ruta == "auditoria":
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
            filas = [dict(x) for x in c.execute(sql + " ORDER BY id DESC LIMIT ?", (*par, int(q.get("limite", 500))))]
            acciones = [x[0] for x in c.execute("SELECT DISTINCT accion FROM bitacora ORDER BY 1")]
            return {"filas": filas, "acciones": acciones, "integridad": seguridad.verificar_integridad(c)}
        for leer in LECTURAS:
            r = leer(c, s, "/api/" + ruta, q)
            if r is not None:
                return r
    raise HTTPException(404, "Ruta no encontrada")


@app.middleware("http")
async def limite_tamano(r: Request, siguiente):
    if int(r.headers.get("content-length") or 0) > 30 * 1024 * 1024:
        return JSONResponse({"error": "La información enviada es demasiado grande."}, 400)
    return await siguiente(r)


@app.get("/manifest.webmanifest")
def manifiesto():
    cfg = base.CLIENTE_CFG
    color = (cfg.get("colores") or {}).get("primario", "#0C2E37")
    nombre = cfg.get("empresa") or cfg.get("proyecto") or "Ventas y cartera"
    iconos = [("192x192", "icono-192.png", "any"), ("512x512", "icono-512.png", "any"), ("512x512", "icono-maskable-512.png", "maskable")]
    return JSONResponse({
        "name": f"{nombre} · Ventas y cartera", "short_name": cfg.get("nombre_corto") or nombre[:12],
        "description": f"Geovisor de ventas y cartera de {nombre}", "lang": "es-CO",
        "start_url": "/", "scope": "/", "display": "standalone", "orientation": "any",
        "background_color": color, "theme_color": color,
        "icons": [{"src": f"/marca/{f}", "sizes": z, "type": "image/png", "purpose": p} for z, f, p in iconos]},
        media_type="application/manifest+json")


# ---------------------------------------------------------------- cartografía y ortofoto (solo con sesión)
@app.get("/data/{ruta:path}")
def cartografia(ruta: str, s=Depends(sesion)):
    archivo = os.path.realpath(os.path.join(base.CARTO, ruta))
    if not archivo.startswith(os.path.realpath(base.CARTO) + os.sep) or not os.path.isfile(archivo):
        raise HTTPException(404)
    return FileResponse(archivo, headers={"Cache-Control": "private, max-age=604800"})


@app.get("/marca/{archivo:path}")
def marca(archivo: str):
    """Logo e iconos del cliente de la petición. Pública: la pantalla de ingreso los pide antes de tener sesión."""
    ruta = os.path.realpath(os.path.join(base.MARCA, archivo))
    if not ruta.startswith(os.path.realpath(base.MARCA) + os.sep) or not os.path.isfile(ruta):
        raise HTTPException(404)
    return FileResponse(ruta, headers={"Cache-Control": "public, max-age=3600"})


# ---------------------------------------------------------------- escrituras: permiso, aprobación o ejecución directa
def _alertas(c, s, ruta, d):
    if s["rol"] != "DUENO":
        raise ErrorNegocio("Solo un dueño puede hacer esto.")
    if ruta == "/api/config/secreta":
        claves = [k for k in ("telegram_token", "smtp_clave") if k in d]
        for k in claves:
            base.set_config(c, k, (d[k] or "").strip())
        bitacora(c, s["nombre"], "CONFIG_SECRETA", None, {"claves": claves})
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


@app.post("/api/{ruta:path}")
def operar(ruta: str, d: dict, s=Depends(sesion)):
    ruta = "/api/" + ruta
    with base.LOCK, base.conectar() as c:
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
            raise base.ErrorNegocio("La base está en Supabase: las copias de seguridad se hacen desde su panel.")
        if ruta in ("/api/config/secreta", "/api/alertas/probar", "/api/alertas/resumen", "/api/alertas/recordatorios"):
            return _alertas(c, s, ruta, d)
        decision = seguridad.evaluar(c, s, ruta, d)
        alertas.revisar_horario(c, s, ruta)
        if decision == "aprobacion":
            return seguridad.crear_solicitud(c, s, ruta, d)
        res = ejecutar(c, s["nombre"], ruta, d)
        alertas.accion_de_dueno(c, s, ruta, d)
        return res


# La interfaz compilada (frontend/dist) se sirve al final para que /api tenga prioridad.
DIST = os.path.join(sys._MEIPASS, "web") if getattr(sys, "frozen", False) else os.path.join(AQUI, "..", "frontend", "dist")
if os.path.isdir(DIST):
    app.mount("/", StaticFiles(directory=DIST, html=True), name="web")
