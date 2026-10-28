"""Alta de un cliente nuevo: crea clientes/<id>/ con su ficha y la conexión a la base compartida.
Uso: python crear_cliente.py <id> "<Empresa>" --lotes lotes.geojson [--clientes clientes] [--pg pg_compartida.json]
Al reiniciar el servidor, iniciar_todos() crea su schema y sus tablas. Las capas y la ortofoto se copian después a cartografia/."""
import argparse
import json
import os
import re
import shutil

p = argparse.ArgumentParser()
p.add_argument("id")
p.add_argument("empresa")
p.add_argument("--lotes", required=True, help="lotes.geojson del cliente (obligatorio: de ahí salen los lotes)")
p.add_argument("--clientes", default="clientes")
p.add_argument("--pg", default="pg_compartida.json", help="host, port, dbname, user, password de la base compartida")
a = p.parse_args()

if not re.fullmatch(r"[a-z][a-z0-9_]{1,40}", a.id):
    raise SystemExit("El id va en minúsculas, números y _ (empieza con letra).")
destino = os.path.join(a.clientes, a.id)
if os.path.exists(destino):
    raise SystemExit(f"Ya existe {destino}.")
for d in ("datos", "marca", "cartografia"):
    os.makedirs(os.path.join(destino, d))
with open(os.path.join(destino, "cliente.json"), "w", encoding="utf-8") as f:
    json.dump({"id": a.id, "empresa": a.empresa, "proyecto": a.empresa, "schema": True}, f, ensure_ascii=False, indent=2)
shutil.copy(a.pg, os.path.join(destino, "datos", "supabase.json"))
shutil.copy(a.lotes, os.path.join(destino, "cartografia", "lotes.geojson"))
print(f"Cliente {a.id} creado en {destino}. Faltan: marca/ (logo e iconos), manzanas.geojson, limite.geojson y orto/. Reinicie el servidor.")
