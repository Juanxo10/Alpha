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
    r = http.post("/api/sesion/configurar", headers=alfa, json={"nombre": "Dueña Alfa", "usuario": "ana", "clave": "secreta1234"})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    assert http.get("/api/sesion/estado", headers=beta).json()["configurado"] is False      # beta no tiene usuarios
    assert http.get("/api/lotes", headers={**alfa, "X-Sesion": token}).status_code == 200
    assert http.get("/api/lotes", headers={**beta, "X-Sesion": token}).status_code == 401    # el token de alfa no sirve en beta
    assert http.post("/api/sesion/entrar", headers=beta, json={"usuario": "ana", "clave": "secreta1234"}).status_code == 400
    assert len(http.get("/api/lotes", headers={**alfa, "X-Sesion": token}).json()) == 2


def test_la_sesion_sobrevive_a_otro_proceso(plataforma):
    """Con las sesiones en la base, otro worker (otro cliente HTTP, sin memoria compartida) las reconoce y el cierre es real."""
    alfa = {"host": "alfa.plataforma.com"}
    uno, dos = TestClient(main.app), TestClient(main.app)
    token = uno.post("/api/sesion/entrar", headers=alfa, json={"usuario": "ana", "clave": "secreta1234"}).json()["token"]
    assert dos.get("/api/lotes", headers={**alfa, "X-Sesion": token}).status_code == 200
    assert dos.post("/api/sesion/salir", headers={**alfa, "X-Sesion": token}, json={}).status_code == 200
    assert uno.get("/api/lotes", headers={**alfa, "X-Sesion": token}).status_code == 401
    tenant.fijar(tenant.TENANTS["alfa"])
    with base.conectar() as c:
        assert not [r for r in c.execute("SELECT tok FROM sesiones") if r["tok"] == token]      # solo se guarda la huella


def test_codigo_por_correo_para_todos_los_roles(plataforma, monkeypatch):
    from nucleo import alertas
    enviados = []
    monkeypatch.setattr(alertas, "_correo", lambda cfg, destino, asunto, cuerpo, adj: enviados.append(cuerpo))
    seguridad.FALLOS_IP.clear()
    alfa = {"host": "alfa.plataforma.com"}
    http = TestClient(main.app)
    tenant.fijar(tenant.TENANTS["alfa"])
    with base.conectar() as c:
        base.set_config(c, "smtp_usuario", "x@x.com")
        base.set_config(c, "smtp_clave", "x")
        base.set_config(c, "codigo_correo", "1")
        c.execute("UPDATE usuarios SET email='ana@x.com' WHERE usuario='ana'")
    cuerpo = {"usuario": "ana", "clave": "secreta1234"}
    try:
        r = http.post("/api/sesion/entrar", headers=alfa, json=cuerpo).json()
        assert r["codigo_requerido"] and len(enviados) == 1
        codigo = enviados[-1].split("<b>")[1][:6]
        assert http.post("/api/sesion/codigo", headers=alfa, json={"reto": r["reto"], "codigo": "000000" if codigo != "000000" else "111111"}).status_code == 400
        assert http.post("/api/sesion/reenviar", headers=alfa, json={"reto": r["reto"]}).status_code == 400      # antes de 30 s
        ok = http.post("/api/sesion/codigo", headers=alfa, json={"reto": r["reto"], "codigo": codigo})
        assert ok.status_code == 200 and ok.json()["token"]
        assert http.post("/api/sesion/codigo", headers=alfa, json={"reto": r["reto"], "codigo": codigo}).status_code == 400   # un solo uso
        with base.conectar() as c:      # sin correo registrado no se puede entrar
            c.execute("UPDATE usuarios SET email='' WHERE usuario='ana'")
        assert http.post("/api/sesion/entrar", headers=alfa, json=cuerpo).status_code == 400
        # el SMTP falla: error claro y no queda reto
        with base.conectar() as c:
            c.execute("UPDATE usuarios SET email='ana@x.com' WHERE usuario='ana'")
        monkeypatch.setattr(alertas, "_correo", lambda *a: (_ for _ in ()).throw(OSError("smtp caído")))
        assert http.post("/api/sesion/entrar", headers=alfa, json=cuerpo).status_code == 400
        with base.conectar() as c:
            assert c.execute("SELECT COUNT(*) FROM retos_ingreso").fetchone()[0] == 0
    finally:
        with base.conectar() as c:
            base.set_config(c, "smtp_usuario", "")
            base.set_config(c, "smtp_clave", "")
            base.set_config(c, "codigo_correo", "0")
