# Geovisor de ventas y cartera — Loteo La Merced

Geovisor **privado** para llevar la contabilidad de la venta de los 1.382 lotes: estado comercial de cada lote,
compradores, planes de pago, recibos, cobranza, comisiones, gastos, flujo de caja, documentos y control de seguridad.
Funciona en este equipo (y, si se activa, en la red de la oficina). No se publica en internet.

## Abrir
Doble clic en **`ABRIR_GEOVISOR.bat`**. Se abre el navegador; deje abierta la ventana negra mientras lo usa.

**Primera vez:** aparece *Configuración inicial*. Se crea la cuenta del **dueño** (nombre, correo, usuario y clave).
Con ella se crean después los usuarios de la oficina en *Administración → Usuarios*.
Cada persona entra con su propio usuario; la sesión se cierra sola tras un tiempo sin uso (⚙ → Seguridad).

## Roles
| Rol | Qué puede hacer |
|---|---|
| **Dueño** | Todo. Aprueba o rechaza lo que piden los operadores (en el geovisor o desde Telegram). Crea usuarios y configura. |
| **Operador** | Trabajo diario: separar, vender a precio de lista, registrar pagos, cobranza, prospectos, cotizaciones, expedientes. Lo sensible queda **pendiente de aprobación**. |
| **Solo consulta** | Ve todo (tablero, cartera, informes, auditoría) sin poder modificar. Pensado para el contador o un socio. |

Requieren aprobación de un dueño cuando las hace un operador: cambios de precio, descuentos mayores al permitido,
anulación de recibos, desistimientos, edición de ventas, reestructuraciones, escriturar con saldo, gastos, pagos y
cambios de comisiones, datos bancarios de comisionistas y la configuración.

## Menú
| Menú | Contenido |
|---|---|
| **Mapa** | Lotes coloreados por *Estado*, *Cartera* (mora por edad) o *Avance de pago*, sobre la ortofoto. Tocar un lote abre su tarjeta. |
| **Tablero** | Indicadores de ventas, recaudo, cartera, mora, inventario y comisiones por pagar. *Informe general* en PDF. |
| **Cartera** | *Cartera por lote* · *Libro de pagos* (recibos por consecutivo) · *Cobranza* (a quién cobrar hoy). |
| **Comercial** | *Prospectos* (embudo de interesados) · *Comisionistas*. |
| **Finanzas** | *Gastos* (comprobantes de egreso y presupuesto) · *Flujo de caja* · *Conciliación bancaria*. |
| **Administración** | *Aprobaciones* · *Usuarios* (solo dueño) · *Auditoría*. |
| Iconos arriba a la derecha | Campana de avisos · Ayuda (?) · Mi cuenta · Configuración ⚙. |

## Ficha integral del lote
Al tocar un lote se abre su tarjeta; el botón **Ficha** abre la ficha completa con pestañas:
*Plan de pagos* · *Pagos* · *Cobro* (gestiones y compromisos) · *Documentos* · *Historial*.

Documentos en PDF (quedan además copiados en la carpeta **`INFORMES`**):
- **Ficha integral del lote**: identificación, plano de localización, cuadro de linderos, negocio, estado de cuenta.
- **Estado de cuenta**, **Certificado de pagos**, **Paz y salvo** (solo con saldo $0).
- **Promesa de compraventa** con los datos del negocio y los linderos. *Hágala revisar por su abogado la primera vez*
  y ajuste en ⚙ la notaría, el plazo de escritura y la cláusula penal.
- **Cotización** (lotes disponibles o desde un prospecto) con plan de pagos propuesto.

**Expediente del lote**: se suben la cédula, la promesa firmada, comprobantes y la escritura (hasta 15 MB por
archivo). Cada archivo guarda su huella digital: si alguien lo reemplaza por fuera, el sistema lo detecta.

## Pagos, abonos y reestructuración
- Cada pago genera un **recibo de caja** con consecutivo y valor en letras. Se aplica primero a la cuota inicial y luego
  a las cuotas más antiguas. Un recibo nunca se borra: se **anula** con motivo y conserva su número.
- **Abono a capital**: al registrarlo se elige *acortar el plazo* o *bajar la cuota*; el plan se recalcula.
- **Reestructurar plan** (ficha del lote): nuevo plazo, nueva cuota o plan manual por acuerdo. El plan anterior queda
  en el historial.

## Cobranza
*Cartera → Cobranza* lista cuotas vencidas (con días de mora), separaciones por vencer y cuotas próximas. Por cada
caso: **WhatsApp** con el mensaje ya redactado o **registrar gestión** (llamada,
visita…) con compromiso de pago. Los compromisos incumplidos se marcan en rojo.

## Comercial
- **Prospectos**: tablero por etapas (nuevo, contactado, visita, negociación), seguimientos con fecha, cotizar y
  *Convertir en venta* (el formulario de venta se llena con sus datos).
- **Comisionistas**: % base y regla de causación (proporcional al recaudo, al pagarse la inicial o al firmar). Se paga
  solo lo causado, con **comprobante de egreso (CE)** y retención. Informe PDF por comisionista.

## Finanzas
- **Gastos**: todo egreso con comprobante CE (mismo consecutivo que los pagos de comisión), categoría, proveedor y
  retención. **Presupuesto** por categoría para comparar lo ejecutado.
- **Flujo de caja**: ingresos y egresos por mes, recaudo proyectado según los planes de pago y **resultado proyectado**
  del proyecto (recaudado + por recaudar + inventario − egresos − presupuesto pendiente − comisiones por pagar).
- **Conciliación bancaria**: se carga el extracto del banco en CSV, se indican las columnas y el sistema cruza cada
  movimiento con recibos y egresos (por valor y fecha ±6 días). Señala lo que está en el banco sin registro y lo
  registrado que no aparece en el banco.

## Seguridad y alertas
- **Auditoría**: cada operación con su autor, fecha y detalle. La bitácora va **sellada en cadena**: si alguien altera
  la base por fuera del geovisor, *Verificar integridad* lo detecta (también se revisa sola cada día).
- **Alertas externas (Telegram y correo): DESACTIVADAS temporalmente.** Los avisos y las solicitudes de aprobación
  llegan solo a la campana del geovisor. Para reactivarlas (lo hace quien mantiene el programa): poner `ACTIVAS = True`
  en `nucleo\alertas.py` y `ALERTAS_ACTIVAS = true` en `geovisor\js\seguridad.js`, y reiniciar. Vuelven a aparecer
  la configuración de Telegram/correo, los recordatorios automáticos, el resumen diario y el envío de estados de cuenta
  por correo.

## Acceso desde otros equipos
⚙ → Respaldos y red → activar *acceso en red* y reiniciar el geovisor. La ventana negra muestra la dirección
(`http://192.168.x.x:8100`) para abrirla desde otro PC o el celular conectado a la misma wifi. Todos entran con su
usuario y clave.

## Datos y respaldos
- `datos\contabilidad.sqlite`: **toda la contabilidad**. Es el archivo que hay que proteger.
- `datos\respaldos\`: copia automática cada vez que se abre el geovisor (y antes de cualquier actualización) y botón
  *Hacer respaldo ahora* en ⚙. Configure además una **carpeta externa** (Google Drive, OneDrive o USB) en ⚙: la base
  se copia allí una vez al día.
- `datos\expedientes\`: archivos subidos a los expedientes de los lotes.
- `INFORMES\`: copia de cada PDF generado.
- Para restaurar un respaldo: cerrar el geovisor y reemplazar `datos\contabilidad.sqlite` por la copia elegida.
- Exportación a Excel (CSV) desde cada vista: cartera, pagos, cobranza, prospectos, comisiones, gastos, flujo y auditoría.

## Ortofoto
Arrastre el archivo de la ortofoto (GeoTIFF/GPKG con sistema de coordenadas) sobre **`AGREGAR_ORTOFOTO.bat`**.
Al terminar, recargue el geovisor (F5).

## Cartografía e identificación de los lotes
`MZ05-L012` = manzana 5, lote 12. Los números son los del plano; los lotes sin número en el plano se numeraron en
orden (campo `origen_num` en `LOTEO_MERCED.gpkg`). Si se corrige la cartografía en QGIS, correr
`scripts\01_exportar_web.py`.

## Estructura del programa
`servir.py` (servidor local) usa los módulos de `nucleo\`: `base` (esquema, respaldos, bitácora sellada), `cartera`,
`comisiones`, `seguridad` (usuarios, aprobaciones, integridad), `alertas` (Telegram, correo, tareas programadas),
`finanzas`, `cobranza`, `documentos`, `prospectos` y `exportar`. La interfaz está en `geovisor\` (`index.html`, `js\`,
`css\`). Para pruebas sin tocar la base real: `servir.py 8160 --db copia_de_prueba.sqlite`.

## Registro de la escritura (estado «Registrado»)

Orden de estados: Disponible → Separado → Vendido con saldo → Pagado → Escriturado → **Registrado**.
«Registrado» = la escritura quedó inscrita en la ORIP y el lote tiene su matrícula inmobiliaria.

- Datos: `nucleo/registro.py` (tabla `registros`, se crea sola al iniciar). La etapa de la venta pasa a `REGISTRADO`.
- Pantalla: `geovisor/js/registro.js` (botón «Registrar» en la ficha cuando está Escriturado, bloque «Registro»,
  «Editar registro», «Anular registro» solo para el dueño, y apartado «Escritura y registro» en la ficha integral PDF).
- Rutas: `/api/registro/registrar`, `/editar` y `/anular` (el operador que anula queda pendiente de aprobación).
- Núcleo tocado (cambios mínimos): `cartera.py` (suma REGISTRADO a vendidos, añade el registro al detalle del lote),
  `seguridad.py` (permisos y texto de la solicitud), `base.py` (crea la tabla), `servir.py` (módulo), `app.js` (ESTADOS,
  sumas de vendidos), `informe.js`/`app.css` (chip), `index.html` (script y filtro).
- Prueba: `PRUEBA_INTEGRAL_GEOVISOR/verificacion_registro.py` (usa una base temporal nueva).
