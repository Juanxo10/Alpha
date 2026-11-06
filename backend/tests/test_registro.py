# -*- coding: utf-8 -*-
"""Estado «Registrado» (ORIP + matrícula) contra un Postgres real embebido (pgserver)."""
import datetime as dt
import json
import os
import sys
import tempfile

import pytest

pgserver = pytest.importorskip("pgserver")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from nucleo import base, tenant  # noqa: E402

HOY = dt.date.today()
H = {"host": "reg.plataforma.com"}


@pytest.fixture(scope="module")
def web():
    raiz = tempfile.mkdtemp()
    srv = pgserver.get_server(os.path.join(raiz, "pg"))
    puerto = int(srv.get_uri().rsplit(":", 1)[1].split("/")[0])
    c = os.path.join(raiz, "reg")
    for d in ("datos", "marca", "cartografia"):
        os.makedirs(os.path.join(c, d))
    json.dump({"id": "reg", "empresa": "REG", "schema": True}, open(os.path.join(c, "cliente.json"), "w"))
    json.dump({"host": "127.0.0.1", "port": puerto, "dbname": "postgres", "user": "postgres", "password": "", "sslmode": "disable"},
              open(os.path.join(c, "datos", "supabase.json"), "w"))
    json.dump({"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": None, "properties": {"id_lote": f"L-{n}", "manzana": 1, "lote": n, "area_m2": 100.0}}
        for n in (1, 2, 3)]}, open(os.path.join(c, "cartografia", "lotes.geojson"), "w"))
    tenant.TENANTS.clear()
    main.iniciar(c)
    http = TestClient(main.app)
    dueno = http.post("/api/sesion/configurar", headers=H, json={"nombre": "Dueño", "usuario": "dueno", "clave": "secreta1234"}).json()["token"]
    http.post("/api/usuarios/guardar", headers={**H, "X-Sesion": dueno},
              json={"nombre": "Op", "usuario": "oper", "clave": "secreta1234", "rol": "OPERADOR"})
    oper = http.post("/api/sesion/entrar", headers=H, json={"usuario": "oper", "clave": "secreta1234"}).json()["token"]
    yield http, {**H, "X-Sesion": dueno}, {**H, "X-Sesion": oper}
    for p in tenant._POOLS.values():
        p.close()
    tenant.TENANTS.clear()
    srv.cleanup()


def _venta(http, hd, lote, doc, escriturar=True):
    r = http.post("/api/venta/vender", headers=hd, json={"id_lote": lote, "valor_venta": 1_000_000, "cuota_inicial": 0, "n_cuotas": 0,
                                                         "cliente": {"nombre": "Comprador " + doc, "documento": doc}})
    assert r.status_code == 200, r.text
    vid = r.json()["venta_id"]
    assert http.post("/api/pago", headers=hd, json={"venta_id": vid, "valor": 1_000_000, "fecha": HOY.isoformat(), "concepto": "Pago total",
                                                    "medio": "Efectivo"}).status_code == 200
    if escriturar:
        f = (HOY - dt.timedelta(days=10)).isoformat()
        assert http.post("/api/venta/escriturar", headers=hd, json={"venta_id": vid, "fecha_escritura": f, "numero_escritura": "99",
                                                                    "notaria": "Notaría 1"}).status_code == 200
    return vid


def _estado(http, hd, lote):
    return next(l for l in http.get("/api/lotes", headers=hd).json() if l["id_lote"] == lote)["estado"]


def test_flujo_completo(web):
    http, hd, ho = web
    ok = {"fecha_registro": HOY.isoformat(), "orip": "Villavicencio", "matricula_inmobiliaria": "230-123456"}
    v1 = _venta(http, hd, "L-1", "10000001", escriturar=False)
    err = lambda body, txt, h=hd: (lambda r: r.status_code == 400 and txt.lower() in r.json()["error"].lower())(
        http.post("/api/registro/registrar", headers=h, json=body))
    assert err({"venta_id": v1, **ok}, "escriturada")                                   # sin escritura
    http.post("/api/venta/escriturar", headers=hd, json={"venta_id": v1, "fecha_escritura": (HOY - dt.timedelta(days=10)).isoformat(),
                                                         "numero_escritura": "99", "notaria": "N1"})
    assert _estado(http, hd, "L-1") == "ESCRITURADO"
    assert err({"venta_id": v1, **ok, "matricula_inmobiliaria": ""}, "obligatoria")
    assert err({"venta_id": v1, **ok, "matricula_inmobiliaria": "23-1"}, "formato")
    assert err({"venta_id": v1, **ok, "orip": ""}, "orip")
    assert err({"venta_id": v1, **ok, "fecha_registro": (HOY + dt.timedelta(days=2)).isoformat()}, "futura")
    assert err({"venta_id": v1, **ok, "fecha_registro": (HOY - dt.timedelta(days=30)).isoformat()}, "anterior")
    r = http.post("/api/registro/registrar", headers=hd, json={"venta_id": v1, **ok, "numero_turno": "T-1"})
    assert r.status_code == 200, r.text
    assert _estado(http, hd, "L-1") == "REGISTRADO"                                       # no se convierte en PAGADO
    res = http.get("/api/resumen", headers=hd).json()
    assert res["conteo"]["REGISTRADO"] == 1 and res["valor_vendido"] == 1_000_000      # cuenta como vendido
    d = http.get("/api/lote?id=L-1", headers=hd).json()
    assert d["ventas"][0]["registro"]["matricula_inmobiliaria"] == "230-123456"
    assert d["ventas"][0]["registro"]["propietario_inscrito"] == "Comprador 10000001"          # precargado con el comprador
    assert http.get(f"/api/nf/registro?venta_id={v1}", headers=hd).json()["vigente"]["numero_turno"] == "T-1"
    # matrícula repetida en otro lote
    v2 = _venta(http, hd, "L-2", "10000002")
    assert err({"venta_id": v2, **ok}, "ya está registrada en el lote")
    r = http.post("/api/lote/registrar", headers=hd, json={"id_lote": "L-3", "registrado": True})      # lote sin vender
    assert r.status_code == 400 and _estado(http, hd, "L-3") == "DISPONIBLE"
    # edición
    assert http.post("/api/registro/editar", headers=hd, json={"venta_id": v1, "numero_anotacion": "7"}).status_code == 200
    assert http.get(f"/api/nf/registro?venta_id={v1}", headers=hd).json()["vigente"]["numero_anotacion"] == "7"
    # el operador que anula queda pendiente; el estado no cambia
    r = http.post("/api/registro/anular", headers=ho, json={"venta_id": v1, "motivo": "error"})
    assert r.status_code == 200 and r.json().get("pendiente")
    assert _estado(http, hd, "L-1") == "REGISTRADO"
    sol = [s for s in http.get("/api/solicitudes", headers=hd).json() if s["estado"] == "PENDIENTE"]
    assert sol and "registro" in sol[0]["resumen"].lower()
    # el dueño anula: vuelve a Escriturado
    assert http.post("/api/registro/anular", headers=hd, json={"venta_id": v1, "motivo": ""}).status_code == 400
    assert http.post("/api/registro/anular", headers=hd, json={"venta_id": v1, "motivo": "corrección"}).status_code == 200
    assert _estado(http, hd, "L-1") == "ESCRITURADO"
    h = http.get(f"/api/nf/registro?venta_id={v1}", headers=hd).json()
    assert h["vigente"] is None and h["historial"][0]["estado"] == "ANULADO"
    acc = {b["accion"] for b in http.get("/api/auditoria?limite=300", headers=hd).json()["filas"]}
    assert {"REGISTRO", "REGISTRO_EDITADO", "REGISTRO_ANULADO"} <= acc
    # tras anular, la matrícula queda libre para el otro lote
    assert http.post("/api/registro/registrar", headers=hd, json={"venta_id": v2, **ok}).status_code == 200
