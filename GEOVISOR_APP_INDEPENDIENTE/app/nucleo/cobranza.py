# -*- coding: utf-8 -*-
"""Cobranza: agenda de cuotas por vencer y vencidas, gestiones de cobro, compromisos de pago y avisos al comprador."""
import datetime as dt
import html

from .base import ErrorNegocio, ahora, bitacora, config, fecha, hoy, num

TIPOS = {"LLAMADA": "Llamada", "WHATSAPP": "WhatsApp", "CORREO": "Correo", "VISITA": "Visita", "MENSAJE": "Mensaje de texto"}


def agenda(c, dias=15):
    from . import cartera
    hoy_ = hoy()
    lim = hoy_ + dt.timedelta(days=int(dias))
    gest = {}
    for g in c.execute("SELECT * FROM gestiones_cobro ORDER BY fecha, id"):
        gest[g["venta_id"]] = dict(g)          # queda la última
    filas = []
    for v in cartera.ventas_activas_con_estado(c):
        g = gest.get(v["id"])
        compromiso = None
        if g and g.get("compromiso_fecha"):
            cf = fecha(g["compromiso_fecha"])
            compromiso = {"fecha": g["compromiso_fecha"], "valor": g.get("compromiso_valor"),
                          "estado": "VIGENTE" if cf >= hoy_ else ("INCUMPLIDO" if v["vencido"] > 0.5 else "CUMPLIDO")}
        if v["etapa"] == "SEPARADO":
            lf = fecha(v["fecha_limite_separacion"])
            if lf and lf <= lim:
                filas.append({**_base(v), "tipo": "SEPARACION", "fecha": v["fecha_limite_separacion"],
                              "valor": None, "dias": (hoy_ - lf).days, "ultima_gestion": g, "compromiso": compromiso})
            continue
        if v["vencido"] > 0.5:
            primera = next((it for it in v["plan"] if it["estado"].startswith("VENCIDA")), None)
            filas.append({**_base(v), "tipo": "VENCIDA", "fecha": primera["fecha"] if primera else None,
                          "valor": v["vencido"], "dias": v["dias_mora"], "cuotas": v["cuotas_vencidas"],
                          "interes": v["interes_mora"], "ultima_gestion": g, "compromiso": compromiso})
        elif v["proxima_cuota"] and fecha(v["proxima_cuota"]["fecha"]) <= lim:
            p = v["proxima_cuota"]
            filas.append({**_base(v), "tipo": "POR_VENCER", "fecha": p["fecha"], "valor": p["pendiente"],
                          "dias": (fecha(p["fecha"]) - hoy_).days, "ultima_gestion": g, "compromiso": compromiso})
    orden = {"VENCIDA": 0, "SEPARACION": 1, "POR_VENCER": 2}
    filas.sort(key=lambda f: (orden[f["tipo"]], -(f["dias"] or 0) if f["tipo"] == "VENCIDA" else (f["fecha"] or "")))
    hoy_iso = hoy_.isoformat()
    return {"filas": filas, "dias": int(dias),
            "totales": {"vencido": sum(f["valor"] or 0 for f in filas if f["tipo"] == "VENCIDA"),
                        "n_vencidas": sum(1 for f in filas if f["tipo"] == "VENCIDA"),
                        "por_vencer": sum(f["valor"] or 0 for f in filas if f["tipo"] == "POR_VENCER"),
                        "n_por_vencer": sum(1 for f in filas if f["tipo"] == "POR_VENCER"),
                        "compromisos_hoy": sum(1 for f in filas if f["compromiso"] and f["compromiso"]["fecha"] == hoy_iso),
                        "incumplidos": sum(1 for f in filas if f["compromiso"] and f["compromiso"]["estado"] == "INCUMPLIDO")},
            "gestiones_hoy": c.execute("SELECT COUNT(*) FROM gestiones_cobro WHERE fecha=?", (hoy_iso,)).fetchone()[0]}


def _base(v):
    return {"venta_id": v["id"], "id_lote": v["id_lote"], "cliente": v["cliente"], "telefono": v["telefono"],
            "email": v["email"], "documento": v["documento"], "saldo": v["saldo"], "etapa": v["etapa"]}


def registrar_gestion(c, usuario, d):
    v = c.execute("SELECT * FROM ventas WHERE id=?", (int(d["venta_id"]),)).fetchone()
    if not v:
        raise ErrorNegocio("La venta no existe.")
    tipo = d.get("tipo") if d.get("tipo") in TIPOS else None
    if not tipo:
        raise ErrorNegocio("Seleccione el tipo de gestión.")
    if not (d.get("resultado") or "").strip():
        raise ErrorNegocio("Describa el resultado de la gestión.")
    cf = d.get("compromiso_fecha") or None
    cv = round(num(d.get("compromiso_valor"))) if d.get("compromiso_valor") not in (None, "") else None
    if cf:
        fecha(cf)
    gid = c.execute("INSERT INTO gestiones_cobro (venta_id, id_lote, fecha, tipo, resultado, compromiso_fecha, compromiso_valor, "
                    "usuario, creado) VALUES (?,?,?,?,?,?,?,?,?)",
                    (v["id"], v["id_lote"], d.get("fecha") or hoy().isoformat(), tipo, d["resultado"].strip(), cf, cv,
                     usuario, ahora())).lastrowid
    bitacora(c, usuario, "GESTION_COBRO", v["id_lote"], {"gestion_id": gid, "tipo": tipo, "compromiso_fecha": cf,
                                                        "compromiso_valor": cv})
    return {"ok": True, "id": gid}


def enviar_estado_correo(c, usuario, d):
    """Envía al comprador, por correo, su estado de cuenta resumido (requiere correo configurado)."""
    from . import alertas, cartera
    cfg = config(c)
    if not (cfg.get("smtp_usuario") and cfg.get("smtp_clave")):
        raise ErrorNegocio("El correo de salida no está configurado (Configuración → Alertas).")
    v = next((x for x in cartera.ventas_activas_con_estado(c) if x["id"] == int(d["venta_id"])), None)
    if not v or not v.get("email"):
        raise ErrorNegocio("El comprador no tiene correo registrado.")
    p = lambda x: "$" + f"{round(x or 0):,}".replace(",", ".")  # noqa: E731
    prox = v["proxima_cuota"]
    cuerpo = (f"Estimado(a) {html.escape(v['cliente'])}:<br><br>Este es el estado de su cuenta del lote <b>{v['id_lote']}</b> "
              f"al {hoy():%d/%m/%Y}:<br>· Valor del negocio: <b>{p(v['valor_venta'])}</b><br>· Total pagado: <b>{p(v['pagado'])}</b>"
              f"<br>· Saldo: <b>{p(v['saldo'])}</b>"
              + (f"<br>· <b>Valor vencido: {p(v['vencido'])}</b> ({v['dias_mora']} días)" if v["vencido"] > 0.5 else "")
              + (f"<br>· Próxima cuota: {p(prox['pendiente'])} el {fecha(prox['fecha']):%d/%m/%Y}" if prox else "")
              + (f"<br><br>Puede pagar en: <b>{html.escape(cfg['cuenta_bancaria'])}</b>" if cfg.get("cuenta_bancaria") else "")
              + "<br>Si ya realizó el pago, por favor envíenos el comprobante." + alertas._firma(cfg))
    alertas.encolar(c, "email", v["email"], f"Estado de cuenta · Lote {v['id_lote']}", cuerpo)
    registrar_gestion(c, usuario, {"venta_id": v["id"], "tipo": "CORREO", "resultado": f"Estado de cuenta enviado a {v['email']}"})
    return {"ok": True}


def acciones(c, usuario, ruta, d):
    if ruta == "/api/cobranza/gestion":
        return registrar_gestion(c, usuario, d)
    if ruta == "/api/cobranza/enviar":
        return enviar_estado_correo(c, usuario, d)
    return None
