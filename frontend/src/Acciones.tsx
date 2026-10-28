/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { api, Pendiente } from './api'
import { fecha, fmtN, fmtN1, m2, pesos, pesosCorto } from './formato'
import { imprimirRecibo, nombreLote } from './imprimir'
import { MEDIOS } from './Gastos'
import { REGLAS_COM } from './Comisionistas'
import { DineroC } from './Nuevas'
import { Campo, Dinero, hoyISO, Modal, Sel, sumarDias, sumarMeses, useApi, type Datos } from './ui'

const TIPOS_DOC = ['CC', 'CE', 'NIT', 'PP', 'TI', 'PPT']
const CONCEPTOS = ['Cuota', 'Cuota inicial', 'Abono a capital', 'Separación', 'Pago total']
const num = (e: React.FormEvent) => Number((e.target as HTMLInputElement).value.replace(/\D/g, '')) || 0

type Base = { d: Datos; cerrar: () => void; listo: (msg: string) => Promise<void> | void; config: Datos }

// ------------------------------------------------------------------ comprador (con búsqueda de existentes)
export function CamposCliente({ c = {}, docReq }: { c?: Datos; docReq?: boolean }) {
  const [sug, setSug] = useState<Datos[]>([]), [nombre, setNombre] = useState(c.nombre || '')
  const [id, setId] = useState(c.cliente_id || '')
  const f = useRef<HTMLDivElement>(null), t = useRef<number>(0)
  const [vals, setVals] = useState<Datos>({ tipo_doc: c.tipo_doc || 'CC', documento: c.documento || '', telefono: c.telefono || '', email: c.email || '', direccion: c.direccion || '' })
  const buscar = (q: string) => {
    setNombre(q); setId(''); clearTimeout(t.current)
    if (q.trim().length < 2) return setSug([])
    t.current = window.setTimeout(() => api<Datos[]>('/api/clientes?q=' + encodeURIComponent(q.trim())).then(setSug).catch(() => {}), 200)
  }
  const pon = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setVals({ ...vals, [k]: e.target.value })
  return (
    <>
      <div className="form-sec">Comprador</div>
      <input type="hidden" name="cliente_id" value={id} />
      <Campo etq="Nombre completo" req cls="c2">
        <div className="clientes-sug" ref={f}>
          <input type="text" name="c_nombre" required value={nombre} onChange={(e) => buscar(e.target.value)} onBlur={() => setTimeout(() => setSug([]), 150)}
            placeholder="Escriba para buscar compradores existentes" />
          <div className={`sugerencias ${sug.length ? 'visible' : ''}`}>
            {sug.map((s) => (
              <div className="sug" key={s.id} onMouseDown={() => {
                setId(s.id); setNombre(s.nombre); setSug([])
                setVals({ tipo_doc: s.tipo_doc, documento: s.documento || '', telefono: s.telefono || '', email: s.email || '', direccion: s.direccion || '' })
              }}><span className="sug-txt" style={{ color: 'var(--txt)' }}><b>{s.nombre}</b></span><span className="sug-txt">{s.tipo_doc} {s.documento}</span></div>))}
          </div>
        </div>
      </Campo>
      <Campo etq="Tipo de documento"><select name="c_tipo_doc" value={vals.tipo_doc} onChange={pon('tipo_doc')}>{TIPOS_DOC.map((o) => <option key={o}>{o}</option>)}</select></Campo>
      <Campo etq="N° de documento" req={docReq}><input type="text" name="c_documento" value={vals.documento} onChange={pon('documento')} inputMode="numeric" required={docReq} /></Campo>
      <Campo etq="Teléfono"><input type="tel" name="c_telefono" value={vals.telefono} onChange={pon('telefono')} /></Campo>
      <Campo etq="Correo electrónico"><input type="email" name="c_email" value={vals.email} onChange={pon('email')} /></Campo>
      <Campo etq="Dirección" cls="c2"><input type="text" name="c_direccion" value={vals.direccion} onChange={pon('direccion')} /></Campo>
    </>
  )
}
export const clienteDe = (d: Datos) => ({ id: d.cliente_id || null, nombre: d.c_nombre, tipo_doc: d.c_tipo_doc, documento: d.c_documento, telefono: d.c_telefono, email: d.c_email, direccion: d.c_direccion })

// ------------------------------------------------------------------ comisión dentro de venta / separación
export function CamposComision({ config }: { config: Datos }) {
  const { d } = useApi<Datos>('/api/comisionistas')
  const [pct, setPct] = useState(''), [regla, setRegla] = useState('RECAUDO')
  const activos = (d?.comisionistas ?? []).filter((c: Datos) => c.estado === 'ACTIVO')
  if (!activos.length) return <><div className="form-sec">Comisión</div><div className="c2 ley-ayuda" style={{ padding: 0 }}>No hay comisionistas activos. Regístrelos en la pestaña «Comisionistas».</div></>
  return (
    <>
      <div className="form-sec">Comisión (opcional)</div>
      <Campo etq="Comisionista"><select name="comisionista_id" onChange={(e) => {
        const c = activos.find((x: Datos) => String(x.id) === e.target.value)
        setPct(c ? String(c.porcentaje_defecto) : ''); if (c) setRegla(c.regla_causacion)
      }}><option value="">Sin comisionista</option>{activos.map((c: Datos) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
      <Campo etq="Comisión (%)" ayuda={`Tope por venta: ${config.comision_max_pct || 10} %.`}><input type="number" name="comision_pct" min="0" max="30" step="0.01" placeholder="—" value={pct} onChange={(e) => setPct(e.target.value)} /></Campo>
      <Campo etq="Causación" cls="c2"><select name="comision_regla" value={regla} onChange={(e) => setRegla(e.target.value)}>{Object.entries(REGLAS_COM).map(([k, v]) => <option key={k} value={k}>{v.nom}</option>)}</select></Campo>
    </>
  )
}

// ------------------------------------------------------------------ recibo
export function Recibo({ n, nota, config, cerrar }: { n: number; nota?: string; config: Datos; cerrar: () => void }) {
  return (
    <Modal titulo="Pago registrado" cerrar={cerrar} pie={<button type="button" className="btn acento" onClick={() => { imprimirRecibo(n, config); cerrar() }}>Imprimir recibo</button>}>
      <div style={{ textAlign: 'center', padding: '10px 0' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#DCFCE7', color: '#15803D', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}><Check /></div>
        <div style={{ fontFamily: 'var(--f-tit)', fontSize: 18, fontWeight: 600, color: 'var(--teal)' }}>Recibo de caja N° {String(n).padStart(6, '0')}</div>
        <p className="texto-modal" style={{ marginTop: 6 }}>El pago quedó registrado en la cartera.{nota && <><br /><b>{nota}</b></>}</p></div>
    </Modal>
  )
}

// ------------------------------------------------------------------ separar
export function FormSeparar({ d, cerrar, listo, config, recibo }: Base & { recibo: (n: number) => void }) {
  const l = d.lote, hoy = hoyISO()
  const [fs, setFs] = useState(hoy)
  return (
    <Modal titulo={`Separar lote ${l.id_lote}`} ancho cerrar={cerrar} boton="Separar lote" alEnviar={async (x) => {
      const r = await api<Datos>('/api/venta/separar', { id_lote: l.id_lote, cliente: clienteDe(x), ...x })
      cerrar(); await listo(`Lote ${l.id_lote} separado${r.recibo ? ` · recibo N° ${r.recibo}` : ''}`); if (r.recibo) recibo(r.recibo)
    }}>
      <div className="form-grid">
        <CamposCliente />
        <div className="form-sec">Separación</div>
        <Campo etq="Fecha de separación" req><input type="date" name="fecha_separacion" value={fs} onChange={(e) => setFs(e.target.value)} required /></Campo>
        <Campo etq="Vigente hasta" ayuda="Después de esta fecha la separación aparece como vencida."><input type="date" name="fecha_limite_separacion" defaultValue={sumarDias(hoy, 15)} min={fs} /></Campo>
        <Campo etq="Valor pactado del lote" ayuda={l.precio_lista ? 'Por defecto, el precio de lista.' : ''}><Dinero name="valor_venta" def={l.precio_lista || 0} /></Campo>
        <Campo etq="Valor recibido por separación" ayuda="Genera un recibo de caja."><Dinero name="valor_separacion" /></Campo>
        <Campo etq="Medio de pago"><Sel name="medio" ops={MEDIOS} def="Efectivo" /></Campo>
        <Campo etq="Referencia / comprobante"><input type="text" name="referencia" /></Campo>
        <Campo etq="Asesor comercial"><input type="text" name="vendedor" /></Campo>
        <Campo etq="Observación"><input type="text" name="observacion" /></Campo>
        <CamposComision config={config} />
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ vender / editar negocio
export function FormVenta({ d, v, editar, cerrar, listo, config, prospecto }: Base & { v?: Datos; editar?: boolean; prospecto?: Datos }) {
  const l = d.lote, hoy = hoyISO()
  const conCom = !editar && !(v && (v.comisiones || []).some((x: Datos) => x.estado === 'ACTIVA'))
  const desdeSep = v && v.etapa === 'SEPARADO' && !editar
  const esSepEdit = editar && v?.etapa === 'SEPARADO'
  const c = v ? { cliente_id: v.cliente_id, nombre: v.nombre, tipo_doc: v.tipo_doc, documento: v.documento, telefono: v.telefono, email: v.email, direccion: v.direccion }
    : prospecto ? { nombre: prospecto.nombre, telefono: prospecto.telefono, email: prospecto.email, documento: prospecto.documento } : {}
  const [fv, setFv] = useState((editar && v?.fecha_venta) || hoy)
  const [val, setVal] = useState((v && v.valor_venta) || l.precio_lista || 0)
  const [ini, setIni] = useState((v && v.cuota_inicial) || 0)
  const [n, setN] = useState((v && v.n_cuotas) || 0)
  const [fp, setFp] = useState((v && v.fecha_primera_cuota) || sumarMeses(fv, 1))
  const fin = Math.max(val - ini, 0), cuota = n ? Math.round(fin / n) : 0
  const titulo = editar ? `Editar negocio · ${l.id_lote}` : desdeSep ? `Formalizar venta · ${l.id_lote}` : `Vender lote ${l.id_lote}`
  return (
    <Modal titulo={titulo} ancho cerrar={cerrar} boton={editar ? 'Guardar cambios' : 'Registrar venta'} alEnviar={async (x) => {
      if (editar) { await api('/api/venta/editar', { venta_id: v!.id, cliente: clienteDe(x), ...x }); cerrar(); await listo('Negocio actualizado') }
      else { await api('/api/venta/vender', { id_lote: l.id_lote, cliente: clienteDe(x), ...x, prospecto_id: prospecto?.id }); cerrar(); await listo(`Venta del lote ${l.id_lote} registrada`) }
    }}>
      <div className="form-grid" onInput={(e) => {
        const i = e.target as HTMLInputElement
        if (i.name === 'valor_venta') setVal(num(e)); if (i.name === 'cuota_inicial') setIni(num(e))
        if (i.name === 'n_cuotas') setN(+i.value || 0); if (i.name === 'fecha_primera_cuota') setFp(i.value)
      }}>
        <CamposCliente c={c} docReq={!esSepEdit} />
        {esSepEdit ? (
          <>
            <div className="form-sec">Separación</div>
            <Campo etq="Fecha de separación"><input type="date" name="fecha_separacion" defaultValue={v!.fecha_separacion || ''} /></Campo>
            <Campo etq="Vigente hasta"><input type="date" name="fecha_limite_separacion" defaultValue={v!.fecha_limite_separacion || ''} /></Campo>
            <Campo etq="Valor pactado"><Dinero name="valor_venta" def={val} /></Campo>
          </>
        ) : (
          <>
            <div className="form-sec">Condiciones de la venta</div>
            <Campo etq="Fecha de venta" req><input type="date" name="fecha_venta" value={fv} required onChange={(e) => { setFv(e.target.value); setFp(sumarMeses(e.target.value, 1)) }} /></Campo>
            <Campo etq="Valor de venta" req ayuda={l.precio_lista ? `Precio de lista: ${pesos(l.precio_lista)}` : ''}><Dinero name="valor_venta" def={val} required /></Campo>
            <Campo etq="Cuota inicial" ayuda={v?.pagado ? `Ya abonado: ${pesos(v.pagado)} (se descuenta de la inicial).` : 'Se cobra en la fecha de venta.'}><Dinero name="cuota_inicial" def={ini} /></Campo>
            <Campo etq="Número de cuotas mensuales" ayuda="0 = pago de contado."><input type="number" name="n_cuotas" min="0" max="360" defaultValue={n} /></Campo>
            <Campo etq="Fecha de la primera cuota"><input type="date" name="fecha_primera_cuota" value={fp} min={fv} onChange={(e) => setFp(e.target.value)} /></Campo>
            <Campo etq="Asesor comercial"><input type="text" name="vendedor" defaultValue={v?.vendedor || ''} /></Campo>
            <div className="resumen-plan">
              <div><div className="et">Saldo a financiar</div><div className="va">{pesos(fin)}</div></div>
              <div><div className="et">Valor cuota</div><div className="va">{n ? pesos(cuota) : 'Contado'}</div></div>
              <div><div className="et">Última cuota</div><div className="va">{n && fp ? fecha(sumarMeses(fp, n - 1)) : '—'}</div></div>
              <div><div className="et">Inicial / valor</div><div className="va">{val ? fmtN1.format((100 * ini) / val) + ' %' : '—'}</div></div>
            </div>
          </>)}
        <Campo etq="Observación" cls="c2"><textarea name="observacion" rows={2} defaultValue={v?.observacion || ''} /></Campo>
        {conCom && <CamposComision config={config} />}
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ pago
export function FormPago({ d, v, cerrar, listo, recibo }: Base & { v: Datos; recibo: (n: number, nota: string) => void }) {
  const sug = v.etapa === 'SEPARADO' ? 0 : (v.vencido > 0 ? v.vencido : v.proxima_cuota ? v.proxima_cuota.pendiente : v.saldo)
  const concepto0 = v.etapa === 'SEPARADO' ? 'Separación' : v.plan.find((c: Datos) => c.pendiente > 0.5)?.n === 0 ? 'Cuota inicial' : 'Cuota'
  const [val, setVal] = useState(Math.round(sug)), [conc, setConc] = useState(concepto0)
  return (
    <Modal titulo={`Registrar pago · ${d.lote.id_lote}`} cerrar={cerrar} boton="Registrar y generar recibo" alEnviar={async (x) => {
      const { recalcular, ...pago } = x
      const r = await api<Datos>('/api/pago', { venta_id: v.id, ...pago })
      let nota = ''
      if (x.concepto === 'Abono a capital' && recalcular && recalcular !== 'no') {
        try { const re = await api<Datos>('/api/venta/reestructurar', { venta_id: v.id, modo: recalcular }); nota = `Plan recalculado: ${re.n_cuotas} cuotas de ${pesos(re.cuota)}.` }
        catch (e) { nota = e instanceof Pendiente ? 'El recálculo del plan quedó pendiente de aprobación.' : 'No se pudo recalcular el plan: ' + (e as Error).message }
      }
      cerrar(); await listo(`Pago registrado · recibo N° ${r.recibo}`); recibo(r.recibo, nota)
    }}>
      <p className="texto-modal"><b>{v.nombre}</b> · {nombreLote(d.lote.id_lote)}<br />Saldo actual: <b className="num">{pesos(v.saldo)}</b>
        {v.vencido > 0 && <> · vencido <b className="num" style={{ color: 'var(--peligro)' }}>{pesos(v.vencido)}</b></>}</p>
      <div className="form-grid" onInput={(e) => { if ((e.target as HTMLInputElement).name === 'valor') setVal(num(e)) }}>
        <Campo etq="Fecha del pago" req><input type="date" name="fecha" defaultValue={hoyISO()} max={hoyISO()} required /></Campo>
        <Campo etq="Valor recibido" req><Dinero name="valor" def={Math.round(sug)} required /></Campo>
        <Campo etq="Concepto"><select name="concepto" value={conc} onChange={(e) => setConc(e.target.value)}>{CONCEPTOS.map((o) => <option key={o}>{o}</option>)}</select></Campo>
        <Campo etq="Medio de pago"><Sel name="medio" ops={MEDIOS} def="Efectivo" /></Campo>
        <Campo etq="Referencia / comprobante" cls="c2"><input type="text" name="referencia" placeholder="N° de transferencia, consignación…" /></Campo>
        <Campo etq="Observación" cls="c2"><input type="text" name="observacion" /></Campo>
        {conc === 'Abono a capital' && (
          <Campo etq="Después del abono a capital" cls="c2"><select name="recalcular">
            <option value="no">Mantener el plan (el abono se aplica a las cuotas en orden)</option>
            <option value="plazo">Recalcular: misma cuota, menos cuotas (termina antes)</option>
            <option value="cuota">Recalcular: mismo plazo, cuota más baja</option></select></Campo>)}
        <div className="resumen-plan">
          <div><div className="et">Pagado hasta hoy</div><div className="va">{pesos(v.pagado)}</div></div>
          <div><div className="et">Este pago</div><div className="va">{pesos(val)}</div></div>
          <div><div className="et">Saldo después</div><div className="va">{v.valor_venta ? pesos(Math.max(v.valor_venta - v.pagado - val, 0)) : '—'}</div></div>
          <div><div className="et">Avance</div><div className="va">{v.valor_venta ? fmtN1.format((100 * (v.pagado + val)) / v.valor_venta) + ' %' : '—'}</div></div>
        </div>
      </div>
    </Modal>
  )
}

export function FormAnular({ pagoId, info, cerrar, listo }: { pagoId: number; info: string; cerrar: () => void; listo: (m: string) => Promise<void> | void }) {
  return (
    <Modal titulo="Anular pago" cerrar={cerrar} boton="Anular pago" peligro alEnviar={async (x) => { await api('/api/pago/anular', { pago_id: pagoId, motivo: x.motivo }); cerrar(); await listo('Pago anulado') }}>
      <p className="texto-modal">Se anulará el <b>{info}</b>. El recibo conserva su número y queda marcado como anulado; el valor deja de contar en la cartera.</p>
      <div className="form-grid"><Campo etq="Motivo de la anulación" req cls="c2"><input type="text" name="motivo" required /></Campo></div>
    </Modal>
  )
}

export function FormDesistir({ d, v, cerrar, listo, config }: Base & { v: Datos }) {
  const sep = v.etapa === 'SEPARADO'
  const [pct, setPct] = useState(String(config.promesa_penalidad_pct ?? 10)), [otros, setOtros] = useState(0), [fec, setFec] = useState(hoyISO())
  const [x, setX] = useState<Datos | null>(null), [err, setErr] = useState('')
  useEffect(() => {
    const t = setTimeout(() => {
      api<Datos>('/api/desistimiento/simular', { venta_id: v.id, penalidad_pct: pct, otros_descuentos: otros, fecha: fec })
        .then((r) => { setX(r); setErr('') }).catch((e) => { setX(null); setErr(e.message) })
    }, 250)
    return () => clearTimeout(t)
  }, [pct, otros, fec, v.id])
  return (
    <Modal titulo={sep ? 'Liberar lote separado' : 'Registrar desistimiento'} cerrar={cerrar} ancho boton={sep ? 'Liberar lote' : 'Registrar desistimiento'} peligro
      alEnviar={async (f) => {
        try {
          const r = await api<Datos>('/api/desistimiento/registrar', { venta_id: v.id, penalidad_pct: pct, otros_descuentos: otros, fecha: fec, motivo: f.motivo, otros_concepto: f.otros_concepto })
          cerrar(); await listo(r.devolucion > 0 ? `Lote ${d.lote.id_lote} liberado. Quedan ${pesos(r.devolucion)} por devolver antes del ${fecha(r.fecha_limite)}` : `Lote ${d.lote.id_lote} liberado`)
        } catch (e) { if (e instanceof Pendiente) { cerrar(); return } throw e }
      }}>
      <p className="texto-modal">El negocio de <b>{v.nombre}</b> sobre el lote {d.lote.id_lote} quedará cerrado y el lote volverá a estar <b>disponible</b>.
        Los pagos se conservan en el historial; abajo se calcula cuánto se retiene y cuánto se devuelve.</p>
      <div className="form-grid">
        <Campo etq="Fecha"><input type="date" value={fec} max={hoyISO()} onChange={(e) => setFec(e.target.value)} /></Campo>
        <Campo etq="Motivo" req><input type="text" name="motivo" required placeholder={sep ? 'Separación vencida, desistió…' : 'Incumplimiento, solicitud del comprador…'} /></Campo>
        <Campo etq="Cláusula penal (% del precio)" ayuda="Por defecto, la de la promesa (Configuración)."><input type="number" min={0} max={100} step={0.5} value={pct} onChange={(e) => setPct(e.target.value)} /></Campo>
        <Campo etq="Otros descuentos acordados" ayuda="Gastos, comisión ya pagada… (opcional)"><DineroC valor={otros} set={setOtros} /></Campo>
        {otros > 0 && <Campo etq="Concepto de los otros descuentos" req cls="c2"><input type="text" name="otros_concepto" required /></Campo>}
        {err ? <div className="c2 alerta-caja mora"><AlertTriangle /><div>{err}</div></div> : x && (
          <div className="c2">
            <table className="mini-tabla"><tbody>
              <tr><td>Valor del negocio</td><td className="d">{pesos(x.valor_venta)}</td></tr>
              <tr><td>Pagado por el comprador</td><td className="d"><b>{pesos(x.pagado)}</b></td></tr>
              <tr><td>− Cláusula penal ({fmtN1.format(x.penalidad_pct)} % del precio = {pesos(x.clausula_penal)})</td><td className="d">− {pesos(x.retencion)}</td></tr>
              {x.otros_descuentos > 0 && <tr><td>− Otros descuentos</td><td className="d">− {pesos(x.otros_descuentos)}</td></tr>}
              <tr className="tot"><td><b>A devolver al comprador</b></td><td className="d"><b>{pesos(x.devolucion)}</b></td></tr></tbody></table>
            {x.devolucion > 0 && <div className="ley-ayuda" style={{ padding: '6px 0 0' }}>Plazo de devolución: {x.plazo_dias} días, hasta el {fecha(x.fecha_limite)}. Se registra después en <b>Cartera → Desistimientos</b>.</div>}
            {x.avisos.map((a: string) => <div key={a} className="alerta-caja aviso"><AlertTriangle /><div>{a}</div></div>)}
          </div>)}
      </div>
    </Modal>
  )
}

export function FormEscritura({ d, v, cerrar, listo }: Base & { v: Datos }) {
  return (
    <Modal titulo={`Escriturar · ${d.lote.id_lote}`} cerrar={cerrar} boton="Registrar escritura"
      alEnviar={async (x) => { await api('/api/venta/escriturar', { venta_id: v.id, ...x }); cerrar(); await listo('Escritura registrada') }}>
      {v.saldo > 0.5 && <div className="alerta-caja aviso" style={{ margin: '0 0 14px' }}><div>El negocio todavía tiene un saldo de <b>{pesos(v.saldo)}</b>.</div></div>}
      <div className="form-grid">
        <Campo etq="Fecha de la escritura"><input type="date" name="fecha_escritura" defaultValue={hoyISO()} /></Campo>
        <Campo etq="Número de escritura"><input type="text" name="numero_escritura" /></Campo>
        <Campo etq="Notaría" cls="c2"><input type="text" name="notaria" placeholder="Ej.: Notaría Primera" /></Campo>
      </div>
    </Modal>
  )
}

export function FormPrecio({ d, cerrar, listo }: Base) {
  const l = d.lote, [p, setP] = useState(l.precio_lista || 0)
  return (
    <Modal titulo={`Precio y bloqueo · ${l.id_lote}`} cerrar={cerrar}
      alEnviar={async (x) => { await api('/api/lote/precio', { id_lote: l.id_lote, ...x, precio_lista: x.precio_lista || null }); cerrar(); await listo('Lote actualizado') }}>
      <div className="form-grid" onInput={(e) => { if ((e.target as HTMLInputElement).name === 'precio_lista') setP(num(e)) }}>
        <Campo etq="Precio de lista" ayuda={`Área ${m2(l.area_m2)}`}><Dinero name="precio_lista" def={l.precio_lista || 0} /></Campo>
        <div className="campo"><span>Valor por m²</span><div className="num" style={{ height: 36, display: 'flex', alignItems: 'center', fontWeight: 600 }}>{p ? pesos(p / l.area_m2) + ' / m²' : '—'}</div></div>
        <label className="interruptor c2" style={{ gridColumn: '1/-1' }}><input type="checkbox" name="bloqueado" defaultChecked={!!l.bloqueado} /><span />Bloquear el lote para la venta (reserva del propietario, problema de linderos…)</label>
        <Campo etq="Nota" cls="c2"><input type="text" name="nota" defaultValue={l.nota || ''} /></Campo>
      </div>
    </Modal>
  )
}

export function FormInmueble({ d, cerrar, listo }: Base) {
  const l = d.lote
  return (
    <Modal titulo={`Datos del inmueble · ${l.id_lote}`} cerrar={cerrar}
      alEnviar={async (x) => { await api('/api/lote/inmueble', { id_lote: l.id_lote, ...x }); cerrar(); await listo('Datos del inmueble guardados') }}>
      <p className="texto-modal">Se usan en los contratos y en el validador previo. Cópielos del certificado de tradición y libertad; el cambio queda en la auditoría.</p>
      <div className="form-grid">
        <Campo etq="Matrícula inmobiliaria"><input type="text" name="matricula" defaultValue={l.matricula || ''} placeholder="Ej.: 230-123456" /></Campo>
        <Campo etq="Cédula catastral"><input type="text" name="cedula_catastral" defaultValue={l.cedula_catastral || ''} /></Campo>
        <Campo etq="Notas registrales (gravámenes, afectaciones, antecedentes)" cls="c2"><input type="text" name="nota_registral" defaultValue={l.nota_registral || ''} /></Campo>
      </div>
    </Modal>
  )
}

export function FormPreciosMasivos({ lotes, cerrar, listo }: { lotes: Datos[]; cerrar: () => void; listo: (m: string) => Promise<void> | void }) {
  const manz = [...new Set(lotes.map((l) => l.manzana))]
  const [modo, setModo] = useState('m2'), [val, setVal] = useState(0), [mz, setMz] = useState('')
  const ls = lotes.filter((l) => !l.venta_id && (!mz || String(l.manzana) === mz))
  const tot = ls.reduce((s, l) => s + (modo === 'm2' ? Math.round((val * (l.area_m2 || 0)) / 1000) * 1000 : val), 0)
  return (
    <Modal titulo="Asignar precios de lista" cerrar={cerrar} boton="Aplicar precios"
      alEnviar={async (x) => { const r = await api<Datos>('/api/precios/masivo', { ...x, solo_disponibles: true }); cerrar(); await listo(`${r.actualizados} lotes con precio actualizado`) }}>
      <p className="texto-modal">Actualiza el precio de lista de varios lotes a la vez. Los lotes con negocio activo no se tocan.</p>
      <div className="form-grid" onInput={(e) => { if ((e.target as HTMLInputElement).name === 'valor') setVal(num(e)) }}>
        <Campo etq="Forma de cálculo"><select name="modo" value={modo} onChange={(e) => setModo(e.target.value)}><option value="m2">Valor por m² × área del lote</option><option value="fijo">Precio fijo por lote</option></select></Campo>
        <Campo etq="Valor" req><Dinero name="valor" /></Campo>
        <Campo etq="Aplicar a" cls="c2"><select name="manzana" value={mz} onChange={(e) => setMz(e.target.value)}><option value="">Todas las manzanas</option>{manz.map((m) => <option key={m} value={m}>Manzana {String(m).padStart(2, '0')}</option>)}</select></Campo>
        <div className="resumen-plan" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><div className="et">Lotes</div><div className="va">{fmtN.format(ls.length)}</div></div>
          <div><div className="et">Precio promedio</div><div className="va">{ls.length ? pesos(tot / ls.length) : '—'}</div></div>
          <div><div className="et">Valor del inventario</div><div className="va">{pesosCorto(tot)}</div></div>
        </div>
      </div>
    </Modal>
  )
}

export function FormReestructurar({ d, v, cerrar, listo }: Base & { v: Datos }) {
  const cuotaActual = Math.max(0, ...v.plan.filter((x: Datos) => x.n > 0).map((x: Datos) => x.valor))
  const [modo, setModo] = useState('manual'), [nc, setNc] = useState(v.cuotas_total - v.cuotas_pagadas || 12)
  const n = modo === 'plazo' ? Math.ceil(v.saldo / cuotaActual) : modo === 'cuota' ? Math.max(1, v.cuotas_total - v.cuotas_pagadas) : nc || 1
  return (
    <Modal titulo={`Reestructurar plan · ${d.lote.id_lote}`} cerrar={cerrar} boton="Reestructurar"
      alEnviar={async (x) => { const r = await api<Datos>('/api/venta/reestructurar', { ...x, venta_id: v.id }); cerrar(); await listo(`Plan reestructurado: ${r.n_cuotas} cuotas de ${pesos(r.cuota)}`) }}>
      <p className="texto-modal">Se arma un plan nuevo para el saldo de <b>{pesos(v.saldo)}</b>. Lo pagado se conserva y el plan anterior queda en el historial.</p>
      <div className="form-grid">
        <Campo etq="Forma" cls="c2"><select name="modo" value={modo} onChange={(e) => setModo(e.target.value)}><option value="manual">Definir número de cuotas</option><option value="plazo">Mantener la cuota y acortar el plazo</option><option value="cuota">Mantener el plazo y bajar la cuota</option></select></Campo>
        <Campo etq="Número de cuotas"><input type="number" name="n_cuotas" min="1" max="360" value={nc} disabled={modo !== 'manual'} onChange={(e) => setNc(+e.target.value)} /></Campo>
        <Campo etq="Fecha de la primera cuota"><input type="date" name="fecha_primera" defaultValue={v.proxima_cuota?.fecha || sumarMeses(hoyISO(), 1)} /></Campo>
        <Campo etq="Motivo" req cls="c2"><input name="motivo" required placeholder="Acuerdo de pago, abono extraordinario…" /></Campo>
        <div className="resumen-plan" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><div className="et">Saldo</div><div className="va">{pesos(v.saldo)}</div></div>
          <div><div className="et">Cuotas</div><div className="va">{n}</div></div>
          <div><div className="et">Valor cuota</div><div className="va">{pesos(v.saldo / n)}</div></div>
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ comisión de la venta
export function FormAsignarComision({ d, v, cerrar, listo, config }: Base & { v: Datos }) {
  const { d: cm } = useApi<Datos>('/api/comisionistas')
  const [pct, setPct] = useState('')
  const activos = (cm?.comisionistas ?? []).filter((c: Datos) => c.estado === 'ACTIVO')
  return (
    <Modal titulo={`Asignar comisión · ${d.lote.id_lote}`} cerrar={cerrar} boton="Asignar comisión" alEnviar={async (x) => {
      if (!x.comisionista_id) throw new Error('Seleccione el comisionista.')
      await api('/api/comision/asignar', { venta_id: v.id, comisionista_id: x.comisionista_id, porcentaje: x.comision_pct, regla: x.comision_regla, observacion: x.observacion })
      cerrar(); await listo('Comisión asignada')
    }}>
      <p className="texto-modal">Venta de <b>{v.nombre}</b> por <b>{pesos(v.valor_venta)}</b>.</p>
      <div className="form-grid" onInput={(e) => { const i = e.target as HTMLInputElement; if (i.name === 'comision_pct') setPct(i.value) }}>
        {activos.length ? <CamposComision config={config} /> : <div className="c2 ley-ayuda">Primero registre comisionistas en la pestaña «Comisionistas».</div>}
        <Campo etq="Observación" cls="c2"><input type="text" name="observacion" /></Campo>
        <div className="resumen-plan" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
          <div><div className="et">Valor de la comisión</div><div className="va">{pesos((v.valor_venta * (+pct || 0)) / 100)}</div></div>
          <div><div className="et">Sobre la venta de</div><div className="va">{pesos(v.valor_venta)}</div></div>
        </div>
      </div>
    </Modal>
  )
}

export function FormEditarComision({ d, x, cerrar, listo }: Base & { x: Datos }) {
  return (
    <Modal titulo={`Editar comisión · ${x.comisionista}`} cerrar={cerrar} alEnviar={async (f) => { await api('/api/comision/editar', { id: x.id, ...f }); cerrar(); await listo('Comisión actualizada') }}>
      <p className="texto-modal">Lote {d.lote.id_lote} · venta por <b>{pesos(x.valor_venta)}</b>{x.pagado ? <> · ya pagado al comisionista: <b>{pesos(x.pagado)}</b></> : null}.</p>
      <div className="form-grid">
        <Campo etq="Comisión (%)"><input type="number" name="porcentaje" min="0" max="30" step="0.01" defaultValue={x.porcentaje} /></Campo>
        <Campo etq="Causación"><select name="regla" defaultValue={x.regla}>{Object.entries(REGLAS_COM).map(([k, v]) => <option key={k} value={k}>{v.nom}</option>)}</select></Campo>
        <Campo etq="Observación" cls="c2"><input type="text" name="observacion" defaultValue={x.observacion || ''} /></Campo>
      </div>
    </Modal>
  )
}

export function FormQuitarComision({ d, x, cerrar, listo }: Base & { x: Datos }) {
  return (
    <Modal titulo="Quitar comisión" cerrar={cerrar} boton="Quitar comisión" peligro alEnviar={async (f) => { await api('/api/comision/anular', { id: x.id, motivo: f.motivo }); cerrar(); await listo('Comisión retirada') }}>
      <p className="texto-modal">Se retirará la comisión de <b>{x.comisionista}</b> en el lote {d.lote.id_lote}. Queda registrada en el historial.</p>
      <div className="form-grid"><Campo etq="Motivo" req cls="c2"><input type="text" name="motivo" required /></Campo></div>
    </Modal>
  )
}
