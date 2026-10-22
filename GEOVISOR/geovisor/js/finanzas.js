/* ==========================================================================
   Finanzas: gastos con comprobante de egreso, presupuesto, flujo de caja y conciliación bancaria.
   ========================================================================== */
"use strict";

// ================================================================== GASTOS
async function pintarGastos() {
  const r = await api("/api/gastos");
  E.categorias = r.categorias;
  const q = ($("#gBuscar")?.value || "").toLowerCase(), cat = $("#gCat")?.value || "", anul = $("#gAnul")?.checked;
  if (!$("#gBuscar")) {
    $("#pagGastos").innerHTML = `<div class="pagina-cab"><div><h1>Gastos del proyecto</h1><p>Todo egreso queda con comprobante (CE) consecutivo, el mismo de los pagos de comisión.</p></div>
        <div class="botones"><a class="btn sec" href="/api/exportar/gastos.csv"><i data-lucide="file-spreadsheet"></i>Exportar</a>
        <button class="btn sec" id="btnPresup"><i data-lucide="calculator"></i>Presupuesto</button>
        <button class="btn pri" id="btnGasto"><i data-lucide="plus"></i>Registrar gasto</button></div></div>
      <div class="kpis" id="kpisGastos" style="grid-template-columns:repeat(4,1fr)"></div>
      <div class="filtros-tabla"><div class="buscador peq"><i data-lucide="search"></i><input id="gBuscar" type="search" placeholder="Proveedor, descripción, CE…"></div>
        <select id="gCat"><option value="">Todas las categorías</option>${r.categorias.map((c) => `<option>${c}</option>`).join("")}</select>
        <label class="interruptor"><input type="checkbox" id="gAnul"><span></span>Ver anulados</label><span class="contador" id="gN"></span></div>
      <div class="tabla-wrap grande" id="tGastos"></div>`;
    iconos();
    $("#btnGasto").addEventListener("click", formGasto);
    $("#btnPresup").addEventListener("click", formPresupuesto);
    ["gBuscar", "gCat", "gAnul"].forEach((k) => $("#" + k).addEventListener("input", pintarGastos));
  }
  const vivos = r.gastos.filter((g) => !g.anulado);
  const mes = hoyISO().slice(0, 7);
  const k = (et, va, sub, col) => `<div class="kpi" style="--c:${col}"><div class="et">${et}</div><div class="va">${va}</div><div class="sub">${sub}</div></div>`;
  $("#kpisGastos").innerHTML = k("Gastos acumulados", pesosCorto(vivos.reduce((s, g) => s + g.valor_bruto, 0)), `${vivos.length} comprobantes`, "#DC2626")
    + k("Gastos del mes", pesosCorto(vivos.filter((g) => g.fecha.startsWith(mes)).reduce((s, g) => s + g.valor_bruto, 0)), MESES_L[new Date().getMonth()], "#F5B841")
    + k("Retenciones practicadas", pesosCorto(vivos.reduce((s, g) => s + g.retencion, 0)), "Por declarar y pagar", "#8B5CF6")
    + k("Mayor categoría", (() => { const t = {}; vivos.forEach((g) => { t[g.categoria] = (t[g.categoria] || 0) + g.valor_bruto; });
      const m = Object.entries(t).sort((a, b) => b[1] - a[1])[0]; return m ? pesosCorto(m[1]) : "—"; })(),
    (() => { const t = {}; vivos.forEach((g) => { t[g.categoria] = (t[g.categoria] || 0) + g.valor_bruto; }); const m = Object.entries(t).sort((a, b) => b[1] - a[1])[0]; return m ? m[0] : "Sin gastos"; })(), "#0C2E37");
  const ls = r.gastos.filter((g) => (anul || !g.anulado) && (!cat || g.categoria === cat)
    && (!q || `${g.comprobante} ${g.proveedor} ${g.descripcion} ${g.factura || ""}`.toLowerCase().includes(q)));
  $("#gN").textContent = `${ls.length} gastos · ${pesos(ls.filter((g) => !g.anulado).reduce((s, g) => s + g.valor_bruto, 0))}`;
  $("#tGastos").innerHTML = ls.length ? `<table class="datos"><thead><tr><th>CE</th><th>Fecha</th><th>Categoría</th><th>Proveedor</th><th>Descripción</th><th>Factura</th>
      <th class="d">Valor</th><th class="d">Retención</th><th class="d">Neto pagado</th><th>Medio</th><th>Conc.</th><th></th></tr></thead><tbody>
    ${ls.map((g) => `<tr class="${g.anulado ? "anulado" : ""}"><td class="num"><b>CE ${String(g.comprobante).padStart(6, "0")}</b></td><td>${fecha(g.fecha)}</td>
      <td>${esc(g.categoria)}</td><td>${esc(g.proveedor)}</td><td style="white-space:normal;max-width:280px">${esc(g.descripcion)}</td><td>${esc(g.factura || "")}</td>
      <td class="d">${pesos(g.valor_bruto)}</td><td class="d">${g.retencion ? pesos(g.retencion) : "—"}</td><td class="d">${pesos(g.valor_neto)}</td>
      <td>${esc(g.medio)}</td><td>${g.conciliado ? "✓" : ""}</td>
      <td style="text-decoration:none;white-space:nowrap">${g.anulado ? `<span class="chip ANULADO" title="${esc(g.motivo_anulacion)}">Anulado</span>`
        : `<button class="link" data-ce="${g.comprobante}" title="Imprimir"><i data-lucide="printer"></i></button>
           <button class="link rojo" data-an="${g.id}" data-info="CE ${String(g.comprobante).padStart(6, "0")} · ${pesos(g.valor_bruto)}" title="Anular"><i data-lucide="ban"></i></button>`}</td></tr>`).join("")}</tbody></table>`
    : `<div class="vacio" style="padding:50px"><i data-lucide="receipt"></i>No hay gastos registrados.</div>`;
  iconos();
  $$("#tGastos [data-ce]").forEach((b) => b.addEventListener("click", () => imprimirEgreso(+b.dataset.ce)));
  $$("#tGastos [data-an]").forEach((b) => b.addEventListener("click", () => modal("Anular gasto", `<p class="texto-modal">Se anulará el <b>${esc(b.dataset.info)}</b>; el número se conserva.</p>
    <div class="form-grid">${campo("", "Motivo", `<input name="motivo" required>`, { req: true, cls: "c2" })}</div>`, {
    boton: "Anular", peligro: true,
    enviar: async (x) => { await api("/api/gasto/anular", { id: +b.dataset.an, motivo: x.motivo }); cerrarModal(); aviso("Gasto anulado"); pintarGastos(); } })));
}

function formGasto() {
  modal("Registrar gasto", `<div class="form-grid">
      ${campo("", "Fecha", `<input type="date" name="fecha" value="${hoyISO()}" required>`, { req: true })}
      ${campo("", "Categoría", `<select name="categoria">${(E.categorias || []).map((c) => `<option>${c}</option>`).join("")}</select>`)}
      ${campo("", "Proveedor o beneficiario", `<input name="proveedor" required>`, { req: true })}
      ${campo("", "NIT / documento", `<input name="documento_proveedor">`)}
      ${campo("", "Descripción", `<input name="descripcion" required>`, { req: true, cls: "c2" })}
      ${campo("", "N° de factura o cuenta de cobro", `<input name="factura">`)}
      ${campo("", "Medio de pago", sel("medio", MEDIOS, "Transferencia"))}
      ${campo("", "Valor total", inDinero("valor_bruto", "", "required"), { req: true })}
      ${campo("", "Retención practicada", inDinero("retencion", ""), { ayuda: "Si se retuvo al proveedor (ej. retención en la fuente)." })}
      ${campo("", "Referencia / comprobante bancario", `<input name="referencia">`, { cls: "c2" })}
      <div class="resumen-plan" id="resGasto" style="grid-template-columns:repeat(3,1fr)"></div></div>
    ${esDueno() ? "" : `<div class="alerta-caja aviso" style="margin-top:12px"><i data-lucide="shield-alert"></i><div>Los gastos registrados por un operador quedan <b>pendientes de aprobación</b>.</div></div>`}`, {
    ancho: true, boton: "Registrar y generar comprobante",
    enviar: async (x) => {
      const r = await api("/api/gasto", x);
      cerrarModal();
      aviso(`Gasto registrado · CE ${String(r.comprobante).padStart(6, "0")}`);
      pintarGastos();
      imprimirEgreso(r.comprobante);
    },
  });
  const calc = () => { const b = valorDinero($("[name=valor_bruto]").value), r = valorDinero($("[name=retencion]").value);
    $("#resGasto").innerHTML = `<div><div class="et">Valor</div><div class="va">${pesos(b)}</div></div><div><div class="et">Retención</div><div class="va">${pesos(r)}</div></div>
      <div><div class="et">Neto a pagar</div><div class="va">${pesos(b - r)}</div></div>`; };
  $$("[name=valor_bruto],[name=retencion]").forEach((i) => i.addEventListener("input", calc));
  calc();
}

async function formPresupuesto() {
  const f = await api("/api/flujo");
  modal("Presupuesto de gastos del proyecto", `<p class="texto-modal">Lo presupuestado por categoría se compara con lo ejecutado en el flujo de caja y alimenta el resultado proyectado.</p>
    <table class="mini-tabla"><thead><tr><th>Categoría</th><th class="d">Ejecutado</th><th class="d" style="width:200px">Presupuesto</th></tr></thead><tbody>
    ${f.presupuesto.map((p) => `<tr><td>${esc(p.categoria)}</td><td class="d">${pesos(p.ejecutado)}</td>
      <td class="d"><div class="input-dinero"><input class="dinero" data-cat="${esc(p.categoria)}" value="${Math.round(p.presupuesto) || ""}" inputmode="numeric"></div></td></tr>`).join("")}</tbody></table>`, {
    ancho: true, boton: "Guardar presupuesto",
    enviar: async () => {
      const valores = Object.fromEntries($$("#modalCuerpo [data-cat]").map((i) => [i.dataset.cat, valorDinero(i.value)]));
      await api("/api/presupuesto", { valores });
      cerrarModal();
      aviso("Presupuesto guardado");
      if ($("#vista-flujo").classList.contains("activa")) pintarFlujo();
    },
  });
}

async function imprimirEgreso(n) {
  let r;
  try { r = await api("/api/egreso?n=" + n); } catch (e) { falla(e); return; }
  if (r.tipo === "comision") return imprimirComprobante(n);
  const g = r.gasto, num = `CE ${String(g.comprobante).padStart(6, "0")}`;
  imprimir(`Comprobante de egreso ${num}`, `<div class="recibo">${g.anulado ? `<div class="anulado">ANULADO</div>` : ""}
    ${cabecera("COMPROBANTE DE EGRESO", num, `Fecha: ${fechaLarga(g.fecha)}`)}
    <div class="caja">
      <div class="fila"><span>Pagado a</span><b>${esc(g.proveedor)}</b></div>
      <div class="fila"><span>NIT / documento</span><b>${esc(g.documento_proveedor || "—")}</b></div>
      <div class="fila"><span>Concepto</span><b>${esc(g.descripcion)}</b></div>
      <div class="fila"><span>Categoría</span><b>${esc(g.categoria)}</b></div>
      ${g.factura ? `<div class="fila"><span>Factura / cuenta de cobro</span><b>${esc(g.factura)}</b></div>` : ""}
      <div class="fila"><span>Medio de pago</span><b>${esc(g.medio)}${g.referencia ? " · Ref. " + esc(g.referencia) : ""}</b></div></div>
    <table><tbody><tr class="tot"><td>Valor bruto</td><td class="d">${pesos(g.valor_bruto)}</td></tr>
      <tr><td>Retención practicada</td><td class="d">− ${pesos(g.retencion)}</td></tr></tbody></table>
    <div class="valor" style="margin-top:12px"><span>NETO PAGADO</span><span class="num">${pesos(g.valor_neto)}</span></div>
    <div class="letras">Son: ${numeroALetras(g.valor_neto)}</div>
    <div class="firmas" style="margin-top:56px"><div>Elaboró${g.usuario ? `: ${esc(g.usuario)}` : ""}</div><div>Aprobó</div><div>Recibí conforme</div></div>
    <div class="pie">Generado el ${fecha(hoyISO())}</div></div>`);
}

// ================================================================== FLUJO DE CAJA
async function pintarFlujo() {
  const f = await api("/api/flujo");
  const i = f.indicadores;
  const k = (et, va, sub, col, cls = "") => `<div class="kpi ${cls}" style="--c:${col}"><div class="et">${et}</div><div class="va">${va}</div><div class="sub">${sub}</div></div>`;
  const reales = f.meses.filter((m) => m.real), futuros = f.meses.filter((m) => m.mes >= f.mes_actual);
  $("#pagFlujo").innerHTML = `<div class="pagina-cab"><div><h1>Flujo de caja y resultado del proyecto</h1>
      <p>Lo que entró y salió mes a mes, lo que falta por recaudar según los planes de pago y el resultado esperado.</p></div>
      <div class="botones"><a class="btn sec" href="/api/exportar/flujo.csv"><i data-lucide="file-spreadsheet"></i>Exportar</a>
      <button class="btn sec" id="btnPresup2"><i data-lucide="calculator"></i>Presupuesto</button></div></div>
    <div class="kpis">${k("Ingresos recaudados", pesosCorto(i.ingresos), "Pagos de compradores", "#17A974")}
      ${k("Egresos", pesosCorto(i.egresos), `Gastos y comisiones (${pesosCorto(i.egresos_comisiones)})`, "#DC2626")}
      ${k("Caja del proyecto", pesosCorto(i.caja), "Ingresos − egresos", "#0C2E37", i.caja < 0 ? "rojo" : "")}
      ${k("Por recaudar", pesosCorto(i.por_recaudar), `${pesosCorto(f.vencido_por_recaudar)} ya vencido`, "#3B82F6")}
      ${k("Inventario a precio de lista", pesosCorto(i.inventario), "Lotes disponibles", "#5CE9AB")}
      ${k("Resultado proyectado", pesosCorto(i.resultado_proyectado), "Si se vende y recauda todo", "#8B5CF6", i.resultado_proyectado < 0 ? "rojo" : "")}</div>
    <div class="grilla-tablero" style="grid-template-columns:2fr 1fr">
      <div class="tarjeta"><h3>Ingresos y egresos por mes · recaudo proyectado</h3><div id="gFlujo"></div>
        <div class="dona-ley" style="flex-direction:row;gap:18px;margin-top:8px"><div><i style="background:#17A974"></i>Ingresos</div><div><i style="background:#DC2626"></i>Egresos</div>
          <div><i style="background:#A7C4F2"></i>Recaudo proyectado</div><div><i style="background:#0C2E37;height:3px"></i>Caja acumulada</div></div></div>
      <div class="tarjeta"><h3>Cómo se calcula el resultado</h3><table class="mini-tabla"><tbody>
        <tr><td>Recaudado a la fecha</td><td class="d">${pesos(i.ingresos)}</td></tr><tr><td>+ Por recaudar (planes de pago)</td><td class="d">${pesos(i.por_recaudar)}</td></tr>
        <tr><td>+ Inventario a precio de lista</td><td class="d">${pesos(i.inventario)}</td></tr><tr><td>− Egresos ejecutados</td><td class="d">${pesos(i.egresos)}</td></tr>
        <tr><td>− Presupuesto por ejecutar</td><td class="d">${pesos(i.presupuesto_pendiente)}</td></tr><tr><td>− Comisiones por pagar</td><td class="d">${pesos(i.comisiones_pendientes)}</td></tr>
        <tr style="font-weight:700"><td>= Resultado proyectado</td><td class="d">${pesos(i.resultado_proyectado)}</td></tr></tbody></table>
        <div class="ley-ayuda" style="padding:8px 0 0">Para que sea fiel, registre todos los gastos y cargue el presupuesto pendiente de obra.</div></div>
      <div class="tarjeta ancha"><h3>Presupuesto vs. ejecutado</h3><div id="tPresup"></div></div>
      <div class="tarjeta ancha"><h3>Detalle mensual</h3><div class="tabla-wrap"><table class="datos"><thead><tr><th>Mes</th><th class="d">Ingresos</th><th class="d">Egresos</th>
        <th class="d">Neto</th><th class="d">Caja acumulada</th><th class="d">Recaudo proyectado</th></tr></thead><tbody>
        ${f.meses.filter((m) => m.real || m.proyectado).map((m) => `<tr${m.mes === f.mes_actual ? ' style="font-weight:700"' : ""}><td>${MESES[+m.mes.slice(5) - 1]} ${m.mes.slice(0, 4)}${m.mes === f.mes_actual ? " (actual)" : ""}</td>
          <td class="d">${m.real ? pesos(m.ingresos) : "—"}</td><td class="d">${m.real ? pesos(m.egresos) : "—"}</td><td class="d">${m.real ? pesos(m.neto) : "—"}</td>
          <td class="d">${m.real ? pesos(m.acumulado) : "—"}</td><td class="d">${m.proyectado ? pesos(m.proyectado) : "—"}</td></tr>`).join("")}</tbody></table></div></div></div>`;
  iconos();
  $("#btnPresup2").addEventListener("click", formPresupuesto);
  // gráfico: barras de ingresos/egresos (reales) y proyectado (futuro) + línea de caja acumulada
  const ms = [...reales.slice(-12), ...futuros.filter((m) => m.mes > f.mes_actual).slice(0, 12)];
  const W = 900, H = 230, pad = 34, bw = (W - pad) / Math.max(ms.length, 1);
  const mx = Math.max(1, ...ms.map((m) => Math.max(m.ingresos, m.egresos, m.proyectado)));
  const accs = ms.map((m) => m.real ? m.acumulado : null);
  const amx = Math.max(1, ...accs.filter((x) => x !== null).map(Math.abs));
  const y = (v) => H - (v / mx) * (H - 20);
  const ya = (v) => H - ((v + amx) / (2 * amx)) * (H - 20);
  let linea = "";
  accs.forEach((v, k) => { if (v !== null) linea += `${linea ? "L" : "M"}${pad + k * bw + bw / 2},${ya(v)}`; });
  $("#gFlujo").innerHTML = `<svg viewBox="0 0 ${W} ${H + 28}" width="100%" class="barras">
    ${[0.25, 0.5, 0.75, 1].map((g) => `<line x1="${pad}" x2="${W}" y1="${y(mx * g)}" y2="${y(mx * g)}" stroke="#EBF0F1"/>`).join("")}
    ${ms.map((m, k) => { const x = pad + k * bw; return m.real
      ? `<rect x="${x + 4}" y="${y(m.ingresos)}" width="${bw / 2 - 5}" height="${H - y(m.ingresos)}" rx="2" fill="#17A974"><title>${m.mes} ingresos ${pesos(m.ingresos)}</title></rect>
         <rect x="${x + bw / 2 + 1}" y="${y(m.egresos)}" width="${bw / 2 - 5}" height="${H - y(m.egresos)}" rx="2" fill="#DC2626"><title>${m.mes} egresos ${pesos(m.egresos)}</title></rect>`
      : `<rect x="${x + 6}" y="${y(m.proyectado)}" width="${bw - 12}" height="${H - y(m.proyectado)}" rx="2" fill="#A7C4F2"><title>${m.mes} proyectado ${pesos(m.proyectado)}</title></rect>`; }).join("")}
    <path d="${linea}" fill="none" stroke="#0C2E37" stroke-width="2.5"/>
    ${ms.map((m, k) => `<text x="${pad + k * bw + bw / 2}" y="${H + 18}" text-anchor="middle">${MESES[+m.mes.slice(5) - 1]}${m.mes.slice(5) === "01" ? " " + m.mes.slice(2, 4) : ""}</text>`).join("")}
    <line x1="${pad + reales.slice(-12).length * bw}" x2="${pad + reales.slice(-12).length * bw}" y1="0" y2="${H}" stroke="#82959A" stroke-dasharray="4 3"/>
    <text x="${pad + reales.slice(-12).length * bw + 4}" y="12">proyección →</text></svg>`;
  const pr = f.presupuesto.filter((p) => p.presupuesto || p.ejecutado);
  $("#tPresup").innerHTML = pr.length ? `<table class="datos"><thead><tr><th>Categoría</th><th class="d">Presupuesto</th><th class="d">Ejecutado</th><th style="width:240px">Avance</th><th class="d">Por ejecutar</th></tr></thead><tbody>
    ${pr.map((p) => { const a = p.presupuesto ? Math.min((100 * p.ejecutado) / p.presupuesto, 999) : null; return `<tr><td>${esc(p.categoria)}</td><td class="d">${p.presupuesto ? pesos(p.presupuesto) : "—"}</td>
      <td class="d">${pesos(p.ejecutado)}</td><td>${a === null ? `<span class="ley-ayuda" style="padding:0">Sin presupuesto</span>` : `<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:7px;border-radius:4px;background:#EEF2F3;overflow:hidden">
        <div style="height:100%;width:${Math.min(a, 100)}%;background:${a > 100 ? "#DC2626" : "#17A974"}"></div></div><span class="num" style="font-size:12px;width:44px;text-align:right">${fmtN.format(a)}%</span></div>`}</td>
      <td class="d">${p.presupuesto ? pesos(Math.max(p.presupuesto - p.ejecutado, 0)) : "—"}</td></tr>`; }).join("")}</tbody></table>`
    : `<div class="vacio"><i data-lucide="calculator"></i>Cargue el presupuesto de obra y gastos con el botón «Presupuesto».</div>`;
  iconos();
}

// ================================================================== CONCILIACIÓN
async function pintarConciliacion() {
  const r = await api("/api/conciliacion");
  $("#pagConc").innerHTML = `<div class="pagina-cab"><div><h1>Conciliación bancaria</h1>
      <p>Cargue el extracto del banco (CSV o Excel guardado como CSV). El sistema cruza cada movimiento con los recibos, gastos y pagos de comisión registrados.</p></div></div>
    <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi" style="--c:#17A974"><div class="et">Recibos conciliados</div><div class="va">${fmtN.format(r.pagos_conciliados)}</div><div class="sub">Confirmados contra el banco</div></div>
      <div class="kpi ${r.pagos_pendientes ? "rojo" : ""}" style="--c:#F5B841"><div class="et">Recibos por conciliar</div><div class="va">${fmtN.format(r.pagos_pendientes)}</div><div class="sub">Transferencias y consignaciones</div></div>
      <div class="kpi" style="--c:#DC2626"><div class="et">Egresos por conciliar</div><div class="va">${fmtN.format(r.egresos_pendientes)}</div><div class="sub">Gastos y comisiones no en efectivo</div></div></div>
    <div class="tarjeta" style="margin-bottom:16px"><h3>1. Cargar el extracto</h3>
      <div class="form-grid" style="grid-template-columns:2fr 1fr"><label class="campo"><span>Archivo del extracto (.csv)</span><input type="file" id="concArchivo" accept=".csv,.txt"></label>
        <label class="campo"><span>Banco</span><input type="text" id="concBanco" placeholder="Bancolombia, Davivienda…"></label></div>
      <div id="concMapeo" style="margin-top:12px"></div></div>
    <div id="concResultado"></div>
    <div class="tarjeta"><h3>Conciliaciones anteriores</h3>${r.historial.length ? `<table class="datos"><thead><tr><th>Fecha</th><th>Banco</th><th>Archivo</th><th class="d">Movimientos</th><th class="d">Conciliados</th><th>Usuario</th></tr></thead><tbody>
      ${r.historial.map((h) => `<tr><td>${fecha(h.fecha)}</td><td>${esc(h.banco)}</td><td>${esc(h.archivo)}</td><td class="d">${h.movimientos}</td><td class="d">${h.conciliados}</td><td>${esc(h.usuario)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="vacio"><i data-lucide="landmark"></i>Aún no se ha conciliado ningún extracto.</div>`}</div>`;
  iconos();
  $("#concArchivo").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    let texto = await f.text();
    if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(await f.arrayBuffer());
    E.extracto = { texto, nombre: f.name };
    const filas = texto.split(/\r?\n/).filter((x) => x.trim()).slice(0, 6);
    const sep = (filas[0].match(/;/g) || []).length >= (filas[0].match(/,/g) || []).length ? ";" : ",";
    const cols = filas[0].split(sep);
    const guess = (re) => Math.max(0, cols.findIndex((c2) => re.test(c2.toLowerCase())));
    const opc = (sel_) => cols.map((c2, k) => `<option value="${k}" ${k === sel_ ? "selected" : ""}>${k + 1}. ${esc(c2.slice(0, 30))}</option>`).join("");
    $("#concMapeo").innerHTML = `<div class="bloque-tit" style="margin-bottom:8px">2. Indique qué columna es cada dato</div>
      <div class="form-grid" style="grid-template-columns:repeat(3,1fr)">
        <label class="campo"><span>Fecha</span><select id="cFecha">${opc(guess(/fecha|date/))}</select></label>
        <label class="campo"><span>Valor (+ entra, − sale)</span><select id="cValor">${opc(guess(/valor|monto|importe|cr[eé]dito/))}</select></label>
        <label class="campo"><span>Descripción</span><select id="cDesc">${opc(guess(/desc|concepto|detalle/))}</select></label></div>
      <div class="ley-ayuda" style="padding:6px 0">Vista previa: ${esc(filas.slice(1, 3).join("  |  ").slice(0, 200))}</div>
      <button class="btn pri" id="btnAnalizar"><i data-lucide="git-compare"></i>Cruzar con lo registrado</button>`;
    iconos();
    $("#btnAnalizar").addEventListener("click", analizarExtracto);
  });
}

async function analizarExtracto() {
  let r;
  try {
    r = await api("/api/conciliacion/analizar", { texto: E.extracto.texto, col_fecha: +$("#cFecha").value, col_valor: +$("#cValor").value, col_desc: +$("#cDesc").value });
  } catch (e) { falla(e); return; }
  E.cruce = r;
  const reg = (x) => x.tabla === "pagos" ? `Recibo N° ${String(x.numero).padStart(6, "0")} · ${esc(x.tercero)} · ${x.id_lote}`
    : `${x.tabla === "gastos" ? "Gasto" : "Comisión"} CE ${String(x.numero).padStart(6, "0")} · ${esc(x.tercero)}`;
  $("#concResultado").innerHTML = `<div class="tarjeta" style="margin-bottom:16px"><h3>3. Resultado del cruce · ${r.movimientos} movimientos del ${fecha(r.periodo[0])} al ${fecha(r.periodo[1])}</h3>
      <div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">
        <div class="kpi" style="--c:#17A974"><div class="et">Coinciden</div><div class="va">${r.pares.length}</div><div class="sub">Se marcarán como conciliados</div></div>
        <div class="kpi ${r.sin_registro.length ? "rojo" : ""}" style="--c:#DC2626"><div class="et">En el banco, sin registro</div><div class="va">${r.sin_registro.length}</div><div class="sub">Pagos que nadie registró o egresos sin soporte</div></div>
        <div class="kpi ${r.sin_extracto.length ? "rojo" : ""}" style="--c:#F5B841"><div class="et">Registrados, no en el banco</div><div class="va">${r.sin_extracto.length}</div><div class="sub">Revise: ¿entró realmente el dinero?</div></div></div>
      ${r.pares.length ? `<table class="mini-tabla"><thead><tr><th></th><th>Fecha banco</th><th>Descripción del banco</th><th class="d">Valor</th><th>Registro en el geovisor</th></tr></thead><tbody>
        ${r.pares.map((p, k) => `<tr><td><input type="checkbox" class="selPar" data-k="${k}" checked></td><td>${fecha(p.movimiento.fecha)}</td><td>${esc(p.movimiento.descripcion)}</td>
          <td class="d">${pesos(p.movimiento.valor)}</td><td>${reg(p.registro)}</td></tr>`).join("")}</tbody></table>
        <button class="btn acento" id="btnConfirmar" style="margin-top:10px"><i data-lucide="check-check"></i>Confirmar conciliación</button>` : ""}</div>
    ${r.sin_registro.length ? `<div class="tarjeta" style="margin-bottom:16px"><h3 style="color:var(--peligro)">Movimientos del banco sin registro</h3><table class="mini-tabla"><tbody>
      ${r.sin_registro.map((m) => `<tr><td>${fecha(m.fecha)}</td><td>${esc(m.descripcion)}</td><td class="d">${pesos(m.valor)}</td><td>${m.valor > 0 ? "Entrada: ¿pago de un comprador sin recibo?" : "Salida sin comprobante de egreso"}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${r.sin_extracto.length ? `<div class="tarjeta" style="margin-bottom:16px"><h3 style="color:#B45309">Registros del periodo que no aparecen en el banco</h3><table class="mini-tabla"><tbody>
      ${r.sin_extracto.map((x) => `<tr><td>${fecha(x.fecha)}</td><td>${reg(x)}</td><td class="d">${pesos(Math.abs(x.valor))}</td><td>${esc(x.medio)} ${esc(x.referencia || "")}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
  iconos();
  $("#btnConfirmar")?.addEventListener("click", async () => {
    const pares = $$(".selPar").filter((c2) => c2.checked).map((c2) => { const p = E.cruce.pares[+c2.dataset.k].registro; return { tabla: p.tabla, id: p.id }; });
    try {
      const x = await api("/api/conciliacion/confirmar", { pares, banco: $("#concBanco").value, archivo: E.extracto.nombre, movimientos: E.cruce.movimientos });
      aviso(`${x.conciliados} registros conciliados`);
      pintarConciliacion();
    } catch (e) { falla(e); }
  });
}
