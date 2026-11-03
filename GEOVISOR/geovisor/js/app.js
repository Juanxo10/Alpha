/* ==========================================================================
   Geovisor de ventas y cartera del loteo
   Cartografía: data/*.geojson (exportada desde LOTEO_MERCED.gpkg)
   Contabilidad: API local de servir.py sobre datos/contabilidad.sqlite
   ========================================================================== */
"use strict";

// ------------------------------------------------------------------ catálogos
const ESTADOS = {
  DISPONIBLE: { nom: "Disponible", c: "#E3FBEF" },
  SEPARADO: { nom: "Separado", c: "#F5B841" },
  VENDIDO: { nom: "Vendido con saldo", c: "#3B82F6" },
  PAGADO: { nom: "Pagado", c: "#8B5CF6" },
  ESCRITURADO: { nom: "Escriturado", c: "#1E3A8A" },
  BLOQUEADO: { nom: "Bloqueado", c: "#94A3B8" },
};
const CARTERA = {
  AL_DIA: { nom: "Al día", c: "#22C55E" },
  MORA_30: { nom: "Mora 1–30 días", c: "#FACC15" },
  MORA_90: { nom: "Mora 31–90 días", c: "#F97316" },
  MORA_MAS_90: { nom: "Mora más de 90 días", c: "#DC2626" },
  PAGADO: { nom: "Pagado", c: "#8B5CF6" },
  SEPARADO: { nom: "Separado", c: "#F5B841" },
  SEPARACION_VENCIDA: { nom: "Separación vencida", c: "#B45309" },
  SIN: { nom: "Sin negocio", c: "#E5ECEE" },
};
const AVANCE = {
  SIN: { nom: "Sin negocio", c: "#E5ECEE" },
  A0: { nom: "0 – 25 %", c: "#CFF7E5" },
  A25: { nom: "25 – 50 %", c: "#8DEBC5" },
  A50: { nom: "50 – 75 %", c: "#3FCB93" },
  A75: { nom: "75 – 99 %", c: "#13906A" },
  A100: { nom: "100 % pagado", c: "#0C4F44" },
};
const TEMAS = {
  estado: { cat: ESTADOS, clave: (l) => l.estado, ayuda: "Situación comercial de cada lote." },
  cartera: { cat: CARTERA, clave: (l) => l.cartera || "SIN", ayuda: "Comportamiento de pago de los lotes negociados." },
  avance: {
    cat: AVANCE, ayuda: "Porcentaje del valor del negocio ya pagado.",
    clave: (l) => !l.venta_id ? "SIN" : l.pct_pagado >= 99.99 ? "A100" : l.pct_pagado >= 75 ? "A75"
      : l.pct_pagado >= 50 ? "A50" : l.pct_pagado >= 25 ? "A25" : "A0",
  },
};
const MEDIOS = ["Efectivo", "Transferencia", "Consignación", "Cheque", "Tarjeta"];
const CONCEPTOS = ["Cuota", "Cuota inicial", "Abono a capital", "Separación", "Pago total"];
const TIPOS_DOC = ["CC", "CE", "NIT", "PP", "TI", "PPT"];
const EN_MORA = ["MORA_30", "MORA_90", "MORA_MAS_90"];

// ------------------------------------------------------------------ estado
const E = {
  lotes: [], porId: {}, props: {}, resumen: null, config: {}, pagos: [],
  tema: "estado", ocultas: new Set(), manzana: "", sel: null, detalle: null,
  base: "satelite", orto: null, mapa: null, hover: null, mapaListo: false, cola: [],
  orden: { cartera: { k: "id_lote", asc: true }, pagos: { k: "recibo", asc: false } },
};
// Ejecuta f cuando el estilo del mapa ya cargó (antes de eso MapLibre rechaza filtros y feature-state)
function enMapa(f) { if (E.mapaListo) f(); else E.cola.push(f); }
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ------------------------------------------------------------------ formatos
const fmtCOP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fmtN = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const fmtN1 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });
const pesos = (v) => (v === null || v === undefined || v === "") ? "—" : fmtCOP.format(Math.round(v)).replace(/\s/g, " ");
function pesosCorto(v) {
  v = Number(v) || 0;
  const a = Math.abs(v);
  if (a >= 1e9) return "$" + fmtN1.format(v / 1e9) + " mil M";
  if (a >= 1e6) return "$" + fmtN1.format(v / 1e6) + " M";
  return pesos(v);
}
const m2 = (v) => fmtN1.format(v) + " m²";
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_L = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function fecha(s) {
  if (!s) return "—";
  const [a, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
function fechaLarga(s) {
  const [a, m, d] = s.slice(0, 10).split("-").map(Number);
  return `${d} de ${MESES_L[m - 1]} de ${a}`;
}
const hoyISO = () => new Date().toLocaleDateString("sv-SE");
function sumarMeses(iso, n) {
  const [a, m, d] = iso.split("-").map(Number);
  const t = new Date(a, m - 1 + n, 1);
  const ult = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d, ult));
  return t.toLocaleDateString("sv-SE");
}
const sumarDias = (iso, n) => { const t = new Date(iso + "T12:00"); t.setDate(t.getDate() + n); return t.toLocaleDateString("sv-SE"); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const chip = (k, cat) => k ? `<span class="chip ${k}">${esc((cat || ESTADOS)[k]?.nom || k)}</span>` : "";
const chipCartera = (k) => k && !["SEPARADO", "PAGADO"].includes(k) ? chip(k, CARTERA) : "";
const iconos = () => window.lucide && lucide.createIcons();
const nombreLote = (id) => { const l = E.porId[id]; return l ? `Manzana ${l.manzana} · Lote ${l.lote}` : id; };

// ------------------------------------------------------------------ API
// Toda llamada lleva la sesión. Si la operación requiere aprobación, el servidor responde «pendiente»:
// se muestra el aviso y se lanza Pendiente para que el formulario no siga como si se hubiera aplicado.
class Pendiente extends Error { constructor(d) { super(d.mensaje || "Pendiente de aprobación"); this.datos = d; } }
function usuario() { return E.sesion?.nombre || ""; }
async function api(ruta, datos) {
  const headers = { "X-Sesion": E.token || "" };
  const op = datos === undefined ? { headers } : {
    method: "POST", body: JSON.stringify(datos), headers: { ...headers, "Content-Type": "application/json" },
  };
  let r;
  try { r = await fetch(ruta, op); } catch {
    throw new Error("Se perdió la conexión con el geovisor. Verifique que la ventana negra (ABRIR_GEOVISOR.bat) siga abierta; si la cerró, ábrala de nuevo y recargue la página (F5).");
  }
  const j = await r.json().catch(() => ({ error: "Respuesta no válida del servidor" }));
  if (r.status === 401 && !E.mismaVentana) { sesionVencida(); throw new Pendiente({ mensaje: "Sesión vencida" }); }
  if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
  if (j.pendiente) { mostrarPendiente(j); throw new Pendiente(j); }
  return j;
}
// errores de una operación: si quedó pendiente de aprobación ya se avisó; lo demás se muestra en rojo
function falla(e) { if (!(e instanceof Pendiente)) aviso(e.message, true); }
function aviso(txt, error = false) {
  const d = document.createElement("div");
  d.className = "aviso" + (error ? " error" : "");
  d.innerHTML = `<i data-lucide="${error ? "alert-triangle" : "check-circle-2"}"></i><span>${esc(txt)}</span>`;
  $("#avisos").appendChild(d);
  iconos();
  setTimeout(() => d.remove(), error ? 6500 : 3800);
}

// ================================================================== ARRANQUE
async function iniciar() {
  iconos();
  const q0 = new URLSearchParams(location.search);
  if (q0.get("t")) E.token = q0.get("t");
  else { try { E.token = sessionStorage.getItem("gv_token") || ""; } catch { E.token = ""; } }
  const est = await fetch("/api/sesion/estado", { headers: { "X-Sesion": E.token || "" } }).then((r) => r.json());
  if (est.sesion) E.sesion = est.sesion;
  else if (q0.get("t")) throw new Error("El enlace del documento venció.");
  else await pantallaIngreso(est);
  const [lotesGeo, manz, manzEtq, vias, zv, cano, limite, cfg] = await Promise.all([
    fetch("data/lotes.geojson").then((r) => r.json()),
    fetch("data/manzanas.geojson").then((r) => r.json()),
    fetch("data/manzanas_etq.geojson").then((r) => r.json()),
    fetch("data/vias.geojson").then((r) => r.json()),
    fetch("data/zonas_verdes.geojson").then((r) => r.json()),
    fetch("data/cano.geojson").then((r) => r.json()),
    fetch("data/limite.geojson").then((r) => r.json()),
    api("/api/config"),
  ]);
  E.orto = await fetch("data/orto/orto.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  E.geo = { lotesGeo, manz, manzEtq, vias, zv, cano, limite };
  lotesGeo.features.forEach((f) => (E.props[f.properties.id_lote] = f.properties));
  aplicarConfig(cfg);
  const q = new URLSearchParams(location.search);
  const modoDoc = ["recibo", "estado", "informe", "hoja", "comisionista", "egreso", "doc"].some((k) => q.has(k));
  prepararUI();
  if (!modoDoc) iniciarMapa();
  await recargar();
  if (q.get("vista")) cambiarVista(q.get("vista"));
  if (q.get("lote") && E.porId[q.get("lote")]) irALote(q.get("lote"));
  // ?recibo=N, ?estado=MZ01-L001 o ?informe=1 abren el documento en esta misma pestaña (sin diálogo de impresión)
  if (q.get("recibo")) { E.mismaVentana = true; return imprimirRecibo(+q.get("recibo")); }
  if (q.get("estado")) { E.mismaVentana = true; return imprimirEstadoCuenta(await api("/api/lote?id=" + q.get("estado"))); }
  if (q.get("informe")) { E.mismaVentana = true; return imprimirInforme(); }
  if (q.get("hoja")) { E.mismaVentana = true; return imprimirHoja(await api("/api/lote?id=" + q.get("hoja"))); }
  if (q.get("comisionista")) { E.mismaVentana = true; return imprimirInformeComisionista(await api("/api/comisionista?id=" + q.get("comisionista"))); }
  if (q.get("egreso")) { E.mismaVentana = true; return imprimirEgreso(+q.get("egreso")); }
  if (q.get("doc")) { E.mismaVentana = true; return abrirDocumento(q.get("doc"), q.get("id")); }
  aplicarSesionUI();
}

function aplicarConfig(cfg) {
  E.config = cfg;
  $("#tProyecto").textContent = cfg.proyecto || "Loteo";
  $("#tSubtitulo").textContent = cfg.subtitulo || "";
  document.title = `${cfg.proyecto || "Loteo"} · Ventas y cartera`;
}

async function recargar() {
  const [lotes, resumen] = await Promise.all([api("/api/lotes"), api("/api/resumen")]);
  E.lotes = lotes;
  E.porId = Object.fromEntries(lotes.map((l) => [l.id_lote, l]));
  E.resumen = resumen;
  pintarMapa();
  pintarKpisMini();
  pintarLeyenda();
  pintarGestion();
  const vista = $(".vista.activa").id.replace("vista-", "");
  if (vista === "tablero") pintarTablero();
  if (vista === "cartera") pintarCartera();
  if (vista === "pagos") await pintarPagos(true);
  if (vista === "comisionistas") await pintarComisionistas();
  if (VISTAS_EXTRA[vista]) await VISTAS_EXTRA[vista]();
  if (E.sel && $("#ficha").classList.contains("abierta")) await abrirFicha(E.sel, { sinZoom: true });
}

// ================================================================== UI GENERAL
function prepararUI() {
  $$("#tabs [data-vista]").forEach((b) => b.addEventListener("click", () => { cerrarMenus(); cambiarVista(b.dataset.vista); }));
  $$("#tabs .g-btn").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const g = b.parentElement, abierto = g.classList.contains("abierto");
    cerrarMenus();
    g.classList.toggle("abierto", !abierto);
  }));
  document.addEventListener("click", cerrarMenus);
  // las descargas de la API (Excel) necesitan la sesión: se bajan por fetch
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="/api/"]');
    if (a) { e.preventDefault(); descargarArchivo(a.getAttribute("href"), a); }
  });
  $("#btnAvisos").addEventListener("click", abrirAvisos);
  $("#btnAyuda").addEventListener("click", abrirAyuda);
  $$("#temas button").forEach((b) => b.addEventListener("click", () => {
    $$("#temas button").forEach((x) => x.classList.toggle("activo", x === b));
    E.tema = b.dataset.tema;
    E.ocultas.clear();
    pintarMapa();
    pintarLeyenda();
  }));
  const manzanas = [...new Set(E.geo.lotesGeo.features.map((f) => f.properties.manzana))].sort((a, b) => a - b);
  const opts = manzanas.map((m) => `<option value="${m}">Manzana ${String(m).padStart(2, "0")}</option>`).join("");
  $("#fManzana").insertAdjacentHTML("beforeend", opts);
  $("#cManzana").insertAdjacentHTML("beforeend", opts);
  $("#fManzana").addEventListener("change", (e) => filtrarManzana(e.target.value));
  $$("#bases button").forEach((b) => b.addEventListener("click", () => cambiarBase(b.dataset.base)));
  $("#chkEtq").addEventListener("change", (e) => enMapa(() => E.mapa.setLayoutProperty("lotes-num", "visibility", e.target.checked ? "visible" : "none")));
  $("#rngOpac").addEventListener("input", (e) => {
    $("#tOpac").textContent = e.target.value + " %";
    enMapa(() => E.mapa.setPaintProperty("lotes", "fill-opacity", opacidadLotes(e.target.value / 100)));
  });
  $("#btnConfig").addEventListener("click", abrirConfig);
  $("#btnNuevoCom").addEventListener("click", () => formComisionista());
  ["comBuscar", "comEstado"].forEach((id) => $("#" + id).addEventListener("input", () => filtrarComisionistas()));
  $("#btnUsuario").addEventListener("click", abrirCuenta);
  $("#btnInforme").addEventListener("click", imprimirInforme);
  prepararBuscador();
  ["cBuscar", "cEstado", "cCartera", "cManzana"].forEach((id) => $("#" + id).addEventListener("input", pintarCartera));
  ["pBuscar", "pDesde", "pHasta", "pAnulados"].forEach((id) => $("#" + id).addEventListener("input", () => pintarPagos(false)));
  $("#modal").addEventListener("mousedown", (e) => { if (e.target.id === "modal") cerrarModal(); });
  $("#modal [data-cerrar]").addEventListener("click", cerrarModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if ($("#modal").classList.contains("visible")) cerrarModal(); else cerrarFicha(); }
  });
  if (E.orto) {
    const b = $("#baseOrto");
    b.disabled = false;
    b.querySelector("em").remove();
    b.title = `${E.orto.descripcion || "Ortofoto del loteo"}${E.orto.resolucion_cm ? ` · ${E.orto.resolucion_cm} cm/px` : ""}`;
  }
}

const VISTAS_EXTRA = {
  cobranza: () => pintarCobranza(), prospectos: () => pintarProspectos(), gastos: () => pintarGastos(),
  flujo: () => pintarFlujo(), conciliacion: () => pintarConciliacion(), aprobaciones: () => pintarAprobaciones(),
  usuarios: () => pintarUsuarios(), auditoria: () => pintarAuditoria(),
};
function cerrarMenus() { $$("#tabs .grupo").forEach((g) => g.classList.remove("abierto")); }
function cambiarVista(v) {
  $$("#tabs [data-vista]").forEach((b) => b.classList.toggle("activo", b.dataset.vista === v));
  $$("#tabs .grupo").forEach((g) => g.classList.toggle("activo", !!g.querySelector(`[data-vista="${v}"]`)));
  $$(".vista").forEach((s) => s.classList.toggle("activa", s.id === "vista-" + v));
  if (VISTAS_EXTRA[v]) VISTAS_EXTRA[v]().catch(falla);
  if (v === "mapa") setTimeout(() => E.mapa.resize(), 30);
  if (v === "tablero") pintarTablero();
  if (v === "cartera") pintarCartera();
  if (v === "pagos") pintarPagos(true);
  if (v === "comisionistas") pintarComisionistas();
}

// ------------------------------------------------------------------ buscador
function prepararBuscador() {
  const inp = $("#buscar"), caja = $("#sugerencias");
  let idx = 0, res = [];
  const pinta = () => {
    caja.innerHTML = res.length ? res.map((l, i) => `<div class="sug ${i === idx ? "sel" : ""}" data-id="${l.id_lote}">
        <span class="sug-id">${l.id_lote}</span><span class="sug-txt">${esc(l.cliente || ESTADOS[l.estado].nom)}${l.documento ? " · " + esc(l.documento) : ""}</span>
        ${chip(l.estado)}</div>`).join("") : `<div class="sug-vacia">Sin resultados para «${esc(inp.value)}»</div>`;
    caja.classList.add("visible");
  };
  inp.addEventListener("input", () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { caja.classList.remove("visible"); return; }
    res = buscarLotes(q).slice(0, 10);
    idx = 0;
    pinta();
  });
  inp.addEventListener("keydown", (e) => {
    if (!caja.classList.contains("visible")) return;
    if (e.key === "ArrowDown") { idx = Math.min(idx + 1, res.length - 1); pinta(); e.preventDefault(); }
    if (e.key === "ArrowUp") { idx = Math.max(idx - 1, 0); pinta(); e.preventDefault(); }
    if (e.key === "Enter" && res[idx]) ir(res[idx].id_lote);
  });
  caja.addEventListener("mousedown", (e) => { const s = e.target.closest(".sug"); if (s) ir(s.dataset.id); });
  inp.addEventListener("blur", () => setTimeout(() => caja.classList.remove("visible"), 150));
  function ir(id) { caja.classList.remove("visible"); inp.value = ""; inp.blur(); irALote(id); }
}
function buscarLotes(q) {
  const m = q.match(/^\s*(?:mz|m|manzana)?\s*0*(\d{1,2})\s*[-–\s.,/l]+\s*(?:l|lote)?\s*0*(\d{1,3})\s*$/i);
  if (m) {
    const id = `MZ${m[1].padStart(2, "0")}-L${m[2].padStart(3, "0")}`;
    if (E.porId[id]) return [E.porId[id]];
  }
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const qn = norm(q), qd = q.replace(/\D/g, "");
  return E.lotes.filter((l) => norm(l.id_lote).includes(qn) || norm(l.cliente).includes(qn)
    || (qd.length >= 4 && (l.documento || "").includes(qd)));
}
function irALote(id) {
  cambiarVista("mapa");
  const f = E.geo.lotesGeo.features.find((x) => x.properties.id_lote === id);
  const [[a, b], [c, d]] = bbox(f);
  enMapa(() => {
    E.mapa.once("moveend", () => abrirTarjeta(id, [(a + c) / 2, (b + d) / 2]));
    E.mapa.fitBounds([[a, b], [c, d]], { padding: { top: 480, bottom: 40, left: 60, right: 60 }, maxZoom: 19.2, duration: 700 });
  });
}

// ================================================================== MAPA
function iniciarMapa() {
  const esri = (s) => `https://server.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`;
  const fuentes = {
    satelite: { type: "raster", tiles: [esri("World_Imagery")], tileSize: 256, maxzoom: 18, attribution: "Imagen © Esri, Maxar" },
    claro: { type: "raster", tiles: [esri("Canvas/World_Light_Gray_Base")], tileSize: 256, maxzoom: 16, attribution: "© Esri" },
    lotes: { type: "geojson", data: E.geo.lotesGeo, promoteId: "id_lote" },
    manzanas: { type: "geojson", data: E.geo.manz },
    manzanasEtq: { type: "geojson", data: E.geo.manzEtq },
    vias: { type: "geojson", data: E.geo.vias },
    zv: { type: "geojson", data: E.geo.zv },
    cano: { type: "geojson", data: E.geo.cano },
    limite: { type: "geojson", data: E.geo.limite },
  };
  if (E.orto) {
    fuentes.orto = { type: "raster", tiles: [`data/orto/{z}/{x}/{y}.${E.orto.ext || "png"}`], tileSize: 256, scheme: E.orto.scheme || "xyz",
      minzoom: E.orto.minzoom, maxzoom: E.orto.maxzoom, bounds: E.orto.bounds, attribution: E.orto.atribucion || "Ortofoto del proyecto" };
  }
  const capas = [
    { id: "fondo", type: "background", paint: { "background-color": "#E8EEEF" } },
    { id: "base-satelite", type: "raster", source: "satelite" },
    { id: "base-claro", type: "raster", source: "claro", layout: { visibility: "none" } },
  ];
  if (E.orto) capas.push({ id: "base-orto", type: "raster", source: "orto", layout: { visibility: "none" } });
  capas.push(
    { id: "vias", type: "fill", source: "vias", paint: { "fill-color": "#D9DEE0", "fill-opacity": 0.55 } },
    { id: "zv", type: "fill", source: "zv", paint: {
      "fill-color": ["match", ["get", "tipo"], "RONDA HIDRICA DEL CAÑO", "#7CC4E8", "#6DBE5B"], "fill-opacity": 0.45 } },
    { id: "zv-borde", type: "line", source: "zv", paint: { "line-color": ["match", ["get", "tipo"], "RONDA HIDRICA DEL CAÑO", "#1E78AA", "#3B8A2E"], "line-width": 1 } },
    { id: "cano", type: "line", source: "cano", paint: { "line-color": "#1D6FD1", "line-width": ["interpolate", ["linear"], ["zoom"], 15, 1.5, 19, 3.5] } },
    { id: "lotes", type: "fill", source: "lotes", paint: {
      "fill-color": ["to-color", ["coalesce", ["feature-state", "c"], "#CBD5E1"]],
      "fill-opacity": opacidadLotes(0.78) } },
    { id: "lotes-borde", type: "line", source: "lotes", paint: {
      "line-color": "#FFFFFF", "line-opacity": ["case", ["boolean", ["feature-state", "oculto"], false], 0.25, 0.9],
      "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.3, 19, 1.2] } },
    { id: "manzanas", type: "line", source: "manzanas", paint: { "line-color": "#0C2E37", "line-width": ["interpolate", ["linear"], ["zoom"], 15, 1, 19, 2.4] } },
    { id: "limite", type: "line", source: "limite", paint: { "line-color": "#E11D48", "line-width": 2.2, "line-dasharray": [3, 2] } },
    { id: "lote-hover", type: "line", source: "lotes", filter: ["==", ["get", "id_lote"], ""], paint: { "line-color": "#0C2E37", "line-width": 2 } },
    { id: "lote-sel-halo", type: "line", source: "lotes", filter: ["==", ["get", "id_lote"], ""], paint: { "line-color": "#FFFFFF", "line-width": 7 } },
    { id: "lote-sel", type: "line", source: "lotes", filter: ["==", ["get", "id_lote"], ""], paint: { "line-color": "#0C2E37", "line-width": 3.5 } },
    { id: "lotes-num", type: "symbol", source: "lotes", minzoom: 17.6, layout: {
      "text-field": ["to-string", ["get", "lote"]], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 17.6, 9, 20, 14],
      "text-allow-overlap": false }, paint: { "text-color": "#0C2E37", "text-halo-color": "rgba(255,255,255,.9)", "text-halo-width": 1.3 } },
    { id: "manzanas-etq", type: "symbol", source: "manzanasEtq", minzoom: 14.5, layout: {
      "text-field": ["concat", "MZ ", ["slice", ["get", "id_manzana"], 2]], "text-font": ["Open Sans Semibold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 15, 10, 18, 15], "text-allow-overlap": false },
      paint: { "text-color": "#FFFFFF", "text-halo-color": "#0C2E37", "text-halo-width": 2.2, "text-opacity": ["interpolate", ["linear"], ["zoom"], 17.3, 1, 17.8, 0] } },
  );
  const caja = bbox(E.geo.limite);
  E.mapa = new maplibregl.Map({
    container: "mapa", bounds: caja, fitBoundsOptions: { padding: 40 }, maxZoom: E.orto ? 23 : 21.5, attributionControl: { compact: true },
    style: { version: 8, glyphs: "lib/fonts/{fontstack}/{range}.pbf", sources: fuentes, layers: capas },
  });
  E.mapa.once("style.load", () => { E.mapaListo = true; E.cola.splice(0).forEach((f) => f()); });
  if (E.orto) enMapa(() => {  // con ortofoto disponible, es la base por defecto y los lotes se aclaran para verla
    cambiarBase("orto");
    const r = $("#rngOpac");
    r.value = 55;
    r.dispatchEvent(new Event("input"));
  });
  E.mapa.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
  E.mapa.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
  const ctlInicio = document.createElement("div");
  ctlInicio.className = "maplibregl-ctrl maplibregl-ctrl-group";
  ctlInicio.innerHTML = `<button title="Ver todo el loteo" style="display:grid;place-items:center"><i data-lucide="maximize"></i></button>`;
  ctlInicio.onclick = () => E.mapa.fitBounds(caja, { padding: 40 });
  E.mapa.addControl({ onAdd: () => ctlInicio, onRemove: () => {} }, "top-right");
  iconos();

  const tt = $("#tooltip");
  E.mapa.on("mousemove", "lotes", (e) => {
    const id = e.features[0].properties.id_lote;
    E.mapa.getCanvas().style.cursor = "pointer";
    if (E.hover !== id) {
      if (E.hover) E.mapa.setFeatureState({ source: "lotes", id: E.hover }, { hover: false });
      E.hover = id;
      E.mapa.setFeatureState({ source: "lotes", id }, { hover: true });
      E.mapa.setFilter("lote-hover", ["==", ["get", "id_lote"], id]);
      tt.innerHTML = htmlTooltip(id);
    }
    const r = $(".mapa-wrap").getBoundingClientRect();
    const x = e.point.x + 16, y = e.point.y + 16;
    tt.style.display = "block";
    tt.style.left = Math.min(x, r.width - tt.offsetWidth - 10) + "px";
    tt.style.top = Math.min(y, r.height - tt.offsetHeight - 10) + "px";
  });
  E.mapa.on("mouseleave", "lotes", () => {
    E.mapa.getCanvas().style.cursor = "";
    if (E.hover) E.mapa.setFeatureState({ source: "lotes", id: E.hover }, { hover: false });
    E.hover = null;
    E.mapa.setFilter("lote-hover", ["==", ["get", "id_lote"], ""]);
    tt.style.display = "none";
  });
  E.mapa.on("click", "lotes", (e) => abrirTarjeta(e.features[0].properties.id_lote, e.lngLat));
  E.mapa.on("mousemove", (e) => { $("#coords").textContent = `${e.lngLat.lat.toFixed(6)}, ${e.lngLat.lng.toFixed(6)}`; });
  E.mapa.on("error", (e) => { if (!(e && e.sourceId)) console.warn(e); });
}

function opacidadLotes(o) {
  return ["case", ["boolean", ["feature-state", "oculto"], false], 0.06 * o,
    ["boolean", ["feature-state", "hover"], false], Math.min(o + 0.17, 1), o];
}

function bbox(fc) {
  let b = [180, 90, -180, -90];
  const rec = (c) => { if (typeof c[0] === "number") { b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])]; } else c.forEach(rec); };
  (fc.features || [fc]).forEach((f) => rec(f.geometry.coordinates));
  return [[b[0], b[1]], [b[2], b[3]]];
}

function htmlTooltip(id) {
  const l = E.porId[id], p = E.props[id];
  if (!l) return id;
  let h = `<div class="tt-cab"><span class="tt-id">${id}</span>${chip(l.estado)}</div>
    <div class="tt-fila"><span>Área</span><b>${m2(p.area_m2)}</b></div>`;
  if (l.venta_id) {
    h += `<div class="tt-fila"><span>Comprador</span><b>${esc(l.cliente)}</b></div>
      <div class="tt-fila"><span>Saldo</span><b>${pesos(l.saldo)}</b></div>`;
    if (l.dias_mora) h += `<div class="tt-fila"><span>En mora</span><b style="color:#DC2626">${l.dias_mora} días · ${pesos(l.vencido)}</b></div>`;
  } else {
    h += `<div class="tt-fila"><span>Precio</span><b>${l.precio_lista ? pesos(l.precio_lista) : "Sin precio"}</b></div>`;
  }
  return h;
}

function claveTema(l) { return TEMAS[E.tema].clave(l); }

function pintarMapa() {
  if (!E.mapa) return;
  const aplicar = () => {
    const cat = TEMAS[E.tema].cat;
    E.lotes.forEach((l) => {
      const k = claveTema(l);
      const oculto = E.ocultas.has(k) || (E.manzana && String(l.manzana) !== E.manzana);
      E.mapa.setFeatureState({ source: "lotes", id: l.id_lote }, { c: cat[k]?.c || "#CBD5E1", oculto });
    });
  };
  enMapa(aplicar);
}

function pintarLeyenda() {
  const t = TEMAS[E.tema], cuenta = {}, valor = {};
  E.lotes.forEach((l) => {
    const k = claveTema(l);
    cuenta[k] = (cuenta[k] || 0) + 1;
    valor[k] = (valor[k] || 0) + (E.tema === "cartera" && EN_MORA.includes(k) ? l.vencido : l.saldo || 0);
  });
  $("#leyenda").innerHTML = `<div class="ley-ayuda">${t.ayuda} Clic en una categoría para ocultarla.</div>` +
    Object.entries(t.cat).filter(([k]) => cuenta[k] || ["DISPONIBLE", "VENDIDO", "AL_DIA", "SIN"].includes(k)).map(([k, v]) => {
      const extra = E.tema === "cartera" && EN_MORA.includes(k) && cuenta[k] ? `<span class="val">${pesos(valor[k])} vencidos</span>` : "";
      return `<div class="ley ${E.ocultas.has(k) ? "off" : ""}" data-k="${k}"><span class="sw" style="background:${v.c}"></span>
        <span class="nom">${v.nom}${extra}</span><span class="cnt">${fmtN.format(cuenta[k] || 0)}</span></div>`;
    }).join("");
  $$("#leyenda .ley").forEach((d) => d.addEventListener("click", () => {
    const k = d.dataset.k;
    E.ocultas.has(k) ? E.ocultas.delete(k) : E.ocultas.add(k);
    d.classList.toggle("off");
    pintarMapa();
  }));
}

function filtrarManzana(m) {
  E.manzana = m;
  $("#fManzana").value = m;
  pintarMapa();
  const nota = $("#notaFiltro");
  if (!m) { nota.innerHTML = ""; E.mapa.fitBounds(bbox(E.geo.limite), { padding: 40 }); return; }
  const f = E.geo.manz.features.find((x) => String(x.properties.manzana) === m);
  E.mapa.fitBounds(bbox(f), { padding: 80, maxZoom: 19 });
  const ls = E.lotes.filter((l) => String(l.manzana) === m);
  const vend = ls.filter((l) => l.venta_id).length;
  nota.innerHTML = `<b>${ls.length}</b> lotes · ${vend} negociados · ${ls.length - vend} libres<br>Saldo por cobrar: <b>${pesos(ls.reduce((s, l) => s + l.saldo, 0))}</b>`;
}

function cambiarBase(b) {
  E.base = b;
  $$("#bases button").forEach((x) => x.classList.toggle("activo", x.dataset.base === b));
  ["satelite", "claro", "orto"].forEach((x) => E.mapa.getLayer("base-" + x) &&
    E.mapa.setLayoutProperty("base-" + x, "visibility", x === b ? "visible" : "none"));
  if (b === "orto" && E.orto) {
    // debajo de la ortofoto se deja el satélite para que no queden huecos fuera de su cobertura
    E.mapa.setLayoutProperty("base-satelite", "visibility", "visible");
  }
}

// ------------------------------------------------------------------ KPIs del panel
// % de recaudo = lo recaudado sobre el valor total negociado (ventas + separaciones activas)
function pctRecaudo(r) { const neg = r.valor_vendido + r.valor_separado; return neg ? (100 * r.recaudado) / neg : 0; }
function pintarKpisMini() {
  const r = E.resumen, c = r.conteo;
  const vendidos = (c.VENDIDO || 0) + (c.PAGADO || 0) + (c.ESCRITURADO || 0);
  const pctRec = pctRecaudo(r);
  $("#kpisMini").innerHTML = `
    <div class="km ancho"><div class="et"><i data-lucide="wallet"></i>Recaudado</div>
      <div class="va">${pesos(r.recaudado)}</div>
      <div class="sub">${fmtN1.format(pctRec)} % de lo negociado · por cobrar ${pesosCorto(r.cartera)}</div>
      <div class="barra"><i style="width:${pctRec}%;background:var(--menta)"></i></div></div>
    <div class="km"><div class="et">Vendidos</div><div class="va">${fmtN.format(vendidos)}</div><div class="sub">de ${fmtN.format(r.total_lotes)} lotes</div></div>
    <div class="km"><div class="et">Disponibles</div><div class="va">${fmtN.format(c.DISPONIBLE || 0)}</div><div class="sub">${fmtN.format(c.SEPARADO || 0)} separados</div></div>
    <div class="km ${r.lotes_mora ? "alerta" : ""}"><div class="et">En mora</div><div class="va">${fmtN.format(r.lotes_mora)}</div><div class="sub">${pesosCorto(r.vencido)} vencidos</div></div>
    <div class="km"><div class="et">Recaudo del mes</div><div class="va">${pesosCorto(r.recaudo_mes)}</div><div class="sub">${MESES_L[new Date().getMonth()]}</div></div>`;
  iconos();
}

function pintarGestion() {
  const ls = E.lotes.filter((l) => l.cartera === "SEPARACION_VENCIDA" || (EN_MORA.includes(l.cartera) && l.dias_mora > 30))
    .sort((a, b) => (b.dias_mora || 0) - (a.dias_mora || 0));
  $("#gestion").innerHTML = ls.length ? ls.slice(0, 40).map((l) => `<div class="ges" data-id="${l.id_lote}">
      <span class="ges-id">${l.id_lote}</span><span class="ges-txt">${esc(l.cliente)}</span>
      <span class="ges-v ${l.cartera === "SEPARACION_VENCIDA" ? "amb" : ""}">${l.cartera === "SEPARACION_VENCIDA" ? "Sep. vencida" : l.dias_mora + " d · " + pesosCorto(l.vencido)}</span></div>`).join("")
    + (ls.length > 40 ? `<div class="ley-ayuda">… y ${ls.length - 40} más (ver Cartera)</div>` : "")
    : `<div class="ley-ayuda">No hay moras mayores a 30 días ni separaciones vencidas.</div>`;
  $("#gestionN").textContent = ls.length || "";
  $$("#gestion .ges").forEach((d) => d.addEventListener("click", () => abrirFicha(d.dataset.id)));
}

// ================================================================== TARJETA DEL LOTE (al tocar un lote)
async function abrirTarjeta(id, lngLat) {
  let d;
  try { d = await api("/api/lote?id=" + encodeURIComponent(id)); } catch (e) { falla(e); return; }
  E.sel = id;
  enMapa(() => ["lote-sel", "lote-sel-halo"].forEach((c) => E.mapa.setFilter(c, ["==", ["get", "id_lote"], id])));
  if (E.popup) E.popup.remove();
  // la tarjeta abre hacia donde haya más espacio dentro del mapa
  const pt = E.mapa.project(lngLat), alto = E.mapa.getContainer().clientHeight, ancho = E.mapa.getContainer().clientWidth;
  const anchor = (pt.y > alto / 2 ? "bottom" : "top") + (pt.x < 200 ? "-left" : pt.x > ancho - 200 ? "-right" : "");
  E.popup = new maplibregl.Popup({ closeButton: false, maxWidth: "380px", className: "hv-pop", offset: 12, focusAfterOpen: false, anchor })
    .setLngLat(lngLat).setHTML(htmlTarjeta(d)).addTo(E.mapa);
  E.popup.on("close", () => {
    if (!$("#ficha").classList.contains("abierta")) enMapa(() => ["lote-sel", "lote-sel-halo"].forEach((c) => E.mapa.setFilter(c, ["==", ["get", "id_lote"], ""])));
  });
  iconos();
  const el = E.popup.getElement();
  $$("[data-t]", el).forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.t, v = d.ventas.find((x) => x.estado === "ACTIVA");
    if (a === "cerrar") E.popup.remove();
    if (a === "pdf") descargarPDF("ficha", id, b);
    if (a === "ficha") { E.popup.remove(); abrirFicha(id, { sinZoom: true }); }
    if (a === "pago") formPago(d, v);
    if (a === "vender") formVenta(d, v);
    if (a === "separar") formSeparar(d);
  }));
}

function htmlTarjeta(d) {
  const l = d.lote, r = d.resumen, p = E.props[l.id_lote];
  const v = d.ventas.find((x) => x.estado === "ACTIVA");
  const pm2 = l.precio_lista ? l.precio_lista / l.area_m2 : null;
  const dato = (et, va) => `<div class="t-d"><span>${et}</span><b>${va}</b></div>`;
  let h = `<div class="t-cab"><div><div class="t-id">${l.id_lote}</div><div class="t-tit">Manzana ${l.manzana} · Lote ${l.lote}</div>
      <div class="t-chips">${chip(r.estado)}${chipCartera(r.cartera)}</div></div>
      <button class="t-x" data-t="cerrar" title="Cerrar"><i data-lucide="x"></i></button></div>
    <div class="t-sec"><div class="t-sub">Inmueble</div><div class="t-grid">
      ${dato("Área", `${fmtN1.format(l.area_m2)} m²`)}${dato("Perímetro", `${fmtN1.format(p.perimetro_m)} m`)}${dato("Medidas", `${fmtN1.format(p.frente_m)} × ${fmtN1.format(p.fondo_m)} m`)}
      ${dato("Precio de lista", l.precio_lista ? pesosCorto(l.precio_lista) : "—")}${dato("Valor m²", pm2 ? pesos(pm2) : "—")}
      ${dato("Frente a", esc(frenteA(p)))}</div>
      <div class="t-pct"><div class="t-mini">${planoGeneral(l.id_lote, 132, 64, true)}</div>
        <div><span>Participación en el predio</span><b>${pctPredio(l.id_lote)}</b><small>del área total del predio<br>${areaPredioTxt(l.id_lote)}</small></div></div></div>`;
  if (v) {
    const esSep = v.etapa === "SEPARADO";
    const ult = v.ultimo_pago;
    h += `<div class="t-sec"><div class="t-sub">Comprador</div>
        <div class="t-cli"><b>${esc(v.nombre)}</b><span>${esc(v.tipo_doc)} ${esc(v.documento || "—")}${v.telefono ? ` · <i data-lucide="phone"></i> ${esc(v.telefono)}` : ""}</span></div>
        ${(v.comisiones || []).filter((x) => x.estado === "ACTIVA").map((x) => `<div class="t-com"><i data-lucide="badge-percent"></i>Comisionista: <b>${esc(x.comisionista)}</b> · ${pct(x.porcentaje)}</div>`).join("")}</div>
      <div class="t-sec"><div class="t-sub">${esSep ? "Separación" : "Negocio"}</div><div class="t-grid">
        ${esSep ? dato("Separado el", fecha(v.fecha_separacion)) + dato("Vigente hasta", fecha(v.fecha_limite_separacion)) + dato("Valor pactado", pesosCorto(v.valor_venta))
        : dato("Valor de venta", pesosCorto(v.valor_venta)) + dato("Cuota inicial", `${pesosCorto(v.cuota_inicial)}${v.inicial_pagada ? " ✓" : ""}`)
          + dato("Cuota mensual", v.n_cuotas ? pesos(cuotaDe(v)) : "Contado")
          + dato("Cuotas pagadas", v.n_cuotas ? `${v.cuotas_pagadas} de ${v.cuotas_total}` : "—")
          + dato("Fecha de venta", fecha(v.fecha_venta)) + dato("Termina", v.fecha_fin ? fecha(v.fecha_fin) : "—")}
      </div>
      <div class="t-av"><div class="t-av-txt"><span>Pagado <b>${pesos(v.pagado)}</b></span><span>Saldo <b>${pesos(v.saldo)}</b></span></div>
        <div class="t-barra"><i style="width:${Math.min(v.pct_pagado, 100)}%"></i></div>
        <div class="t-av-pie">${fmtN1.format(v.pct_pagado)} % pagado${ult ? ` · último pago ${pesosCorto(ult.valor)} el ${fecha(ult.fecha)}` : ""}</div></div>
      ${v.dias_mora ? `<div class="t-alerta mal"><i data-lucide="alert-triangle"></i><span><b>${v.dias_mora} días de mora</b> · ${v.cuotas_vencidas} cuota${v.cuotas_vencidas > 1 ? "s" : ""} por ${pesos(v.vencido)}${v.interes_mora > 0 ? ` + interés est. ${pesos(v.interes_mora)}` : ""}</span></div>`
        : v.proxima_cuota ? `<div class="t-alerta"><i data-lucide="calendar-clock"></i><span>Próxima cuota <b>${pesos(v.proxima_cuota.pendiente)}</b> el ${fecha(v.proxima_cuota.fecha)}</span></div>`
        : r.cartera === "PAGADO" ? `<div class="t-alerta ok"><i data-lucide="badge-check"></i><span><b>Pagado en su totalidad</b></span></div>` : ""}
      </div>`;
  }
  h += `<div class="t-acc">
      <button class="btn acento peq" data-t="pdf" title="Ficha integral del lote en PDF"><i data-lucide="file-down"></i>Ficha PDF</button>
      ${v ? `<button class="btn pri peq" data-t="pago"><i data-lucide="hand-coins"></i>Registrar pago</button>`
        : r.estado !== "BLOQUEADO" ? `<button class="btn pri peq" data-t="vender"><i data-lucide="file-signature"></i>Vender</button><button class="btn sec peq" data-t="separar"><i data-lucide="bookmark"></i>Separar</button>` : ""}
      <button class="btn sec peq" data-t="ficha" title="Ficha completa: plan de pagos, historial y más acciones"><i data-lucide="panel-right-open"></i>Ficha</button>
    </div>`;
  return h;
}
// Costado del lote que da a la vía (o el primer colindante que no sea otro lote)
function frenteA(p) {
  const l = (p.linderos || []).find((x) => x.colinda.includes("Vía")) || (p.linderos || []).find((x) => !/^MZ/.test(x.colinda[0]));
  return l ? `${l.colinda.includes("Vía") ? "Vía" : l.colinda[0]} (${l.rumbo.toLowerCase()})` : "—";
}

// ================================================================== FICHA DEL LOTE
async function abrirFicha(id, { sinZoom = false } = {}) {
  if (E.popup) E.popup.remove();
  let d;
  try { d = await api("/api/lote?id=" + encodeURIComponent(id)); } catch (e) { falla(e); return; }
  E.sel = id;
  E.detalle = d;
  enMapa(() => ["lote-sel", "lote-sel-halo"].forEach((c) => E.mapa.setFilter(c, ["==", ["get", "id_lote"], id])));
  $("#fichaCont").innerHTML = htmlFicha(d);
  $("#ficha").classList.add("abierta");
  iconos();
  enlazarFicha(d);
  setTimeout(() => enMapa(() => {
    E.mapa.resize();
    if (!sinZoom) {
      const f = E.geo.lotesGeo.features.find((x) => x.properties.id_lote === id);
      E.mapa.fitBounds(bbox(f), { padding: 120, maxZoom: 19.3, duration: 700 });
    }
  }), 240);
}
function cerrarFicha() {
  E.sel = null;
  $("#ficha").classList.remove("abierta");
  enMapa(() => ["lote-sel", "lote-sel-halo"].forEach((c) => E.mapa.setFilter(c, ["==", ["get", "id_lote"], ""])));
  setTimeout(() => E.mapa.resize(), 240);
}

function htmlFicha(d) {
  const l = d.lote, r = d.resumen, p = E.props[l.id_lote];
  const v = d.ventas.find((x) => x.estado === "ACTIVA");
  const pm2 = l.precio_lista ? l.precio_lista / l.area_m2 : null;
  let h = `<div class="f-cab"><div class="fila1"><div><div class="idl">${l.id_lote}</div><h2>Manzana ${l.manzana} · Lote ${l.lote}</h2></div>
      <button class="icono" data-acc="cerrar" title="Cerrar (Esc)"><i data-lucide="x"></i></button></div>
      <div class="chips">${chip(r.estado)}${chipCartera(r.cartera)}</div></div>
    <div class="f-datos">
      <div><div class="et">Área</div><div class="va">${m2(l.area_m2)}</div></div>
      <div><div class="et">Medidas</div><div class="va">${fmtN1.format(p.frente_m)} × ${fmtN1.format(p.fondo_m)}</div></div>
      <div><div class="et">Precio lista</div><div class="va">${l.precio_lista ? pesosCorto(l.precio_lista) : "—"}</div></div>
      <div><div class="et">Valor m²</div><div class="va">${pm2 ? pesos(pm2) : "—"}</div></div>
    </div>
    <div class="f-pct"><div class="t-mini">${planoGeneral(l.id_lote, 150, 72, true)}</div>
      <div><span>Participación en el predio</span><b>${pctPredio(l.id_lote)}</b><small>del área total del predio: ${areaPredioTxt(l.id_lote)}</small></div></div>`;

  if (v) {
    const esSep = v.etapa === "SEPARADO";
    const prox = v.proxima_cuota;
    let alerta = "";
    if (esSep) {
      const vence = v.fecha_limite_separacion;
      alerta = `<div class="alerta-caja ${r.cartera === "SEPARACION_VENCIDA" ? "mora" : "aviso"}"><i data-lucide="clock"></i><div>
        ${vence ? (r.cartera === "SEPARACION_VENCIDA" ? `La separación <b>venció el ${fecha(vence)}</b>. Formalice la venta o libere el lote.` : `Separación vigente hasta el <b>${fecha(vence)}</b>.`) : "Separación sin fecha límite."}</div></div>`;
    } else if (r.cartera === "PAGADO") {
      alerta = `<div class="alerta-caja ok"><i data-lucide="badge-check"></i><div><b>Negocio pagado en su totalidad.</b>${v.etapa === "ESCRITURADO" ? ` Escriturado el ${fecha(v.fecha_escritura)}.` : " Pendiente de escriturar."}</div></div>`;
    } else if (v.dias_mora > 0) {
      const venc = v.plan.filter((c) => c.estado.startsWith("VENCIDA"));
      alerta = `<div class="alerta-caja mora"><i data-lucide="alert-triangle"></i><div><b>${v.dias_mora} días de mora</b> · ${venc.length} cuota${venc.length > 1 ? "s" : ""} vencida${venc.length > 1 ? "s" : ""} por <b>${pesos(v.vencido)}</b>. La más antigua venció el ${fecha(venc[0].fecha)}.</div></div>`;
    } else if (prox) {
      alerta = `<div class="alerta-caja ok"><i data-lucide="calendar-check"></i><div>Al día. Próxima cuota: <b>${pesos(prox.pendiente)}</b> el ${fecha(prox.fecha)}.</div></div>`;
    }
    h += `<div class="f-sec"><div class="finanzas">
        <div class="fin-top"><span class="et" style="font-size:12px;color:var(--txt-2)">Avance de pago</span><span class="pct">${fmtN1.format(v.pct_pagado)}<small> %</small></span></div>
        <div class="progreso"><i style="width:${Math.min(v.pct_pagado, 100)}%"></i></div>
        <div class="fin-grid">
          <div><div class="et">Valor negocio</div><div class="va">${pesos(v.valor_venta)}</div></div>
          <div><div class="et">Pagado</div><div class="va">${pesos(v.pagado)}</div></div>
          <div><div class="et">Saldo</div><div class="va">${pesos(v.saldo)}</div></div>
        </div>${alerta}</div></div>
      <div class="f-sec"><div class="f-acciones">
        <button class="btn acento" data-acc="pago"><i data-lucide="hand-coins"></i>Registrar pago</button>
        ${esSep ? `<button class="btn pri" data-acc="vender"><i data-lucide="file-signature"></i>Formalizar venta</button>`
          : `<button class="btn sec" data-acc="hoja"><i data-lucide="file-down"></i>Ficha integral PDF</button>`}
      </div>
      <div class="f-acciones" style="margin-top:8px">
        <button class="btn sec peq" data-acc="estado-cuenta"><i data-lucide="file-text"></i>Estado de cuenta</button>
        <button class="btn sec peq" data-acc="editar"><i data-lucide="pencil"></i>Editar negocio</button>
        ${v.etapa === "VENDIDO" ? `<button class="btn sec peq" data-acc="escriturar"><i data-lucide="stamp"></i>Escriturar</button>` : ""}
        ${!esSep && v.saldo > 0.5 ? `<button class="btn sec peq" data-acc="reestructurar"><i data-lucide="calendar-range"></i>Reestructurar plan</button>` : ""}
        <button class="btn peligro peq" data-acc="desistir"><i data-lucide="undo-2"></i>${esSep ? "Liberar lote" : "Desistimiento"}</button>
      </div></div>
      <div class="f-sec"><h4><i data-lucide="user-round"></i>Comprador</h4>
        <dl class="dl"><dt>Nombre</dt><dd>${esc(v.nombre)}</dd>
          <dt>Documento</dt><dd>${esc(v.tipo_doc)} ${esc(v.documento || "—")}</dd>
          <dt>Teléfono</dt><dd>${esc(v.telefono || "—")}</dd>
          <dt>Correo</dt><dd>${esc(v.email || "—")}</dd>
          ${v.direccion ? `<dt>Dirección</dt><dd>${esc(v.direccion)}</dd>` : ""}</dl></div>
      <div class="f-sec"><h4><i data-lucide="handshake"></i>Negocio</h4>
        <dl class="dl">
          ${v.fecha_separacion ? `<dt>Separación</dt><dd class="num">${fecha(v.fecha_separacion)}</dd>` : ""}
          ${esSep ? `<dt>Valor pactado</dt><dd class="num">${pesos(v.valor_venta)}</dd>` : `
          <dt>Fecha de venta</dt><dd class="num">${fecha(v.fecha_venta)}</dd>
          <dt>Valor de venta</dt><dd class="num">${pesos(v.valor_venta)}</dd>
          <dt>Cuota inicial</dt><dd class="num">${pesos(v.cuota_inicial)}</dd>
          <dt>Financiación</dt><dd class="num">${v.n_cuotas ? `${v.n_cuotas} cuotas mensuales de ${pesos(cuotaDe(v))}` : "Contado"}</dd>
          ${v.n_cuotas ? `<dt>Primera cuota</dt><dd class="num">${fecha(v.fecha_primera_cuota)}</dd>` : ""}`}
          ${v.vendedor ? `<dt>Asesor</dt><dd>${esc(v.vendedor)}</dd>` : ""}
          ${v.numero_escritura ? `<dt>Escritura</dt><dd>N° ${esc(v.numero_escritura)} · ${esc(v.notaria || "")}</dd>` : ""}
          ${v.observacion ? `<dt>Observación</dt><dd style="font-weight:400">${esc(v.observacion)}</dd>` : ""}
        </dl></div>
      ${htmlComisionFicha(v)}
      <div class="subtabs" id="subtabs">
        <button data-st="plan" class="${esSep ? "" : "activo"}" ${esSep ? "hidden" : ""}>Plan de pagos<span class="n">${v.plan.length}</span></button>
        <button data-st="pagos" class="${esSep ? "activo" : ""}">Pagos<span class="n">${v.pagos.length}</span></button>
        <button data-st="cobro">Cobro${(v.gestiones || []).length ? `<span class="n">${v.gestiones.length}</span>` : ""}</button>
        <button data-st="docs">Documentos${d.adjuntos.length ? `<span class="n">${d.adjuntos.length}</span>` : ""}</button>
        <button data-st="hist">Historial</button>
      </div>
      <div class="f-sec" id="stCont" style="border:0"></div>`;
  } else {
    h += `<div class="f-sec">
        ${r.estado === "BLOQUEADO" ? `<div class="alerta-caja aviso" style="margin:0 0 12px"><i data-lucide="lock"></i><div><b>Lote bloqueado para la venta.</b>${l.nota ? " " + esc(l.nota) : ""}</div></div>` : ""}
        ${!l.precio_lista && r.estado !== "BLOQUEADO" ? `<div class="alerta-caja aviso" style="margin:0 0 12px"><i data-lucide="tag"></i><div>Este lote aún no tiene <b>precio de lista</b>.</div></div>` : ""}
        <div class="f-acciones">
          <button class="btn acento" data-acc="vender" ${r.estado === "BLOQUEADO" ? "disabled" : ""}><i data-lucide="file-signature"></i>Vender</button>
          <button class="btn pri" data-acc="separar" ${r.estado === "BLOQUEADO" ? "disabled" : ""}><i data-lucide="bookmark"></i>Separar</button>
        </div>
        <div class="f-acciones" style="margin-top:8px">
          <button class="btn sec peq" data-acc="precio"><i data-lucide="tag"></i>Precio y bloqueo</button>
          <button class="btn sec peq" data-acc="cotizar" ${r.estado === "BLOQUEADO" ? "disabled" : ""}><i data-lucide="calculator"></i>Cotizar</button>
          <button class="btn sec peq" data-acc="hoja"><i data-lucide="file-down"></i>Ficha técnica PDF</button>
        </div></div>
      ${l.nota && r.estado !== "BLOQUEADO" ? `<div class="f-sec"><h4><i data-lucide="sticky-note"></i>Nota</h4>${esc(l.nota)}</div>` : ""}
      <div class="subtabs" id="subtabs"><button data-st="docs" class="activo">Documentos${d.adjuntos.length ? `<span class="n">${d.adjuntos.length}</span>` : ""}</button><button data-st="hist">Historial</button></div>
      <div class="f-sec" id="stCont" style="border:0"></div>`;
  }
  return h;
}
function cuotaDe(v) { const c = v.plan.find((x) => x.n === 1); return c ? c.valor : 0; }

function enlazarFicha(d) {
  const v = d.ventas.find((x) => x.estado === "ACTIVA");
  $$("#fichaCont [data-acc]").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.acc;
    if (a === "cerrar") cerrarFicha();
    if (a === "pago") formPago(d, v);
    if (a === "vender") formVenta(d, v);
    if (a === "separar") formSeparar(d);
    if (a === "precio") formPrecio(d);
    if (a === "editar") formVenta(d, v, true);
    if (a === "escriturar") formEscritura(d, v);
    if (a === "desistir") formDesistir(d, v);
    if (a === "estado-cuenta") imprimirEstadoCuenta(d);
    if (a === "hoja") descargarPDF("ficha", d.lote.id_lote, b);
    if (a === "reestructurar") formReestructurar(d, v);
    if (a === "cotizar") formCotizacion(d.lote.id_lote);
  }));
  if (v) enlazarComisionFicha(d, v);
  const st = (k) => {
    $$("#subtabs button").forEach((b) => b.classList.toggle("activo", b.dataset.st === k));
    $("#stCont").innerHTML = k === "plan" ? htmlPlan(v) : k === "pagos" ? htmlPagosLote(v) : k === "cobro" ? htmlCobroFicha(d, v)
      : k === "docs" ? htmlDocsFicha(d, v) : htmlHistorial(d);
    iconos();
    if (k === "cobro") enlazarCobroFicha();
    if (k === "docs") enlazarDocsFicha(d);
    $$("#stCont [data-recibo]").forEach((b) => b.addEventListener("click", () => imprimirRecibo(+b.dataset.recibo)));
    $$("#stCont [data-anular]").forEach((b) => b.addEventListener("click", () => formAnular(+b.dataset.anular, b.dataset.info)));
  };
  $$("#subtabs button").forEach((b) => b.addEventListener("click", () => st(b.dataset.st)));
  st($("#subtabs button.activo").dataset.st);
}

function htmlPlan(v) {
  if (!v.plan.length) return `<div class="vacio"><i data-lucide="calendar-x"></i>Sin plan de pagos.</div>`;
  const nom = { PAGADA: "Pagada", VENCIDA: "Vencida", VENCIDA_PARCIAL: "Vencida (parcial)", PARCIAL: "Abono parcial", PENDIENTE: "Pendiente" };
  return `<table class="mini-tabla"><thead><tr><th>Cuota</th><th>Vence</th><th class="d">Valor</th><th class="d">Pendiente</th><th>Estado</th></tr></thead><tbody>
    ${v.plan.map((c) => `<tr><td>${c.n === 0 ? "Inicial" : c.n}</td><td>${fecha(c.fecha)}</td><td class="d">${pesos(c.valor)}</td>
      <td class="d">${c.pendiente > 0.5 ? pesos(c.pendiente) : "—"}</td><td><span class="estado-cuota ${c.estado}">${nom[c.estado]}</span></td></tr>`).join("")}
    </tbody></table>`;
}
function htmlPagosLote(v) {
  if (!v.pagos.length) return `<div class="vacio"><i data-lucide="receipt"></i>Aún no hay pagos registrados.</div>`;
  return `<table class="mini-tabla"><thead><tr><th>Recibo</th><th>Fecha</th><th>Concepto</th><th class="d">Valor</th><th></th></tr></thead><tbody>
    ${[...v.pagos].reverse().map((p) => `<tr class="${p.anulado ? "anulado" : ""}"><td class="num">N° ${p.recibo}</td><td>${fecha(p.fecha)}</td>
      <td>${esc(p.concepto)}<br><small style="color:var(--txt-3)">${esc(p.medio)}${p.referencia ? " · " + esc(p.referencia) : ""}</small></td>
      <td class="d">${pesos(p.valor)}</td>
      <td style="text-align:right;white-space:nowrap">${p.anulado ? `<span class="chip ANULADO" title="${esc(p.motivo_anulacion)}">Anulado</span>`
        : `<button class="link" data-recibo="${p.recibo}" title="Imprimir recibo"><i data-lucide="printer"></i></button>
           <button class="link rojo" data-anular="${p.id}" data-info="Recibo N° ${p.recibo} · ${pesos(p.valor)}" title="Anular"><i data-lucide="ban"></i></button>`}</td></tr>`).join("")}
    </tbody></table>`;
}
const ACCIONES = { PAGO: "Pago registrado", SEPARACION: "Lote separado", VENTA: "Venta registrada", EDITAR_VENTA: "Negocio modificado",
  ESCRITURA: "Escrituración", DESISTIMIENTO: "Desistimiento", ANULAR_PAGO: "Pago anulado", PRECIO_LOTE: "Precio / bloqueo modificado",
  CLIENTE_NUEVO: "Comprador creado" };
function htmlHistorial(d) {
  const previas = d.ventas.filter((x) => x.estado === "DESISTIDA");
  let h = "";
  if (previas.length) {
    h += `<div style="margin-bottom:14px"><div class="bloque-tit" style="margin-bottom:6px">Negocios anteriores</div>
      ${previas.map((x) => `<div class="bit"><span class="p" style="background:var(--peligro)"></span><div><b>${esc(x.nombre)}</b> · ${pesos(x.valor_venta)}<br>
        <span class="q">Desistió el ${fecha(x.fecha_desistimiento)} · pagó ${pesos(x.pagado)} · ${esc(x.motivo_desistimiento)}</span></div></div>`).join("")}</div>`;
  }
  if (!d.bitacora.length) return h + `<div class="vacio"><i data-lucide="history"></i>Sin movimientos registrados.</div>`;
  return h + `<div class="bloque-tit" style="margin-bottom:6px">Bitácora</div>` + d.bitacora.map((b) => {
    const det = JSON.parse(b.detalle || "{}");
    let txt = "";
    if (b.accion === "PAGO") txt = `Recibo N° ${det.recibo} · ${pesos(det.valor)} · ${esc(det.medio || "")}`;
    else if (b.accion === "ANULAR_PAGO") txt = `Recibo N° ${det.recibo} · ${esc(det.motivo)}`;
    else if (b.accion === "VENTA") txt = `${pesos(det.valor_venta)} · ${det.n_cuotas ? det.n_cuotas + " cuotas" : "contado"}`;
    else if (b.accion === "PRECIO_LOTE") txt = `${det.antes ? pesos(det.antes) : "sin precio"} → ${det.despues ? pesos(det.despues) : "sin precio"}${det.bloqueado ? " · bloqueado" : ""}`;
    else if (b.accion === "DESISTIMIENTO") txt = esc(det.motivo);
    else if (b.accion === "CLIENTE_NUEVO") txt = esc(det.nombre);
    return `<div class="bit"><span class="p"></span><div><b>${ACCIONES[b.accion] || b.accion}</b>${txt ? " · " + txt : ""}<br>
      <span class="q">${fecha(b.fecha)} ${b.fecha.slice(11, 16)} · ${esc(b.usuario)}</span></div></div>`;
  }).join("");
}

// ================================================================== FORMULARIOS
let alEnviar = null;
function modal(titulo, cuerpo, { boton = "Guardar", ancho = false, enviar, peligro = false, extraPie = "" } = {}) {
  $("#modalTit").textContent = titulo;
  $("#modalCuerpo").innerHTML = cuerpo;
  $("#modalPie").innerHTML = `${extraPie}<button type="button" class="btn sec" data-cerrar2>Cancelar</button>
    ${enviar ? `<button type="submit" class="btn ${peligro ? "peligro" : "pri"}" id="btnEnviar">${boton}</button>` : ""}`;
  $(".modal").classList.toggle("ancho", !!ancho);
  $(".modal").classList.toggle("extra", ancho === "extra");
  $("#modal").classList.add("visible");
  $("[data-cerrar2]").addEventListener("click", cerrarModal);
  alEnviar = enviar;
  prepararDinero($("#modalCuerpo"));
  iconos();
  const primero = $("#modalCuerpo input:not([type=hidden]):not([readonly]), #modalCuerpo select, #modalCuerpo textarea");
  if (primero) setTimeout(() => primero.focus(), 60);
}
function cerrarModal() { $("#modal").classList.remove("visible"); alEnviar = null; }
$("#modalForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!alEnviar) return;
  const btn = $("#btnEnviar");
  btn.disabled = true;
  try {
    const datos = Object.fromEntries(new FormData(e.target));
    $$("#modalForm input.dinero").forEach((i) => (datos[i.name] = valorDinero(i.value)));
    $$("#modalForm input[type=checkbox]").forEach((i) => (datos[i.name] = i.checked));
    await alEnviar(datos);
  } catch (err) {
    falla(err);
  } finally {
    if (btn) btn.disabled = false;
  }
});
function prepararDinero(raiz) {
  $$("input.dinero", raiz).forEach((i) => {
    const f = () => { const n = valorDinero(i.value); i.value = n ? fmtN.format(n) : ""; };
    f();
    i.addEventListener("input", () => { const pos = i.value.length - i.selectionStart; f(); const p = Math.max(i.value.length - pos, 0); i.setSelectionRange(p, p); });
  });
}
const valorDinero = (s) => Number(String(s ?? "").replace(/\D/g, "")) || 0;
const campo = (nom, etq, html, { req = false, cls = "", ayuda = "" } = {}) =>
  `<label class="campo ${req ? "req" : ""} ${cls}"><span>${etq}</span>${html}${ayuda ? `<span class="ayuda">${ayuda}</span>` : ""}</label>`;
const inDinero = (nom, val, extra = "") => `<div class="input-dinero"><input class="dinero" name="${nom}" inputmode="numeric" value="${val ?? ""}" ${extra}></div>`;
const sel = (nom, ops, val) => `<select name="${nom}">${ops.map((o) => `<option ${o === val ? "selected" : ""}>${o}</option>`).join("")}</select>`;

function camposCliente(c = {}) {
  return `<div class="form-sec">Comprador</div>
    <input type="hidden" name="cliente_id" value="${c.cliente_id || ""}">
    ${campo("", "Nombre completo", `<div class="clientes-sug"><input type="text" name="c_nombre" required value="${esc(c.nombre || "")}" placeholder="Escriba para buscar compradores existentes"><div class="sugerencias" id="sugClientes"></div></div>`, { req: true, cls: "c2" })}
    ${campo("", "Tipo de documento", sel("c_tipo_doc", TIPOS_DOC, c.tipo_doc || "CC"))}
    ${campo("", "N° de documento", `<input type="text" name="c_documento" value="${esc(c.documento || "")}" inputmode="numeric">`)}
    ${campo("", "Teléfono", `<input type="tel" name="c_telefono" value="${esc(c.telefono || "")}">`)}
    ${campo("", "Correo electrónico", `<input type="email" name="c_email" value="${esc(c.email || "")}">`)}
    ${campo("", "Dirección", `<input type="text" name="c_direccion" value="${esc(c.direccion || "")}">`, { cls: "c2" })}`;
}
function enlazarClientes() {
  const inp = $("[name=c_nombre]"), caja = $("#sugClientes");
  let t;
  inp.addEventListener("input", () => {
    clearTimeout(t);
    $("[name=cliente_id]").value = "";
    const q = inp.value.trim();
    if (q.length < 2) { caja.classList.remove("visible"); return; }
    t = setTimeout(async () => {
      const cs = await api("/api/clientes?q=" + encodeURIComponent(q));
      if (!cs.length) { caja.classList.remove("visible"); return; }
      caja.innerHTML = cs.map((c, i) => `<div class="sug" data-i="${i}"><span class="sug-txt" style="color:var(--txt)"><b>${esc(c.nombre)}</b></span><span class="sug-txt">${esc(c.tipo_doc)} ${esc(c.documento || "")}</span></div>`).join("");
      caja.classList.add("visible");
      $$(".sug", caja).forEach((s) => s.addEventListener("mousedown", () => {
        const c = cs[+s.dataset.i];
        $("[name=cliente_id]").value = c.id;
        inp.value = c.nombre;
        ["tipo_doc", "documento", "telefono", "email", "direccion"].forEach((k) => ($(`[name=c_${k}]`).value = c[k] || ""));
        caja.classList.remove("visible");
      }));
    }, 200);
  });
  inp.addEventListener("blur", () => setTimeout(() => caja.classList.remove("visible"), 150));
}
const clienteDe = (d) => ({ id: d.cliente_id || null, nombre: d.c_nombre, tipo_doc: d.c_tipo_doc, documento: d.c_documento,
  telefono: d.c_telefono, email: d.c_email, direccion: d.c_direccion });

async function trasGuardar(msg) {
  cerrarModal();
  aviso(msg);
  await recargar();
}

async function formSeparar(d) {
  const l = d.lote, hoy = hoyISO();
  const activos = await comisionistasActivos();
  modal(`Separar lote ${l.id_lote}`, `<div class="form-grid">
    ${camposCliente()}
    <div class="form-sec">Separación</div>
    ${campo("", "Fecha de separación", `<input type="date" name="fecha_separacion" value="${hoy}" required>`, { req: true })}
    ${campo("", "Vigente hasta", `<input type="date" name="fecha_limite_separacion" value="${sumarDias(hoy, 15)}">`, { ayuda: "Después de esta fecha la separación aparece como vencida." })}
    ${campo("", "Valor pactado del lote", inDinero("valor_venta", l.precio_lista || ""), { ayuda: l.precio_lista ? "Por defecto, el precio de lista." : "" })}
    ${campo("", "Valor recibido por separación", inDinero("valor_separacion", ""), { ayuda: "Genera un recibo de caja." })}
    ${campo("", "Medio de pago", sel("medio", MEDIOS, "Efectivo"))}
    ${campo("", "Referencia / comprobante", `<input type="text" name="referencia">`)}
    ${campo("", "Asesor comercial", `<input type="text" name="vendedor">`)}
    ${campo("", "Observación", `<input type="text" name="observacion">`)}
    ${camposComision(activos)}
  </div>`, {
    boton: "Separar lote", ancho: true,
    enviar: async (x) => {
      const r = await api("/api/venta/separar", { id_lote: l.id_lote, cliente: clienteDe(x), ...x });
      await trasGuardar(`Lote ${l.id_lote} separado${r.recibo ? ` · recibo N° ${r.recibo}` : ""}`);
      if (r.recibo) ofrecerRecibo(r.recibo);
    },
  });
  enlazarClientes();
  enlazarCamposComision();
}

async function formVenta(d, v, editar = false) {
  const l = d.lote, hoy = hoyISO();
  const conCom = !editar && !(v && (v.comisiones || []).some((x) => x.estado === "ACTIVA"));
  const activos = conCom ? await comisionistasActivos() : [];
  const desdeSep = v && v.etapa === "SEPARADO" && !editar;
  const pr = editar ? null : E.prospectoVenta;
  E.prospectoVenta = null;
  const c = v ? { cliente_id: v.cliente_id, nombre: v.nombre, tipo_doc: v.tipo_doc, documento: v.documento, telefono: v.telefono, email: v.email, direccion: v.direccion }
    : pr ? { nombre: pr.nombre, telefono: pr.telefono, email: pr.email, documento: pr.documento } : {};
  const fv = (editar && v.fecha_venta) || hoy;
  const valor = (v && v.valor_venta) || l.precio_lista || "";
  const titulo = editar ? `Editar negocio · ${l.id_lote}` : desdeSep ? `Formalizar venta · ${l.id_lote}` : `Vender lote ${l.id_lote}`;
  const esSepEdit = editar && v.etapa === "SEPARADO";
  modal(titulo, `<div class="form-grid">
    ${camposCliente(c)}
    ${esSepEdit ? `<div class="form-sec">Separación</div>
      ${campo("", "Fecha de separación", `<input type="date" name="fecha_separacion" value="${v.fecha_separacion || ""}">`)}
      ${campo("", "Vigente hasta", `<input type="date" name="fecha_limite_separacion" value="${v.fecha_limite_separacion || ""}">`)}
      ${campo("", "Valor pactado", inDinero("valor_venta", valor))}` : `
    <div class="form-sec">Condiciones de la venta</div>
    ${campo("", "Fecha de venta", `<input type="date" name="fecha_venta" value="${fv}" required>`, { req: true })}
    ${campo("", "Valor de venta", inDinero("valor_venta", valor, "required"), { req: true, ayuda: l.precio_lista ? `Precio de lista: ${pesos(l.precio_lista)}` : "" })}
    ${campo("", "Cuota inicial", inDinero("cuota_inicial", (v && v.cuota_inicial) || ""), { ayuda: v && v.pagado ? `Ya abonado: ${pesos(v.pagado)} (se descuenta de la inicial).` : "Se cobra en la fecha de venta." })}
    ${campo("", "Número de cuotas mensuales", `<input type="number" name="n_cuotas" min="0" max="360" value="${(v && v.n_cuotas) || 0}">`, { ayuda: "0 = pago de contado." })}
    ${campo("", "Fecha de la primera cuota", `<input type="date" name="fecha_primera_cuota" value="${(v && v.fecha_primera_cuota) || sumarMeses(fv, 1)}">`)}
    ${campo("", "Asesor comercial", `<input type="text" name="vendedor" value="${esc((v && v.vendedor) || "")}">`)}
    <div class="resumen-plan" id="resPlan"></div>`}
    ${campo("", "Observación", `<textarea name="observacion" rows="2">${esc((v && v.observacion) || "")}</textarea>`, { cls: "c2" })}
    ${conCom ? camposComision(activos) : ""}
  </div>`, {
    boton: editar ? "Guardar cambios" : "Registrar venta", ancho: true,
    enviar: async (x) => {
      if (editar) {
        await api("/api/venta/editar", { venta_id: v.id, cliente: clienteDe(x), ...x });
        await trasGuardar("Negocio actualizado");
      } else {
        await api("/api/venta/vender", { id_lote: l.id_lote, cliente: clienteDe(x), ...x, prospecto_id: pr?.id });
        await trasGuardar(`Venta del lote ${l.id_lote} registrada`);
      }
    },
  });
  enlazarClientes();
  enlazarCamposComision();
  if (!esSepEdit) {
    const calc = () => {
      const val = valorDinero($("[name=valor_venta]").value), ini = valorDinero($("[name=cuota_inicial]").value);
      const n = +$("[name=n_cuotas]").value || 0, fp = $("[name=fecha_primera_cuota]").value;
      const fin = Math.max(val - ini, 0), cuota = n ? Math.round(fin / n) : 0;
      $("#resPlan").innerHTML = `<div><div class="et">Saldo a financiar</div><div class="va">${pesos(fin)}</div></div>
        <div><div class="et">Valor cuota</div><div class="va">${n ? pesos(cuota) : "Contado"}</div></div>
        <div><div class="et">Última cuota</div><div class="va">${n && fp ? fecha(sumarMeses(fp, n - 1)) : "—"}</div></div>
        <div><div class="et">Inicial / valor</div><div class="va">${val ? fmtN1.format((100 * ini) / val) + " %" : "—"}</div></div>`;
    };
    ["valor_venta", "cuota_inicial", "n_cuotas", "fecha_primera_cuota"].forEach((n) => $(`[name=${n}]`).addEventListener("input", calc));
    $("[name=fecha_venta]").addEventListener("change", (e) => { $("[name=fecha_primera_cuota]").value = sumarMeses(e.target.value, 1); calc(); });
    calc();
  }
}

function formPago(d, v) {
  const sugerido = v.etapa === "SEPARADO" ? "" : (v.vencido > 0 ? v.vencido : v.proxima_cuota ? v.proxima_cuota.pendiente : v.saldo);
  const concepto = v.etapa === "SEPARADO" ? "Separación" : v.plan.find((c) => c.pendiente > 0.5)?.n === 0 ? "Cuota inicial" : "Cuota";
  modal(`Registrar pago · ${d.lote.id_lote}`, `
    <p class="texto-modal"><b>${esc(v.nombre)}</b> · ${nombreLote(d.lote.id_lote)}<br>
      Saldo actual: <b class="num">${pesos(v.saldo)}</b>${v.vencido > 0 ? ` · vencido <b class="num" style="color:var(--peligro)">${pesos(v.vencido)}</b>` : ""}</p>
    <div class="form-grid">
      ${campo("", "Fecha del pago", `<input type="date" name="fecha" value="${hoyISO()}" required>`, { req: true })}
      ${campo("", "Valor recibido", inDinero("valor", sugerido ? Math.round(sugerido) : "", "required"), { req: true })}
      ${campo("", "Concepto", sel("concepto", CONCEPTOS, concepto))}
      ${campo("", "Medio de pago", sel("medio", MEDIOS, "Efectivo"))}
      ${campo("", "Referencia / comprobante", `<input type="text" name="referencia" placeholder="N° de transferencia, consignación…">`, { cls: "c2" })}
      ${campo("", "Observación", `<input type="text" name="observacion">`, { cls: "c2" })}
      <div class="c2" id="cajaAbono" hidden>${campo("", "Después del abono a capital", `<select name="recalcular">
        <option value="no">Mantener el plan (el abono se aplica a las cuotas en orden)</option>
        <option value="plazo">Recalcular: misma cuota, menos cuotas (termina antes)</option>
        <option value="cuota">Recalcular: mismo plazo, cuota más baja</option></select>`)}</div>
      <div class="resumen-plan" id="resPago"></div>
    </div>`, {
    boton: "Registrar y generar recibo",
    enviar: async (x) => {
      const { recalcular, ...pago } = x;
      const r = await api("/api/pago", { venta_id: v.id, ...pago });
      let nota = "";
      if (x.concepto === "Abono a capital" && recalcular && recalcular !== "no") {
        try {
          const re = await api("/api/venta/reestructurar", { venta_id: v.id, modo: recalcular });
          nota = `Plan recalculado: ${re.n_cuotas} cuotas de ${pesos(re.cuota)}.`;
        } catch (e) { nota = e instanceof Pendiente ? "El recálculo del plan quedó pendiente de aprobación." : "No se pudo recalcular el plan: " + e.message; }
      }
      await trasGuardar(`Pago registrado · recibo N° ${r.recibo}`);
      ofrecerRecibo(r.recibo, nota);
    },
  });
  const calc = () => {
    const val = valorDinero($("[name=valor]").value);
    $("#resPago").innerHTML = `<div><div class="et">Pagado hasta hoy</div><div class="va">${pesos(v.pagado)}</div></div>
      <div><div class="et">Este pago</div><div class="va">${pesos(val)}</div></div>
      <div><div class="et">Saldo después</div><div class="va">${v.valor_venta ? pesos(Math.max(v.valor_venta - v.pagado - val, 0)) : "—"}</div></div>
      <div><div class="et">Avance</div><div class="va">${v.valor_venta ? fmtN1.format((100 * (v.pagado + val)) / v.valor_venta) + " %" : "—"}</div></div>`;
  };
  $("[name=valor]").addEventListener("input", calc);
  $("[name=concepto]").addEventListener("change", (e) => { $("#cajaAbono").hidden = e.target.value !== "Abono a capital"; });
  calc();
}

function ofrecerRecibo(n, nota = "") {
  modal("Pago registrado", `<div style="text-align:center;padding:10px 0">
      <div style="width:56px;height:56px;border-radius:50%;background:#DCFCE7;color:#15803D;display:grid;place-items:center;margin:0 auto 12px"><i data-lucide="check" style="width:28px;height:28px"></i></div>
      <div style="font-family:var(--f-tit);font-size:18px;font-weight:600;color:var(--teal)">Recibo de caja N° ${String(n).padStart(6, "0")}</div>
      <p class="texto-modal" style="margin-top:6px">El pago quedó registrado en la cartera.${nota ? `<br><b>${esc(nota)}</b>` : ""}</p></div>`,
  { extraPie: `<button type="button" class="btn acento" id="btnImpRec"><i data-lucide="printer"></i>Imprimir recibo</button>` });
  $("[data-cerrar2]").textContent = "Cerrar";
  $("#btnImpRec").addEventListener("click", () => { imprimirRecibo(n); cerrarModal(); });
  iconos();
}

function formAnular(pagoId, info) {
  modal("Anular pago", `<p class="texto-modal">Se anulará el <b>${esc(info)}</b>. El recibo conserva su número y queda marcado como anulado; el valor deja de contar en la cartera.</p>
    <div class="form-grid">${campo("", "Motivo de la anulación", `<input type="text" name="motivo" required>`, { req: true, cls: "c2" })}</div>`, {
    boton: "Anular pago", peligro: true,
    enviar: async (x) => { await api("/api/pago/anular", { pago_id: pagoId, motivo: x.motivo }); await trasGuardar("Pago anulado"); },
  });
}

function formDesistir(d, v) {
  const sep = v.etapa === "SEPARADO";
  modal(sep ? "Liberar lote separado" : "Registrar desistimiento", `<p class="texto-modal">
      El negocio de <b>${esc(v.nombre)}</b> sobre el lote ${d.lote.id_lote} quedará cerrado y el lote volverá a estar <b>disponible</b>.
      ${v.pagado > 0 ? `<br><br>El comprador ha pagado <b>${pesos(v.pagado)}</b>. Esos pagos se conservan en el historial del lote; la devolución o retención se maneja según el contrato.` : ""}</p>
    <div class="form-grid">
      ${campo("", "Fecha", `<input type="date" name="fecha" value="${hoyISO()}">`)}
      ${campo("", "Motivo", `<input type="text" name="motivo" required placeholder="${sep ? "Separación vencida, desistió…" : "Incumplimiento, solicitud del comprador…"}">`, { req: true })}
    </div>`, {
    boton: sep ? "Liberar lote" : "Registrar desistimiento", peligro: true,
    enviar: async (x) => { await api("/api/venta/desistir", { venta_id: v.id, ...x }); await trasGuardar(`Lote ${d.lote.id_lote} liberado`); },
  });
}

function formEscritura(d, v) {
  modal(`Escriturar · ${d.lote.id_lote}`, `${v.saldo > 0.5 ? `<div class="alerta-caja aviso" style="margin:0 0 14px"><i data-lucide="alert-triangle"></i><div>El negocio todavía tiene un saldo de <b>${pesos(v.saldo)}</b>.</div></div>` : ""}
    <div class="form-grid">
      ${campo("", "Fecha de la escritura", `<input type="date" name="fecha_escritura" value="${hoyISO()}">`)}
      ${campo("", "Número de escritura", `<input type="text" name="numero_escritura">`)}
      ${campo("", "Notaría", `<input type="text" name="notaria" placeholder="Notaría Primera de Villavicencio">`, { cls: "c2" })}
    </div>`, {
    boton: "Registrar escritura",
    enviar: async (x) => { await api("/api/venta/escriturar", { venta_id: v.id, ...x }); await trasGuardar("Escritura registrada"); },
  });
}

function formPrecio(d) {
  const l = d.lote;
  modal(`Precio y bloqueo · ${l.id_lote}`, `<div class="form-grid">
      ${campo("", "Precio de lista", inDinero("precio_lista", l.precio_lista || ""), { ayuda: `Área ${m2(l.area_m2)}` })}
      <div class="campo"><span>Valor por m²</span><div class="num" id="pm2" style="height:36px;display:flex;align-items:center;font-weight:600"></div></div>
      <label class="interruptor c2" style="grid-column:1/-1"><input type="checkbox" name="bloqueado" ${l.bloqueado ? "checked" : ""}><span></span>Bloquear el lote para la venta (reserva del propietario, problema de linderos…)</label>
      ${campo("", "Nota", `<input type="text" name="nota" value="${esc(l.nota || "")}">`, { cls: "c2" })}
    </div>`, {
    enviar: async (x) => { await api("/api/lote/precio", { id_lote: l.id_lote, ...x, precio_lista: x.precio_lista || null }); await trasGuardar("Lote actualizado"); },
  });
  const f = () => { const p = valorDinero($("[name=precio_lista]").value); $("#pm2").textContent = p ? pesos(p / l.area_m2) + " / m²" : "—"; };
  $("[name=precio_lista]").addEventListener("input", f);
  f();
}

function formPreciosMasivos() {
  const manz = [...new Set(E.lotes.map((l) => l.manzana))];
  modal("Asignar precios de lista", `<p class="texto-modal">Actualiza el precio de lista de varios lotes a la vez. Los lotes con negocio activo no se tocan.</p>
    <div class="form-grid">
      ${campo("", "Forma de cálculo", `<select name="modo"><option value="m2">Valor por m² × área del lote</option><option value="fijo">Precio fijo por lote</option></select>`)}
      ${campo("", "Valor", inDinero("valor", ""), { req: true })}
      ${campo("", "Aplicar a", `<select name="manzana"><option value="">Todas las manzanas</option>${manz.map((m) => `<option value="${m}">Manzana ${String(m).padStart(2, "0")}</option>`).join("")}</select>`, { cls: "c2" })}
      <div class="resumen-plan" id="resMasivo" style="grid-template-columns:repeat(3,1fr)"></div>
    </div>`, {
    boton: "Aplicar precios",
    enviar: async (x) => {
      const r = await api("/api/precios/masivo", { ...x, solo_disponibles: true });
      await trasGuardar(`${r.actualizados} lotes con precio actualizado`);
    },
  });
  const calc = () => {
    const modo = $("[name=modo]").value, val = valorDinero($("[name=valor]").value), m = $("[name=manzana]").value;
    const ls = E.lotes.filter((l) => !l.venta_id && (!m || String(l.manzana) === m));
    const tot = ls.reduce((s, l) => s + (modo === "m2" ? Math.round((val * l.area_m2) / 1000) * 1000 : val), 0);
    $("#resMasivo").innerHTML = `<div><div class="et">Lotes</div><div class="va">${fmtN.format(ls.length)}</div></div>
      <div><div class="et">Precio promedio</div><div class="va">${ls.length ? pesos(tot / ls.length) : "—"}</div></div>
      <div><div class="et">Valor del inventario</div><div class="va">${pesosCorto(tot)}</div></div>`;
  };
  ["modo", "valor", "manzana"].forEach((n) => $(`[name=${n}]`).addEventListener("input", calc));
  calc();
}

// ================================================================== TABLERO
function pintarTablero() {
  const r = E.resumen, c = r.conteo;
  const vendidos = (c.VENDIDO || 0) + (c.PAGADO || 0) + (c.ESCRITURADO || 0);
  const negociado = r.valor_vendido;
  $("#tbFecha").textContent = `Corte al ${fechaLarga(r.fecha)} · ${fmtN.format(r.total_lotes)} lotes · ${fmtN1.format(r.area_total_m2 / 1e4)} ha vendibles`;
  const k = (et, va, sub, color, ic, cls = "") => `<div class="kpi ${cls}" style="--c:${color}"><div class="et"><i data-lucide="${ic}"></i>${et}</div><div class="va">${va}</div><div class="sub">${sub}</div></div>`;
  $("#kpis").innerHTML =
    k("Lotes vendidos", fmtN.format(vendidos), `${fmtN1.format((100 * vendidos) / r.total_lotes)} % del loteo · ${fmtN.format(c.SEPARADO || 0)} separados`, "#3B82F6", "file-signature") +
    k("Valor vendido", pesosCorto(negociado), `${fmtN1.format(r.area_vendida_m2 / 1e4)} ha vendidas`, "#0C2E37", "badge-dollar-sign") +
    k("Recaudado", pesosCorto(r.recaudado), negociado ? `${fmtN1.format(pctRecaudo(r))} % de lo negociado` : "Sin ventas aún", "#17A974", "wallet") +
    k("Cartera por cobrar", pesosCorto(r.cartera), "Saldo de lotes vendidos", "#8B5CF6", "landmark") +
    k("Cartera vencida", pesosCorto(r.vencido), `${fmtN.format(r.lotes_mora)} lotes en mora`, "#DC2626", "alert-triangle", r.vencido ? "rojo" : "") +
    k("Inventario disponible", pesosCorto(r.inventario_valor), `${fmtN.format(c.DISPONIBLE || 0)} lotes${r.disponibles_sin_precio ? ` · ${fmtN.format(r.disponibles_sin_precio)} sin precio` : ""}`, "#5CE9AB", "map-pinned");
  // dona de estados
  const tot = r.total_lotes, R = 62, C = 2 * Math.PI * R;
  let acum = 0;
  const arcos = Object.entries(ESTADOS).filter(([k2]) => c[k2]).map(([k2, v]) => {
    const f = c[k2] / tot, s = `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${v.c}" stroke-width="26" stroke-dasharray="${f * C} ${C}" stroke-dashoffset="${-acum * C}" transform="rotate(-90 80 80)"/>`;
    acum += f;
    return s;
  }).join("");
  $("#gEstados").innerHTML = `<div class="dona-wrap"><svg width="160" height="160" viewBox="0 0 160 160">${arcos}
      <text x="80" y="76" text-anchor="middle" style="font:600 24px Lexend;fill:#0C2E37">${fmtN1.format((100 * vendidos) / tot)}%</text>
      <text x="80" y="96" text-anchor="middle" style="font:12px Cabin;fill:#82959A">vendido</text></svg>
    <div class="dona-ley">${Object.entries(ESTADOS).map(([k2, v]) => `<div><i style="background:${v.c}"></i>${v.nom}<b>${fmtN.format(c[k2] || 0)}</b></div>`).join("")}</div></div>`;
  // barras de recaudo
  const serie = rellenarMeses(r.serie_recaudo, 12);
  const mx = Math.max(...serie.map((s) => s.valor), 1) * 1.12, W = 380, H = 170, bw = W / serie.length;
  $("#gRecaudo").innerHTML = `<svg class="barras" viewBox="0 0 ${W} ${H + 34}" width="100%">
    ${[0.25, 0.5, 0.75, 1].map((g) => `<line x1="0" x2="${W}" y1="${H - g * H + 14}" y2="${H - g * H + 14}" stroke="#EBF0F1"/>`).join("")}
    ${serie.map((s, i) => { const h2 = (s.valor / mx) * H; return `<rect x="${i * bw + 5}" y="${H - h2 + 14}" width="${bw - 10}" height="${Math.max(h2, s.valor ? 2 : 0)}" rx="3" fill="${i === serie.length - 1 ? "#5CE9AB" : "#0C2E37"}"><title>${s.etq}: ${pesos(s.valor)}</title></rect>
      ${s.valor ? `<text class="vtx" x="${i * bw + bw / 2}" y="${H - h2 + 9}" text-anchor="middle">${pesosCorto(s.valor).replace("$", "")}</text>` : ""}
      <text x="${i * bw + bw / 2}" y="${H + 30}" text-anchor="middle">${s.etq}</text>`; }).join("")}</svg>`;
  // mora por edad
  const mr = r.mora_rangos, alDia = E.lotes.filter((l) => l.cartera === "AL_DIA").length;
  const filas = [["Al día", alDia, null, "#22C55E"], ["1 – 30 días", mr.MORA_30.n, mr.MORA_30.valor, "#FACC15"],
    ["31 – 90 días", mr.MORA_90.n, mr.MORA_90.valor, "#F97316"], ["Más de 90 días", mr.MORA_MAS_90.n, mr.MORA_MAS_90.valor, "#DC2626"]];
  const mxn = Math.max(...filas.map((f) => f[1]), 1);
  $("#gMora").innerHTML = filas.map(([et, n, val, col]) => `<div style="margin-bottom:13px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px"><span>${et}</span>
      <span class="num"><b>${fmtN.format(n)}</b> lotes${val !== null ? ` · ${pesos(val)}` : ""}</span></div>
      <div style="height:9px;border-radius:5px;background:#EEF2F3;overflow:hidden"><div style="height:100%;width:${(100 * n) / mxn}%;background:${col};border-radius:5px"></div></div></div>`).join("")
    + `<div class="ley-ayuda" style="padding:0">Edad de la cuota vencida más antigua de cada negocio.</div>`;
  // manzanas
  $("#tManzanas").innerHTML = `<table class="datos"><thead><tr><th>Manzana</th><th class="d">Lotes</th><th class="d">Disponibles</th><th class="d">Separados</th><th class="d">Vendidos</th><th style="width:160px">% vendido</th>
      <th class="d">Valor vendido</th><th class="d">Recaudado</th><th class="d">Saldo</th><th class="d">En mora</th></tr></thead><tbody>
    ${r.manzanas.map((m) => { const p = (100 * (m.vendidos + m.separados)) / m.lotes; return `<tr data-mz="${m.manzana}"><td><b>MZ ${String(m.manzana).padStart(2, "0")}</b></td>
      <td class="d">${m.lotes}</td><td class="d">${m.disponibles}</td><td class="d">${m.separados || "—"}</td><td class="d">${m.vendidos || "—"}</td>
      <td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:7px;border-radius:4px;background:#EEF2F3;overflow:hidden"><div style="height:100%;width:${p}%;background:#3B82F6"></div></div><span class="num" style="font-size:12px;width:38px;text-align:right">${fmtN.format(p)}%</span></div></td>
      <td class="d">${m.valor_venta ? pesos(m.valor_venta) : "—"}</td><td class="d">${m.pagado ? pesos(m.pagado) : "—"}</td><td class="d">${m.saldo ? pesos(m.saldo) : "—"}</td>
      <td class="d">${m.en_mora ? `<span class="rojo">${m.en_mora}</span>` : "—"}</td></tr>`; }).join("")}</tbody></table>`;
  $$("#tManzanas tr[data-mz]").forEach((t) => t.addEventListener("click", () => { cambiarVista("mapa"); filtrarManzana(t.dataset.mz); }));
  // listas
  $("#lRecientes").innerHTML = r.recientes.length ? `<div class="lista">${r.recientes.map((p) => `<div class="it" data-recibo="${p.recibo}" style="cursor:pointer">
      <div class="ic"><i data-lucide="receipt"></i></div><div class="q"><div><b>${esc(p.cliente)}</b></div><small>N° ${p.recibo} · ${p.id_lote} · ${fecha(p.fecha)} · ${esc(p.medio)}</small></div>
      <div class="v">${pesos(p.valor)}</div></div>`).join("")}</div>` : `<div class="vacio"><i data-lucide="receipt"></i>Aún no hay pagos registrados.</div>`;
  $("#lProximos").innerHTML = r.proximos.length ? `<div class="lista">${r.proximos.map((p) => `<div class="it" data-lote="${p.id_lote}" style="cursor:pointer">
      <div class="ic cal"><i data-lucide="calendar-clock"></i></div><div class="q"><div><b>${esc(p.cliente)}</b></div><small>${p.id_lote} · vence ${fecha(p.fecha)}</small></div>
      <div class="v">${pesos(p.valor)}</div></div>`).join("")}</div>` : `<div class="vacio"><i data-lucide="calendar-check"></i>No hay cuotas por vencer en los próximos 30 días.</div>`;
  $("#lComisiones").innerHTML = htmlTarjetaComisiones(r);
  $$("#lComisiones [data-com]").forEach((x) => x.addEventListener("click", () => abrirComisionista(+x.dataset.com)));
  $$("#lRecientes [data-recibo]").forEach((x) => x.addEventListener("click", () => imprimirRecibo(+x.dataset.recibo)));
  $$("#lProximos [data-lote]").forEach((x) => x.addEventListener("click", () => irALote(x.dataset.lote)));
  iconos();
}
function rellenarMeses(serie, n) {
  const mapa = Object.fromEntries(serie.map((s) => [s.mes, s.valor]));
  const out = [], d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const k = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
    out.push({ mes: k, etq: MESES[t.getMonth()], valor: mapa[k] || 0 });
  }
  return out;
}

// ================================================================== TABLA DE CARTERA
const COLS_CARTERA = [
  ["id_lote", "Lote"], ["area_m2", "Área", "d"], ["estado", "Estado"], ["cartera", "Cartera"], ["cliente", "Comprador"],
  ["documento", "Documento"], ["valor_venta", "Valor venta", "d"], ["pagado", "Pagado", "d"], ["saldo", "Saldo", "d"],
  ["vencido", "Vencido", "d"], ["dias_mora", "Días mora", "d"], ["proxima_fecha", "Próxima cuota"],
];
function pintarCartera() {
  const q = $("#cBuscar").value.trim().toLowerCase(), es = $("#cEstado").value, ca = $("#cCartera").value, mz = $("#cManzana").value;
  let ls = E.lotes.filter((l) => {
    if (es === "NEGOCIADO" ? !l.venta_id : es && l.estado !== es) return false;
    if (ca === "MORA" ? !EN_MORA.includes(l.cartera) : ca && l.cartera !== ca) return false;
    if (mz && String(l.manzana) !== mz) return false;
    if (q && !`${l.id_lote} ${l.cliente || ""} ${l.documento || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const o = E.orden.cartera;
  ls.sort((a, b) => { const x = a[o.k] ?? "", y = b[o.k] ?? ""; return (x > y ? 1 : x < y ? -1 : 0) * (o.asc ? 1 : -1); });
  const sum = (k) => ls.reduce((s, l) => s + (l[k] || 0), 0);
  $("#cContador").textContent = `${fmtN.format(ls.length)} lotes`;
  $("#tCartera").innerHTML = `<table class="datos"><thead><tr>${COLS_CARTERA.map(([k, t, c]) => `<th class="${c || ""}" data-k="${k}">${t}${o.k === k ? `<span class="flecha">${o.asc ? "▲" : "▼"}</span>` : ""}</th>`).join("")}</tr></thead>
    <tbody>${ls.map((l) => `<tr data-id="${l.id_lote}"><td><b>${l.id_lote}</b></td><td class="d">${fmtN1.format(l.area_m2)}</td><td>${chip(l.estado)}</td>
      <td>${l.cartera && l.cartera !== "SEPARADO" ? chip(l.cartera, CARTERA) : ""}</td><td>${esc(l.cliente || "")}</td><td>${esc(l.documento || "")}</td>
      <td class="d">${l.valor_venta ? pesos(l.valor_venta) : l.precio_lista ? `<span style="color:var(--txt-3)">${pesos(l.precio_lista)}</span>` : "—"}</td>
      <td class="d">${l.pagado ? pesos(l.pagado) : "—"}</td><td class="d">${l.saldo ? pesos(l.saldo) : "—"}</td>
      <td class="d">${l.vencido ? `<span class="rojo">${pesos(l.vencido)}</span>` : "—"}</td><td class="d">${l.dias_mora || "—"}</td>
      <td>${l.proxima_fecha ? `${fecha(l.proxima_fecha)} · <span class="num">${pesos(l.proxima_valor)}</span>` : ""}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td>Total</td><td class="d">${fmtN1.format(sum("area_m2"))}</td><td colspan="4"></td><td class="d">${pesos(sum("valor_venta"))}</td>
      <td class="d">${pesos(sum("pagado"))}</td><td class="d">${pesos(sum("saldo"))}</td><td class="d">${pesos(sum("vencido"))}</td><td colspan="2"></td></tr></tfoot></table>`;
  $$("#tCartera th").forEach((th) => th.addEventListener("click", () => {
    o.asc = o.k === th.dataset.k ? !o.asc : true;
    o.k = th.dataset.k;
    pintarCartera();
  }));
  $$("#tCartera tbody tr").forEach((tr) => tr.addEventListener("click", () => irALote(tr.dataset.id)));
}

// ================================================================== LIBRO DE PAGOS
async function pintarPagos(recargarDatos) {
  if (recargarDatos || !E.pagos.length) E.pagos = await api("/api/pagos");
  const q = $("#pBuscar").value.trim().toLowerCase(), de = $("#pDesde").value, ha = $("#pHasta").value, anul = $("#pAnulados").checked;
  const ps = E.pagos.filter((p) => (anul || !p.anulado) && (!de || p.fecha >= de) && (!ha || p.fecha <= ha)
    && (!q || `${p.recibo} ${p.id_lote} ${p.cliente} ${p.documento || ""} ${p.referencia || ""}`.toLowerCase().includes(q)));
  const tot = ps.filter((p) => !p.anulado).reduce((s, p) => s + p.valor, 0);
  $("#pContador").textContent = `${fmtN.format(ps.length)} recibos · ${pesos(tot)}`;
  if (!ps.length) {
    $("#tPagos").innerHTML = `<div class="vacio" style="padding:50px"><i data-lucide="receipt-text"></i>${E.pagos.length ? "Ningún pago coincide con el filtro." : "Aún no hay pagos registrados. Los pagos se registran desde la ficha de cada lote."}</div>`;
    iconos();
    return;
  }
  $("#tPagos").innerHTML = `<table class="datos"><thead><tr><th>Recibo</th><th>Fecha</th><th>Lote</th><th>Comprador</th><th>Concepto</th><th>Medio</th><th>Referencia</th>
      <th class="d">Valor</th><th>Registró</th><th></th></tr></thead><tbody>
    ${ps.map((p) => `<tr class="${p.anulado ? "anulado" : ""}" data-id="${p.id_lote}"><td class="num"><b>N° ${String(p.recibo).padStart(6, "0")}</b></td><td>${fecha(p.fecha)}</td>
      <td>${p.id_lote}</td><td>${esc(p.cliente)}</td><td>${esc(p.concepto)}</td><td>${esc(p.medio)}</td><td>${esc(p.referencia || "")}</td>
      <td class="d">${pesos(p.valor)}</td><td>${esc(p.usuario || "")}</td>
      <td style="text-decoration:none">${p.anulado ? `<span class="chip ANULADO" title="${esc(p.motivo_anulacion)}">Anulado</span>` : `<button class="link" data-recibo="${p.recibo}"><i data-lucide="printer"></i></button>`}</td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="7">Total recaudado (sin anulados)</td><td class="d">${pesos(tot)}</td><td colspan="2"></td></tr></tfoot></table>`;
  iconos();
  $$("#tPagos [data-recibo]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); imprimirRecibo(+b.dataset.recibo); }));
  $$("#tPagos tbody tr").forEach((tr) => tr.addEventListener("click", () => irALote(tr.dataset.id)));
}

// ================================================================== IMPRESIÓN
const CSS_IMPRESION = `
  @font-face { font-family: Lexend; src: url(${location.origin}/lib/fonts/Lexend.ttf); }
  @font-face { font-family: Cabin; src: url(${location.origin}/lib/fonts/Cabin.ttf); }
  @page { size: letter; margin: 16mm 15mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Cabin, Arial, sans-serif; color: #10262C; font-size: 11.5px; margin: 0; }
  h1, h2, h3, .num { font-family: Lexend, Arial, sans-serif; }
  .cab { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0C2E37; padding-bottom: 10px; margin-bottom: 12px; }
  .cab-izq { display: flex; align-items: center; gap: 12px; }
  .logo-v { height: 46px; max-width: 120px; object-fit: contain; }
  .vend { font-family: Lexend, Arial; font-weight: 600; font-size: 15px; color: #0C2E37; }
  .emp { font-size: 10.5px; color: #4D6369; line-height: 1.45; margin-top: 2px; }
  .emp b { color: #0C2E37; }
  .sis { display: inline-flex; align-items: center; gap: 5px; }
  .sis img { height: 10px; opacity: .8; }
  .doc { text-align: right; }
  .doc h1 { margin: 0; font-size: 17px; color: #0C2E37; font-weight: 600; letter-spacing: .3px; }
  .doc .n { font-size: 20px; color: #17A974; font-weight: 600; font-family: Lexend; }
  .doc .f { color: #4D6369; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; }
  .caja { border: 1px solid #DCE5E7; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
  .fila { display: flex; gap: 10px; padding: 5px 0; border-bottom: 1px dashed #E3EAEC; }
  .fila:last-child { border: 0; }
  .fila span { width: 150px; color: #4D6369; flex-shrink: 0; }
  .fila b { font-weight: 700; }
  .valor { background: #0C2E37; color: #fff; border-radius: 8px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .valor .num { font-size: 22px; font-weight: 600; color: #5CE9AB; }
  .letras { font-size: 11px; color: #4D6369; font-style: italic; margin: -4px 0 12px; }
  .resumen { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
  .resumen div { background: #F2F5F5; border-radius: 6px; padding: 8px 10px; }
  .resumen small { display: block; font-size: 9.5px; text-transform: uppercase; color: #82959A; letter-spacing: .4px; }
  .resumen b { font-family: Lexend; font-size: 13px; font-weight: 600; }
  .firmas { display: flex; gap: 40px; margin-top: 46px; }
  .firmas div { flex: 1; border-top: 1px solid #10262C; padding-top: 5px; font-size: 10.5px; color: #4D6369; }
  th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .4px; color: #4D6369; padding: 6px 6px; border-bottom: 1.5px solid #0C2E37; }
  td { padding: 5px 6px; border-bottom: 1px solid #EBF0F1; }
  td.d, th.d { text-align: right; font-family: Lexend; }
  tr.tot td { font-weight: 700; border-top: 1.5px solid #0C2E37; border-bottom: 0; }
  h3 { font-size: 12px; color: #0C2E37; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .5px; font-weight: 600; }
  .anulado { position: fixed; top: 38%; left: 0; right: 0; text-align: center; font: 700 90px Lexend; color: rgba(220,38,38,.18); transform: rotate(-24deg); }
  .pie { margin-top: 18px; font-size: 9.5px; color: #82959A; text-align: center; }
  .rojo { color: #DC2626; }
  .copia { border-top: 1.5px dashed #9AAAB0; margin: 16px 0 14px; position: relative; }
  .recibo .cab { margin-bottom: 9px; }
  .recibo .caja { padding: 7px 12px; margin-bottom: 8px; }
  .recibo .fila { padding: 3px 0; }
  .recibo .valor { padding: 8px 14px; margin-bottom: 8px; }
  .recibo .valor .num { font-size: 19px; }
  .recibo .letras { margin: -2px 0 8px; }
  .recibo .resumen { margin-bottom: 6px; }
  .recibo .resumen div { padding: 6px 9px; }
  .recibo .firmas { margin-top: 30px; }
  .recibo .pie { margin-top: 8px; }
  .copia span { position: absolute; top: -8px; left: 50%; transform: translateX(-50%); background: #fff; padding: 0 10px; font-size: 9px; color: #82959A; letter-spacing: 1px; }`;

function imprimir(titulo, cuerpo, cssExtra = "") {
  if (E.mismaVentana) {
    document.open();
    document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS_IMPRESION}${cssExtra} @media screen { body{max-width:188mm;margin:12mm auto} }</style></head><body>${cuerpo}</body></html>`);
    document.close();
    return;
  }
  // Se imprime desde un iframe oculto en esta misma pestaña: la vista previa aparece encima del geovisor.
  // (Con una ventana aparte, el diálogo de impresión congelaba el geovisor si esa ventana quedaba detrás.)
  $("#marcoImpresion")?.remove();
  const f = Object.assign(document.createElement("iframe"), { id: "marcoImpresion", title: titulo });
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(f);
  const doc = f.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS_IMPRESION}${cssExtra}</style></head><body>${cuerpo}</body></html>`);
  doc.close();
  aviso("Preparando documento para imprimir…");
  const imgs = [...doc.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })));
  Promise.all([doc.fonts.ready, ...imgs]).then(() => setTimeout(() => {
    f.contentWindow.focus();
    f.contentWindow.print();
  }, 150));
}
// Encabezado de los documentos: los emite el vendedor del loteo (no ALPHA). Si existe img/logo_vendedor.png se usa.
function cabecera(titulo, numero, fechaDoc) {
  const c = E.config;
  const nombre = c.vendedor_razon_social || c.proyecto;
  const datos = [c.vendedor_nit ? `NIT ${esc(c.vendedor_nit)}` : "", esc(c.vendedor_direccion || ""), c.vendedor_telefono ? `Tel. ${esc(c.vendedor_telefono)}` : ""].filter(Boolean).join(" · ");
  return `<div class="cab"><div class="cab-izq"><img class="logo-v" src="${location.origin}/img/logo_vendedor.png" onerror="this.remove()">
      <div><div class="vend">${esc(nombre)}</div>
      <div class="emp">${datos ? datos + "<br>" : ""}Proyecto <b>${esc(c.proyecto)}</b>${c.ciudad ? " · " + esc(c.ciudad) : ""}</div></div></div>
    <div class="doc"><h1>${titulo}</h1>${numero ? `<div class="n">${numero}</div>` : ""}<div class="f">${fechaDoc}</div></div></div>`;
}
const PIE_SISTEMA = `<span class="sis">Sistema de ventas y cartera · <img src="${location.origin}/img/alpha_logo_color_oscuro.svg"></span>`;

async function imprimirRecibo(n) {
  let r;
  try { r = await api("/api/recibo?n=" + n); } catch (e) { falla(e); return; }
  const p = r.pago, v = r.detalle.ventas.find((x) => x.id === p.venta_id);
  const pagadoHasta = v.pagos.filter((x) => !x.anulado && x.recibo <= p.recibo).reduce((s, x) => s + x.valor, 0);
  const saldo = v.valor_venta ? Math.max(v.valor_venta - pagadoHasta, 0) : null;
  const num = `N° ${String(p.recibo).padStart(6, "0")}`;
  const unRecibo = (copia) => `${cabecera("RECIBO DE CAJA", num, `Fecha: ${fechaLarga(p.fecha)}`)}
    <div class="caja">
      <div class="fila"><span>Recibimos de</span><b>${esc(p.cliente)}</b></div>
      <div class="fila"><span>Documento</span><b>${esc(p.tipo_doc)} ${esc(p.documento || "—")}</b></div>
      <div class="fila"><span>Por concepto de</span><b>${esc(p.concepto)} — ${nombreLote(p.id_lote)} (${p.id_lote})</b></div>
      <div class="fila"><span>Medio de pago</span><b>${esc(p.medio)}${p.referencia ? " · Ref. " + esc(p.referencia) : ""}</b></div>
      ${p.observacion ? `<div class="fila"><span>Observación</span><b style="font-weight:400">${esc(p.observacion)}</b></div>` : ""}
    </div>
    <div class="valor"><span>VALOR RECIBIDO</span><span class="num">${pesos(p.valor)}</span></div>
    <div class="letras">Son: ${numeroALetras(p.valor)}</div>
    ${v.valor_venta ? `<div class="resumen"><div><small>Valor del negocio</small><b>${pesos(v.valor_venta)}</b></div>
      <div><small>Total abonado</small><b>${pesos(pagadoHasta)}</b></div><div><small>Saldo pendiente</small><b>${pesos(saldo)}</b></div>
      <div><small>Avance</small><b>${fmtN1.format((100 * pagadoHasta) / v.valor_venta)} %</b></div></div>` : ""}
    <div class="firmas"><div>Recibido por${p.usuario ? `: ${esc(p.usuario)}` : ""}</div><div>Firma del comprador</div></div>
    <div class="pie">${copia} · Generado el ${fecha(hoyISO())} · ${PIE_SISTEMA}</div>`;
  imprimir(`Recibo ${num}`, `<div class="recibo">${p.anulado ? `<div class="anulado">ANULADO</div>` : ""}${unRecibo("Original — comprador")}
    <div class="copia"><span>CORTE AQUÍ</span></div>${unRecibo("Copia — archivo")}</div>`);
}

function imprimirHoja(d) {
  const pie = `${E.config.proyecto} · ${d.lote.id_lote} · Corte ${fecha(hoyISO())}`.replace(/"/g, "'");
  imprimir(`Ficha integral ${d.lote.id_lote}`, hojaDeVidaHTML(d), CSS_HOJA.replace("HOJA_PIE", pie));
}

const descargarHoja = (id, btn) => descargarPDF("ficha", id, btn);

function imprimirEstadoCuenta(d) {
  const v = d.ventas.find((x) => x.estado === "ACTIVA"), l = d.lote;
  const nom = { PAGADA: "Pagada", VENCIDA: "Vencida", VENCIDA_PARCIAL: "Vencida (parcial)", PARCIAL: "Abono parcial", PENDIENTE: "Pendiente" };
  imprimir(`Estado de cuenta ${l.id_lote}`, `${cabecera("ESTADO DE CUENTA", l.id_lote, `Fecha de corte: ${fechaLarga(hoyISO())}`)}
    <div class="caja">
      <div class="fila"><span>Comprador</span><b>${esc(v.nombre)} · ${esc(v.tipo_doc)} ${esc(v.documento || "")}</b></div>
      <div class="fila"><span>Inmueble</span><b>${nombreLote(l.id_lote)} · ${m2(l.area_m2)}</b></div>
      <div class="fila"><span>Fecha de venta</span><b>${fecha(v.fecha_venta)}</b></div>
      <div class="fila"><span>Condiciones</span><b>${pesos(v.valor_venta)} · inicial ${pesos(v.cuota_inicial)} · ${v.n_cuotas ? `${v.n_cuotas} cuotas de ${pesos(cuotaDe(v))}` : "contado"}</b></div>
    </div>
    <div class="resumen"><div><small>Total pagado</small><b>${pesos(v.pagado)}</b></div><div><small>Saldo</small><b>${pesos(v.saldo)}</b></div>
      <div><small>Valor vencido</small><b class="${v.vencido ? "rojo" : ""}">${pesos(v.vencido)}</b></div><div><small>Días de mora</small><b class="${v.dias_mora ? "rojo" : ""}">${v.dias_mora || 0}</b></div></div>
    <h3>Plan de pagos</h3>
    <table><thead><tr><th>Cuota</th><th>Vencimiento</th><th class="d">Valor</th><th class="d">Pagado</th><th class="d">Pendiente</th><th>Estado</th></tr></thead><tbody>
      ${v.plan.map((c) => `<tr><td>${c.n === 0 ? "Inicial" : c.n}</td><td>${fecha(c.fecha)}</td><td class="d">${pesos(c.valor)}</td><td class="d">${pesos(c.pagado)}</td>
        <td class="d">${c.pendiente > 0.5 ? pesos(c.pendiente) : "—"}</td><td class="${c.estado.startsWith("VENCIDA") ? "rojo" : ""}">${nom[c.estado]}</td></tr>`).join("")}
      <tr class="tot"><td colspan="2">Total</td><td class="d">${pesos(v.valor_venta)}</td><td class="d">${pesos(v.pagado)}</td><td class="d">${pesos(v.saldo)}</td><td></td></tr></tbody></table>
    <h3>Pagos recibidos</h3>
    <table><thead><tr><th>Recibo</th><th>Fecha</th><th>Concepto</th><th>Medio</th><th class="d">Valor</th></tr></thead><tbody>
      ${v.pagos.filter((p) => !p.anulado).map((p) => `<tr><td>N° ${String(p.recibo).padStart(6, "0")}</td><td>${fecha(p.fecha)}</td><td>${esc(p.concepto)}</td><td>${esc(p.medio)}</td><td class="d">${pesos(p.valor)}</td></tr>`).join("") || `<tr><td colspan="5">Sin pagos.</td></tr>`}
    </tbody></table>
    <div class="pie">Este estado de cuenta refleja los pagos registrados hasta la fecha de corte. Cualquier diferencia debe soportarse con el recibo de caja correspondiente.<br>${PIE_SISTEMA}</div>`);
}

function imprimirInforme() {
  const r = E.resumen, c = r.conteo;
  const vendidos = (c.VENDIDO || 0) + (c.PAGADO || 0) + (c.ESCRITURADO || 0);
  const mora = E.lotes.filter((l) => EN_MORA.includes(l.cartera)).sort((a, b) => b.dias_mora - a.dias_mora);
  imprimir("Informe de ventas y cartera", `${cabecera("INFORME DE VENTAS Y CARTERA", "", `Corte: ${fechaLarga(r.fecha)}`)}
    <div class="resumen"><div><small>Lotes vendidos</small><b>${vendidos} de ${r.total_lotes}</b></div><div><small>Separados</small><b>${c.SEPARADO || 0}</b></div>
      <div><small>Disponibles</small><b>${c.DISPONIBLE || 0}</b></div><div><small>Bloqueados</small><b>${c.BLOQUEADO || 0}</b></div>
      <div><small>Valor vendido</small><b>${pesos(r.valor_vendido)}</b></div><div><small>Recaudado</small><b>${pesos(r.recaudado)}</b></div>
      <div><small>Cartera por cobrar</small><b>${pesos(r.cartera)}</b></div><div><small>Cartera vencida</small><b class="rojo">${pesos(r.vencido)}</b></div></div>
    <h3>Resumen por manzana</h3>
    <table><thead><tr><th>Manzana</th><th class="d">Lotes</th><th class="d">Disp.</th><th class="d">Sep.</th><th class="d">Vend.</th><th class="d">Valor vendido</th><th class="d">Recaudado</th><th class="d">Saldo</th><th class="d">Mora</th></tr></thead><tbody>
      ${r.manzanas.map((m) => `<tr><td>MZ ${String(m.manzana).padStart(2, "0")}</td><td class="d">${m.lotes}</td><td class="d">${m.disponibles}</td><td class="d">${m.separados}</td><td class="d">${m.vendidos}</td>
        <td class="d">${pesos(m.valor_venta)}</td><td class="d">${pesos(m.pagado)}</td><td class="d">${pesos(m.saldo)}</td><td class="d">${m.en_mora}</td></tr>`).join("")}
      <tr class="tot"><td>Total</td><td class="d">${r.total_lotes}</td><td class="d">${c.DISPONIBLE || 0}</td><td class="d">${c.SEPARADO || 0}</td><td class="d">${vendidos}</td>
        <td class="d">${pesos(r.valor_vendido)}</td><td class="d">${pesos(r.recaudado)}</td><td class="d">${pesos(r.cartera)}</td><td class="d">${r.lotes_mora}</td></tr></tbody></table>
    <h3>Lotes en mora</h3>
    <table><thead><tr><th>Lote</th><th>Comprador</th><th>Teléfono</th><th class="d">Días</th><th class="d">Vencido</th><th class="d">Saldo</th></tr></thead><tbody>
      ${mora.map((l) => `<tr><td>${l.id_lote}</td><td>${esc(l.cliente)}</td><td>${esc(l.telefono || "")}</td><td class="d rojo">${l.dias_mora}</td><td class="d">${pesos(l.vencido)}</td><td class="d">${pesos(l.saldo)}</td></tr>`).join("") || `<tr><td colspan="6">No hay lotes en mora.</td></tr>`}
    </tbody></table>
    <div class="pie">Informe generado el ${fechaLarga(hoyISO())} · ${PIE_SISTEMA}</div>`);
}

iniciar().catch((e) => { console.error(e); aviso("No se pudo iniciar el geovisor: " + e.message, true); });
