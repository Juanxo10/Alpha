# -*- coding: utf-8 -*-
"""Documentos: expediente del lote (archivos), cotizaciones y datos para promesa, paz y salvo y certificados."""
import base64
import binascii
import hashlib
import mimetypes
import os
import re

from . import base
from .base import ErrorNegocio, ahora, bitacora, config, hoy, num, siguiente_consecutivo, sumar_meses

TIPOS_ADJUNTO = ["Documento de identidad", "Promesa de compraventa", "Comprobante de pago", "Escritura pública",
                 "Certificado de tradición", "Paz y salvo", "Acuerdo de pago", "Correspondencia", "Otro"]
EXTENSIONES = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".doc", ".docx", ".xls", ".xlsx", ".txt"}
MAX_MB = 15


def subir_adjunto(c, usuario, d):
    id_lote = d.get("id_lote")
    if not c.execute("SELECT 1 FROM lotes WHERE id_lote=?", (id_lote,)).fetchone():
        raise ErrorNegocio("El lote no existe.")
    tipo = d.get("tipo") if d.get("tipo") in TIPOS_ADJUNTO else "Otro"
    nombre = os.path.basename((d.get("nombre") or "").strip()) or "documento"
    ext = os.path.splitext(nombre)[1].lower()
    if ext not in EXTENSIONES:
        raise ErrorNegocio("Tipo de archivo no permitido. Use PDF, imagen, Word o Excel.")
    try:
        datos = base64.b64decode((d.get("contenido") or "").split(",")[-1], validate=True)
    except (binascii.Error, ValueError):
        raise ErrorNegocio("El archivo llegó dañado; inténtelo de nuevo.")
    if not datos:
        raise ErrorNegocio("El archivo está vacío.")
    if len(datos) > MAX_MB * 1024 * 1024:
        raise ErrorNegocio(f"El archivo supera {MAX_MB} MB.")
    carpeta = os.path.join(base.EXPEDIENTES, id_lote)
    os.makedirs(carpeta, exist_ok=True)
    limpio = re.sub(r"[^A-Za-z0-9._-]+", "_", nombre)[-80:]
    archivo = f"{ahora().replace(':', '').replace(' ', '_').replace('-', '')}_{limpio}"
    with open(os.path.join(carpeta, archivo), "wb") as f:
        f.write(datos)
    sha = hashlib.sha256(datos).hexdigest()
    venta = c.execute("SELECT id FROM ventas WHERE id_lote=? AND estado='ACTIVA'", (id_lote,)).fetchone()
    aid = c.execute("INSERT INTO adjuntos (id_lote, venta_id, tipo, nombre, archivo, tamano, sha256, descripcion, usuario, creado) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)", (id_lote, venta[0] if venta else None, tipo, nombre, archivo, len(datos),
                                                     sha, (d.get("descripcion") or "").strip(), usuario, ahora())).lastrowid
    bitacora(c, usuario, "ADJUNTO", id_lote, {"adjunto_id": aid, "tipo": tipo, "nombre": nombre, "sha256": sha})
    return {"ok": True, "id": aid}


def archivo_adjunto(c, aid):
    a = c.execute("SELECT * FROM adjuntos WHERE id=?", (aid,)).fetchone()
    if not a:
        raise ErrorNegocio("El documento no existe.")
    ruta = os.path.join(base.EXPEDIENTES, a["id_lote"], a["archivo"])
    if not os.path.exists(ruta):
        raise ErrorNegocio("El archivo no se encuentra en el expediente.")
    with open(ruta, "rb") as f:
        datos = f.read()
    integro = hashlib.sha256(datos).hexdigest() == a["sha256"]
    return ruta, a["nombre"], mimetypes.guess_type(a["nombre"])[0] or "application/octet-stream", datos, integro


def cotizar(c, usuario, d):
    l = c.execute("SELECT * FROM lotes WHERE id_lote=?", (d.get("id_lote"),)).fetchone()
    if not l:
        raise ErrorNegocio("El lote no existe.")
    if c.execute("SELECT 1 FROM ventas WHERE id_lote=? AND estado='ACTIVA'", (l["id_lote"],)).fetchone():
        raise ErrorNegocio("El lote ya está negociado.")
    if not (d.get("nombre") or "").strip():
        raise ErrorNegocio("Indique a nombre de quién va la cotización.")
    valor = round(num(d.get("valor"), l["precio_lista"] or 0))
    inicial = round(num(d.get("cuota_inicial")))
    n = int(num(d.get("n_cuotas")))
    if valor <= 0:
        raise ErrorNegocio("El lote no tiene precio; indique el valor.")
    if inicial > valor or not 0 <= n <= 360:
        raise ErrorNegocio("Revise la cuota inicial y el número de cuotas.")
    num_ = siguiente_consecutivo(c, "consecutivo_cotizacion")
    fp = d.get("fecha_primera") or sumar_meses(hoy(), 1).isoformat()
    cid = c.execute("INSERT INTO cotizaciones (numero, id_lote, nombre, telefono, email, prospecto_id, precio_lista, valor, "
                    "cuota_inicial, n_cuotas, fecha_primera, validez_dias, observacion, usuario, creado) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (num_, l["id_lote"], d["nombre"].strip(), (d.get("telefono") or "").strip(), (d.get("email") or "").strip(),
                     int(d["prospecto_id"]) if d.get("prospecto_id") else None, l["precio_lista"], valor, inicial, n, fp,
                     int(num(d.get("validez_dias"), num(config(c).get("cotizacion_validez_dias"), 15))),
                     (d.get("observacion") or "").strip(), usuario, ahora())).lastrowid
    bitacora(c, usuario, "COTIZACION", l["id_lote"], {"cotizacion_id": cid, "numero": num_, "nombre": d["nombre"].strip(),
                                                     "valor": valor})
    if d.get("prospecto_id"):
        c.execute("INSERT INTO prospecto_notas (prospecto_id, fecha, tipo, nota, usuario) VALUES (?,?,?,?,?)",
                  (int(d["prospecto_id"]), hoy().isoformat(), "COTIZACION",
                   f"Cotización COT-{num_:05d} del lote {l['id_lote']} por ${valor:,.0f}".replace(",", "."), usuario))
    return {"ok": True, "id": cid, "numero": num_}


def datos_documento(c, tipo, id_):
    """Datos para armar en el navegador la promesa, el paz y salvo, el certificado de pagos o la cotización."""
    from . import cartera
    cfg = {k: v for k, v in config(c).items() if k not in base.CONFIG_SECRETA}
    if tipo == "cotizacion":
        q = c.execute("SELECT * FROM cotizaciones WHERE id=?", (int(id_),)).fetchone()
        if not q:
            raise ErrorNegocio("Cotización no encontrada.")
        return {"tipo": tipo, "cotizacion": dict(q), "lote": dict(c.execute("SELECT * FROM lotes WHERE id_lote=?",
                                                                             (q["id_lote"],)).fetchone()), "config": cfg}
    v = c.execute("SELECT * FROM ventas WHERE id=?", (int(id_),)).fetchone()
    if not v:
        raise ErrorNegocio("Venta no encontrada.")
    det = cartera.detalle_lote(c, v["id_lote"])
    venta = next(x for x in det["ventas"] if x["id"] == v["id"])
    if tipo == "pazysalvo" and venta["saldo"] > 0.5:
        raise ErrorNegocio("El negocio aún tiene saldo: no se puede expedir paz y salvo.")
    if tipo == "promesa" and venta["etapa"] == "SEPARADO":
        raise ErrorNegocio("Primero formalice la venta: la promesa se genera sobre un negocio vendido.")
    return {"tipo": tipo, "detalle": det, "venta": venta, "config": cfg}


def acciones(c, usuario, ruta, d):
    if ruta == "/api/adjunto/subir":
        return subir_adjunto(c, usuario, d)
    if ruta == "/api/adjunto/eliminar":
        a = c.execute("SELECT * FROM adjuntos WHERE id=?", (int(d["id"]),)).fetchone()
        if not a or a["eliminado"]:
            raise ErrorNegocio("El documento no existe.")
        if not (d.get("motivo") or "").strip():
            raise ErrorNegocio("Indique el motivo.")
        c.execute("UPDATE adjuntos SET eliminado=1, motivo_eliminacion=? WHERE id=?", (d["motivo"].strip(), a["id"]))
        bitacora(c, usuario, "ADJUNTO_ELIMINADO", a["id_lote"], {"adjunto_id": a["id"], "nombre": a["nombre"],
                                                                "motivo": d["motivo"].strip()})
        return {"ok": True}
    if ruta == "/api/cotizacion":
        return cotizar(c, usuario, d)
    return None
