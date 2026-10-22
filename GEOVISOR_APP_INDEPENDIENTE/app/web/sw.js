/* Service worker de la app instalable. No guarda copias de la información: todo se consulta en línea con la sesión,
   así ningún dato del cliente queda almacenado en el celular fuera de la sesión. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
