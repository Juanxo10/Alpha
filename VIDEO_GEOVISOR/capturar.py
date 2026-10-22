# -*- coding: utf-8 -*-
"""Capturas del geovisor para el video explicativo (Edge sin ventana vía Playwright).

Requiere el servidor de demostración:  servir.py 8150 --db VIDEO_GEOVISOR\\_demo\\demo.sqlite
Escribe PNG 1920x1080 en _capturas\\ y puntos de interés (cursor, recuadros) en _capturas\\puntos.json
"""
import json
import os

import fitz  # PyMuPDF
from playwright.sync_api import sync_playwright

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "_capturas")
URL = "http://localhost:8150/"
LOTE_MORA = "MZ16-L032"
LOTE_LIBRE = "MZ16-L036"
os.makedirs(OUT, exist_ok=True)
puntos = {}

ESPERA_MAPA = """() => new Promise((ok) => {
  const listo = () => E.mapa.loaded() && E.mapa.areTilesLoaded();
  let n = 0;
  const t = setInterval(() => { if (listo() || ++n > 120) { clearInterval(t); setTimeout(ok, 700); } }, 150);
})"""
SIN_TOOLTIP = "#tooltip{display:none!important} .avisos{display:none!important} .top .logo,.top .sep{display:none!important}"


def foto(page, nombre):
    page.screenshot(path=os.path.join(OUT, nombre + ".png"))
    print("  ", nombre)


def esperar(page, ms=600):
    page.wait_for_timeout(ms)


def caja(page, selector):
    b = page.locator(selector).first.bounding_box()
    return [round(b["x"]), round(b["y"]), round(b["width"]), round(b["height"])] if b else None


def pdf_a_png(pdf, prefijo, zoom=2.2):
    doc = fitz.open(pdf)
    for i, pg in enumerate(doc):
        pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom)).save(os.path.join(OUT, f"{prefijo}_{i + 1}.png"))
    print("  ", prefijo, len(doc), "páginas")


with sync_playwright() as pw:
    nav = pw.chromium.launch(channel="msedge", headless=True,
                             args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    ctx = nav.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1, locale="es-CO")
    ctx.add_init_script("try{localStorage.setItem('gv_usuario','Laura Gómez')}catch(e){}")
    page = ctx.new_page()
    page.goto(URL)
    page.wait_for_function("typeof E !== 'undefined' && E.mapaListo && E.lotes.length > 0", timeout=60000)
    page.add_style_tag(content=SIN_TOOLTIP)
    page.evaluate(ESPERA_MAPA)

    # ---------- 1. vista aérea limpia (fondo de la apertura y el cierre)
    page.add_style_tag(content=".ocultar-ui .top,.ocultar-ui .panel-izq,.ocultar-ui .mapa-pie,.ocultar-ui .maplibregl-control-container{display:none!important}")
    page.evaluate("""() => { document.body.classList.add('ocultar-ui'); E.mapa.resize();
      E.mapa.fitBounds(bbox(E.geo.limite), {padding: 70, duration: 0}); }""")
    page.evaluate(ESPERA_MAPA)
    foto(page, "c00_aereo")
    page.evaluate("() => { document.body.classList.remove('ocultar-ui'); E.mapa.resize(); E.mapa.fitBounds(bbox(E.geo.limite), {padding: 40, duration: 0}); }")
    page.evaluate(ESPERA_MAPA)

    # ---------- 2. mapa general y temas
    foto(page, "c01_mapa_estado")
    puntos["temas"] = {k: caja(page, f'#temas button[data-tema="{k}"]') for k in ("estado", "cartera", "avance")}
    puntos["panel_kpi"] = caja(page, "#kpisMini")
    puntos["leyenda"] = caja(page, "#leyenda")
    puntos["bases"] = caja(page, "#bases")
    for tema in ("cartera", "avance"):
        page.click(f'#temas button[data-tema="{tema}"]')
        page.evaluate(ESPERA_MAPA)
        foto(page, f"c02_mapa_{tema}")
    page.click('#temas button[data-tema="estado"]')
    page.evaluate(ESPERA_MAPA)
    page.evaluate("() => document.querySelector('.panel-izq').scrollTo(0, 9999)")
    esperar(page, 400)
    foto(page, "c03_panel_gestion")
    puntos["gestion"] = caja(page, "#gestion")
    page.evaluate("() => document.querySelector('.panel-izq').scrollTo(0, 0)")

    # ---------- 3. acercamiento a un lote en mora, antes y después del clic
    page.evaluate(f"""() => {{ const f = E.geo.lotesGeo.features.find((x) => x.properties.id_lote === '{LOTE_MORA}');
      E.mapa.fitBounds(bbox(f), {{padding: {{top: 520, bottom: 40, left: 80, right: 80}}, maxZoom: 19.2, duration: 0}}); }}""")
    page.evaluate(ESPERA_MAPA)
    foto(page, "c04_lote_antes")
    centro = page.evaluate(f"""() => {{ const f = E.geo.lotesGeo.features.find((x) => x.properties.id_lote === '{LOTE_MORA}');
      const [[a, b], [c, d]] = bbox(f); const p = E.mapa.project([(a + c) / 2, (b + d) / 2]);
      const r = E.mapa.getContainer().getBoundingClientRect(); return [p.x + r.left, p.y + r.top, (a + c) / 2, (b + d) / 2]; }}""")
    puntos["lote_mora"] = centro[:2]
    page.evaluate(f"() => abrirTarjeta('{LOTE_MORA}', [{centro[2]}, {centro[3]}])")
    esperar(page, 1200)
    foto(page, "c05_tarjeta")
    puntos["tarjeta"] = caja(page, ".hv-pop .maplibregl-popup-content")
    puntos["btn_pdf"] = caja(page, '.hv-pop [data-t="pdf"]')
    puntos["btn_pago"] = caja(page, '.hv-pop [data-t="pago"]')
    puntos["btn_ficha"] = caja(page, '.hv-pop [data-t="ficha"]')

    # ---------- 4. registrar pago (formulario) y emitir recibo
    page.click('.hv-pop [data-t="pago"]')
    esperar(page, 700)
    page.select_option('[name=medio]', 'Transferencia')
    page.fill('[name=referencia]', 'TRF 4471 Bancolombia')
    page.locator('[name=referencia]').blur()
    esperar(page, 300)
    foto(page, "c06_form_pago")
    puntos["modal"] = caja(page, ".modal")
    puntos["btn_enviar"] = caja(page, "#btnEnviar")
    page.click("#btnEnviar")
    esperar(page, 2500)
    foto(page, "c07_pago_ok")
    recibo = page.evaluate("() => (document.querySelector('#modalCuerpo').innerText.match(/N° (\\d+)/) || [])[1]")
    page.click("[data-cerrar2]")
    esperar(page, 800)

    # ---------- 5. ficha completa con plan de pagos
    page.evaluate(f"() => abrirFicha('{LOTE_MORA}', {{sinZoom: true}})")
    esperar(page, 1500)
    page.evaluate(ESPERA_MAPA)
    foto(page, "c08_ficha")
    puntos["ficha"] = caja(page, "#ficha")
    page.evaluate("() => document.querySelector('#fichaCont').scrollTo(0, 9999)")
    esperar(page, 500)
    foto(page, "c09_ficha_plan")
    page.evaluate("() => cerrarFicha()")
    esperar(page, 600)

    # ---------- 6. vender un lote disponible (formulario con plan automático)
    centro2 = page.evaluate(f"""() => {{ const f = E.geo.lotesGeo.features.find((x) => x.properties.id_lote === '{LOTE_LIBRE}');
      const [[a, b], [c, d]] = bbox(f); return [(a + c) / 2, (b + d) / 2]; }}""")
    page.evaluate(f"() => abrirTarjeta('{LOTE_LIBRE}', [{centro2[0]}, {centro2[1]}])")
    esperar(page, 1000)
    foto(page, "c10_tarjeta_libre")
    page.click('.hv-pop [data-t="vender"]')
    esperar(page, 700)
    for campo, valor in (("c_nombre", "Mónica Alejandra Ruiz Vela"), ("c_documento", "1121845390"), ("c_telefono", "3124587710"),
                         ("c_email", "monica.ruiz@gmail.com"), ("c_direccion", "Calle 37 # 29-15, Villavicencio"),
                         ("cuota_inicial", "3600000"), ("n_cuotas", "24"), ("vendedor", "Laura Gómez")):
        page.fill(f"[name={campo}]", valor)
        page.locator(f"[name={campo}]").dispatch_event("input")
    page.locator("[name=c_nombre]").blur()
    esperar(page, 400)
    page.evaluate("() => document.querySelector('.modal-cuerpo').scrollTo(0, 9999)")
    esperar(page, 300)
    foto(page, "c11_form_venta")
    puntos["res_plan"] = caja(page, "#resPlan")
    page.click("[data-cerrar2]")
    esperar(page, 500)

    # ---------- 7. buscador
    page.evaluate("() => E.popup && E.popup.remove()")
    page.click("#buscar")
    page.keyboard.type("Castro", delay=60)
    esperar(page, 600)
    foto(page, "c12_buscador")
    puntos["buscador"] = caja(page, ".buscador")
    puntos["sugerencias"] = caja(page, "#sugerencias")
    page.keyboard.press("Escape")
    page.fill("#buscar", "")

    # ---------- 8. tablero, cartera, pagos, configuración
    page.click('#tabs button[data-vista="tablero"]')
    esperar(page, 1200)
    foto(page, "c13_tablero")
    puntos["kpis"] = caja(page, "#kpis")
    page.evaluate("() => document.querySelector('#vista-tablero').scrollTo(0, 560)")
    esperar(page, 500)
    foto(page, "c14_tablero_manzanas")
    page.click('#tabs button[data-vista="cartera"]')
    esperar(page, 900)
    page.select_option("#cCartera", "MORA")
    page.locator("#cCartera").dispatch_event("input")
    esperar(page, 700)
    foto(page, "c15_cartera_mora")
    puntos["exportar"] = caja(page, '#vista-cartera a.btn')
    page.click('#tabs button[data-vista="pagos"]')
    esperar(page, 1200)
    foto(page, "c16_pagos")
    page.click("#btnConfig")
    esperar(page, 700)
    foto(page, "c17_config")
    puntos["respaldo"] = caja(page, "#btnRespaldo")
    page.click("[data-cerrar2]")

    # ---------- 9. ortofoto en detalle
    page.click('#tabs button[data-vista="mapa"]')
    esperar(page, 500)
    page.evaluate(f"""() => {{ const f = E.geo.lotesGeo.features.find((x) => x.properties.id_lote === '{LOTE_MORA}');
      const [[a, b], [c, d]] = bbox(f); E.mapa.jumpTo({{center: [(a + c) / 2, (b + d) / 2], zoom: 20.3}});
      const r = document.querySelector('#rngOpac'); r.value = 35; r.dispatchEvent(new Event('input')); }}""")
    page.evaluate(ESPERA_MAPA)
    foto(page, "c18_orto_detalle")

    # ---------- 10. documentos en PDF (recibo y hoja de vida)
    for nombre, q in (("doc_recibo", f"?sinusuario&recibo={recibo}"), ("doc_hoja", f"?sinusuario&hoja={LOTE_MORA}")):
        p2 = ctx.new_page()
        p2.goto(URL + q)
        p2.wait_for_timeout(5000)
        # el video va sin marca: fuera el pie «Sistema de ventas y cartera · logo»
        p2.evaluate("""() => document.querySelectorAll('.sis').forEach((s) => {
          const a = s.previousSibling; if (a && a.nodeType === 3) a.textContent = a.textContent.replace(/\s*·\s*$/, '');
          s.remove(); })""")
        ruta = os.path.join(OUT, nombre + ".pdf")
        p2.pdf(path=ruta, format="Letter", print_background=True, prefer_css_page_size=True)
        p2.close()
        pdf_a_png(ruta, nombre)
    nav.close()

puntos["recibo"] = recibo
with open(os.path.join(OUT, "puntos.json"), "w", encoding="utf-8") as f:
    json.dump(puntos, f, indent=1, ensure_ascii=False)
print("listo · recibo", recibo)
