# Imagen del geovisor: solo lleva el programa (app/). Los datos de cada empresa NO van en la imagen:
# se montan como carpeta (clientes/<id>) al crear su contenedor.
FROM python:3.12-slim

# chromium: genera los PDF (fichas, promesas, recibos) · tzdata: fechas con la hora de Colombia
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core tzdata \
 && rm -rf /var/lib/apt/lists/*

ENV TZ=America/Bogota \
    PYTHONUNBUFFERED=1 \
    GEOVISOR_NAVEGADOR=/usr/bin/chromium \
    GEOVISOR_HOST=0.0.0.0 \
    GEOVISOR_CLIENTE=/cliente \
    PORT=8000

RUN useradd --create-home --uid 1000 geovisor
WORKDIR /app
COPY app/ /app/
USER geovisor
EXPOSE 8000
CMD ["python", "servir.py", "--sin-navegador"]
