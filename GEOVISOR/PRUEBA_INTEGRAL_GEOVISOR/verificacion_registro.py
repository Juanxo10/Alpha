# -*- coding: utf-8 -*-
"""Prueba del estado «Registrado». Usa una base NUEVA y temporal (nunca datos/contabilidad.sqlite).
Uso: python verificacion_registro.py [puerto]"""
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
sys.stdout.reconfigure(encoding="utf-8")
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
URL = f"http://127.0.0.1:{PUERTO}"
FALLAS = []


def ok(cond, msg):
    print(("  OK   " if cond else "  FALLA ") + msg)
    if not cond:
        FALLAS.append(msg)


def llamar(ruta, datos=None, tok=""):
    req = urllib.request.Request(URL + ruta, headers={"X-Sesion": tok, "Content-Type": "application/json"},
                                 data=None if datos is None else json.dumps(datos).encode())
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def rechaza(ruta, datos, tok, texto):
    c, r = llamar(ruta, datos, tok)
    ok(c == 400 and texto.lower() in r.get("error", "").lower(), f"rechaza: {texto} → {r.get('error')}")


tmp = tempfile.mkdtemp()
db = os.path.join(tmp, "prueba.sqlite")
servidor = subprocess.Popen([sys.executable, "servir.py", str(PUERTO), "--db", db, "--sin-navegador", "--sin-tareas"],
                            cwd=RAIZ, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(60):
        try:
            urllib.request.urlopen(URL + "/api/lotes").read()
            break
        except urllib.error.HTTPError:
            break
        except Exception:
            time.sleep(0.5)
    _, r = llamar("/api/sesion/configurar", {"nombre": "Dueño Prueba", "usuario": "dueno", "clave": "secreto1"})
    dueno = r["token"]
    llamar("/api/usuarios/guardar", {"nombre": "Operador Prueba", "usuario": "oper", "clave": "secreto1", "rol": "OPERADOR"}, dueno)
    oper = llamar("/api/sesion/entrar", {"usuario": "oper", "clave": "secreto1"})[1]["token"]
    lotes = [l["id_lote"] for l in llamar("/api/lotes", tok=dueno)[1]]
    A, B = lotes[0], lotes[1]
    hoy = dt.date.today()
    esc_fecha = (hoy - dt.timedelta(days=10)).isoformat()

    def vender_y_escriturar(lote, doc, escriturar=True):
        llamar("/api/lote/precio", {"id_lote": lote, "precio_lista": 50_000_000}, dueno)
        _, v = llamar("/api/venta/vender", {"id_lote": lote, "valor_venta": 50_000_000, "cuota_inicial": 0, "n_cuotas": 0,
                                            "cliente": {"nombre": "Comprador " + doc, "documento": doc}}, dueno)
        llamar("/api/pago", {"venta_id": v["venta_id"], "valor": 50_000_000, "fecha": hoy.isoformat(), "concepto": "Pago total",
                             "medio": "Efectivo"}, dueno)
        if escriturar:
            llamar("/api/venta/escriturar", {"venta_id": v["venta_id"], "fecha_escritura": esc_fecha,
                                              "numero_escritura": "1234", "notaria": "Notaría Primera"}, dueno)
        return v["venta_id"]

    print("Rechazos")
    vA = vender_y_escriturar(A, "111", escriturar=False)
    base = {"fecha_registro": hoy.isoformat(), "orip": "Villavicencio", "matricula_inmobiliaria": "230-123456"}
    rechaza("/api/registro/registrar", {"venta_id": vA, **base}, dueno, "ya esté escriturada")
    llamar("/api/venta/escriturar", {"venta_id": vA, "fecha_escritura": esc_fecha, "numero_escritura": "1234", "notaria": "Notaría Primera"}, dueno)
    rechaza("/api/registro/registrar", {"venta_id": vA, **{**base, "matricula_inmobiliaria": ""}}, dueno, "matrícula inmobiliaria es obligatoria")
    rechaza("/api/registro/registrar", {"venta_id": vA, **{**base, "matricula_inmobiliaria": "23-12"}}, dueno, "formato")
    rechaza("/api/registro/registrar", {"venta_id": vA, **{**base, "orip": ""}}, dueno, "ORIP")
    rechaza("/api/registro/registrar", {"venta_id": vA, **{**base, "fecha_registro": ""}}, dueno, "fecha de registro es obligatoria")
    rechaza("/api/registro/registrar", {"venta_id": vA, **{**base, "fecha_registro": (hoy + dt.timedelta(days=3)).isoformat()}}, dueno, "futura")
    rechaza("/api/registro/registrar", {"venta_id": vA, **{**base, "fecha_registro": (hoy - dt.timedelta(days=20)).isoformat()}}, dueno, "anterior")

    print("Flujo con clics reales")
    from playwright.sync_api import sync_playwright
    errores = []
    with sync_playwright() as p:
        nav = p.chromium.launch(channel="msedge", headless=True)
        pag = nav.new_context(viewport={"width": 1500, "height": 950}).new_page()
        pag.on("console", lambda m: errores.append(m.text) if m.type == "error" and "404" not in m.text else None)
        pag.on("pageerror", lambda e: errores.append(str(e)))
        pag.on("response", lambda r: errores.append("404 " + r.url) if r.status == 404 and "favicon" not in r.url and "/data/orto/" not in r.url else None)
        pag.add_init_script(f"sessionStorage.setItem('gv_token', '{dueno}')")
        pag.goto(URL)
        pag.wait_for_function("typeof E !== 'undefined' && E.mapaListo && E.lotes.length > 0", timeout=60000)
        pag.evaluate(f"abrirFicha('{A}')")
        pag.wait_for_selector("#fichaCont .f-acciones")
        pag.click("#fichaCont button:text-is('Registrar')")
        ok(pag.locator("#modalTit").inner_text().startswith("Registro de la escritura"), "se abre la ventana de registro")
        pag.fill("[name=orip]", "Villavicencio")
        pag.fill("[name=matricula_inmobiliaria]", "230-123456")
        pag.fill("[name=numero_turno]", "2026-0042")
        pag.fill("[name=numero_anotacion]", "7")
        cert = os.path.join(tmp, "certificado.pdf")
        open(cert, "wb").write(b"%PDF-1.4 prueba")
        pag.set_input_files("#regCert", cert)
        pag.click("#btnEnviar")
        pag.wait_for_selector("#fichaCont h4:has-text('Registro')", timeout=15000)
        ok(True, "la ficha muestra el bloque «Registro»")
        ok("230-123456" in pag.locator("#fichaCont").inner_text(), "la ficha muestra la matrícula")
        ok(pag.locator("#fichaCont a[data-reg-adj]").count() == 1, "el certificado queda enlazado como soporte")
        ok(pag.evaluate(f"E.porId['{A}'].estado") == "REGISTRADO", "el lote cambia a REGISTRADO en el mapa")
        ok(pag.evaluate("ESTADOS.REGISTRADO.nom") == "Registrado" and "Registrado" in pag.locator("#leyenda").inner_text(),
           "la leyenda trae «Registrado» con su conteo")
        k = pag.evaluate("Object.keys(ESTADOS)")
        ok(k.index("REGISTRADO") == k.index("ESCRITURADO") + 1, "queda justo después de Escriturado")
        pag.locator("#leyenda .ley:has-text('Registrado')").click()
        ok(pag.evaluate("E.ocultas.has('REGISTRADO')"), "el filtro de la leyenda funciona")
        pag.locator("#leyenda .ley:has-text('Registrado')").click()
        html = pag.evaluate(f"hojaDeVidaHTML(E.detalle)")
        ok("Escritura y registro" in html and "230-123456" in html, "la ficha integral trae «Escritura y registro»")
        nav.close()

    res = llamar("/api/resumen", tok=dueno)[1]
    ok(res["conteo"].get("REGISTRADO") == 1 and res["valor_vendido"] == 50_000_000, "el resumen lo cuenta como vendido")
    ok(llamar("/api/lotes", tok=dueno)[1][0]["estado"] == "REGISTRADO", "el lote no se convierte en PAGADO")

    print("Matrícula repetida y anulación")
    vB = vender_y_escriturar(B, "222")
    rechaza("/api/registro/registrar", {"venta_id": vB, **base}, dueno, "ya está registrada en el lote")
    c, _ = llamar("/api/registro/editar", {"venta_id": vA, "numero_anotacion": "9", "observaciones": "corregido"}, dueno)
    ok(c == 200, "editar corrige el registro")
    c, r = llamar("/api/registro/anular", {"venta_id": vA, "motivo": "Devolución por nota"}, oper)
    ok(c == 200 and r.get("pendiente"), "operador que anula queda pendiente de aprobación")
    ok(llamar(f"/api/lote?id={A}", tok=dueno)[1]["resumen"]["estado"] == "REGISTRADO", "sigue Registrado mientras no se aprueba")
    rechaza("/api/registro/anular", {"venta_id": vA, "motivo": ""}, dueno, "motivo")
    c, _ = llamar("/api/registro/anular", {"venta_id": vA, "motivo": "Error de digitación"}, dueno)
    d = llamar(f"/api/lote?id={A}", tok=dueno)[1]
    ok(c == 200 and d["resumen"]["estado"] == "ESCRITURADO", "al anular el dueño, el lote vuelve a Escriturado")
    ok(len(d["ventas"][0]["registros_historial"]) == 1 and d["ventas"][0]["registro"] is None, "el registro anulado queda en el historial")
    acc = [b["accion"] for b in llamar("/api/auditoria?limite=200", tok=dueno)[1]["filas"]]
    ok({"REGISTRO", "REGISTRO_EDITADO", "REGISTRO_ANULADO"} <= set(acc), "todo queda en la bitácora")
    ok(llamar("/api/auditoria", tok=dueno)[1]["integridad"].get("ok", True), "la cadena de la bitácora sigue íntegra")
    ok(not errores, "sin errores en la consola del navegador" + (f": {errores[:3]}" if errores else ""))
finally:
    servidor.terminate()
    shutil.rmtree(tmp, ignore_errors=True)
print("\nRESULTADO:", "TODO BIEN" if not FALLAS else f"{len(FALLAS)} FALLAS")
sys.exit(1 if FALLAS else 0)
