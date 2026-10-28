# -*- coding: utf-8 -*-
"""Aislamiento contra un Postgres real (embebido con pgserver): dos clientes, una sola base, un schema cada uno."""
import json
import os
import sys
import tempfile

import pytest

pgserver = pytest.importorskip("pgserver")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from nucleo import base, bienes, bloques, contratos, desistimientos, seguridad, tenant  # noqa: E402


def _geojson(ids):
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": None, "properties": {"id_lote": i, "manzana": 1, "lote": n, "area_m2": 100.0}}
        for n, i in enumerate(ids, 1)]}


def _cliente(raiz, id_, lotes, puerto):
    c = os.path.join(raiz, id_)
    for d in ("datos", "marca", "cartografia"):
        os.makedirs(os.path.join(c, d))
    json.dump({"id": id_, "empresa": id_.upper(), "schema": True}, open(os.path.join(c, "cliente.json"), "w"))
    json.dump({"host": "127.0.0.1", "port": puerto, "dbname": "postgres", "user": "postgres", "password": "", "sslmode": "disable"},
              open(os.path.join(c, "datos", "supabase.json"), "w"))
    json.dump(_geojson(lotes), open(os.path.join(c, "cartografia", "lotes.geojson"), "w"))
    return c


@pytest.fixture(scope="module")
def plataforma():
    raiz = tempfile.mkdtemp()
    srv = pgserver.get_server(os.path.join(raiz, "pg"))
    puerto = int(srv.get_uri().rsplit(":", 1)[1].split("/")[0])
    tenant.TENANTS.clear()
    for id_, lotes in (("alfa", ["A-1", "A-2"]), ("beta", ["B-1", "B-2", "B-3"])):
        t = base.usar_cliente(_cliente(raiz, id_, lotes, puerto))
        base.iniciar_base()
        with base.conectar() as c:
            for m in (contratos, bienes, bloques, desistimientos):
                m.iniciar(c)
    yield
    for p in tenant._POOLS.values():
        p.close()
    tenant.TENANTS.clear()
    srv.cleanup()


def _lotes(id_):
    tenant.fijar(tenant.TENANTS[id_])
    with base.conectar() as c:
        return sorted(r["id_lote"] for r in c.execute("SELECT id_lote FROM lotes"))


def test_cada_cliente_ve_solo_sus_lotes(plataforma):
    assert _lotes("alfa") == ["A-1", "A-2"]
    assert _lotes("beta") == ["B-1", "B-2", "B-3"]


def test_las_tablas_viven_en_su_schema(plataforma):
    tenant.fijar(tenant.TENANTS["alfa"])
    with base.conectar() as c:
        filas = c.execute("SELECT table_schema FROM information_schema.tables WHERE table_name='lotes'").fetchall()
    assert sorted(r[0] for r in filas) == ["t_alfa", "t_beta"]       # una tabla por schema, ninguna en public


def test_escribir_en_uno_no_aparece_en_otro(plataforma):
    tenant.fijar(tenant.TENANTS["alfa"])
    with base.conectar() as c:
        base.set_config(c, "proyecto", "SOLO ALFA")
    for id_, esperado in (("alfa", "SOLO ALFA"), ("beta", None)):
        tenant.fijar(tenant.TENANTS[id_])
        with base.conectar() as c:
            assert (base.config(c).get("proyecto") == "SOLO ALFA") == (esperado == "SOLO ALFA")


def test_usuarios_y_sesiones_por_http(plataforma):
    http = TestClient(main.app)
    alfa, beta = {"host": "alfa.plataforma.com"}, {"host": "beta.plataforma.com"}
    assert http.get("/api/sesion/estado", headers=alfa).json()["configurado"] is False
    r = http.post("/api/sesion/configurar", headers=alfa, json={"nombre": "Dueña Alfa", "usuario": "ana", "clave": "secreta1"})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    assert http.get("/api/sesion/estado", headers=beta).json()["configurado"] is False      # beta no tiene usuarios
    assert http.get("/api/lotes", headers={**alfa, "X-Sesion": token}).status_code == 200
    assert http.get("/api/lotes", headers={**beta, "X-Sesion": token}).status_code == 401    # el token de alfa no sirve en beta
    assert http.post("/api/sesion/entrar", headers=beta, json={"usuario": "ana", "clave": "secreta1"}).status_code == 400
    assert len(http.get("/api/lotes", headers={**alfa, "X-Sesion": token}).json()) == 2


def test_la_sesion_sobrevive_a_otro_proceso(plataforma):
    """Con las sesiones en la base, otro worker (otro cliente HTTP, sin memoria compartida) las reconoce y el cierre es real."""
    alfa = {"host": "alfa.plataforma.com"}
    uno, dos = TestClient(main.app), TestClient(main.app)
    token = uno.post("/api/sesion/entrar", headers=alfa, json={"usuario": "ana", "clave": "secreta1"}).json()["token"]
    assert dos.get("/api/lotes", headers={**alfa, "X-Sesion": token}).status_code == 200
    assert dos.post("/api/sesion/salir", headers={**alfa, "X-Sesion": token}, json={}).status_code == 200
    assert uno.get("/api/lotes", headers={**alfa, "X-Sesion": token}).status_code == 401
    tenant.fijar(tenant.TENANTS["alfa"])
    with base.conectar() as c:
        assert not [r for r in c.execute("SELECT tok FROM sesiones") if r["tok"] == token]      # solo se guarda la huella
