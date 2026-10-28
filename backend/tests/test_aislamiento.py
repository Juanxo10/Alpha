# -*- coding: utf-8 -*-
"""Aislamiento entre clientes en un mismo proceso (sin base de datos). Se corre con: python -m pytest tests -q"""
import json
import os
import sys
import threading

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from nucleo import base, tenant  # noqa: E402


def _cliente(raiz, id_, pg_host, schema=False):
    c = raiz / id_
    (c / "datos").mkdir(parents=True)
    (c / "marca").mkdir()
    (c / "cartografia").mkdir()
    (c / "cliente.json").write_text(json.dumps({"id": id_, "empresa": id_.upper(), **({"schema": True} if schema else {})}))
    (c / "datos" / "supabase.json").write_text(json.dumps({"host": pg_host, "dbname": "x", "user": "u", "password": "p"}))
    (c / "marca" / "logo_claro.png").write_bytes(id_.encode())
    return str(c)


@pytest.fixture()
def dos(tmp_path):
    tenant.TENANTS.clear()
    a = tenant.registrar(_cliente(tmp_path, "alfa", "h1"))
    b = tenant.registrar(_cliente(tmp_path, "beta", "h2"))
    yield a, b
    tenant.TENANTS.clear()


def test_memo_y_version_son_por_cliente(dos):
    a, b = dos
    tenant.fijar(a)
    assert base.memo("k", lambda: "de-alfa") == "de-alfa"
    tenant.fijar(b)
    assert base.memo("k", lambda: "de-beta") == "de-beta"      # no reutiliza lo de alfa
    a.version[0] += 1                                           # una escritura de alfa...
    assert base.memo("k", lambda: "otra") == "de-beta"         # ...no invalida la caché de beta


def test_rutas_y_candado_siguen_al_cliente_activo(dos):
    a, b = dos
    tenant.fijar(a)
    assert base.CARTO.endswith(os.path.join("alfa", "cartografia")) and base.LOCK is a.lock
    tenant.fijar(b)
    assert base.CARTO.endswith(os.path.join("beta", "cartografia")) and base.LOCK is b.lock and a.lock is not b.lock


def test_hilo_nuevo_no_hereda_cliente(dos):
    tenant.fijar(dos[0])
    visto = []

    def f():
        try:
            tenant.actual()
        except RuntimeError:
            visto.append("sin cliente")
    h = threading.Thread(target=f)
    h.start()
    h.join()
    assert visto == ["sin cliente"]       # por eso alertas.arrancar() fija el cliente dentro del hilo


def test_cliente_por_subdominio_y_marca_propia(dos):
    http = TestClient(main.app)
    assert http.get("/marca/logo_claro.png", headers={"host": "alfa.plataforma.com"}).content == b"alfa"
    assert http.get("/marca/logo_claro.png", headers={"host": "beta.plataforma.com"}).content == b"beta"
    assert http.get("/marca/logo_claro.png", headers={"host": "otro.plataforma.com"}).status_code == 404
    assert http.get("/marca/../cliente.json", headers={"host": "alfa.plataforma.com"}).status_code == 404


def test_con_un_solo_cliente_cualquier_host_sirve(tmp_path):
    tenant.TENANTS.clear()
    tenant.registrar(_cliente(tmp_path, "solo", "h1"))
    assert TestClient(main.app).get("/marca/logo_claro.png", headers={"host": "geovisor-merced-jp.fly.dev"}).content == b"solo"
    tenant.TENANTS.clear()


def test_base_compartida_exige_schema_en_todos(tmp_path):
    tenant.TENANTS.clear()
    tenant.registrar(_cliente(tmp_path, "uno", "mismo", schema=True))
    with pytest.raises(SystemExit):
        tenant.registrar(_cliente(tmp_path, "dos", "mismo", schema=False))
    tenant.registrar(_cliente(tmp_path, "tres", "mismo", schema=True))
    assert tenant.TENANTS["tres"].schema == "t_tres"
    tenant.TENANTS.clear()


def test_id_de_cliente_no_permite_inyectar_en_schema(tmp_path):
    tenant.TENANTS.clear()
    c = _cliente(tmp_path, "ok", "h1")
    cfg = os.path.join(c, "cliente.json")
    json.dump({"id": 'x"; DROP SCHEMA public; --', "schema": True}, open(cfg, "w"))
    with pytest.raises(SystemExit):
        tenant.registrar(c)


def test_cliente_por_x_forwarded_host_y_clave_en_variable(tmp_path, monkeypatch):
    """Detrás de Vercel el Host es el de Render: manda X-Forwarded-Host. La clave de la base puede venir de PG_<ID>."""
    tenant.TENANTS.clear()
    for id_ in ("alfa", "beta"):
        d = _cliente(tmp_path, id_, "h")
        os.remove(os.path.join(d, "datos", "supabase.json"))          # sin archivo: solo variable de entorno
        monkeypatch.setenv(f"PG_{id_.upper()}", json.dumps({"host": f"h-{id_}", "dbname": "x", "user": "u", "password": "p"}))
        tenant.registrar(d)
    assert tenant.TENANTS["alfa"].pg["host"] == "h-alfa"
    http = TestClient(main.app)
    r = http.get("/marca/logo_claro.png", headers={"host": "geovisor-backend.onrender.com", "x-forwarded-host": "beta.plataforma.com"})
    assert r.content == b"beta"
    tenant.TENANTS.clear()


def test_salud_responde_sin_clientes(tmp_path):
    tenant.TENANTS.clear()
    http = TestClient(main.app)
    assert http.get("/salud").json() == {"ok": True, "clientes": 0}          # Render lo usa antes de copiar los clientes
    assert http.get("/api/sesion/estado").status_code == 404
    main.iniciar_todos(str(tmp_path))                                         # carpeta vacía: avisa y sigue, no se cae
