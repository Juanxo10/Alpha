# Geovisor de ventas y cartera — producto para empresas

Aplicación web para que cada empresa loteadora controle sus ventas, cartera, cobranza, comisiones, gastos y
documentos desde el **celular** (se instala como app) y desde el **computador**. Cada empresa ve **su** nombre,
**su** logo, **sus** colores, **su** plano y **su** ortofoto. La interfaz y las funciones son las mismas para todas.

> Esta carpeta es **privada**: es el producto completo. Nunca se entrega a los clientes ni se sube a sitios públicos.
> A los clientes solo se les da la dirección de su app (por ejemplo `https://merced.sudominio.com`) y su usuario.

## Cómo está organizado

| Carpeta | Qué contiene | ¿Va al servidor? |
|---|---|---|
| `app\` | El programa común a todas las empresas: `servir.py` (servidor), `nucleo\` (contabilidad, seguridad, documentos…), `web\` (pantallas) | Sí (dentro de la imagen) |
| `clientes\<empresa>\` | Todo lo de una empresa: `cliente.json` (nombre, colores, ciudad), `marca\` (logo e iconos), `cartografia\` (plano y ortofoto), `datos\` (base contable, expedientes, respaldos, PDF) | Sí, solo la de esa empresa |
| `herramientas\` | Para preparar clientes: `nuevo_cliente.py`, `exportar_cartografia.py`, `agregar_ortofoto.py`, `marca.py` | No |
| `despliegue\` | Archivos para el servidor en la nube (Docker + Caddy con HTTPS) | Sí |
| `PROBAR_CLIENTE.bat` | Abre el geovisor de una empresa en este PC para revisarlo | No |
| `NUEVO_CLIENTE.bat` | Crea una empresa nueva | No |

## Seguridad del producto
- **Sin iniciar sesión no se entrega nada** salvo la pantalla de ingreso: ni el código, ni el plano, ni la ortofoto, ni
  los datos (responden «no autorizado»). No se pueden listar carpetas ni salirse de ellas.
- Cada empresa corre en su **propio contenedor** con su propia base: una empresa jamás ve datos de otra.
- La imagen del servidor lleva **solo el programa**; los datos de cada empresa van aparte (`.dockerignore`).
- La **primera cuenta (dueño)** de una empresa nueva solo se puede crear con el **código de instalación** que imprime
  `NUEVO_CLIENTE.bat`. Así nadie que encuentre la dirección puede adueñarse de una instalación vacía.
- Conexión cifrada (HTTPS automático), cookie de sesión protegida, cierre por inactividad, roles, aprobaciones,
  bitácora sellada.
- La app instalada **no guarda datos en el celular**: todo se consulta en línea con la sesión.

## Crear una empresa nueva (paso a paso)
1. Prepare el **GeoPackage** del loteo en coordenadas planas (metros) con las capas:
   `LOTES` (id_lote tipo `MZ01-L001`, manzana, lote, area_m2, frente_m, fondo_m), `MANZANAS` (id_manzana `MZ01`),
   `LIMITE_LOTEO` (el predio completo) y, si existen, `VIAS`, `ZONAS_VERDES` (campo tipo) y `HIDROGRAFIA`.
2. Tenga a mano la **ortofoto** (GeoTIFF/GPKG georreferenciado) y el **logo** de la empresa (PNG; ideal uno para
   fondo oscuro y otro para fondo blanco) y sus **dos colores** de marca.
3. Ejecute (todo en una línea):
   `NUEVO_CLIENTE.bat --id sauces --empresa "Inversiones Los Sauces" --proyecto "Los Sauces" --ciudad "Acacías, Meta" --gpkg "D:\sauces\LOTEO.gpkg" --ortofoto "D:\sauces\orto.tif" --logo "D:\sauces\logo_blanco.png" --logo-documentos "D:\sauces\logo_color.png" --primario "#1F3A5F" --acento "#F2B441"`
4. Revíselo en este PC: `PROBAR_CLIENTE.bat sauces`.
5. Súbalo al servidor (ver `despliegue\GUIA_SERVIDOR.md`) y entréguele al dueño la dirección y el **código de
   instalación**.

Para cambiar después el logo o los colores: edite `clientes\<id>\cliente.json` y corra
`python herramientas\marca.py --cliente clientes\<id> --logo ...`.
Capas propias de un cliente (por ejemplo, redes o servidumbres): agréguelas en `cliente.json → capas_extra`
(`{"archivo": "redes.geojson", "capa_gpkg": "REDES", "nombre": "Redes eléctricas", "tipo": "linea", "color": "#E11D48"}`)
y vuelva a correr `exportar_cartografia.py`. Aparecen con su interruptor en el panel del mapa.

## Primer cliente: La Merced
- Carpeta `clientes\merced`. Su base contable es una **copia del 21/10/2026 11:04**: el día de pasar a la nube se
  vuelve a copiar la base viva (`LOTEO_MERCED\GEOVISOR\datos\contabilidad.sqlite`) para no perder lo registrado.
- Colores **provisionales** (verde) e iconos con la inicial «M» hasta recibir el logo y la paleta de la empresa.
- Faltan en ⚙ los datos legales del vendedor (razón social, NIT, representante) para recibos y contratos.
