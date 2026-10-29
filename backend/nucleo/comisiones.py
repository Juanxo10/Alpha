# -*- coding: utf-8 -*-
"""Comisionistas: registro, comisión por venta, causación, pagos con comprobante de egreso."""
from .base import ErrorNegocio, ahora, bitacora, config, fecha, hoy, num, siguiente_consecutivo

# --------------------------------------------------------------- comisiones
REGLAS = {"RECAUDO": "Proporcional al recaudo", "INICIAL": "Al pagarse la cuota inicial", "VENTA": "Al firmar la venta"}
VINCULOS = ("INDEPENDIENTE", "INMOBILIARIA", "EMPLEADO", "REFERIDO")


def info_ventas(c, venta_ids=None):
    """Datos de las ventas que necesita el cálculo de comisiones (incluye desistidas)."""
    sql = ("SELECT v.*, cl.nombre cliente, cl.documento doc_cliente, "
           "(SELECT COALESCE(SUM(p.valor),0) FROM pagos p WHERE p.venta_id=v.id AND p.anulado=0) pagado "
           "FROM ventas v JOIN clientes cl ON cl.id=v.cliente_id")
    par = ()
    if venta_ids is not None:
        if not venta_ids:
            return {}
        sql += f" WHERE v.id IN ({','.join('?' * len(venta_ids))})"
        par = tuple(venta_ids)
    out = {}
    for v in c.execute(sql, par):
        d = dict(v)
        valor = d["valor_venta"] or 0
        inicial = min(d["cuota_inicial"] or 0, valor)
        d["inicial_pagada"] = d["pagado"] + 0.5 >= inicial
        d["pct_recaudo"] = round(100 * d["pagado"] / valor, 1) if valor else 0
        out[d["id"]] = d
    return out


def pagado_por_comision(c):
    return {r[0]: r[1] for r in c.execute(
        "SELECT d.comision_id, SUM(d.valor) FROM pagos_comision_detalle d JOIN pagos_comision p ON p.id=d.pago_id "
        "WHERE p.anulado=0 GROUP BY d.comision_id")}


def calcular_comision(com, v, pagado_com):
    """Valor, causación y saldo de una comisión según su regla y el estado de la venta."""
    base = (v["valor_venta"] or 0) if v else 0
    valor = round(base * (com["porcentaje"] or 0) / 100)
    if com["estado"] == "ANULADA":
        causado, estado = pagado_com, "ANULADA"
    elif v["estado"] == "DESISTIDA":
        causado, estado = min(pagado_com, valor), "VENTA_DESISTIDA"     # se congela: no se causa nada más
    elif v["etapa"] == "SEPARADO":
        causado, estado = 0, "EN_SEPARACION"
    else:
        regla = com["regla"]
        if regla == "VENTA":
            causado = valor
        elif regla == "INICIAL":
            causado = valor if v["inicial_pagada"] else 0
        else:
            causado = round(valor * min(v["pagado"] / base, 1)) if base else 0
        estado = "PAGADA" if valor and pagado_com + 0.5 >= valor else ("POR_PAGAR" if causado - pagado_com > 0.5
                                                                         else "EN_CAUSACION")
    d = dict(com)
    d.update(valor_comision=valor, causado=causado, pagado=pagado_com, por_pagar=max(causado - pagado_com, 0),
             anticipado=max(pagado_com - causado, 0), por_causar=max(valor - causado, 0), estado_comision=estado,
             regla_nombre=REGLAS.get(com["regla"], com["regla"]))
    if v:
        d.update(id_lote=v["id_lote"], cliente=v["cliente"], valor_venta=base, etapa=v["etapa"], estado_venta=v["estado"],
                 fecha_venta=v["fecha_venta"] or v["fecha_separacion"], pct_recaudo=v["pct_recaudo"],
                 recaudado_venta=v["pagado"])
    return d


def listar_comisiones(c, where="1=1", par=()):
    filas = [dict(r) for r in c.execute(
        f"SELECT co.*, cm.nombre comisionista, cm.documento doc_comisionista FROM comisiones co "
        f"JOIN comisionistas cm ON cm.id=co.comisionista_id WHERE {where} ORDER BY co.id", par)]
    ventas = info_ventas(c, sorted({f["venta_id"] for f in filas}))
    pag = pagado_por_comision(c)
    return [calcular_comision(f, ventas.get(f["venta_id"]), pag.get(f["id"], 0)) for f in filas]


def totales_comisiones(lista):
    vivas = [x for x in lista if x["estado"] == "ACTIVA"]
    return {"ventas": len({x["venta_id"] for x in vivas if x["estado_venta"] == "ACTIVA"}),
            "valor_vendido": sum({x["venta_id"]: x["valor_venta"] for x in vivas if x["estado_venta"] == "ACTIVA"}.values()),
            "generado": sum(x["valor_comision"] for x in vivas if x["estado_venta"] == "ACTIVA"),
            "causado": sum(x["causado"] for x in lista), "pagado": sum(x["pagado"] for x in lista),
            "por_pagar": sum(x["por_pagar"] for x in lista), "anticipado": sum(x["anticipado"] for x in lista)}


def resumen_comisionistas(c):
    todas = listar_comisiones(c)
    salida = []
    for cm in c.execute("SELECT * FROM comisionistas ORDER BY estado='ACTIVO' DESC, nombre"):
        d = dict(cm)
        d.update(totales_comisiones([x for x in todas if x["comisionista_id"] == cm["id"]]))
        salida.append(d)
    return {"comisionistas": salida, "totales": totales_comisiones(todas),
            "activos": sum(1 for x in salida if x["estado"] == "ACTIVO")}


def pagos_de_comisionista(c, comisionista_id):
    pagos = [dict(r) for r in c.execute("SELECT * FROM pagos_comision WHERE comisionista_id=? ORDER BY comprobante",
                                        (comisionista_id,))]
    for p in pagos:
        p["detalle"] = [dict(r) for r in c.execute(
            "SELECT d.*, v.id_lote, cl.nombre cliente FROM pagos_comision_detalle d JOIN comisiones co ON co.id=d.comision_id "
            "JOIN ventas v ON v.id=co.venta_id JOIN clientes cl ON cl.id=v.cliente_id WHERE d.pago_id=?", (p["id"],))]
    return pagos


def detalle_comisionista(c, cid):
    cm = c.execute("SELECT * FROM comisionistas WHERE id=?", (cid,)).fetchone()
    if not cm:
        raise ErrorNegocio("El comisionista no existe.")
    coms = listar_comisiones(c, "co.comisionista_id=?", (cid,))
    bit = [dict(b) for b in c.execute(
        "SELECT * FROM bitacora WHERE accion LIKE 'COMIS%' AND detalle LIKE ? ORDER BY id DESC LIMIT 80",
        (f'%"comisionista_id": {cid},%',))]
    return {"comisionista": dict(cm), "comisiones": coms, "totales": totales_comisiones(coms),
            "pagos": pagos_de_comisionista(c, cid), "bitacora": bit, "config": config(c)}


def guardar_comisionista(c, usuario, d):
    nombre = (d.get("nombre") or "").strip()
    if not nombre:
        raise ErrorNegocio("El nombre del comisionista es obligatorio.")
    doc = (d.get("documento") or "").strip().replace(".", "").replace(" ", "")
    pct = num(d.get("porcentaje_defecto"), 0)
    ret = num(d.get("retencion_pct"), 0)
    if not 0 <= pct <= 30:
        raise ErrorNegocio("El porcentaje de comisión debe estar entre 0 % y 30 %.")
    if not 0 <= ret <= 20:
        raise ErrorNegocio("La retención debe estar entre 0 % y 20 %.")
    regla = d.get("regla_causacion") if d.get("regla_causacion") in REGLAS else "RECAUDO"
    vinculo = d.get("vinculo") if d.get("vinculo") in VINCULOS else "INDEPENDIENTE"
    campos = {k: (d.get(k) or "").strip() for k in ("tipo_persona", "tipo_doc", "telefono", "email", "direccion", "ciudad",
                                                    "banco", "tipo_cuenta", "numero_cuenta", "titular_cuenta",
                                                    "fecha_ingreso", "observacion")}
    campos.update(nombre=nombre, documento=doc or None, porcentaje_defecto=pct, retencion_pct=ret,
                  regla_causacion=regla, vinculo=vinculo)
    campos["tipo_persona"] = campos["tipo_persona"] or "NATURAL"
    campos["tipo_doc"] = campos["tipo_doc"] or "CC"
    if doc:
        otro = c.execute("SELECT id FROM comisionistas WHERE documento=? AND id<>?", (doc, int(d.get("id") or 0))).fetchone()
        if otro:
            raise ErrorNegocio("Ya existe un comisionista con ese número de documento.")
    if d.get("id"):
        cid = int(d["id"])
        antes = dict(c.execute("SELECT * FROM comisionistas WHERE id=?", (cid,)).fetchone())
        c.execute(f"UPDATE comisionistas SET {', '.join(k + '=?' for k in campos)} WHERE id=?", (*campos.values(), cid))
        cambios = {k: [antes.get(k), v] for k, v in campos.items() if str(antes.get(k) or "") != str(v or "")}
        bitacora(c, usuario, "COMISIONISTA_EDITADO", None, {"comisionista_id": cid, "cambios": cambios})
        return {"ok": True, "id": cid}
    campos.update(estado="ACTIVO", creado=ahora())
    campos["fecha_ingreso"] = campos["fecha_ingreso"] or hoy().isoformat()
    cid = c.execute(f"INSERT INTO comisionistas ({', '.join(campos)}) VALUES ({', '.join('?' * len(campos))})",
                    tuple(campos.values())).lastrowid
    bitacora(c, usuario, "COMISIONISTA_NUEVO", None, {"comisionista_id": cid, "nombre": nombre, "documento": doc,
                                                       "porcentaje": pct})
    return {"ok": True, "id": cid}


def asignar_comision(c, usuario, venta_id, comisionista_id, pct, regla=None, obs=""):
    v = c.execute("SELECT * FROM ventas WHERE id=?", (venta_id,)).fetchone()
    if not v or v["estado"] != "ACTIVA":
        raise ErrorNegocio("La venta no está activa.")
    cm = c.execute("SELECT * FROM comisionistas WHERE id=?", (comisionista_id,)).fetchone()
    if not cm or cm["estado"] != "ACTIVO":
        raise ErrorNegocio("El comisionista no existe o está inactivo.")
    pct = num(pct, cm["porcentaje_defecto"])
    if pct <= 0:
        raise ErrorNegocio("El porcentaje de comisión debe ser mayor que cero.")
    if c.execute("SELECT 1 FROM comisiones WHERE venta_id=? AND comisionista_id=? AND estado='ACTIVA'",
                 (venta_id, comisionista_id)).fetchone():
        raise ErrorNegocio("Ese comisionista ya tiene comisión en esta venta.")
    tope = num(config(c).get("comision_max_pct"), 10)
    usado = c.execute("SELECT COALESCE(SUM(porcentaje),0) FROM comisiones WHERE venta_id=? AND estado='ACTIVA'",
                      (venta_id,)).fetchone()[0]
    if usado + pct > tope + 1e-9:
        raise ErrorNegocio(f"La comisión total de la venta superaría el tope de {tope:g} % (ya asignado: {usado:g} %).")
    regla = regla if regla in REGLAS else cm["regla_causacion"]
    cid = c.execute("INSERT INTO comisiones (venta_id, comisionista_id, porcentaje, regla, observacion, creado) "
                    "VALUES (?,?,?,?,?,?)", (venta_id, comisionista_id, pct, regla, obs or "", ahora())).lastrowid
    bitacora(c, usuario, "COMISION_ASIGNADA", v["id_lote"], {"comision_id": cid, "comisionista_id": comisionista_id,
                                                           "comisionista": cm["nombre"], "porcentaje": pct, "regla": regla,
                                                           "valor_venta": v["valor_venta"]})
    return cid


def acciones_comisiones(c, usuario, ruta, d):
    """Rutas POST del módulo de comisiones. Devuelve None si la ruta no es de este módulo."""
    if ruta == "/api/comisionista/guardar":
        return guardar_comisionista(c, usuario, d)

    if ruta == "/api/comisionista/estado":
        cid, est = int(d["id"]), "ACTIVO" if d.get("estado") == "ACTIVO" else "INACTIVO"
        c.execute("UPDATE comisionistas SET estado=? WHERE id=?", (est, cid))
        bitacora(c, usuario, "COMISIONISTA_ESTADO", None, {"comisionista_id": cid, "estado": est})
        return {"ok": True}

    if ruta == "/api/comision/asignar":
        cid = asignar_comision(c, usuario, int(d["venta_id"]), int(d["comisionista_id"]), d.get("porcentaje"),
                               d.get("regla"), d.get("observacion"))
        return {"ok": True, "comision_id": cid}

    if ruta == "/api/comision/editar":
        co = c.execute("SELECT * FROM comisiones WHERE id=?", (int(d["id"]),)).fetchone()
        if not co or co["estado"] != "ACTIVA":
            raise ErrorNegocio("La comisión no está activa.")
        actual = listar_comisiones(c, "co.id=?", (co["id"],))[0]
        pct = num(d.get("porcentaje"), co["porcentaje"])
        regla = d.get("regla") if d.get("regla") in REGLAS else co["regla"]
        tope = num(config(c).get("comision_max_pct"), 10)
        otros = c.execute("SELECT COALESCE(SUM(porcentaje),0) FROM comisiones WHERE venta_id=? AND estado='ACTIVA' AND id<>?",
                          (co["venta_id"], co["id"])).fetchone()[0]
        if pct <= 0 or otros + pct > tope + 1e-9:
            raise ErrorNegocio(f"Porcentaje no válido: la venta admite como máximo {tope - otros:g} % para esta comisión.")
        if round(actual["valor_venta"] * pct / 100) + 0.5 < actual["pagado"]:
            raise ErrorNegocio("El nuevo valor quedaría por debajo de lo que ya se le pagó al comisionista.")
        c.execute("UPDATE comisiones SET porcentaje=?, regla=?, observacion=? WHERE id=?",
                  (pct, regla, d.get("observacion", co["observacion"]) or "", co["id"]))
        bitacora(c, usuario, "COMISION_EDITADA", actual["id_lote"], {
            "comision_id": co["id"], "comisionista_id": co["comisionista_id"],
            "antes": {"porcentaje": co["porcentaje"], "regla": co["regla"]}, "despues": {"porcentaje": pct, "regla": regla}})
        return {"ok": True}

    if ruta == "/api/comision/anular":
        co = c.execute("SELECT * FROM comisiones WHERE id=?", (int(d["id"]),)).fetchone()
        if not co or co["estado"] != "ACTIVA":
            raise ErrorNegocio("La comisión no está activa.")
        if not (d.get("motivo") or "").strip():
            raise ErrorNegocio("Indique el motivo.")
        actual = listar_comisiones(c, "co.id=?", (co["id"],))[0]
        if actual["pagado"] > 0.5:
            raise ErrorNegocio("No se puede quitar: el comisionista ya recibió pagos por esta comisión. Anule primero esos comprobantes.")
        c.execute("UPDATE comisiones SET estado='ANULADA', motivo_anulacion=? WHERE id=?", (d["motivo"].strip(), co["id"]))
        bitacora(c, usuario, "COMISION_ANULADA", actual["id_lote"], {"comision_id": co["id"], "comisionista_id": co["comisionista_id"],
                                                                   "motivo": d["motivo"].strip()})
        return {"ok": True}

    if ruta == "/api/comision/pagar":
        cid = int(d["comisionista_id"])
        cm = c.execute("SELECT * FROM comisionistas WHERE id=?", (cid,)).fetchone()
        if not cm:
            raise ErrorNegocio("El comisionista no existe.")
        pendientes = {x["id"]: x for x in listar_comisiones(c, "co.comisionista_id=?", (cid,))}
        items = [(int(i["comision_id"]), round(num(i.get("valor")))) for i in d.get("items", []) if round(num(i.get("valor"))) > 0]
        if not items:
            raise ErrorNegocio("Seleccione al menos una comisión con valor a pagar.")
        for com_id, val in items:
            x = pendientes.get(com_id)
            if not x:
                raise ErrorNegocio("Hay una comisión que no pertenece a este comisionista.")
            if val > x["por_pagar"] + 0.5:
                raise ErrorNegocio(f"En el lote {x['id_lote']} el valor supera lo causado por pagar ({x['por_pagar']:,.0f}).")
        bruto = sum(v for _, v in items)
        ret_pct = num(d.get("retencion_pct"), cm["retencion_pct"] or 0)
        ret = round(bruto * ret_pct / 100)
        f = d.get("fecha") or hoy().isoformat()
        fecha(f)
        n = siguiente_consecutivo(c, "consecutivo_egreso")
        pid = c.execute("INSERT INTO pagos_comision (comisionista_id, comprobante, fecha, valor_bruto, retencion_pct, retencion, "
                        "valor_neto, medio, referencia, observacion, usuario, creado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                        (cid, n, f, bruto, ret_pct, ret, bruto - ret, d.get("medio") or "Transferencia",
                         d.get("referencia") or "", d.get("observacion") or "", usuario, ahora())).lastrowid
        for com_id, val in items:
            c.execute("INSERT INTO pagos_comision_detalle (pago_id, comision_id, valor) VALUES (?,?,?)", (pid, com_id, val))
        bitacora(c, usuario, "COMISION_PAGO", None, {"comisionista_id": cid, "comisionista": cm["nombre"], "comprobante": n,
                                                     "bruto": bruto, "retencion": ret, "neto": bruto - ret,
                                                     "lotes": [pendientes[i]["id_lote"] for i, _ in items]})
        return {"ok": True, "comprobante": n}

    if ruta == "/api/comision/pago/anular":
        p = c.execute("SELECT * FROM pagos_comision WHERE id=?", (int(d["pago_id"]),)).fetchone()
        if not p or p["anulado"]:
            raise ErrorNegocio("El comprobante no existe o ya está anulado.")
        if not (d.get("motivo") or "").strip():
            raise ErrorNegocio("Indique el motivo de la anulación.")
        c.execute("UPDATE pagos_comision SET anulado=1, motivo_anulacion=?, fecha_anulacion=? WHERE id=?",
                  (d["motivo"].strip(), ahora(), p["id"]))
        bitacora(c, usuario, "COMISION_PAGO_ANULADO", None, {"comisionista_id": p["comisionista_id"],
                                                             "comprobante": p["comprobante"], "neto": p["valor_neto"],
                                                             "motivo": d["motivo"].strip()})
        return {"ok": True}
    return None


def comprobante_egreso(c, n):
    p = c.execute("SELECT * FROM pagos_comision WHERE comprobante=?", (n,)).fetchone()
    if not p:
        raise ErrorNegocio("Comprobante no encontrado.")
    det = [dict(r) for r in c.execute(
        "SELECT d.valor, co.porcentaje, co.regla, v.id_lote, v.valor_venta, cl.nombre cliente FROM pagos_comision_detalle d "
        "JOIN comisiones co ON co.id=d.comision_id JOIN ventas v ON v.id=co.venta_id JOIN clientes cl ON cl.id=v.cliente_id "
        "WHERE d.pago_id=? ORDER BY v.id_lote", (p["id"],))]
    cm = c.execute("SELECT * FROM comisionistas WHERE id=?", (p["comisionista_id"],)).fetchone()
    return {"pago": dict(p), "detalle": det, "comisionista": dict(cm), "config": config(c)}
