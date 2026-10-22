/* ==========================================================================
   Comisionistas: registro, comisión por venta, causación, pagos con comprobante de egreso e informe PDF.
   Usa las utilidades y el estado global de app.js (E, api, modal, pesos…) e informe.js (CSS_HOJA).
   ========================================================================== */
"use strict";

const REGLAS_COM = {
  RECAUDO: { nom: "Proporcional al recaudo", ayuda: "Se causa a medida que el comprador paga el lote." },
  INICIAL: { nom: "Al pagarse la cuota inicial", ayuda: "Se causa completa cuando se paga la cuota inicial." },
  VENTA: { nom: "Al firmar la venta", ayuda: "Se causa completa en el momento de la venta." },
};
const ESTADOS_COM = {
  POR_PAGAR: "Por pagar", EN_CAUSACION: "En causación", PAGADA: "Pagada", EN_SEPARACION: "Lote separado",
  VENTA_DESISTIDA: "Venta desistida", ANULADA: "Anulada",
};
const VINCULOS_COM = { INDEPENDIENTE: "Independiente", INMOBILIARIA: "Inmobiliaria", EMPLEADO: "Empleado", REFERIDO: "Referido" };
const chipCom = (k) => `<span class="chip COM_${k}">${ESTADOS_COM[k] || k}</span>`;
const vivaCom = (x) => !["VENTA_DESISTIDA", "ANULADA"].includes(x.estado_comision);
const pct = (v) => `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(v || 0)} %`;

async function comisionistasActivos() {
  E.comisionistas = (await api("/api/comisionistas")).comisionistas;
  return E.comisionistas.filter((c) => c.estado === "ACTIVO");
}

// ================================================================== VISTA «COMISIONISTAS»
async function pintarComisionistas() {
  let r;
  try { r = await api("/api/comisionistas"); } catch (e) { falla(e); return; }
  E.comisionistas = r.comisionistas;
  const t = r.totales;
  const k = (et, va, sub, color, ic, cls = "") => `<div class="kpi ${cls}" style="--c:${color}"><div class="et"><i data-lucide="${ic}"></i>${et}</div><div class="va">${va}</div><div class="sub">${sub}</div></div>`;
  $("#kpisCom").innerHTML =
    k("Comisionistas activos", fmtN.format(r.activos), `${fmtN.format(r.comisionistas.length)} registrados`, "#0C2E37", "users") +
    k("Ventas con comisión", fmtN.format(t.ventas), pesosCorto(t.valor_vendido) + " vendidos", "#3B82F6", "file-signature") +
    k("Comisiones generadas", pesosCorto(t.generado), "Sobre ventas activas", "#8B5CF6", "badge-percent") +
    k("Causadas", pesosCorto(t.causado), "Exigibles según la regla", "#F5B841", "hourglass") +
    k("Pagadas", pesosCorto(t.pagado), "Con comprobante de egreso", "#17A974", "wallet") +
    k("Por pagar", pesosCorto(t.por_pagar), t.anticipado ? `${pesosCorto(t.anticipado)} pagados por anticipado` : "Causadas y no pagadas", "#DC2626", "hand-coins", t.por_pagar ? "rojo" : "");
  filtrarComisionistas();
  iconos();
}

function filtrarComisionistas() {
  const q = ($("#comBuscar").value || "").toLowerCase().trim(), est = $("#comEstado").value;
  const ls = (E.comisionistas || []).filter((c) => (!est || c.estado === est)
    && (!q || `${c.nombre} ${c.documento || ""} ${c.telefono || ""}`.toLowerCase().includes(q)));
  $("#comContador").textContent = `${fmtN.format(ls.length)} comisionistas`;
  if (!ls.length) {
    $("#tComisionistas").innerHTML = `<div class="vacio" style="padding:50px"><i data-lucide="users"></i>${(E.comisionistas || []).length
      ? "Ningún comisionista coincide con el filtro." : "Aún no hay comisionistas. Regístrelos con el botón «Nuevo comisionista»."}</div>`;
    iconos();
    return;
  }
  const sum = (k2) => ls.reduce((s, c) => s + (c[k2] || 0), 0);
  $("#tComisionistas").innerHTML = `<table class="datos"><thead><tr><th>Comisionista</th><th>Documento</th><th>Teléfono</th><th>Vínculo</th>
      <th class="d">% base</th><th class="d">Ventas</th><th class="d">Valor vendido</th><th class="d">Generada</th><th class="d">Causada</th>
      <th class="d">Pagada</th><th class="d">Por pagar</th><th>Estado</th></tr></thead><tbody>
    ${ls.map((c) => `<tr data-id="${c.id}"><td><b>${esc(c.nombre)}</b></td><td>${esc(c.tipo_doc)} ${esc(c.documento || "—")}</td><td>${esc(c.telefono || "")}</td>
      <td>${VINCULOS_COM[c.vinculo] || c.vinculo}</td><td class="d">${pct(c.porcentaje_defecto)}</td><td class="d">${c.ventas || "—"}</td>
      <td class="d">${c.valor_vendido ? pesos(c.valor_vendido) : "—"}</td><td class="d">${c.generado ? pesos(c.generado) : "—"}</td>
      <td class="d">${c.causado ? pesos(c.causado) : "—"}</td><td class="d">${c.pagado ? pesos(c.pagado) : "—"}</td>
      <td class="d">${c.por_pagar ? `<span class="rojo">${pesos(c.por_pagar)}</span>` : "—"}</td>
      <td><span class="chip ${c.estado === "ACTIVO" ? "DISPONIBLE" : "BLOQUEADO"}">${c.estado === "ACTIVO" ? "Activo" : "Inactivo"}</span></td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="5">Total</td><td class="d">${fmtN.format(sum("ventas"))}</td><td class="d">${pesos(sum("valor_vendido"))}</td>
      <td class="d">${pesos(sum("generado"))}</td><td class="d">${pesos(sum("causado"))}</td><td class="d">${pesos(sum("pagado"))}</td>
      <td class="d">${pesos(sum("por_pagar"))}</td><td></td></tr></tfoot></table>`;
  $$("#tComisionistas tbody tr").forEach((tr) => tr.addEventListener("click", () => abrirComisionista(+tr.dataset.id)));
}

// ================================================================== DETALLE DE UN COMISIONISTA
async function abrirComisionista(id, pestana = "com") {
  let d;
  try { d = await api("/api/comisionista?id=" + id); } catch (e) { falla(e); return; }
  const cm = d.comisionista, t = d.totales;
  const activo = cm.estado === "ACTIVO";
  modal(cm.nombre, `
    <div class="com-cab">
      <div class="com-id"><span class="chip ${activo ? "DISPONIBLE" : "BLOQUEADO"}">${activo ? "Activo" : "Inactivo"}</span>
        <span class="chip VENDIDO">${VINCULOS_COM[cm.vinculo] || cm.vinculo}</span>
        <span>${esc(cm.tipo_doc)} ${esc(cm.documento || "—")}${cm.telefono ? ` · <i data-lucide="phone"></i> ${esc(cm.telefono)}` : ""}${cm.email ? ` · ${esc(cm.email)}` : ""}</span></div>
      <div class="com-kpis">
        <div><small>Ventas</small><b>${t.ventas}</b></div><div><small>Valor vendido</small><b>${pesosCorto(t.valor_vendido)}</b></div>
        <div><small>Generada</small><b>${pesos(t.generado)}</b></div><div><small>Causada</small><b>${pesos(t.causado)}</b></div>
        <div><small>Pagada</small><b>${pesos(t.pagado)}</b></div><div class="${t.por_pagar ? "malo" : ""}"><small>Por pagar</small><b>${pesos(t.por_pagar)}</b></div>
      </div></div>
    <div class="subtabs" id="comTabs" style="padding:0;position:static">
      <button data-st="com">Comisiones<span class="n">${d.comisiones.length}</span></button>
      <button data-st="pag">Pagos<span class="n">${d.pagos.length}</span></button>
      <button data-st="dat">Datos</button><button data-st="his">Historial</button></div>
    <div id="comCont" style="padding-top:12px"></div>`, {
    ancho: "extra",
    extraPie: `<button type="button" class="btn sec" data-c="estado">${activo ? "Desactivar" : "Activar"}</button>
      <button type="button" class="btn sec" data-c="editar"><i data-lucide="pencil"></i>Editar datos</button>
      <button type="button" class="btn sec" data-c="pdf"><i data-lucide="file-down"></i>Informe PDF</button>
      <button type="button" class="btn acento" data-c="pagar" ${t.por_pagar > 0.5 ? "" : "disabled"}><i data-lucide="hand-coins"></i>Pagar comisiones</button>`,
  });
  $("[data-cerrar2]").textContent = "Cerrar";
  const st = (k) => {
    $$("#comTabs button").forEach((b) => b.classList.toggle("activo", b.dataset.st === k));
    $("#comCont").innerHTML = k === "com" ? htmlComisiones(d) : k === "pag" ? htmlPagosCom(d) : k === "dat" ? htmlDatosCom(cm) : htmlHistCom(d);
    iconos();
    $$("#comCont [data-lote]").forEach((b) => b.addEventListener("click", () => { cerrarModal(); irALote(b.dataset.lote); }));
    $$("#comCont [data-egreso]").forEach((b) => b.addEventListener("click", () => imprimirComprobante(+b.dataset.egreso)));
    $$("#comCont [data-anular]").forEach((b) => b.addEventListener("click", () => formAnularEgreso(+b.dataset.anular, b.dataset.info, cm.id)));
  };
  $$("#comTabs button").forEach((b) => b.addEventListener("click", () => st(b.dataset.st)));
  st(pestana);
  $("[data-c=editar]").addEventListener("click", () => formComisionista(cm));
  $("[data-c=pagar]").addEventListener("click", () => formPagarComision(d));
  $("[data-c=pdf]").addEventListener("click", (e) => descargarInformeComisionista(cm.id, e.currentTarget));
  $("[data-c=estado]").addEventListener("click", async () => {
    try {
      await api("/api/comisionista/estado", { id: cm.id, estado: activo ? "INACTIVO" : "ACTIVO" });
      aviso(`Comisionista ${activo ? "desactivado" : "activado"}`);
      abrirComisionista(cm.id);
      if ($("#vista-comisionistas").classList.contains("activa")) pintarComisionistas();
    } catch (e) { falla(e); }
  });
}

function htmlComisiones(d) {
  if (!d.comisiones.length) return `<div class="vacio"><i data-lucide="file-signature"></i>Este comisionista aún no tiene ventas asignadas. Se asignan al vender o separar un lote, o desde la ficha del lote.</div>`;
  return `<div class="tabla-wrap"><table class="datos"><thead><tr><th>Lote</th><th>Comprador</th><th>Fecha</th><th class="d">Valor venta</th><th class="d">%</th>
      <th>Causación</th><th class="d">Comisión</th><th class="d">Recaudo lote</th><th class="d">Causada</th><th class="d">Pagada</th><th class="d">Por pagar</th><th>Estado</th></tr></thead><tbody>
    ${d.comisiones.map((x) => `<tr><td><button class="link" data-lote="${x.id_lote}">${x.id_lote}</button></td><td>${esc(x.cliente)}</td><td>${fecha(x.fecha_venta)}</td>
      <td class="d">${pesos(x.valor_venta)}</td><td class="d">${pct(x.porcentaje)}</td><td>${x.regla_nombre}</td><td class="d">${vivaCom(x) ? pesos(x.valor_comision) : "—"}</td>
      <td class="d">${fmtN1.format(x.pct_recaudo)} %</td><td class="d">${pesos(x.causado)}</td><td class="d">${x.pagado ? pesos(x.pagado) : "—"}</td>
      <td class="d">${x.por_pagar ? `<span class="rojo">${pesos(x.por_pagar)}</span>` : "—"}</td><td>${chipCom(x.estado_comision)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="6">Total</td><td class="d">${pesos(d.totales.generado)}</td><td></td><td class="d">${pesos(d.totales.causado)}</td>
      <td class="d">${pesos(d.totales.pagado)}</td><td class="d">${pesos(d.totales.por_pagar)}</td><td></td></tr></tfoot></table></div>`;
}

function htmlPagosCom(d) {
  if (!d.pagos.length) return `<div class="vacio"><i data-lucide="receipt"></i>Aún no se le han pagado comisiones.</div>`;
  return `<div class="tabla-wrap"><table class="datos"><thead><tr><th>Comprobante</th><th>Fecha</th><th>Lotes</th><th class="d">Bruto</th><th class="d">Retención</th>
      <th class="d">Neto pagado</th><th>Medio</th><th>Referencia</th><th>Registró</th><th></th></tr></thead><tbody>
    ${[...d.pagos].reverse().map((p) => `<tr class="${p.anulado ? "anulado" : ""}"><td class="num"><b>CE ${String(p.comprobante).padStart(6, "0")}</b></td><td>${fecha(p.fecha)}</td>
      <td>${p.detalle.map((x) => x.id_lote).join(", ")}</td><td class="d">${pesos(p.valor_bruto)}</td><td class="d">${p.retencion ? pesos(p.retencion) : "—"}</td>
      <td class="d">${pesos(p.valor_neto)}</td><td>${esc(p.medio)}</td><td>${esc(p.referencia || "")}</td><td>${esc(p.usuario || "")}</td>
      <td style="text-decoration:none;white-space:nowrap">${p.anulado ? `<span class="chip ANULADO" title="${esc(p.motivo_anulacion)}">Anulado</span>`
        : `<button type="button" class="link" data-egreso="${p.comprobante}" title="Imprimir comprobante"><i data-lucide="printer"></i></button>
           <button type="button" class="link rojo" data-anular="${p.id}" data-info="CE ${String(p.comprobante).padStart(6, "0")} · ${pesos(p.valor_neto)}" title="Anular"><i data-lucide="ban"></i></button>`}</td></tr>`).join("")}</tbody></table></div>`;
}

function htmlDatosCom(cm) {
  const f = (et, va) => `<dt>${et}</dt><dd>${va || "—"}</dd>`;
  return `<div class="dos-col"><div><div class="bloque-tit" style="margin-bottom:8px">Identificación y contacto</div><dl class="dl">
      ${f("Nombre", esc(cm.nombre))}${f("Persona", cm.tipo_persona === "JURIDICA" ? "Jurídica" : "Natural")}${f("Documento", `${esc(cm.tipo_doc)} ${esc(cm.documento || "")}`)}
      ${f("Teléfono", esc(cm.telefono))}${f("Correo", esc(cm.email))}${f("Dirección", esc(cm.direccion))}${f("Ciudad", esc(cm.ciudad))}
      ${f("Vínculo", VINCULOS_COM[cm.vinculo])}${f("Fecha de ingreso", fecha(cm.fecha_ingreso))}</dl></div>
    <div><div class="bloque-tit" style="margin-bottom:8px">Condiciones y pago</div><dl class="dl">
      ${f("Comisión base", pct(cm.porcentaje_defecto))}${f("Causación", REGLAS_COM[cm.regla_causacion]?.nom)}${f("Retención en la fuente", pct(cm.retencion_pct))}
      ${f("Banco", esc(cm.banco))}${f("Tipo de cuenta", esc(cm.tipo_cuenta))}${f("N° de cuenta", esc(cm.numero_cuenta))}${f("Titular", esc(cm.titular_cuenta))}
      ${cm.observacion ? f("Observación", esc(cm.observacion)) : ""}</dl></div></div>`;
}

const ACC_COM = { COMISIONISTA_NUEVO: "Comisionista registrado", COMISIONISTA_EDITADO: "Datos modificados", COMISIONISTA_ESTADO: "Cambio de estado",
  COMISION_ASIGNADA: "Comisión asignada", COMISION_EDITADA: "Comisión modificada", COMISION_ANULADA: "Comisión retirada",
  COMISION_PAGO: "Pago de comisiones", COMISION_PAGO_ANULADO: "Comprobante anulado" };
function htmlHistCom(d) {
  if (!d.bitacora.length) return `<div class="vacio"><i data-lucide="history"></i>Sin movimientos.</div>`;
  return d.bitacora.map((b) => {
    const x = JSON.parse(b.detalle || "{}");
    let txt = "";
    if (b.accion === "COMISION_ASIGNADA") txt = `${b.id_lote} · ${pct(x.porcentaje)} · ${REGLAS_COM[x.regla]?.nom || ""}`;
    else if (b.accion === "COMISION_EDITADA") txt = `${b.id_lote} · ${pct(x.antes?.porcentaje)} → ${pct(x.despues?.porcentaje)}`;
    else if (b.accion === "COMISION_PAGO") txt = `CE ${String(x.comprobante).padStart(6, "0")} · neto ${pesos(x.neto)} · ${(x.lotes || []).join(", ")}`;
    else if (b.accion === "COMISION_PAGO_ANULADO") txt = `CE ${String(x.comprobante).padStart(6, "0")} · ${esc(x.motivo)}`;
    else if (b.accion === "COMISION_ANULADA") txt = `${b.id_lote} · ${esc(x.motivo)}`;
    else if (b.accion === "COMISIONISTA_EDITADO") txt = Object.keys(x.cambios || {}).join(", ");
    else if (b.accion === "COMISIONISTA_ESTADO") txt = x.estado;
    return `<div class="bit"><span class="p"></span><div><b>${ACC_COM[b.accion] || b.accion}</b>${txt ? " · " + txt : ""}<br>
      <span class="q">${fecha(b.fecha)} ${b.fecha.slice(11, 16)} · ${esc(b.usuario)}</span></div></div>`;
  }).join("");
}

// ================================================================== FORMULARIOS
function formComisionista(cm = {}) {
  const t = (k, et, extra = {}) => campo("", et, `<input type="text" name="${k}" value="${esc(cm[k] || "")}">`, extra);
  const s = (k, ops, val) => `<select name="${k}">${Object.entries(ops).map(([v, n]) => `<option value="${v}" ${v === val ? "selected" : ""}>${n}</option>`).join("")}</select>`;
  modal(cm.id ? `Editar comisionista · ${cm.nombre}` : "Nuevo comisionista", `<div class="form-grid">
      <input type="hidden" name="id" value="${cm.id || ""}">
      <div class="form-sec">Identificación</div>
      ${campo("", "Nombre completo o razón social", `<input type="text" name="nombre" required value="${esc(cm.nombre || "")}">`, { req: true, cls: "c2" })}
      ${campo("", "Tipo de persona", s("tipo_persona", { NATURAL: "Persona natural", JURIDICA: "Persona jurídica" }, cm.tipo_persona || "NATURAL"))}
      ${campo("", "Vínculo", s("vinculo", VINCULOS_COM, cm.vinculo || "INDEPENDIENTE"))}
      ${campo("", "Tipo de documento", sel("tipo_doc", TIPOS_DOC, cm.tipo_doc || "CC"))}
      ${campo("", "N° de documento / NIT", `<input type="text" name="documento" value="${esc(cm.documento || "")}">`)}
      <div class="form-sec">Contacto</div>
      ${t("telefono", "Teléfono")} ${t("email", "Correo electrónico")} ${t("direccion", "Dirección")} ${t("ciudad", "Ciudad")}
      <div class="form-sec">Condiciones de comisión</div>
      ${campo("", "Comisión base (%)", `<input type="number" name="porcentaje_defecto" min="0" max="30" step="0.01" value="${cm.porcentaje_defecto ?? 3}">`, { ayuda: "Se propone al asignarlo a una venta; se puede ajustar en cada venta." })}
      ${campo("", "Causación de la comisión", s("regla_causacion", Object.fromEntries(Object.entries(REGLAS_COM).map(([k, v]) => [k, v.nom])), cm.regla_causacion || "RECAUDO"), { ayuda: "Cuándo se gana el derecho a cobrarla." })}
      ${campo("", "Retención en la fuente (%)", `<input type="number" name="retencion_pct" min="0" max="20" step="0.01" value="${cm.retencion_pct ?? 0}">`, { ayuda: "Se descuenta al pagar. Confirme el porcentaje con su contador." })}
      ${campo("", "Fecha de ingreso", `<input type="date" name="fecha_ingreso" value="${cm.fecha_ingreso || hoyISO()}">`)}
      <div class="form-sec">Cuenta para el pago</div>
      ${t("banco", "Banco")} ${campo("", "Tipo de cuenta", sel("tipo_cuenta", ["Ahorros", "Corriente", "Nequi", "Daviplata"], cm.tipo_cuenta || "Ahorros"))}
      ${t("numero_cuenta", "N° de cuenta")} ${t("titular_cuenta", "Titular de la cuenta")}
      ${campo("", "Observación", `<textarea name="observacion" rows="2">${esc(cm.observacion || "")}</textarea>`, { cls: "c2" })}
    </div>`, {
    ancho: true, boton: cm.id ? "Guardar cambios" : "Registrar comisionista",
    enviar: async (x) => {
      const r = await api("/api/comisionista/guardar", x);
      cerrarModal();
      aviso(cm.id ? "Comisionista actualizado" : "Comisionista registrado");
      if ($("#vista-comisionistas").classList.contains("activa")) await pintarComisionistas();
      abrirComisionista(r.id, cm.id ? "dat" : "com");
    },
  });
}

function formPagarComision(d) {
  const cm = d.comisionista;
  const pend = d.comisiones.filter((x) => x.por_pagar > 0.5);
  modal(`Pagar comisiones · ${cm.nombre}`, `
    <p class="texto-modal">Seleccione las comisiones causadas que se pagan. Se genera un <b>comprobante de egreso</b> con consecutivo.
      ${cm.banco ? `<br>Cuenta registrada: <b>${esc(cm.banco)} ${esc(cm.tipo_cuenta || "")} ${esc(cm.numero_cuenta || "")}</b>${cm.titular_cuenta ? ` · ${esc(cm.titular_cuenta)}` : ""}` : ""}</p>
    <table class="mini-tabla" id="tPagarCom"><thead><tr><th></th><th>Lote</th><th>Comprador</th><th class="d">Causada</th><th class="d">Pagada</th><th class="d">Por pagar</th><th class="d" style="width:170px">Valor a pagar</th></tr></thead><tbody>
      ${pend.map((x) => `<tr data-id="${x.id}" data-max="${x.por_pagar}"><td><input type="checkbox" class="selCom" checked></td><td><b>${x.id_lote}</b></td><td>${esc(x.cliente)}</td>
        <td class="d">${pesos(x.causado)}</td><td class="d">${x.pagado ? pesos(x.pagado) : "—"}</td><td class="d">${pesos(x.por_pagar)}</td>
        <td class="d"><div class="input-dinero"><input class="dinero valCom" value="${Math.round(x.por_pagar)}" inputmode="numeric"></div></td></tr>`).join("")}
    </tbody></table>
    <div class="form-grid" style="margin-top:14px">
      ${campo("", "Fecha del pago", `<input type="date" name="fecha" value="${hoyISO()}" required>`, { req: true })}
      ${campo("", "Medio de pago", sel("medio", MEDIOS, "Transferencia"))}
      ${campo("", "Retención en la fuente (%)", `<input type="number" name="retencion_pct" min="0" max="20" step="0.01" value="${cm.retencion_pct || 0}">`)}
      ${campo("", "Referencia / comprobante bancario", `<input type="text" name="referencia">`)}
      ${campo("", "Observación", `<input type="text" name="observacion">`, { cls: "c2" })}
      <div class="resumen-plan" id="resPagoCom" style="grid-template-columns:repeat(3,1fr)"></div>
    </div>`, {
    ancho: true, boton: "Registrar pago y generar comprobante",
    enviar: async (x) => {
      const items = $$("#tPagarCom tbody tr").filter((tr) => tr.querySelector(".selCom").checked)
        .map((tr) => ({ comision_id: +tr.dataset.id, valor: valorDinero(tr.querySelector(".valCom").value) }));
      const r = await api("/api/comision/pagar", { comisionista_id: cm.id, items, ...x });
      cerrarModal();
      aviso(`Pago registrado · comprobante CE ${String(r.comprobante).padStart(6, "0")}`);
      if ($("#vista-comisionistas").classList.contains("activa")) pintarComisionistas();
      await recargar();
      ofrecerComprobante(r.comprobante, cm.id);
    },
  });
  const calc = () => {
    let bruto = 0;
    $$("#tPagarCom tbody tr").forEach((tr) => { if (tr.querySelector(".selCom").checked) bruto += valorDinero(tr.querySelector(".valCom").value); });
    const ret = Math.round((bruto * (+$("[name=retencion_pct]").value || 0)) / 100);
    $("#resPagoCom").innerHTML = `<div><div class="et">Valor bruto</div><div class="va">${pesos(bruto)}</div></div>
      <div><div class="et">Retención</div><div class="va">${pesos(ret)}</div></div><div><div class="et">Neto a pagar</div><div class="va">${pesos(bruto - ret)}</div></div>`;
  };
  $$("#tPagarCom input, [name=retencion_pct]").forEach((i) => i.addEventListener("input", calc));
  calc();
}

function ofrecerComprobante(n, cid) {
  modal("Pago de comisiones registrado", `<div style="text-align:center;padding:10px 0">
      <div style="width:56px;height:56px;border-radius:50%;background:#DCFCE7;color:#15803D;display:grid;place-items:center;margin:0 auto 12px"><i data-lucide="check" style="width:28px;height:28px"></i></div>
      <div style="font-family:var(--f-tit);font-size:18px;font-weight:600;color:var(--teal)">Comprobante de egreso CE ${String(n).padStart(6, "0")}</div>
      <p class="texto-modal" style="margin-top:6px">Imprímalo y hágalo firmar por el comisionista como constancia del pago.</p></div>`,
  { extraPie: `<button type="button" class="btn sec" id="btnVolverCom">Volver al comisionista</button><button type="button" class="btn acento" id="btnImpCE"><i data-lucide="printer"></i>Imprimir comprobante</button>` });
  $("[data-cerrar2]").textContent = "Cerrar";
  $("#btnImpCE").addEventListener("click", () => imprimirComprobante(n));
  $("#btnVolverCom").addEventListener("click", () => abrirComisionista(cid, "pag"));
  iconos();
}

function formAnularEgreso(pagoId, info, cid) {
  modal("Anular comprobante de egreso", `<p class="texto-modal">Se anulará el <b>${esc(info)}</b>. El comprobante conserva su número y queda marcado como anulado;
      las comisiones vuelven a quedar por pagar.</p>
    <div class="form-grid">${campo("", "Motivo de la anulación", `<input type="text" name="motivo" required>`, { req: true, cls: "c2" })}</div>`, {
    boton: "Anular comprobante", peligro: true,
    enviar: async (x) => {
      await api("/api/comision/pago/anular", { pago_id: pagoId, motivo: x.motivo });
      aviso("Comprobante anulado");
      await recargar();
      abrirComisionista(cid, "pag");
    },
  });
}

// Campos de comisión dentro de los formularios de venta y separación
function camposComision(activos) {
  if (!activos.length) return `<div class="form-sec">Comisión</div><div class="c2 ley-ayuda" style="padding:0">No hay comisionistas activos. Regístrelos en la pestaña «Comisionistas».</div>`;
  return `<div class="form-sec">Comisión (opcional)</div>
    ${campo("", "Comisionista", `<select name="comisionista_id"><option value="">Sin comisionista</option>${activos.map((c) => `<option value="${c.id}" data-pct="${c.porcentaje_defecto}" data-regla="${c.regla_causacion}">${esc(c.nombre)}</option>`).join("")}</select>`)}
    ${campo("", "Comisión (%)", `<input type="number" name="comision_pct" min="0" max="30" step="0.01" placeholder="—">`, { ayuda: `Tope por venta: ${E.config.comision_max_pct || 10} %.` })}
    ${campo("", "Causación", `<select name="comision_regla">${Object.entries(REGLAS_COM).map(([k, v]) => `<option value="${k}">${v.nom}</option>`).join("")}</select>`, { cls: "c2" })}`;
}
function enlazarCamposComision() {
  const s = $("[name=comisionista_id]");
  if (!s) return;
  s.addEventListener("change", () => {
    const o = s.selectedOptions[0];
    $("[name=comision_pct]").value = o.dataset.pct || "";
    if (o.dataset.regla) $("[name=comision_regla]").value = o.dataset.regla;
  });
}

// Comisión en la ficha del lote
function htmlComisionFicha(v) {
  const coms = (v.comisiones || []).filter((x) => x.estado === "ACTIVA");
  return `<div class="f-sec"><h4><i data-lucide="badge-percent"></i>Comisión
      <span class="mas"><button class="link" data-acc="comision-asignar"><i data-lucide="plus"></i> Asignar</button></span></h4>
    ${coms.length ? coms.map((x) => `<div class="com-ficha">
        <div class="cf-top"><button class="link" data-acc="comision-ver" data-cid="${x.comisionista_id}"><b>${esc(x.comisionista)}</b></button>${chipCom(x.estado_comision)}</div>
        <div class="cf-grid"><span>${pct(x.porcentaje)} · ${x.regla_nombre}</span><span>Comisión <b>${pesos(x.valor_comision)}</b></span>
          <span>Causada <b>${pesos(x.causado)}</b></span><span>Pagada <b>${pesos(x.pagado)}</b></span></div>
        <div class="cf-acc"><button class="link" data-acc="comision-editar" data-id="${x.id}">Editar</button>
          ${x.pagado ? "" : `<button class="link rojo" data-acc="comision-quitar" data-id="${x.id}">Quitar</button>`}</div></div>`).join("")
      : `<div class="ley-ayuda" style="padding:0">Venta sin comisionista asignado.</div>`}</div>`;
}

async function enlazarComisionFicha(d, v) {
  $$("#fichaCont [data-acc^=comision-]").forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.acc;
    if (a === "comision-ver") return abrirComisionista(+b.dataset.cid);
    if (a === "comision-asignar") return formAsignarComision(d, v);
    const x = v.comisiones.find((k) => k.id === +b.dataset.id);
    if (a === "comision-editar") return formEditarComision(d, x);
    if (a === "comision-quitar") return formQuitarComision(d, x);
  }));
}

async function formAsignarComision(d, v) {
  const activos = await comisionistasActivos();
  if (!activos.length) { aviso("Primero registre comisionistas en la pestaña «Comisionistas».", true); return; }
  modal(`Asignar comisión · ${d.lote.id_lote}`, `<p class="texto-modal">Venta de <b>${esc(v.nombre)}</b> por <b>${pesos(v.valor_venta)}</b>.</p>
    <div class="form-grid">${camposComision(activos)}
      ${campo("", "Observación", `<input type="text" name="observacion">`, { cls: "c2" })}
      <div class="resumen-plan" id="resCom" style="grid-template-columns:repeat(2,1fr)"></div></div>`, {
    boton: "Asignar comisión",
    enviar: async (x) => {
      if (!x.comisionista_id) throw new Error("Seleccione el comisionista.");
      await api("/api/comision/asignar", { venta_id: v.id, comisionista_id: x.comisionista_id, porcentaje: x.comision_pct, regla: x.comision_regla, observacion: x.observacion });
      await trasGuardar("Comisión asignada");
    },
  });
  enlazarCamposComision();
  const calc = () => { const p = +$("[name=comision_pct]").value || 0;
    $("#resCom").innerHTML = `<div><div class="et">Valor de la comisión</div><div class="va">${pesos((v.valor_venta * p) / 100)}</div></div>
      <div><div class="et">Sobre la venta de</div><div class="va">${pesos(v.valor_venta)}</div></div>`; };
  $$("[name=comision_pct], [name=comisionista_id]").forEach((i) => i.addEventListener("input", calc));
  $("[name=comisionista_id]").addEventListener("change", calc);
  calc();
}

function formEditarComision(d, x) {
  modal(`Editar comisión · ${x.comisionista}`, `<p class="texto-modal">Lote ${d.lote.id_lote} · venta por <b>${pesos(x.valor_venta)}</b>${x.pagado ? ` · ya pagado al comisionista: <b>${pesos(x.pagado)}</b>` : ""}.</p>
    <div class="form-grid">
      ${campo("", "Comisión (%)", `<input type="number" name="porcentaje" min="0" max="30" step="0.01" value="${x.porcentaje}">`)}
      ${campo("", "Causación", `<select name="regla">${Object.entries(REGLAS_COM).map(([k, v]) => `<option value="${k}" ${k === x.regla ? "selected" : ""}>${v.nom}</option>`).join("")}</select>`)}
      ${campo("", "Observación", `<input type="text" name="observacion" value="${esc(x.observacion || "")}">`, { cls: "c2" })}
    </div>`, {
    enviar: async (f) => { await api("/api/comision/editar", { id: x.id, ...f }); await trasGuardar("Comisión actualizada"); },
  });
}

function formQuitarComision(d, x) {
  modal("Quitar comisión", `<p class="texto-modal">Se retirará la comisión de <b>${esc(x.comisionista)}</b> en el lote ${d.lote.id_lote}. Queda registrada en el historial.</p>
    <div class="form-grid">${campo("", "Motivo", `<input type="text" name="motivo" required>`, { req: true, cls: "c2" })}</div>`, {
    boton: "Quitar comisión", peligro: true,
    enviar: async (f) => { await api("/api/comision/anular", { id: x.id, motivo: f.motivo }); await trasGuardar("Comisión retirada"); },
  });
}

// ================================================================== DOCUMENTOS
async function imprimirComprobante(n) {
  let r;
  try { r = await api("/api/comprobante?n=" + n); } catch (e) { falla(e); return; }
  const p = r.pago, cm = r.comisionista;
  const num = `CE ${String(p.comprobante).padStart(6, "0")}`;
  imprimir(`Comprobante de egreso ${num}`, `<div class="recibo">${p.anulado ? `<div class="anulado">ANULADO</div>` : ""}
    ${cabecera("COMPROBANTE DE EGRESO", num, `Fecha: ${fechaLarga(p.fecha)}`)}
    <div class="caja">
      <div class="fila"><span>Pagado a</span><b>${esc(cm.nombre)}</b></div>
      <div class="fila"><span>Documento</span><b>${esc(cm.tipo_doc)} ${esc(cm.documento || "—")}</b></div>
      <div class="fila"><span>Concepto</span><b>Pago de comisiones por venta de lotes · ${esc(E.config.proyecto)}</b></div>
      <div class="fila"><span>Medio de pago</span><b>${esc(p.medio)}${p.referencia ? " · Ref. " + esc(p.referencia) : ""}</b></div>
      ${cm.banco ? `<div class="fila"><span>Cuenta del beneficiario</span><b>${esc(cm.banco)} ${esc(cm.tipo_cuenta || "")} ${esc(cm.numero_cuenta || "")}</b></div>` : ""}
      ${p.observacion ? `<div class="fila"><span>Observación</span><b style="font-weight:400">${esc(p.observacion)}</b></div>` : ""}
    </div>
    <table><thead><tr><th>Lote</th><th>Comprador</th><th class="d">Valor venta</th><th class="d">%</th><th class="d">Valor pagado</th></tr></thead><tbody>
      ${r.detalle.map((x) => `<tr><td>${x.id_lote}</td><td>${esc(x.cliente)}</td><td class="d">${pesos(x.valor_venta)}</td><td class="d">${pct(x.porcentaje)}</td><td class="d">${pesos(x.valor)}</td></tr>`).join("")}
      <tr class="tot"><td colspan="4">Valor bruto</td><td class="d">${pesos(p.valor_bruto)}</td></tr>
      <tr><td colspan="4">Retención en la fuente (${pct(p.retencion_pct)})</td><td class="d">− ${pesos(p.retencion)}</td></tr>
    </tbody></table>
    <div class="valor" style="margin-top:12px"><span>NETO PAGADO</span><span class="num">${pesos(p.valor_neto)}</span></div>
    <div class="letras">Son: ${numeroALetras(p.valor_neto)}</div>
    <div class="firmas" style="margin-top:56px"><div>Elaboró${p.usuario ? `: ${esc(p.usuario)}` : ""}</div><div>Aprobó</div>
      <div>Recibí conforme: ${esc(cm.nombre)}<br>${esc(cm.tipo_doc)} ${esc(cm.documento || "")}</div></div>
    <div class="pie">Generado el ${fecha(hoyISO())}</div></div>`);
}

function htmlInformeComisionista(d) {
  const c = E.config, cm = d.comisionista, t = d.totales;
  const fila = (et, va) => `<tr><th>${et}</th><td>${va || "—"}</td></tr>`;
  const avance = t.generado ? Math.min((100 * t.pagado) / t.generado, 100) : 0;
  const reglas = [...new Set(d.comisiones.map((x) => x.regla))];
  return `<div class="hv">${cabecera("INFORME DE COMISIONES", "", `Fecha de corte: ${fechaLarga(hoyISO())}`)}
    <div class="banda">
      <div><div class="b-tit">${esc(cm.nombre)}</div>
        <div class="b-sub">${esc(cm.tipo_doc)} ${esc(cm.documento || "")} · ${VINCULOS_COM[cm.vinculo] || ""}${cm.telefono ? " · " + esc(cm.telefono) : ""}</div>
        <div class="b-chips"><span class="chip ${cm.estado === "ACTIVO" ? "DISPONIBLE" : "BLOQUEADO"}">${cm.estado === "ACTIVO" ? "Activo" : "Inactivo"}</span></div></div>
      <div class="b-cifras"><div><small>Comisión generada</small><b>${pesos(t.generado)}</b></div><div><small>Pagada</small><b>${pesos(t.pagado)}</b></div>
        <div><small>Por pagar</small><b>${pesos(t.por_pagar)}</b></div></div></div>

    <h2><span>1</span>Datos del comisionista</h2>
    <div class="dos d2"><table class="ficha">
        ${fila("Nombre o razón social", `<b>${esc(cm.nombre)}</b>`)}${fila("Tipo de persona", cm.tipo_persona === "JURIDICA" ? "Jurídica" : "Natural")}
        ${fila("Identificación", `${esc(cm.tipo_doc)} ${esc(cm.documento || "")}`)}${fila("Teléfono", esc(cm.telefono))}${fila("Correo", esc(cm.email))}
        ${fila("Dirección", [cm.direccion, cm.ciudad].filter(Boolean).map(esc).join(", "))}${fila("Vínculo", VINCULOS_COM[cm.vinculo])}
        ${fila("Fecha de ingreso", fecha(cm.fecha_ingreso))}</table>
      <table class="ficha">${fila("Comisión base", pct(cm.porcentaje_defecto))}${fila("Causación", REGLAS_COM[cm.regla_causacion]?.nom)}
        ${fila("Retención en la fuente", pct(cm.retencion_pct))}${fila("Banco", esc(cm.banco))}${fila("Tipo de cuenta", esc(cm.tipo_cuenta))}
        ${fila("N° de cuenta", esc(cm.numero_cuenta))}${fila("Titular", esc(cm.titular_cuenta))}</table></div>

    <h2><span>2</span>Resumen</h2>
    <div class="kpis"><div><small>Ventas activas</small><b>${t.ventas}</b></div><div><small>Valor vendido</small><b>${pesos(t.valor_vendido)}</b></div>
      <div><small>Comisión causada</small><b>${pesos(t.causado)}</b></div><div class="${t.por_pagar ? "malo" : ""}"><small>Saldo por pagar</small><b>${pesos(t.por_pagar)}</b></div></div>
    <div class="avance"><div class="av-txt"><span>Pagado sobre lo generado</span><b>${fmtN1.format(avance)} %</b></div>
      <div class="av-barra"><i style="width:${avance}%"></i></div>
      <div class="av-pie">Generada <b>${pesos(t.generado)}</b> · causada <b>${pesos(t.causado)}</b> · pagada <b>${pesos(t.pagado)}</b>${t.anticipado ? ` · pagada por anticipado <b>${pesos(t.anticipado)}</b>` : ""}</div></div>

    <h2><span>3</span>Detalle de comisiones por venta</h2>
    ${d.comisiones.length ? `<table class="lista"><thead><tr><th>Lote</th><th>Comprador</th><th>Fecha</th><th class="d">Valor venta</th><th class="d">%</th><th class="d">Comisión</th>
        <th class="d">Recaudo</th><th class="d">Causada</th><th class="d">Pagada</th><th class="d">Por pagar</th><th>Estado</th></tr></thead><tbody>
      ${d.comisiones.map((x) => `<tr><td>${x.id_lote}</td><td>${esc(x.cliente)}</td><td>${fecha(x.fecha_venta)}</td><td class="d">${pesos(x.valor_venta)}</td><td class="d">${pct(x.porcentaje)}</td>
        <td class="d">${vivaCom(x) ? pesos(x.valor_comision) : "—"}</td><td class="d">${fmtN1.format(x.pct_recaudo)} %</td><td class="d">${pesos(x.causado)}</td><td class="d">${pesos(x.pagado)}</td>
        <td class="d">${pesos(x.por_pagar)}</td><td>${ESTADOS_COM[x.estado_comision]}</td></tr>`).join("")}
      <tr class="tot"><td colspan="5">Total</td><td class="d">${pesos(t.generado)}</td><td></td><td class="d">${pesos(t.causado)}</td><td class="d">${pesos(t.pagado)}</td><td class="d">${pesos(t.por_pagar)}</td><td></td></tr></tbody></table>`
      : `<p class="nota">Sin ventas asignadas.</p>`}

    <h2><span>4</span>Pagos recibidos</h2>
    ${d.pagos.filter((p) => !p.anulado).length ? `<table class="lista"><thead><tr><th>Comprobante</th><th>Fecha</th><th>Lotes</th><th class="d">Bruto</th><th class="d">Retención</th><th class="d">Neto</th><th>Medio</th><th>Referencia</th></tr></thead><tbody>
      ${d.pagos.filter((p) => !p.anulado).map((p) => `<tr><td>CE ${String(p.comprobante).padStart(6, "0")}</td><td>${fecha(p.fecha)}</td><td>${p.detalle.map((x) => x.id_lote).join(", ")}</td>
        <td class="d">${pesos(p.valor_bruto)}</td><td class="d">${pesos(p.retencion)}</td><td class="d">${pesos(p.valor_neto)}</td><td>${esc(p.medio)}</td><td>${esc(p.referencia || "")}</td></tr>`).join("")}
      </tbody></table>` : `<p class="nota">No se han registrado pagos.</p>`}

    <div class="notas"><h3>Notas</h3><ul>
      ${reglas.map((k) => `<li><b>${REGLAS_COM[k].nom}:</b> ${REGLAS_COM[k].ayuda}</li>`).join("")}
      <li>Las comisiones de ventas desistidas quedan congeladas en lo ya pagado y no generan nuevos valores por pagar.</li>
      <li>Los pagos se soportan con comprobante de egreso firmado por el comisionista. Valores sujetos a la retención en la fuente indicada.</li></ul>
      <div class="firmas" style="margin-top:44px"><div>Elaboró</div><div>${esc(cm.nombre)}<br>${esc(cm.tipo_doc)} ${esc(cm.documento || "")}</div></div>
      <div class="contacto">${esc(c.vendedor_razon_social || c.proyecto)}${c.vendedor_telefono ? ` · Tel. ${esc(c.vendedor_telefono)}` : ""}${c.vendedor_email ? ` · ${esc(c.vendedor_email)}` : ""}</div></div>
  </div>`;
}

function imprimirInformeComisionista(d) {
  const pie = `${E.config.proyecto} · Comisiones · ${d.comisionista.nombre} · Corte ${fecha(hoyISO())}`.replace(/"/g, "'");
  imprimir(`Comisiones ${d.comisionista.nombre}`, htmlInformeComisionista(d), CSS_HOJA.replace("HOJA_PIE", pie));
}

const descargarInformeComisionista = (id, btn) => descargarPDF("comisionista", id, btn);

// Tarjeta del tablero: comisiones por pagar por comisionista
function htmlTarjetaComisiones(r) {
  const cs = (r.comisiones?.comisionistas || []).filter((c) => c.por_pagar > 0.5).sort((a, b) => b.por_pagar - a.por_pagar).slice(0, 8);
  const t = r.comisiones?.totales || {};
  return `<div class="lista">${cs.length ? cs.map((c) => `<div class="it" data-com="${c.id}" style="cursor:pointer">
      <div class="ic" style="background:#F3EEFF;color:#6B36D9"><i data-lucide="user-round"></i></div><div class="q"><div><b>${esc(c.nombre)}</b></div>
      <small>${c.ventas} ventas · pagado ${pesosCorto(c.pagado)}</small></div><div class="v">${pesos(c.por_pagar)}</div></div>`).join("")
    : `<div class="vacio"><i data-lucide="badge-check"></i>No hay comisiones causadas pendientes de pago.</div>`}</div>
    ${t.generado ? `<div class="ley-ayuda" style="padding:8px 0 0">Generadas ${pesosCorto(t.generado)} · pagadas ${pesosCorto(t.pagado)} · por pagar ${pesosCorto(t.por_pagar)}</div>` : ""}`;
}
