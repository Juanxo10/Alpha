# -*- coding: utf-8 -*-
"""Alertas a los dueños (Telegram, correo y avisos internos), recordatorios a compradores, resumen diario,
tareas programadas."""
import datetime as dt
import hashlib
import html
import json
import mimetypes
import os
import smtplib
import threading
import time
import urllib.parse
import urllib.request
from email.message import EmailMessage

from . import base, tenant
from .base import ahora, config, hoy, marca_hecha, marcar, num

# Alertas externas (Telegram y correo) desactivadas temporalmente por decisión de los dueños.
# Para reactivarlas: True aquí y ALERTAS_ACTIVAS = true en geovisor/js/seguridad.js.
ACTIVAS = False
EJECUTOR = None          # servir.py registra aquí la función que ejecuta una operación aprobada
_parar = threading.Event()


def _pesos(v):
    return "$" + f"{round(v or 0):,}".replace(",", ".")


def duenos(c):
    return c.execute("SELECT * FROM usuarios WHERE rol='DUENO' AND activo=1").fetchall()


def encolar(c, canal, destino, asunto, texto, extra=None):
    c.execute("INSERT INTO notificaciones (canal, destino, asunto, texto, extra, estado, creado) VALUES (?,?,?,?,?,?,?)",
              (canal, str(destino), asunto, texto, json.dumps(extra or {}, ensure_ascii=False),
               "NO_LEIDA" if canal == "app" else "PENDIENTE", ahora()))


def _canales(c):
    if not ACTIVAS:
        return False, False
    cfg = config(c)
    return bool(cfg.get("telegram_token")), bool(cfg.get("smtp_usuario") and cfg.get("smtp_clave"))


def alertar_duenos(c, titulo, texto, botones=None, excluir_id=None, adjuntos=None):
    """Aviso a todos los dueños activos: dentro del geovisor siempre, y por Telegram/correo si están configurados."""
    tg, mail = _canales(c)
    proyecto = config(c).get("proyecto", "Loteo")
    for u in duenos(c):
        if excluir_id and u["id"] == excluir_id:
            continue
        encolar(c, "app", u["id"], titulo, texto)
        if tg and u["telegram_chat_id"]:
            encolar(c, "telegram", u["telegram_chat_id"], titulo, f"🔔 <b>{html.escape(titulo)}</b>\n{texto}",
                    {"botones": botones} if botones else None)
        if mail and u["email"]:
            encolar(c, "email", u["email"], f"[{proyecto}] {titulo}", texto, {"adjuntos": adjuntos or []})


def alertar_solicitud(c, sid, solicitante, resumen):
    from .seguridad import firma_solicitud
    botones = [[{"text": "✅ Aprobar", "callback_data": f"S:{sid}:A:{firma_solicitud(c, sid, 'A')}"},
                {"text": "❌ Rechazar", "callback_data": f"S:{sid}:R:{firma_solicitud(c, sid, 'R')}"}]]
    alertar_duenos(c, f"Solicitud de aprobación N° {sid}",
                   f"<b>{html.escape(solicitante)}</b> solicita:\n{html.escape(resumen)}\n\n"
                   f"Apruébela o recházela aquí o en el geovisor (Administración → Aprobaciones).", botones)


def notificar_usuario(c, uid, titulo, texto):
    encolar(c, "app", uid, titulo, texto)


# ---------------------------------------------------------------- disparadores
def al_registrar_pago(c, usuario, v, recibo, valor, fecha_, medio):
    cfg = config(c)
    umbral = num(cfg.get("umbral_efectivo"), 0)
    if medio == "Efectivo" and umbral and valor >= umbral:
        alertar_duenos(c, "Pago en efectivo alto",
                       f"Recibo N° {recibo:06d} · lote {v['id_lote']} · <b>{_pesos(valor)}</b> en efectivo, "
                       f"registrado por {html.escape(usuario)}. Verifique que el dinero entre a caja.")
    if cfg.get("confirmacion_pago_email") == "1" and _canales(c)[1]:
        cl = c.execute("SELECT nombre, email FROM clientes WHERE id=?", (v["cliente_id"],)).fetchone()
        if cl and cl["email"]:
            pagado = c.execute("SELECT COALESCE(SUM(valor),0) FROM pagos WHERE venta_id=? AND anulado=0", (v["id"],)).fetchone()[0]
            saldo = max((v["valor_venta"] or 0) - pagado, 0)
            encolar(c, "email", cl["email"], f"Confirmación de pago · Recibo N° {recibo:06d}",
                    f"Estimado(a) {html.escape(cl['nombre'])}:<br><br>Registramos su pago de <b>{_pesos(valor)}</b> "
                    f"del {fecha_} ({html.escape(medio)}) para el lote <b>{v['id_lote']}</b> del proyecto "
                    f"{html.escape(cfg.get('proyecto', ''))}, con el recibo de caja N° {recibo:06d}.<br>"
                    f"Saldo pendiente a la fecha: <b>{_pesos(saldo)}</b>.<br><br>Gracias por su pago."
                    + _firma(cfg))


def revisar_horario(c, sesion, ruta):
    """Avisa a los dueños si un operador registra operaciones fuera del horario laboral (una vez por hora)."""
    if sesion["rol"] != "OPERADOR":
        return
    cfg = config(c)
    h = dt.datetime.now().strftime("%H:%M")
    fuera = h < (cfg.get("horario_inicio") or "00:00") or h > (cfg.get("horario_fin") or "23:59") or dt.date.today().weekday() == 6
    clave = f"horario:{sesion['usuario_id']}:{dt.datetime.now():%Y%m%d%H}"
    if fuera and not marca_hecha(c, clave):
        marcar(c, clave)
        alertar_duenos(c, "Operación fuera de horario",
                       f"{html.escape(sesion['nombre'])} está registrando operaciones a las {h}"
                       f"{' (domingo)' if dt.date.today().weekday() == 6 else ''}: {html.escape(ruta)}.")


CRITICAS_DUENO = {"/api/pago/anular", "/api/venta/desistir", "/api/precios/masivo", "/api/comision/pagar",
                  "/api/gasto", "/api/gasto/anular", "/api/venta/editar", "/api/lote/precio"}


def accion_de_dueno(c, sesion, ruta, d):
    if sesion["rol"] == "DUENO" and ruta in CRITICAS_DUENO and config(c).get("alertas_acciones_duenos") == "1" \
            and len(duenos(c)) > 1:
        from .seguridad import resumen_solicitud
        try:
            resumen = resumen_solicitud(c, ruta, d)[0]
        except Exception:  # noqa: BLE001
            resumen = ruta
        alertar_duenos(c, "Operación de un dueño", f"{html.escape(sesion['nombre'])} realizó: {html.escape(resumen)}",
                       excluir_id=sesion["usuario_id"])


def _firma(cfg):
    partes = [cfg.get("vendedor_razon_social") or cfg.get("proyecto"), cfg.get("vendedor_telefono"), cfg.get("vendedor_email")]
    return "<br><br>—<br>" + "<br>".join(html.escape(p) for p in partes if p)


# ---------------------------------------------------------------- resumen diario
def resumen_dia(c, dia=None):
    from . import cartera, seguridad
    dia = dia or hoy().isoformat()
    pagos = c.execute("SELECT * FROM pagos WHERE fecha=? AND anulado=0 ORDER BY recibo", (dia,)).fetchall()
    por_medio = {}
    for p in pagos:
        por_medio[p["medio"]] = por_medio.get(p["medio"], 0) + p["valor"]
    bit = c.execute("SELECT accion, usuario, id_lote, detalle FROM bitacora WHERE substr(fecha,1,10)=?", (dia,)).fetchall()
    cuenta = lambda a: sum(1 for b in bit if b["accion"] == a)  # noqa: E731
    gastos = c.execute("SELECT COALESCE(SUM(valor_bruto),0) FROM gastos WHERE fecha=? AND anulado=0", (dia,)).fetchone()[0]
    comis = c.execute("SELECT COALESCE(SUM(valor_neto),0) FROM pagos_comision WHERE fecha=? AND anulado=0", (dia,)).fetchone()[0]
    pend = c.execute("SELECT COUNT(*) FROM solicitudes WHERE estado='PENDIENTE'").fetchone()[0]
    gracia, _ = cartera.parametros_mora(c)
    nuevas_mora = [v for v in cartera.ventas_activas_con_estado(c)
                   if any(it.get("dias_vencida") == gracia + 1 for it in v["plan"])]
    integ = seguridad.verificar_integridad(c)
    lineas = [f"<b>Resumen del {dia}</b>", "",
              f"💵 Recaudo del día: <b>{_pesos(sum(p['valor'] for p in pagos))}</b> en {len(pagos)} recibo(s)"]
    for m, v in sorted(por_medio.items()):
        lineas.append(f"   · {html.escape(m)}: {_pesos(v)}")
    if pagos:
        lineas.append(f"   Recibos N° {pagos[0]['recibo']:06d} al {pagos[-1]['recibo']:06d}")
    lineas += [f"📝 Ventas: {cuenta('VENTA')} · separaciones: {cuenta('SEPARACION')} · desistimientos: {cuenta('DESISTIMIENTO')}",
               f"🚫 Recibos anulados: {cuenta('ANULAR_PAGO')}",
               f"📤 Gastos: {_pesos(gastos)} · comisiones pagadas: {_pesos(comis)}",
               f"⏳ Solicitudes pendientes de aprobación: {pend}",
               f"⚠️ Lotes que entraron en mora hoy: {len(nuevas_mora)}"
               + (" (" + ", ".join(v["id_lote"] for v in nuevas_mora[:8]) + ")" if nuevas_mora else ""),
               "🔒 Integridad: " + ("sin novedades" if integ["ok"] else f"<b>{len(integ['problemas'])} PROBLEMA(S)</b> — revise Administración → Auditoría")]
    return "\n".join(lineas), integ


def enviar_resumen(c, dia=None):
    texto, _ = resumen_dia(c, dia)
    alertar_duenos(c, f"Resumen diario · {config(c).get('proyecto', '')}", texto)


# ---------------------------------------------------------------- recordatorios a compradores
def generar_recordatorios(c, forzar=False):
    from . import cartera
    cfg = config(c)
    if not forzar and cfg.get("recordatorios_activos") != "1":
        return 0
    if not _canales(c)[1]:
        return 0
    antes = int(num(cfg.get("recordatorio_dias_antes"), 3))
    moras = {int(x) for x in str(cfg.get("recordatorio_mora_dias") or "").replace(" ", "").split(",") if x.isdigit()}
    hoy_ = hoy()
    n = 0
    for v in cartera.ventas_activas_con_estado(c):
        if not v.get("email") or v["etapa"] == "SEPARADO":
            continue
        for it in v["plan"]:
            if it["pendiente"] <= 0.5:
                continue
            f = dt.date.fromisoformat(it["fecha"])
            tipo = None
            if (f - hoy_).days == antes:
                tipo = "previo"
            elif it.get("dias_vencida") in moras:
                tipo = f"mora{it['dias_vencida']}"
            if not tipo:
                continue
            clave = f"rec:{v['id']}:{it['n']}:{tipo}:{it['fecha']}"
            if marca_hecha(c, clave):
                continue
            marcar(c, clave)
            cuerpo = (f"Estimado(a) {html.escape(v['cliente'])}:<br><br>"
                      + (f"Le recordamos que el <b>{f:%d/%m/%Y}</b> vence su {html.escape(it['concepto'].lower())} "
                         f"por <b>{_pesos(it['pendiente'])}</b> del lote <b>{v['id_lote']}</b>."
                         if tipo == "previo" else
                         f"Su {html.escape(it['concepto'].lower())} del lote <b>{v['id_lote']}</b>, que vencía el "
                         f"{f:%d/%m/%Y}, presenta <b>{it['dias_vencida']} días de atraso</b>. Valor pendiente: "
                         f"<b>{_pesos(it['pendiente'])}</b>. Saldo vencido total: <b>{_pesos(v['vencido'])}</b>.")
                      + (f"<br><br>Puede pagar en: <b>{html.escape(cfg['cuenta_bancaria'])}</b>" if cfg.get("cuenta_bancaria") else "")
                      + "<br>Si ya realizó el pago, por favor envíenos el comprobante." + _firma(cfg))
            asunto = ("Recordatorio de pago" if tipo == "previo" else "Aviso de pago vencido") + f" · Lote {v['id_lote']}"
            encolar(c, "email", v["email"], asunto, cuerpo)
            base.bitacora(c, "Sistema", "RECORDATORIO", v["id_lote"], {"venta_id": v["id"], "tipo": tipo, "cuota": it["n"],
                                                                       "email": v["email"]})
            n += 1
    return n


# ---------------------------------------------------------------- envío
def _telegram(token, metodo, datos):
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/{metodo}",
                                 data=json.dumps(datos).encode("utf-8"), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        res = json.loads(r.read().decode("utf-8"))
    if not res.get("ok"):
        raise RuntimeError(res.get("description", "error de Telegram"))
    return res.get("result")


def _correo(cfg, destino, asunto, cuerpo_html, adjuntos):
    msg = EmailMessage()
    msg["Subject"] = asunto
    msg["From"] = f"{cfg.get('smtp_remitente') or cfg.get('proyecto')} <{cfg['smtp_usuario']}>"
    msg["To"] = destino
    texto = html.unescape(cuerpo_html.replace("<br>", "\n").replace("\n\n", "\n"))
    for t in ("<b>", "</b>", "<i>", "</i>"):
        texto = texto.replace(t, "")
    msg.set_content(texto)
    msg.add_alternative(f"<div style='font-family:Arial,sans-serif;font-size:14px;color:#10262C'>{cuerpo_html.replace(chr(10), '<br>')}</div>",
                        subtype="html")
    for ruta in adjuntos or []:
        tipo = (mimetypes.guess_type(ruta)[0] or "application/octet-stream").split("/")
        with open(ruta, "rb") as f:
            msg.add_attachment(f.read(), maintype=tipo[0], subtype=tipo[1], filename=os.path.basename(ruta))
    with smtplib.SMTP(cfg.get("smtp_servidor") or "smtp.gmail.com", int(num(cfg.get("smtp_puerto"), 587)), timeout=40) as s:
        s.starttls()
        s.login(cfg["smtp_usuario"], cfg["smtp_clave"])
        s.send_message(msg)


def procesar_cola():
    with base.conectar() as c:
        cfg = config(c)
        filas = c.execute("SELECT * FROM notificaciones WHERE estado='PENDIENTE' AND intentos < 6 ORDER BY id LIMIT 25").fetchall()
    for n in filas:
        extra = json.loads(n["extra"] or "{}")
        try:
            if n["canal"] == "telegram":
                if not cfg.get("telegram_token"):
                    raise RuntimeError("Telegram no configurado")
                datos = {"chat_id": n["destino"], "text": n["texto"][:4000], "parse_mode": "HTML"}
                if extra.get("botones"):
                    datos["reply_markup"] = {"inline_keyboard": extra["botones"]}
                _telegram(cfg["telegram_token"], "sendMessage", datos)
            elif n["canal"] == "email":
                if not (cfg.get("smtp_usuario") and cfg.get("smtp_clave")):
                    raise RuntimeError("Correo no configurado")
                _correo(cfg, n["destino"], n["asunto"], n["texto"], extra.get("adjuntos"))
            estado, error = "ENVIADA", None
        except Exception as e:  # noqa: BLE001
            estado, error = ("PENDIENTE" if n["intentos"] < 5 else "ERROR"), str(e)[:300]
        with base.LOCK, base.conectar() as c:
            c.execute("UPDATE notificaciones SET estado=?, intentos=intentos+1, error=?, enviado=? WHERE id=?",
                      (estado, error, ahora() if estado == "ENVIADA" else None, n["id"]))


# ---------------------------------------------------------------- Telegram entrante (vincular y aprobar)
def _atender_telegram(token, upd):
    from .seguridad import firma_solicitud, resolver_solicitud
    if "message" in upd:
        m = upd["message"]
        chat, texto = str(m["chat"]["id"]), (m.get("text") or "").strip()
        codigo = texto.split()[-1].upper() if texto else ""
        with base.LOCK, base.conectar() as c:
            u = c.execute("SELECT * FROM usuarios WHERE codigo_vinculo=? AND activo=1", (codigo,)).fetchone() if codigo else None
            if u:
                c.execute("UPDATE usuarios SET telegram_chat_id=?, codigo_vinculo=NULL WHERE id=?", (chat, u["id"]))
                base.bitacora(c, u["nombre"], "TELEGRAM_VINCULADO", None, {"usuario_id": u["id"]})
                resp = f"✅ Listo, {u['nombre']}. Este chat recibirá las alertas del geovisor."
            else:
                resp = "Para vincular este chat escriba el código que aparece en el geovisor (Mi cuenta → Vincular Telegram)."
        _telegram(token, "sendMessage", {"chat_id": chat, "text": resp})
    elif "callback_query" in upd:
        q = upd["callback_query"]
        chat = str(q["message"]["chat"]["id"])
        try:
            _, sid, acc, firma = q["data"].split(":")
            sid = int(sid)
        except ValueError:
            return
        with base.LOCK, base.conectar() as c:
            u = c.execute("SELECT * FROM usuarios WHERE telegram_chat_id=? AND activo=1 AND rol='DUENO'", (chat,)).fetchone()
            if not u or firma != firma_solicitud(c, sid, acc):
                txt = "No autorizado."
            else:
                try:
                    r = resolver_solicitud(c, u["nombre"], sid, acc == "A", "Rechazada desde Telegram", EJECUTOR)
                    txt = {"APROBADA": "✅ Aprobada y ejecutada", "RECHAZADA": "❌ Rechazada"}.get(r["estado"],
                                                                                             f"⚠️ No se pudo ejecutar: {r.get('resultado', '')}")
                except Exception as e:  # noqa: BLE001
                    txt = f"⚠️ {e}"
        _telegram(token, "answerCallbackQuery", {"callback_query_id": q["id"], "text": txt[:190]})
        try:
            _telegram(token, "editMessageText", {"chat_id": chat, "message_id": q["message"]["message_id"],
                                                 "text": (q["message"].get("text") or "") + f"\n\n→ {txt}"})
        except Exception:  # noqa: BLE001
            pass


def _hilo_telegram():
    offset = 0
    while not _parar.is_set():
        with base.conectar() as c:
            token = config(c).get("telegram_token")
        if not token:
            _parar.wait(30)
            continue
        try:
            upds = _telegram(token, "getUpdates", {"timeout": 25, "offset": offset, "allowed_updates": ["message", "callback_query"]})
            for upd in upds:
                offset = upd["update_id"] + 1
                try:
                    _atender_telegram(token, upd)
                except Exception:  # noqa: BLE001
                    pass
        except Exception:  # noqa: BLE001
            _parar.wait(20)


# ---------------------------------------------------------------- tareas programadas
def _tarea_diaria():
    from .seguridad import verificar_integridad
    hoy_ = hoy().isoformat()
    h = dt.datetime.now().strftime("%H:%M")
    with base.LOCK, base.conectar() as c:
        cfg = config(c)
        if ACTIVAS and h >= (cfg.get("recordatorio_hora") or "08:00") and not marca_hecha(c, f"recordatorios:{hoy_}"):
            marcar(c, f"recordatorios:{hoy_}")
            generar_recordatorios(c)
        if h >= (cfg.get("resumen_diario_hora") or "18:00") and not marca_hecha(c, f"resumen:{hoy_}"):
            marcar(c, f"resumen:{hoy_}")
            if ACTIVAS:
                enviar_resumen(c)
        if not marca_hecha(c, f"integridad:{hoy_}"):
            marcar(c, f"integridad:{hoy_}")
            revisar_integridad(c, verificar_integridad(c))
        c.execute("UPDATE solicitudes SET estado='VENCIDA', resuelto_en=? WHERE estado='PENDIENTE' AND creado < ?",
                  (ahora(), (dt.datetime.now() - dt.timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")))


def revisar_integridad(c, integ):
    """Avisa a los dueños solo cuando aparece un problema nuevo (no repite la misma alerta todos los días)."""
    huella = hashlib.sha256("|".join(integ["problemas"]).encode()).hexdigest() if integ["problemas"] else ""
    if huella != (config(c).get("integridad_ultima") or ""):
        base.set_config(c, "integridad_ultima", huella)
        if integ["problemas"]:
            alertar_duenos(c, "⚠️ ALERTA DE INTEGRIDAD",
                           "Se detectaron cambios hechos por fuera del geovisor:\n• " +
                           "\n• ".join(html.escape(p) for p in integ["problemas"][:10]))


def _hilo_programador():
    while not _parar.is_set():
        try:
            _tarea_diaria()
            procesar_cola()
        except Exception:  # noqa: BLE001
            pass
        _parar.wait(30)


def _en_cliente(t, f):
    tenant.fijar(t)         # los hilos nacen sin contexto: sin esto no sabrían de qué cliente son
    f()


def arrancar():
    # shortcut: dos hilos por cliente; con decenas de clientes pasar a un worker único que los recorra
    t = tenant.actual()
    threading.Thread(target=_en_cliente, args=(t, _hilo_programador), daemon=True, name=f"programador-{t.id}").start()
    if ACTIVAS:
        threading.Thread(target=_en_cliente, args=(t, _hilo_telegram), daemon=True, name=f"telegram-{t.id}").start()


def probar_canales(c, sesion):
    u = c.execute("SELECT * FROM usuarios WHERE id=?", (sesion["usuario_id"],)).fetchone()
    tg, mail = _canales(c)
    hechos = []
    if tg and u["telegram_chat_id"]:
        encolar(c, "telegram", u["telegram_chat_id"], "Prueba", "✅ Prueba de alertas del geovisor: Telegram funciona.")
        hechos.append("Telegram")
    if mail and u["email"]:
        encolar(c, "email", u["email"], "Prueba de alertas del geovisor", "✅ Prueba de alertas: el correo funciona.")
        hechos.append("correo")
    return hechos


def estado_canales(c):
    tg, mail = _canales(c)
    filas = [dict(r) for r in c.execute("SELECT id, canal, destino, asunto, estado, intentos, error, creado, enviado "
                                        "FROM notificaciones WHERE canal<>'app' ORDER BY id DESC LIMIT 30")]
    return {"telegram": tg, "correo": mail, "recientes": filas,
            "pendientes": c.execute("SELECT COUNT(*) FROM notificaciones WHERE estado='PENDIENTE'").fetchone()[0],
            "errores": c.execute("SELECT COUNT(*) FROM notificaciones WHERE estado='ERROR'").fetchone()[0]}
