# -*- coding: utf-8 -*-
"""Exportaciones a CSV (se abren directo en Excel: separador «;» y codificación con BOM)."""
import csv
import io
import json

from .base import ErrorNegocio


def csv_texto(filas, columnas):
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow([t for _, t in columnas])
    for f in filas:
        w.writerow([("" if f.get(k) is None else (str(round(f[k])) if isinstance(f[k], float) else f[k])) for k, _ in columnas])
    return "﻿" + buf.getvalue()


def exportar(c, nombre):
    from . import cartera, cobranza, comisiones, finanzas, prospectos
    if nombre == "cartera.csv":
        return csv_texto(cartera.resumen_lotes(c), [
            ("id_lote", "Lote"), ("manzana", "Manzana"), ("lote", "N° lote"), ("area_m2", "Área m²"),
            ("estado", "Estado"), ("cartera", "Cartera"), ("cliente", "Comprador"), ("documento", "Documento"),
            ("telefono", "Teléfono"), ("fecha_venta", "Fecha negocio"), ("precio_lista", "Precio de lista"),
            ("valor_venta", "Valor venta"), ("pagado", "Pagado"), ("saldo", "Saldo"), ("vencido", "Vencido"),
            ("dias_mora", "Días mora"), ("proxima_fecha", "Próxima cuota"), ("proxima_valor", "Valor próxima")])
    if nombre == "pagos.csv":
        filas = [dict(r) for r in c.execute(
            "SELECT p.recibo, p.fecha, p.id_lote, cl.nombre cliente, cl.documento, p.concepto, p.medio, p.referencia, p.valor, "
            "CASE p.anulado WHEN 1 THEN 'ANULADO' ELSE '' END anulado, p.motivo_anulacion, "
            "CASE COALESCE(p.conciliado,0) WHEN 1 THEN 'SÍ' ELSE '' END conciliado, p.usuario "
            "FROM pagos p JOIN ventas v ON v.id=p.venta_id JOIN clientes cl ON cl.id=v.cliente_id ORDER BY p.recibo")]
        return csv_texto(filas, [("recibo", "Recibo"), ("fecha", "Fecha"), ("id_lote", "Lote"), ("cliente", "Comprador"),
                                 ("documento", "Documento"), ("concepto", "Concepto"), ("medio", "Medio"),
                                 ("referencia", "Referencia"), ("valor", "Valor"), ("anulado", "Anulado"),
                                 ("motivo_anulacion", "Motivo anulación"), ("conciliado", "Conciliado"), ("usuario", "Registró")])
    if nombre == "comisiones.csv":
        filas = comisiones.listar_comisiones(c)
        for f in filas:
            f["estado_txt"] = f["estado_comision"].replace("_", " ").title()
        return csv_texto(filas, [("comisionista", "Comisionista"), ("doc_comisionista", "Documento"), ("id_lote", "Lote"),
                                 ("cliente", "Comprador"), ("fecha_venta", "Fecha negocio"), ("valor_venta", "Valor venta"),
                                 ("porcentaje", "% comisión"), ("regla_nombre", "Causación"), ("valor_comision", "Comisión"),
                                 ("pct_recaudo", "% recaudo lote"), ("causado", "Causado"), ("pagado", "Pagado"),
                                 ("por_pagar", "Por pagar"), ("estado_txt", "Estado")])
    if nombre == "pagos_comision.csv":
        filas = [dict(r) for r in c.execute(
            "SELECT p.*, cm.nombre comisionista, cm.documento, CASE p.anulado WHEN 1 THEN 'ANULADO' ELSE '' END anul "
            "FROM pagos_comision p JOIN comisionistas cm ON cm.id=p.comisionista_id ORDER BY p.comprobante")]
        return csv_texto(filas, [("comprobante", "Comprobante"), ("fecha", "Fecha"), ("comisionista", "Comisionista"),
                                 ("documento", "Documento"), ("valor_bruto", "Valor bruto"), ("retencion", "Retención"),
                                 ("valor_neto", "Valor neto"), ("medio", "Medio"), ("referencia", "Referencia"),
                                 ("anul", "Anulado"), ("motivo_anulacion", "Motivo anulación"), ("usuario", "Registró")])
    if nombre == "gastos.csv":
        filas = finanzas.listar_gastos(c)
        for f in filas:
            f["anul"] = "ANULADO" if f["anulado"] else ""
        return csv_texto(filas, [("comprobante", "Comprobante"), ("fecha", "Fecha"), ("categoria", "Categoría"),
                                 ("proveedor", "Proveedor"), ("documento_proveedor", "NIT / documento"), ("factura", "Factura"),
                                 ("descripcion", "Descripción"), ("valor_bruto", "Valor bruto"), ("retencion", "Retención"),
                                 ("valor_neto", "Valor neto"), ("medio", "Medio"), ("referencia", "Referencia"),
                                 ("anul", "Anulado"), ("motivo_anulacion", "Motivo anulación"), ("usuario", "Registró")])
    if nombre == "flujo.csv":
        f = finanzas.flujo(c)
        return csv_texto(f["meses"], [("mes", "Mes"), ("ingresos", "Ingresos"), ("egresos", "Egresos"), ("neto", "Neto"),
                                      ("acumulado", "Caja acumulada"), ("proyectado", "Recaudo proyectado")])
    if nombre == "cobranza.csv":
        filas = cobranza.agenda(c, 60)["filas"]
        for f in filas:
            g = f.get("ultima_gestion") or {}
            f["gestion"] = f"{g.get('fecha', '')} {g.get('tipo', '')}: {g.get('resultado', '')}" if g else ""
            f["comp"] = f"{f['compromiso']['fecha']} ({f['compromiso']['estado']})" if f.get("compromiso") else ""
        return csv_texto(filas, [("tipo", "Situación"), ("id_lote", "Lote"), ("cliente", "Comprador"), ("telefono", "Teléfono"),
                                 ("email", "Correo"), ("fecha", "Fecha"), ("valor", "Valor"), ("dias", "Días"),
                                 ("saldo", "Saldo"), ("gestion", "Última gestión"), ("comp", "Compromiso")])
    if nombre == "prospectos.csv":
        filas = prospectos.listar(c)["prospectos"]
        return csv_texto(filas, [("nombre", "Nombre"), ("telefono", "Teléfono"), ("email", "Correo"), ("origen", "Origen"),
                                 ("comisionista", "Comisionista"), ("lotes_interes", "Lotes de interés"),
                                 ("presupuesto", "Presupuesto"), ("estado", "Estado"), ("fecha_proxima", "Próximo seguimiento"),
                                 ("proxima_accion", "Acción"), ("creado", "Registrado")])
    if nombre == "auditoria.csv":
        filas = [dict(r) for r in c.execute("SELECT id, fecha, usuario, accion, id_lote, detalle, hash FROM bitacora ORDER BY id")]
        return csv_texto(filas, [("id", "N°"), ("fecha", "Fecha"), ("usuario", "Usuario"), ("accion", "Acción"),
                                 ("id_lote", "Lote"), ("detalle", "Detalle"), ("hash", "Sello")])
    if nombre == "historial_precios.csv":
        filas = []
        for r in c.execute("SELECT fecha, usuario, id_lote, accion, detalle FROM bitacora WHERE accion IN ('PRECIO_LOTE','PRECIO_MASIVO') ORDER BY id"):
            d = json.loads(r["detalle"] or "{}")
            for lote, antes, despues in ([[r["id_lote"], d.get("antes"), d.get("despues")]] if r["accion"] == "PRECIO_LOTE" else d.get("cambios", [])):
                filas.append({"fecha": r["fecha"], "usuario": r["usuario"], "id_lote": lote, "antes": antes, "despues": despues})
        return csv_texto(filas, [("fecha", "Fecha"), ("id_lote", "Lote"), ("antes", "Precio anterior"),
                                 ("despues", "Precio nuevo"), ("usuario", "Cambió")])
    raise ErrorNegocio("Reporte desconocido.")
