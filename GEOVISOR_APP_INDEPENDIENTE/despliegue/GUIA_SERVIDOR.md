# Montar el geovisor en un servidor en la nube

Lo que se necesita (lo compra y lo paga usted, a su nombre):
1. **Un dominio** (ej. `sudominio.com`), unos $50.000 al año. Cada empresa tendrá su subdominio: `merced.sudominio.com`.
2. **Un servidor virtual (VPS) con Ubuntu 24.04**, 2 GB de RAM y 40 GB de disco o más (unos US$6 a US$12 al mes en
   proveedores como Hetzner, DigitalOcean o Vultr). Alcanza para varias empresas al comienzo.

## Pasos (una sola vez)
1. En el panel del dominio cree un registro **A** con nombre `*` (comodín) que apunte a la IP del servidor.
2. Entre al servidor e instale Docker:
   `curl -fsSL https://get.docker.com | sh`
3. Copie al servidor la carpeta del producto **solo con** `app/`, `despliegue/`, `.dockerignore` y la carpeta del
   cliente (`clientes/merced/`). Nunca suba `herramientas/` ni otros clientes que no vayan allí.
4. Dé permiso al programa sobre los datos de los clientes: `sudo chown -R 1000:1000 clientes`
5. En `despliegue/` copie `.env.ejemplo` como `.env` y escriba su dominio.
6. Arranque: `cd despliegue && docker compose up -d --build`
7. Abra `https://merced.sudominio.com`. El candado (HTTPS) se obtiene solo en un minuto.

## Agregar otra empresa
1. Súbala a `clientes/<id>/` y repita el paso 4.
2. En `docker-compose.yml` copie el bloque `merced` con el nuevo nombre y su carpeta.
3. En `Caddyfile` copie el bloque `merced.{$DOMINIO}` con el nuevo nombre.
4. `docker compose up -d`

## Respaldos
- El programa respalda la base de cada empresa todos los días dentro de `clientes/<id>/datos/respaldos`.
- Además active los **respaldos automáticos del proveedor** del servidor (snapshots), y copie periódicamente
  esas carpetas fuera del servidor.

## Instalar la app en el celular
- **iPhone**: abrir la dirección en **Safari** → botón Compartir → **Agregar a pantalla de inicio**.
- **Android**: abrir en **Chrome** → menú ⋮ → **Instalar aplicación**.
- **Computador**: Chrome o Edge muestran un ícono de instalar en la barra de direcciones (o se usa como página web).
