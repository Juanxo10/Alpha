# -*- coding: utf-8 -*-
"""Finanzas: gastos con comprobante de egreso, presupuesto, flujo de caja con proyección y conciliación bancaria."""
import csv
import datetime as dt
import io
import re

from . import extractos
from .base import ErrorNegocio, ahora, bitacora, config, fecha, hoy, num, siguiente_consecutivo, sumar_meses

CATEGORIAS = ["Urbanismo y obras", "Topografía, diseños y estudios", "Licencias, impuestos y trámites",
              "Notaría y registro", "Publicidad y ventas", "Honorarios profesionales", "Administración y nómina",
              "Servicios públicos", "Gastos financieros", "Compra de terreno", "Otros"]


# ---------------------------------------------------------------- gastos
def guardar_gasto(c, usuario, d):
    cat = d.get("categoria") if d.get("categoria") in CATEGORIAS else None
    if not cat:
        raise ErrorNegocio("Seleccione una categoría válida.")
    bruto = round(num(d.get("valor_bruto")))
    ret = round(num(d.get("retencion")))
    if bruto <= 0:
        raise ErrorNegocio("El valor del gasto debe ser mayor que cero.")
    if ret < 0 or ret > bruto:
        raise ErrorNegocio("La retención no es válida.")
    if not (d.get("proveedor") or "").strip() or not (d.get("descripcion") or "").strip():
        raise ErrorNegocio("Proveedor y descripción son obligatorios.")
    f = d.get("fecha") or hoy().isoformat()
    if fecha(f) > hoy():
        raise ErrorNegocio("La fecha del gasto no puede ser futura.")
    n = siguiente_consecutivo(c, "consecutivo_egreso")
    gid = c.execute("INSERT INTO gastos (comprobante, fecha, categoria, proveedor, documento_proveedor, factura, descripcion, "
                    "valor_bruto, retencion, valor_neto, medio, referencia, usuario, creado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (n, f, cat, d["proveedor"].strip(), (d.get("documento_proveedor") or "").strip(),
                     (d.get("factura") or "").strip(), d["descripcion"].strip(), bruto, ret, bruto - ret,
                     d.get("medio") or "Transferencia", (d.get("referencia") or "").strip(), usuario, ahora())).lastrowid
    bitacora(c, usuario, "GASTO", None, {"gasto_id": gid, "comprobante": n, "valor_bruto": bruto, "retencion": ret,
                                         "categoria": cat, "proveedor": d["proveedor"].strip(), "fecha": f})
    return {"ok": True, "comprobante": n, "id": gid}


def listar_gastos(c):
    return [dict(r) for r in c.execute("SELECT * FROM gastos ORDER BY fecha DESC, comprobante DESC")]


def egreso(c, n):
    """Comprobante de egreso N: puede ser un gasto o un pago de comisiones (comparten consecutivo)."""
    g = c.execute("SELECT * FROM gastos WHERE comprobante=?", (n,)).fetchone()
    if g:
        return {"tipo": "gasto", "gasto": dict(g), "config": config(c)}
    from .comisiones import comprobante_egreso
    r = comprobante_egreso(c, n)
    r["tipo"] = "comision"
    return r


# ---------------------------------------------------------------- flujo de caja
def flujo(c, meses_futuros=18):
    from . import cartera, comisiones
    ingresos, egresos = {}, {}
    for r in c.execute("SELECT substr(fecha,1,7) m, SUM(valor) v FROM pagos WHERE anulado=0 GROUP BY 1"):
        ingresos[r["m"]] = r["v"]
    detalle_eg = {}
    for r in c.execute("SELECT substr(fecha,1,7) m, categoria, SUM(valor_bruto) v FROM gastos WHERE anulado=0 GROUP BY 1, 2"):
        egresos[r["m"]] = egresos.get(r["m"], 0) + r["v"]
        detalle_eg.setdefault(r["m"], {})[r["categoria"]] = r["v"]
    for r in c.execute("SELECT substr(fecha,1,7) m, SUM(valor_bruto) v FROM pagos_comision WHERE anulado=0 GROUP BY 1"):
        egresos[r["m"]] = egresos.get(r["m"], 0) + r["v"]
        detalle_eg.setdefault(r["m"], {})["Comisiones de venta"] = r["v"]
    # proyección: lo que falta por cobrar según los planes de pago (lo vencido se espera en el mes actual)
    mes_actual = hoy().strftime("%Y-%m")
    proy, vencido = {}, 0.0
    for v in cartera.ventas_activas_con_estado(c):
        for it in v["plan"]:
            if it["pendiente"] <= 0.5:
                continue
            m = it["fecha"][:7]
            if m < mes_actual:
                vencido += it["pendiente"]
                m = mes_actual
            proy[m] = proy.get(m, 0) + it["pendiente"]
    todos = sorted(set(ingresos) | set(egresos) | {mes_actual})
    inicio = todos[0]
    fin = sumar_meses(dt.date.fromisoformat(mes_actual + "-01"), meses_futuros).strftime("%Y-%m")
    meses, m, acum = [], inicio, 0.0
    while m <= fin:
        real = m <= mes_actual
        ing, eg = (ingresos.get(m, 0), egresos.get(m, 0)) if real else (0, 0)
        acum += ing - eg
        meses.append({"mes": m, "real": real, "ingresos": ing, "egresos": eg, "neto": ing - eg, "acumulado": acum,
                      "proyectado": proy.get(m, 0) if m >= mes_actual else 0, "detalle_egresos": detalle_eg.get(m, {})})
        m = sumar_meses(dt.date.fromisoformat(m + "-01"), 1).strftime("%Y-%m")
    res = cartera.resumen_general(c)
    com = comisiones.resumen_comisionistas(c)["totales"]
    pres = {r["categoria"]: r["valor"] for r in c.execute("SELECT * FROM presupuesto")}
    ejec = {}
    for r in c.execute("SELECT categoria, SUM(valor_bruto) v FROM gastos WHERE anulado=0 GROUP BY 1"):
        ejec[r["categoria"]] = r["v"]
    total_ing = sum(ingresos.values())
    total_eg = sum(egresos.values())
    pres_pend = sum(max(pres.get(k, 0) - ejec.get(k, 0), 0) for k in pres)
    comis_pend = max(com["generado"] - com["pagado"], 0)
    proyectado = sum(proy.values())
    return {
        "meses": meses, "mes_actual": mes_actual, "vencido_por_recaudar": vencido,
        "presupuesto": [{"categoria": k, "presupuesto": pres.get(k, 0), "ejecutado": ejec.get(k, 0)} for k in CATEGORIAS],
        "indicadores": {
            "ingresos": total_ing, "egresos": total_eg, "caja": total_ing - total_eg,
            "por_recaudar": proyectado, "inventario": res["inventario_valor"],
            "presupuesto_pendiente": pres_pend, "comisiones_pendientes": comis_pend,
            "resultado_proyectado": total_ing + proyectado + res["inventario_valor"] - total_eg - pres_pend - comis_pend,
            "egresos_comisiones": com["pagado"],
        },
    }


# ---------------------------------------------------------------- conciliación bancaria
def _valor(txt):
    t = re.sub(r"[^\d,.\-]", "", str(txt or ""))
    if not t or t in "-.,":
        return None
    neg = t.startswith("-") or str(txt).strip().startswith("(")
    t = t.replace("-", "")
    if "," in t and "." in t:
        dec = "," if t.rfind(",") > t.rfind(".") else "."
        t = t.replace("." if dec == "," else ",", "").replace(dec, ".")
    elif "," in t:
        partes = t.split(",")
        t = t.replace(",", ".") if len(partes[-1]) in (1, 2) and len(partes) == 2 else t.replace(",", "")
    elif t.count(".") > 1 or (t.count(".") == 1 and len(t.split(".")[-1]) == 3):
        t = t.replace(".", "")
    try:
        v = float(t)
    except ValueError:
        return None
    return -v if neg else v


def _fecha(txt):
    s = str(txt or "").strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d/%m/%y", "%d-%m-%y", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    m = re.match(r"^(\d{4})(\d{2})(\d{2})$", s)
    return dt.date(int(m[1]), int(m[2]), int(m[3])) if m else None


def leer_extracto(texto):
    muestra = texto[:4000]
    try:
        dialecto = csv.Sniffer().sniff(muestra, delimiters=";,\t|")
    except csv.Error:
        dialecto = csv.excel
        dialecto.delimiter = ";" if muestra.count(";") > muestra.count(",") else ","
    filas = [f for f in csv.reader(io.StringIO(texto), dialecto) if any(x.strip() for x in f)]
    if not filas:
        raise ErrorNegocio("El archivo está vacío.")
    return filas


def analizar_extracto(c, d):
    filas = leer_extracto(d.get("texto") or "")
    cab = 1 if d.get("encabezado", True) else 0
    cf, cv, cd = int(d["col_fecha"]), int(d["col_valor"]), int(d.get("col_desc", -1))
    movs = []
    for i, f in enumerate(filas[cab:]):
        if max(cf, cv) >= len(f):
            continue
        fe, va = _fecha(f[cf]), _valor(f[cv])
        if not fe or va is None or va == 0:
            continue
        movs.append({"fila": i + 1 + cab, "fecha": fe.isoformat(), "valor": va,
                     "descripcion": f[cd].strip() if 0 <= cd < len(f) else ""})
    if not movs:
        raise ErrorNegocio("No se reconoció ningún movimiento: revise las columnas de fecha y valor.")
    ini = min(m["fecha"] for m in movs)
    fin = max(m["fecha"] for m in movs)
    margen = lambda s, k: (fecha(s) + dt.timedelta(days=k)).isoformat()  # noqa: E731
    pagos = [dict(r) | {"tabla": "pagos"} for r in c.execute(
        "SELECT p.id, p.recibo numero, p.fecha, p.valor, p.medio, p.referencia, p.id_lote, cl.nombre tercero FROM pagos p "
        "JOIN ventas v ON v.id=p.venta_id JOIN clientes cl ON cl.id=v.cliente_id "
        "WHERE p.anulado=0 AND COALESCE(p.conciliado,0)=0 AND p.medio<>'Efectivo' AND p.fecha BETWEEN ? AND ?",
        (margen(ini, -6), margen(fin, 6)))]
    salidas = [dict(r) | {"tabla": "gastos", "valor": -r["valor_neto"]} for r in c.execute(
        "SELECT id, comprobante numero, fecha, valor_neto, medio, referencia, proveedor tercero FROM gastos "
        "WHERE anulado=0 AND COALESCE(conciliado,0)=0 AND medio<>'Efectivo' AND fecha BETWEEN ? AND ?",
        (margen(ini, -6), margen(fin, 6)))]
    salidas += [dict(r) | {"tabla": "pagos_comision", "valor": -r["valor_neto"]} for r in c.execute(
        "SELECT p.id, p.comprobante numero, p.fecha, p.valor_neto, p.medio, p.referencia, cm.nombre tercero FROM pagos_comision p "
        "JOIN comisionistas cm ON cm.id=p.comisionista_id WHERE p.anulado=0 AND COALESCE(p.conciliado,0)=0 "
        "AND p.medio<>'Efectivo' AND p.fecha BETWEEN ? AND ?", (margen(ini, -6), margen(fin, 6)))]
    candidatos = pagos + salidas
    usados, pares, sin_registro = set(), [], []
    for m in sorted(movs, key=lambda x: x["fecha"]):
        mejores = []
        for k, r in enumerate(candidatos):
            if k in usados or round(r["valor"]) != round(m["valor"]):
                continue
            dias = abs((fecha(r["fecha"]) - fecha(m["fecha"])).days)
            if dias > 6:
                continue
            ref = (r.get("referencia") or "").strip().lower()
            puntos = dias - (5 if ref and ref in m["descripcion"].lower() else 0)
            mejores.append((puntos, k))
        if mejores:
            _, k = min(mejores)
            usados.add(k)
            pares.append({"movimiento": m, "registro": candidatos[k]})
        else:
            sin_registro.append(m)
    sin_extracto = [r for k, r in enumerate(candidatos) if k not in usados and ini <= r["fecha"] <= fin]
    return extractos.separar_ya_conciliados(c, {"movimientos": len(movs), "periodo": [ini, fin], "pares": pares,
                                                "sin_registro": sin_registro, "sin_extracto": sin_extracto})


def confirmar_conciliacion(c, usuario, d):
    n = 0
    ref = f"{d.get('banco') or 'Banco'} · {d.get('archivo') or 'extracto'} · {hoy():%Y-%m-%d}"
    for p in d.get("pares", []):
        tabla = p.get("tabla")
        if tabla not in ("pagos", "gastos", "pagos_comision"):
            continue
        n += c.execute(f"UPDATE {tabla} SET conciliado=1, conciliacion_ref=? WHERE id=? AND COALESCE(conciliado,0)=0",
                       (ref, int(p["id"]))).rowcount
    c.execute("INSERT INTO conciliaciones (fecha, banco, archivo, movimientos, conciliados, usuario, creado) VALUES (?,?,?,?,?,?,?)",
              (hoy().isoformat(), d.get("banco") or "", d.get("archivo") or "", int(d.get("movimientos") or 0), n, usuario, ahora()))
    bitacora(c, usuario, "CONCILIACION", None, {"banco": d.get("banco"), "archivo": d.get("archivo"), "conciliados": n})
    return {"ok": True, "conciliados": n}


def resumen_conciliacion(c):
    q = lambda sql: c.execute(sql).fetchone()[0]  # noqa: E731
    return {
        "historial": [dict(r) for r in c.execute("SELECT * FROM conciliaciones ORDER BY id DESC LIMIT 20")],
        "pagos_pendientes": q("SELECT COUNT(*) FROM pagos WHERE anulado=0 AND medio<>'Efectivo' AND COALESCE(conciliado,0)=0"),
        "pagos_conciliados": q("SELECT COUNT(*) FROM pagos WHERE anulado=0 AND COALESCE(conciliado,0)=1"),
        "egresos_pendientes": q("SELECT COUNT(*) FROM gastos WHERE anulado=0 AND medio<>'Efectivo' AND COALESCE(conciliado,0)=0")
        + q("SELECT COUNT(*) FROM pagos_comision WHERE anulado=0 AND medio<>'Efectivo' AND COALESCE(conciliado,0)=0"),
    }


def acciones(c, usuario, ruta, d):
    if ruta == "/api/gasto":
        return guardar_gasto(c, usuario, d)
    if ruta == "/api/gasto/anular":
        g = c.execute("SELECT * FROM gastos WHERE id=?", (int(d["id"]),)).fetchone()
        if not g or g["anulado"]:
            raise ErrorNegocio("El gasto no existe o ya está anulado.")
        if not (d.get("motivo") or "").strip():
            raise ErrorNegocio("Indique el motivo de la anulación.")
        c.execute("UPDATE gastos SET anulado=1, motivo_anulacion=?, fecha_anulacion=? WHERE id=?",
                  (d["motivo"].strip(), ahora(), g["id"]))
        bitacora(c, usuario, "GASTO_ANULADO", None, {"comprobante": g["comprobante"], "valor_bruto": g["valor_bruto"],
                                                     "motivo": d["motivo"].strip()})
        return {"ok": True}
    if ruta == "/api/presupuesto":
        for cat, val in (d.get("valores") or {}).items():
            if cat in CATEGORIAS:
                c.execute("INSERT INTO presupuesto (categoria, valor) VALUES (?,?) ON CONFLICT(categoria) DO UPDATE SET valor=excluded.valor",
                          (cat, round(num(val))))
        bitacora(c, usuario, "PRESUPUESTO", None, {"valores": d.get("valores")})
        return {"ok": True}
    if ruta == "/api/conciliacion/analizar":
        return analizar_extracto(c, d)
    if ruta == "/api/conciliacion/xlsx":
        return extractos.convertir(d)
    if ruta == "/api/conciliacion/confirmar":
        return confirmar_conciliacion(c, usuario, d)
    return None
