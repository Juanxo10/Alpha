// @ts-nocheck
/* Documentos imprimibles (ficha integral, promesa, paz y salvo, certificado, cotización, informe de comisionista).
   Código del geovisor original, con el contexto (planos, configuración) que fija setContexto(). */
import { fecha, fechaLarga, fmtN, fmtN1, m2, pesos, ESTADOS, CARTERA } from './formato'
import { numeroALetras } from './letras'
import { cabecera as cabeceraBase, esc, imprimir } from './imprimir'
import { hoyISO, sumarDias, sumarMeses } from './ui'
import { aGMS, aPlano, EPSG_3116, EPSG_9377 } from './geodesia'

let E = { geo: {}, props: {}, config: {}, porId: {} }
export function setContexto(geo, props, config, lotes) {
  E = {
    geo: { lotesGeo: geo.lotes, manz: geo.manz, manzEtq: geo.manzEtq, vias: geo.vias, zv: geo.zv, cano: geo.cano, limite: geo.limite },
    props, config, porId: Object.fromEntries(lotes.map((l) => [l.id_lote, l])),
  }
}
const cabecera = (t, n, f) => cabeceraBase(E.config, t, n, f)
const chip = (k, cat) => k ? `<span class="chip ${k}">${esc((cat || ESTADOS)[k]?.nom || k)}</span>` : ''
const chipCartera = (k) => k && !['SEPARADO', 'PAGADO'].includes(k) ? chip(k, CARTERA) : ''
const cuotaDe = (v) => { const c = v.plan.find((x) => x.n === 1); return c ? c.valor : 0 }
const REGLAS_COM = {
  RECAUDO: { nom: 'Proporcional al recaudo', ayuda: 'Se causa a medida que el comprador paga el lote.' },
  INICIAL: { nom: 'Al pagarse la cuota inicial', ayuda: 'Se causa completa cuando se paga la cuota inicial.' },
  VENTA: { nom: 'Al firmar la venta', ayuda: 'Se causa completa en el momento de la venta.' },
}
const ESTADOS_COM = { POR_PAGAR: 'Por pagar', EN_CAUSACION: 'En causación', PAGADA: 'Pagada', EN_SEPARACION: 'Lote separado', VENTA_DESISTIDA: 'Venta desistida', ANULADA: 'Anulada' }
const VINCULOS_COM = { INDEPENDIENTE: 'Independiente', INMOBILIARIA: 'Inmobiliaria', EMPLEADO: 'Empleado', REFERIDO: 'Referido' }
const vivaCom = (x) => !['VENTA_DESISTIDA', 'ANULADA'].includes(x.estado_comision)
const pct = (v) => `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v || 0)} %`
const NOMBRE_DOC = { ficha: 'Ficha integral', comisionista: 'Informe de comisiones', promesa: 'Promesa de compraventa',
  pazysalvo: 'Paz y salvo', certificado: 'Certificado de pagos', cotizacion: 'Cotización' }

const num2 = (x) => Number(String(x || 0).replace(",", ".")) || 0;
const ORDEN_RUMBO = { Norte: 0, Oriente: 1, Sur: 2, Occidente: 3 };

// ---------------------------------------------------------------- proyección local (metros)
function proyector(lat0, lon0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  return ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky];
}
function anillos(geom) {
  return geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
}
function cajaDe(puntos) {
  const xs = puntos.map((p) => p[0]), ys = puntos.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Dibuja polígonos GeoJSON en un SVG con escala y orientación norte arriba
function svgPlano(ancho, alto, caja, capas, extras = "") {
  const [x0, y0, x1, y1] = caja;
  const s = Math.min(ancho / (x1 - x0), alto / (y1 - y0));
  const ox = (ancho - (x1 - x0) * s) / 2, oy = (alto - (y1 - y0) * s) / 2;
  const T = ([x, y]) => [ox + (x - x0) * s, alto - (oy + (y - y0) * s)];
  const cuerpo = capas.map((c) => c(T, s)).join("");
  const idc = "clip" + ++svgPlano.n;
  return { svg: `<svg viewBox="0 0 ${ancho} ${alto}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="${idc}"><rect width="${ancho}" height="${alto}"/></clipPath></defs><g clip-path="url(#${idc})">${cuerpo}</g>${extras}</svg>`, T, s };
}
svgPlano.n = 0;
const ruta = (T, pol) => pol.map((r) => "M" + r.map((p) => T(p).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join("");

function flechaNorte(x, y) {
  return `<g transform="translate(${x},${y})"><circle r="15" fill="#fff" stroke="#0C2E37" stroke-width="1"/>
    <path d="M0,-11 L5,6 L0,2 L-5,6 Z" fill="#0C2E37"/><text y="-17" text-anchor="middle" style="font:700 9px Lexend,Arial;fill:#0C2E37">N</text></g>`;
}
function barraEscala(x, y, s) {
  const opciones = [5, 10, 20, 25, 50, 100];
  const m = opciones.find((o) => o * s >= 60) || 100, w = m * s;
  return `<g transform="translate(${x},${y})" style="font:9px Cabin,Arial;fill:#4D6369">
    <rect width="${w / 2}" height="5" fill="#0C2E37"/><rect x="${w / 2}" width="${w / 2}" height="5" fill="#fff" stroke="#0C2E37" stroke-width=".8"/>
    <text y="16">0</text><text x="${w}" y="16" text-anchor="end">${m} m</text></g>`;
}

// Plano de localización: la manzana del lote con sus vecinos y el lote resaltado
function planoLocalizacion(id, ancho = 520, alto = 300) {
  const p = E.props[id];
  const fLote = E.geo.lotesGeo.features.find((f) => f.properties.id_lote === id);
  const fMz = E.geo.manz.features.find((f) => f.properties.manzana === p.manzana);
  const c0 = fLote.geometry.coordinates[0][0];
  const P = proyector(c0[1], c0[0]);
  const proy = (g) => anillos(g).map((pol) => pol.map((r) => r.map(P)));
  const mz = proy(fMz.geometry);
  let caja = cajaDe(mz.flat(2));
  const margen = Math.max((caja[2] - caja[0]) * 0.08, 18);
  caja = [caja[0] - margen, caja[1] - margen, caja[2] + margen, caja[3] + margen];
  // si la manzana es muy alargada, se centra en el lote para que se lea bien
  const lt = proy(fLote.geometry), cl = cajaDe(lt.flat(2));
  const maxLado = 160;
  if (caja[2] - caja[0] > maxLado * 1.6 || caja[3] - caja[1] > maxLado) {
    const cx = (cl[0] + cl[2]) / 2, cy = (cl[1] + cl[3]) / 2, ra = ancho / alto;
    const h = maxLado * 0.62, w = h * ra;
    caja = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
  }
  const dentro = (g) => { const b = cajaDe(proy(g).flat(2)); return !(b[2] < caja[0] || b[0] > caja[2] || b[3] < caja[1] || b[1] > caja[3]); };
  const capa = (feats, estilo) => (T) => feats.filter((f) => dentro(f.geometry)).map((f) => `<path d="${ruta(T, proy(f.geometry).flat())}" ${estilo(f)}/>`).join("");
  const lotesVis = E.geo.lotesGeo.features.filter((f) => dentro(f.geometry));
  const { svg } = svgPlano(ancho, alto, caja, [
    () => `<rect width="${ancho}" height="${alto}" fill="#F4F7F7"/>`,
    capa(E.geo.vias.features, () => `fill="#DDE3E5" stroke="#C5CED1" stroke-width=".6"`),
    capa(E.geo.zv.features, (f) => f.properties.tipo.includes("RONDA") ? `fill="#CDE8F6" stroke="#7FB6D6" stroke-width=".6"` : `fill="#D8EFD2" stroke="#93C487" stroke-width=".6"`),
    (T) => lotesVis.map((f) => `<path d="${ruta(T, proy(f.geometry).flat())}" fill="${f.properties.id_lote === id ? "#5CE9AB" : "#FFFFFF"}" stroke="#9AAAB0" stroke-width=".6"/>`).join(""),
    capa(E.geo.manz.features, () => `fill="none" stroke="#0C2E37" stroke-width="1.6"`),
    (T) => `<path d="${ruta(T, lt.flat())}" fill="#5CE9AB" stroke="#0C2E37" stroke-width="2.4"/>`,
    (T, s) => s > 5.5 ? lotesVis.map((f) => {
      const b = cajaDe(proy(f.geometry).flat(2)), [x, y] = T([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
      const sel = f.properties.id_lote === id;
      return `<text x="${x}" y="${y + 3}" text-anchor="middle" style="font:${sel ? "700 11px" : "8.5px"} Lexend,Arial;fill:${sel ? "#0C2E37" : "#82959A"}">${f.properties.lote}</text>`;
    }).join("") : "",
  ], `${flechaNorte(ancho - 26, 30)}${barraEscala(14, alto - 26, Math.min(ancho / (caja[2] - caja[0]), alto / (caja[3] - caja[1])))}`);
  return svg;
}

// ---------------------------------------------------------------- participación en el predio
// % del área del lote sobre el área total del predio (polígono límite del loteo), calculado en 01_exportar_web.py
const fmtPct4 = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtHa = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
function pctPredio(id) {
  const p = E.props[id];
  return p && p.pct_predio != null ? `${fmtPct4.format(p.pct_predio)} %` : "—";
}
function areaPredioTxt(id) {
  const a = E.props[id]?.area_predio_m2;
  return a ? `${fmtN1.format(a)} m² = ${fmtHa.format(a / 10000)} ha` : "—";
}

// Plano general: todo el predio con el lote señalado (ubicación del lote dentro del predio)
function planoGeneral(id, ancho = 700, alto = 290, mini = false) {
  const fLim = E.geo.limite.features[0];
  const fLote = E.geo.lotesGeo.features.find((f) => f.properties.id_lote === id);
  const p = E.props[id];
  const c0 = anillos(fLim.geometry)[0][0][0];
  const P = proyector(c0[1], c0[0]);
  const proy = (g) => anillos(g).map((pol) => pol.map((r) => r.map(P)));
  const lim = proy(fLim.geometry);
  let caja = cajaDe(lim.flat(2));
  const mg = (caja[2] - caja[0]) * (mini ? 0.03 : 0.04);
  caja = [caja[0] - mg, caja[1] - mg, caja[2] + mg, caja[3] + mg];
  const lt = proy(fLote.geometry), cl = cajaDe(lt.flat(2));
  const centro = [(cl[0] + cl[2]) / 2, (cl[1] + cl[3]) / 2];
  const pinta = (feats, estilo) => (T) => feats.map((f) => `<path d="${ruta(T, proy(f.geometry).flat())}" ${estilo(f)}/>`).join("");
  const capas = [
    () => `<rect width="${ancho}" height="${alto}" fill="#F4F7F7"/>`,
    (T) => `<path d="${ruta(T, lim.flat())}" fill="#FFFFFF"/>`,
    pinta(E.geo.vias.features, () => `fill="#DDE3E5"`),
    pinta(E.geo.zv.features, (f) => f.properties.tipo.includes("RONDA") ? `fill="#CDE8F6"` : `fill="#D8EFD2"`),
    (T) => E.geo.cano.features.map((f) => {
      const ls = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
      return ls.map((l) => `<path d="M${l.map((q) => T(P(q)).map((v) => v.toFixed(1)).join(",")).join("L")}" fill="none" stroke="#3B82C4" stroke-width="${mini ? 0.8 : 1.4}"/>`).join("");
    }).join(""),
  ];
  if (!mini) capas.push(pinta(E.geo.lotesGeo.features, () => `fill="none" stroke="#D3DCDF" stroke-width=".35"`));
  capas.push(
    pinta(E.geo.manz.features, (f) => f.properties.manzana === p.manzana
      ? `fill="#C9F5E1" stroke="#0C2E37" stroke-width="${mini ? 0.8 : 1.2}"` : `fill="none" stroke="#7C9096" stroke-width="${mini ? 0.5 : 0.8}"`),
    (T) => `<path d="${ruta(T, lim.flat())}" fill="none" stroke="#DC2626" stroke-width="${mini ? 1 : 1.6}" stroke-dasharray="${mini ? "3 2" : "6 3"}"/>`,
    (T) => `<path d="${ruta(T, lt.flat())}" fill="#5CE9AB" stroke="#0C2E37" stroke-width="1"/>`,
  );
  if (!mini) capas.push((T) => E.geo.manzEtq.features.map((f) => {
    if (f.properties.manzana === p.manzana) return "";
    const [x, y] = T(P(f.geometry.coordinates));
    return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="middle" style="font:7.5px Lexend,Arial;fill:#82959A">${f.properties.id_manzana}</text>`;
  }).join(""));
  // marcador del lote
  capas.push((T) => {
    const [x, y] = T(centro);
    if (mini) return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="none" stroke="#DC2626" stroke-width="2"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="#DC2626"/>`;
    const izq = x > ancho * 0.62, arriba = y > alto * 0.45;
    const lx = x + (izq ? -60 : 60), ly = y + (arriba ? -36 : 36), tw = 92;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="none" stroke="#DC2626" stroke-width="2.2"/>
      <line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="#DC2626" stroke-width="1.2"/>
      <rect x="${(lx - tw / 2).toFixed(1)}" y="${(ly - 11).toFixed(1)}" width="${tw}" height="22" rx="4" fill="#0C2E37"/>
      <text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" style="font:700 10px Lexend,Arial;fill:#5CE9AB">${id}</text>`;
  });
  const s = Math.min(ancho / (caja[2] - caja[0]), alto / (caja[3] - caja[1]));
  const { svg } = svgPlano(ancho, alto, caja, capas, mini ? "" : `${flechaNorte(ancho - 26, 30)}${barraEscala(14, alto - 26, s)}
    <g transform="translate(${ancho - 200},${alto - 16})" style="font:8.5px Cabin,Arial;fill:#4D6369">
      <path d="M0,0 h16" stroke="#DC2626" stroke-width="1.6" stroke-dasharray="5 3"/><text x="20" y="3">Límite del predio</text>
      <rect x="98" y="-5" width="12" height="10" fill="#5CE9AB" stroke="#0C2E37" stroke-width=".8"/><text x="114" y="3">Lote</text>
      <rect x="142" y="-5" width="12" height="10" fill="#C9F5E1" stroke="#0C2E37" stroke-width=".8"/><text x="158" y="3">Manzana</text></g>`);
  return svg;
}

// Plano del lote acotado: costados con su longitud y colindante
function planoLote(id, ancho = 340, alto = 260) {
  const p = E.props[id];
  const f = E.geo.lotesGeo.features.find((x) => x.properties.id_lote === id);
  const c0 = f.geometry.coordinates[0][0];
  const P = proyector(c0[1], c0[0]);
  const anillo = f.geometry.coordinates[0].map(P);
  const b = cajaDe(anillo), m = Math.max(b[2] - b[0], b[3] - b[1]) * 0.42;
  const caja = [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
  // costados: unir tramos alineados (<10°)
  const pts = anillo.slice(0, -1), cost = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], z = pts[(i + 1) % pts.length], ang = Math.atan2(z[1] - a[1], z[0] - a[0]);
    const ult = cost[cost.length - 1];
    const dif = (x, y) => Math.abs(((x - y + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
    if (ult && dif(ang, ult.ang) < 0.1745) ult.z = z; else cost.push({ a, z, ang });
  }
  if (cost.length > 1) {
    const d = Math.abs(((cost[0].ang - cost[cost.length - 1].ang + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
    if (d < 0.1745) cost[0].a = cost.pop().a;
  }
  const lind = [...(p.linderos || [])];
  const rumbo = (nx, ny) => { const g = ((Math.atan2(ny, nx) * 180) / Math.PI + 360) % 360; return g >= 45 && g < 135 ? "Norte" : g >= 135 && g < 225 ? "Occidente" : g >= 225 && g < 315 ? "Sur" : "Oriente"; };
  const etiquetas = (T) => cost.map((c) => {
    const L = Math.hypot(c.z[0] - c.a[0], c.z[1] - c.a[1]);
    if (L < 0.3) return "";
    const nx = (c.z[1] - c.a[1]) / L, ny = -(c.z[0] - c.a[0]) / L, r = rumbo(nx, ny);
    const k = lind.findIndex((l) => l.rumbo === r && Math.abs(l.longitud_m - L) < 0.6);
    const col = k >= 0 ? lind.splice(k, 1)[0].colinda.map(nomColindante).join(" / ") : "";
    const mid = [(c.a[0] + c.z[0]) / 2, (c.a[1] + c.z[1]) / 2];
    const [x1, y1] = T(mid), [x2, y2] = T([mid[0] + nx * 0.1, mid[1] + ny * 0.1]);
    const dx = x2 - x1, dy = y2 - y1, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
    let rot = (Math.atan2(T(c.z)[1] - T(c.a)[1], T(c.z)[0] - T(c.a)[0]) * 180) / Math.PI;
    if (rot > 90) rot -= 180; if (rot < -90) rot += 180;
    const tx = x1 + ux * 13, ty = y1 + uy * 13, cx = x1 + ux * 30, cy = y1 + uy * 30;
    return `<text transform="translate(${tx.toFixed(1)},${ty.toFixed(1)}) rotate(${rot.toFixed(1)})" text-anchor="middle" dy="3.5" style="font:600 10.5px Lexend,Arial;fill:#0C2E37">${fmtN1.format(L)} m</text>
      ${col ? `<text transform="translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${rot.toFixed(1)})" text-anchor="middle" dy="3" style="font:9px Cabin,Arial;fill:#4D6369">${esc(col)}</text>` : ""}`;
  }).join("");
  const { svg } = svgPlano(ancho, alto, caja, [
    () => `<rect width="${ancho}" height="${alto}" fill="#F4F7F7"/>`,
    (T) => `<path d="${ruta(T, [anillo])}" fill="#E6FCF2" stroke="#0C2E37" stroke-width="2"/>`,
    (T) => anillo.slice(0, -1).map((q) => { const [x, y] = T(q); return `<circle cx="${x}" cy="${y}" r="2.6" fill="#0C2E37"/>`; }).join(""),
    (T) => { const bb = cajaDe(anillo), [x, y] = T([(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]);
      return `<text x="${x}" y="${y - 2}" text-anchor="middle" style="font:600 13px Lexend,Arial;fill:#0C2E37">Lote ${p.lote}</text>
        <text x="${x}" y="${y + 13}" text-anchor="middle" style="font:11px Cabin,Arial;fill:#4D6369">${fmtN1.format(p.area_m2)} m²</text>`; },
    etiquetas,
  ], flechaNorte(ancho - 24, 26));
  return svg;
}
function nomColindante(c) {
  const m = /^MZ(\d+)-L(\d+)$/.exec(c);
  return m ? `Lote ${+m[2]} (Mz ${+m[1]})` : c;
}

// ---------------------------------------------------------------- georreferenciación del lote
const fmt2 = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Esquinas reales del lote (se descartan los puntos intermedios de un mismo costado): P1 = noroccidental, sentido horario
function verticesLote(id) {
  const f = E.geo.lotesGeo.features.find((x) => x.properties.id_lote === id);
  if (!f) return [];
  const [lon0, lat0] = anillos(f.geometry)[0][0][0];
  const P = proyector(lat0, lon0);
  let q = anillos(f.geometry)[0][0].slice(0, -1).map(([lon, lat]) => ({ lon, lat, xy: P([lon, lat]) }));
  q = q.filter((a, i) => { const b = q[(i + 1) % q.length]; return Math.hypot(b.xy[0] - a.xy[0], b.xy[1] - a.xy[1]) > 0.05; });
  const giro = (i) => {
    const a = q[(i + q.length - 1) % q.length].xy, b = q[i].xy, c = q[(i + 1) % q.length].xy;
    const d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    return Math.abs(((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
  };
  q = q.filter((_, i) => giro(i) > 0.1745);
  if (q.length < 3) return [];
  const area2 = q.reduce((t, a, i) => { const b = q[(i + 1) % q.length]; return t + a.xy[0] * b.xy[1] - b.xy[0] * a.xy[1]; }, 0);
  if (area2 > 0) q.reverse();                                   // horario (y hacia el norte)
  let k = 0;
  q.forEach((a, i) => { if (a.xy[1] - a.xy[0] > q[k].xy[1] - q[k].xy[0]) k = i; });
  q = [...q.slice(k), ...q.slice(0, k)];
  return q.map((a, i) => {
    const b = q[(i + 1) % q.length];
    const [e, n] = aPlano(a.lon, a.lat, EPSG_9377), [e2, n2] = aPlano(a.lon, a.lat, EPSG_3116);
    return { n: i + 1, ...a, e, nn: n, e2, n2, lado: Math.hypot(b.xy[0] - a.xy[0], b.xy[1] - a.xy[1]) };
  });
}
function planoVertices(vs, ancho = 330, alto = 250) {
  const xs = vs.map((v) => v.xy[0]), ys = vs.map((v) => v.xy[1]);
  const b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], m = Math.max(b[2] - b[0], b[3] - b[1]) * 0.3;
  const cx = xs.reduce((t, x) => t + x, 0) / vs.length, cy = ys.reduce((t, y) => t + y, 0) / vs.length;
  const { svg } = svgPlano(ancho, alto, [b[0] - m, b[1] - m, b[2] + m, b[3] + m], [
    () => `<rect width="${ancho}" height="${alto}" fill="#F4F7F7"/>`,
    (T) => `<path d="${ruta(T, [[...vs.map((v) => v.xy), vs[0].xy]])}" fill="#E6FCF2" stroke="#0C2E37" stroke-width="1.6"/>`,
    (T) => vs.map((v, i) => {                                   // distancia de cada lado, hacia afuera
      const w = vs[(i + 1) % vs.length], [x1, y1] = T(v.xy), [x2, y2] = T(w.xy);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, [gx, gy] = T([cx, cy]);
      let nx = -(y2 - y1), ny = x2 - x1; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      if ((mx - gx) * nx + (my - gy) * ny < 0) { nx = -nx; ny = -ny; }
      let rot = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI; if (rot > 90) rot -= 180; if (rot < -90) rot += 180;
      return `<text transform="translate(${(mx + nx * 11).toFixed(1)},${(my + ny * 11).toFixed(1)}) rotate(${rot.toFixed(1)})" text-anchor="middle" dy="3" style="font:600 9.5px Lexend,Arial;fill:#4D6369">${fmtN1.format(v.lado)} m</text>`;
    }).join(""),
    (T) => vs.map((v) => {
      const [x, y] = T(v.xy), [gx, gy] = T([cx, cy]);
      let dx = x - gx, dy = y - gy; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.2" fill="#0C2E37" stroke="#5CE9AB" stroke-width="1.6"/>
        <text x="${(x + dx * 15).toFixed(1)}" y="${(y + dy * 15 + 3.5).toFixed(1)}" text-anchor="middle" style="font:700 11px Lexend,Arial;fill:#0C2E37">P${v.n}</text>`;
    }).join(""),
  ], flechaNorte(ancho - 24, 26));
  return svg;
}
function georreferenciaHTML(id) {
  const vs = verticesLote(id);
  if (!vs.length) return "";
  const lado = (i) => `P${vs[i].n}–P${vs[(i + 1) % vs.length].n}`;
  const plano = String(E.config.crs_nombre || "").includes("3116");
  return `<div class="bloque geo"><h2 class="sub">Georreferenciación del lote <em>${vs.length} vértices</em></h2>
    <table class="lista"><thead><tr><th>Punto</th><th class="d">Este (X)</th><th class="d">Norte (Y)</th><th>Latitud</th><th>Longitud</th><th>Lado</th><th class="d">Distancia</th></tr></thead><tbody>
      ${vs.map((v, i) => `<tr><td><b>P${v.n}</b></td><td class="d">${fmt2.format(v.e)}</td><td class="d">${fmt2.format(v.nn)}</td><td class="d">${aGMS(v.lat, "lat")}</td><td class="d">${aGMS(v.lon, "lon")}</td><td class="d">${lado(i)}</td><td class="d">${fmtN1.format(v.lado)} m</td></tr>`).join("")}</tbody></table>
    <div class="dos d2"><figure>${planoVertices(vs)}<figcaption>Vértices del lote · P1 es la esquina noroccidental y la numeración sigue el sentido de las agujas del reloj</figcaption></figure>
      <div class="nota-geo"><p><b>Sistema de referencia.</b> Coordenadas planas en MAGNA-SIRGAS / Origen Nacional (EPSG:9377), el sistema de proyección cartográfica oficial de Colombia. Coordenadas geográficas (latitud y longitud) en MAGNA-SIRGAS. Distancias en metros sobre el terreno.</p>
      ${plano ? `<table class="lista"><thead><tr><th>Punto</th><th class="d">Este</th><th class="d">Norte</th></tr></thead><tbody>
        ${vs.map((v) => `<tr><td><b>P${v.n}</b></td><td class="d">${fmt2.format(v.e2)}</td><td class="d">${fmt2.format(v.n2)}</td></tr>`).join("")}</tbody></table>
        <p class="peq">Coordenadas del plano de loteo del proyecto (${esc(E.config.crs_nombre)}).</p>` : ""}
      <p class="peq">Las coordenadas corresponden al plano de loteo del proyecto; los linderos y coordenadas definitivos serán los que consten en la escritura pública y, si se requiere, en el levantamiento topográfico del lote.</p></div></div></div>`;
}

// ---------------------------------------------------------------- informe
const NOM_CUOTA = { PAGADA: "Pagada", VENCIDA: "Vencida", VENCIDA_PARCIAL: "Vencida (parcial)", PARCIAL: "Abono parcial", PENDIENTE: "Pendiente" };

function hojaDeVidaHTML(d) {
  const c = E.config, l = d.lote, r = d.resumen, p = E.props[l.id_lote];
  const v = d.ventas.find((x) => x.estado === "ACTIVA");
  const corte = hoyISO();
  const pm2 = l.precio_lista ? l.precio_lista / l.area_m2 : null;
  const lind = [...(p.linderos || [])].sort((a, b) => ORDEN_RUMBO[a.rumbo] - ORDEN_RUMBO[b.rumbo]);
  const titulo = v ? "FICHA INTEGRAL DEL LOTE" : "FICHA TÉCNICA Y COMERCIAL DEL LOTE";
  const fila = (et, va) => `<tr><th>${et}</th><td>${va}</td></tr>`;
  let h = `<div class="hv">${cabecera(titulo, l.id_lote, `Fecha de corte: ${fechaLarga(corte)}`)}
    <div class="banda">
      <div><div class="b-tit">Manzana ${l.manzana} · Lote ${l.lote}</div>
        <div class="b-sub">${esc(c.proyecto)}${c.ciudad ? " · " + esc(c.ciudad) : ""}</div>
        <div class="b-chips">${chip(r.estado)}${chipCartera(r.cartera)}</div></div>
      <div class="b-cifras">
        <div><small>Área</small><b>${fmtN1.format(l.area_m2)} m²</b></div>
        <div><small>% del predio</small><b>${pctPredio(l.id_lote)}</b></div>
        ${v ? `<div><small>Valor del negocio</small><b>${pesos(v.valor_venta)}</b></div>
        <div><small>Saldo a la fecha</small><b>${pesos(v.saldo)}</b></div>`
        : `<div><small>Precio de lista</small><b>${l.precio_lista ? pesos(l.precio_lista) : "Por definir"}</b></div>`}
      </div></div>

    <h2><span>1</span>Identificación del inmueble</h2>
    <div class="dos">
      <table class="ficha">
        ${fila("Proyecto", esc(c.proyecto))}
        ${fila("Ubicación", esc(c.ciudad || "—"))}
        ${fila("Código del lote", l.id_lote)}
        ${fila("Manzana / lote", `Manzana ${l.manzana} · Lote ${l.lote}`)}
        ${fila("Área", `${fmtN1.format(l.area_m2)} m²`)}
        ${fila("Perímetro", `${fmtN1.format(p.perimetro_m)} m`)}
        ${fila("Participación en el predio", `${pctPredio(l.id_lote)}<br><small>del área total del predio: ${areaPredioTxt(l.id_lote)}</small>`)}
        ${fila("Frente × fondo", `${fmtN1.format(p.frente_m)} m × ${fmtN1.format(p.fondo_m)} m`)}
        ${fila("Coordenadas (centro)", `E ${fmtN.format(p.este)} · N ${fmtN.format(p.norte)}<br><small>${esc(E.config.crs_nombre || "")}</small>`)}
        ${fila("Precio de lista", l.precio_lista ? `${pesos(l.precio_lista)} <small>(${pesos(pm2)} / m²)</small>` : "Por definir")}
      </table>
      <figure>${planoLocalizacion(l.id_lote)}<figcaption>Plano de localización · Manzana ${l.manzana}</figcaption></figure>
    </div>
    <figure class="general">${planoGeneral(l.id_lote)}<figcaption>Ubicación del lote dentro del predio · el lote ${l.id_lote} corresponde al <b>${pctPredio(l.id_lote)}</b> del área total del predio (${areaPredioTxt(l.id_lote)})</figcaption></figure>

    <div class="bloque"><h2><span>2</span>Linderos y medidas</h2>
    <div class="dos d2">
      <table class="lista"><thead><tr><th>Costado</th><th class="d">Longitud</th><th>Colinda con</th></tr></thead><tbody>
        ${lind.map((x) => `<tr><td><b>${x.rumbo}</b></td><td class="d">${fmtN1.format(x.longitud_m)} m</td><td>${x.colinda.map((k) => esc(nomColindante(k))).join(" y ")}</td></tr>`).join("")}
        <tr class="tot"><td>Perímetro</td><td class="d">${fmtN1.format(p.perimetro_m)} m</td><td></td></tr></tbody></table>
      <figure>${planoLote(l.id_lote)}<figcaption>Lote acotado (medidas en metros)</figcaption></figure>
    </div></div>
    ${georreferenciaHTML(l.id_lote)}`;

  if (v) {
    const esSep = v.etapa === "SEPARADO";
    const desc = l.precio_lista && v.valor_venta ? l.precio_lista - v.valor_venta : 0;
    const cuota = cuotaDe(v);
    h += `<h2><span>3</span>Comprador</h2>
    <table class="ficha ancha">
      ${fila("Nombre", `<b>${esc(v.nombre)}</b>`)}
      ${fila("Identificación", `${esc(v.tipo_doc)} ${esc(v.documento || "—")}`)}
      ${fila("Teléfono", esc(v.telefono || "—"))}
      ${fila("Correo electrónico", esc(v.email || "—"))}
      ${v.direccion ? fila("Dirección", esc(v.direccion)) : ""}
    </table>

    <h2><span>4</span>Condiciones del negocio</h2>
    <table class="ficha ancha cols">
      <tr><th>Etapa</th><td>${ESTADOS[r.estado]?.nom || r.estado}</td><th>Asesor</th><td>${esc(v.vendedor || "—")}</td></tr>
      ${v.fecha_separacion ? `<tr><th>Fecha de separación</th><td>${fecha(v.fecha_separacion)}</td><th>Separación vigente hasta</th><td>${fecha(v.fecha_limite_separacion)}</td></tr>` : ""}
      ${esSep ? `<tr><th>Valor pactado</th><td>${pesos(v.valor_venta)}</td><th></th><td></td></tr>` : `
      <tr><th>Fecha de venta</th><td>${fecha(v.fecha_venta)}</td><th>Valor de venta</th><td><b>${pesos(v.valor_venta)}</b></td></tr>
      <tr><th>Precio de lista</th><td>${pesos(l.precio_lista)}</td><th>Descuento otorgado</th><td>${desc > 0 ? `${pesos(desc)} (${fmtN1.format((100 * desc) / l.precio_lista)} %)` : "—"}</td></tr>
      <tr><th>Cuota inicial</th><td>${pesos(v.cuota_inicial)} ${v.inicial_pagada ? `<span class="ok">✓ pagada</span>` : ""}</td><th>Saldo financiado</th><td>${pesos(v.valor_venta - v.cuota_inicial)}</td></tr>
      <tr><th>Forma de pago</th><td>${v.n_cuotas ? `${v.n_cuotas} cuotas mensuales de ${pesos(cuota)}` : "Contado"}</td><th>Valor por m²</th><td>${pesos(v.valor_venta / l.area_m2)}</td></tr>
      ${v.n_cuotas ? `<tr><th>Primera cuota</th><td>${fecha(v.fecha_primera_cuota)}</td><th>Última cuota</th><td>${fecha(v.fecha_fin)}</td></tr>` : ""}`}
      ${v.numero_escritura ? `<tr><th>Escritura</th><td>N° ${esc(v.numero_escritura)} del ${fecha(v.fecha_escritura)}</td><th>Notaría</th><td>${esc(v.notaria || "")}</td></tr>` : ""}
    </table>

    <h2><span>5</span>Estado de cuenta al ${fecha(corte)}</h2>
    <div class="kpis">
      <div><small>Total pagado</small><b>${pesos(v.pagado)}</b></div>
      <div><small>Saldo pendiente</small><b>${pesos(v.saldo)}</b></div>
      <div class="${v.vencido ? "malo" : ""}"><small>Valor vencido</small><b>${pesos(v.vencido)}</b></div>
      <div class="${v.dias_mora ? "malo" : ""}"><small>Días de mora</small><b>${v.dias_mora || 0}</b></div>
    </div>
    <div class="avance"><div class="av-txt"><span>Avance de pago</span><b>${fmtN1.format(v.pct_pagado)} %</b></div>
      <div class="av-barra"><i style="width:${Math.min(v.pct_pagado, 100)}%"></i></div>
      <div class="av-pie">${v.n_cuotas ? `Cuotas pagadas: <b>${v.cuotas_pagadas} de ${v.cuotas_total}</b> · ` : ""}${v.cuotas_vencidas ? `Cuotas vencidas: <b class="rojo">${v.cuotas_vencidas}</b> · ` : ""}${v.proxima_cuota ? `Próxima cuota: <b>${pesos(v.proxima_cuota.pendiente)}</b> el <b>${fecha(v.proxima_cuota.fecha)}</b>` : v.saldo <= 0.5 ? "<b>Negocio pagado en su totalidad</b>" : ""}</div></div>
    ${v.interes_mora > 0 ? `<div class="aviso-doc">Intereses de mora estimados a la fecha de corte: <b>${pesos(v.interes_mora)}</b> (tasa ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(num2(c.tasa_mora_efectiva ?? c.tasa_mora_mensual))} % mensual sobre las cuotas vencidas). Valor informativo, no incluido en el saldo.</div>` : ""}
    ${v.vencido > 0 ? `<div class="aviso-doc malo">Para ponerse al día debe cancelar <b>${pesos(v.vencido)}</b>${v.interes_mora > 0 ? " más los intereses de mora" : ""}. Si ya realizó el pago, por favor envíe el comprobante para registrarlo.</div>` : ""}

    ${v.plan.length ? `<h2><span>6</span>Plan de pagos</h2>
    <table class="lista plan"><thead><tr><th>Cuota</th><th>Vencimiento</th><th class="d">Valor</th><th class="d">Pagado</th><th class="d">Pendiente</th><th>Estado</th></tr></thead><tbody>
      ${v.plan.map((q) => `<tr class="${q.estado.startsWith("VENCIDA") ? "venc" : q.estado === "PAGADA" ? "pag" : ""}"><td>${q.n === 0 ? "Inicial" : q.n}</td><td>${fecha(q.fecha)}</td><td class="d">${pesos(q.valor)}</td>
        <td class="d">${q.pagado ? pesos(q.pagado) : "—"}</td><td class="d">${q.pendiente > 0.5 ? pesos(q.pendiente) : "—"}</td><td><span class="ec ${q.estado}">${NOM_CUOTA[q.estado]}</span></td></tr>`).join("")}
      <tr class="tot"><td colspan="2">Total</td><td class="d">${pesos(v.valor_venta)}</td><td class="d">${pesos(v.pagado)}</td><td class="d">${pesos(v.saldo)}</td><td></td></tr></tbody></table>` : ""}

    <h2><span>${v.plan.length ? 7 : 6}</span>Pagos recibidos</h2>
    ${v.pagos.filter((x) => !x.anulado).length ? `<table class="lista"><thead><tr><th>Recibo</th><th>Fecha</th><th>Concepto</th><th>Medio</th><th>Referencia</th><th class="d">Valor</th></tr></thead><tbody>
      ${v.pagos.filter((x) => !x.anulado).map((x) => `<tr><td>N° ${String(x.recibo).padStart(6, "0")}</td><td>${fecha(x.fecha)}</td><td>${esc(x.concepto)}</td><td>${esc(x.medio)}</td><td>${esc(x.referencia || "")}</td><td class="d">${pesos(x.valor)}</td></tr>`).join("")}
      <tr class="tot"><td colspan="5">Total pagado</td><td class="d">${pesos(v.pagado)}</td></tr></tbody></table>` : `<p class="nota">No se han registrado pagos.</p>`}`;
  }

  h += `<div class="notas"><h3>Notas</h3><ul>
      <li>Las medidas, el área y los linderos provienen del plano de loteo del proyecto; los definitivos serán los consignados en la escritura pública.</li>
      ${v ? `<li>Los pagos se aplican primero a la cuota inicial y luego a las cuotas, en orden de vencimiento. Este documento refleja los pagos registrados hasta la fecha de corte; cualquier diferencia debe soportarse con el recibo de caja correspondiente.</li>` : `<li>El precio de lista está sujeto a cambios sin previo aviso y a la disponibilidad del lote al momento de la separación.</li>`}
      ${c.cuenta_bancaria ? `<li>Pagos por consignación o transferencia: <b>${esc(c.cuenta_bancaria)}</b>. Envíe el comprobante para registrar su pago.</li>` : ""}
    </ul>
    <div class="contacto">${esc(c.vendedor_razon_social || c.proyecto)}${c.vendedor_telefono ? ` · Tel. ${esc(c.vendedor_telefono)}` : ""}${c.vendedor_email ? ` · ${esc(c.vendedor_email)}` : ""}${c.vendedor_direccion ? ` · ${esc(c.vendedor_direccion)}` : ""}</div></div>
  </div>`;
  return h;
}

const CSS_HOJA = `
  @page { size: letter; margin: 15mm 14mm 17mm;
    @bottom-left { content: "${"HOJA_PIE"}"; font: 8px Cabin, Arial; color: #82959A; }
    @bottom-right { content: "Página " counter(page) " de " counter(pages); font: 8px Cabin, Arial; color: #82959A; } }
  .hv { font-size: 10.5px; }
  .hv .chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 9px; font-size: 9.5px; font-weight: 700; margin-right: 4px; }
  .hv .chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .chip.DISPONIBLE { background: #DDFBEE; color: #0E8A5B; } .chip.SEPARADO { background: #FEF2D7; color: #A86A00; }
  .chip.VENDIDO { background: #DFEAFE; color: #1D4FC4; } .chip.PAGADO { background: #EDE5FE; color: #6B36D9; }
  .chip.ESCRITURADO { background: #DCE3F5; color: #1E3A8A; } .chip.BLOQUEADO { background: #E9EEF2; color: #55656F; }
  .chip.AL_DIA { background: #DCFCE7; color: #15803D; } .chip.MORA_30 { background: #FEF9C3; color: #A16207; }
  .chip.MORA_90 { background: #FFEDD5; color: #C2410C; } .chip.MORA_MAS_90 { background: #FEE2E2; color: #B91C1C; }
  .chip.SEPARACION_VENCIDA { background: #FFEDD5; color: #9A3412; }
  .banda { display: flex; justify-content: space-between; align-items: center; gap: 16px; background: #0C2E37; color: #fff; border-radius: 10px; padding: 14px 18px; margin-bottom: 14px; }
  .b-tit { font: 600 19px Lexend, Arial; }
  .b-sub { color: #A9C2C8; font-size: 10.5px; margin: 2px 0 7px; }
  .b-cifras { display: flex; gap: 18px; }
  .b-cifras small { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .5px; color: #A9C2C8; }
  .b-cifras b { font: 600 13px Lexend, Arial; color: #5CE9AB; white-space: nowrap; }
  h2 { display: flex; align-items: center; gap: 8px; font: 600 12.5px Lexend, Arial; color: #0C2E37; margin: 16px 0 8px; padding-bottom: 5px; border-bottom: 1.5px solid #DCE5E7; text-transform: none; letter-spacing: 0; }
  h2 span { width: 20px; height: 20px; border-radius: 50%; background: #5CE9AB; color: #0C2E37; display: grid; place-items: center; font-size: 10.5px; }
  .dos { display: grid; grid-template-columns: 1fr 1.15fr; gap: 14px; align-items: start; }
  .dos.d2 { grid-template-columns: 1.1fr 1fr; }
  figure.general { margin-top: 10px; }
  .bloque { break-inside: avoid; }
  h2 { break-after: avoid; }
  h2.sub em { font: 600 8px Lexend, Arial; font-style: normal; text-transform: uppercase; letter-spacing: .04em; background: #E6FCF2; color: #0C2E37; border-radius: 4px; padding: 2px 6px; }
  .nota-geo p { font-size: 9px; line-height: 1.4; margin: 0 0 6px; color: #4D6369; } .nota-geo p.peq { font-size: 8.5px; color: #82959A; }
  figure.general figcaption b { color: #0C2E37; }
  figure { margin: 0; border: 1px solid #DCE5E7; border-radius: 8px; overflow: hidden; break-inside: avoid; }
  figcaption { font-size: 9px; color: #82959A; padding: 5px 9px; border-top: 1px solid #DCE5E7; background: #fff; }
  table.ficha th { text-align: left; font: 400 10px Cabin, Arial; color: #4D6369; text-transform: none; letter-spacing: 0; padding: 5px 8px 5px 0; border-bottom: 1px dashed #E3EAEC; width: 42%; vertical-align: top; }
  table.ficha td { padding: 5px 0; border-bottom: 1px dashed #E3EAEC; font-weight: 700; vertical-align: top; }
  table.ficha td small { font-weight: 400; color: #82959A; }
  table.ficha.ancha th { width: 26%; }
  table.ficha.cols th { width: 19%; } table.ficha.cols td { width: 31%; padding-right: 10px; }
  table.lista th { font-size: 8.5px; padding: 5px 6px; }
  table.lista td { font-size: 10px; padding: 3.2px 6px; }
  table.plan tr.venc td { background: #FEF2F2; } table.plan tr.pag td { color: #4D6369; }
  .ec { font-size: 9px; font-weight: 700; } .ec.PAGADA { color: #15803D; } .ec.VENCIDA, .ec.VENCIDA_PARCIAL { color: #DC2626; } .ec.PARCIAL { color: #D97706; } .ec.PENDIENTE { color: #82959A; }
  .ok { color: #15803D; font-size: 9.5px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .kpis div { background: #F2F5F5; border-radius: 7px; padding: 9px 11px; border-left: 3px solid #5CE9AB; }
  .kpis div.malo { border-left-color: #DC2626; background: #FEF2F2; }
  .kpis small { display: block; font-size: 8.5px; text-transform: uppercase; color: #82959A; letter-spacing: .4px; }
  .kpis b { font: 600 14px Lexend, Arial; }
  .kpis .malo b { color: #DC2626; }
  .avance { margin: 10px 0 4px; }
  .av-txt { display: flex; justify-content: space-between; font-size: 10px; color: #4D6369; }
  .av-txt b { font: 600 12px Lexend, Arial; color: #0C2E37; }
  .av-barra { height: 8px; background: #E2EAEC; border-radius: 4px; overflow: hidden; margin: 4px 0 5px; }
  .av-barra i { display: block; height: 100%; background: linear-gradient(90deg, #17A974, #5CE9AB); }
  .av-pie { font-size: 9.5px; color: #4D6369; }
  .aviso-doc { margin-top: 8px; padding: 8px 11px; border-radius: 7px; background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; font-size: 9.5px; }
  .aviso-doc.malo { background: #FEF2F2; border-color: #FECACA; color: #991B1B; }
  .salto { break-before: page; }
  .notas { margin-top: 16px; border-top: 1.5px solid #DCE5E7; padding-top: 4px; break-inside: avoid; }
  .notas h3 { margin: 6px 0 4px; font-size: 10px; }
  .notas ul { margin: 0; padding-left: 15px; color: #4D6369; font-size: 9px; line-height: 1.5; }
  .contacto { margin-top: 12px; text-align: center; font-size: 9px; color: #0C2E37; background: #F2F5F5; border-radius: 6px; padding: 7px; }
  .nota { color: #82959A; }
  tr { break-inside: avoid; }
  table.lista td.d, table.lista th.d, table.lista td:first-child { white-space: nowrap; }`;

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
  const mora = num2(c.tasa_mora_efectiva ?? c.tasa_mora_mensual);
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



export function imprimirHoja(d) {
  const pie = `${E.config.proyecto} · ${d.lote.id_lote} · Corte ${fecha(hoyISO())}`.replace(/"/g, "'")
  imprimir(`Ficha integral ${d.lote.id_lote}`, hojaDeVidaHTML(d), CSS_HOJA.replace('HOJA_PIE', pie))
}
export function imprimirInformeComisionista(d) {
  const pie = `${E.config.proyecto} · Comisiones · ${d.comisionista.nombre} · Corte ${fecha(hoyISO())}`.replace(/"/g, "'")
  imprimir(`Comisiones ${d.comisionista.nombre}`, htmlInformeComisionista(d), CSS_HOJA.replace('HOJA_PIE', pie))
}
// doc: promesa | pazysalvo | certificado | cotizacion; d: respuesta de /api/documento
export function imprimirDocumento(doc, d) {
  const pie = `${E.config.proyecto} · ${NOMBRE_DOC[doc]} · ${fecha(hoyISO())}`.replace(/"/g, "'")
  const html = { promesa: htmlPromesa, pazysalvo: htmlPazYSalvo, certificado: htmlCertificado, cotizacion: htmlCotizacion }[doc](d)
  imprimir(NOMBRE_DOC[doc], html, CSS_HOJA.replace('HOJA_PIE', pie) + CSS_DOCS)
}
