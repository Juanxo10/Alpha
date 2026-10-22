/* ==========================================================================
   Cobranza: agenda de cobro, gestiones y compromisos, avisos por WhatsApp/correo, reestructuración de planes.
   ========================================================================== */
"use strict";

const TIPOS_GESTION = { LLAMADA: "Llamada", WHATSAPP: "WhatsApp", CORREO: "Correo", VISITA: "Visita", MENSAJE: "Mensaje de texto" };

// número colombiano para wa.me: 10 dígitos que empiezan por 3 → se antepone 57
function numeroWhatsApp(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("3")) d = "57" + d;
  return d.length >= 11 ? d : "";
}
function mensajeCobro(f) {
  const c = E.config, nom = (f.cliente || "").split(" ")[0];
  const cuenta = c.cuenta_bancaria ? `\nPuede pagar en: ${c.cuenta_bancaria}.` : "";
  const firma = `\n\n${c.vendedor_razon_social || c.proyecto}${c.vendedor_telefono ? " · " + c.vendedor_telefono : ""}`;
  if (f.tipo === "VENCIDA") return `Buen día, ${nom}. Le escribimos de ${c.proyecto}. Su lote ${f.id_lote} presenta un saldo vencido de ${pesos(f.valor)} (${f.dias} días). ¿Nos confirma cuándo podría ponerse al día?${cuenta} Si ya pagó, por favor envíenos el comprobante.${firma}`;
  if (f.tipo === "SEPARACION") return `Buen día, ${nom}. Le recordamos que la separación del lote ${f.id_lote} en ${c.proyecto} vence el ${fecha(f.fecha)}. ¿Seguimos con la compra?${firma}`;
  return `Buen día, ${nom}. Le recordamos que el ${fecha(f.fecha)} vence la cuota de su lote ${f.id_lote} por ${pesos(f.valor)}.${cuenta}${firma}`;
}
function abrirWhatsApp(f) {
  const n = numeroWhatsApp(f.telefono);
  if (!n) { aviso("El comprador no tiene un celular válido registrado.", true); return; }
  window.open(`https://wa.me/${n}?text=${encodeURIComponent(mensajeCobro(f))}`, "_blank");
  formGestion(f, "WHATSAPP", "Mensaje enviado por WhatsApp");
}

// ================================================================== VISTA COBRANZA
async function pintarCobranza() {
  const dias = $("#cobDias")?.value || 15;
  const r = await api("/api/cobranza?dias=" + dias);
  E.cobranza = r;
  const t = r.totales;
  if (!$("#cobDias")) {
    $("#pagCobranza").innerHTML = `<div class="pagina-cab"><div><h1>Cobranza</h1><p>A quién cobrar hoy: cuotas vencidas, separaciones por vencer y cuotas próximas, con sus gestiones y compromisos.</p></div>
        <div class="botones"><a class="btn sec" href="/api/exportar/cobranza.csv"><i data-lucide="file-spreadsheet"></i>Exportar</a></div></div>
      <div class="kpis" id="kpisCob" style="grid-template-columns:repeat(4,1fr)"></div>
      <div class="filtros-tabla"><select id="cobTipo"><option value="">Todo</option><option value="VENCIDA" selected>Vencidas</option><option value="POR_VENCER">Por vencer</option><option value="SEPARACION">Separaciones</option></select>
        <label class="campo-inline">Próximos <select id="cobDias"><option>7</option><option selected>15</option><option>30</option><option>60</option></select> días</label>
        <div class="buscador peq"><i data-lucide="search"></i><input id="cobQ" type="search" placeholder="Lote o comprador…"></div><span class="contador" id="cobN"></span></div>
      <div class="tabla-wrap grande" id="tCob"></div>`;
    iconos();
    $("#cobDias").addEventListener("change", pintarCobranza);
    ["cobTipo", "cobQ"].forEach((k) => $("#" + k).addEventListener("input", pintarTablaCobranza));
  }
  const k = (et, va, sub, col, cls = "") => `<div class="kpi ${cls}" style="--c:${col}"><div class="et">${et}</div><div class="va">${va}</div><div class="sub">${sub}</div></div>`;
  $("#kpisCob").innerHTML = k("Cartera vencida", pesosCorto(t.vencido), `${t.n_vencidas} negocios en mora`, "#DC2626", t.vencido ? "rojo" : "")
    + k("Por vencer", pesosCorto(t.por_vencer), `${t.n_por_vencer} cuotas en ${r.dias} días`, "#3B82F6")
    + k("Compromisos para hoy", fmtN.format(t.compromisos_hoy), `${t.incumplidos} compromisos incumplidos`, "#F5B841", t.incumplidos ? "rojo" : "")
    + k("Gestiones de hoy", fmtN.format(r.gestiones_hoy), "Llamadas, mensajes y visitas", "#17A974");
  pintarTablaCobranza();
}

function pintarTablaCobranza() {
  const r = E.cobranza, tipo = $("#cobTipo").value, q = $("#cobQ").value.toLowerCase();
  const ls = r.filas.filter((f) => (!tipo || f.tipo === tipo) && (!q || `${f.id_lote} ${f.cliente}`.toLowerCase().includes(q)));
  $("#cobN").textContent = `${ls.length} casos`;
  const tipoTxt = { VENCIDA: ["Vencida", "MORA_MAS_90"], POR_VENCER: ["Por vencer", "VENDIDO"], SEPARACION: ["Separación", "SEPARADO"] };
  $("#tCob").innerHTML = ls.length ? `<table class="datos"><thead><tr><th>Situación</th><th>Lote</th><th>Comprador</th><th>Teléfono</th><th>Vence</th><th class="d">Valor</th>
      <th class="d">Días</th><th>Última gestión</th><th>Compromiso</th><th></th></tr></thead><tbody>
    ${ls.map((f, k) => { const g = f.ultima_gestion, cp = f.compromiso; return `<tr data-k="${k}">
      <td><span class="chip ${tipoTxt[f.tipo][1]}">${tipoTxt[f.tipo][0]}</span></td><td><button class="link" data-lote="${f.id_lote}"><b>${f.id_lote}</b></button></td>
      <td>${esc(f.cliente)}</td><td>${esc(f.telefono || "—")}</td><td>${fecha(f.fecha)}</td><td class="d">${f.valor ? pesos(f.valor) : "—"}</td>
      <td class="d">${f.tipo === "VENCIDA" ? `<span class="rojo">${f.dias}</span>` : f.tipo === "POR_VENCER" ? `en ${f.dias}` : f.dias > 0 ? `<span class="rojo">vencida</span>` : ""}</td>
      <td style="white-space:normal;max-width:240px;font-size:12px">${g ? `<b>${TIPOS_GESTION[g.tipo]}</b> ${fecha(g.fecha)}: ${esc(g.resultado)}` : '<span style="color:var(--txt-3)">Sin gestión</span>'}</td>
      <td>${cp ? `<span class="chip ${cp.estado === "INCUMPLIDO" ? "MORA_MAS_90" : cp.estado === "VIGENTE" ? "SEPARADO" : "AL_DIA"}">${fecha(cp.fecha)}${cp.valor ? " · " + pesosCorto(cp.valor) : ""}</span>` : ""}</td>
      <td style="white-space:nowrap"><button class="btn sec peq" data-wa="${k}" title="Escribir por WhatsApp" ${numeroWhatsApp(f.telefono) ? "" : "disabled"}><i data-lucide="message-circle"></i></button>
        ${ALERTAS_ACTIVAS ? "" : "<!--"}<button class="btn sec peq" data-ml="${k}" title="Enviar estado de cuenta por correo" ${f.email ? "" : "disabled"}><i data-lucide="mail"></i></button>${ALERTAS_ACTIVAS ? "" : "-->"}
        <button class="btn sec peq" data-ge="${k}" title="Registrar gestión"><i data-lucide="phone-call"></i></button></td></tr>`; }).join("")}</tbody></table>`
    : `<div class="vacio" style="padding:50px"><i data-lucide="badge-check"></i>No hay casos para este filtro.</div>`;
  iconos();
  $$("#tCob [data-lote]").forEach((b) => b.addEventListener("click", () => irALote(b.dataset.lote)));
  $$("#tCob [data-wa]").forEach((b) => b.addEventListener("click", () => abrirWhatsApp(ls[+b.dataset.wa])));
  $$("#tCob [data-ge]").forEach((b) => b.addEventListener("click", () => formGestion(ls[+b.dataset.ge])));
  $$("#tCob [data-ml]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("/api/cobranza/enviar", { venta_id: ls[+b.dataset.ml].venta_id }); aviso("Estado de cuenta enviado por correo"); pintarCobranza(); } catch (e) { falla(e); }
  }));
}

function formGestion(f, tipo = "LLAMADA", resultado = "") {
  modal(`Gestión de cobro · ${f.id_lote}`, `<p class="texto-modal"><b>${esc(f.cliente)}</b>${f.telefono ? " · " + esc(f.telefono) : ""}${f.valor ? ` · ${f.tipo === "VENCIDA" ? "vencido" : "cuota"} ${pesos(f.valor)}` : ""}</p>
    <div class="form-grid">
      ${campo("", "Tipo de gestión", `<select name="tipo">${Object.entries(TIPOS_GESTION).map(([k, v]) => `<option value="${k}" ${k === tipo ? "selected" : ""}>${v}</option>`).join("")}</select>`)}
      ${campo("", "Fecha", `<input type="date" name="fecha" value="${hoyISO()}">`)}
      ${campo("", "Resultado", `<textarea name="resultado" rows="2" required>${esc(resultado)}</textarea>`, { req: true, cls: "c2" })}
      <div class="form-sec">Compromiso de pago (si lo hubo)</div>
      ${campo("", "Fecha prometida", `<input type="date" name="compromiso_fecha">`)}
      ${campo("", "Valor prometido", inDinero("compromiso_valor", ""))}</div>`, {
    boton: "Registrar gestión",
    enviar: async (x) => {
      await api("/api/cobranza/gestion", { ...x, venta_id: f.venta_id });
      cerrarModal();
      aviso("Gestión registrada");
      if ($("#vista-cobranza").classList.contains("activa")) pintarCobranza();
      if (E.sel) abrirFicha(E.sel, { sinZoom: true });
    },
  });
}

// ------------------------------------------------------------------ pestaña «Cobro» en la ficha del lote
function htmlCobroFicha(d, v) {
  const f = { venta_id: v.id, id_lote: d.lote.id_lote, cliente: v.nombre, telefono: v.telefono, email: v.email,
    tipo: v.vencido > 0.5 ? "VENCIDA" : "POR_VENCER", valor: v.vencido > 0.5 ? v.vencido : v.proxima_cuota?.pendiente,
    dias: v.dias_mora, fecha: v.proxima_cuota?.fecha };
  E.cobroFicha = f;
  return `<div class="f-acciones" style="margin-bottom:12px">
      <button class="btn sec peq" data-cb="wa" ${numeroWhatsApp(v.telefono) ? "" : "disabled"}><i data-lucide="message-circle"></i>WhatsApp</button>
      ${ALERTAS_ACTIVAS ? `<button class="btn sec peq" data-cb="mail" ${v.email ? "" : "disabled"}><i data-lucide="mail"></i>Estado por correo</button>` : ""}
      <button class="btn sec peq" data-cb="ges"><i data-lucide="phone-call"></i>Registrar gestión</button></div>
    ${(v.gestiones || []).length ? v.gestiones.map((g) => `<div class="bit"><span class="p" style="background:#3B82F6"></span><div><b>${TIPOS_GESTION[g.tipo]}</b> · ${esc(g.resultado)}
      ${g.compromiso_fecha ? `<br><span class="chip SEPARADO" style="margin-top:3px">Compromiso: ${fecha(g.compromiso_fecha)}${g.compromiso_valor ? " · " + pesos(g.compromiso_valor) : ""}</span>` : ""}
      <br><span class="q">${fecha(g.fecha)} · ${esc(g.usuario)}</span></div></div>`).join("")
      : `<div class="vacio"><i data-lucide="phone-call"></i>Sin gestiones de cobro registradas.</div>`}`;
}
function enlazarCobroFicha() {
  $$("#stCont [data-cb]").forEach((b) => b.addEventListener("click", async () => {
    const f = E.cobroFicha;
    if (b.dataset.cb === "wa") abrirWhatsApp(f);
    if (b.dataset.cb === "ges") formGestion(f);
    if (b.dataset.cb === "mail") { try { await api("/api/cobranza/enviar", { venta_id: f.venta_id }); aviso("Estado de cuenta enviado"); abrirFicha(E.sel, { sinZoom: true }); } catch (e) { falla(e); } }
  }));
}

// ------------------------------------------------------------------ reestructuración del plan
function formReestructurar(d, v) {
  const cuotaActual = Math.max(0, ...v.plan.filter((x) => x.n > 0).map((x) => x.valor));
  modal(`Reestructurar plan · ${d.lote.id_lote}`, `<p class="texto-modal">Se arma un plan nuevo para el saldo de <b>${pesos(v.saldo)}</b>. Lo pagado se conserva y el plan anterior queda en el historial.</p>
    <div class="form-grid">
      ${campo("", "Forma", `<select name="modo"><option value="manual">Definir número de cuotas</option><option value="plazo">Mantener la cuota y acortar el plazo</option><option value="cuota">Mantener el plazo y bajar la cuota</option></select>`, { cls: "c2" })}
      ${campo("", "Número de cuotas", `<input type="number" name="n_cuotas" min="1" max="360" value="${v.cuotas_total - v.cuotas_pagadas || 12}">`)}
      ${campo("", "Fecha de la primera cuota", `<input type="date" name="fecha_primera" value="${v.proxima_cuota?.fecha || sumarMeses(hoyISO(), 1)}">`)}
      ${campo("", "Motivo", `<input name="motivo" required placeholder="Acuerdo de pago, abono extraordinario…">`, { req: true, cls: "c2" })}
      <div class="resumen-plan" id="resReest" style="grid-template-columns:repeat(3,1fr)"></div></div>`, {
    boton: "Reestructurar",
    enviar: async (x) => {
      const r = await api("/api/venta/reestructurar", { ...x, venta_id: v.id });
      await trasGuardar(`Plan reestructurado: ${r.n_cuotas} cuotas de ${pesos(r.cuota)}`);
    },
  });
  const calc = () => {
    const modo = $("[name=modo]").value;
    const n = modo === "plazo" ? Math.ceil(v.saldo / cuotaActual) : modo === "cuota" ? Math.max(1, v.cuotas_total - v.cuotas_pagadas) : (+$("[name=n_cuotas]").value || 1);
    $("[name=n_cuotas]").disabled = modo !== "manual";
    $("#resReest").innerHTML = `<div><div class="et">Saldo</div><div class="va">${pesos(v.saldo)}</div></div>
      <div><div class="et">Cuotas</div><div class="va">${n}</div></div><div><div class="et">Valor cuota</div><div class="va">${pesos(v.saldo / n)}</div></div>`;
  };
  $$("[name=modo],[name=n_cuotas]").forEach((i) => i.addEventListener("input", calc));
  calc();
}
