/* eslint-disable @typescript-eslint/no-explicit-any */
import { api, aviso, falla } from './api'
import { fecha, fechaLarga, fmtN1, m2, pesos } from './formato'
import { numeroALetras } from './letras'
import { hoyISO } from './ui'

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
export const PIE_SISTEMA = '<span class="sis">Sistema de ventas y cartera</span>'
export const nombreLote = (id: string) => { const m = id.match(/^MZ(\d+)-L(\d+)$/); return m ? `Manzana ${+m[1]} · Lote ${+m[2]}` : id }
export const cuotaDe = (v: any) => v.plan.find((x: any) => x.n === 1)?.valor ?? 0

export const CSS_IMPRESION = `
  @font-face { font-family: Lexend; src: url(${location.origin}/fonts/Lexend.ttf); }
  @font-face { font-family: Cabin; src: url(${location.origin}/fonts/Cabin.ttf); }
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
  .copia span { position: absolute; top: -8px; left: 50%; transform: translateX(-50%); background: #fff; padding: 0 10px; font-size: 9px; color: #82959A; letter-spacing: 1px; }`

// El documento se arma en un iframe oculto de esta misma ventana y se ofrece imprimirlo o descargarlo en PDF.
export function imprimir(titulo: string, cuerpo: string, cssExtra = '') {
  document.getElementById('marcoImpresion')?.remove()
  document.getElementById('dialogoImpresion')?.remove()
  const f = Object.assign(document.createElement('iframe'), { id: 'marcoImpresion', title: titulo })
  f.style.cssText = 'position:fixed;left:-10000px;top:0;width:816px;height:1056px;border:0' // fuera de pantalla pero con ancho real para el PDF
  document.body.appendChild(f)
  const doc = f.contentDocument!
  doc.open()
  doc.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS_IMPRESION}${cssExtra}</style></head><body>${cuerpo}</body></html>`)
  doc.close()
  const imgs = [...doc.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r })))
  const listo = Promise.all([doc.fonts.ready, ...imgs]).then(() => new Promise((r) => setTimeout(r, 150)))

  const d = document.createElement('div')
  d.id = 'dialogoImpresion'
  d.style.cssText = 'position:fixed;inset:0;background:rgba(12,46,55,.45);display:flex;align-items:center;justify-content:center;z-index:100'
  d.innerHTML = `<div style="background:#fff;border-radius:12px;padding:20px 24px;min-width:300px;box-shadow:0 10px 40px rgba(0,0,0,.3);font-family:Cabin,Arial,sans-serif">
    <div style="font-weight:600;color:#0C2E37;margin-bottom:14px">${esc(titulo)}</div>
    <div style="display:flex;gap:10px"><button class="btn pri" data-a="imp">Imprimir</button><button class="btn pri" data-a="pdf">Descargar PDF</button><button class="btn" data-a="x">Cerrar</button></div></div>`
  document.body.appendChild(d)
  const cerrar = () => { d.remove(); f.remove() }
  d.onclick = async (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset.a
    if (e.target === d || a === 'x') return cerrar()
    if (!a) return
    await listo
    if (a === 'imp') { f.contentWindow!.focus(); f.contentWindow!.print(); return }
    aviso('Generando PDF…')
    try {
      // Se dibuja el cuerpo del iframe (con su propio CSS) y se corta en páginas carta con márgenes de 16/15 mm.
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
      const cv = await html2canvas(doc.body, { scale: 2, backgroundColor: '#fff', windowWidth: 816 })
      const pdf = new jsPDF({ unit: 'mm', format: 'letter' })
      const ancho = 215.9 - 30, alto = 279.4 - 32, pxPag = Math.floor((alto * cv.width) / ancho)
      for (let y = 0, i = 0; y < cv.height; y += pxPag, i++) {
        const h = Math.min(pxPag, cv.height - y), parte = Object.assign(document.createElement('canvas'), { width: cv.width, height: h })
        parte.getContext('2d')!.drawImage(cv, 0, y, cv.width, h, 0, 0, cv.width, h)
        if (i) pdf.addPage()
        pdf.addImage(parte.toDataURL('image/jpeg', 0.95), 'JPEG', 15, 16, ancho, (h * ancho) / cv.width)
      }
      pdf.save(titulo.replace(/[\/:*?"<>|]+/g, '-') + '.pdf')
      cerrar()
    } catch (err) { falla(err) }
  }
}

// Encabezado de los documentos: los emite la empresa vendedora (marca/logo_documentos.png si existe).
export function cabecera(c: any, titulo: string, numero: string, fechaDoc: string) {
  const nombre = c.vendedor_razon_social || c.proyecto
  const datos = [c.vendedor_nit ? `NIT ${esc(c.vendedor_nit)}` : '', esc(c.vendedor_direccion || ''), c.vendedor_telefono ? `Tel. ${esc(c.vendedor_telefono)}` : ''].filter(Boolean).join(' · ')
  return `<div class="cab"><div class="cab-izq"><img class="logo-v" src="${location.origin}/marca/logo_documentos.png" onerror="this.remove()">
      <div><div class="vend">${esc(nombre)}</div>
      <div class="emp">${datos ? datos + '<br>' : ''}Proyecto <b>${esc(c.proyecto)}</b>${c.ciudad ? ' · ' + esc(c.ciudad) : ''}</div></div></div>
    <div class="doc"><h1>${titulo}</h1>${numero ? `<div class="n">${numero}</div>` : ''}<div class="f">${fechaDoc}</div></div></div>`
}

export async function imprimirRecibo(n: number, c: any) {
  let r: any
  try { r = await api('/api/recibo?n=' + n) } catch (e) { falla(e); return }
  const p = r.pago, v = r.detalle.ventas.find((x: any) => x.id === p.venta_id)
  const pagadoHasta = v.pagos.filter((x: any) => !x.anulado && x.recibo <= p.recibo).reduce((s: number, x: any) => s + x.valor, 0)
  const saldo = v.valor_venta ? Math.max(v.valor_venta - pagadoHasta, 0) : null
  const num = `N° ${String(p.recibo).padStart(6, '0')}`
  const uno = (copia: string) => `${cabecera(c, 'RECIBO DE CAJA', num, `Fecha: ${fechaLarga(p.fecha)}`)}
    <div class="caja">
      <div class="fila"><span>Recibimos de</span><b>${esc(p.cliente)}</b></div>
      <div class="fila"><span>Documento</span><b>${esc(p.tipo_doc)} ${esc(p.documento || '—')}</b></div>
      <div class="fila"><span>Por concepto de</span><b>${esc(p.concepto)} — ${nombreLote(p.id_lote)} (${p.id_lote})</b></div>
      <div class="fila"><span>Medio de pago</span><b>${esc(p.medio)}${p.referencia ? ' · Ref. ' + esc(p.referencia) : ''}</b></div>
      ${p.observacion ? `<div class="fila"><span>Observación</span><b style="font-weight:400">${esc(p.observacion)}</b></div>` : ''}
    </div>
    <div class="valor"><span>VALOR RECIBIDO</span><span class="num">${pesos(p.valor)}</span></div>
    <div class="letras">Son: ${numeroALetras(p.valor)}</div>
    ${v.valor_venta ? `<div class="resumen"><div><small>Valor del negocio</small><b>${pesos(v.valor_venta)}</b></div>
      <div><small>Total abonado</small><b>${pesos(pagadoHasta)}</b></div><div><small>Saldo pendiente</small><b>${pesos(saldo)}</b></div>
      <div><small>Avance</small><b>${fmtN1.format((100 * pagadoHasta) / v.valor_venta)} %</b></div></div>` : ''}
    <div class="firmas"><div>Recibido por${p.usuario ? `: ${esc(p.usuario)}` : ''}</div><div>Firma del comprador</div></div>
    <div class="pie">${copia} · Generado el ${fecha(hoyISO())} · ${PIE_SISTEMA}</div>`
  imprimir(`Recibo ${num}`, `<div class="recibo">${p.anulado ? '<div class="anulado">ANULADO</div>' : ''}${uno('Original — comprador')}
    <div class="copia"><span>CORTE AQUÍ</span></div>${uno('Copia — archivo')}</div>`)
}

const pct = (v?: number) => `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v || 0)} %`

export async function imprimirComprobante(n: number, c: any) {
  let r: any
  try { r = await api('/api/comprobante?n=' + n) } catch (e) { falla(e); return }
  const p = r.pago, cm = r.comisionista, num = `CE ${String(p.comprobante).padStart(6, '0')}`
  imprimir(`Comprobante de egreso ${num}`, `<div class="recibo">${p.anulado ? '<div class="anulado">ANULADO</div>' : ''}
    ${cabecera(c, 'COMPROBANTE DE EGRESO', num, `Fecha: ${fechaLarga(p.fecha)}`)}
    <div class="caja">
      <div class="fila"><span>Pagado a</span><b>${esc(cm.nombre)}</b></div>
      <div class="fila"><span>Documento</span><b>${esc(cm.tipo_doc)} ${esc(cm.documento || '—')}</b></div>
      <div class="fila"><span>Concepto</span><b>Pago de comisiones por venta de lotes · ${esc(c.proyecto)}</b></div>
      <div class="fila"><span>Medio de pago</span><b>${esc(p.medio)}${p.referencia ? ' · Ref. ' + esc(p.referencia) : ''}</b></div>
      ${cm.banco ? `<div class="fila"><span>Cuenta del beneficiario</span><b>${esc(cm.banco)} ${esc(cm.tipo_cuenta || '')} ${esc(cm.numero_cuenta || '')}</b></div>` : ''}
      ${p.observacion ? `<div class="fila"><span>Observación</span><b style="font-weight:400">${esc(p.observacion)}</b></div>` : ''}
    </div>
    <table><thead><tr><th>Lote</th><th>Comprador</th><th class="d">Valor venta</th><th class="d">%</th><th class="d">Valor pagado</th></tr></thead><tbody>
      ${r.detalle.map((x: any) => `<tr><td>${x.id_lote}</td><td>${esc(x.cliente)}</td><td class="d">${pesos(x.valor_venta)}</td><td class="d">${pct(x.porcentaje)}</td><td class="d">${pesos(x.valor)}</td></tr>`).join('')}
      <tr class="tot"><td colspan="4">Valor bruto</td><td class="d">${pesos(p.valor_bruto)}</td></tr>
      <tr><td colspan="4">Retención en la fuente (${pct(p.retencion_pct)})</td><td class="d">− ${pesos(p.retencion)}</td></tr>
    </tbody></table>
    <div class="valor" style="margin-top:12px"><span>NETO PAGADO</span><span class="num">${pesos(p.valor_neto)}</span></div>
    <div class="letras">Son: ${numeroALetras(p.valor_neto)}</div>
    <div class="firmas" style="margin-top:56px"><div>Elaboró${p.usuario ? `: ${esc(p.usuario)}` : ''}</div><div>Aprobó</div>
      <div>Recibí conforme: ${esc(cm.nombre)}<br>${esc(cm.tipo_doc)} ${esc(cm.documento || '')}</div></div>
    <div class="pie">Generado el ${fecha(hoyISO())}</div></div>`)
}

export async function imprimirEgreso(n: number, c: any) {
  let r: any
  try { r = await api('/api/egreso?n=' + n) } catch (e) { falla(e); return }
  if (r.tipo === 'comision') return imprimirComprobante(n, c)
  const g = r.gasto, num = `CE ${String(g.comprobante).padStart(6, '0')}`
  imprimir(`Comprobante de egreso ${num}`, `<div class="recibo">${g.anulado ? '<div class="anulado">ANULADO</div>' : ''}
    ${cabecera(c, 'COMPROBANTE DE EGRESO', num, `Fecha: ${fechaLarga(g.fecha)}`)}
    <div class="caja">
      <div class="fila"><span>Pagado a</span><b>${esc(g.proveedor)}</b></div>
      <div class="fila"><span>NIT / documento</span><b>${esc(g.documento_proveedor || '—')}</b></div>
      <div class="fila"><span>Concepto</span><b>${esc(g.descripcion)}</b></div>
      <div class="fila"><span>Categoría</span><b>${esc(g.categoria)}</b></div>
      ${g.factura ? `<div class="fila"><span>Factura / cuenta de cobro</span><b>${esc(g.factura)}</b></div>` : ''}
      <div class="fila"><span>Medio de pago</span><b>${esc(g.medio)}${g.referencia ? ' · Ref. ' + esc(g.referencia) : ''}</b></div></div>
    <table><tbody><tr class="tot"><td>Valor bruto</td><td class="d">${pesos(g.valor_bruto)}</td></tr>
      <tr><td>Retención practicada</td><td class="d">− ${pesos(g.retencion)}</td></tr></tbody></table>
    <div class="valor" style="margin-top:12px"><span>NETO PAGADO</span><span class="num">${pesos(g.valor_neto)}</span></div>
    <div class="letras">Son: ${numeroALetras(g.valor_neto)}</div>
    <div class="firmas" style="margin-top:56px"><div>Elaboró${g.usuario ? `: ${esc(g.usuario)}` : ''}</div><div>Aprobó</div><div>Recibí conforme</div></div>
    <div class="pie">Generado el ${fecha(hoyISO())}</div></div>`)
}

const NOM_CUOTA: Record<string, string> = { PAGADA: 'Pagada', VENCIDA: 'Vencida', VENCIDA_PARCIAL: 'Vencida (parcial)', PARCIAL: 'Abono parcial', PENDIENTE: 'Pendiente' }

export function imprimirEstadoCuenta(d: any, c: any) {
  const v = d.ventas.find((x: any) => x.estado === 'ACTIVA'), l = d.lote
  imprimir(`Estado de cuenta ${l.id_lote}`, `${cabecera(c, 'ESTADO DE CUENTA', l.id_lote, `Fecha de corte: ${fechaLarga(hoyISO())}`)}
    <div class="caja">
      <div class="fila"><span>Comprador</span><b>${esc(v.nombre)} · ${esc(v.tipo_doc)} ${esc(v.documento || '')}</b></div>
      <div class="fila"><span>Inmueble</span><b>${nombreLote(l.id_lote)} · ${m2(l.area_m2)}</b></div>
      <div class="fila"><span>Fecha de venta</span><b>${fecha(v.fecha_venta)}</b></div>
      <div class="fila"><span>Condiciones</span><b>${pesos(v.valor_venta)} · inicial ${pesos(v.cuota_inicial)} · ${v.n_cuotas ? `${v.n_cuotas} cuotas de ${pesos(cuotaDe(v))}` : 'contado'}</b></div>
    </div>
    <div class="resumen"><div><small>Total pagado</small><b>${pesos(v.pagado)}</b></div><div><small>Saldo</small><b>${pesos(v.saldo)}</b></div>
      <div><small>Valor vencido</small><b class="${v.vencido ? 'rojo' : ''}">${pesos(v.vencido)}</b></div><div><small>Días de mora</small><b class="${v.dias_mora ? 'rojo' : ''}">${v.dias_mora || 0}</b></div></div>
    <h3>Plan de pagos</h3>
    <table><thead><tr><th>Cuota</th><th>Vencimiento</th><th class="d">Valor</th><th class="d">Pagado</th><th class="d">Pendiente</th><th>Estado</th></tr></thead><tbody>
      ${v.plan.map((q: any) => `<tr><td>${q.n === 0 ? 'Inicial' : q.n}</td><td>${fecha(q.fecha)}</td><td class="d">${pesos(q.valor)}</td><td class="d">${pesos(q.pagado)}</td>
        <td class="d">${q.pendiente > 0.5 ? pesos(q.pendiente) : '—'}</td><td class="${q.estado.startsWith('VENCIDA') ? 'rojo' : ''}">${NOM_CUOTA[q.estado]}</td></tr>`).join('')}
      <tr class="tot"><td colspan="2">Total</td><td class="d">${pesos(v.valor_venta)}</td><td class="d">${pesos(v.pagado)}</td><td class="d">${pesos(v.saldo)}</td><td></td></tr></tbody></table>
    <h3>Pagos recibidos</h3>
    <table><thead><tr><th>Recibo</th><th>Fecha</th><th>Concepto</th><th>Medio</th><th class="d">Valor</th></tr></thead><tbody>
      ${v.pagos.filter((p: any) => !p.anulado).map((p: any) => `<tr><td>N° ${String(p.recibo).padStart(6, '0')}</td><td>${fecha(p.fecha)}</td><td>${esc(p.concepto)}</td><td>${esc(p.medio)}</td><td class="d">${pesos(p.valor)}</td></tr>`).join('') || '<tr><td colspan="5">Sin pagos.</td></tr>'}
    </tbody></table>
    <div class="pie">Este estado de cuenta refleja los pagos registrados hasta la fecha de corte. Cualquier diferencia debe soportarse con el recibo de caja correspondiente.<br>${PIE_SISTEMA}</div>`)
}

export function imprimirInforme(r: any, lotes: any[], c: any) {
  const k = r.conteo
  const vendidos = (k.VENDIDO || 0) + (k.PAGADO || 0) + (k.ESCRITURADO || 0)
  const mora = lotes.filter((l) => ['MORA_30', 'MORA_90', 'MORA_MAS_90'].includes(l.cartera)).sort((a, b) => b.dias_mora - a.dias_mora)
  imprimir('Informe de ventas y cartera', `${cabecera(c, 'INFORME DE VENTAS Y CARTERA', '', `Corte: ${fechaLarga(r.fecha)}`)}
    <div class="resumen"><div><small>Lotes vendidos</small><b>${vendidos} de ${r.total_lotes}</b></div><div><small>Separados</small><b>${k.SEPARADO || 0}</b></div>
      <div><small>Disponibles</small><b>${k.DISPONIBLE || 0}</b></div><div><small>Bloqueados</small><b>${k.BLOQUEADO || 0}</b></div>
      <div><small>Valor vendido</small><b>${pesos(r.valor_vendido)}</b></div><div><small>Recaudado</small><b>${pesos(r.recaudado)}</b></div>
      <div><small>Cartera por cobrar</small><b>${pesos(r.cartera)}</b></div><div><small>Cartera vencida</small><b class="rojo">${pesos(r.vencido)}</b></div></div>
    <h3>Resumen por manzana</h3>
    <table><thead><tr><th>Manzana</th><th class="d">Lotes</th><th class="d">Disp.</th><th class="d">Sep.</th><th class="d">Vend.</th><th class="d">Valor vendido</th><th class="d">Recaudado</th><th class="d">Saldo</th><th class="d">Mora</th></tr></thead><tbody>
      ${r.manzanas.map((m: any) => `<tr><td>MZ ${String(m.manzana).padStart(2, '0')}</td><td class="d">${m.lotes}</td><td class="d">${m.disponibles}</td><td class="d">${m.separados}</td><td class="d">${m.vendidos}</td>
        <td class="d">${pesos(m.valor_venta)}</td><td class="d">${pesos(m.pagado)}</td><td class="d">${pesos(m.saldo)}</td><td class="d">${m.en_mora}</td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td class="d">${r.total_lotes}</td><td class="d">${k.DISPONIBLE || 0}</td><td class="d">${k.SEPARADO || 0}</td><td class="d">${vendidos}</td>
        <td class="d">${pesos(r.valor_vendido)}</td><td class="d">${pesos(r.recaudado)}</td><td class="d">${pesos(r.cartera)}</td><td class="d">${r.lotes_mora}</td></tr></tbody></table>
    <h3>Lotes en mora</h3>
    <table><thead><tr><th>Lote</th><th>Comprador</th><th>Teléfono</th><th class="d">Días</th><th class="d">Vencido</th><th class="d">Saldo</th></tr></thead><tbody>
      ${mora.map((l) => `<tr><td>${l.id_lote}</td><td>${esc(l.cliente)}</td><td>${esc(l.telefono || '')}</td><td class="d rojo">${l.dias_mora}</td><td class="d">${pesos(l.vencido)}</td><td class="d">${pesos(l.saldo)}</td></tr>`).join('') || '<tr><td colspan="6">No hay lotes en mora.</td></tr>'}
    </tbody></table>
    <div class="pie">Informe generado el ${fechaLarga(hoyISO())} · ${PIE_SISTEMA}</div>`)
}
