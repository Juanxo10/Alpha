# -*- coding: utf-8 -*-
"""Conciliación bancaria: lectura directa del extracto en Excel (.xlsx).

Los bancos entregan el extracto en Excel; antes había que guardarlo como CSV. Aquí se lee el .xlsx (sin programas
adicionales) y se convierte al mismo texto que ya entiende la conciliación, que sigue funcionando igual.
Las fechas que Excel guarda como número se convierten a dd/mm/aaaa.

Además, si se vuelve a cargar un extracto que ya se concilió (o uno que se cruza con otro), los movimientos que ya
están conciliados se muestran como «Ya conciliado» con la conciliación en que quedaron, y no como «sin registro».
"""
import base64
import binascii
import csv
import datetime as dt
import io
import json
import re
import zipfile
import xml.etree.ElementTree as ET


from .base import ErrorNegocio

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
R_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
FORMATOS_FECHA = {14, 15, 16, 17, 22, 27, 30, 36, 50, 57}


def _dias(a, b):
    return abs((dt.date.fromisoformat(a[:10]) - dt.date.fromisoformat(b[:10])).days)


def separar_ya_conciliados(c, r):
    """Saca de «en el banco, sin registro» los movimientos que corresponden a un registro ya conciliado
    (mismo valor, fecha a 6 días o menos; si la referencia aparece en la descripción, se prefiere ese registro)."""
    sin = r.get("sin_registro") or []
    if not sin:
        r["ya_conciliados"] = []
        return r
    ini = min(m["fecha"] for m in sin)
    fin = max(m["fecha"] for m in sin)
    rango = ((dt.date.fromisoformat(ini) - dt.timedelta(days=6)).isoformat(), (dt.date.fromisoformat(fin) + dt.timedelta(days=6)).isoformat())
    cands = [dict(x) | {"tabla": "pagos", "tipo": "Recibo"} for x in c.execute(
        "SELECT p.id, p.recibo numero, p.fecha, p.valor, p.medio, p.referencia, p.id_lote, p.conciliacion_ref, cl.nombre tercero FROM pagos p "
        "JOIN ventas v ON v.id=p.venta_id JOIN clientes cl ON cl.id=v.cliente_id WHERE p.anulado=0 AND p.conciliado=1 "
        "AND p.medio NOT IN ('Efectivo','En especie') AND p.fecha BETWEEN ? AND ?", rango)]
    cands += [dict(x) | {"tabla": "gastos", "tipo": "Gasto", "valor": -x["valor_neto"]} for x in c.execute(
        "SELECT id, comprobante numero, fecha, valor_neto, medio, referencia, conciliacion_ref, proveedor tercero FROM gastos "
        "WHERE anulado=0 AND conciliado=1 AND medio<>'Efectivo' AND fecha BETWEEN ? AND ?", rango)]
    cands += [dict(x) | {"tabla": "pagos_comision", "tipo": "Comisión", "valor": -x["valor_neto"]} for x in c.execute(
        "SELECT p.id, p.comprobante numero, p.fecha, p.valor_neto, p.medio, p.referencia, p.conciliacion_ref, cm.nombre tercero "
        "FROM pagos_comision p JOIN comisionistas cm ON cm.id=p.comisionista_id WHERE p.anulado=0 AND p.conciliado=1 "
        "AND p.medio<>'Efectivo' AND p.fecha BETWEEN ? AND ?", rango)]
    for g in c.execute("SELECT g.*, b.numero negocio, cl.nombre tercero FROM bloque_pagos g JOIN bloques b ON b.id=g.bloque_id "
                       "LEFT JOIN clientes cl ON cl.id=b.cliente_id WHERE g.conciliado=1 AND g.medio<>'Efectivo' AND g.fecha BETWEEN ? AND ?", rango):
        ids = json.loads(g["pagos"] or "[]")
        ref = c.execute("SELECT conciliacion_ref FROM pagos WHERE id=?", (ids[0],)).fetchone() if ids else None
        cands.append({"tabla": "bloque", "tipo": "Recibo consolidado", "id": g["id"], "numero": g["numero"], "fecha": g["fecha"],
                      "valor": g["valor"], "referencia": g["referencia"], "tercero": g["tercero"],
                      "id_lote": f"Negocio en bloque {g['negocio']}", "conciliacion_ref": ref[0] if ref else ""})
    usados, quedan, ya = set(), [], []
    for m in sin:
        mejores = []
        for k, x in enumerate(cands):
            if k in usados or round(x["valor"]) != round(m["valor"]):
                continue
            dd = _dias(x["fecha"], m["fecha"])
            if dd > 6:
                continue
            refx = (x.get("referencia") or "").strip().lower()
            mejores.append((dd - (5 if refx and refx in (m.get("descripcion") or "").lower() else 0), k))
        if mejores:
            k = min(mejores)[1]
            usados.add(k)
            ya.append({"movimiento": m, "registro": cands[k]})
        else:
            quedan.append(m)
    r["sin_registro"], r["ya_conciliados"] = quedan, ya
    return r


def _col(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def _fecha_excel(v):
    return (dt.date(1899, 12, 30) + dt.timedelta(days=float(v))).strftime("%d/%m/%Y")


def xlsx_a_filas(datos):
    try:
        z = zipfile.ZipFile(io.BytesIO(datos))
    except zipfile.BadZipFile:
        raise ErrorNegocio("El archivo no es un Excel .xlsx válido. Si es .xls (Excel antiguo), ábralo y guárdelo como .xlsx o .csv.")
    compartidas = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            compartidas.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    # estilos de celda que son fecha
    fecha_estilo = set()
    if "xl/styles.xml" in z.namelist():
        st = ET.fromstring(z.read("xl/styles.xml"))
        propios = {int(n.get("numFmtId")): n.get("formatCode", "") for n in st.findall("m:numFmts/m:numFmt", NS)}
        for i, xf in enumerate(st.findall("m:cellXfs/m:xf", NS)):
            fid = int(xf.get("numFmtId", 0))
            codigo = propios.get(fid, "").lower()
            if fid in FORMATOS_FECHA or (codigo and re.search(r"[dmy]", re.sub(r'"[^"]*"|\[[^\]]*\]', "", codigo)) and "0" not in codigo.split(";")[0][:1]):
                fecha_estilo.add(i)
    # primera hoja del libro
    libro = ET.fromstring(z.read("xl/workbook.xml"))
    hoja = libro.find("m:sheets/m:sheet", NS)
    destino = "xl/worksheets/sheet1.xml"
    if hoja is not None and "xl/_rels/workbook.xml.rels" in z.namelist():
        rid = hoja.get(R_NS)
        for rel in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")):
            if rel.get("Id") == rid:
                t = rel.get("Target").lstrip("/")
                destino = t if t.startswith("xl/") else "xl/" + t
    filas = []
    for row in ET.fromstring(z.read(destino)).iter(f"{{{NS['m']}}}row"):
        fila = {}
        for cel in row.findall("m:c", NS):
            tipo, estilo = cel.get("t"), int(cel.get("s", 0))
            v = cel.find("m:v", NS)
            if tipo == "s" and v is not None:
                val = compartidas[int(v.text)]
            elif tipo == "inlineStr":
                val = "".join(t.text or "" for t in cel.iter(f"{{{NS['m']}}}t"))
            elif v is not None and v.text is not None:
                val = v.text
                if tipo not in ("str", "b", "e") and estilo in fecha_estilo:
                    try:
                        val = _fecha_excel(val)
                    except (ValueError, OverflowError):
                        pass
                elif re.fullmatch(r"-?\d+\.\d{6,}", val):    # 1500000.0000001 → 1500000
                    val = format(round(float(val), 2), "f").rstrip("0").rstrip(".")
            else:
                val = ""
            fila[_col(cel.get("r"))] = val.strip()
        if any(fila.values()):
            filas.append([fila.get(i, "") for i in range(max(fila) + 1)])
    if not filas:
        raise ErrorNegocio("La primera hoja del Excel está vacía.")
    # el extracto suele traer títulos arriba: se arranca en la primera fila con al menos 3 columnas llenas
    inicio = next((i for i, f in enumerate(filas) if sum(1 for x in f if x) >= 3), 0)
    return filas[inicio:]


def convertir(d):
    nombre = (d.get("nombre") or "").lower()
    if not nombre.endswith((".xlsx", ".xlsm")):
        raise ErrorNegocio("Solo se convierten archivos .xlsx.")
    try:
        datos = base64.b64decode((d.get("contenido") or "").split(",")[-1], validate=True)
    except (binascii.Error, ValueError):
        raise ErrorNegocio("El archivo llegó dañado; inténtelo de nuevo.")
    if len(datos) > 15 * 1024 * 1024:
        raise ErrorNegocio("El extracto supera 15 MB.")
    filas = xlsx_a_filas(datos)
    salida = io.StringIO()
    csv.writer(salida, delimiter=";").writerows(filas)
    return {"texto": salida.getvalue(), "filas": len(filas)}
