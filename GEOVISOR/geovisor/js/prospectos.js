/* ==========================================================================
   Prospectos: interesados, seguimiento comercial y embudo de ventas.
   ========================================================================== */
"use strict";

const EST_PROS = { NUEVO: ["Nuevo", "#94A3B8"], CONTACTADO: ["Contactado", "#3B82F6"], VISITA: ["Visita al lote", "#8B5CF6"],
  NEGOCIACION: ["En negociación", "#F5B841"], GANADO: ["Compró", "#17A974"], PERDIDO: ["Perdido", "#DC2626"] };

async function pintarProspectos() {
  const r = await api("/api/prospectos");
  E.prospectos = r;
  if (!$("#prQ")) {
    $("#pagProspectos").innerHTML = `<div class="pagina-cab"><div><h1>Prospectos</h1><p>Interesados en comprar: seguimiento, cotizaciones y conversión en ventas.</p></div>
        <div class="botones"><a class="btn sec" href="/api/exportar/prospectos.csv"><i data-lucide="file-spreadsheet"></i>Exportar</a>
        <button class="btn pri" id="btnNuevoPr"><i data-lucide="user-plus"></i>Nuevo prospecto</button></div></div>
      <div class="kpis" id="kpisPr" style="grid-template-columns:repeat(4,1fr)"></div>
      <div class="filtros-tabla"><div class="buscador peq"><i data-lucide="search"></i><input id="prQ" type="search" placeholder="Nombre, teléfono, lote…"></div>
        <label class="interruptor"><input type="checkbox" id="prCerrados"><span></span>Ver comprados y perdidos</label></div>
      <div class="kanban" id="kanban"></div>`;
    iconos();
    $("#btnNuevoPr").addEventListener("click", () => formProspecto());
    ["prQ", "prCerrados"].forEach((k) => $("#" + k).addEventListener("input", pintarKanban));
  }
  const k = (et, va, sub, col, cls = "") => `<div class="kpi ${cls}" style="--c:${col}"><div class="et">${et}</div><div class="va">${va}</div><div class="sub">${sub}</div></div>`;
  const activos = r.prospectos.filter((p) => !["GANADO", "PERDIDO"].includes(p.estado)).length;
  $("#kpisPr").innerHTML = k("Prospectos activos", fmtN.format(activos), `${r.prospectos.length} registrados`, "#3B82F6")
    + k("Seguimientos para hoy", fmtN.format(r.seguimientos_hoy), "Llamar o visitar hoy", "#F5B841")
    + k("Seguimientos atrasados", fmtN.format(r.atrasados), "Fecha de contacto vencida", "#DC2626", r.atrasados ? "rojo" : "")
    + k("Conversión", r.conversion === null ? "—" : `${fmtN1.format(r.conversion)} %`, `${r.embudo.GANADO} compraron · ${r.embudo.PERDIDO} perdidos`, "#17A974");
  pintarKanban();
}

function pintarKanban() {
  const r = E.prospectos, q = $("#prQ").value.toLowerCase(), cerr = $("#prCerrados").checked;
  const cols = Object.keys(EST_PROS).filter((e) => cerr || !["GANADO", "PERDIDO"].includes(e));
  $("#kanban").style.gridTemplateColumns = `repeat(${cols.length}, minmax(220px, 1fr))`;
  $("#kanban").innerHTML = cols.map((e) => {
    const ps = r.prospectos.filter((p) => p.estado === e && (!q || `${p.nombre} ${p.telefono || ""} ${p.lotes_interes || ""}`.toLowerCase().includes(q)));
    return `<div class="kb-col"><div class="kb-cab" style="--c:${EST_PROS[e][1]}">${EST_PROS[e][0]}<span>${ps.length}</span></div>
      ${ps.map((p) => `<div class="kb-card ${p.atrasado ? "atrasado" : ""}" data-id="${p.id}"><b>${esc(p.nombre)}</b>
        <small>${esc(p.telefono || p.email || "")}${p.origen ? " · " + esc(p.origen) : ""}</small>
        ${p.lotes_interes ? `<small>Interés: ${esc(p.lotes_interes)}</small>` : ""}
        ${p.fecha_proxima && !["GANADO", "PERDIDO"].includes(p.estado) ? `<span class="kb-prox"><i data-lucide="calendar"></i>${fecha(p.fecha_proxima)} ${esc(p.proxima_accion || "")}</span>` : ""}
        ${p.comisionista ? `<small>Asesor: ${esc(p.comisionista)}</small>` : ""}</div>`).join("") || `<div class="kb-vacio">—</div>`}</div>`;
  }).join("");
  iconos();
  $$("#kanban .kb-card").forEach((c) => c.addEventListener("click", () => abrirProspecto(+c.dataset.id)));
}

async function formProspecto(p = {}) {
  const cms = await comisionistasActivos();
  modal(p.id ? `Editar · ${p.nombre}` : "Nuevo prospecto", `<div class="form-grid">
      ${campo("", "Nombre", `<input name="nombre" required value="${esc(p.nombre || "")}">`, { req: true, cls: "c2" })}
      ${campo("", "Celular", `<input name="telefono" value="${esc(p.telefono || "")}">`)} ${campo("", "Correo", `<input name="email" type="email" value="${esc(p.email || "")}">`)}
      ${campo("", "¿Cómo llegó?", `<select name="origen"><option value="">—</option>${E.prospectos.origenes.map((o) => `<option ${o === p.origen ? "selected" : ""}>${o}</option>`).join("")}</select>`)}
      ${campo("", "Comisionista / asesor", `<select name="comisionista_id"><option value="">—</option>${cms.map((c) => `<option value="${c.id}" ${c.id === p.comisionista_id ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select>`)}
      ${campo("", "Lotes o manzanas de interés", `<input name="lotes_interes" value="${esc(p.lotes_interes || "")}" placeholder="MZ05, esquineros…">`)}
      ${campo("", "Presupuesto aproximado", inDinero("presupuesto", p.presupuesto || ""))}
      ${campo("", "Próximo seguimiento", `<input type="date" name="fecha_proxima" value="${p.fecha_proxima || sumarDias(hoyISO(), 2)}">`)}
      ${campo("", "Acción", `<input name="proxima_accion" value="${esc(p.proxima_accion || "Llamar")}">`)}
      ${campo("", "Notas", `<textarea name="notas" rows="2">${esc(p.notas || "")}</textarea>`, { cls: "c2" })}</div>`, {
    ancho: true, boton: p.id ? "Guardar" : "Registrar prospecto",
    enviar: async (x) => { const r = await api("/api/prospecto/guardar", { ...x, id: p.id }); cerrarModal(); aviso("Prospecto guardado"); await pintarProspectos(); abrirProspecto(r.id); },
  });
}

function abrirProspecto(id) {
  const p = E.prospectos.prospectos.find((x) => x.id === id);
  const cerrado = ["GANADO", "PERDIDO"].includes(p.estado);
  modal(p.nombre, `<div class="com-id" style="margin-bottom:10px"><span class="chip" style="background:${EST_PROS[p.estado][1]}22;color:${EST_PROS[p.estado][1]}">${EST_PROS[p.estado][0]}</span>
      <span>${esc(p.telefono || "")}${p.email ? " · " + esc(p.email) : ""}${p.origen ? " · " + esc(p.origen) : ""}</span></div>
    <dl class="dl" style="margin-bottom:12px"><dt>Interés</dt><dd>${esc(p.lotes_interes || "—")}</dd><dt>Presupuesto</dt><dd>${p.presupuesto ? pesos(p.presupuesto) : "—"}</dd>
      <dt>Asesor</dt><dd>${esc(p.comisionista || "—")}</dd><dt>Próximo paso</dt><dd>${p.fecha_proxima ? fecha(p.fecha_proxima) + " · " + esc(p.proxima_accion || "") : "—"}</dd>
      ${p.motivo_perdida ? `<dt>Motivo de pérdida</dt><dd>${esc(p.motivo_perdida)}</dd>` : ""}${p.notas ? `<dt>Notas</dt><dd style="font-weight:400">${esc(p.notas)}</dd>` : ""}</dl>
    ${cerrado ? "" : `<div class="form-grid" style="margin-bottom:10px"><div class="form-sec">Registrar seguimiento</div>
      ${campo("", "Nota", `<input name="nota" placeholder="Qué se habló…">`, { cls: "c2" })}
      ${campo("", "Próximo seguimiento", `<input type="date" name="fecha_proxima" value="${sumarDias(hoyISO(), 3)}">`)}
      ${campo("", "Acción", `<input name="proxima_accion" value="Llamar">`)}
      ${campo("", "Mover a", `<select name="estado">${Object.entries(EST_PROS).filter(([k]) => k !== "GANADO").map(([k, [n]]) => `<option value="${k}" ${k === p.estado ? "selected" : ""}>${n}</option>`).join("")}</select>`)}
      ${campo("", "Motivo (si se perdió)", `<input name="motivo">`)}</div>`}
    <div class="bloque-tit" style="margin:6px 0">Historial</div>
    ${p.notas.length ? p.notas.map((n) => `<div class="bit"><span class="p"></span><div>${esc(n.nota)}<br><span class="q">${fecha(n.fecha)} · ${esc(n.usuario)}</span></div></div>`).join("")
      : `<div class="ley-ayuda">Sin seguimientos.</div>`}`, {
    ancho: true, boton: cerrado ? null : "Guardar seguimiento",
    extraPie: `<button type="button" class="btn sec" id="prEditar"><i data-lucide="pencil"></i>Editar</button>
      ${cerrado ? "" : `<button type="button" class="btn sec" id="prCotizar"><i data-lucide="calculator"></i>Cotizar lote</button>
      <button type="button" class="btn sec" id="prWa" ${numeroWhatsApp(p.telefono) ? "" : "disabled"}><i data-lucide="message-circle"></i>WhatsApp</button>
      <button type="button" class="btn acento" id="prVender"><i data-lucide="file-signature"></i>Convertir en venta</button>`}`,
    enviar: cerrado ? null : async (x) => {
      if (x.nota) await api("/api/prospecto/nota", { prospecto_id: id, nota: x.nota, fecha_proxima: x.fecha_proxima, proxima_accion: x.proxima_accion });
      if (x.estado !== p.estado) await api("/api/prospecto/estado", { id, estado: x.estado, motivo: x.motivo });
      cerrarModal();
      aviso("Seguimiento guardado");
      pintarProspectos();
    },
  });
  $("#prEditar").addEventListener("click", () => formProspecto(p));
  $("#prWa")?.addEventListener("click", () => window.open(`https://wa.me/${numeroWhatsApp(p.telefono)}?text=${encodeURIComponent(`Buen día, ${p.nombre.split(" ")[0]}. Le escribimos de ${E.config.proyecto}.`)}`, "_blank"));
  $("#prCotizar")?.addEventListener("click", () => elegirLote("Cotizar para " + p.nombre, (id_lote) => formCotizacion(id_lote, p)));
  $("#prVender")?.addEventListener("click", () => elegirLote("Lote que compra " + p.nombre, async (id_lote) => {
    const d = await api("/api/lote?id=" + id_lote);
    E.prospectoVenta = p;
    formVenta(d, d.ventas.find((v) => v.estado === "ACTIVA"));
  }));
  iconos();
}

function elegirLote(titulo, alElegir) {
  const libres = E.lotes.filter((l) => l.estado === "DISPONIBLE");
  modal(titulo, `<div class="form-grid">${campo("", "Lote disponible", `<input name="lote" list="dlLotes" placeholder="MZ05-L012" required>
      <datalist id="dlLotes">${libres.map((l) => `<option value="${l.id_lote}">${m2(l.area_m2)} · ${l.precio_lista ? pesos(l.precio_lista) : "sin precio"}</option>`).join("")}</datalist>`, { cls: "c2", ayuda: `${libres.length} lotes disponibles` })}</div>`, {
    boton: "Continuar",
    enviar: async (x) => {
      const id = (x.lote || "").trim().toUpperCase();
      if (!E.porId[id] || E.porId[id].estado !== "DISPONIBLE") throw new Error("Escriba el código de un lote disponible.");
      alElegir(id);
    },
  });
}
