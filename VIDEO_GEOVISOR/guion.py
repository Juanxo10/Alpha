# -*- coding: utf-8 -*-
"""Guion del video explicativo del geovisor: locución + puesta en escena de cada plano.

Coordenadas en píxeles de las capturas (1920x1080).
  img:    lista de (fracción_del_plano, captura) — se funden en ese momento
  cam:    lista de (fracción, [x, y, ancho]) — encuadre de la cámara (alto = ancho·9/16)
  marcas: lista de (fracción_desde, [x, y, w, h]) — recuadros que resaltan un elemento
  cursor: lista de (fracción, [x, y], clic) — puntero animado
  rotulo: (sección, título) en el tercio inferior
"""
COMPLETO = [0, 0, 1920]

PLANOS = [
    dict(id=1, tipo="titulo",
         texto="Geovisor de ventas y cartera. Toda la contabilidad de un loteo, organizada sobre su propio mapa."),

    dict(id=2, tipo="captura", rotulo=("El loteo", "1.382 lotes · 43 manzanas"),
         texto="Este es el Loteo La Merced: mil trescientos ochenta y dos lotes, en cuarenta y tres manzanas, "
               "dibujados sobre una ortofoto de dron. Cada lote tiene un código único, formado por su manzana y su número.",
         img=[(0, "c01_mapa_estado")],
         cam=[(0, COMPLETO), (1, [300, 140, 1500])]),

    dict(id=3, tipo="captura", rotulo=("Ortofoto", "2,6 cm por píxel"),
         texto="La imagen tiene dos coma seis centímetros de detalle: se distinguen los árboles, el potrero y el caño, lote por lote.",
         img=[(0, "c18_orto_detalle")],
         cam=[(0, [520, 160, 1300]), (1, [380, 60, 1500])]),

    dict(id=4, tipo="captura", rot_der=True, rotulo=("Lectura del mapa", "Estado · Cartera · Avance"),
         texto="Con un clic, el mapa cambia de lectura: por estado comercial, por comportamiento de cartera, o por avance de pago. "
               "Los colores muestran de inmediato qué está disponible, qué se vendió y quién está atrasado.",
         img=[(0, "c01_mapa_estado"), (0.36, "c02_mapa_cartera"), (0.68, "c02_mapa_avance")],
         cam=[(0, [0, 60, 1180]), (1, [0, 60, 1180])],
         marcas=[(0.05, [16, 376, 279, 41]), (0.36, [16, 420, 279, 200])],
         cursor=[(0.0, [560, 640], False), (0.30, [155, 396], True), (0.62, [246, 396], True), (0.9, [246, 396], False)]),

    dict(id=5, tipo="captura", rot_der=True, rotulo=("Indicadores", "Siempre actualizados"),
         texto="En el panel lateral están el recaudo total, los lotes vendidos y disponibles, la mora y el recaudo del mes, siempre al día.",
         img=[(0, "c01_mapa_estado")],
         cam=[(0, [0, 40, 760]), (1, [0, 60, 620])],
         marcas=[(0.15, [16, 76, 279, 260])]),

    dict(id=6, tipo="captura", rotulo=("Hoja de vida del lote", "Un toque, toda la información"),
         texto="Al tocar un lote se abre su hoja de vida: área, perímetro, medidas y precio; el comprador; "
               "el valor de venta, la cuota mensual y cuántas cuotas lleva pagadas; el saldo y, si existe, "
               "la mora, con sus intereses estimados.",
         img=[(0, "c04_lote_antes"), (0.16, "c05_tarjeta")],
         cam=[(0, [520, 260, 1200]), (0.16, [520, 260, 1200]), (0.32, [760, 130, 760]), (0.62, [800, 150, 680]), (0.8, [800, 400, 680]), (1, [800, 410, 680])],
         marcas=[(0.82, [946, 674, 340, 52])],
         cursor=[(0.0, [1400, 980], False), (0.13, [1115, 812], True), (0.2, [1115, 812], False)]),

    dict(id=7, tipo="captura", rotulo=("Buscador", "Código · comprador · documento"),
         texto="Cualquier lote se encuentra en segundos: por su código, por el nombre del comprador o por su número de documento.",
         img=[(0, "c12_buscador")],
         cam=[(0, [700, 0, 1220]), (1, [1060, 0, 860])],
         marcas=[(0.1, [1424, 12, 300, 36]), (0.35, [1344, 54, 380, 410])]),

    dict(id=8, tipo="captura", rot_der=True, rotulo=("Venta", "Plan de pagos automático"),
         texto="Vender o separar un lote toma un minuto. Se registran el comprador, el valor, la cuota inicial y el número de cuotas, "
               "y el sistema calcula solo el plan de pagos: el valor de cada cuota y la fecha de la última.",
         img=[(0, "c11_form_venta")],
         cam=[(0, [420, 60, 1080]), (1, [500, 400, 900])],
         marcas=[(0.62, [570, 762, 780, 58])]),

    dict(id=9, tipo="captura", rotulo=("Pagos", "Aplicados en orden"),
         texto="Cada pago se registra desde la ficha del lote. El sistema sugiere el valor vencido y lo aplica en orden: "
               "primero la cuota inicial y después las cuotas más antiguas.",
         img=[(0, "c05_tarjeta"), (0.2, "c06_form_pago")],
         cam=[(0, [760, 140, 760]), (0.2, [480, 240, 960]), (1, [500, 260, 940])],
         cursor=[(0.0, [1250, 960], False), (0.17, [1128, 761], True), (0.24, [1128, 761], False)],
         marcas=[(0.32, [962, 420, 302, 44]), (0.6, [656, 672, 608, 66])]),

    dict(id=10, tipo="documento", rotulo=("Recibo de caja", "Consecutivo y valor en letras"),
         texto="Al guardar, emite el recibo de caja con número consecutivo, el valor en letras y el saldo actualizado, en original y copia.",
         paginas=["doc_recibo_1"]),

    dict(id=11, tipo="captura", rotulo=("Ficha completa", "Plan, recibos y bitácora"),
         texto="La ficha completa muestra el plan de pagos cuota por cuota, los recibos emitidos y una bitácora "
               "con quién hizo cada cambio y cuándo.",
         img=[(0, "c08_ficha"), (0.45, "c09_ficha_plan")],
         cam=[(0, [1000, 40, 920]), (1, [1240, 60, 680])]),

    dict(id=12, tipo="documento", rotulo=("Informe PDF", "Listo para enviar al comprador"),
         texto="Y con un solo botón genera la hoja de vida del lote en PDF, lista para enviar al comprador: "
               "plano de localización, linderos y medidas, condiciones del negocio, estado de cuenta y plan de pagos.",
         paginas=["doc_hoja_1", "doc_hoja_2"]),

    dict(id=13, tipo="captura", rotulo=("Tablero", "El negocio de un vistazo"),
         texto="El tablero resume todo el negocio: lotes vendidos, valor vendido, recaudo, cartera por cobrar, "
               "cartera vencida e inventario disponible, con el recaudo mes a mes y la edad de la mora.",
         img=[(0, "c13_tablero"), (0.62, "c14_tablero_manzanas")],
         cam=[(0, [180, 60, 1560]), (0.6, [180, 140, 1560]), (1, [200, 100, 1500])],
         marcas=[(0.12, [248, 158, 1424, 101])]),

    dict(id=14, tipo="captura", rot_der=True, rotulo=("Gestión de cobro", "Primero, quien más debe"),
         texto="Los lotes que requieren gestión de cobro aparecen solos, ordenados por días de mora, para llamar primero a quien más debe.",
         img=[(0, "c03_panel_gestion")],
         cam=[(0, [0, 120, 900]), (1, [0, 300, 620])],
         marcas=[(0.2, [16, 223, 279, 520])]),

    dict(id=15, tipo="captura", rotulo=("Cartera y pagos", "Exportables a Excel"),
         texto="La cartera y el libro de pagos se filtran, se ordenan y se exportan a Excel para el contador.",
         img=[(0, "c15_cartera_mora"), (0.5, "c16_pagos")],
         cam=[(0, [120, 40, 1680]), (1, [200, 60, 1520])],
         marcas=[(0.18, [1533, 102, 139, 36])]),

    dict(id=16, tipo="captura", rotulo=("Seguridad", "Privado y respaldado"),
         texto="Todo funciona en el equipo de la oficina, sin publicar los datos en internet, y la contabilidad "
               "se respalda automáticamente cada vez que se abre el geovisor.",
         img=[(0, "c17_config")],
         cam=[(0, [300, 40, 1320]), (1, [500, 520, 900])],
         marcas=[(0.5, [788, 861, 168, 36])]),

    dict(id=17, tipo="cierre",
         texto="Geovisor de ventas y cartera. Control total de cada lote, y de cada peso."),
]
