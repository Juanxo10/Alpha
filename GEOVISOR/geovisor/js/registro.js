// ================================================================== REGISTRO DE LA ESCRITURA (ORIP)
// Etapa «Registrado»: la escritura ya está inscrita en la Oficina de Registro de Instrumentos Públicos
// y el lote tiene su folio de matrícula inmobiliaria a nombre del comprador.
// Se engancha a la ficha y a la ficha integral en PDF sin tocar sus funciones originales.

const _enlazarFichaBase = enlazarFicha;
enlazarFicha = function (d) {
  _enlazarFichaBase(d);
  const v = d.ventas.find((x) => x.estado === "ACTIVA");
  if (!v) return;
  if (v.etapa === "ESCRITURADO") {
    const b = document.createElement("button");
    b.className = "btn sec peq";
    b.innerHTML = `<i data-lucide="book-marked"></i>Registrar`;
    b.addEventListener("click", () => formRegistro(d, v));
    $$("#fichaCont .f-acciones")[1]?.append(b);
  } else if (v.etapa === "REGISTRADO" && v.registro) {
    const sec = document.createElement("div");
    sec.className = "f-sec";
    sec.innerHTML = htmlRegistroFicha(d, v);
    $("#subtabs").before(sec);
    $("[data-reg=editar]", sec).addEventListener("click", () => formRegistro(d, v, true));
    $("[data-reg=anular]", sec)?.addEventListener("click", () => formAnularRegistro(d, v));
    $$("[data-reg-adj]", sec).forEach((a) => a.addEventListener("click", () => verAdjunto(+a.dataset.regAdj)));
  }
  iconos();
};

function htmlRegistroFicha(d, v) {
  const r = v.registro;
  const soportes = r.adjuntos.map((id) => d.adjuntos.find((a) => a.id === id)).filter(Boolean);
  return `<h4><i data-lucide="book-marked"></i>Registro</h4>
    <dl class="dl">
      <dt>Matrícula</dt><dd class="num">${esc(r.matricula_inmobiliaria)}</dd>
      <dt>Oficina (ORIP)</dt><dd>${esc(r.orip)}</dd>
      <dt>Fecha de registro</dt><dd class="num">${fecha(r.fecha_registro)}</dd>
      ${r.numero_turno ? `<dt>Turno</dt><dd>${esc(r.numero_turno)}${r.fecha_radicacion ? " · radicado el " + fecha(r.fecha_radicacion) : ""}</dd>` : ""}
      ${r.numero_anotacion ? `<dt>Anotación</dt><dd>${esc(r.numero_anotacion)}</dd>` : ""}
      ${r.numero_predial ? `<dt>N° predial</dt><dd>${esc(r.numero_predial)}</dd>` : ""}
      <dt>Propietario</dt><dd>${esc(r.propietario_inscrito || "—")}</dd>
      ${r.valor_derechos_registro ? `<dt>Derechos</dt><dd class="num">${pesos(r.valor_derechos_registro)}</dd>` : ""}
      ${r.valor_impuesto_registro ? `<dt>Impuesto</dt><dd class="num">${pesos(r.valor_impuesto_registro)}</dd>` : ""}
      ${r.observaciones ? `<dt>Observaciones</dt><dd style="font-weight:400">${esc(r.observaciones)}</dd>` : ""}
      ${soportes.length ? `<dt>Soportes</dt><dd>${soportes.map((a) => `<a href="#" data-reg-adj="${a.id}">${esc(a.tipo)}</a>`).join(" · ")}</dd>` : ""}
    </dl>
    <div class="f-acciones" style="margin-top:10px">
      <button class="btn sec peq" data-reg="editar"><i data-lucide="pencil"></i>Editar registro</button>
      ${esDueno() ? `<button class="btn peligro peq" data-reg="anular"><i data-lucide="undo-2"></i>Anular registro</button>` : ""}
    </div>`;
}

function _leerArchivo(f) {
  return new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = mal; r.readAsDataURL(f); });
}

function formRegistro(d, v, editar = false) {
  const r = editar ? v.registro : {};
  const val = (k) => esc(r[k] ?? "");
  const hoy = hoyISO();
  const ro = (et, t) => campo("", et, `<input value="${esc(t || "—")}" readonly>`);
  modal(`${editar ? "Editar registro" : "Registro de la escritura"} · ${d.lote.id_lote}`, `
    <div class="form-grid">
      ${ro("Comprador", v.nombre)}
      ${ro("Escritura", v.numero_escritura ? `N° ${v.numero_escritura} del ${fecha(v.fecha_escritura)} · ${v.notaria || ""}` : "Sin número de escritura")}
      ${campo("", "Fecha de radicación", `<input type="date" name="fecha_radicacion" value="${val("fecha_radicacion")}" max="${hoy}">`)}
      ${campo("", "Número de turno", `<input name="numero_turno" value="${val("numero_turno")}">`)}
      ${campo("", "Fecha de registro", `<input type="date" name="fecha_registro" required value="${editar ? val("fecha_registro") : hoy}" max="${hoy}" ${v.fecha_escritura ? `min="${v.fecha_escritura}"` : ""}>`, { req: true })}
      ${campo("", "Oficina de registro (ORIP)", `<input name="orip" required value="${val("orip")}" placeholder="Villavicencio">`, { req: true })}
      ${campo("", "Matrícula inmobiliaria", `<input name="matricula_inmobiliaria" required value="${val("matricula_inmobiliaria")}" placeholder="230-123456" pattern="\\d{3}-\\d{4,8}" title="Formato NNN-NNNNNN, por ejemplo 230-123456">`, { req: true, ayuda: "Formato NNN-NNNNNN, por ejemplo 230-123456" })}
      ${campo("", "Número de anotación", `<input name="numero_anotacion" value="${val("numero_anotacion")}">`)}
      ${campo("", "Número predial (código catastral)", `<input name="numero_predial" value="${val("numero_predial")}">`)}
      ${campo("", "Propietario inscrito", `<input name="propietario_inscrito" value="${editar ? val("propietario_inscrito") : esc(v.nombre)}">`)}
      ${campo("", "Derechos de registro", inDinero("valor_derechos_registro", r.valor_derechos_registro || ""))}
      ${campo("", "Impuesto de registro (boleta fiscal)", inDinero("valor_impuesto_registro", r.valor_impuesto_registro || ""))}
      ${campo("", "Certificado de tradición y libertad", `<input type="file" id="regCert" accept=".pdf,.jpg,.jpeg,.png,.webp">`)}
      ${campo("", "Escritura registrada", `<input type="file" id="regEsc" accept=".pdf,.jpg,.jpeg,.png,.webp">`)}
      ${campo("", "Observaciones", `<textarea name="observaciones" rows="2">${val("observaciones")}</textarea>`, { cls: "c2" })}
    </div>`, {
    boton: editar ? "Guardar cambios" : "Registrar", ancho: true,
    enviar: async (x) => {
      const ids = editar ? [...v.registro.adjuntos] : [];
      for (const [id, tipo] of [["#regCert", "Certificado de tradición"], ["#regEsc", "Escritura pública"]]) {
        const f = $(id).files[0];
        if (!f) continue;
        if (f.size > 15 * 1024 * 1024) throw new Error("El archivo supera 15 MB.");
        const s = await api("/api/adjunto/subir", { id_lote: d.lote.id_lote, tipo, descripcion: "Soporte del registro", nombre: f.name, contenido: await _leerArchivo(f) });
        ids.push(s.id);
      }
      await api(editar ? "/api/registro/editar" : "/api/registro/registrar", { ...x, venta_id: v.id, adjuntos: ids });
      await trasGuardar(editar ? "Registro actualizado" : "Escritura registrada: el lote quedó en estado Registrado");
    },
  });
}

function formAnularRegistro(d, v) {
  modal(`Anular registro · ${d.lote.id_lote}`, `<p class="texto-modal">El lote volverá a estado <b>Escriturado</b>. El registro anulado queda en el historial y en la auditoría.</p>
    <div class="form-grid">${campo("", "Motivo", `<input name="motivo" required>`, { req: true, cls: "c2" })}</div>`, {
    boton: "Anular registro", peligro: true,
    enviar: async (x) => { await api("/api/registro/anular", { venta_id: v.id, motivo: x.motivo }); await trasGuardar("Registro anulado"); },
  });
}

// Ficha integral en PDF: apartado «Escritura y registro» después de «Condiciones del negocio»
const _hojaDeVidaBase = hojaDeVidaHTML;
hojaDeVidaHTML = function (d) {
  const h = _hojaDeVidaBase(d);
  const v = d.ventas.find((x) => x.estado === "ACTIVA");
  if (!v || !v.numero_escritura && !v.registro) return h;
  const r = v.registro, fila = (a, b, c2, d2) => `<tr><th>${a}</th><td>${b}</td><th>${c2}</th><td>${d2}</td></tr>`;
  const sec = `<h2><span>4b</span>Escritura y registro</h2><table class="ficha ancha cols">
      ${fila("Escritura", v.numero_escritura ? `N° ${esc(v.numero_escritura)} del ${fecha(v.fecha_escritura)}` : "—", "Notaría", esc(v.notaria || "—"))}
      ${r ? fila("Matrícula inmobiliaria", `<b>${esc(r.matricula_inmobiliaria)}</b>`, "Oficina de registro (ORIP)", esc(r.orip)) +
        fila("Fecha de registro", fecha(r.fecha_registro), "Anotación", esc(r.numero_anotacion || "—")) +
        fila("Propietario inscrito", esc(r.propietario_inscrito || "—"), "N° predial", esc(r.numero_predial || "—"))
        : fila("Registro", "Pendiente de inscripción en la ORIP", "", "")}
    </table>`;
  return h.replace(/<h2><span>5<\/span>/, sec + "<h2><span>5</span>");
};
