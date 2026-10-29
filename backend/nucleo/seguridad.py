# -*- coding: utf-8 -*-
"""Seguridad: usuarios y roles, sesiones, reglas de aprobación de los dueños, solicitudes e integridad."""
import datetime as dt
import hashlib
import hmac
import json
import logging
import secrets
import threading
import time

from .base import ZONA, ErrorNegocio, ahora, bitacora, config, num, verificar_cadena

ROLES = {"DUENO": "Dueño", "OPERADOR": "Asistente", "CONSULTA": "Consulta"}
ABSOLUTA_H = 12
REFRESCO_S = 30       # la huella de actividad se escribe como máximo cada 30 s: no hay una escritura por petición
# shortcut: códigos y fallos por IP viven en memoria del proceso (las sesiones sí están en la base); con varias instancias o reinicios, llevarlos a la base
RETOS = {}
CODIGO_MIN = 5
FALLOS_IP = {}
_LOCK = threading.Lock()
IP_MAX_FALLOS, IP_VENTANA_S = 10, 600

# Qué puede hacer un operador sin pedir permiso. Todo lo que mueve o corrige dinero pasa por aprobación.
LIBRE_OPERADOR = {
    "/api/venta/separar", "/api/venta/vender", "/api/pago", "/api/comision/asignar", "/api/comisionista/guardar",
    "/api/cobranza/gestion", "/api/cobranza/enviar", "/api/prospecto/guardar", "/api/prospecto/nota",
    "/api/prospecto/estado", "/api/adjunto/subir", "/api/cotizacion", "/api/conciliacion/analizar", "/api/conciliacion/xlsx",
    "/api/conciliacion/confirmar", "/api/venta/escriturar", "/api/respaldo",
}
REQUIERE_APROBACION = {
    "/api/lote/precio", "/api/precios/masivo", "/api/venta/editar", "/api/venta/desistir", "/api/venta/reestructurar",
    "/api/pago/anular", "/api/comision/editar", "/api/comision/anular", "/api/comision/pagar",
    "/api/comision/pago/anular", "/api/comisionista/estado", "/api/gasto", "/api/gasto/anular", "/api/presupuesto",
    "/api/adjunto/eliminar", "/api/config",
}
SOLO_DUENO = {"/api/usuarios/guardar", "/api/usuarios/clave", "/api/usuarios/estado", "/api/solicitud/resolver",
              "/api/config/secreta", "/api/integridad/aceptar"}
SIEMPRE = {"/api/sesion/salir", "/api/sesion/clave", "/api/sesion/vincular", "/api/solicitud/cancelar"}


# ---------------------------------------------------------------- claves y usuarios
def _hash(clave, sal):
    return hashlib.pbkdf2_hmac("sha256", clave.encode("utf-8"), bytes.fromhex(sal), 240_000).hex()


def validar_clave(clave):
    if len(clave or "") < 10 or clave.isdigit():
        raise ErrorNegocio("La clave debe tener al menos 10 caracteres y no ser solo números.")


def hay_usuarios(c):
    return c.execute("SELECT COUNT(*) FROM usuarios").fetchone()[0] > 0


def publico(u):
    return {k: u[k] for k in ("id", "nombre", "usuario", "rol", "activo", "email", "telefono", "ultimo_acceso", "creado")} | \
        {"telegram_vinculado": bool(u["telegram_chat_id"]), "rol_nombre": ROLES.get(u["rol"], u["rol"])}


def guardar_usuario(c, autor, d):
    nombre, usuario = (d.get("nombre") or "").strip(), (d.get("usuario") or "").strip().lower()
    rol = d.get("rol") if d.get("rol") in ROLES else "OPERADOR"
    if not nombre or not usuario:
        raise ErrorNegocio("Nombre y usuario son obligatorios.")
    if " " in usuario:
        raise ErrorNegocio("El usuario no puede tener espacios.")
    otro = c.execute("SELECT id FROM usuarios WHERE usuario=? AND id<>?", (usuario, int(d.get("id") or 0))).fetchone()
    if otro:
        raise ErrorNegocio("Ese nombre de usuario ya existe.")
    if d.get("id"):
        uid = int(d["id"])
        actual = c.execute("SELECT * FROM usuarios WHERE id=?", (uid,)).fetchone()
        if actual["rol"] == "DUENO" and rol != "DUENO" and \
                c.execute("SELECT COUNT(*) FROM usuarios WHERE rol='DUENO' AND activo=1").fetchone()[0] <= 1:
            raise ErrorNegocio("Debe quedar al menos un dueño activo.")
        c.execute("UPDATE usuarios SET nombre=?, usuario=?, rol=?, email=?, telefono=? WHERE id=?",
                  (nombre, usuario, rol, (d.get("email") or "").strip(), (d.get("telefono") or "").strip(), uid))
        bitacora(c, autor, "USUARIO_EDITADO", None, {"usuario_id": uid, "usuario": usuario, "rol": rol})
        return {"ok": True, "id": uid}
    validar_clave(d.get("clave"))
    sal = secrets.token_hex(16)
    uid = c.execute("INSERT INTO usuarios (nombre, usuario, clave_hash, sal, rol, email, telefono, codigo_vinculo, creado) "
                    "VALUES (?,?,?,?,?,?,?,?,?)", (nombre, usuario, _hash(d["clave"], sal), sal, rol,
                                                   (d.get("email") or "").strip(), (d.get("telefono") or "").strip(),
                                                   secrets.token_hex(3).upper(), ahora())).lastrowid
    bitacora(c, autor, "USUARIO_NUEVO", None, {"usuario_id": uid, "usuario": usuario, "rol": rol})
    return {"ok": True, "id": uid}


def cambiar_clave(c, uid, clave):
    validar_clave(clave)
    sal = secrets.token_hex(16)
    c.execute("UPDATE usuarios SET clave_hash=?, sal=?, intentos_fallidos=0, bloqueado_hasta=NULL WHERE id=?",
              (_hash(clave, sal), sal, uid))


# ---------------------------------------------------------------- sesiones
def _huella(tok):
    return hashlib.sha256(tok.encode()).hexdigest()       # en la base solo queda la huella: copiar la tabla no da sesiones válidas


def _nueva_sesion(c, u, ttl_min=None, interna=False):
    tok, t = secrets.token_urlsafe(32), time.time()
    c.execute("DELETE FROM sesiones WHERE ultimo < ?", (t - ABSOLUTA_H * 3600,))      # limpia las vencidas de paso
    c.execute("INSERT INTO sesiones (tok, usuario_id, nombre, usuario, rol, inicio, ultimo, interna, ttl) VALUES (?,?,?,?,?,?,?,?,?)",
              (_huella(tok), u["id"], u["nombre"], u["usuario"], u["rol"], t, t, 1 if interna else 0, ttl_min * 60 if ttl_min else None))
    return tok


def _fallo_ip(ip):
    with _LOCK:
        FALLOS_IP.setdefault(ip, []).append(time.time())


def iniciar_sesion(c, usuario, clave, ip=""):
    """El retraso ante un fallo lo aplica quien llama, fuera del candado y de la transacción."""
    from . import alertas
    with _LOCK:
        recientes = FALLOS_IP[ip] = [t for t in FALLOS_IP.get(ip, []) if time.time() - t < IP_VENTANA_S]
    if len(recientes) >= IP_MAX_FALLOS:
        raise ErrorNegocio("Demasiados intentos desde este equipo. Espere unos minutos.")
    u = c.execute("SELECT * FROM usuarios WHERE usuario=?", ((usuario or "").strip().lower(),)).fetchone()
    if not u or not u["activo"]:
        _fallo_ip(ip)
        raise ErrorNegocio("Usuario o clave incorrectos.")
    if u["bloqueado_hasta"] and u["bloqueado_hasta"] > ahora():
        raise ErrorNegocio(f"Usuario bloqueado por intentos fallidos hasta las {u['bloqueado_hasta'][11:16]}.")
    if not hmac.compare_digest(_hash(clave or "", u["sal"]), u["clave_hash"]):
        n = (u["intentos_fallidos"] or 0) + 1
        bloqueo = (dt.datetime.now(ZONA) + dt.timedelta(minutes=15)).strftime("%Y-%m-%d %H:%M:%S") if n >= 5 else None
        c.execute("UPDATE usuarios SET intentos_fallidos=?, bloqueado_hasta=? WHERE id=?", (0 if bloqueo else n, bloqueo, u["id"]))
        if n >= 3:
            alertas.alertar_duenos(c, "Intentos fallidos de ingreso",
                                   f"El usuario <b>{u['usuario']}</b> lleva {n} intentos fallidos de clave"
                                   f"{' y quedó bloqueado 15 minutos' if bloqueo else ''}. Equipo: {ip or 'local'}.")
        _fallo_ip(ip)
        raise ErrorNegocio("Usuario o clave incorrectos." + (" El usuario quedó bloqueado 15 minutos." if bloqueo else ""))
    c.execute("UPDATE usuarios SET intentos_fallidos=0, bloqueado_hasta=NULL WHERE id=?", (u["id"],))
    cfg = config(c)
    if u["rol"] == "DUENO" and u["email"] and cfg.get("smtp_usuario") and cfg.get("smtp_clave"):
        return None, _pedir_codigo(cfg, u)
    return _abrir(c, u, ip)


def _abrir(c, u, ip):
    c.execute("UPDATE usuarios SET ultimo_acceso=? WHERE id=?", (ahora(), u["id"]))
    bitacora(c, u["nombre"], "INGRESO", None, {"usuario_id": u["id"], "equipo": ip or "local"})
    return _nueva_sesion(c, u), publico(u)


def _pedir_codigo(cfg, u):
    """Segundo factor de los dueños: código de 6 dígitos por correo, 5 minutos y 3 intentos."""
    from . import alertas
    reto, codigo = secrets.token_urlsafe(16), f"{secrets.randbelow(10**6):06d}"
    with _LOCK:
        for k in [k for k, r in RETOS.items() if r["vence"] < time.time()]:
            RETOS.pop(k)
        RETOS[reto] = {"uid": u["id"], "codigo": codigo, "vence": time.time() + CODIGO_MIN * 60, "intentos": 0}
    cuerpo = f"Su código de ingreso es <b>{codigo}</b>. Vence en {CODIGO_MIN} minutos. Si no fue usted, cambie su clave."
    # hilo aparte: el SMTP tarda segundos y no debe retener el candado ni la transacción
    threading.Thread(target=lambda: _enviar_codigo(alertas, cfg, u["email"], cuerpo), daemon=True).start()
    a, d = u["email"].split("@", 1)
    return {"reto": reto, "correo": f"{a[:2]}***@{d}"}


def _enviar_codigo(alertas, cfg, destino, cuerpo):
    try:
        alertas._correo(cfg, destino, f"[{cfg.get('proyecto', 'Loteo')}] Código de ingreso", cuerpo, [])
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("No se pudo enviar el código de ingreso")


def verificar_codigo(c, reto, codigo, ip=""):
    with _LOCK:
        r = RETOS.get(reto)
        if r and (r["vence"] < time.time() or r["intentos"] >= 3):
            RETOS.pop(reto, None)
            r = None
        if r:
            r["intentos"] += 1
            ok = hmac.compare_digest(str(codigo or "").strip(), r["codigo"])
            if ok:
                RETOS.pop(reto, None)
    if not r or not ok:
        _fallo_ip(ip)
        raise ErrorNegocio("Código incorrecto o vencido. Vuelva a ingresar con su usuario y clave." if not r
                           else "Código incorrecto.")
    return _abrir(c, c.execute("SELECT * FROM usuarios WHERE id=?", (r["uid"],)).fetchone(), ip)


def token_interno(c):
    """Sesión de solo unos minutos para que el navegador sin ventana genere los PDF."""
    return _nueva_sesion(c, {"id": 0, "nombre": "Sistema", "usuario": "sistema", "rol": "DUENO"}, ttl_min=3, interna=True)


def validar(c, tok):
    if not tok:
        return None
    s = c.execute("SELECT * FROM sesiones WHERE tok=?", (_huella(tok),)).fetchone()
    if not s:
        return None
    minutos = num(config(c).get("sesion_minutos"), 45) if not s["ttl"] else 0
    ahora_ = time.time()
    limite = s["ttl"] or minutos * 60
    if ahora_ - s["ultimo"] > limite or ahora_ - s["inicio"] > ABSOLUTA_H * 3600:
        c.con.execute("DELETE FROM sesiones WHERE tok=%s", (s["tok"],))
        return None
    if ahora_ - s["ultimo"] > REFRESCO_S:       # escritura directa (fuera de transacción): no invalida la caché de lecturas
        c.con.execute("UPDATE sesiones SET ultimo=%s WHERE tok=%s", (ahora_, s["tok"]))
    return {**dict(s), "ultimo": ahora_, "token": tok, "interna": bool(s["interna"])}


def cerrar(c, tok):
    c.execute("DELETE FROM sesiones WHERE tok=?", (_huella(tok),))


def cerrar_de_usuario(c, uid):
    c.execute("DELETE FROM sesiones WHERE usuario_id=?", (uid,))


# ---------------------------------------------------------------- permisos y aprobaciones
def _pesos(v):
    return "$" + f"{round(v or 0):,}".replace(",", ".")


def evaluar(c, sesion, ruta, d):
    """Devuelve 'ok', 'aprobacion' o lanza ErrorNegocio si el rol no puede hacerlo."""
    rol = sesion["rol"]
    if ruta in SIEMPRE or rol == "DUENO":
        return "ok"
    if ruta in SOLO_DUENO or rol == "CONSULTA":
        raise ErrorNegocio("Su usuario no tiene permiso para esta operación.")
    if ruta in REQUIERE_APROBACION:
        return "aprobacion"
    if ruta in ("/api/venta/vender", "/api/venta/separar"):
        l = c.execute("SELECT precio_lista FROM lotes WHERE id_lote=?", (d.get("id_lote"),)).fetchone()
        lista = l["precio_lista"] if l else None
        valor = num(d.get("valor_venta"), 0) or lista
        if not lista:
            return "aprobacion"            # sin precio de lista el valor lo pone el operador: lo aprueba un dueño
        desc = 100 * (lista - (valor or 0)) / lista
        if desc > num(config(c).get("descuento_max_operador"), 0) + 1e-9:
            return "aprobacion"
        if d.get("comisionista_id"):
            cm = c.execute("SELECT porcentaje_defecto FROM comisionistas WHERE id=?", (int(d["comisionista_id"]),)).fetchone()
            if cm and d.get("comision_pct") not in (None, "") and abs(num(d["comision_pct"]) - cm[0]) > 1e-9:
                return "aprobacion"
        return "ok"
    if ruta == "/api/comision/asignar":
        cm = c.execute("SELECT porcentaje_defecto FROM comisionistas WHERE id=?", (int(d.get("comisionista_id") or 0),)).fetchone()
        if cm and d.get("porcentaje") not in (None, "") and abs(num(d["porcentaje"]) - cm[0]) > 1e-9:
            return "aprobacion"
        return "ok"
    if ruta == "/api/comisionista/guardar":
        return "aprobacion" if d.get("id") else "ok"   # cambiar datos (p. ej. la cuenta bancaria) lo aprueba un dueño
    if ruta == "/api/venta/escriturar":
        v = c.execute("SELECT valor_venta, (SELECT COALESCE(SUM(valor),0) FROM pagos WHERE venta_id=ventas.id AND anulado=0) p "
                      "FROM ventas WHERE id=?", (int(d.get("venta_id") or 0),)).fetchone()
        return "aprobacion" if v and (v[0] or 0) - v[1] > 0.5 else "ok"
    if ruta in LIBRE_OPERADOR:
        return "ok"
    raise ErrorNegocio("Operación no permitida para su usuario.")


def resumen_solicitud(c, ruta, d):
    """Texto claro para el dueño: qué se pide hacer, sobre qué y por cuánto."""
    lote = d.get("id_lote")
    v = None
    if d.get("venta_id"):
        v = c.execute("SELECT v.*, cl.nombre cliente FROM ventas v JOIN clientes cl ON cl.id=v.cliente_id WHERE v.id=?",
                      (int(d["venta_id"]),)).fetchone()
        lote = lote or (v["id_lote"] if v else None)
    if ruta == "/api/lote/precio":
        l = c.execute("SELECT precio_lista FROM lotes WHERE id_lote=?", (lote,)).fetchone()
        return f"Cambiar el precio del lote {lote}: {_pesos(l[0]) if l and l[0] else 'sin precio'} → " \
               f"{_pesos(num(d.get('precio_lista'))) if d.get('precio_lista') else 'sin precio'}" + \
               (" y BLOQUEARLO" if d.get("bloqueado") else ""), lote
    if ruta == "/api/precios/masivo":
        return (f"Asignar precios masivos ({'valor por m²' if d.get('modo') == 'm2' else 'precio fijo'} {_pesos(num(d.get('valor')))})"
                f" a {'la manzana ' + str(d['manzana']) if d.get('manzana') else 'todas las manzanas'}"), None
    if ruta in ("/api/venta/vender", "/api/venta/separar"):
        l = c.execute("SELECT precio_lista FROM lotes WHERE id_lote=?", (lote,)).fetchone()
        lista, valor = (l[0] if l else None), num(d.get("valor_venta"), 0)
        cli = (d.get("cliente") or {}).get("nombre", "")
        desc = f" · descuento {100 * (lista - valor) / lista:.1f} % sobre lista {_pesos(lista)}" if lista and valor and valor < lista \
            else (" · lote SIN precio de lista" if not lista else "")
        com = ""
        if d.get("comisionista_id"):
            cm = c.execute("SELECT nombre, porcentaje_defecto FROM comisionistas WHERE id=?", (int(d["comisionista_id"]),)).fetchone()
            if cm:
                com = f" · comisión {cm[0]} {num(d.get('comision_pct'), cm[1]):g} % (base {cm[1]:g} %)"
        verbo = "Vender" if ruta.endswith("vender") else "Separar"
        return f"{verbo} el lote {lote} a {cli} por {_pesos(valor or lista)}{desc}{com}", lote
    if ruta == "/api/venta/editar":
        campos = [k for k in d if k not in ("venta_id", "cliente", "id_lote")]
        extra = f" (valor {_pesos(v['valor_venta'])} → {_pesos(num(d['valor_venta']))})" if v and "valor_venta" in d and \
            round(num(d["valor_venta"])) != round(v["valor_venta"] or 0) else ""
        return f"Modificar el negocio del lote {lote} de {v['cliente'] if v else ''}: {', '.join(campos)}{extra}", lote
    if ruta == "/api/venta/desistir":
        return f"Desistimiento del lote {lote} ({v['cliente'] if v else ''}). Motivo: {d.get('motivo', '')}", lote
    if ruta == "/api/venta/escriturar":
        return f"Escriturar el lote {lote} de {v['cliente'] if v else ''} CON SALDO PENDIENTE", lote
    if ruta == "/api/venta/reestructurar":
        modo = {"plazo": "reducir el plazo", "cuota": "reducir la cuota"}.get(d.get("modo"), f"{d.get('n_cuotas')} cuotas")
        return f"Reestructurar el plan del lote {lote} ({v['cliente'] if v else ''}): {modo}. Motivo: {d.get('motivo') or 'abono a capital'}", lote
    if ruta == "/api/pago/anular":
        p = c.execute("SELECT * FROM pagos WHERE id=?", (int(d.get("pago_id") or 0),)).fetchone()
        return (f"Anular el recibo N° {p['recibo']:06d} del lote {p['id_lote']} por {_pesos(p['valor'])}. "
                f"Motivo: {d.get('motivo', '')}"), (p["id_lote"] if p else None)
    if ruta == "/api/comision/pagar":
        cm = c.execute("SELECT nombre FROM comisionistas WHERE id=?", (int(d.get("comisionista_id") or 0),)).fetchone()
        total = sum(num(i.get("valor")) for i in d.get("items", []))
        return f"Pagar comisiones a {cm[0] if cm else ''} por {_pesos(total)} (bruto, antes de retención)", None
    if ruta in ("/api/comision/editar", "/api/comision/anular"):
        co = c.execute("SELECT co.*, cm.nombre, v.id_lote FROM comisiones co JOIN comisionistas cm ON cm.id=co.comisionista_id "
                       "JOIN ventas v ON v.id=co.venta_id WHERE co.id=?", (int(d.get("id") or 0),)).fetchone()
        if ruta.endswith("editar"):
            return f"Cambiar la comisión de {co['nombre']} en el lote {co['id_lote']}: {co['porcentaje']:g} % → {num(d.get('porcentaje')):g} %", co["id_lote"]
        return f"Quitar la comisión de {co['nombre']} en el lote {co['id_lote']}. Motivo: {d.get('motivo', '')}", co["id_lote"]
    if ruta == "/api/comision/asignar":
        cm = c.execute("SELECT nombre, porcentaje_defecto FROM comisionistas WHERE id=?", (int(d.get("comisionista_id") or 0),)).fetchone()
        return f"Asignar comisión a {cm[0]} del {num(d.get('porcentaje')):g} % (su base es {cm[1]:g} %) en el lote {lote}", lote
    if ruta == "/api/comision/pago/anular":
        p = c.execute("SELECT * FROM pagos_comision WHERE id=?", (int(d.get("pago_id") or 0),)).fetchone()
        return f"Anular el comprobante CE {p['comprobante']:06d} por {_pesos(p['valor_neto'])}. Motivo: {d.get('motivo', '')}", None
    if ruta == "/api/comisionista/guardar":
        cm = c.execute("SELECT * FROM comisionistas WHERE id=?", (int(d["id"]),)).fetchone()
        cambios = [k for k in ("nombre", "documento", "porcentaje_defecto", "retencion_pct", "banco", "tipo_cuenta",
                               "numero_cuenta", "titular_cuenta") if str(d.get(k, "")).strip() != str(cm[k] or "").strip()
                   and not (k in ("porcentaje_defecto", "retencion_pct") and num(d.get(k)) == (cm[k] or 0))]
        alerta = " ⚠️ INCLUYE CAMBIO DE CUENTA BANCARIA" if any(k in cambios for k in ("banco", "numero_cuenta", "titular_cuenta")) else ""
        return f"Modificar datos del comisionista {cm['nombre']}: {', '.join(cambios) or 'datos de contacto'}{alerta}", None
    if ruta == "/api/comisionista/estado":
        cm = c.execute("SELECT nombre FROM comisionistas WHERE id=?", (int(d["id"]),)).fetchone()
        return f"{'Activar' if d.get('estado') == 'ACTIVO' else 'Desactivar'} al comisionista {cm[0]}", None
    if ruta == "/api/gasto":
        return f"Registrar gasto de {_pesos(num(d.get('valor_bruto')))} · {d.get('categoria', '')} · {d.get('proveedor', '')}: {d.get('descripcion', '')}", None
    if ruta == "/api/gasto/anular":
        g = c.execute("SELECT * FROM gastos WHERE id=?", (int(d.get("id") or 0),)).fetchone()
        return f"Anular el gasto CE {g['comprobante']:06d} por {_pesos(g['valor_bruto'])} ({g['proveedor']}). Motivo: {d.get('motivo', '')}", None
    if ruta == "/api/presupuesto":
        return "Modificar el presupuesto de gastos del proyecto", None
    if ruta == "/api/adjunto/eliminar":
        a = c.execute("SELECT * FROM adjuntos WHERE id=?", (int(d.get("id") or 0),)).fetchone()
        return f"Eliminar el documento «{a['nombre']}» ({a['tipo']}) del lote {a['id_lote']}. Motivo: {d.get('motivo', '')}", a["id_lote"]
    if ruta == "/api/config":
        return f"Cambiar la configuración: {', '.join(sorted(d))}", None
    return f"Operación {ruta}", lote


def crear_solicitud(c, sesion, ruta, d):
    from . import alertas
    resumen, lote = resumen_solicitud(c, ruta, d)
    pend = c.execute("SELECT id FROM solicitudes WHERE estado='PENDIENTE' AND ruta=? AND datos=?",
                     (ruta, json.dumps(d, ensure_ascii=False, sort_keys=True))).fetchone()
    if pend:
        return {"pendiente": True, "solicitud": pend[0], "mensaje": "Ya existe una solicitud igual esperando aprobación."}
    sid = c.execute("INSERT INTO solicitudes (ruta, datos, resumen, id_lote, solicitante_id, solicitante, creado) "
                    "VALUES (?,?,?,?,?,?,?)", (ruta, json.dumps(d, ensure_ascii=False, sort_keys=True), resumen, lote,
                                               sesion["usuario_id"], sesion["nombre"], ahora())).lastrowid
    bitacora(c, sesion["nombre"], "SOLICITUD", lote, {"solicitud_id": sid, "ruta": ruta, "resumen": resumen})
    alertas.alertar_solicitud(c, sid, sesion["nombre"], resumen)
    return {"pendiente": True, "solicitud": sid, "mensaje": "La operación quedó pendiente de aprobación de un dueño."}


def firma_solicitud(c, sid, accion):
    clave = config(c)["clave_interna"].encode()
    return hmac.new(clave, f"{sid}:{accion}".encode(), "sha256").hexdigest()[:16]


def resolver_solicitud(c, dueno, sid, aprobar, motivo, ejecutar):
    s = c.execute("SELECT * FROM solicitudes WHERE id=?", (sid,)).fetchone()
    if not s:
        raise ErrorNegocio("La solicitud no existe.")
    if s["estado"] != "PENDIENTE":
        raise ErrorNegocio(f"La solicitud ya fue {s['estado'].lower()} por {s['resuelto_por'] or ''}.")
    if not aprobar:
        c.execute("UPDATE solicitudes SET estado='RECHAZADA', resuelto_por=?, resuelto_en=?, motivo_rechazo=? WHERE id=?",
                  (dueno, ahora(), motivo or "", sid))
        bitacora(c, dueno, "SOLICITUD_RECHAZADA", s["id_lote"], {"solicitud_id": sid, "resumen": s["resumen"], "motivo": motivo})
        return {"ok": True, "estado": "RECHAZADA"}
    try:
        res = ejecutar(c, f"{s['solicitante']} · aprobado por {dueno}", s["ruta"], json.loads(s["datos"]))
        estado, txt = "APROBADA", json.dumps(res, ensure_ascii=False, default=str)
    except ErrorNegocio as e:
        estado, txt = "FALLIDA", str(e)
    c.execute("UPDATE solicitudes SET estado=?, resuelto_por=?, resuelto_en=?, resultado=? WHERE id=?",
              (estado, dueno, ahora(), txt, sid))
    bitacora(c, dueno, "SOLICITUD_APROBADA" if estado == "APROBADA" else "SOLICITUD_FALLIDA", s["id_lote"],
             {"solicitud_id": sid, "resumen": s["resumen"], "resultado": txt[:300]})
    return {"ok": estado == "APROBADA", "estado": estado, "resultado": txt}


# ---------------------------------------------------------------- integridad
def verificar_integridad(c):
    """Cruza los registros con la bitácora sellada: detecta cambios hechos por fuera del sistema."""
    problemas = []
    rotos = verificar_cadena(c)
    if rotos:
        problemas.append(f"La bitácora fue alterada en {len(rotos)} registro(s) (desde el N° {rotos[0]}).")
    pag, anul = {}, set()
    egresos_com, gastos_b, gastos_anul, ventas_val = {}, {}, set(), {}
    for b in c.execute("SELECT accion, detalle FROM bitacora WHERE accion IN ('PAGO','ANULAR_PAGO','COMISION_PAGO',"
                       "'GASTO','GASTO_ANULADO','VENTA','EDITAR_VENTA','SEPARACION') ORDER BY id"):
        try:
            x = json.loads(b["detalle"] or "{}")
        except ValueError:
            continue
        a = b["accion"]
        if a == "PAGO":
            pag[x.get("recibo")] = x
        elif a == "ANULAR_PAGO":
            anul.add(x.get("recibo"))
        elif a == "COMISION_PAGO":
            egresos_com[x.get("comprobante")] = x
        elif a == "GASTO":
            gastos_b[x.get("comprobante")] = x
        elif a == "GASTO_ANULADO":
            gastos_anul.add(x.get("comprobante"))
        elif a in ("VENTA", "SEPARACION") and x.get("valor_venta") is not None:
            ventas_val[x.get("venta_id")] = x["valor_venta"]
        elif a == "EDITAR_VENTA" and "valor_venta" in (x.get("despues") or {}):
            ventas_val[x.get("venta_id")] = x["despues"]["valor_venta"]
    for p in c.execute("SELECT * FROM pagos ORDER BY recibo"):
        b = pag.get(p["recibo"])
        if not b:
            problemas.append(f"El recibo N° {p['recibo']:06d} ({p['id_lote']}) no aparece en la bitácora: pudo crearse por fuera del sistema.")
            continue
        if round(num(b.get("valor"))) != round(p["valor"]) or (b.get("fecha") and b["fecha"] != p["fecha"]):
            problemas.append(f"El recibo N° {p['recibo']:06d} ({p['id_lote']}) fue modificado por fuera del sistema: "
                             f"registrado {_pesos(num(b.get('valor')))} el {b.get('fecha')}, hoy dice {_pesos(p['valor'])} el {p['fecha']}.")
        if p["anulado"] and p["recibo"] not in anul:
            problemas.append(f"El recibo N° {p['recibo']:06d} aparece anulado sin registro de anulación.")
        if not p["anulado"] and p["recibo"] in anul:
            problemas.append(f"El recibo N° {p['recibo']:06d} fue anulado y volvió a quedar activo por fuera del sistema.")
    for p in c.execute("SELECT * FROM pagos_comision"):
        b = egresos_com.get(p["comprobante"])
        if not b or round(num(b.get("bruto"))) != round(p["valor_bruto"]) or round(num(b.get("neto"))) != round(p["valor_neto"]):
            problemas.append(f"El comprobante de comisiones CE {p['comprobante']:06d} no coincide con lo registrado en la bitácora.")
    for g in c.execute("SELECT * FROM gastos"):
        b = gastos_b.get(g["comprobante"])
        if not b or round(num(b.get("valor_bruto"))) != round(g["valor_bruto"]):
            problemas.append(f"El gasto CE {g['comprobante']:06d} no coincide con lo registrado en la bitácora.")
        elif g["anulado"] and g["comprobante"] not in gastos_anul:
            problemas.append(f"El gasto CE {g['comprobante']:06d} aparece anulado sin registro de anulación.")
    for v in c.execute("SELECT id, id_lote, valor_venta FROM ventas"):
        if v["id"] in ventas_val and round(num(ventas_val[v["id"]])) != round(v["valor_venta"] or 0):
            problemas.append(f"El valor de la venta del lote {v['id_lote']} fue cambiado por fuera del sistema: "
                             f"registrado {_pesos(num(ventas_val[v['id']]))}, hoy dice {_pesos(v['valor_venta'])}.")
    return {"ok": not problemas, "problemas": problemas, "revisado": ahora(),
            "registros": c.execute("SELECT COUNT(*) FROM bitacora").fetchone()[0]}


def acciones(c, sesion, ruta, d):
    """Rutas POST de administración de usuarios y de la propia sesión."""
    autor = sesion["nombre"]
    if ruta == "/api/usuarios/guardar":
        return guardar_usuario(c, autor, d)
    if ruta == "/api/usuarios/clave":
        cambiar_clave(c, int(d["id"]), d.get("clave"))
        cerrar_de_usuario(c, int(d["id"]))
        bitacora(c, autor, "USUARIO_CLAVE", None, {"usuario_id": int(d["id"])})
        return {"ok": True}
    if ruta == "/api/usuarios/estado":
        uid, activo = int(d["id"]), 1 if d.get("activo") else 0
        if not activo and uid == sesion["usuario_id"]:
            raise ErrorNegocio("No puede desactivar su propio usuario.")
        u = c.execute("SELECT rol FROM usuarios WHERE id=?", (uid,)).fetchone()
        if not activo and u["rol"] == "DUENO" and \
                c.execute("SELECT COUNT(*) FROM usuarios WHERE rol='DUENO' AND activo=1").fetchone()[0] <= 1:
            raise ErrorNegocio("Debe quedar al menos un dueño activo.")
        c.execute("UPDATE usuarios SET activo=? WHERE id=?", (activo, uid))
        if not activo:
            cerrar_de_usuario(c, uid)
        bitacora(c, autor, "USUARIO_ESTADO", None, {"usuario_id": uid, "activo": activo})
        return {"ok": True}
    if ruta == "/api/sesion/clave":
        u = c.execute("SELECT * FROM usuarios WHERE id=?", (sesion["usuario_id"],)).fetchone()
        if not hmac.compare_digest(_hash(d.get("actual") or "", u["sal"]), u["clave_hash"]):
            raise ErrorNegocio("La clave actual no es correcta.")
        cambiar_clave(c, u["id"], d.get("nueva"))
        c.execute("DELETE FROM sesiones WHERE usuario_id=? AND tok<>?", (u["id"], _huella(sesion["token"])))   # cierra las demás, conserva esta
        bitacora(c, autor, "CAMBIO_CLAVE", None, {"usuario_id": u["id"]})
        return {"ok": True}
    if ruta == "/api/sesion/vincular":
        codigo = secrets.token_hex(3).upper()
        c.execute("UPDATE usuarios SET codigo_vinculo=? WHERE id=?", (codigo, sesion["usuario_id"]))
        return {"ok": True, "codigo": codigo}
    if ruta == "/api/solicitud/cancelar":
        s = c.execute("SELECT * FROM solicitudes WHERE id=?", (int(d["id"]),)).fetchone()
        if not s or s["estado"] != "PENDIENTE" or (s["solicitante_id"] != sesion["usuario_id"] and sesion["rol"] != "DUENO"):
            raise ErrorNegocio("No se puede cancelar esta solicitud.")
        c.execute("UPDATE solicitudes SET estado='CANCELADA', resuelto_por=?, resuelto_en=? WHERE id=?", (autor, ahora(), s["id"]))
        bitacora(c, autor, "SOLICITUD_CANCELADA", s["id_lote"], {"solicitud_id": s["id"], "resumen": s["resumen"]})
        return {"ok": True}
    return None
