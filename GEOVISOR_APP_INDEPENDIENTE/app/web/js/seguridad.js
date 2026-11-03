/* ==========================================================================
   Seguridad: ingreso, sesión, avisos, aprobaciones, usuarios, auditoría y centro de configuración.
   ========================================================================== */
"use strict";

// Alertas externas (Telegram y correo) ocultas temporalmente. Para reactivarlas: true aquí y ACTIVAS = True en nucleo/alertas.py.
const ALERTAS_ACTIVAS = false;

const ROLES = { DUENO: "Dueño", OPERADOR: "Operador", CONSULTA: "Solo consulta" };
const esDueno = () => E.sesion?.rol === "DUENO";

function sesionVencida() {
  if (E.vencida) return;
  E.vencida = true;
  try { sessionStorage.removeItem("gv_token"); } catch { /* */ }
  modal("Sesión cerrada", `<p class="texto-modal">Por seguridad la sesión se cerró (inactividad o ingreso desde otro lugar). Ingrese de nuevo para continuar.</p>`,
    { extraPie: `<button type="button" class="btn pri" onclick="location.reload()">Ingresar de nuevo</button>` });
}

async function salir() {
  try { await api("/api/sesion/salir", {}); } catch { /* */ }
  try { sessionStorage.removeItem("gv_token"); } catch { /* */ }
  location.reload();
}

// ------------------------------------------------------------------ interfaz según el rol
function aplicarSesionUI() {
  $("#tUsuario").textContent = E.sesion.nombre;
  $("#tRol").textContent = ROLES[E.sesion.rol];
  document.body.dataset.rol = E.sesion.rol;
  $$("[data-solo]").forEach((el) => { el.hidden = !el.dataset.solo.split(",").includes(E.sesion.rol); });
  revisarAvisos();
  setInterval(revisarAvisos, 45000);
}

function mostrarPendiente(j) {
  modal("Enviado a aprobación", `<div style="text-align:center;padding:8px 0">
      <div style="width:56px;height:56px;border-radius:50%;background:#FEF3C7;color:#B45309;display:grid;place-items:center;margin:0 auto 12px"><i data-lucide="shield-alert" style="width:28px;height:28px"></i></div>
      <div style="font-family:var(--f-tit);font-size:17px;font-weight:600;color:var(--teal)">Solicitud N° ${j.solicitud}</div>
      <p class="texto-modal" style="margin-top:8px">${esc(j.mensaje)}<br>Los dueños ya recibieron el aviso. Cuando la aprueben, la operación se aplica sola y usted verá el resultado en <b>Administración → Aprobaciones</b>.</p></div>`);
  $("[data-cerrar2]").textContent = "Entendido";
  revisarAvisos();
}

// ------------------------------------------------------------------ avisos (campana)
async function revisarAvisos() {
  try {
    const n = await api("/api/notificaciones");
    E.avisos = n;
    const total = n.no_leidas + (esDueno() ? n.aprobaciones : 0);
    $("#nAvisos").textContent = total > 99 ? "99+" : total || "";
    $("#nAprob").textContent = esDueno() ? (n.aprobaciones || "") : (n.mis_pendientes || "");
  } catch { /* sin conexión: se reintenta */ }
}

async function abrirAvisos() {
  await revisarAvisos();
  const n = E.avisos || { avisos: [] };
  modal("Avisos", `${esDueno() && n.aprobaciones ? `<div class="alerta-caja aviso" style="margin:0 0 12px;cursor:pointer" id="irAprob"><i data-lucide="shield-alert"></i>
      <div><b>${n.aprobaciones} solicitud(es) esperando su aprobación.</b> Clic para revisarlas.</div></div>` : ""}
    ${n.avisos.length ? n.avisos.map((a) => `<div class="av-item ${a.estado === "NO_LEIDA" ? "nuevo" : ""}">
        <div class="av-tit">${esc(a.asunto)}<small>${fecha(a.creado)} ${a.creado.slice(11, 16)}</small></div>
        <div class="av-txt">${limpiarHtml(a.texto)}</div></div>`).join("") : `<div class="vacio"><i data-lucide="bell-off"></i>No hay avisos.</div>`}`, {});
  $("[data-cerrar2]").textContent = "Cerrar";
  $("#irAprob")?.addEventListener("click", () => { cerrarModal(); cambiarVista("aprobaciones"); });
  if (n.no_leidas) { await api("/api/notificaciones/leer", {}).catch(() => {}); revisarAvisos(); }
}
// los avisos del servidor traen <b> y saltos de línea; todo lo demás se escapa
const limpiarHtml = (t) => esc(t).replace(/&lt;(\/?)b&gt;/g, "<$1b>").replace(/\n/g, "<br>");

// ------------------------------------------------------------------ mi cuenta
async function abrirCuenta() {
  const u = await api("/api/cuenta");
  modal("Mi cuenta", `<dl class="dl" style="margin-bottom:14px"><dt>Nombre</dt><dd>${esc(u.nombre)}</dd><dt>Usuario</dt><dd>${esc(u.usuario)}</dd>
      <dt>Rol</dt><dd>${ROLES[u.rol]}</dd><dt>Correo</dt><dd>${esc(u.email || "—")}</dd>
      ${ALERTAS_ACTIVAS ? `<dt>Telegram</dt><dd>${u.telegram_vinculado ? "✅ Vinculado" : "No vinculado"}</dd>` : ""}</dl>
    <div class="form-grid">
      <div class="form-sec">Cambiar mi clave</div>
      ${campo("", "Clave actual", `<input type="password" name="actual" autocomplete="current-password">`)}
      ${campo("", "Clave nueva (mínimo 6)", `<input type="password" name="nueva" autocomplete="new-password">`)}
      ${ALERTAS_ACTIVAS ? `<div class="form-sec">Alertas en el celular (Telegram)</div>
      <div class="c2 ley-ayuda" style="padding:0" id="vincTxt">${E.config.telegram_configurado
        ? `Abra el bot del proyecto en Telegram y envíele el código de vinculación. ${u.telegram_vinculado ? "Si cambia de celular, genere un código nuevo." : ""}`
        : "Un dueño debe configurar primero el bot de Telegram en Configuración → Alertas."}</div>
      ${E.config.telegram_configurado ? `<div class="c2"><button type="button" class="btn sec" id="btnVinc"><i data-lucide="send"></i>Generar código de vinculación</button></div>` : ""}` : ""}
    </div>`, {
    boton: "Guardar clave",
    extraPie: `<button type="button" class="btn peligro" id="btnSalir2"><i data-lucide="log-out"></i>Cerrar sesión</button>`,
    enviar: async (x) => {
      if (!x.actual || !x.nueva) throw new Error("Escriba la clave actual y la nueva.");
      await api("/api/sesion/clave", { actual: x.actual, nueva: x.nueva });
      cerrarModal();
      aviso("Clave actualizada");
    },
  });
  $("#btnSalir2").addEventListener("click", salir);
  $("#btnVinc")?.addEventListener("click", async () => {
    const r = await api("/api/sesion/vincular", {});
    $("#vincTxt").innerHTML = `Envíe este código al bot del proyecto en Telegram: <b style="font-size:20px;letter-spacing:2px;font-family:var(--f-tit)">${r.codigo}</b>`;
  });
}

// ================================================================== APROBACIONES
async function pintarAprobaciones() {
  const ls = await api("/api/solicitudes");
  const pend = ls.filter((s) => s.estado === "PENDIENTE");
  const est = { PENDIENTE: ["Pendiente", "SEPARADO"], APROBADA: ["Aprobada", "AL_DIA"], RECHAZADA: ["Rechazada", "MORA_MAS_90"],
    FALLIDA: ["No se pudo aplicar", "MORA_90"], CANCELADA: ["Cancelada", "BLOQUEADO"], VENCIDA: ["Vencida", "BLOQUEADO"] };
  $("#pagAprob").innerHTML = `<div class="pagina-cab"><div><h1>Aprobaciones</h1>
      <p>${esDueno() ? "Operaciones sensibles que los operadores pidieron hacer. Nada se aplica hasta que un dueño lo apruebe."
        : "Sus solicitudes enviadas a los dueños y su resultado."}</p></div></div>
    ${pend.length ? `<div class="aprob-lista">${pend.map((s) => `<div class="aprob">
        <div class="ap-cab"><span class="ap-n">N° ${s.id}</span><span class="chip SEPARADO">Pendiente</span><small>${fecha(s.creado)} ${s.creado.slice(11, 16)} · ${esc(s.solicitante)}</small></div>
        <div class="ap-txt">${esc(s.resumen)}</div>
        <div class="ap-acc">${esDueno() ? `<button class="btn acento peq" data-ap="${s.id}"><i data-lucide="check"></i>Aprobar</button>
          <button class="btn peligro peq" data-re="${s.id}"><i data-lucide="x"></i>Rechazar</button>` : ""}
          <button class="btn sec peq" data-ca="${s.id}">Cancelar solicitud</button>
          ${s.id_lote ? `<button class="link" data-lote="${s.id_lote}">Ver lote ${s.id_lote}</button>` : ""}</div></div>`).join("")}</div>`
      : `<div class="tarjeta" style="margin-bottom:16px"><div class="vacio"><i data-lucide="badge-check"></i>No hay solicitudes pendientes.</div></div>`}
    <div class="tarjeta"><h3>Historial</h3><div class="tabla-wrap"><table class="datos"><thead><tr><th>N°</th><th>Fecha</th><th>Solicitó</th><th>Operación</th><th>Estado</th><th>Resolvió</th><th>Detalle</th></tr></thead><tbody>
      ${ls.filter((s) => s.estado !== "PENDIENTE").map((s) => `<tr><td>${s.id}</td><td>${fecha(s.creado)}</td><td>${esc(s.solicitante)}</td>
        <td style="white-space:normal;min-width:320px">${esc(s.resumen)}</td><td><span class="chip ${est[s.estado][1]}">${est[s.estado][0]}</span></td>
        <td>${esc(s.resuelto_por || "")}<br><small>${s.resuelto_en ? fecha(s.resuelto_en) : ""}</small></td>
        <td style="white-space:normal;max-width:260px">${esc(s.motivo_rechazo || (s.estado === "FALLIDA" ? s.resultado : "") || "")}</td></tr>`).join("") || `<tr><td colspan="7" class="vacio">Sin historial.</td></tr>`}
    </tbody></table></div></div>`;
  iconos();
  $$("#pagAprob [data-ap]").forEach((b) => b.addEventListener("click", () => resolverSolicitud(+b.dataset.ap, true)));
  $$("#pagAprob [data-re]").forEach((b) => b.addEventListener("click", () => resolverSolicitud(+b.dataset.re, false)));
  $$("#pagAprob [data-ca]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("/api/solicitud/cancelar", { id: +b.dataset.ca }); aviso("Solicitud cancelada"); pintarAprobaciones(); revisarAvisos(); } catch (e) { falla(e); }
  }));
  $$("#pagAprob [data-lote]").forEach((b) => b.addEventListener("click", () => irALote(b.dataset.lote)));
}

function resolverSolicitud(id, aprobar) {
  modal(aprobar ? `Aprobar solicitud N° ${id}` : `Rechazar solicitud N° ${id}`,
    `<p class="texto-modal">${aprobar ? "La operación se ejecutará de inmediato a nombre del solicitante, dejando constancia de que usted la aprobó."
      : "La operación no se aplicará. El solicitante verá el motivo."}</p>
     ${aprobar ? "" : `<div class="form-grid">${campo("", "Motivo del rechazo", `<input type="text" name="motivo" required>`, { req: true, cls: "c2" })}</div>`}`, {
    boton: aprobar ? "Aprobar y aplicar" : "Rechazar", peligro: !aprobar,
    enviar: async (x) => {
      const r = await api("/api/solicitud/resolver", { id, aprobar, motivo: x.motivo });
      cerrarModal();
      if (r.estado === "FALLIDA") aviso("No se pudo aplicar: " + r.resultado, true);
      else aviso(aprobar ? "Solicitud aprobada y aplicada" : "Solicitud rechazada");
      await recargar();
      pintarAprobaciones();
      revisarAvisos();
    },
  });
}

// ================================================================== USUARIOS
async function pintarUsuarios() {
  const us = await api("/api/usuarios");
  $("#pagUsuarios").innerHTML = `<div class="pagina-cab"><div><h1>Usuarios</h1>
      <p>Quién puede entrar al geovisor y qué puede hacer.</p></div>
      <div class="botones"><button class="btn pri" id="btnNuevoUs"><i data-lucide="user-plus"></i>Nuevo usuario</button></div></div>
    <div class="roles-ayuda">
      <div><b>Dueño</b><span>Todo, incluidas las aprobaciones, los usuarios, la configuración y la auditoría.</span></div>
      <div><b>Operador</b><span>Separa, vende a precio de lista, registra pagos, cobranza, prospectos y documentos. Lo sensible (precios, descuentos, anulaciones, desistimientos, gastos, pagos de comisión) queda <b>pendiente de aprobación</b>.</span></div>
      <div><b>Solo consulta</b><span>Ve toda la información y la auditoría, pero no registra nada. Ideal para el contador o el revisor fiscal.</span></div></div>
    <div class="tabla-wrap grande"><table class="datos"><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Correo</th>${ALERTAS_ACTIVAS ? "<th>Telegram</th>" : ""}<th>Último ingreso</th><th>Estado</th><th></th></tr></thead><tbody>
      ${us.map((u) => `<tr><td><b>${esc(u.nombre)}</b></td><td>${esc(u.usuario)}</td><td>${ROLES[u.rol]}</td><td>${esc(u.email || "")}</td>
        ${ALERTAS_ACTIVAS ? `<td>${u.telegram_vinculado ? "✅" : "—"}</td>` : ""}<td>${u.ultimo_acceso ? fecha(u.ultimo_acceso) + " " + u.ultimo_acceso.slice(11, 16) : "—"}</td>
        <td><span class="chip ${u.activo ? "DISPONIBLE" : "BLOQUEADO"}">${u.activo ? "Activo" : "Inactivo"}</span></td>
        <td style="white-space:nowrap"><button class="link" data-ed="${u.id}">Editar</button> · <button class="link" data-cl="${u.id}">Clave</button> ·
          <button class="link ${u.activo ? "rojo" : ""}" data-es="${u.id}" data-ac="${u.activo ? 0 : 1}">${u.activo ? "Desactivar" : "Activar"}</button></td></tr>`).join("")}
    </tbody></table></div>`;
  iconos();
  $("#btnNuevoUs").addEventListener("click", () => formUsuario());
  $$("#pagUsuarios [data-ed]").forEach((b) => b.addEventListener("click", () => formUsuario(us.find((u) => u.id === +b.dataset.ed))));
  $$("#pagUsuarios [data-cl]").forEach((b) => b.addEventListener("click", () => formClaveUsuario(us.find((u) => u.id === +b.dataset.cl))));
  $$("#pagUsuarios [data-es]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("/api/usuarios/estado", { id: +b.dataset.es, activo: b.dataset.ac === "1" }); pintarUsuarios(); } catch (e) { falla(e); }
  }));
}

function formUsuario(u = {}) {
  modal(u.id ? `Editar usuario · ${u.nombre}` : "Nuevo usuario", `<div class="form-grid">
      ${campo("", "Nombre completo", `<input name="nombre" required value="${esc(u.nombre || "")}">`, { req: true, cls: "c2" })}
      ${campo("", "Usuario (para ingresar)", `<input name="usuario" required value="${esc(u.usuario || "")}" autocapitalize="off">`, { req: true })}
      ${campo("", "Rol", `<select name="rol">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === (u.rol || "OPERADOR") ? "selected" : ""}>${v}</option>`).join("")}</select>`)}
      ${campo("", "Correo", `<input name="email" type="email" value="${esc(u.email || "")}">`)}
      ${campo("", "Teléfono", `<input name="telefono" value="${esc(u.telefono || "")}">`)}
      ${u.id ? "" : campo("", "Clave inicial (mínimo 6)", `<input name="clave" type="password" required minlength="6" autocomplete="new-password">`, { req: true, cls: "c2", ayuda: "Entréguesela a la persona; podrá cambiarla en Mi cuenta." })}
    </div>`, {
    boton: u.id ? "Guardar" : "Crear usuario",
    enviar: async (x) => { await api("/api/usuarios/guardar", { ...x, id: u.id }); cerrarModal(); aviso("Usuario guardado"); pintarUsuarios(); },
  });
}

function formClaveUsuario(u) {
  modal(`Nueva clave · ${u.nombre}`, `<p class="texto-modal">Asigna una clave nueva y cierra las sesiones abiertas de ese usuario.</p>
    <div class="form-grid">${campo("", "Clave nueva (mínimo 6)", `<input name="clave" type="password" required minlength="6" autocomplete="new-password">`, { req: true, cls: "c2" })}</div>`, {
    boton: "Asignar clave",
    enviar: async (x) => { await api("/api/usuarios/clave", { id: u.id, clave: x.clave }); cerrarModal(); aviso("Clave asignada"); },
  });
}

// ================================================================== AUDITORÍA
const ACCIONES_TXT = {
  PAGO: "Pago registrado", ANULAR_PAGO: "Recibo anulado", VENTA: "Venta", SEPARACION: "Separación", EDITAR_VENTA: "Negocio modificado",
  DESISTIMIENTO: "Desistimiento", ESCRITURA: "Escrituración", REESTRUCTURACION: "Plan reestructurado", PRECIO_LOTE: "Precio de lote",
  PRECIO_MASIVO: "Precios masivos", CLIENTE_NUEVO: "Comprador creado", GASTO: "Gasto", GASTO_ANULADO: "Gasto anulado",
  PRESUPUESTO: "Presupuesto", CONCILIACION: "Conciliación", GESTION_COBRO: "Gestión de cobro", RECORDATORIO: "Recordatorio enviado",
  ADJUNTO: "Documento subido", ADJUNTO_ELIMINADO: "Documento eliminado", COTIZACION: "Cotización", PROSPECTO_NUEVO: "Prospecto",
  INGRESO: "Ingreso al sistema", SOLICITUD: "Solicitud de aprobación", SOLICITUD_APROBADA: "Solicitud aprobada",
  SOLICITUD_RECHAZADA: "Solicitud rechazada", SOLICITUD_FALLIDA: "Solicitud no aplicada", SOLICITUD_CANCELADA: "Solicitud cancelada",
  USUARIO_NUEVO: "Usuario creado", USUARIO_EDITADO: "Usuario editado", USUARIO_ESTADO: "Usuario activado/desactivado",
  USUARIO_CLAVE: "Clave asignada", CAMBIO_CLAVE: "Cambio de clave", CONFIG: "Configuración", CONFIG_SECRETA: "Claves de alertas",
  TELEGRAM_VINCULADO: "Telegram vinculado", COMISION_ASIGNADA: "Comisión asignada", COMISION_EDITADA: "Comisión modificada",
  COMISION_ANULADA: "Comisión retirada", COMISION_PAGO: "Pago de comisiones", COMISION_PAGO_ANULADO: "Comprobante anulado",
  COMISIONISTA_NUEVO: "Comisionista creado", COMISIONISTA_EDITADO: "Comisionista editado", COMISIONISTA_ESTADO: "Comisionista activado/desactivado",
};

async function pintarAuditoria() {
  const f = Object.fromEntries(["audDesde", "audHasta", "audAccion", "audUsuario", "audQ"].map((k) => [k, $("#" + k)?.value || ""]));
  const q = new URLSearchParams({ desde: f.audDesde, hasta: f.audHasta, accion: f.audAccion, usuario: f.audUsuario, q: f.audQ, limite: 800 });
  const r = await api("/api/auditoria?" + q);
  const integ = r.integridad;
  if (!$("#audFiltros")) {
    $("#pagAuditoria").innerHTML = `<div class="pagina-cab"><div><h1>Auditoría</h1><p>Todo lo que se hace en el geovisor queda sellado en una cadena: si alguien altera un registro por fuera del sistema, se detecta.</p></div>
        <div class="botones"><button class="btn sec" id="btnVerif"><i data-lucide="shield-check"></i>Verificar integridad</button>
        <a class="btn sec" href="/api/exportar/auditoria.csv"><i data-lucide="file-spreadsheet"></i>Exportar</a></div></div>
      <div id="audInteg"></div>
      <div class="filtros-tabla" id="audFiltros">
        <label class="campo-inline">Desde <input type="date" id="audDesde"></label><label class="campo-inline">Hasta <input type="date" id="audHasta"></label>
        <select id="audAccion"><option value="">Todas las acciones</option>${r.acciones.map((a) => `<option value="${a}">${ACCIONES_TXT[a] || a}</option>`).join("")}</select>
        <div class="buscador peq"><i data-lucide="user"></i><input id="audUsuario" type="search" placeholder="Usuario…"></div>
        <div class="buscador peq"><i data-lucide="search"></i><input id="audQ" type="search" placeholder="Lote, recibo, texto…"></div>
        <span class="contador" id="audN"></span></div>
      <div class="tabla-wrap grande" id="audTabla"></div>`;
    iconos();
    ["audDesde", "audHasta", "audAccion", "audUsuario", "audQ"].forEach((k) => $("#" + k).addEventListener("change", pintarAuditoria));
    $("#btnVerif").addEventListener("click", async () => { await api("/api/integridad/verificar", {}); pintarAuditoria(); aviso("Integridad verificada"); });
  }
  $("#audInteg").innerHTML = integ.ok
    ? `<div class="alerta-caja ok" style="margin:0 0 14px"><i data-lucide="shield-check"></i><div><b>Integridad verificada:</b> los ${fmtN.format(integ.registros)} registros de la bitácora, los recibos, comprobantes, gastos y valores de venta coinciden. Revisado ${fecha(integ.revisado)} ${integ.revisado.slice(11, 16)}.</div></div>`
    : `<div class="alerta-caja mora" style="margin:0 0 14px"><i data-lucide="shield-alert"></i><div><b>Se detectaron ${integ.problemas.length} problema(s) de integridad:</b><ul style="margin:6px 0 0;padding-left:18px">${integ.problemas.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div></div>`;
  $("#audN").textContent = `${fmtN.format(r.filas.length)} registros`;
  $("#audTabla").innerHTML = `<table class="datos"><thead><tr><th>N°</th><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Lote</th><th>Detalle</th></tr></thead><tbody>
    ${r.filas.map((b) => `<tr><td>${b.id}</td><td>${fecha(b.fecha)} ${b.fecha.slice(11, 16)}</td><td>${esc(b.usuario)}</td><td>${ACCIONES_TXT[b.accion] || b.accion}</td>
      <td>${b.id_lote ? `<button class="link" data-lote="${b.id_lote}">${b.id_lote}</button>` : ""}</td>
      <td style="white-space:normal;font-size:11.5px;color:var(--txt-2);max-width:620px">${esc(resumenDetalle(b.detalle))}</td></tr>`).join("")}</tbody></table>`;
  iconos();
  $$("#audTabla [data-lote]").forEach((b) => b.addEventListener("click", () => irALote(b.dataset.lote)));
}
function resumenDetalle(txt) {
  try {
    const x = JSON.parse(txt || "{}");
    return Object.entries(x).filter(([, v]) => v !== null && v !== "" && typeof v !== "object")
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "number" && v > 9999 ? pesos(v) : v}`).join(" · ");
  } catch { return txt; }
}

// ================================================================== CENTRO DE CONFIGURACIÓN
async function abrirConfig() {
  const c = await api("/api/config");
  E.config = c;
  const t = (k, et, extra = {}) => campo("", et, `<input type="text" name="${k}" value="${esc(c[k] || "")}">`, extra);
  const n = (k, et, extra = {}, paso = "1") => campo("", et, `<input type="number" step="${paso}" name="${k}" value="${esc(c[k] || "0")}">`, extra);
  const sw = (k, et) => `<label class="interruptor c2" style="grid-column:1/-1"><input type="checkbox" name="${k}" ${c[k] === "1" ? "checked" : ""}><span></span>${et}</label>`;
  const hora = (k, et) => campo("", et, `<input type="time" name="${k}" value="${esc(c[k] || "")}">`);
  const pest = {
    proyecto: ["Proyecto y vendedor", `<div class="form-grid">
        ${t("proyecto", "Nombre del proyecto")} ${t("subtitulo", "Subtítulo")} ${t("ciudad", "Ciudad")}
        <div class="form-sec">Vendedor (aparece en recibos, contratos e informes)</div>
        ${t("vendedor_razon_social", "Razón social o nombre", { cls: "c2" })} ${t("vendedor_nit", "NIT / cédula")} ${t("vendedor_telefono", "Teléfono")}
        ${t("vendedor_direccion", "Dirección")} ${t("vendedor_email", "Correo")}
        ${t("vendedor_representante", "Representante legal")} ${t("vendedor_representante_doc", "Documento del representante")}
        ${t("cuenta_bancaria", "Cuenta para recibir pagos", { cls: "c2", ayuda: "Ej.: Bancolombia ahorros 123-456789-01 a nombre de …" })}</div>`],
    cartera: ["Cartera y ventas", `<div class="form-grid">
        ${n("dias_gracia", "Días de gracia antes de marcar mora")} ${n("tasa_mora_mensual", "Interés de mora (% mensual)", { ayuda: "0 = no calcular. Informativo." }, "0.01")}
        ${n("descuento_max_operador", "Descuento máximo que un operador da sin aprobación (%)", { ayuda: "0 = todo descuento se aprueba." }, "0.5")}
        ${n("comision_max_pct", "Tope de comisión por venta (%)", {}, "0.5")} ${n("cotizacion_validez_dias", "Validez de las cotizaciones (días)")}
        <div class="form-sec">Promesa de compraventa</div>
        ${n("promesa_penalidad_pct", "Cláusula penal por incumplimiento (% del precio)", {}, "0.5")}
        ${n("promesa_plazo_escritura_meses", "Plazo para escriturar tras pagar (meses)")} ${t("notaria_escrituracion", "Notaría para escriturar", { cls: "c2" })}</div>`],
    seguridad: ALERTAS_ACTIVAS ? ["Seguridad y alertas", `<div class="form-grid">
        ${n("sesion_minutos", "Cerrar sesión tras (minutos sin uso)")} ${n("umbral_efectivo", "Alertar pagos en efectivo desde ($)")}
        ${hora("horario_inicio", "Horario laboral desde")} ${hora("horario_fin", "Horario laboral hasta")}
        ${hora("resumen_diario_hora", "Hora del resumen diario a los dueños")}
        ${sw("alertas_acciones_duenos", "Avisar a los demás dueños cuando un dueño anule, desista, cambie precios o registre gastos")}
        <div class="form-sec">Canales de alerta</div>
        <div class="c2 canales">
          <div><b><i data-lucide="send"></i> Telegram</b><span>${c.telegram_configurado ? "✅ Configurado" : "Sin configurar"}</span>
            <small>Cree un bot con <b>@BotFather</b> en Telegram, copie el token y péguelo aquí. Luego cada dueño lo vincula en <i>Mi cuenta</i>.</small>
            <div class="fila-btn"><input type="password" id="tgToken" placeholder="${c.telegram_configurado ? "•••••• (escriba para reemplazar)" : "Token del bot"}" autocomplete="off"><button type="button" class="btn sec peq" id="btnTg">Guardar</button></div></div>
          <div><b><i data-lucide="mail"></i> Correo</b><span>${c.smtp_configurado ? "✅ Configurado" : "Sin configurar"}</span>
            <small>Con Gmail: active la verificación en dos pasos y cree una <b>contraseña de aplicación</b> (16 letras). No use su clave normal.</small>
            ${t("smtp_usuario", "Cuenta que envía (correo)")} ${t("smtp_remitente", "Nombre del remitente")}
            ${t("smtp_servidor", "Servidor")} ${t("smtp_puerto", "Puerto")}
            <div class="fila-btn"><input type="password" id="smtpClave" placeholder="${c.smtp_configurado ? "•••••• (escriba para reemplazar)" : "Contraseña de aplicación"}" autocomplete="off"><button type="button" class="btn sec peq" id="btnSmtp">Guardar</button></div></div>
        </div>
        <div class="c2" style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn sec" id="btnProbar"><i data-lucide="bell-ring"></i>Enviarme una prueba</button>
          <button type="button" class="btn sec" id="btnResumenYa"><i data-lucide="file-text"></i>Enviar el resumen de hoy</button></div>
        <div class="c2" id="estadoCanales"></div></div>`]
      : ["Seguridad", `<div class="form-grid">${n("sesion_minutos", "Cerrar sesión tras (minutos sin uso)")}</div>`],
    recordatorios: ["Recordatorios", `<div class="form-grid">
        ${sw("recordatorios_activos", "Enviar recordatorios automáticos por correo a los compradores")}
        ${n("recordatorio_dias_antes", "Avisar antes del vencimiento (días)")} ${t("recordatorio_mora_dias", "Avisos de mora a los días", { ayuda: "Separados por coma. Ej.: 1,15,30" })}
        ${hora("recordatorio_hora", "Hora de envío")}
        ${sw("confirmacion_pago_email", "Enviar al comprador la confirmación de cada pago registrado")}
        <div class="c2 ley-ayuda" style="padding:0">Requiere el correo configurado en «Seguridad y alertas». Los compradores sin correo aparecen en Cobranza para avisarles por WhatsApp.</div>
        <div class="c2"><button type="button" class="btn sec" id="btnRecYa"><i data-lucide="send"></i>Enviar los recordatorios de hoy ahora</button></div></div>`],
    respaldos: ["Respaldos y red", `<div class="form-grid">
        ${t("carpeta_respaldo_externa", "Carpeta para la copia diaria", { cls: "c2", ayuda: "Una carpeta sincronizada (Google Drive, OneDrive) o una USB. Ej.: G:\\\\Mi unidad\\\\Respaldos loteo" })}
        ${ALERTAS_ACTIVAS ? sw("respaldo_correo", "Enviar también la copia diaria por correo a los dueños") : ""}
        <div class="c2"><button type="button" class="btn sec" id="btnRespaldo"><i data-lucide="database-backup"></i>Hacer respaldo ahora</button></div>
        <div class="form-sec">Acceso desde otros equipos</div>
        ${sw("acceso_red", "Permitir el acceso desde otros equipos y celulares de la misma red (wifi de la oficina)")}
        <div class="c2 ley-ayuda" style="padding:0">Al activarlo, reinicie el geovisor: la ventana negra mostrará la dirección para abrirlo desde otro equipo. Todos deben ingresar con usuario y clave.</div>
        <div class="form-sec">Precios</div>
        <div class="c2"><button type="button" class="btn sec" id="btnMasivo"><i data-lucide="tags"></i>Asignar precios por manzana</button></div></div>`],
  };
  modal("Configuración", `<div class="subtabs" id="cfgTabs" style="padding:0;position:static;margin-bottom:14px">
      ${(ALERTAS_ACTIVAS || delete pest.recordatorios, "")}${Object.entries(pest).map(([k, [nom]], i) => `<button type="button" data-p="${k}" class="${i ? "" : "activo"}">${nom}</button>`).join("")}</div>
    ${Object.entries(pest).map(([k, [, h]], i) => `<div class="cfg-pest" data-p="${k}" ${i ? "hidden" : ""}>${h}</div>`).join("")}
    ${esDueno() ? "" : `<div class="alerta-caja aviso" style="margin-top:14px"><i data-lucide="shield-alert"></i><div>Los cambios que guarde quedarán <b>pendientes de aprobación</b> de un dueño.</div></div>`}`, {
    ancho: "extra",
    enviar: async (x) => {
      const datos = {};
      $$("#modalForm .cfg-pest input[name], #modalForm .cfg-pest select[name]").forEach((i) => {
        datos[i.name] = i.type === "checkbox" ? (i.checked ? "1" : "0") : i.value;
      });
      Object.keys(datos).forEach((k) => { if (String(datos[k]) === String(c[k] ?? "")) delete datos[k]; });
      if (!Object.keys(datos).length) { cerrarModal(); return; }
      await api("/api/config", datos);
      aplicarConfig(await api("/api/config"));
      cerrarModal();
      aviso("Configuración guardada");
    },
  });
  $$("#cfgTabs button").forEach((b) => b.addEventListener("click", () => {
    $$("#cfgTabs button").forEach((x) => x.classList.toggle("activo", x === b));
    $$(".cfg-pest").forEach((p) => { p.hidden = p.dataset.p !== b.dataset.p; });
  }));
  const secreta = async (campo_, valor) => {
    if (!valor) { aviso("Escriba el valor primero", true); return; }
    try { await api("/api/config/secreta", { [campo_]: valor }); aviso("Guardado de forma privada"); E.config = await api("/api/config"); } catch (e) { falla(e); }
  };
  $("#btnTg")?.addEventListener("click", () => secreta("telegram_token", $("#tgToken").value));
  $("#btnSmtp")?.addEventListener("click", () => secreta("smtp_clave", $("#smtpClave").value));
  $("#btnProbar")?.addEventListener("click", async () => {
    try { const r = await api("/api/alertas/probar", {}); aviso("Prueba enviada por " + r.canales.join(" y ")); } catch (e) { falla(e); }
  });
  $("#btnResumenYa")?.addEventListener("click", async () => { try { await api("/api/alertas/resumen", {}); aviso("Resumen enviado"); } catch (e) { falla(e); } });
  $("#btnRecYa")?.addEventListener("click", async () => { try { const r = await api("/api/alertas/recordatorios", {}); aviso(`${r.enviados} recordatorio(s) en cola`); } catch (e) { falla(e); } });
  $("#btnMasivo").addEventListener("click", formPreciosMasivos);
  $("#btnRespaldo").addEventListener("click", async () => { try { const r = await api("/api/respaldo", {}); aviso("Respaldo creado: " + r.archivo); } catch (e) { falla(e); } });
  if (!ALERTAS_ACTIVAS) { /* alertas externas ocultas */ } else if (esDueno()) {
    api("/api/alertas/estado").then((s) => {
      $("#estadoCanales").innerHTML = s.recientes.length ? `<div class="bloque-tit" style="margin:6px 0">Últimos envíos (${s.pendientes} en cola, ${s.errores} con error)</div>
        <table class="mini-tabla"><tbody>${s.recientes.slice(0, 8).map((r) => `<tr><td>${r.canal}</td><td>${esc(r.asunto || "")}</td><td>${r.estado}</td><td style="color:var(--peligro)">${esc(r.error || "")}</td></tr>`).join("")}</tbody></table>` : "";
    }).catch(() => {});
  } else {
    $$("#btnTg, #btnSmtp, #btnProbar, #btnResumenYa, #btnRecYa").forEach((b) => { b.disabled = true; b.title = "Solo un dueño"; });
  }
  iconos();
}
