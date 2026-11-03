/* ==========================================================================
   Arranque (único archivo de la app que se entrega sin sesión).
   Muestra la pantalla de ingreso con la marca de la empresa y, una vez iniciada la sesión, carga el geovisor:
   el servidor solo entrega el resto del código, la cartografía y la ortofoto a una sesión válida.
   ========================================================================== */
"use strict";

const ARRANQUE = { token: "", sesion: null, estado: null };
const MODULOS_APP = ["letras", "app", "informe", "comisiones", "seguridad", "finanzas", "cobranza", "documentos", "prospectos", "ayuda"];

const _esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const _guardado = () => { try { return sessionStorage.getItem("gv_token") || ""; } catch { return ""; } };

function cargarScript(src) {
  return new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => mal(new Error("No se pudo cargar el geovisor. Revise la conexión e ingrese de nuevo."));
    document.body.appendChild(s);
  });
}

function aplicarMarca(m) {
  if (!m) return;
  document.title = `${m.empresa} · Ventas y cartera`;
  const logo = document.getElementById("logoMarca");
  if (m.logo && logo) { logo.src = "marca/logo_claro.png"; logo.classList.remove("logo-ico"); }
}

// ------------------------------------------------------------------ pantalla de ingreso
function pantallaIngreso(estado) {
  return new Promise((listo) => {
    const nuevo = !estado.configurado, m = estado.marca || {};
    const capa = document.createElement("div");
    capa.className = "ingreso";
    capa.innerHTML = `<div class="ing-caja">
        <div class="ing-cab">${m.logo ? `<img src="marca/logo_claro.png" alt="">` : `<img src="marca/icono-192.png" alt="" class="ing-ico">`}
          <div><b>${_esc(m.empresa || estado.proyecto || "Ventas y cartera")}</b><span>Ventas y cartera</span></div></div>
        <form id="fIngreso" autocomplete="on">
          <h2>${nuevo ? "Configuración inicial" : "Ingresar"}</h2>
          <p>${nuevo ? "Cree la cuenta del <b>propietario</b> (dueño). Con ella podrá crear después los usuarios de la oficina y aprobar las operaciones sensibles."
                    : "Ingrese con su usuario y clave. Cada operación queda registrada a su nombre."}</p>
          ${nuevo && m.pide_codigo ? `<label class="campo"><span>Código de instalación</span><input name="codigo" required autocomplete="off"></label>` : ""}
          ${nuevo ? `<label class="campo"><span>Nombre completo</span><input name="nombre" required></label>
                     <label class="campo"><span>Correo</span><input name="email" type="email"></label>` : ""}
          <label class="campo"><span>Usuario</span><input name="usuario" required autocomplete="username" autocapitalize="off"></label>
          <label class="campo"><span>Clave</span><input name="clave" type="password" required autocomplete="${nuevo ? "new-password" : "current-password"}" minlength="6"></label>
          ${nuevo ? `<label class="campo"><span>Repita la clave</span><input name="clave2" type="password" required minlength="6"></label>` : ""}
          <div class="ing-error" id="ingError"></div>
          <button class="btn pri" type="submit" style="width:100%;justify-content:center;height:44px">${nuevo ? "Crear cuenta e ingresar" : "Ingresar"}</button>
        </form>
        <div class="ing-pie"><i data-lucide="shield-check"></i>Conexión privada y cifrada · la sesión se cierra sola por inactividad</div>
      </div>`;
    document.body.appendChild(capa);
    if (window.lucide) lucide.createIcons();
    if (matchMedia("(pointer: fine)").matches) capa.querySelector("input").focus();
    capa.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const err = capa.querySelector("#ingError");
      if (nuevo && d.clave !== d.clave2) { err.textContent = "Las claves no coinciden."; return; }
      const btn = capa.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        const r = await fetch(nuevo ? "/api/sesion/configurar" : "/api/sesion/entrar", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }).then((x) => x.json());
        if (r.error) throw new Error(r.error);
        ARRANQUE.token = r.token;
        ARRANQUE.sesion = { usuario_id: r.usuario.id, nombre: r.usuario.nombre, usuario: r.usuario.usuario, rol: r.usuario.rol };
        try { sessionStorage.setItem("gv_token", r.token); } catch { /* sin almacenamiento */ }
        capa.remove();
        listo();
      } catch (x) {
        err.textContent = x.message;
        btn.disabled = false;
      }
    });
  });
}

// ------------------------------------------------------------------ inicio
async function arrancar() {
  const q = new URLSearchParams(location.search);
  ARRANQUE.token = q.get("t") || _guardado();
  const est = await fetch("/api/sesion/estado", { headers: { "X-Sesion": ARRANQUE.token } }).then((r) => r.json());
  ARRANQUE.estado = est;
  aplicarMarca(est.marca);
  if (est.sesion) ARRANQUE.sesion = est.sesion;
  else if (q.get("t")) throw new Error("El enlace del documento venció.");
  else await pantallaIngreso(est);
  for (const m of MODULOS_APP) await cargarScript(`js/${m}.js`);
  await iniciar();
}

if ("serviceWorker" in navigator && !new URLSearchParams(location.search).has("t")) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
arrancar().catch((e) => {
  console.error(e);
  const d = document.createElement("div");
  d.className = "ingreso";
  d.innerHTML = `<div class="ing-caja"><form><h2>No se pudo abrir</h2><p>${_esc(e.message)}</p>
    <button class="btn pri" type="button" onclick="location.reload()" style="justify-content:center;height:44px">Intentar de nuevo</button></form></div>`;
  document.body.appendChild(d);
});
