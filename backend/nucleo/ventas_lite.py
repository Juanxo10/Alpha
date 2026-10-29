# -*- coding: utf-8 -*-
"""Ventas con su estado financiero, plan y pagos, cargadas en pocas consultas.

cartera.detalle_lote arma la ficha completa de UN lote (~16 consultas: bitácora, adjuntos, comisiones, resumen de todo el
proyecto…). Con Supabase cada consulta cuesta ~130 ms, así que los negocios en bloque y los contratos —que necesitan solo el
estado de cada venta— usan esto: 4 consultas sin importar cuántos lotes sean.
"""
from collections import defaultdict

from . import cartera


def cargar(c, venta_ids):
    """{venta_id: venta con pagos, plan, saldo, mora… (lo mismo que detalle_lote["ventas"]) y su lote en d["lote"]}."""
    ids = sorted({int(i) for i in venta_ids})
    if not ids:
        return {}
    marcas = ",".join("?" * len(ids))
    gracia, tasa = cartera.parametros_mora(c)
    ventas = c.execute("SELECT v.*, cl.nombre, cl.tipo_doc, cl.documento, cl.telefono, cl.email, cl.direccion FROM ventas v "
                       f"JOIN clientes cl ON cl.id=v.cliente_id WHERE v.id IN ({marcas})", ids).fetchall()
    pagos, reests = defaultdict(list), defaultdict(list)
    for p in c.execute(f"SELECT * FROM pagos WHERE venta_id IN ({marcas}) ORDER BY fecha, id", ids):
        pagos[p["venta_id"]].append(dict(p))
    for r in c.execute(f"SELECT * FROM reestructuraciones WHERE venta_id IN ({marcas}) ORDER BY id", ids):
        reests[r["venta_id"]].append(dict(r))
    lotes_ids = sorted({v["id_lote"] for v in ventas})
    lotes = {r["id_lote"]: dict(r) for r in c.execute(
        f"SELECT * FROM lotes WHERE id_lote IN ({','.join('?' * len(lotes_ids))})", lotes_ids)} if lotes_ids else {}
    salida = {}
    for v in ventas:
        ps, rs = pagos[v["id"]], reests[v["id"]]
        pagado = sum(p["valor"] for p in ps if not p["anulado"])
        d = dict(v)
        d["pagos"], d["pagado"], d["lote"] = ps, pagado, lotes.get(v["id_lote"], {})
        d.update(cartera.estado_financiero(v, pagado, gracia, tasa, rs[-1] if rs else None))
        salida[v["id"]] = d
    return salida
