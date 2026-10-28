# -*- coding: utf-8 -*-
"""Contratos del negocio: promesa de compraventa, acuerdo de separación, otrosí, acta de entrega, resciliación y
cesión de derechos.

Cada tipo de contrato sale de una PLANTILLA de texto que el dueño puede ajustar con su abogado (sin programar):
  **texto**            negrita
  ## Título            subtítulo de sección
  {{variable}}         dato del negocio (comprador, lote, valores…)
  {{#var}}…{{/var}}    el texto solo aparece si el dato existe / es verdadero
  {{^var}}…{{/var}}    el texto solo aparece si el dato NO existe
  línea en blanco      separa párrafos
Al generarlo, el contrato queda numerado (PCV-0001, SEP-0001…), con una copia fija de su texto y su huella sha256:
lo que se firmó no cambia aunque después se modifique la plantilla o el negocio. Luego se registra la firma (con el
escaneo en el expediente del lote) o se anula con motivo (un operador necesita aprobación de un dueño).
"""
import datetime as dt
import hashlib
import html
import json
import os
import re
import base64
import io
import zipfile

from . import base, cartera, seguridad, ventas_lite
from .plantillas_contratos import TEXTOS
from .base import ErrorNegocio, ahora, bitacora, config, hoy, num


TIPOS = {
    "PROMESA": {"nombre": "Promesa de compraventa", "prefijo": "PCV", "etapas": ("VENDIDO", "ESCRITURADO"),
                "adjunto": "Promesa de compraventa", "icono": "file-signature",
                "ayuda": "Formaliza la venta: objeto, precio, plan de pagos, escritura y cláusula penal."},
    "SEPARACION": {"nombre": "Acuerdo de separación", "prefijo": "SEP", "etapas": ("SEPARADO",),
                   "adjunto": "Acuerdo de pago", "icono": "bookmark",
                   "ayuda": "Reserva el lote con el abono de separación y su fecha límite."},
    "OTROSI": {"nombre": "Otrosí de forma de pago", "prefijo": "OTS", "etapas": ("VENDIDO", "ESCRITURADO"),
               "adjunto": "Acuerdo de pago", "icono": "file-pen-line",
               "ayuda": "Modifica la forma de pago del saldo (después de un abono a capital o una reestructuración).",
               "campos": [{"k": "motivo_otrosi", "et": "Consideraciones (por qué se modifica el plan)", "tipo": "texto", "req": True,
                           "def": "Las partes acordaron modificar la forma de pago del saldo pendiente del negocio."}]},
    "ACTA_ENTREGA": {"nombre": "Acta de entrega del lote", "prefijo": "ACT", "etapas": ("VENDIDO", "ESCRITURADO"),
                     "adjunto": "Otro", "icono": "key-round",
                     "ayuda": "Deja constancia de la entrega material del lote en terreno.",
                     "campos": [{"k": "fecha_entrega", "et": "Fecha de la entrega", "tipo": "fecha", "req": True},
                                {"k": "observaciones_entrega", "et": "Observaciones (mojones, estado del lote, servicios)", "tipo": "texto",
                                 "def": "El lote se entrega con sus mojones visibles y sin observaciones adicionales."}]},
    "RESCILIACION": {"nombre": "Resciliación (terminación de mutuo acuerdo)", "prefijo": "RES", "etapas": ("SEPARADO", "VENDIDO"),
                     "estados": ("ACTIVA", "DESISTIDA"), "adjunto": "Otro", "icono": "file-x",
                     "ayuda": "Termina el negocio de mutuo acuerdo y fija la devolución al comprador.",
                     "campos": [{"k": "valor_devolucion", "et": "Valor a devolver al comprador", "tipo": "dinero", "req": True},
                                {"k": "plazo_devolucion", "et": "Plazo para la devolución", "tipo": "texto",
                                 "def": "treinta (30) días calendario contados desde la firma"}]},
    "CESION": {"nombre": "Cesión de derechos", "prefijo": "CES", "etapas": ("VENDIDO",), "adjunto": "Otro", "icono": "users",
               "ayuda": "El comprador cede su negocio a otra persona, con aceptación del vendedor.",
               "campos": [{"k": "cesionario_nombre", "et": "Nombre completo del cesionario", "tipo": "texto", "req": True},
                          {"k": "cesionario_tipo_doc", "et": "Tipo de documento", "tipo": "texto", "def": "C.C."},
                          {"k": "cesionario_documento", "et": "Número de documento", "tipo": "texto", "req": True},
                          {"k": "cesionario_direccion", "et": "Dirección", "tipo": "texto"},
                          {"k": "cesionario_telefono", "et": "Teléfono", "tipo": "texto"}]},
    "DACION": {"nombre": "Dación en pago", "prefijo": "DAC", "etapas": ("SEPARADO", "VENDIDO", "ESCRITURADO"),
               "adjunto": "Otro", "icono": "car", "modalidad": "DACION",
               "ayuda": "El comprador entrega un bien (vehículo, inmueble, otro) como parte del pago del lote.",
               "campos": [{"k": "bien_id", "et": "Bien recibido", "tipo": "bien", "req": True}]},
    "PERMUTA": {"nombre": "Contrato de permuta", "prefijo": "PER", "etapas": ("SEPARADO", "VENDIDO", "ESCRITURADO"),
                "adjunto": "Otro", "icono": "repeat", "modalidad": "PERMUTA",
                "ayuda": "Se cambia el lote por un bien del comprador; si hay diferencia de valor, se paga en dinero.",
                "campos": [{"k": "bien_id", "et": "Bien recibido en permuta", "tipo": "bien", "req": True}]},
    "AUTORIZACION_DATOS": {"nombre": "Autorización de tratamiento de datos personales", "prefijo": "ADP",
                           "etapas": ("SEPARADO", "VENDIDO", "ESCRITURADO"), "adjunto": "Otro", "icono": "shield-check",
                           "ayuda": "El comprador autoriza el tratamiento de sus datos personales (Ley 1581 de 2012). Se firma una vez por comprador."},
    "PROMESA_BLOQUE": {"nombre": "Promesa de compraventa en bloque", "prefijo": "PCB", "etapas": ("VENDIDO", "ESCRITURADO"),
                       "adjunto": "Promesa de compraventa", "icono": "layers", "bloque": True,
                       "ayuda": "Una sola promesa para todos los lotes del negocio en bloque, con el cuadro de lotes y el plan único.",
                       "campos": [{"k": "bloque_id", "et": "Negocio en bloque", "tipo": "bloque", "req": True}]},
}
BLOQUES = {"plan_pagos", "plan_pendiente", "firmas", "lotes_bloque", "plan_bloque"}       # variables que insertan tablas o bloques, no texto

ESQUEMA = """
CREATE TABLE IF NOT EXISTS contratos (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, numero TEXT UNIQUE, tipo TEXT NOT NULL, venta_id INTEGER NOT NULL REFERENCES ventas(id),
  id_lote TEXT, estado TEXT NOT NULL DEFAULT 'GENERADO', campos TEXT, texto_html TEXT NOT NULL, sha256 TEXT,
  plantilla_version INTEGER, generado TEXT, generado_por TEXT, fecha_firma TEXT, firma_registrada_por TEXT,
  adjunto_id INTEGER, motivo_anulacion TEXT, fecha_anulacion TEXT);
CREATE INDEX IF NOT EXISTS ix_contratos_venta ON contratos(venta_id);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS matricula TEXT;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS cedula_catastral TEXT;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS nota_registral TEXT;
CREATE TABLE IF NOT EXISTS contrato_plantillas (tipo TEXT PRIMARY KEY, texto TEXT NOT NULL, version INTEGER NOT NULL, actualizado TEXT, usuario TEXT);
CREATE TABLE IF NOT EXISTS contrato_plantillas_hist (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tipo TEXT, texto TEXT, version INTEGER,
  reemplazada TEXT, usuario TEXT);
CREATE TABLE IF NOT EXISTS contrato_tipos (tipo TEXT PRIMARY KEY, nombre TEXT NOT NULL, prefijo TEXT NOT NULL, ayuda TEXT);
"""

# rutas y permisos (se suman a las reglas de seguridad del geovisor)
LIBRES = {"/api/contrato/vista", "/api/contrato/generar", "/api/contrato/firmar"}
CON_APROBACION = {"/api/contrato/anular"}
SOLO_DUENO = {"/api/plantilla/guardar", "/api/plantilla/restaurar", "/api/plantilla/nueva", "/api/plantilla/eliminar", "/api/plantilla/importar", "/api/lote/inmueble"}


def iniciar(c):
    base.crear_tablas(c, ESQUEMA)
    cargar_propios(c)
    seguridad.LIBRE_OPERADOR.update(LIBRES)
    seguridad.REQUIERE_APROBACION.update(CON_APROBACION)
    seguridad.SOLO_DUENO.update(SOLO_DUENO)
    original = seguridad.resumen_solicitud
    if getattr(original, "_nf", False):
        return

    def resumen(c2, ruta, d):
        if ruta == "/api/contrato/anular":
            k = c2.execute("SELECT numero, tipo, id_lote FROM contratos WHERE id=?", (int(d.get("id") or 0),)).fetchone()
            if k:
                return f"Anular el contrato {k['numero']} ({TIPOS[k['tipo']]['nombre']}) del lote {k['id_lote']}. Motivo: {d.get('motivo', '')}", k["id_lote"]
        return original(c2, ruta, d)
    resumen._nf = True
    seguridad.resumen_solicitud = resumen


# ---------------------------------------------------------------- formatos
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
UNI = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce",
       "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
       "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"]
DEC = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"]
CEN = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"]


def _menor_mil(n):
    if n == 0:
        return ""
    if n == 100:
        return "cien"
    c, r = divmod(n, 100)
    partes = [CEN[c]] if c else []
    if r < 30:
        partes.append(UNI[r])
    else:
        d, u = divmod(r, 10)
        partes.append(DEC[d] + (f" y {UNI[u]}" if u else ""))
    return " ".join(p for p in partes if p)


def _apocope(t):
    """«uno» delante de «mil» o «millones» se escribe «un» (veintiuno → veintiún)."""
    return re.sub(r"veintiuno$", "veintiún", re.sub(r"(?<!veinti)uno$", "un", t))


def _hasta_millon(n, antes_de_millones=False):
    miles, u = divmod(n, 1000)
    partes = []
    if miles:
        partes.append("mil" if miles == 1 else _apocope(_menor_mil(miles)) + " mil")
    if u:
        partes.append(_apocope(_menor_mil(u)))      # «veintiún millones», «treinta y un pesos»
    return " ".join(partes)


def letras(valor):
    """Valor en pesos escrito en letras: «veinte millones de pesos m/cte»."""
    n = int(round(num(valor, 0)))
    if n <= 0:
        return "cero pesos m/cte"
    if n == 1:
        return "un peso m/cte"
    millones, resto = divmod(n, 1_000_000)
    partes = []
    if millones:
        partes.append("un millón" if millones == 1 else _hasta_millon(millones, True) + " millones")
    if resto:
        partes.append(_hasta_millon(resto))
    de = " de" if millones and not resto else ""
    return f"{' '.join(partes)}{de} pesos m/cte"


def pesos(v):
    return "$" + format(int(round(num(v, 0))), ",d").replace(",", ".")


def fecha_larga(s):
    if not s:
        return "________"
    f = s if isinstance(s, dt.date) else dt.date.fromisoformat(str(s)[:10])
    return f"{f.day} de {MESES[f.month - 1]} de {f.year}"


def dec(v, n=1):
    return format(round(num(v, 0), n), f",.{n}f").replace(",", "X").replace(".", ",").replace("X", ".")


# ---------------------------------------------------------------- datos técnicos del lote (cartografía)
def props_lote(id_lote):
    _GEO = base.tenant.actual().cache.setdefault("geo", {"mtime": None, "props": {}})      # una caché por cliente
    ruta = os.path.join(base.CARTO, "lotes.geojson")
    m = os.path.getmtime(ruta)
    if _GEO["mtime"] != m:
        with open(ruta, encoding="utf-8") as f:
            _GEO["props"] = {ft["properties"]["id_lote"]: ft["properties"] for ft in json.load(f)["features"]}
        _GEO["mtime"] = m
    return _GEO["props"].get(id_lote, {})


ORDEN_RUMBO = {"Norte": 0, "Oriente": 1, "Sur": 2, "Occidente": 3}


def colindante(k):
    m = re.match(r"^MZ(\d+)-L(\d+)$", k or "")
    return f"Lote {int(m[2])} (Mz {int(m[1])})" if m else k


# ---------------------------------------------------------------- variables de un negocio
def variables(c, venta_id, campos=None, numero=None):
    v = ventas_lite.cargar(c, [venta_id]).get(int(venta_id))
    if not v:
        raise ErrorNegocio("Negocio no encontrado.")
    v0 = v
    l, p, cfg = v["lote"], props_lote(v0["id_lote"]), config(c)
    ciudad = cfg.get("ciudad") or "________"
    lind = sorted(p.get("linderos") or [], key=lambda x: ORDEN_RUMBO.get(x["rumbo"], 9))
    plan = v.get("plan") or []
    cuotas = [x for x in plan if x.get("n", 0) >= 1]
    sep = sum(x["valor"] for x in v.get("pagos", []) if not x.get("anulado") and "separ" in (x.get("concepto") or "").lower())
    prom = c.execute("SELECT numero, generado, fecha_firma FROM contratos WHERE venta_id=? AND tipo='PROMESA' AND estado IN ('GENERADO','FIRMADO') "
                     "ORDER BY estado='FIRMADO' DESC, id DESC LIMIT 1", (v0["id"],)).fetchone()
    mora = cartera.tasa_mora_efectiva(cfg)       # nunca por encima de la tasa de usura
    var = {
        "numero_contrato": numero or "(sin número)", "fecha_hoy": fecha_larga(hoy()), "proyecto": cfg.get("proyecto") or "",
        "ciudad": ciudad,
        "vendedor_nombre": cfg.get("vendedor_razon_social") or cfg.get("proyecto") or "", "vendedor_nit": cfg.get("vendedor_nit") or "",
        "vendedor_representante": cfg.get("vendedor_representante") or "", "vendedor_representante_doc": cfg.get("vendedor_representante_doc") or "",
        "vendedor_direccion": cfg.get("vendedor_direccion") or "", "vendedor_telefono": cfg.get("vendedor_telefono") or "",
        "vendedor_email": cfg.get("vendedor_email") or "", "cuenta_bancaria": cfg.get("cuenta_bancaria") or "",
        "notaria": cfg.get("notaria_escrituracion") or f"Notaría ______ del Círculo de {ciudad}",
        "plazo_escritura_meses": cfg.get("promesa_plazo_escritura_meses") or "___",
        "penalidad_pct": f"{dec(cfg.get('promesa_penalidad_pct'), 1)} %", "tasa_mora": f"{dec(mora, 2)} %",
        "comprador_nombre": v["nombre"], "comprador_tipo_doc": v.get("tipo_doc") or "C.C.", "comprador_documento": v.get("documento") or "",
        "comprador_direccion": v.get("direccion") or "", "comprador_telefono": v.get("telefono") or "", "comprador_email": v.get("email") or "",
        "lote_codigo": l["id_lote"], "lote_numero": str(l["lote"]), "manzana": str(l["manzana"]),
        "lote_matricula": l.get("matricula") or "", "lote_cedula_catastral": l.get("cedula_catastral") or "",
        "tiene_matricula": bool(l.get("matricula")),
        "area_m2": dec(l["area_m2"]), "perimetro_m": dec(p.get("perimetro_m")), "frente_m": dec(p.get("frente_m")), "fondo_m": dec(p.get("fondo_m")),
        "pct_predio": f"{dec(p.get('pct_predio'), 4)} %" if p.get("pct_predio") is not None else "",
        "area_predio": f"{dec(p.get('area_predio_m2'))} m² = {dec(num(p.get('area_predio_m2'), 0) / 10000, 4)} ha" if p.get("area_predio_m2") else "",
        "linderos": "; ".join(f"por el {x['rumbo'].lower()}, en {dec(x['longitud_m'])} m, con {' y '.join(colindante(k) for k in x['colinda'])}"
                              for x in lind) or "________",
        "coordenadas": f"E {dec(p.get('este'), 0)} · N {dec(p.get('norte'), 0)}" if p.get("este") else "",
        "valor_venta": pesos(v["valor_venta"]), "valor_venta_letras": letras(v["valor_venta"]),
        "precio_referencia": pesos(v["valor_venta"] or l.get("precio_lista")), "precio_referencia_letras": letras(v["valor_venta"] or l.get("precio_lista")),
        "cuota_inicial": pesos(v["cuota_inicial"]), "cuota_inicial_letras": letras(v["cuota_inicial"]),
        "saldo_financiado": pesos((v["valor_venta"] or 0) - (v["cuota_inicial"] or 0)),
        "n_cuotas": str(v.get("n_cuotas") or 0), "valor_cuota": pesos(cuotas[0]["valor"]) if cuotas else "",
        "fecha_venta": fecha_larga(v.get("fecha_venta")), "fecha_primera_cuota": fecha_larga(v.get("fecha_primera_cuota")),
        "fecha_ultima_cuota": fecha_larga(v.get("fecha_fin")),
        "pagado": pesos(v["pagado"]), "pagado_letras": letras(v["pagado"]), "saldo": pesos(v["saldo"]), "saldo_letras": letras(v["saldo"]),
        "valor_separacion": pesos(sep), "valor_separacion_letras": letras(sep),
        "fecha_separacion": fecha_larga(v.get("fecha_separacion")), "fecha_limite_separacion": fecha_larga(v.get("fecha_limite_separacion")),
        "promesa_numero": prom["numero"] if prom else "", "promesa_fecha": fecha_larga((prom["fecha_firma"] or prom["generado"]) if prom else None) if prom else "",
        # condiciones para los bloques {{#…}}
        "tiene_cuota_inicial": 0 < (v["cuota_inicial"] or 0) < (v["valor_venta"] or 0), "tiene_cuotas": bool(v.get("n_cuotas")),
        "es_contado": not v.get("n_cuotas"),
        "fecha_contado": fecha_larga(cuotas[0]["fecha"] if cuotas else v.get("fecha_venta")),   # la del plan de pagos
        "tiene_pagos": v["pagado"] > 0.5, "tiene_saldo": v["saldo"] > 0.5, "tiene_separacion": bool(v.get("fecha_separacion")),
        "tiene_cuenta": bool(cfg.get("cuenta_bancaria")), "tiene_tasa_mora": mora > 0,
        # bloques
        "plan_pagos": _tabla_plan(plan, "Plan de pagos"),
        "plan_pendiente": _tabla_plan([x for x in plan if x.get("pendiente", 0) > 0.5], "Saldo pendiente", pendiente=True),
    }
    tipo_partes = [("EL VENDEDOR", var["vendedor_nombre"], f"NIT/C.C. {var['vendedor_nit']}" if var["vendedor_nit"] else "",
                    f"Rep.: {var['vendedor_representante']}" if var["vendedor_representante"] else ""),
                   ("EL COMPRADOR", var["comprador_nombre"], f"{var['comprador_tipo_doc']} {var['comprador_documento']}", "")]
    for f in (campos or {}):
        var[f] = campos[f]
    for t in TIPOS.values():          # valores por defecto de los campos que pide cada tipo
        for cp in t.get("campos", []):
            var.setdefault(cp["k"], cp.get("def", ""))
    if var.get("valor_devolucion") not in (None, ""):
        dev = num(str(var["valor_devolucion"]).replace("$", "").replace(".", "").replace(",", "."), 0)
        var["valor_devolucion"], var["valor_devolucion_letras"] = pesos(dev), letras(dev)
        ret = (v["pagado"] or 0) - dev
        var["tiene_retencion"], var["retencion"] = ret > 0.5, pesos(ret)
    if var.get("bien_id"):
        var.update(variables_bien(c, var["bien_id"], v))
    if var.get("bloque_id"):
        var.update(variables_bloque(c, var["bloque_id"], v))
    if var.get("fecha_entrega") and re.match(r"^\d{4}-\d{2}-\d{2}", str(var["fecha_entrega"])):
        var["fecha_entrega"] = fecha_larga(var["fecha_entrega"])
    var["_partes"] = tipo_partes
    var["_venta"] = v
    return var


def variables_bien(c, bien_id, v):
    b = c.execute("SELECT * FROM bienes_pago WHERE id=? AND venta_id=?", (int(bien_id), v["id"])).fetchone()
    if not b:
        raise ErrorNegocio("El bien no pertenece a este negocio.")
    if b["estado"] == "ANULADO":
        raise ErrorNegocio(f"El bien {b['numero']} está anulado.")
    tipos = {"VEHICULO": "vehículo", "INMUEBLE": "inmueble", "LOTE": "lote o finca", "MAQUINARIA": "maquinaria o equipo",
             "SEMOVIENTES": "semovientes", "OTRO": "bien"}
    ident = {"VEHICULO": "placa", "INMUEBLE": "matrícula inmobiliaria", "LOTE": "matrícula inmobiliaria"}.get(b["tipo"], "identificación")
    dif = (v["valor_venta"] or 0) - b["valor_recibo"]
    return {
        "bien_numero": b["numero"], "bien_tipo": tipos.get(b["tipo"], "bien"), "bien_descripcion": b["descripcion"],
        "bien_identificacion": b["identificacion"] or "", "bien_tipo_identificacion": ident, "bien_marca_modelo": b["marca_modelo"] or "",
        "bien_ubicacion": b["ubicacion"] or "", "bien_valor": pesos(b["valor_recibo"]), "bien_valor_letras": letras(b["valor_recibo"]),
        "bien_avaluo": pesos(b["valor_avaluo"]) if b["valor_avaluo"] else "", "bien_fuente_avaluo": b["fuente_avaluo"] or "",
        "bien_fecha_recibo": fecha_larga(b["fecha_recibo"]), "bien_recibo_caja": "",
        "bien_propietario": b["propietario"] or v["nombre"], "bien_propietario_doc": b["propietario_doc"] or v.get("documento") or "",
        "diferencia": pesos(max(dif, 0)), "diferencia_letras": letras(max(dif, 0)),
        "tiene_diferencia": dif > 0.5, "es_vehiculo": b["tipo"] == "VEHICULO", "es_inmueble": b["tipo"] in ("INMUEBLE", "LOTE"),
        "tiene_avaluo": bool(b["valor_avaluo"]),
    }


def variables_bloque(c, bloque_id, v):
    b = c.execute("SELECT * FROM bloques WHERE id=?", (int(bloque_id),)).fetchone()
    if not b or not c.execute("SELECT 1 FROM bloque_lotes WHERE bloque_id=? AND venta_id=?", (b["id"], v["id"])).fetchone():
        raise ErrorNegocio("El lote no pertenece a ese negocio en bloque.")
    filas, planes, pagado, saldo = [], [], 0, 0
    bls = c.execute("SELECT * FROM bloque_lotes WHERE bloque_id=? ORDER BY orden", (b["id"],)).fetchall()
    vs = ventas_lite.cargar(c, [bl["venta_id"] for bl in bls])
    for bl in bls:
        vv = vs.get(bl["venta_id"])
        if not vv or vv["estado"] != "ACTIVA":
            continue
        p = props_lote(bl["id_lote"])
        lind = sorted(p.get("linderos") or [], key=lambda x: ORDEN_RUMBO.get(x["rumbo"], 9))
        filas.append((vv["lote"], p, vv, lind))
        planes.extend(vv["plan"])
        pagado += vv["pagado"]
        saldo += vv["saldo"]
    if not filas:
        raise ErrorNegocio("El negocio en bloque no tiene lotes vigentes.")
    tabla = "".join(
        f"<tr><td>{l['id_lote']}</td><td>Mz {l['manzana']} · Lote {l['lote']}</td><td class='d'>{dec(l['area_m2'])} m²</td>"
        f"<td class='d'>{dec(p.get('pct_predio'), 4)} %</td><td class='d'>{pesos(vv['valor_venta'])}</td></tr>" for l, p, vv, _ in filas)
    area = sum(l["area_m2"] or 0 for l, *_ in filas)
    pct = sum(num(p.get("pct_predio"), 0) for _, p, *_ in filas)
    total = sum(vv["valor_venta"] for _, _, vv, _ in filas)
    lotes_html = (f"<div class='plan-contrato'><div class='pc-tit'>Lotes objeto de esta promesa</div><table class='lista'><thead><tr><th>Código</th>"
                  f"<th>Ubicación</th><th class='d'>Área</th><th class='d'>% del predio</th><th class='d'>Valor</th></tr></thead><tbody>{tabla}"
                  f"<tr class='tot'><td colspan='2'>Total ({len(filas)} lotes)</td><td class='d'>{dec(area)} m²</td><td class='d'>{dec(pct, 4)} %</td>"
                  f"<td class='d'>{pesos(total)}</td></tr></tbody></table></div>")
    linderos = " ".join(f"Lote {l['id_lote']}: " + "; ".join(
        f"por el {x['rumbo'].lower()}, en {dec(x['longitud_m'])} m, con {' y '.join(colindante(k) for k in x['colinda'])}" for x in lind) + "."
        for l, p, vv, lind in filas)
    por_fecha = {}
    for it in planes:
        por_fecha[it["fecha"]] = por_fecha.get(it["fecha"], 0) + it["valor"]
    fechas = sorted(por_fecha)
    con_inicial = bool(b["cuota_inicial"]) and fechas and fechas[0] == b["fecha_venta"]
    plan = [{"n": k if con_inicial else k + 1, "fecha": f, "valor": por_fecha[f]} for k, f in enumerate(fechas)]
    plan_html = _tabla_plan(plan, "Plan de pagos del negocio en bloque")
    modo = {"PROGRESIVO": "los pagos se aplicarán a los lotes en el orden del cuadro anterior, de manera que cada lote quede pagado antes de "
                          "empezar a pagar el siguiente y pueda escriturarse por separado",
            "PAREJO": "cada pago se aplicará a todos los lotes en proporción a su valor"}[b["modo"]]
    return {"bloque_numero": b["numero"], "bloque_n_lotes": str(len(filas)), "bloque_area": f"{dec(area)} m²", "bloque_pct_predio": f"{dec(pct, 4)} %",
            "bloque_valor_lista": pesos(b["valor_lista"]), "bloque_descuento": f"{dec(b['descuento_pct'], 1)} %",
            "bloque_valor": pesos(total), "bloque_valor_letras": letras(total), "bloque_inicial": pesos(b["cuota_inicial"]),
            "bloque_inicial_letras": letras(b["cuota_inicial"]), "bloque_n_cuotas": str(b["n_cuotas"] or 0),
            "bloque_aplicacion_pagos": modo, "bloque_pagado": pesos(pagado), "bloque_saldo": pesos(saldo),
            "bloque_linderos": linderos, "tiene_descuento": (b["descuento_pct"] or 0) > 0.05, "tiene_inicial_bloque": (b["cuota_inicial"] or 0) > 0,
            "lotes_bloque": lotes_html, "plan_bloque": plan_html}


def _tabla_plan(filas, titulo, pendiente=False):
    if not filas:
        return ""
    cab = "<th>Cuota</th><th>Fecha</th><th class='d'>Valor</th>" + ("<th class='d'>Pendiente</th>" if pendiente else "")
    cuerpo = "".join(
        f"<tr><td>{'Inicial' if x.get('n', 0) == 0 else x['n']}</td><td>{fecha_larga(x['fecha'])}</td><td class='d'>{pesos(x['valor'])}</td>"
        + (f"<td class='d'>{pesos(x.get('pendiente'))}</td>" if pendiente else "") + "</tr>" for x in filas)
    total = sum((x.get("pendiente") if pendiente else x["valor"]) or 0 for x in filas)
    pie = f"<tr class='tot'><td colspan='{3 if pendiente else 2}'>Total</td><td class='d'>{pesos(total)}</td></tr>"
    return f"<div class='plan-contrato'><div class='pc-tit'>{titulo}</div><table class='lista'><thead><tr>{cab}</tr></thead><tbody>{cuerpo}{pie}</tbody></table></div>"


def _firmas(tipo, var):
    partes = list(var["_partes"])
    if tipo == "CESION":
        partes = [("EL CEDENTE", var["comprador_nombre"], f"{var['comprador_tipo_doc']} {var['comprador_documento']}", ""),
                  ("EL CESIONARIO", var.get("cesionario_nombre", ""), f"{var.get('cesionario_tipo_doc', '')} {var.get('cesionario_documento', '')}", ""),
                  ("EL PROMITENTE VENDEDOR", var["vendedor_nombre"], f"NIT/C.C. {var['vendedor_nit']}" if var["vendedor_nit"] else "", "")]
    elif tipo in ("PROMESA", "PROMESA_BLOQUE"):
        partes = [("EL PROMITENTE VENDEDOR",) + partes[0][1:], ("EL PROMITENTE COMPRADOR",) + partes[1][1:]]
    elif tipo == "PERMUTA":
        partes = [("PRIMER PERMUTANTE",) + partes[0][1:], ("SEGUNDO PERMUTANTE",) + partes[1][1:]]
    elif tipo == "DACION":
        partes = [("EL ACREEDOR (VENDEDOR)",) + partes[0][1:], ("EL DEUDOR (COMPRADOR)",) + partes[1][1:]]
    elif tipo == "SEPARACION":
        partes = [partes[0], ("EL INTERESADO",) + partes[1][1:]]
    elif tipo == "AUTORIZACION_DATOS":
        partes = [("EL RESPONSABLE",) + partes[0][1:], ("EL TITULAR DE LOS DATOS",) + partes[1][1:]]
    celdas = "".join(f"<div><b>{html.escape(r)}</b><br>{html.escape(n)}" + "".join(f"<br>{html.escape(x)}" for x in extra if x.strip()) + "</div>"
                     for r, n, *extra in partes)
    return f"<div class='firmas legal-f n{len(partes)}'>{celdas}</div>"


# ---------------------------------------------------------------- plantillas
def plantilla(c, tipo):
    if tipo not in TIPOS:
        raise ErrorNegocio("Tipo de contrato desconocido.")
    r = c.execute("SELECT texto, version, actualizado, usuario FROM contrato_plantillas WHERE tipo=?", (tipo,)).fetchone()
    if r:
        return {"texto": r["texto"], "version": r["version"], "actualizado": r["actualizado"], "usuario": r["usuario"], "propia": True}
    return {"texto": TEXTOS.get(tipo, ""), "version": 0, "actualizado": None, "usuario": None, "propia": False}


RE_SECCION = re.compile(r"\{\{([#^])(\w+)\}\}(.*?)\{\{/\2\}\}", re.S)
RE_VAR = re.compile(r"\{\{(\w+)\}\}")


def render(texto, var, tipo):
    """Convierte la plantilla en el HTML del contrato. Devuelve (html, variables_desconocidas)."""
    desconocidas = set()

    def secciones(t):
        prev = None
        while prev != t:
            prev = t
            t = RE_SECCION.sub(lambda m: m.group(3) if bool(var.get(m.group(2))) == (m.group(1) == "#") else "", t)
        return t

    t = secciones(texto.replace("\r\n", "\n"))
    bloques_html = []
    n_sec = 0
    for bloque in re.split(r"\n\s*\n", t.strip()):
        b = bloque.strip()
        if not b:
            continue
        solo = RE_VAR.fullmatch(b)
        if solo and solo.group(1) in BLOQUES:
            k = solo.group(1)
            bloques_html.append(_firmas(tipo, var) if k == "firmas" else var.get(k, ""))
            continue
        if b.startswith("## "):
            n_sec += 1
            bloques_html.append(f"<h2><span>{n_sec}</span>{html.escape(b[3:].strip())}</h2>")
            continue
        seg = html.escape(" ".join(x.strip() for x in b.split("\n")))
        seg = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", seg)

        def sustituir(m):
            k = m.group(1)
            if k not in var or k.startswith("_"):
                desconocidas.add(k)
                return f"<span class='falta'>[{k}]</span>"
            val = var[k]
            if k in BLOQUES:
                return ""
            if val in (None, "", False):
                return "________"
            return html.escape(str(val))
        bloques_html.append(f"<p>{RE_VAR.sub(sustituir, seg)}</p>")
    return "<div class='legal'>" + "\n".join(bloques_html) + "</div>", sorted(desconocidas)


def catalogo_variables():
    return [
        ("Contrato", ["numero_contrato", "fecha_hoy", "proyecto", "ciudad", "notaria", "plazo_escritura_meses", "penalidad_pct", "tasa_mora"]),
        ("Vendedor", ["vendedor_nombre", "vendedor_nit", "vendedor_representante", "vendedor_representante_doc", "vendedor_direccion",
                      "vendedor_telefono", "vendedor_email", "cuenta_bancaria"]),
        ("Comprador", ["comprador_nombre", "comprador_tipo_doc", "comprador_documento", "comprador_direccion", "comprador_telefono", "comprador_email"]),
        ("Lote", ["lote_codigo", "lote_numero", "manzana", "area_m2", "perimetro_m", "frente_m", "fondo_m", "pct_predio", "area_predio",
                  "linderos", "coordenadas", "lote_matricula", "lote_cedula_catastral"]),
        ("Negocio", ["valor_venta", "valor_venta_letras", "cuota_inicial", "cuota_inicial_letras", "saldo_financiado", "n_cuotas", "valor_cuota",
                     "fecha_venta", "fecha_primera_cuota", "fecha_ultima_cuota", "fecha_contado", "pagado", "pagado_letras", "saldo", "saldo_letras",
                     "valor_separacion", "valor_separacion_letras", "fecha_separacion", "fecha_limite_separacion", "precio_referencia", "precio_referencia_letras",
                     "promesa_numero", "promesa_fecha"]),
        ("Bien recibido (dación / permuta)", ["bien_numero", "bien_tipo", "bien_descripcion", "bien_identificacion",
                                              "bien_tipo_identificacion", "bien_marca_modelo", "bien_ubicacion", "bien_valor",
                                              "bien_valor_letras", "bien_avaluo", "bien_fuente_avaluo", "bien_fecha_recibo",
                                              "bien_propietario", "bien_propietario_doc", "diferencia", "diferencia_letras"]),
        ("Negocio en bloque", ["bloque_numero", "bloque_n_lotes", "bloque_area", "bloque_pct_predio", "bloque_valor_lista", "bloque_descuento",
                               "bloque_valor", "bloque_valor_letras", "bloque_inicial", "bloque_inicial_letras", "bloque_n_cuotas",
                               "bloque_aplicacion_pagos", "bloque_pagado", "bloque_saldo", "bloque_linderos"]),
        ("Bloques", ["plan_pagos", "plan_pendiente", "firmas", "lotes_bloque", "plan_bloque"]),
        ("Condiciones {{#…}}", ["tiene_cuota_inicial", "tiene_cuotas", "es_contado", "tiene_pagos", "tiene_saldo", "tiene_separacion",
                                "tiene_cuenta", "tiene_tasa_mora", "tiene_matricula", "tiene_retencion", "tiene_diferencia", "es_vehiculo",
                                "es_inmueble", "tiene_avaluo", "tiene_descuento", "tiene_inicial_bloque"]),
        ("Campos que se piden al generar", sorted({cp["k"] for t in TIPOS.values() for cp in t.get("campos", [])} | {"valor_devolucion_letras", "retencion"})),
    ]


# ---------------------------------------------------------------- contratos
def promesa_bloque_vigente(c, venta_id, estados=("GENERADO", "FIRMADO")):
    """Promesa en bloque (de cualquier lote del mismo negocio) que cubre esta venta."""
    return c.execute(
        "SELECT k.* FROM contratos k WHERE k.tipo='PROMESA_BLOQUE' AND k.estado IN (%s) AND k.venta_id IN ("
        "SELECT bl2.venta_id FROM bloque_lotes bl JOIN bloque_lotes bl2 ON bl2.bloque_id=bl.bloque_id WHERE bl.venta_id=?) "
        "ORDER BY k.id DESC LIMIT 1" % ",".join("?" * len(estados)), (*estados, int(venta_id))).fetchone()


def _venta_apta(c, venta_id, tipo):
    v = c.execute("SELECT * FROM ventas WHERE id=?", (int(venta_id or 0),)).fetchone()
    if not v:
        raise ErrorNegocio("Negocio no encontrado.")
    t = TIPOS.get(tipo)
    if not t:
        raise ErrorNegocio("Tipo de contrato desconocido.")
    if v["estado"] not in t.get("estados", ("ACTIVA",)):
        raise ErrorNegocio("Este contrato no aplica a un negocio en estado " + v["estado"].lower() + ".")
    if v["etapa"] not in t["etapas"]:
        raise ErrorNegocio(f"La {t['nombre'].lower()} aplica a negocios en etapa {', '.join(e.lower() for e in t['etapas'])}.")
    if tipo == "PROMESA":
        pcb = promesa_bloque_vigente(c, v["id"])
        if pcb:
            raise ErrorNegocio(f"Este lote está cubierto por la promesa en bloque {pcb['numero']}.")
    if tipo == "OTROSI":
        pagado = c.execute("SELECT COALESCE(SUM(valor),0) FROM pagos WHERE venta_id=? AND anulado=0", (v["id"],)).fetchone()[0]
        if (v["valor_venta"] or 0) - pagado <= 0.5:
            raise ErrorNegocio("El negocio no tiene saldo pendiente: no hay forma de pago que modificar.")
    return v


# ---------------------------------------------------------------- validador previo
# Revisa que los datos estén completos y no se contradigan. NO dice que el contrato sea legalmente válido: eso lo decide
# el abogado. Cada regla es "error" (impide generar), "aviso" (solo se muestra) u "off"; el abogado puede ajustar los niveles
# en la configuración `validador_niveles` (JSON {"CODIGO": "error"|"aviso"|"off"}).
VALIDAN = ("PROMESA", "SEPARACION")
NIVELES = {"COMPRADOR_DATOS": "error", "PRECIO": "error", "INICIAL_MAYOR": "error", "PLAN_VACIO": "error",
           "COMPRADOR_TIPO_DOC": "aviso", "COMPRADOR_CONTACTO": "aviso", "VENDEDOR_DATOS": "aviso", "MATRICULA": "aviso",
           "CATASTRAL": "aviso", "LOTE_MEDIDAS": "aviso", "ESCRITURA": "aviso", "SEPARACION_MAYOR": "aviso",
           "CONTRATO_DESACTUALIZADO": "aviso", "DOC_IDENTIDAD": "aviso", "CERTIFICADO_TRADICION": "aviso", "AUTORIZACION_DATOS": "aviso"}


def validar(c, venta_id, tipo, var=None):
    """Lista de hallazgos [{codigo, nivel, mensaje}] de un negocio para un tipo de contrato; vacía si el tipo no se valida."""
    if tipo not in VALIDAN:
        return []
    var = var or variables(c, venta_id)
    v, cfg = var["_venta"], config(c)
    try:
        ajuste = json.loads(cfg.get("validador_niveles") or "{}")
    except ValueError:
        ajuste = {}
    out = []

    def regla(codigo, falla, mensaje):
        nivel = ajuste.get(codigo, NIVELES[codigo])
        if falla and nivel in ("error", "aviso"):
            out.append({"codigo": codigo, "nivel": nivel, "mensaje": mensaje})

    sin = lambda k: not str(var.get(k) or "").strip()
    valor, inicial = num(v.get("valor_venta"), 0), num(v.get("cuota_inicial"), 0)
    regla("COMPRADOR_DATOS", sin("comprador_nombre") or sin("comprador_documento"), "Faltan el nombre o el número de documento del comprador.")
    regla("COMPRADOR_TIPO_DOC", not v.get("tipo_doc"), "Falta el tipo de documento del comprador.")
    regla("COMPRADOR_CONTACTO", sin("comprador_direccion") or (sin("comprador_telefono") and sin("comprador_email")),
          "Faltan la dirección o un teléfono o correo del comprador (para notificaciones).")
    regla("VENDEDOR_DATOS", sin("vendedor_nombre") or sin("vendedor_nit") or sin("vendedor_representante") or sin("vendedor_representante_doc"),
          "Faltan datos del vendedor en Configuración (razón social, NIT, representante legal y su documento).")
    l = v["lote"]
    regla("MATRICULA", not l.get("matricula"), "El lote no tiene matrícula inmobiliaria registrada.")
    regla("CATASTRAL", not l.get("cedula_catastral"), "El lote no tiene cédula catastral registrada.")
    regla("LOTE_MEDIDAS", not l.get("area_m2") or var["linderos"] == "________", "Faltan el área o los linderos del lote.")
    if tipo == "PROMESA":
        regla("PRECIO", valor <= 0, "El negocio no tiene valor de venta.")
        regla("INICIAL_MAYOR", inicial > valor > 0, "La cuota inicial es mayor que el valor de la venta.")
        regla("PLAN_VACIO", valor > 0 and not v.get("plan"), "El negocio no tiene plan de pagos (falta la fecha del negocio).")
        regla("ESCRITURA", not str(cfg.get("promesa_plazo_escritura_meses") or "").isdigit() or not cfg.get("notaria_escrituracion"),
              "Falta definir el plazo para escriturar o la notaría en Configuración.")
        sep = sum(x["valor"] for x in v.get("pagos", []) if not x.get("anulado") and "separ" in (x.get("concepto") or "").lower())
        regla("SEPARACION_MAYOR", inicial > 0 and sep > inicial, "La separación abonada es mayor que la cuota inicial.")
        previo = c.execute("SELECT numero, texto_html FROM contratos WHERE venta_id=? AND tipo=? AND estado IN ('GENERADO','FIRMADO') "
                           "ORDER BY id DESC LIMIT 1", (v["id"], tipo)).fetchone()
        if previo:      # el contrato ya generado debe seguir diciendo lo que dicen hoy los datos
            plano = re.sub(r"<[^>]+>", " ", html.unescape(previo["texto_html"]))
            falta = [n for n, t in (("valor de venta", var["valor_venta"]), ("documento del comprador", var["comprador_documento"]))
                     if t and t not in plano]
            regla("CONTRATO_DESACTUALIZADO", bool(falta), f"El contrato {previo['numero']} ya generado no coincide con los datos actuales ({', '.join(falta)}).")
    adj = {r[0] for r in c.execute("SELECT DISTINCT tipo FROM adjuntos WHERE id_lote=? AND COALESCE(eliminado,0)=0", (v["id_lote"],))}
    regla("DOC_IDENTIDAD", "Documento de identidad" not in adj, "Falta el documento de identidad del comprador en el expediente del lote.")
    regla("CERTIFICADO_TRADICION", "Certificado de tradición" not in adj, "Falta el certificado de tradición y libertad en el expediente del lote.")
    aut = c.execute("SELECT 1 FROM contratos k JOIN ventas x ON x.id=k.venta_id WHERE k.tipo='AUTORIZACION_DATOS' AND k.estado='FIRMADO' "
                    "AND x.cliente_id=? LIMIT 1", (v["cliente_id"],)).fetchone()
    regla("AUTORIZACION_DATOS", not aut, "El comprador no tiene firmada la autorización de tratamiento de datos personales.")
    return sorted(out, key=lambda h: h["nivel"] != "error")


def guardar_inmueble(c, usuario, d):
    l = c.execute("SELECT * FROM lotes WHERE id_lote=?", (d.get("id_lote"),)).fetchone()
    if not l:
        raise ErrorNegocio("Lote no encontrado.")
    nuevo = {k: str(d.get(k) or "").strip()[:300] for k in ("matricula", "cedula_catastral", "nota_registral")}
    c.execute("UPDATE lotes SET matricula=?, cedula_catastral=?, nota_registral=? WHERE id_lote=?",
              (nuevo["matricula"], nuevo["cedula_catastral"], nuevo["nota_registral"], l["id_lote"]))
    bitacora(c, usuario, "INMUEBLE_DATOS", l["id_lote"], {"antes": {k: l[k] for k in nuevo}, "despues": nuevo})
    return {"ok": True}


def _campos(tipo, d):
    campos = {}
    for cp in TIPOS[tipo].get("campos", []):
        val = (d.get("campos") or {}).get(cp["k"], cp.get("def", ""))
        val = str(val).strip() if val is not None else ""
        if cp.get("req") and not val:
            raise ErrorNegocio(f"Falta: {cp['et']}.")
        campos[cp["k"]] = val
    return campos


def vista_previa(c, d):
    tipo = d.get("tipo")
    pl = {"texto": d["texto"]} if d.get("texto") is not None else plantilla(c, tipo)
    if d.get("venta_id"):
        _venta_apta(c, d["venta_id"], tipo)
        vid = d["venta_id"]
    else:   # vista previa de una plantilla con el negocio más reciente que aplique
        r = c.execute("SELECT id FROM ventas WHERE etapa IN (%s) ORDER BY id DESC LIMIT 1" % ",".join("?" * len(TIPOS[tipo]["etapas"])),
                      TIPOS[tipo]["etapas"]).fetchone() or c.execute("SELECT id FROM ventas ORDER BY id DESC LIMIT 1").fetchone()
        if not r:
            raise ErrorNegocio("Aún no hay negocios para mostrar la vista previa.")
        vid = r[0]
    campos = {cp["k"]: (d.get("campos") or {}).get(cp["k"], cp.get("def", "")) for cp in TIPOS[tipo].get("campos", [])}
    var = variables(c, vid, campos, numero=f"{TIPOS[tipo]['prefijo']}-____")
    cuerpo, faltan = render(pl["texto"], var, tipo)
    return {"html": cuerpo, "desconocidas": faltan, "titulo": TIPOS[tipo]["nombre"], "venta_id": vid,
            "hallazgos": validar(c, vid, tipo, var)}


def generar(c, usuario, d):
    tipo = d.get("tipo")
    v = _venta_apta(c, d.get("venta_id"), tipo)
    campos = _campos(tipo, d)
    previo = c.execute("SELECT * FROM contratos WHERE venta_id=? AND tipo=? AND estado IN ('GENERADO','FIRMADO')", (v["id"], tipo)).fetchall()
    if campos.get("bien_id"):   # dación y permuta: un contrato por cada bien
        previo = [p for p in previo if json.loads(p["campos"] or "{}").get("bien_id") == campos["bien_id"]]
    if any(p["estado"] == "FIRMADO" for p in previo) and tipo in ("PROMESA", "SEPARACION", "CESION", "RESCILIACION", "ACTA_ENTREGA", "DACION", "PERMUTA", "PROMESA_BLOQUE", "AUTORIZACION_DATOS"):
        p = next(p for p in previo if p["estado"] == "FIRMADO")
        raise ErrorNegocio(f"Ya existe el contrato {p['numero']} firmado. Para hacer uno nuevo, anule primero ese.")
    errores = [h["mensaje"] for h in validar(c, v["id"], tipo) if h["nivel"] == "error"]
    if errores:
        raise ErrorNegocio("Corrija antes de generar: " + " ".join(errores))
    pl = plantilla(c, tipo)
    clave = f"consecutivo_contrato_{tipo.lower()}"
    n = int(config(c).get(clave) or 1)
    base.set_config(c, clave, n + 1)
    numero = f"{TIPOS[tipo]['prefijo']}-{n:04d}"
    var = variables(c, v["id"], campos, numero=numero)
    cuerpo, faltan = render(pl["texto"], var, tipo)
    if faltan:
        raise ErrorNegocio("La plantilla usa datos que no existen: " + ", ".join(faltan) + ". Corríjala en Plantillas.")
    for p in previo:   # los borradores sin firmar quedan reemplazados por el nuevo
        c.execute("UPDATE contratos SET estado='REEMPLAZADO', fecha_anulacion=?, motivo_anulacion=? WHERE id=?",
                  (ahora(), f"Reemplazado por {numero}", p["id"]))
        bitacora(c, usuario, "CONTRATO_REEMPLAZADO", v["id_lote"], {"contrato": p["numero"], "por": numero})
    sha = hashlib.sha256(cuerpo.encode("utf-8")).hexdigest()
    cid = c.execute("INSERT INTO contratos (numero, tipo, venta_id, id_lote, estado, campos, texto_html, sha256, plantilla_version, generado, generado_por) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (numero, tipo, v["id"], v["id_lote"], "GENERADO", json.dumps(campos, ensure_ascii=False),
                                                       cuerpo, sha, pl["version"], ahora(), usuario)).lastrowid
    bitacora(c, usuario, "CONTRATO_GENERADO", v["id_lote"], {"contrato": numero, "tipo": TIPOS[tipo]["nombre"], "venta_id": v["id"],
                                                            "sha256": sha})
    return {"ok": True, "id": cid, "numero": numero}


def firmar(c, usuario, d):
    k = c.execute("SELECT * FROM contratos WHERE id=?", (int(d.get("id") or 0),)).fetchone()
    if not k or k["estado"] != "GENERADO":
        raise ErrorNegocio("Solo se registra la firma de un contrato generado y vigente.")
    f = (d.get("fecha_firma") or "").strip()
    try:
        fecha = dt.date.fromisoformat(f)
    except ValueError:
        raise ErrorNegocio("Indique la fecha de firma.")
    if fecha > hoy():
        raise ErrorNegocio("La fecha de firma no puede ser futura.")
    adj = d.get("adjunto_id")
    if adj and not c.execute("SELECT 1 FROM adjuntos WHERE id=? AND id_lote=?", (int(adj), k["id_lote"])).fetchone():
        raise ErrorNegocio("El documento firmado no pertenece a este lote.")
    c.execute("UPDATE contratos SET estado='FIRMADO', fecha_firma=?, firma_registrada_por=?, adjunto_id=? WHERE id=?",
              (fecha.isoformat(), usuario, int(adj) if adj else None, k["id"]))
    bitacora(c, usuario, "CONTRATO_FIRMADO", k["id_lote"], {"contrato": k["numero"], "fecha_firma": fecha.isoformat(), "adjunto_id": adj})
    return {"ok": True}


def anular(c, usuario, d):
    k = c.execute("SELECT * FROM contratos WHERE id=?", (int(d.get("id") or 0),)).fetchone()
    if not k or k["estado"] not in ("GENERADO", "FIRMADO"):
        raise ErrorNegocio("El contrato no existe o ya no está vigente.")
    motivo = (d.get("motivo") or "").strip()
    if not motivo:
        raise ErrorNegocio("Indique el motivo de la anulación.")
    c.execute("UPDATE contratos SET estado='ANULADO', motivo_anulacion=?, fecha_anulacion=? WHERE id=?", (motivo, ahora(), k["id"]))
    bitacora(c, usuario, "CONTRATO_ANULADO", k["id_lote"], {"contrato": k["numero"], "motivo": motivo})
    return {"ok": True}


PLANTILLA_NUEVA = "## Objeto" + chr(10)*2 + "Contrato entre {{vendedor_nombre}} y {{comprador_nombre}} sobre el lote {{lote_codigo}}." + chr(10)*2 + "{{firmas}}"


def cargar_propios(c):
    """Los contratos creados por el dueño se suman a los tipos de fábrica (aplican a cualquier negocio vigente)."""
    for k in [k for k, t in TIPOS.items() if t.get("propio")]:
        del TIPOS[k]
    for r in c.execute("SELECT * FROM contrato_tipos ORDER BY tipo"):
        TIPOS[r["tipo"]] = {"nombre": r["nombre"], "prefijo": r["prefijo"], "etapas": ("SEPARADO", "VENDIDO", "ESCRITURADO"),
                            "adjunto": "Otro", "icono": "file-text", "propio": True,
                            "ayuda": r["ayuda"] or "Contrato propio de la empresa."}


def crear_tipo(c, usuario, d):
    nombre = re.sub(r"\s+", " ", str(d.get("nombre") or "")).strip()[:80]
    prefijo = re.sub(r"[^A-Z0-9]", "", str(d.get("prefijo") or "").upper())[:4]
    if len(nombre) < 3 or len(prefijo) < 2:
        raise ErrorNegocio("Indique el nombre del contrato y un prefijo de 2 a 4 letras (ej. ARR).")
    if any(t["prefijo"] == prefijo for t in TIPOS.values()):
        raise ErrorNegocio(f"El prefijo {prefijo} ya lo usa otro contrato.")
    if any(t["nombre"].lower() == nombre.lower() for t in TIPOS.values()):
        raise ErrorNegocio("Ya existe un contrato con ese nombre.")
    tipo = "X_" + re.sub(r"[^A-Z0-9]+", "_", prefijo + "_" + nombre.upper()).strip("_")[:40]
    c.execute("INSERT INTO contrato_tipos (tipo, nombre, prefijo, ayuda) VALUES (?,?,?,?)",
              (tipo, nombre, prefijo, str(d.get("ayuda") or "").strip()[:200]))
    cargar_propios(c)
    guardar_plantilla(c, usuario, {"tipo": tipo, "texto": d.get("texto") or PLANTILLA_NUEVA})
    bitacora(c, usuario, "PLANTILLA_CONTRATO", None, {"tipo": nombre, "accion": "contrato propio creado"})
    return {"ok": True, "tipo": tipo}


def eliminar_tipo(c, usuario, d):
    t = TIPOS.get(d.get("tipo"))
    if not t or not t.get("propio"):
        raise ErrorNegocio("Solo se pueden eliminar los contratos creados por usted.")
    if c.execute("SELECT 1 FROM contratos WHERE tipo=? LIMIT 1", (d["tipo"],)).fetchone():
        raise ErrorNegocio("Ya se generaron contratos de este tipo: no se puede eliminar (cambie su texto si lo necesita).")
    c.execute("DELETE FROM contrato_plantillas WHERE tipo=?", (d["tipo"],))
    c.execute("DELETE FROM contrato_tipos WHERE tipo=?", (d["tipo"],))
    cargar_propios(c)
    bitacora(c, usuario, "PLANTILLA_CONTRATO", None, {"tipo": t["nombre"], "accion": "contrato propio eliminado"})
    return {"ok": True}


NL = chr(10)


def importar_texto(d):
    """Texto de un contrato en Word (.docx) o texto plano, listo para la plantilla (no la guarda: el dueño lo revisa)."""
    nombre = str(d.get("nombre") or "").lower()
    try:
        datos = base64.b64decode(str(d.get("contenido") or "").split(",")[-1], validate=True)
    except ValueError:
        raise ErrorNegocio("No se pudo leer el archivo.")
    if len(datos) > 5_000_000:
        raise ErrorNegocio("El archivo es demasiado grande (máximo 5 MB).")
    if nombre.endswith(".docx"):
        try:
            xml = zipfile.ZipFile(io.BytesIO(datos)).read("word/document.xml").decode("utf-8")
        except (zipfile.BadZipFile, KeyError):
            raise ErrorNegocio("El archivo no es un documento de Word (.docx) válido.")
        pars = []
        for p in re.findall(r"<w:p[ >].*?</w:p>", xml, re.S):
            t = "".join(html.unescape(x) for x in re.findall(r"<w:t(?: [^>]*)?>([^<]*)</w:t>", p))
            pars.append(t.strip())
        texto = (NL*2).join(x for x in pars if x)
    elif nombre.endswith((".txt", ".md")):
        try:
            texto = datos.decode("utf-8")
        except UnicodeDecodeError:
            texto = datos.decode("cp1252")
        texto = re.sub(r"\n[ \t]*\n+", NL*2, texto.replace(chr(13), "")).strip()
    else:
        raise ErrorNegocio("Formato no admitido: use Word (.docx) o texto (.txt). Si lo tiene en PDF, guárdelo como Word.")
    if len(texto) < 50:
        raise ErrorNegocio("El archivo no tiene texto suficiente.")
    if "{{firmas}}" not in texto:
        texto += NL*2 + "{{firmas}}"
    return {"texto": texto}


def guardar_plantilla(c, usuario, d, restaurar=False):
    tipo = d.get("tipo")
    if tipo not in TIPOS:
        raise ErrorNegocio("Tipo de contrato desconocido.")
    actual = c.execute("SELECT * FROM contrato_plantillas WHERE tipo=?", (tipo,)).fetchone()
    if restaurar and TIPOS[tipo].get("propio"):
        raise ErrorNegocio("Un contrato propio no tiene texto original: edítelo o elimínelo.")
    if restaurar:
        if actual:
            c.execute("INSERT INTO contrato_plantillas_hist (tipo, texto, version, reemplazada, usuario) VALUES (?,?,?,?,?)",
                      (tipo, actual["texto"], actual["version"], ahora(), usuario))
            c.execute("DELETE FROM contrato_plantillas WHERE tipo=?", (tipo,))
        bitacora(c, usuario, "PLANTILLA_CONTRATO", None, {"tipo": TIPOS[tipo]["nombre"], "accion": "restaurada la original"})
        return {"ok": True}
    texto = (d.get("texto") or "").strip()
    if len(texto) < 50:
        raise ErrorNegocio("La plantilla está vacía o es demasiado corta.")
    var_ok = {k for _, ks in catalogo_variables() for k in ks}
    malas = sorted({m for m in RE_VAR.findall(texto) if m not in var_ok})
    malas += sorted({m.group(2) for m in RE_SECCION.finditer(texto) if m.group(2) not in var_ok})
    if malas:
        raise ErrorNegocio("Variables que no existen: " + ", ".join(sorted(set(malas))))
    if "{{firmas}}" not in texto:
        raise ErrorNegocio("La plantilla debe incluir {{firmas}} (el bloque de firmas).")
    version = (actual["version"] if actual else 0) + 1
    if actual:
        c.execute("INSERT INTO contrato_plantillas_hist (tipo, texto, version, reemplazada, usuario) VALUES (?,?,?,?,?)",
                  (tipo, actual["texto"], actual["version"], ahora(), usuario))
    c.execute("INSERT INTO contrato_plantillas (tipo, texto, version, actualizado, usuario) VALUES (?,?,?,?,?) ON CONFLICT(tipo) DO UPDATE SET "
              "texto=excluded.texto, version=excluded.version, actualizado=excluded.actualizado, usuario=excluded.usuario",
              (tipo, texto, version, ahora(), usuario))
    bitacora(c, usuario, "PLANTILLA_CONTRATO", None, {"tipo": TIPOS[tipo]["nombre"], "version": version,
                                                     "sha256": hashlib.sha256(texto.encode()).hexdigest()})
    return {"ok": True, "version": version}


def _fila(k):
    r = dict(k)
    r["tipo_nombre"] = TIPOS.get(k["tipo"], {}).get("nombre", k["tipo"])
    r["integro"] = hashlib.sha256((k["texto_html"] or "").encode("utf-8")).hexdigest() == k["sha256"]
    r.pop("texto_html", None)
    return r


# el comprador no tiene firmada (en ninguno de sus negocios) la autorización de tratamiento de datos personales
SIN_AUTORIZACION = ("NOT EXISTS (SELECT 1 FROM contratos k3 JOIN ventas v3 ON v3.id=k3.venta_id WHERE v3.cliente_id=v.cliente_id "
                    "AND k3.tipo='AUTORIZACION_DATOS' AND k3.estado='FIRMADO')")


def listar(c, venta_id=None):
    sql = ("SELECT k.*, cl.nombre cliente, cl.documento FROM contratos k JOIN ventas v ON v.id=k.venta_id "
           "JOIN clientes cl ON cl.id=v.cliente_id")
    filas = [_fila(r) for r in (c.execute(sql + " WHERE (k.venta_id=? OR (k.tipo='PROMESA_BLOQUE' AND k.venta_id IN ("
                                          "SELECT bl2.venta_id FROM bloque_lotes bl JOIN bloque_lotes bl2 ON bl2.bloque_id=bl.bloque_id "
                                          "WHERE bl.venta_id=?))) ORDER BY k.id DESC", (int(venta_id), int(venta_id))) if venta_id
                                 else c.execute(sql + " ORDER BY k.id DESC LIMIT 1000"))]
    if venta_id:
        existe = c.execute("SELECT 1 FROM ventas WHERE id=?", (int(venta_id),)).fetchone()
        sin = c.execute("SELECT 1 FROM ventas v WHERE v.id=? AND " + SIN_AUTORIZACION, (int(venta_id),)).fetchone() if existe else None
        return {"contratos": filas, "tipos": tipos_publicos(), "autorizacion_datos": (None if not existe else not sin)}
    pend = [dict(r) for r in c.execute(
        "SELECT v.id venta_id, v.id_lote, v.etapa, v.fecha_venta, cl.nombre cliente FROM ventas v JOIN clientes cl ON cl.id=v.cliente_id "
        "WHERE v.estado='ACTIVA' AND v.etapa IN ('VENDIDO','ESCRITURADO') AND NOT EXISTS (SELECT 1 FROM contratos k WHERE k.venta_id=v.id "
        "AND k.tipo='PROMESA' AND k.estado='FIRMADO') AND NOT EXISTS (SELECT 1 FROM bloque_lotes bl JOIN bloque_lotes bl2 ON bl2.bloque_id=bl.bloque_id "
        "JOIN contratos k2 ON k2.venta_id=bl2.venta_id AND k2.tipo='PROMESA_BLOQUE' AND k2.estado='FIRMADO' WHERE bl.venta_id=v.id) ORDER BY v.fecha_venta")]
    por_cliente = {}
    for r in c.execute("SELECT v.id venta_id, v.id_lote, v.etapa, v.cliente_id, cl.nombre cliente, cl.documento FROM ventas v "
                       "JOIN clientes cl ON cl.id=v.cliente_id WHERE v.estado='ACTIVA' AND " + SIN_AUTORIZACION + " ORDER BY cl.nombre, v.id"):
        por_cliente.setdefault(r["cliente_id"], dict(r))       # una fila por comprador (su negocio más antiguo)
    cuenta = lambda e: sum(1 for f in filas if f["estado"] == e)  # noqa: E731
    sin_firma = [f for f in filas if f["estado"] == "GENERADO"]
    return {"contratos": filas, "tipos": tipos_publicos(), "pendientes_promesa": pend,
            "pendientes_datos": list(por_cliente.values()),
            "kpis": {"sin_datos": len(por_cliente), "firmados": cuenta("FIRMADO"), "por_firmar": len(sin_firma), "anulados": cuenta("ANULADO"),
                     "sin_promesa": len(pend), "alterados": sum(1 for f in filas if not f["integro"])}}


def tipos_publicos():
    return [{"tipo": k, **{x: t[x] for x in ("nombre", "prefijo", "etapas", "icono", "ayuda")}, "estados": t.get("estados", ("ACTIVA",)),
             "campos": t.get("campos", []), "modalidad": t.get("modalidad"), "bloque": t.get("bloque", False)} for k, t in TIPOS.items()]


def detalle(c, cid):
    k = c.execute("SELECT k.*, cl.nombre cliente FROM contratos k JOIN ventas v ON v.id=k.venta_id JOIN clientes cl ON cl.id=v.cliente_id "
                  "WHERE k.id=?", (int(cid or 0),)).fetchone()
    if not k:
        raise ErrorNegocio("Contrato no encontrado.")
    r = _fila(k)
    r["texto_html"] = k["texto_html"]
    return r


# ---------------------------------------------------------------- integración con el servidor
def get(c, sesion, ruta, q):
    if ruta == "/api/contratos":
        return listar(c, q.get("venta_id"))
    if ruta == "/api/contrato":
        return detalle(c, q.get("id"))
    if ruta == "/api/plantillas":
        out = []
        for k, t in TIPOS.items():
            p = plantilla(c, k)
            out.append({"tipo": k, "nombre": t["nombre"], "propio": bool(t.get("propio")), **p})
        return {"plantillas": out, "variables": catalogo_variables()}
    return None


def acciones(c, usuario, ruta, d):
    if ruta == "/api/contrato/vista":
        return vista_previa(c, d)
    if ruta == "/api/contrato/generar":
        return generar(c, usuario, d)
    if ruta == "/api/contrato/firmar":
        return firmar(c, usuario, d)
    if ruta == "/api/contrato/anular":
        return anular(c, usuario, d)
    if ruta == "/api/lote/inmueble":
        return guardar_inmueble(c, usuario, d)
    if ruta == "/api/plantilla/guardar":
        return guardar_plantilla(c, usuario, d)
    if ruta == "/api/plantilla/nueva":
        return crear_tipo(c, usuario, d)
    if ruta == "/api/plantilla/importar":
        return importar_texto(d)
    if ruta == "/api/plantilla/eliminar":
        return eliminar_tipo(c, usuario, d)
    if ruta == "/api/plantilla/restaurar":
        return guardar_plantilla(c, usuario, d, restaurar=True)
    return None


def _nombre_pdf(c, i):
    k = c.execute("SELECT k.numero, k.tipo, k.id_lote, cl.nombre FROM contratos k JOIN ventas v ON v.id=k.venta_id "
                  "JOIN clientes cl ON cl.id=v.cliente_id WHERE k.id=?", (int(i),)).fetchone()
    if not k:
        raise ErrorNegocio("Contrato no encontrado.")
    limpio = re.sub(r"[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ ]+", "", k["nombre"]).strip().replace(" ", "_")[:40]
    return f"{k['numero']}_{TIPOS[k['tipo']]['nombre'].split(' (')[0].replace(' ', '_')}_{k['id_lote']}_{limpio}"
