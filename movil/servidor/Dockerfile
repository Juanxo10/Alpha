FROM python:3.12-slim
WORKDIR /app
COPY requirements-servidor.txt .
RUN pip install --no-cache-dir -r requirements-servidor.txt
COPY servidor.py .
COPY backend backend
# marca y cartografía van en la imagen; "datos" (supabase.json y expedientes) es el volumen montado en /app/clientes/merced/datos
COPY clientes clientes
ENV CLIENTE_DIR=/app/clientes/merced
CMD ["python", "servidor.py"]
