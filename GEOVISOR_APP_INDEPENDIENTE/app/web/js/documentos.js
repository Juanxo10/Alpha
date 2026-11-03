/* ==========================================================================
   Documentos: expediente del lote, cotizaciones, promesa de compraventa, paz y salvo, certificado de pagos y
   descarga de cualquier documento en PDF.
   ========================================================================== */
"use strict";

const TIPOS_ADJ = ["Documento de identidad", "Promesa de compraventa", "Comprobante de pago", "Escritura pública",
  "Certificado de tradición", "Paz y salvo", "Acuerdo de pago", "Correspondencia", "Otro"];
const NOMBRE_DOC = { ficha: "Ficha integral", comisionista: "Informe de comisiones", promesa: "Promesa de compraventa",
  pazysalvo: "Paz y salvo", certificado: "Certificado de pagos", cotizacion: "Cotización", recibo: "Recibo de caja",
  egreso: "Comprobante de egreso", estado: "Estado de cuenta", informe: "Informe general" };

// ------------------------------------------------------------------ descarga de archivos de la API (con la sesión)
async function descargarArchivo(url, btn) {
  const txt = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="girando"></span>Generando…`; }
  try {
    const r = await fetch(url, { headers: { "X-Sesion": E.token || "" } });
    if (r.status === 401) { sesionVencida(); return; }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo descargar");
    const cd = r.headers.get("Content-Disposition") || "";
    const nombre = decodeURIComponent(cd.includes("UTF-8''") ? cd.split("UTF-8''")[1] : "archivo");
    const u = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement("a"), { href: u, download: nombre });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 8000);
    aviso(`Descargado: ${nombre}`);
  } catch (e) {
    falla(e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = txt; iconos(); }
  }
}
const descargarPDF = (doc, id, btn) => descargarArchivo(`/api/pdf?doc=${doc}&id=${encodeURIComponent(id)}`, btn);

// ------------------------------------------------------------------ modo documento (?doc=…&id=…): lo usa el PDF
async function abrirDocumento(doc, id) {
  if (doc === "ficha") return imprimirHoja(await api("/api/lote?id=" + id));
  if (doc === "comisionista") return imprimirInformeComisionista(await api("/api/comisionista?id=" + id));
  if (doc === "recibo") return imprimirRecibo(+id);
  if (doc === "egreso") return imprimirEgreso(+id);
  if (doc === "estado") return imprimirEstadoCuenta(await api("/api/lote?id=" + id));
  if (doc === "informe") return imprimirInforme();
  const d = await api(`/api/documento?tipo=${doc}&id=${id}`);
  const pie = `${E.config.proyecto} · ${NOMBRE_DOC[doc]} · ${fecha(hoyISO())}`.replace(/"/g, "'");
  const html = { promesa: htmlPromesa, pazysalvo: htmlPazYSalvo, certificado: htmlCertificado, cotizacion: htmlCotizacion }[doc](d);
  imprimir(NOMBRE_DOC[doc], html, CSS_HOJA.replace("HOJA_PIE", pie) + CSS_DOCS);
}

const CSS_DOCS = `
  .legal { font-size: 10.6px; line-height: 1.62; text-align: justify; }
  .legal h2 { margin: 14px 0 6px; }
  .legal p { margin: 0 0 8px; }
  .legal .cl { font-weight: 700; color: #0C2E37; }
  .titulo-doc { text-align: center; font: 600 16px Lexend, Arial; color: #0C2E37; margin: 6px 0 14px; letter-spacing: .5px; }
  .firmas.legal-f { margin-top: 60px; }
  .firmas.legal-f div { font-size: 10px; line-height: 1.5; }
  .sello { margin-top: 18px; padding: 10px 14px; border: 1.5px solid #17A974; border-radius: 8px; color: #0E6B4A; font-weight: 700; text-align: center; letter-spacing: .5px; }`;

function vendedor(c) {
  return { nombre: c.vendedor_razon_social || c.proyecto, nit: c.vendedor_nit, rep: c.vendedor_representante, repDoc: c.vendedor_representante_doc,
    dir: c.vendedor_direccion, ciudad: c.ciudad };
}

function htmlPromesa(d) {
  const c = d.config, v = d.venta, l = d.detalle.lote, p = E.props[l.id_lote], ve = vendedor(c);
  const lind = [...(p.linderos || [])].sort((a, b) => ORDEN_RUMBO[a.rumbo] - ORDEN_RUMBO[b.rumbo]);
  const cuota = v.plan.find((x) => x.n === 1);
  const pena = num2(c.promesa_penalidad_pct), plazo = num2(c.promesa_plazo_escritura_meses);
  const mora = num2(c.tasa_mora_mensual);
  return `<div class="hv">${cabecera("PROMESA DE COMPRAVENTA", l.id_lote, `${esc(c.ciudad || "")}, ${fechaLarga(hoyISO())}`)}
    <div class="legal">
    <p>Entre los suscritos, <b>${esc(ve.nombre)}</b>${ve.nit ? `, identificado(a) con NIT/C.C. ${esc(ve.nit)}` : ""}${ve.rep ? `, representado(a) por ${esc(ve.rep)}${ve.repDoc ? `, identificado(a) con C.C. ${esc(ve.repDoc)}` : ""}` : ""},
      quien en adelante se denominará <b>EL PROMITENTE VENDEDOR</b>, y <b>${esc(v.nombre)}</b>, identificado(a) con ${esc(v.tipo_doc)} ${esc(v.documento || "_______")},
      ${v.direccion ? `domiciliado(a) en ${esc(v.direccion)}, ` : ""}quien en adelante se denominará <b>EL PROMITENTE COMPRADOR</b>, se celebra el presente contrato de
      promesa de compraventa, que se rige por las siguientes cláusulas:</p>
    <h2><span>1</span>Objeto</h2>
    <p><span class="cl">PRIMERA.</span> EL PROMITENTE VENDEDOR promete vender y EL PROMITENTE COMPRADOR promete comprar el inmueble identificado como
      <b>Lote ${l.lote} de la Manzana ${l.manzana} (código ${l.id_lote})</b> del proyecto <b>${esc(c.proyecto)}</b>, ubicado en ${esc(c.ciudad || "")},
      con un área aproximada de <b>${fmtN1.format(l.area_m2)} m²</b>, equivalente al <b>${pctPredio(l.id_lote)}</b> del área total del predio de mayor extensión
      (${areaPredioTxt(l.id_lote)}), perímetro de ${fmtN1.format(p.perimetro_m)} m, comprendido dentro de los siguientes linderos:
      ${lind.map((x) => `por el <b>${x.rumbo.toLowerCase()}</b>, en ${fmtN1.format(x.longitud_m)} m, con ${esc(x.colinda.map(nomColindante).join(" y "))}`).join("; ")}.
      Las medidas y linderos definitivos serán los que consten en la escritura pública y en el certificado de tradición del inmueble.</p>
    <h2><span>2</span>Precio y forma de pago</h2>
    <p><span class="cl">SEGUNDA.</span> El precio del inmueble es la suma de <b>${pesos(v.valor_venta)}</b> (${numeroALetras(v.valor_venta).toLowerCase()}),
      que EL PROMITENTE COMPRADOR pagará así: ${v.cuota_inicial ? `a) una cuota inicial de <b>${pesos(v.cuota_inicial)}</b> el ${fechaLarga(v.fecha_venta)}; ` : ""}
      ${v.n_cuotas ? `${v.cuota_inicial ? "b) " : ""}el saldo de <b>${pesos(v.valor_venta - v.cuota_inicial)}</b> en <b>${v.n_cuotas} cuotas mensuales</b> de ${pesos(cuota?.valor)}
        cada una, la primera el ${fechaLarga(v.fecha_primera_cuota)} y las siguientes el mismo día de cada mes, hasta el ${fechaLarga(v.fecha_fin)}.`
        : `el saldo de contado el ${fechaLarga(v.fecha_venta)}.`}
      ${c.cuenta_bancaria ? `Los pagos se harán en ${esc(c.cuenta_bancaria)} o en las oficinas del proyecto contra recibo de caja.` : "Los pagos se soportarán con recibo de caja."}
      ${v.pagado ? `A la firma del presente documento EL PROMITENTE VENDEDOR declara recibidos ${pesos(v.pagado)}, que se imputan al precio.` : ""}</p>
    <p><span class="cl">TERCERA. Mora.</span> El retardo en el pago de cualquier cuota causará intereses de mora ${mora ? `a la tasa del ${fmtN1.format(mora)} % mensual,` : "a la tasa máxima legal permitida,"}
      sin perjuicio de las demás acciones de EL PROMITENTE VENDEDOR. El incumplimiento en el pago de tres (3) o más cuotas facultará a EL PROMITENTE VENDEDOR para dar por terminado el contrato.</p>
    <h2><span>3</span>Escritura y entrega</h2>
    <p><span class="cl">CUARTA. Escritura pública.</span> La escritura pública que perfeccione la compraventa prometida se otorgará en la ${esc(c.notaria_escrituracion || "Notaría ______ del Círculo de " + (c.ciudad || "______"))},
      a las 10:00 a. m. del primer día hábil del mes siguiente al vencimiento de los ${plazo || "___"} meses posteriores al pago total del precio, o en la fecha anterior que las partes acuerden por escrito.</p>
    <p><span class="cl">QUINTA. Entrega.</span> La entrega material del inmueble se hará en la fecha de firma de la escritura pública, mediante acta, salvo que las partes acuerden por escrito una entrega anticipada.</p>
    <p><span class="cl">SEXTA. Saneamiento.</span> EL PROMITENTE VENDEDOR garantiza que transferirá el inmueble libre de gravámenes, embargos, pleitos pendientes y limitaciones al dominio, y saldrá al saneamiento en los casos de ley.</p>
    <p><span class="cl">SÉPTIMA. Gastos.</span> Los gastos notariales de la escritura se pagarán por partes iguales; los impuestos de beneficencia y registro serán por cuenta de EL PROMITENTE COMPRADOR.</p>
    <h2><span>4</span>Incumplimiento y disposiciones finales</h2>
    <p><span class="cl">OCTAVA. Cláusula penal.</span> La parte que incumpla las obligaciones de este contrato pagará a la otra, a título de pena, una suma equivalente al
      <b>${fmtN1.format(pena || 0)} %</b> del precio pactado, sin perjuicio de la indemnización de perjuicios a que haya lugar.</p>
    ${v.fecha_separacion ? `<p><span class="cl">NOVENA. Separación.</span> Las sumas entregadas a título de separación del lote se imputan al precio pactado.</p>` : ""}
    <p><span class="cl">${v.fecha_separacion ? "DÉCIMA" : "NOVENA"}. Notificaciones.</span> Las partes recibirán notificaciones en las direcciones y correos registrados en el proyecto${v.email ? ` (comprador: ${esc(v.email)})` : ""}.
      Para constancia se firma en ${esc(c.ciudad || "______")}, el ${fechaLarga(hoyISO())}, en dos ejemplares del mismo tenor.</p>
    </div>
    <div class="firmas legal-f"><div><b>EL PROMITENTE VENDEDOR</b><br>${esc(ve.nombre)}${ve.nit ? `<br>NIT/C.C. ${esc(ve.nit)}` : ""}${ve.rep ? `<br>Rep.: ${esc(ve.rep)}` : ""}</div>
      <div><b>EL PROMITENTE COMPRADOR</b><br>${esc(v.nombre)}<br>${esc(v.tipo_doc)} ${esc(v.documento || "")}</div></div></div>`;
}

function htmlPazYSalvo(d) {
  const c = d.config, v = d.venta, l = d.detalle.lote, ve = vendedor(c);
  const pagos = v.pagos.filter((x) => !x.anulado);
  return `<div class="hv">${cabecera("PAZ Y SALVO", l.id_lote, `${esc(c.ciudad || "")}, ${fechaLarga(hoyISO())}`)}
    <div class="legal" style="font-size:12px;margin-top:30px">
    <p class="titulo-doc">${esc(ve.nombre).toUpperCase()}${ve.nit ? `<br><span style="font-size:11px;font-weight:400">NIT ${esc(ve.nit)}</span>` : ""}</p>
    <p style="text-align:center;font-weight:700;letter-spacing:2px;margin:20px 0">CERTIFICA</p>
    <p>Que <b>${esc(v.nombre)}</b>, identificado(a) con ${esc(v.tipo_doc)} ${esc(v.documento || "")}, se encuentra a <b>PAZ Y SALVO</b> por todo concepto
      relacionado con el pago del precio del <b>Lote ${l.lote} de la Manzana ${l.manzana} (${l.id_lote})</b> del proyecto <b>${esc(c.proyecto)}</b>,
      con un área de ${fmtN1.format(l.area_m2)} m², adquirido el ${fechaLarga(v.fecha_venta)} por un valor total de <b>${pesos(v.valor_venta)}</b>
      (${numeroALetras(v.valor_venta).toLowerCase()}), el cual fue pagado en su totalidad mediante ${pagos.length} recibo(s) de caja, el último de ellos
      el ${fechaLarga(pagos[pagos.length - 1].fecha)}.</p>
    <p>Se expide a solicitud del interesado en ${esc(c.ciudad || "")}, el ${fechaLarga(hoyISO())}.</p>
    <div class="sello">SALDO A LA FECHA: $ 0</div></div>
    <div class="firmas legal-f" style="margin-top:90px"><div><b>${esc(ve.rep || ve.nombre)}</b><br>${ve.rep ? "Representante legal<br>" : ""}${esc(ve.nombre)}</div><div></div></div></div>`;
}

function htmlCertificado(d) {
  const c = d.config, v = d.venta, l = d.detalle.lote, ve = vendedor(c);
  const pagos = v.pagos.filter((x) => !x.anulado);
  return `<div class="hv">${cabecera("CERTIFICADO DE PAGOS", l.id_lote, `Fecha de corte: ${fechaLarga(hoyISO())}`)}
    <div class="legal" style="font-size:11.5px">
    <p>${esc(ve.nombre)}${ve.nit ? `, NIT ${esc(ve.nit)},` : ""} certifica que <b>${esc(v.nombre)}</b>, identificado(a) con ${esc(v.tipo_doc)} ${esc(v.documento || "")},
      prometiente comprador del <b>Lote ${l.lote} de la Manzana ${l.manzana} (${l.id_lote})</b> del proyecto ${esc(c.proyecto)}, por un valor de <b>${pesos(v.valor_venta)}</b>,
      ha realizado a la fecha los siguientes pagos:</p></div>
    <table class="lista"><thead><tr><th>Recibo</th><th>Fecha</th><th>Concepto</th><th>Medio</th><th class="d">Valor</th></tr></thead><tbody>
      ${pagos.map((x) => `<tr><td>N° ${String(x.recibo).padStart(6, "0")}</td><td>${fecha(x.fecha)}</td><td>${esc(x.concepto)}</td><td>${esc(x.medio)}</td><td class="d">${pesos(x.valor)}</td></tr>`).join("")}
      <tr class="tot"><td colspan="4">Total pagado</td><td class="d">${pesos(v.pagado)}</td></tr></tbody></table>
    <div class="kpis" style="margin-top:14px"><div><small>Valor del negocio</small><b>${pesos(v.valor_venta)}</b></div><div><small>Total pagado</small><b>${pesos(v.pagado)}</b></div>
      <div><small>Saldo pendiente</small><b>${pesos(v.saldo)}</b></div><div class="${v.vencido ? "malo" : ""}"><small>Valor vencido</small><b>${pesos(v.vencido)}</b></div></div>
    <div class="legal" style="font-size:11.5px;margin-top:14px"><p>Se expide a solicitud del interesado en ${esc(c.ciudad || "")}, el ${fechaLarga(hoyISO())}.</p></div>
    <div class="firmas legal-f"><div><b>${esc(ve.rep || ve.nombre)}</b><br>${esc(ve.nombre)}</div><div></div></div></div>`;
}

function htmlCotizacion(d) {
  const c = d.config, q = d.cotizacion, l = d.lote, p = E.props[l.id_lote];
  const fin = q.valor - q.cuota_inicial, n = q.n_cuotas, cuota = n ? Math.round(fin / n) : 0;
  const vence = sumarDias(q.creado.slice(0, 10), q.validez_dias);
  const desc = q.precio_lista && q.valor < q.precio_lista ? q.precio_lista - q.valor : 0;
  return `<div class="hv">${cabecera("COTIZACIÓN", `COT-${String(q.numero).padStart(5, "0")}`, `Fecha: ${fechaLarga(q.creado)}`)}
    <div class="banda"><div><div class="b-tit">Manzana ${l.manzana} · Lote ${l.lote}</div><div class="b-sub">${esc(c.proyecto)} · ${esc(c.ciudad || "")}</div>
      <div class="b-chips"><span class="chip DISPONIBLE">Disponible</span></div></div>
      <div class="b-cifras"><div><small>Área</small><b>${fmtN1.format(l.area_m2)} m²</b></div><div><small>Valor</small><b>${pesos(q.valor)}</b></div>
      <div><small>Válida hasta</small><b>${fecha(vence)}</b></div></div></div>
    <h2><span>1</span>Cliente</h2>
    <table class="ficha ancha"><tr><th>Nombre</th><td>${esc(q.nombre)}</td></tr>${q.telefono ? `<tr><th>Teléfono</th><td>${esc(q.telefono)}</td></tr>` : ""}${q.email ? `<tr><th>Correo</th><td>${esc(q.email)}</td></tr>` : ""}</table>
    <h2><span>2</span>El lote</h2>
    <div class="dos"><table class="ficha"><tr><th>Código</th><td>${l.id_lote}</td></tr><tr><th>Área</th><td>${fmtN1.format(l.area_m2)} m²</td></tr>
      <tr><th>Medidas</th><td>${fmtN1.format(p.frente_m)} × ${fmtN1.format(p.fondo_m)} m</td></tr><tr><th>Perímetro</th><td>${fmtN1.format(p.perimetro_m)} m</td></tr>
      <tr><th>% del predio</th><td>${pctPredio(l.id_lote)} <small>de ${areaPredioTxt(l.id_lote)}</small></td></tr>
      <tr><th>Precio de lista</th><td>${pesos(q.precio_lista)}</td></tr>${desc ? `<tr><th>Descuento</th><td>${pesos(desc)}</td></tr>` : ""}
      <tr><th>Valor ofrecido</th><td><b>${pesos(q.valor)}</b> <small>(${pesos(q.valor / l.area_m2)} / m²)</small></td></tr></table>
      <figure>${planoLocalizacion(l.id_lote, 520, 280)}<figcaption>Localización en la manzana ${l.manzana}</figcaption></figure></div>
    <h2><span>3</span>Forma de pago propuesta</h2>
    <table class="lista"><thead><tr><th>Concepto</th><th>Fecha</th><th class="d">Valor</th></tr></thead><tbody>
      ${q.cuota_inicial ? `<tr><td>Cuota inicial</td><td>A la firma</td><td class="d">${pesos(q.cuota_inicial)}</td></tr>` : ""}
      ${n ? `<tr><td>${n} cuotas mensuales</td><td>Desde el ${fecha(q.fecha_primera)} hasta el ${fecha(sumarMeses(q.fecha_primera, n - 1))}</td><td class="d">${pesos(cuota)} c/u</td></tr>`
        : `<tr><td>Saldo de contado</td><td>A la firma</td><td class="d">${pesos(fin)}</td></tr>`}
      <tr class="tot"><td colspan="2">Total</td><td class="d">${pesos(q.valor)}</td></tr></tbody></table>
    <div class="notas"><h3>Condiciones</h3><ul>
      <li>Cotización válida hasta el ${fechaLarga(vence)} y sujeta a la disponibilidad del lote al momento de separarlo.</li>
      <li>El lote se separa con el abono que indique el proyecto; la separación se descuenta del precio.</li>
      <li>Medidas y linderos según el plano de loteo; los definitivos serán los de la escritura pública.</li>
      ${q.observacion ? `<li>${esc(q.observacion)}</li>` : ""}</ul>
      <div class="contacto">${esc(c.vendedor_razon_social || c.proyecto)}${c.vendedor_telefono ? ` · Tel. ${esc(c.vendedor_telefono)}` : ""}${c.vendedor_email ? ` · ${esc(c.vendedor_email)}` : ""}${c.cuenta_bancaria ? ` · Pagos: ${esc(c.cuenta_bancaria)}` : ""}</div></div></div>`;
}

// ------------------------------------------------------------------ cotizador
function formCotizacion(id_lote, prospecto = null) {
  const l = E.porId[id_lote];
  modal(`Cotizar lote ${id_lote}`, `<div class="form-grid">
      ${campo("", "A nombre de", `<input name="nombre" required value="${esc(prospecto?.nombre || "")}">`, { req: true, cls: "c2" })}
      ${campo("", "Teléfono", `<input name="telefono" value="${esc(prospecto?.telefono || "")}">`)} ${campo("", "Correo", `<input name="email" value="${esc(prospecto?.email || "")}">`)}
      ${campo("", "Valor del lote", inDinero("valor", l.precio_lista || ""), { ayuda: l.precio_lista ? `Lista: ${pesos(l.precio_lista)}` : "Sin precio de lista" })}
      ${campo("", "Cuota inicial", inDinero("cuota_inicial", l.precio_lista ? Math.round(l.precio_lista * 0.2 / 100000) * 100000 : ""))}
      ${campo("", "Número de cuotas", `<input type="number" name="n_cuotas" min="0" max="360" value="24">`)}
      ${campo("", "Primera cuota", `<input type="date" name="fecha_primera" value="${sumarMeses(hoyISO(), 1)}">`)}
      ${campo("", "Observación", `<input name="observacion">`, { cls: "c2" })}
      <div class="resumen-plan" id="resCot" style="grid-template-columns:repeat(3,1fr)"></div></div>`, {
    boton: "Generar cotización",
    enviar: async (x) => {
      const r = await api("/api/cotizacion", { ...x, id_lote, prospecto_id: prospecto?.id });
      cerrarModal();
      aviso(`Cotización COT-${String(r.numero).padStart(5, "0")} creada`);
      descargarPDF("cotizacion", r.id);
    },
  });
  const calc = () => { const v = valorDinero($("[name=valor]").value), i = valorDinero($("[name=cuota_inicial]").value), n = +$("[name=n_cuotas]").value || 0;
    $("#resCot").innerHTML = `<div><div class="et">Saldo a financiar</div><div class="va">${pesos(v - i)}</div></div>
      <div><div class="et">Cuota</div><div class="va">${n ? pesos((v - i) / n) : "Contado"}</div></div><div><div class="et">Inicial</div><div class="va">${v ? fmtN1.format((100 * i) / v) + " %" : "—"}</div></div>`; };
  $$("[name=valor],[name=cuota_inicial],[name=n_cuotas]").forEach((i) => i.addEventListener("input", calc));
  calc();
}

// ------------------------------------------------------------------ pestaña «Documentos» de la ficha
function htmlDocsFicha(d, v) {
  const l = d.lote, saldo0 = v && v.saldo <= 0.5 && v.etapa !== "SEPARADO";
  const docs = v ? [["ficha", l.id_lote, "file-badge", "Ficha integral del lote", "Identificación, linderos, negocio y estado de cuenta"],
    ["estado", l.id_lote, "file-text", "Estado de cuenta", "Plan de pagos y pagos recibidos"],
    ...(v.etapa !== "SEPARADO" ? [["promesa", v.id, "file-signature", "Promesa de compraventa", "Con los datos del negocio y los linderos"]] : []),
    ["certificado", v.id, "badge-check", "Certificado de pagos", "Pagos realizados y saldo a la fecha"],
    ["pazysalvo", v.id, "stamp", "Paz y salvo", saldo0 ? "El negocio está pagado" : "Disponible cuando el saldo sea $0", !saldo0]]
    : [["ficha", l.id_lote, "file-badge", "Ficha técnica y comercial", "Para entregar a un interesado"]];
  return `<div class="bloque-tit" style="margin-bottom:8px">Generar documento (PDF)</div>
    <div class="docs-grid">${docs.map(([doc, id, ic, nom, sub, off]) => `<button class="doc-btn" data-doc="${doc}" data-id="${id}" ${off ? "disabled" : ""}>
      <i data-lucide="${ic}"></i><b>${nom}</b><small>${sub}</small></button>`).join("")}
      ${!v && E.porId[l.id_lote]?.estado === "DISPONIBLE" ? `<button class="doc-btn" data-cot="1"><i data-lucide="calculator"></i><b>Cotización</b><small>Plan de pagos propuesto a un cliente</small></button>` : ""}</div>
    <div class="bloque-tit" style="margin:16px 0 8px;display:flex;align-items:center">Expediente del lote<button class="link" style="margin-left:auto" data-subir="1"><i data-lucide="upload"></i> Subir documento</button></div>
    ${d.adjuntos.length ? `<table class="mini-tabla"><tbody>${d.adjuntos.map((a) => `<tr><td><i data-lucide="${/\.(jpe?g|png|webp|heic)$/i.test(a.nombre) ? "image" : "file"}"></i></td>
      <td><b>${esc(a.tipo)}</b><br><small style="color:var(--txt-3)">${esc(a.nombre)} · ${fmtN1.format(a.tamano / 1024)} KB · ${fecha(a.creado)} · ${esc(a.usuario)}</small>${a.descripcion ? `<br><small>${esc(a.descripcion)}</small>` : ""}</td>
      <td style="white-space:nowrap;text-align:right"><button class="link" data-ver="${a.id}" title="Ver"><i data-lucide="eye"></i></button>
        <button class="link" data-bajar="${a.id}" title="Descargar"><i data-lucide="download"></i></button>
        <button class="link rojo" data-borrar="${a.id}" data-nom="${esc(a.nombre)}" title="Eliminar"><i data-lucide="trash-2"></i></button></td></tr>`).join("")}</tbody></table>`
      : `<div class="vacio"><i data-lucide="folder-open"></i>Sin documentos. Suba la cédula, la promesa firmada, comprobantes y escrituras.</div>`}`;
}

function enlazarDocsFicha(d) {
  $$("#stCont [data-doc]").forEach((b) => b.addEventListener("click", () => descargarPDF(b.dataset.doc, b.dataset.id, b)));
  $("#stCont [data-cot]")?.addEventListener("click", () => formCotizacion(d.lote.id_lote));
  $("#stCont [data-subir]")?.addEventListener("click", () => formSubir(d.lote.id_lote));
  $$("#stCont [data-bajar]").forEach((b) => b.addEventListener("click", () => descargarArchivo(`/api/adjunto?id=${b.dataset.bajar}`)));
  $$("#stCont [data-ver]").forEach((b) => b.addEventListener("click", () => verAdjunto(+b.dataset.ver)));
  $$("#stCont [data-borrar]").forEach((b) => b.addEventListener("click", () => modal("Eliminar documento", `<p class="texto-modal">Se retirará «${esc(b.dataset.nom)}» del expediente (queda en la auditoría).</p>
    <div class="form-grid">${campo("", "Motivo", `<input name="motivo" required>`, { req: true, cls: "c2" })}</div>`, {
    boton: "Eliminar", peligro: true,
    enviar: async (x) => { await api("/api/adjunto/eliminar", { id: +b.dataset.borrar, motivo: x.motivo }); await trasGuardar("Documento eliminado"); } })));
}

function formSubir(id_lote) {
  modal(`Subir documento · ${id_lote}`, `<div class="form-grid">
      ${campo("", "Tipo de documento", `<select name="tipo">${TIPOS_ADJ.map((t) => `<option>${t}</option>`).join("")}</select>`)}
      ${campo("", "Archivo (PDF, foto, Word o Excel · máx. 15 MB)", `<input type="file" id="adjArchivo" required accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx">`)}
      ${campo("", "Descripción", `<input name="descripcion">`, { cls: "c2" })}</div>`, {
    boton: "Subir",
    enviar: async (x) => {
      const f = $("#adjArchivo").files[0];
      if (!f) throw new Error("Seleccione el archivo.");
      if (f.size > 15 * 1024 * 1024) throw new Error("El archivo supera 15 MB.");
      const contenido = await new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = mal; r.readAsDataURL(f); });
      await api("/api/adjunto/subir", { id_lote, tipo: x.tipo, descripcion: x.descripcion, nombre: f.name, contenido });
      await trasGuardar("Documento agregado al expediente");
    },
  });
}

async function verAdjunto(id) {
  const r = await fetch(`/api/adjunto?id=${id}&ver=1`, { headers: { "X-Sesion": E.token || "" } });
  if (!r.ok) { falla(new Error((await r.json().catch(() => ({}))).error || "No se pudo abrir")); return; }
  const tipo = r.headers.get("Content-Type") || "";
  const u = URL.createObjectURL(await r.blob());
  modal("Documento", tipo.startsWith("image/") ? `<img src="${u}" style="max-width:100%;border-radius:8px">`
    : tipo === "application/pdf" ? `<iframe src="${u}" style="width:100%;height:70vh;border:0;border-radius:8px"></iframe>`
      : `<p class="texto-modal">Este tipo de archivo no se puede previsualizar. Descárguelo para abrirlo.</p>`,
  { ancho: "extra", extraPie: `<button type="button" class="btn acento" id="btnBajarAdj"><i data-lucide="download"></i>Descargar</button>` });
  $("[data-cerrar2]").textContent = "Cerrar";
  $("#btnBajarAdj").addEventListener("click", () => descargarArchivo(`/api/adjunto?id=${id}`));
  iconos();
}
