# -*- coding: utf-8 -*-
"""Prospectos: interesados en comprar, seguimiento comercial y embudo de ventas."""
import re

from .base import ErrorNegocio, ahora, bitacora, hoy, num

ESTADOS = {"NUEVO": "Nuevo", "CONTACTADO": "Contactado", "VISITA": "Visita al lote", "NEGOCIACION": "En negociación",
           "GANADO": "Compró", "PERDIDO": "Perdido"}
ORIGENES = ["Referido", "Facebook / Instagram", "WhatsApp", "Valla o aviso", "Visita espontánea", "Comisionista",
            "Página web", "Otro"]


def listar(c):
    notas = {}
    for n in c.execute("SELECT * FROM prospecto_notas ORDER BY id"):
        notas.setdefault(n["prospecto_id"], []).append(dict(n))
    hoy_ = hoy().isoformat()
    filas = []
    for p in c.execute("SELECT p.*, cm.nombre comisionista FROM prospectos p LEFT JOIN comisionistas cm ON cm.id=p.comisionista_id "
                       "ORDER BY p.actualizado DESC"):
        d = dict(p)
        d["notas"] = notas.get(p["id"], [])[::-1]
        d["atrasado"] = bool(p["fecha_proxima"] and p["fecha_proxima"] < hoy_ and p["estado"] not in ("GANADO", "PERDIDO"))
        filas.append(d)
    embudo = {k: sum(1 for f in filas if f["estado"] == k) for k in ESTADOS}
    cerrados = embudo["GANADO"] + embudo["PERDIDO"]
    return {"prospectos": filas, "embudo": embudo,
            "conversion": round(100 * embudo["GANADO"] / cerrados, 1) if cerrados else None,
            "seguimientos_hoy": sum(1 for f in filas if f["fecha_proxima"] == hoy_ and f["estado"] not in ("GANADO", "PERDIDO")),
            "atrasados": sum(1 for f in filas if f["atrasado"])}


def guardar(c, usuario, d):
    nombre = (d.get("nombre") or "").strip()
    if not nombre:
        raise ErrorNegocio("El nombre es obligatorio.")
    if not (d.get("telefono") or d.get("email")):
        raise ErrorNegocio("Registre al menos un teléfono o un correo.")
    tel = (d.get("telefono") or "").strip()
    if tel and not (re.fullmatch(r"[0-9 +\-]+", tel) and 7 <= sum(ch.isdigit() for ch in tel) <= 13):
        raise ErrorNegocio("El teléfono debe tener entre 7 y 13 dígitos (se permiten espacios, + y guiones).")
    campos = {k: (d.get(k) or "").strip() if isinstance(d.get(k), str) else d.get(k)
              for k in ("telefono", "email", "documento", "origen", "lotes_interes", "fecha_proxima", "proxima_accion", "notas")}
    campos["nombre"] = nombre
    campos["comisionista_id"] = int(d["comisionista_id"]) if d.get("comisionista_id") else None
    campos["presupuesto"] = round(num(d.get("presupuesto"))) if d.get("presupuesto") not in (None, "") else None
    campos["actualizado"] = ahora()
    if d.get("id"):
        pid = int(d["id"])
        c.execute(f"UPDATE prospectos SET {', '.join(k + '=?' for k in campos)} WHERE id=?", (*campos.values(), pid))
        return {"ok": True, "id": pid}
    campos.update(estado="NUEVO", usuario=usuario, creado=ahora())
    pid = c.execute(f"INSERT INTO prospectos ({', '.join(campos)}) VALUES ({', '.join('?' * len(campos))})",
                    tuple(campos.values())).lastrowid
    bitacora(c, usuario, "PROSPECTO_NUEVO", None, {"prospecto_id": pid, "nombre": nombre, "origen": campos.get("origen")})
    return {"ok": True, "id": pid}


def nota(c, usuario, d):
    if not (d.get("nota") or "").strip():
        raise ErrorNegocio("Escriba la nota del seguimiento.")
    pid = int(d["prospecto_id"])
    c.execute("INSERT INTO prospecto_notas (prospecto_id, fecha, tipo, nota, usuario) VALUES (?,?,?,?,?)",
              (pid, hoy().isoformat(), d.get("tipo") or "NOTA", d["nota"].strip(), usuario))
    sets, vals = ["actualizado=?"], [ahora()]
    if "fecha_proxima" in d:
        sets.append("fecha_proxima=?")
        vals.append(d.get("fecha_proxima") or None)
    if "proxima_accion" in d:
        sets.append("proxima_accion=?")
        vals.append((d.get("proxima_accion") or "").strip())
    c.execute(f"UPDATE prospectos SET {', '.join(sets)} WHERE id=?", (*vals, pid))
    return {"ok": True}


def cambiar_estado(c, usuario, d):
    est = d.get("estado")
    if est not in ESTADOS:
        raise ErrorNegocio("Estado no válido.")
    if est == "PERDIDO" and not (d.get("motivo") or "").strip():
        raise ErrorNegocio("Indique por qué se perdió el prospecto.")
    pid = int(d["id"])
    c.execute("UPDATE prospectos SET estado=?, motivo_perdida=?, actualizado=? WHERE id=?",
              (est, (d.get("motivo") or "").strip() or None, ahora(), pid))
    c.execute("INSERT INTO prospecto_notas (prospecto_id, fecha, tipo, nota, usuario) VALUES (?,?,?,?,?)",
              (pid, hoy().isoformat(), "ESTADO", f"Cambió a «{ESTADOS[est]}»" + (f": {d['motivo'].strip()}" if d.get("motivo") else ""), usuario))
    return {"ok": True}


def marcar_ganado(c, usuario, pid, venta_id):
    c.execute("UPDATE prospectos SET estado='GANADO', venta_id=?, actualizado=? WHERE id=?", (venta_id, ahora(), pid))
    c.execute("INSERT INTO prospecto_notas (prospecto_id, fecha, tipo, nota, usuario) VALUES (?,?,?,?,?)",
              (pid, hoy().isoformat(), "ESTADO", "Compró: negocio registrado en el geovisor", usuario))


def acciones(c, usuario, ruta, d):
    if ruta == "/api/prospecto/guardar":
        return guardar(c, usuario, d)
    if ruta == "/api/prospecto/nota":
        return nota(c, usuario, d)
    if ruta == "/api/prospecto/estado":
        return cambiar_estado(c, usuario, d)
    return None
