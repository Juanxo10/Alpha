# -*- coding: utf-8 -*-
"""Base de demostración para el video: nombres ficticios realistas, sin datos reales."""
import os, random, sqlite3
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo.sqlite")
random.seed(11)
NOM = ["Ana María", "Luis Fernando", "Diana Patricia", "Carlos Andrés", "Paola Andrea", "Jorge Iván", "Sandra Milena",
       "Andrés Felipe", "Juliana", "Óscar Javier", "Marcela", "Héctor Fabio", "Natalia", "Wilson", "Yenny Paola",
       "Edwin Alberto", "Lorena", "Fredy", "Gloria Inés", "Camilo Ernesto", "Liliana", "Mauricio", "Adriana Lucía", "Nelson"]
APE = ["Rodríguez", "Gómez", "Martínez", "López", "Ramírez", "Torres", "Castro", "Rojas", "Herrera", "Díaz", "Moreno",
       "Vargas", "Pardo", "Beltrán", "Parra", "Rincón", "Cárdenas", "Ospina", "Guzmán", "Bermúdez", "Cifuentes", "Baquero",
       "Rey", "Sanabria", "Africano", "Hernández", "Velásquez", "Quintero"]
c = sqlite3.connect(DB)
usados = set()
for (cid,) in c.execute("SELECT id FROM clientes").fetchall():
    while True:
        n = f"{random.choice(NOM)} {random.choice(APE)} {random.choice(APE)}"
        if n not in usados:
            usados.add(n); break
    doc = str(random.randint(17_000_000, 1_125_000_000))
    tel = "3" + random.choice(["10", "11", "12", "13", "14", "15", "20", "21", "22", "23", "50"]) + str(random.randint(1_000_000, 9_999_999))
    mail = n.split()[0].lower().replace("á","a").replace("é","e").replace("í","i").replace("ó","o").replace("ú","u") + "." + n.split()[-2].lower().replace("á","a").replace("é","e").replace("í","i").replace("ó","o").replace("ú","u") + "@gmail.com"
    c.execute("UPDATE clientes SET nombre=?, documento=?, telefono=?, email=? WHERE id=?", (n, doc, tel, mail, cid))
c.execute("UPDATE pagos SET usuario='Laura Gómez'")
c.execute("UPDATE bitacora SET usuario='Laura Gómez'")
asesores = ["Laura Gómez", "Camilo Rey", "Natalia Pardo"]
for (vid,) in c.execute("SELECT id FROM ventas").fetchall():
    c.execute("UPDATE ventas SET vendedor=? WHERE id=?", (random.choice(asesores), vid))
for k, v in {"vendedor_razon_social": "Loteo La Merced", "vendedor_nit": "", "vendedor_direccion": "Villavicencio, Meta",
             "vendedor_telefono": "", "vendedor_email": "", "cuenta_bancaria": "", "tasa_mora_mensual": "2.08",
             "ciudad": "Villavicencio, Meta"}.items():
    c.execute("UPDATE config SET valor=? WHERE clave=?", (v, k))
c.commit()
print(c.execute("SELECT count(*) FROM clientes").fetchone(), [r[0] for r in c.execute("SELECT nombre FROM clientes LIMIT 6")])
