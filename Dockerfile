# Etapa 1: compila la interfaz
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Etapa 2: servidor. Los clientes (cartografía, marca, datos) NO van en la imagen: se montan en /app/clientes
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY servidor.py .
COPY backend backend
COPY --from=web /web/dist frontend/dist
ENV CLIENTES_DIR=/app/clientes PORT=8080
CMD ["python", "servidor.py"]
