# -*- coding: utf-8 -*-
"""Cartera: lotes, compradores, ventas, plan de pagos, mora, pagos (recibos) y reestructuraciones."""
import datetime as dt
import json
import math
import re

from .base import ErrorNegocio, ahora, bitacora, config, fecha, hoy, num, siguiente_consecutivo, sumar_meses
from . import comisiones


# ------------------------------------------------------- plan de pagos y mora
def plan_de_pagos(v, reest=None):
    """Cuotas esperadas de una venta. Si el plan fue reestructurado, lo pagado hasta ese día queda como un
    primer renglón y el saldo se reparte en el nuevo número de cuotas."""
    if v["etapa"] == "SEPARADO" or not v["valor_venta"] or not v["fecha_venta"]:
        return []
    total = round(v["valor_venta"])
    if reest:
        items = []
        previo = round(reest["pagado_al_momento"])
        if previo > 0:
            items.append({"n": 0, "concepto": "Pagado hasta la reestructuración", "fecha": reest["fecha"], "valor": previo})
        resto, n = total - previo, int(reest["n_cuotas"])
        base = fecha(reest["fecha_primera"])
        cuota = round(resto / n) if n else resto
        for k in range(max(n, 1)):
            valor = cuota if k < n - 1 else resto - cuota * (n - 1)
            items.append({"n": k + 1, "concepto": f"Cuota {k + 1} de {n} (plan reestructurado)",
                          "fecha": sumar_meses(base, k).isoformat(), "valor": valor})
        return items
    inicial = round(v["cuota_inicial"] or 0)
    n = int(v["n_cuotas"] or 0)
    items = []
    if inicial > 0:
        items.append({"n": 0, "concepto": "Cuota inicial", "fecha": v["fecha_venta"], "valor": min(inicial, total)})
    resto = total - min(inicial, total)
    if resto > 0:
        if n <= 0:
            items.append({"n": 1, "concepto": "Pago de contado", "fecha": v["fecha_venta"], "valor": resto})
        else:
            base = fecha(v["fecha_primera_cuota"] or v["fecha_venta"])
            cuota = round(resto / n)
            for k in range(n):
                valor = cuota if k < n - 1 else resto - cuota * (n - 1)
                items.append({"n": k + 1, "concepto": f"Cuota {k + 1} de {n}",
                              "fecha": sumar_meses(base, k).isoformat(), "valor": valor})
    return items


def estado_financiero(v, pagado, dias_gracia=0, tasa_mora=0.0, reest=None):
    """Aplica lo pagado a las cuotas en orden y calcula saldo, vencido, mora e intereses de mora estimados."""
    plan = plan_de_pagos(v, reest)
    resto = pagado
    hoy_ = hoy()
    vencido, primera_vencida, proxima, interes = 0.0, None, None, 0.0
    for it in plan:
        aplica = min(resto, it["valor"])
        resto -= aplica
        it["pagado"] = aplica
        it["pendiente"] = it["valor"] - aplica
        f = fecha(it["fecha"])
        if it["pendiente"] <= 0.5:
            it["estado"] = "PAGADA"
        elif f < hoy_:
            it["estado"] = "VENCIDA" if aplica == 0 else "VENCIDA_PARCIAL"
            vencido += it["pendiente"]
            it["dias_vencida"] = (hoy_ - f).days
            interes += it["pendiente"] * tasa_mora / 100 / 30 * max(it["dias_vencida"] - dias_gracia, 0)
            primera_vencida = primera_vencida or f
        else:
            it["estado"] = "PARCIAL" if aplica > 0 else "PENDIENTE"
            proxima = proxima or it
    valor = v["valor_venta"] or 0
    saldo = max(valor - pagado, 0) if valor else 0
    dias = (hoy_ - primera_vencida).days if primera_vencida else 0
    if v["etapa"] == "SEPARADO":
        lim = fecha(v["fecha_limite_separacion"])
        cartera = "SEPARACION_VENCIDA" if lim and lim < hoy_ else "SEPARADO"
    elif valor and saldo <= 0.5:
        cartera = "PAGADO"
    elif dias > dias_gracia:
        cartera = "MORA_30" if dias <= 30 else ("MORA_90" if dias <= 90 else "MORA_MAS_90")
    else:
        cartera = "AL_DIA"
    cuotas = [it for it in plan if it["n"] > 0]
    return {"plan": plan, "saldo": saldo, "vencido": vencido, "dias_mora": dias if dias > dias_gracia else 0,
            "cartera": cartera, "proxima_cuota": proxima, "pct_pagado": round(100 * pagado / valor, 1) if valor else 0,
            "cuotas_total": len(cuotas), "cuotas_pagadas": sum(1 for it in cuotas if it["estado"] == "PAGADA"),
            "cuotas_vencidas": sum(1 for it in plan if it["estado"].startswith("VENCIDA")),
            "fecha_fin": plan[-1]["fecha"] if plan else None, "interes_mora": round(interes),
            "inicial_pagada": all(it["estado"] == "PAGADA" for it in plan if it["n"] == 0) if plan else None,
            "reestructurado": bool(reest)}


def ultimas_reestructuraciones(c):
    return {r["venta_id"]: dict(r) for r in c.execute(
        "SELECT * FROM reestructuraciones WHERE id IN (SELECT MAX(id) FROM reestructuraciones GROUP BY venta_id)")}


def tope_mora_mensual(cfg):
    """Tope legal de la mora: la tasa de usura (% efectivo anual) expresada como tasa mensual efectiva. None si no se ha cargado."""
    ea = num(cfg.get("tasa_usura_ea"), 0)
    return round(((1 + ea / 100) ** (1 / 12) - 1) * 100, 4) if ea > 0 else None


def tasa_mora_efectiva(cfg):
    """Tasa mensual de mora que se aplica: la configurada, sin pasar del tope de usura."""
    tasa, tope = num(cfg.get("tasa_mora_mensual"), 0), tope_mora_mensual(cfg)
    return tasa if tope is None else min(tasa, tope)


def parametros_mora(c):
    cfg = config(c)
    return int(num(cfg.get("dias_gracia"), 0)), tasa_mora_efectiva(cfg)


def ventas_activas_con_estado(c):
    """Cada venta activa con su estado financiero (lo usan cobranza, finanzas y las alertas)."""
    gracia, tasa = parametros_mora(c)
    reest = ultimas_reestructuraciones(c)
    pagado = {r["venta_id"]: r["s"] for r in c.execute(
        "SELECT venta_id, SUM(valor) s FROM pagos WHERE anulado=0 GROUP BY venta_id")}
    salida = []
    for v in c.execute("SELECT v.*, cl.nombre cliente, cl.documento, cl.telefono, cl.email FROM ventas v "
                       "JOIN clientes cl ON cl.id=v.cliente_id WHERE v.estado='ACTIVA'").fetchall():
        p = pagado.get(v["id"], 0) or 0
        d = dict(v)
        d["pagado"] = p
        d.update(estado_financiero(v, p, gracia, tasa, reest.get(v["id"])))
        salida.append(d)
    return salida


def resumen_lotes(c):
    gracia, tasa = parametros_mora(c)
    reest = ultimas_reestructuraciones(c)
    ventas = {r["id_lote"]: r for r in c.execute(
        "SELECT v.*, cl.nombre AS cliente, cl.documento, cl.telefono FROM ventas v "
        "JOIN clientes cl ON cl.id = v.cliente_id WHERE v.estado = 'ACTIVA'")}
    pagado = {r["venta_id"]: r["s"] for r in c.execute(
        "SELECT venta_id, SUM(valor) s FROM pagos WHERE anulado = 0 GROUP BY venta_id")}
    salida = []
    for l in c.execute("SELECT * FROM lotes ORDER BY manzana, lote"):
        d = {"id_lote": l["id_lote"], "manzana": l["manzana"], "lote": l["lote"], "area_m2": l["area_m2"],
             "precio_lista": l["precio_lista"], "nota": l["nota"], "estado": "DISPONIBLE", "cartera": None,
             "valor_venta": 0, "pagado": 0, "saldo": 0, "vencido": 0, "dias_mora": 0, "pct_pagado": 0,
             "cliente": None, "documento": None, "telefono": None, "venta_id": None, "proxima_fecha": None,
             "proxima_valor": None, "fecha_venta": None}
        v = ventas.get(l["id_lote"])
        if v:
            p = pagado.get(v["id"], 0) or 0
            ef = estado_financiero(v, p, gracia, tasa, reest.get(v["id"]))
            estado = v["etapa"]
            if estado == "VENDIDO" and ef["cartera"] == "PAGADO":
                estado = "PAGADO"
            d.update(estado=estado, cartera=ef["cartera"], valor_venta=v["valor_venta"] or 0, pagado=p,
                     saldo=ef["saldo"], vencido=ef["vencido"], dias_mora=ef["dias_mora"], pct_pagado=ef["pct_pagado"],
                     cliente=v["cliente"], documento=v["documento"], telefono=v["telefono"], venta_id=v["id"],
                     fecha_venta=v["fecha_venta"] or v["fecha_separacion"],
                     proxima_fecha=ef["proxima_cuota"]["fecha"] if ef["proxima_cuota"] else None,
                     proxima_valor=ef["proxima_cuota"]["pendiente"] if ef["proxima_cuota"] else None)
        elif l["bloqueado"]:
            d["estado"] = "BLOQUEADO"
        salida.append(d)
    return salida


def resumen_general(c):
    lotes = resumen_lotes(c)
    est = {}
    for l in lotes:
        est[l["estado"]] = est.get(l["estado"], 0) + 1
    vendidos = [l for l in lotes if l["estado"] in ("VENDIDO", "PAGADO", "ESCRITURADO")]
    separados = [l for l in lotes if l["estado"] == "SEPARADO"]
    mora = [l for l in lotes if l["cartera"] in ("MORA_30", "MORA_90", "MORA_MAS_90")]
    disponibles = [l for l in lotes if l["estado"] == "DISPONIBLE"]
    manz = {}
    for l in lotes:
        m = manz.setdefault(l["manzana"], {"manzana": l["manzana"], "lotes": 0, "disponibles": 0, "separados": 0,
                                           "vendidos": 0, "valor_venta": 0, "pagado": 0, "saldo": 0, "en_mora": 0})
        m["lotes"] += 1
        m["disponibles"] += l["estado"] == "DISPONIBLE"
        m["separados"] += l["estado"] == "SEPARADO"
        m["vendidos"] += l["estado"] in ("VENDIDO", "PAGADO", "ESCRITURADO")
        m["valor_venta"] += l["valor_venta"]
        m["pagado"] += l["pagado"]
        m["saldo"] += l["saldo"]
        m["en_mora"] += l["cartera"] in ("MORA_30", "MORA_90", "MORA_MAS_90")
    recientes = [dict(r) for r in c.execute(
        "SELECT p.recibo, p.fecha, p.valor, p.concepto, p.medio, p.id_lote, cl.nombre cliente FROM pagos p "
        "JOIN ventas v ON v.id = p.venta_id JOIN clientes cl ON cl.id = v.cliente_id "
        "WHERE p.anulado = 0 ORDER BY p.fecha DESC, p.id DESC LIMIT 8")]
    lim = (hoy() + dt.timedelta(days=30)).isoformat()
    proximos = sorted([{"id_lote": l["id_lote"], "cliente": l["cliente"], "fecha": l["proxima_fecha"],
                        "valor": l["proxima_valor"]} for l in lotes
                       if l["proxima_fecha"] and l["proxima_fecha"] <= lim], key=lambda x: x["fecha"])[:12]
    mes = hoy().strftime("%Y-%m")
    recaudo_mes = c.execute("SELECT COALESCE(SUM(valor),0) FROM pagos WHERE anulado=0 AND substr(fecha,1,7)=?",
                            (mes,)).fetchone()[0]
    serie = [dict(r) for r in c.execute(
        "SELECT substr(fecha,1,7) mes, SUM(valor) valor FROM pagos WHERE anulado=0 GROUP BY 1 ORDER BY 1 DESC LIMIT 12")][::-1]
    return {
        "conteo": est, "total_lotes": len(lotes),
        "area_total_m2": sum(l["area_m2"] for l in lotes),
        "area_vendida_m2": sum(l["area_m2"] for l in vendidos),
        "valor_vendido": sum(l["valor_venta"] for l in vendidos),
        "valor_separado": sum(l["valor_venta"] for l in separados),
        "recaudado": sum(l["pagado"] for l in lotes),
        "cartera": sum(l["saldo"] for l in vendidos),
        "vencido": sum(l["vencido"] for l in lotes),
        "lotes_mora": len(mora),
        "inventario_valor": sum(l["precio_lista"] or 0 for l in disponibles),
        "disponibles_sin_precio": sum(1 for l in disponibles if not l["precio_lista"]),
        "recaudo_mes": recaudo_mes, "serie_recaudo": serie,
        "mora_rangos": {k: {"n": sum(1 for l in lotes if l["cartera"] == k),
                            "valor": sum(l["vencido"] for l in lotes if l["cartera"] == k)}
                        for k in ("MORA_30", "MORA_90", "MORA_MAS_90")},
        "manzanas": sorted(manz.values(), key=lambda m: m["manzana"]),
        "recientes": recientes, "proximos": proximos, "fecha": hoy().isoformat(),
        "comisiones": comisiones.resumen_comisionistas(c),
    }


def detalle_lote(c, id_lote):
    l = c.execute("SELECT * FROM lotes WHERE id_lote=?", (id_lote,)).fetchone()
    if not l:
        raise ErrorNegocio(f"No existe el lote {id_lote}")
    cfg = config(c)
    gracia, tasa = parametros_mora(c)
    ventas = []
    for v in c.execute("SELECT v.*, cl.nombre, cl.tipo_doc, cl.documento, cl.telefono, cl.email, cl.direccion "
                       "FROM ventas v JOIN clientes cl ON cl.id=v.cliente_id WHERE v.id_lote=? "
                       "ORDER BY v.estado='ACTIVA' DESC, v.id DESC", (id_lote,)).fetchall():
        pagos = [dict(p) for p in c.execute("SELECT * FROM pagos WHERE venta_id=? ORDER BY fecha, id", (v["id"],))]
        pagado = sum(p["valor"] for p in pagos if not p["anulado"])
        reests = [dict(r) for r in c.execute("SELECT * FROM reestructuraciones WHERE venta_id=? ORDER BY id", (v["id"],))]
        d = dict(v)
        d["pagos"] = pagos
        d["pagado"] = pagado
        d.update(estado_financiero(v, pagado, gracia, tasa, reests[-1] if reests else None))
        validos = [x for x in pagos if not x["anulado"]]
        d["ultimo_pago"] = validos[-1] if validos else None
        d["reestructuraciones"] = reests
        d["comisiones"] = comisiones.listar_comisiones(c, "co.venta_id=?", (v["id"],))
        d["gestiones"] = [dict(g) for g in c.execute(
            "SELECT * FROM gestiones_cobro WHERE venta_id=? ORDER BY fecha DESC, id DESC", (v["id"],))]
        ventas.append(d)
    resumen = next(x for x in resumen_lotes(c) if x["id_lote"] == id_lote)
    bit = [dict(b) for b in c.execute("SELECT id, fecha, usuario, accion, id_lote, detalle FROM bitacora "
                                      "WHERE id_lote=? ORDER BY id DESC LIMIT 80", (id_lote,))]
    adj = [dict(a) for a in c.execute("SELECT * FROM adjuntos WHERE id_lote=? AND eliminado=0 ORDER BY id DESC", (id_lote,))]
    publica = {k: v for k, v in cfg.items() if k not in ("smtp_clave", "telegram_token", "clave_interna")}
    return {"lote": dict(l), "resumen": resumen, "ventas": ventas, "bitacora": bit, "adjuntos": adj, "config": publica}


# ----------------------------------------------------------------- escritura
def guardar_cliente(c, d, usuario, id_lote):
    nombre = (d.get("nombre") or "").strip()
    if not nombre:
        raise ErrorNegocio("El nombre del comprador es obligatorio.")
    doc = (d.get("documento") or "").strip().replace(".", "").replace(" ", "")
    if doc and not re.fullmatch(r"[0-9]{5,15}(-[0-9])?", doc):
        raise ErrorNegocio("El documento debe tener solo números (5 a 15 dígitos; el NIT puede llevar guion y dígito de verificación).")
    campos = {k: (d.get(k) or "").strip() for k in ("tipo_doc", "telefono", "email", "direccion")}
    campos["tipo_doc"] = campos["tipo_doc"] or "CC"
    fila = None
    if d.get("id"):
        fila = c.execute("SELECT * FROM clientes WHERE id=?", (int(d["id"]),)).fetchone()
    if not fila and doc:
        fila = c.execute("SELECT * FROM clientes WHERE documento=?", (doc,)).fetchone()
    if fila:
        c.execute("UPDATE clientes SET nombre=?, tipo_doc=?, documento=?, telefono=?, email=?, direccion=? WHERE id=?",
                  (nombre, campos["tipo_doc"], doc or None, campos["telefono"], campos["email"], campos["direccion"],
                   fila["id"]))
        return fila["id"]
    cur = c.execute("INSERT INTO clientes (nombre, tipo_doc, documento, telefono, email, direccion, creado) "
                    "VALUES (?,?,?,?,?,?,?)", (nombre, campos["tipo_doc"], doc or None, campos["telefono"],
                                               campos["email"], campos["direccion"], ahora()))
    bitacora(c, usuario, "CLIENTE_NUEVO", id_lote, {"cliente_id": cur.lastrowid, "nombre": nombre, "documento": doc})
    return cur.lastrowid


def pesos(x):
    return "$" + format(round(x), ",d").replace(",", ".")


def venta_activa(c, id_lote):
    return c.execute("SELECT * FROM ventas WHERE id_lote=? AND estado='ACTIVA'", (id_lote,)).fetchone()


def pagado_venta(c, venta_id):
    return c.execute("SELECT COALESCE(SUM(valor),0) FROM pagos WHERE venta_id=? AND anulado=0", (venta_id,)).fetchone()[0]


def registrar_pago(c, usuario, venta_id, d):
    v = c.execute("SELECT * FROM ventas WHERE id=?", (venta_id,)).fetchone()
    if not v or v["estado"] != "ACTIVA":
        raise ErrorNegocio("La venta no está activa.")
    valor = round(num(d.get("valor")))
    if valor <= 0:
        raise ErrorNegocio("El valor del pago debe ser mayor que cero.")
    f = d.get("fecha") or hoy().isoformat()
    if fecha(f) > hoy():
        raise ErrorNegocio("La fecha del pago no puede ser futura.")
    if v["valor_venta"]:
        pagado = pagado_venta(c, venta_id)
        if pagado + valor > v["valor_venta"] + 0.5:
            if v["etapa"] == "SEPARADO":
                raise ErrorNegocio(f"El valor de la separación ({pesos(valor)}) supera el precio del lote "
                                   f"({pesos(v['valor_venta'])}).")
            raise ErrorNegocio(f"El pago supera el saldo de la venta (saldo: {pesos(v['valor_venta'] - pagado)}).")
    rec = siguiente_consecutivo(c, "consecutivo_recibo")
    medio = d.get("medio") or "Efectivo"
    cur = c.execute("INSERT INTO pagos (venta_id, id_lote, recibo, fecha, valor, concepto, medio, referencia, "
                    "observacion, usuario, creado) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (venta_id, v["id_lote"], rec, f, valor, d.get("concepto") or "Abono", medio,
                     d.get("referencia") or "", d.get("observacion") or "", usuario, ahora()))
    bitacora(c, usuario, "PAGO", v["id_lote"], {"recibo": rec, "valor": valor, "fecha": f,
                                               "concepto": d.get("concepto"), "medio": medio})
    from . import alertas  # import tardío: alertas depende de cartera
    alertas.al_registrar_pago(c, usuario, v, rec, valor, f, medio)
    return {"pago_id": cur.lastrowid, "recibo": rec}


def reestructurar(c, usuario, d):
    """Nuevo plan para el saldo de una venta: por número de cuotas (manual), reduciendo plazo o reduciendo cuota."""
    v = c.execute("SELECT * FROM ventas WHERE id=?", (int(d["venta_id"]),)).fetchone()
    if not v or v["estado"] != "ACTIVA" or v["etapa"] == "SEPARADO" or not v["valor_venta"]:
        raise ErrorNegocio("Solo se puede reestructurar una venta activa.")
    gracia, tasa = parametros_mora(c)
    previa = c.execute("SELECT * FROM reestructuraciones WHERE venta_id=? ORDER BY id DESC LIMIT 1", (v["id"],)).fetchone()
    pagado = pagado_venta(c, v["id"])
    ef = estado_financiero(v, pagado, gracia, tasa, previa)
    saldo = round(v["valor_venta"] - pagado)
    if saldo <= 0:
        raise ErrorNegocio("La venta no tiene saldo por reestructurar.")
    pendientes = [it for it in ef["plan"] if it["pendiente"] > 0.5]
    modo = d.get("modo") or "manual"
    cuota_actual = max((it["valor"] for it in ef["plan"] if it["n"] > 0), default=saldo)
    if modo == "plazo":            # se mantiene la cuota y se acorta el plazo
        n = max(1, math.ceil(saldo / cuota_actual))
    elif modo == "cuota":          # se mantiene el número de cuotas pendientes y baja el valor
        n = max(1, len([it for it in pendientes if it["n"] > 0]) or 1)
    else:
        n = int(num(d.get("n_cuotas")))
    if not 1 <= n <= 360:
        raise ErrorNegocio("Número de cuotas fuera de rango (1 a 360).")
    if d.get("fecha_primera"):
        fp = fecha(d["fecha_primera"])
    else:
        futuras = [fecha(it["fecha"]) for it in pendientes if fecha(it["fecha"]) >= hoy()]
        fp = futuras[0] if futuras else sumar_meses(hoy(), 1)
    motivo = (d.get("motivo") or {"plazo": "Abono a capital: reducción de plazo",
                                  "cuota": "Abono a capital: reducción del valor de la cuota"}.get(modo, "")).strip()
    if not motivo:
        raise ErrorNegocio("Indique el motivo de la reestructuración.")
    rid = c.execute("INSERT INTO reestructuraciones (venta_id, fecha, pagado_al_momento, saldo, n_cuotas, fecha_primera, "
                    "motivo, plan_anterior, usuario, creado) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (v["id"], hoy().isoformat(), pagado, saldo, n, fp.isoformat(), motivo,
                     json.dumps([{k: it[k] for k in ("n", "concepto", "fecha", "valor")} for it in ef["plan"]],
                                ensure_ascii=False), usuario, ahora())).lastrowid
    bitacora(c, usuario, "REESTRUCTURACION", v["id_lote"], {"venta_id": v["id"], "reestructuracion_id": rid, "saldo": saldo,
                                                           "n_cuotas": n, "fecha_primera": fp.isoformat(),
                                                           "cuota": round(saldo / n), "motivo": motivo})
    return {"ok": True, "n_cuotas": n, "cuota": round(saldo / n), "fecha_primera": fp.isoformat()}


def acciones(c, usuario, ruta, d):
    """Rutas POST de cartera. Devuelve None si la ruta no es de este módulo."""
    if ruta == "/api/lote/precio":
        l = c.execute("SELECT * FROM lotes WHERE id_lote=?", (d["id_lote"],)).fetchone()
        nuevo = num(d.get("precio_lista"), None) if d.get("precio_lista") not in (None, "") else None
        c.execute("UPDATE lotes SET precio_lista=?, bloqueado=?, nota=? WHERE id_lote=?",
                  (nuevo, 1 if d.get("bloqueado") else 0, d.get("nota") or "", d["id_lote"]))
        bitacora(c, usuario, "PRECIO_LOTE", d["id_lote"], {"antes": l["precio_lista"], "despues": nuevo,
                                                          "bloqueado": bool(d.get("bloqueado")), "nota": d.get("nota")})
        return {"ok": True}

    if ruta == "/api/precios/masivo":
        modo, valor = d.get("modo"), num(d.get("valor"))
        if valor <= 0:
            raise ErrorNegocio("Indique un valor mayor que cero.")
        sql, par = "SELECT * FROM lotes WHERE 1=1", []
        if d.get("manzana"):
            sql += " AND manzana=?"
            par.append(int(d["manzana"]))
        if d.get("solo_disponibles", True):
            sql += " AND id_lote NOT IN (SELECT id_lote FROM ventas WHERE estado='ACTIVA')"
        n, cambios = 0, []
        for l in c.execute(sql, par).fetchall():
            p = round(valor * l["area_m2"], -3) if modo == "m2" else round(valor)
            c.execute("UPDATE lotes SET precio_lista=? WHERE id_lote=?", (p, l["id_lote"]))
            cambios.append([l["id_lote"], l["precio_lista"], p])
            n += 1
        bitacora(c, usuario, "PRECIO_MASIVO", None, {**d, "lotes_actualizados": n, "cambios": cambios})   # una sola entrada: cada una cuesta 2 consultas
        return {"ok": True, "actualizados": n}

    if ruta == "/api/venta/separar":
        if venta_activa(c, d["id_lote"]):
            raise ErrorNegocio("El lote ya tiene una negociación activa.")
        l = c.execute("SELECT * FROM lotes WHERE id_lote=?", (d["id_lote"],)).fetchone()
        if l["bloqueado"]:
            raise ErrorNegocio("El lote está bloqueado para la venta.")
        cid = guardar_cliente(c, d["cliente"], usuario, d["id_lote"])
        fs = d.get("fecha_separacion") or hoy().isoformat()
        if d.get("fecha_limite_separacion") and fecha(d["fecha_limite_separacion"]) < fecha(fs):
            raise ErrorNegocio("La fecha límite debe ser posterior a la separación.")
        valor = num(d.get("valor_venta"), None) or l["precio_lista"]
        cur = c.execute("INSERT INTO ventas (id_lote, cliente_id, etapa, fecha_separacion, fecha_limite_separacion, "
                        "valor_venta, vendedor, observacion, creado) VALUES (?,?,?,?,?,?,?,?,?)",
                        (d["id_lote"], cid, "SEPARADO", fs, d.get("fecha_limite_separacion") or None, valor,
                         d.get("vendedor") or "", d.get("observacion") or "", ahora()))
        bitacora(c, usuario, "SEPARACION", d["id_lote"], {"venta_id": cur.lastrowid, "cliente_id": cid, "fecha": fs,
                                                         "valor_venta": valor})
        if d.get("comisionista_id"):
            comisiones.asignar_comision(c, usuario, cur.lastrowid, int(d["comisionista_id"]), d.get("comision_pct"),
                                        d.get("comision_regla"))
        if d.get("prospecto_id"):
            from . import prospectos
            prospectos.marcar_ganado(c, usuario, int(d["prospecto_id"]), cur.lastrowid)
        out = {"ok": True, "venta_id": cur.lastrowid}
        if num(d.get("valor_separacion")) > 0:
            out.update(registrar_pago(c, usuario, cur.lastrowid, {
                "valor": d["valor_separacion"], "fecha": fs, "concepto": "Separación",
                "medio": d.get("medio"), "referencia": d.get("referencia")}))
        return out

    if ruta == "/api/venta/vender":
        l = c.execute("SELECT * FROM lotes WHERE id_lote=?", (d["id_lote"],)).fetchone()
        v = venta_activa(c, d["id_lote"])
        if v and v["etapa"] != "SEPARADO":
            raise ErrorNegocio("El lote ya está vendido.")
        if not v and l["bloqueado"]:
            raise ErrorNegocio("El lote está bloqueado para la venta.")
        valor = round(num(d.get("valor_venta")))
        inicial = round(num(d.get("cuota_inicial")))
        n = int(num(d.get("n_cuotas")))
        fv = d.get("fecha_venta") or hoy().isoformat()
        if valor <= 0:
            raise ErrorNegocio("El valor de venta debe ser mayor que cero.")
        if inicial > valor:
            raise ErrorNegocio("La cuota inicial no puede superar el valor de venta.")
        if n < 0 or n > 360:
            raise ErrorNegocio("Número de cuotas fuera de rango (0 a 360).")
        if not (d["cliente"].get("documento") or "").strip():
            raise ErrorNegocio("El número de documento del comprador es obligatorio para vender.")
        fp = d.get("fecha_primera_cuota") or sumar_meses(fecha(fv), 1).isoformat()
        if fecha(fp) <= fecha(fv):
            raise ErrorNegocio("La primera cuota debe ser posterior a la fecha de venta.")
        cid = guardar_cliente(c, d["cliente"], usuario, d["id_lote"])
        if v:
            if pagado_venta(c, v["id"]) > valor:
                raise ErrorNegocio("Lo ya abonado en la separación supera el valor de venta.")
            c.execute("UPDATE ventas SET cliente_id=?, etapa='VENDIDO', fecha_venta=?, valor_venta=?, cuota_inicial=?, "
                      "n_cuotas=?, fecha_primera_cuota=?, vendedor=?, observacion=? WHERE id=?",
                      (cid, fv, valor, inicial, n, fp, d.get("vendedor") or v["vendedor"],
                       d.get("observacion") or v["observacion"], v["id"]))
            vid = v["id"]
        else:
            vid = c.execute("INSERT INTO ventas (id_lote, cliente_id, etapa, fecha_venta, valor_venta, cuota_inicial, "
                            "n_cuotas, fecha_primera_cuota, vendedor, observacion, creado) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                            (d["id_lote"], cid, "VENDIDO", fv, valor, inicial, n, fp, d.get("vendedor") or "",
                             d.get("observacion") or "", ahora())).lastrowid
        if d.get("comisionista_id") and not c.execute(
                "SELECT 1 FROM comisiones WHERE venta_id=? AND comisionista_id=? AND estado='ACTIVA'",
                (vid, int(d["comisionista_id"]))).fetchone():
            comisiones.asignar_comision(c, usuario, vid, int(d["comisionista_id"]), d.get("comision_pct"),
                                        d.get("comision_regla"))
        if d.get("prospecto_id"):
            from . import prospectos
            prospectos.marcar_ganado(c, usuario, int(d["prospecto_id"]), vid)
        bitacora(c, usuario, "VENTA", d["id_lote"], {"venta_id": vid, "cliente_id": cid, "valor_venta": valor,
                                                    "precio_lista": l["precio_lista"], "cuota_inicial": inicial,
                                                    "n_cuotas": n, "fecha_venta": fv})
        return {"ok": True, "venta_id": vid}

    if ruta == "/api/venta/editar":
        v = c.execute("SELECT * FROM ventas WHERE id=?", (int(d["venta_id"]),)).fetchone()
        if not v or v["estado"] != "ACTIVA":
            raise ErrorNegocio("La venta no está activa.")
        cambios = {}
        if d.get("cliente"):
            cambios["cliente_id"] = guardar_cliente(c, d["cliente"], usuario, v["id_lote"])
        for k in ("fecha_separacion", "fecha_limite_separacion", "fecha_venta", "fecha_primera_cuota", "vendedor",
                  "observacion", "fecha_escritura", "numero_escritura", "notaria"):
            if k in d:
                cambios[k] = d[k] or None
        for k in ("valor_venta", "cuota_inicial"):
            if k in d:
                cambios[k] = round(num(d[k]))
        if "n_cuotas" in d:
            cambios["n_cuotas"] = int(num(d["n_cuotas"]))
        # vacío y sin dato son lo mismo: no se anota una edición sin cambios reales
        cambios = {k: x for k, x in cambios.items() if k == "cliente_id" or (v[k] or None) != (x or None)}
        if cambios:
            c.execute(f"UPDATE ventas SET {', '.join(k + '=?' for k in cambios)} WHERE id=?",
                      (*cambios.values(), v["id"]))
            antes = {k: v[k] for k in cambios if k in v.keys()}
            bitacora(c, usuario, "EDITAR_VENTA", v["id_lote"], {"venta_id": v["id"], "antes": antes, "despues": cambios})
        return {"ok": True}

    if ruta == "/api/venta/escriturar":
        v = c.execute("SELECT * FROM ventas WHERE id=?", (int(d["venta_id"]),)).fetchone()
        if not v or v["estado"] != "ACTIVA" or v["etapa"] == "SEPARADO":
            raise ErrorNegocio("Solo se puede escriturar una venta activa.")
        c.execute("UPDATE ventas SET etapa='ESCRITURADO', fecha_escritura=?, numero_escritura=?, notaria=? WHERE id=?",
                  (d.get("fecha_escritura") or hoy().isoformat(), d.get("numero_escritura") or "",
                   d.get("notaria") or "", v["id"]))
        bitacora(c, usuario, "ESCRITURA", v["id_lote"], {**d, "saldo": round(v["valor_venta"] - pagado_venta(c, v["id"]))})
        return {"ok": True}

    if ruta == "/api/venta/desistir":
        v = c.execute("SELECT * FROM ventas WHERE id=?", (int(d["venta_id"]),)).fetchone()
        if not v or v["estado"] != "ACTIVA":
            raise ErrorNegocio("La venta no está activa.")
        if not (d.get("motivo") or "").strip():
            raise ErrorNegocio("Indique el motivo del desistimiento.")
        c.execute("UPDATE ventas SET estado='DESISTIDA', fecha_desistimiento=?, motivo_desistimiento=? WHERE id=?",
                  (d.get("fecha") or hoy().isoformat(), d["motivo"].strip(), v["id"]))
        bitacora(c, usuario, "DESISTIMIENTO", v["id_lote"], {"venta_id": v["id"], "motivo": d["motivo"],
                                                            "pagado": pagado_venta(c, v["id"])})
        return {"ok": True}

    if ruta == "/api/venta/reestructurar":
        return reestructurar(c, usuario, d)

    if ruta == "/api/pago":
        return {"ok": True, **registrar_pago(c, usuario, int(d["venta_id"]), d)}

    if ruta == "/api/pago/anular":
        p = c.execute("SELECT * FROM pagos WHERE id=?", (int(d["pago_id"]),)).fetchone()
        if not p or p["anulado"]:
            raise ErrorNegocio("El pago no existe o ya está anulado.")
        if not (d.get("motivo") or "").strip():
            raise ErrorNegocio("Indique el motivo de la anulación.")
        c.execute("UPDATE pagos SET anulado=1, motivo_anulacion=?, fecha_anulacion=? WHERE id=?",
                  (d["motivo"].strip(), ahora(), p["id"]))
        bitacora(c, usuario, "ANULAR_PAGO", p["id_lote"], {"recibo": p["recibo"], "valor": p["valor"],
                                                          "motivo": d["motivo"]})
        return {"ok": True}
    return None


def recibo(c, n):
    p = c.execute("SELECT p.*, cl.nombre cliente, cl.tipo_doc, cl.documento FROM pagos p "
                  "JOIN ventas v ON v.id=p.venta_id JOIN clientes cl ON cl.id=v.cliente_id WHERE p.recibo=?", (n,)).fetchone()
    if not p:
        raise ErrorNegocio("Recibo no encontrado.")
    return {"pago": dict(p), "detalle": detalle_lote(c, p["id_lote"])}
