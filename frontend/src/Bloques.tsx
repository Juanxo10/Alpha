/* Venta en bloque: un comprador adquiere varios lotes en una sola operación, con un solo plan de pagos.
   El panel de selección vive sobre el mapa; aquí están el formulario de venta, la página «Negocios en bloque», el pago consolidado
   y los documentos (estado de cuenta y recibo consolidado). */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, FileDown, FileSignature, FileText, HandCoins, Info, Layers, Percent, ShieldAlert, TriangleAlert, X } from 'lucide-react'
import { api, aviso, falla, Pendiente } from './api'
import { fecha, fechaLarga, fmtN1, pesos, pesosCorto } from './formato'
import { cabecera, esc, imprimir } from './imprimir'
import { numeroALetras } from './letras'
import { CamposCliente, CamposComision, clienteDe } from './Acciones'
import { FormContrato } from './Contratos'
import { MEDIOS } from './Gastos'
import { ChipNf, DineroC } from './Nuevas'
import { Campo, Cargando, hoyISO, Modal, Sel, sumarMeses, useApi, Vacio, type Datos } from './ui'

const fmtPct4 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
const MODOS: Record<string, string> = { PROGRESIVO: 'Progresivo', PAREJO: 'Parejo' }

// ------------------------------------------------------------------ panel de selección (sobre el mapa)
export function PanelSeleccion({ sel, porId, props, quitar, limpiar, cerrar, vender }: {
  sel: string[]; porId: Record<string, Datos>; props: Record<string, Datos>; quitar: (id: string) => void; limpiar: () => void; cerrar: () => void; vender: () => void
}) {
  const filas = sel.map((id) => porId[id])
  const lista = filas.reduce((s, l) => s + (l.precio_lista || 0), 0), area = filas.reduce((s, l) => s + (l.area_m2 || 0), 0)
  const sinPrecio = filas.filter((l) => !l.precio_lista).length
  const pct = sel.reduce((s, id) => s + (props[id]?.pct_predio || 0), 0)
  return (
    <div className="nfl-panel">
      <div className="nfl-cab"><b><Layers /> Venta en bloque</b><span>{sel.length} lote{sel.length === 1 ? '' : 's'}</span>
        <button type="button" className="nfl-x" title="Cerrar la venta en bloque (Esc)" aria-label="Cerrar" onClick={cerrar}><X /></button></div>
      {sel.length ? (
        <>
          <div className="nfl-lista">{filas.map((l) => (
            <div key={l.id_lote}><b>{l.id_lote}</b><span>{fmtN1.format(l.area_m2)} m²</span><span>{l.precio_lista ? pesosCorto(l.precio_lista) : 'Sin precio'}</span>
              <button type="button" className="link rojo" title="Quitar" onClick={() => quitar(l.id_lote)}><X /></button></div>))}</div>
          <div className="nfl-tot"><div><small>Área</small><b>{fmtN1.format(area)} m²</b></div><div><small>% del predio</small><b>{fmtPct4.format(pct)} %</b></div>
            <div><small>Precio de lista</small><b>{sinPrecio === filas.length ? 'Por definir' : pesosCorto(lista)}</b></div></div>
          {sinPrecio > 0 && <div className="nfl-nota">{sinPrecio === filas.length ? 'Los lotes no tienen precio de lista' : `${sinPrecio} lote(s) sin precio de lista`}: el precio se escribe en el formulario de venta.</div>}
        </>) : <div className="nfl-vacio">Toque en el mapa los lotes disponibles que quiere el comprador.</div>}
      <div className="nfl-acc"><button type="button" className="btn sec peq" disabled={!sel.length} onClick={limpiar}>Limpiar</button>
        <button type="button" className="btn pri peq" disabled={sel.length < 2} onClick={vender}><FileSignature />Vender en bloque</button></div>
    </div>
  )
}

// ------------------------------------------------------------------ formulario de venta en bloque
export function FormBloque({ ids, porId, cerrar, listo, config, abrir }: {
  ids: string[]; porId: Record<string, Datos>; cerrar: (vendido?: boolean) => void; listo: () => Promise<void> | void; config: Datos; abrir: (id: string) => void
}) {
  const hoy = hoyISO()
  const [orden, setOrden] = useState([...ids])
  const [precios, setPrecios] = useState<Record<string, number>>({})
  const [fv, setFv] = useState(hoy), [fp, setFp] = useState(sumarMeses(hoy, 1))
  const [desc, setDesc] = useState(0), [total, setTotal] = useState(0), [ini, setIni] = useState(0), [n, setN] = useState(24)
  const [modo, setModo] = useState('PROGRESIVO'), [m2v, setM2v] = useState(0)
  const [sim, setSim] = useState<Datos | null>(null), [errSim, setErrSim] = useState('')
  const [exito, setExito] = useState<Datos | null>(null)
  const [promesa, setPromesa] = useState<Datos | null>(null), [verNeg, setVerNeg] = useState(false)
  const inicialAuto = useRef(true)
  const faltan = ids.filter((id) => !porId[id].precio_lista)
  const precioDe = (id: string) => precios[id] || porId[id].precio_lista || 0
  const lista = orden.reduce((s, id) => s + precioDe(id), 0)
  const completo = faltan.every((id) => precios[id])

  const ponTotal = (l: number, d: number) => {
    const t = Math.round(l * (1 - d / 100))
    setTotal(t)
    if (inicialAuto.current) setIni(Math.round((t * 0.3) / 100000) * 100000)
  }
  // el descuento permitido para esa cantidad de lotes se propone al abrir
  useEffect(() => {
    api<Datos>('/api/bloque/simular', { lotes: ids, descuento_pct: 0, n_cuotas: 0, precios: Object.fromEntries(faltan.map((id) => [id, 1])) })
      .then((s) => { setDesc(s.descuento_permitido); ponTotal(lista, s.descuento_permitido) }).catch(() => ponTotal(lista, 0))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!completo || !total) { setSim(null); return }
    const t = setTimeout(() => {
      api<Datos>('/api/bloque/simular', { lotes: orden, precios, valor_total: total, cuota_inicial: ini, n_cuotas: n, fecha_venta: fv, fecha_primera_cuota: fp, modo })
        .then((s) => { setSim(s); setErrSim('') }).catch((e) => { setSim(null); setErrSim(e.message) })
    }, 350)
    return () => clearTimeout(t)
  }, [orden, precios, total, ini, n, fv, fp, modo, completo])

  const mover = (k: number, d: number) => setOrden((o) => { const c = [...o];[c[k], c[k + d]] = [c[k + d], c[k]]; return c })
  const cambioPrecios = (p: Record<string, number>) => {
    setPrecios(p)
    const l = orden.reduce((s, id) => s + (porId[id].precio_lista || p[id] || 0), 0)
    ponTotal(l, desc)
  }
  const varia = sim && sim.cuota_max - sim.cuota_min > Math.max(1000, 0.01 * sim.cuota_max)

  if (exito) return (
    <>
      <Modal titulo={`Negocio en bloque ${exito.numero}`} cerrar={() => cerrar(true)} pie={<>
        <button type="button" className="btn sec" onClick={() => setVerNeg(true)}><Layers />Ver negocio</button>
        <button type="button" className="btn pri" onClick={async () => {
          try { setPromesa(await abrirPromesa(exito.id)) } catch (e) { falla(e) }
        }}><FileSignature />Generar promesa en bloque</button></>}>
        <p className="texto-modal">Se registraron <b>{exito.ventas.length} ventas</b> dentro del negocio en bloque <b>{exito.numero}</b>, con un solo plan de pagos.
          Desde aquí puede generar la promesa en bloque y registrar los pagos del bloque.</p>
      </Modal>
      {promesa && <FormContrato v={promesa.v} tipos={promesa.tipos} tipo0="PROMESA_BLOQUE" bienes={[]} bloque={promesa.bloque} cerrar={() => cerrar(true)} listo={() => {}} config={config} />}
      {verNeg && <DetalleBloque id={exito.id} cerrar={() => cerrar(true)} abrir={abrir} config={config} listo={() => {}} />}
    </>)

  return (
    <Modal titulo={`Venta en bloque · ${ids.length} lotes`} cerrar={() => cerrar()} ancho="extra" boton="Registrar venta en bloque" alEnviar={async (x) => {
      if (!completo) throw new Error('Escriba el precio de todos los lotes sin precio de lista.')
      try {
        const r = await api<Datos>('/api/bloque/vender', { ...x, lotes: orden, precios, cliente: clienteDe(x), valor_total: total, cuota_inicial: ini, n_cuotas: n,
          fecha_venta: fv, fecha_primera_cuota: fp, modo })
        await listo(); setExito(r)
      } catch (e) { if (e instanceof Pendiente) { cerrar(true); return } throw e }
    }}>
      <div className="form-grid">
        <div className="form-sec">Lotes (en el orden en que se pagarán)</div>
        <>
          {faltan.length > 0 && (
            <div className="c2"><div className="alerta-caja aviso" style={{ margin: 0 }}><Info /><div>{faltan.length === orden.length ? 'Estos lotes no tienen' : `${faltan.length} lote(s) no tienen`} precio de lista: escriba su precio o use un <b>valor por m²</b>.
              Si quien vende es un operador, la venta la aprueba un dueño.</div></div></div>)}
          <Campo etq="Valor por m² (todos los lotes)" ayuda="Calcula el precio de cada lote: área × valor por m². También puede escribir el precio de cada lote. Un precio menor al de lista requiere aprobación de un dueño.">
            <DineroC valor={m2v} set={(v) => { setM2v(v); cambioPrecios(Object.fromEntries(orden.map((id) => [id, v ? Math.round((porId[id].area_m2 * v) / 1000) * 1000 : 0]))) }} /></Campo>
          <div />
        </>
        <div className="c2 nfl-orden">{orden.map((id, k) => (
          <div key={id}><span className="nfl-n">{k + 1}</span><b>{id}</b><span>{fmtN1.format(porId[id].area_m2)} m²</span>
            <span className="nfl-precio"><DineroC placeholder="Precio" valor={precioDe(id)} set={(v) => cambioPrecios({ ...precios, [id]: v })} /></span>
            <button type="button" className="link" disabled={!k} title="Subir" onClick={() => mover(k, -1)}><ArrowUp /></button>
            <button type="button" className="link" disabled={k >= orden.length - 1} title="Bajar" onClick={() => mover(k, 1)}><ArrowDown /></button></div>))}</div>
        <CamposCliente />
        <div className="form-sec">Precio y forma de pago</div>
        <Campo etq="Fecha de venta" req><input type="date" value={fv} required onChange={(e) => { setFv(e.target.value); setFp(sumarMeses(e.target.value, 1)) }} /></Campo>
        <Campo etq="Precio de lista del bloque"><input type="text" readOnly value={pesos(lista)} /></Campo>
        <Campo etq="Descuento por volumen (%)" ayuda={sim ? `Permitido sin aprobación para ${orden.length} lotes: ${fmtN1.format(sim.descuento_permitido)} %` : ''}>
          <input type="number" min={0} max={50} step={0.1} value={desc} onChange={(e) => { const d = +e.target.value || 0; setDesc(d); ponTotal(lista, d) }} /></Campo>
        <Campo etq="Valor del bloque" req><DineroC required valor={total} set={(v) => { setTotal(v); setDesc(lista ? Math.round((1000 * (lista - v)) / lista) / 10 : 0); if (inicialAuto.current) setIni(Math.round((v * 0.3) / 100000) * 100000) }} /></Campo>
        <Campo etq="Cuota inicial"><DineroC valor={ini} set={(v) => { inicialAuto.current = false; setIni(v) }} /></Campo>
        <Campo etq="Número de cuotas mensuales" ayuda="0 = de contado."><input type="number" min={0} max={360} value={n} onChange={(e) => setN(+e.target.value || 0)} /></Campo>
        <Campo etq="Fecha de la primera cuota"><input type="date" value={fp} onChange={(e) => setFp(e.target.value)} /></Campo>
        <Campo etq="Asesor comercial"><input type="text" name="vendedor" /></Campo>
        <div className="c2 nfl-modos">
          <label><input type="radio" name="modo" checked={modo === 'PROGRESIVO'} onChange={() => setModo('PROGRESIVO')} /><span><b>Progresivo · lote por lote</b>
            <small>Misma cuota mensual; termina de pagar un lote antes de seguir con el siguiente, y el comprador escritura cada lote apenas lo paga. Recomendado.</small></span></label>
          <label><input type="radio" name="modo" checked={modo === 'PAREJO'} onChange={() => setModo('PAREJO')} /><span><b>Parejo</b>
            <small>Todos los lotes avanzan al mismo ritmo; se escrituran al final.</small></span></label></div>
        <Campo etq="Observación" cls="c2"><textarea name="observacion" rows={2} /></Campo>
        <CamposComision config={config} />
        <div className="c2">
          {!completo && <div className="alerta-caja aviso"><Info /><div>Escriba el precio de {faltan.filter((id) => !precios[id]).join(', ')} para calcular el plan.</div></div>}
          {errSim && <div className="alerta-caja mora"><TriangleAlert /><div>{errSim}</div></div>}
          {sim && (
            <>
              <div className="nfl-res">
                <div><small>Lista</small><b>{pesosCorto(sim.valor_lista)}</b></div><div><small>Descuento</small><b>{fmtN1.format(sim.descuento_pct)} %</b></div>
                <div><small>Valor del bloque</small><b>{pesosCorto(sim.valor_total)}</b></div>
                <div><small>Cuota mensual</small><b>{sim.n_cuotas ? (varia ? `${pesosCorto(sim.cuota_min)} – ${pesosCorto(sim.cuota_max)}` : pesos(sim.cuota_max)) : 'Contado'}</b></div>
                <div><small>Plazo</small><b>{sim.n_cuotas ? `${sim.n_cuotas} meses` : '—'}</b></div></div>
              {sim.requiere_aprobacion && <div className="alerta-caja aviso"><ShieldAlert /><div>El descuento supera el {fmtN1.format(sim.descuento_permitido)} % permitido (o hay lotes sin precio de lista): si usted es operador, la venta quedará <b>pendiente de aprobación</b> de un dueño.</div></div>}
              {varia && <div className="alerta-caja aviso"><Info /><div>Con esta cuota inicial la cuota varía un poco según el lote que se esté pagando. Para una cuota fija, suba la cuota inicial o use el reparto parejo.</div></div>}
              <table className="mini-tabla nfl-tabla"><thead><tr><th>#</th><th>Lote</th><th className="d">Lista</th><th className="d">Valor</th><th className="d">Inicial</th><th className="d">Cuotas</th><th className="d">Cuota</th><th>Paga desde – hasta</th></tr></thead>
                <tbody>{sim.lotes.map((l: Datos, k: number) => (
                  <tr key={l.id_lote}><td>{k + 1}</td><td><b>{l.id_lote}</b></td><td className="d">{pesos(l.precio_lista)}</td><td className="d">{pesos(l.valor)}</td><td className="d">{pesos(l.inicial)}</td>
                    <td className="d">{l.n_cuotas || '—'}</td><td className="d">{l.n_cuotas ? pesos(l.cuota) : '—'}</td><td>{l.desde ? `${fecha(l.desde)} – ${fecha(l.hasta)}` : 'Con la inicial'}</td></tr>))}</tbody></table>
            </>)}
        </div>
      </div>
    </Modal>
  )
}

// datos para generar la promesa en bloque de un negocio
async function abrirPromesa(bid: number) {
  const [b, c] = await Promise.all([api<Datos>(`/api/bloque?id=${bid}`), api<Datos>('/api/contratos?venta_id=0')])
  const l = b.lotes.find((x: Datos) => x.estado === 'ACTIVA')
  if (!l) throw new Error('El negocio no tiene lotes vigentes')
  return { v: { id: l.venta_id, id_lote: l.id_lote, etapa: l.etapa, estado: 'ACTIVA' }, tipos: c.tipos.filter((t: Datos) => t.tipo === 'PROMESA_BLOQUE'),
    bloque: { id: b.id, numero: b.numero, n_lotes: b.n_lotes } }
}

// ------------------------------------------------------------------ aviso en la ficha del lote
export function AvisoBloque({ v, ver }: { v: Datos; ver: (id: number) => void }) {
  const { d } = useApi<Datos>(`/api/bloque/de_venta?venta_id=${v.id}`)
  const b = d?.bloque
  if (!b) return null
  return (
    <div className="nfl-aviso"><Layers /><div>Este lote hace parte del <b>negocio en bloque {b.numero}</b> ({b.n_lotes} lotes, un solo plan de pagos).</div>
      <button type="button" className="btn sec peq" onClick={() => ver(b.id)}>Ver negocio</button></div>
  )
}

// ------------------------------------------------------------------ detalle de un negocio en bloque
export function DetalleBloque({ id, cerrar, abrir, config, listo }: { id: number; cerrar: () => void; abrir: (id: string) => void; config: Datos; listo: () => void }) {
  const { d: b, error, recargar } = useApi<Datos>(`/api/bloque?id=${id}`)
  const [sub, setSub] = useState<'pagar' | Datos | null>(null)
  if (!b) return <Modal titulo="Negocio en bloque" cerrar={cerrar}>{error ? <p role="alert">{error}</p> : <p>Cargando…</p>}</Modal>
  const r = b.resumen, hoy = hoyISO()
  const estadoCuota = (x: Datos) => x.pendiente <= 0.5 ? <span className="ec PAGADA">Pagada</span> : x.fecha < hoy ? <span className="ec VENCIDA">Vencida</span>
    : x.pagado > 0.5 ? <span className="ec PARCIAL">Abono parcial</span> : <span className="ec PENDIENTE">Pendiente</span>
  return (
    <>
      <Modal titulo={`Negocio en bloque ${b.numero}`} cerrar={cerrar} ancho="extra" pie={<>
        <button type="button" className="btn sec" onClick={() => imprimirEstadoBloque(id, config)}><FileText />Estado de cuenta</button>
        <button type="button" className="btn sec" onClick={async () => { try { setSub(await abrirPromesa(id)) } catch (e) { falla(e) } }}><FileSignature />Promesa en bloque</button>
        {r.saldo > 0.5 && <button type="button" className="btn acento" onClick={() => setSub('pagar')}><HandCoins />Registrar pago del bloque</button>}</>}>
        <div className="nfl-det-cab"><div><b>{b.cliente || ''}</b><small>{b.tipo_doc || ''} {b.documento || ''} · {b.telefono || ''}</small></div>
          <div><small>Venta</small><b>{fecha(b.fecha_venta)}</b></div><div><small>Reparto</small><b>{b.modo_nombre}</b></div>
          {b.descuento_pct > 0.05 && <div><small>Descuento</small><b>{fmtN1.format(b.descuento_pct)} %</b></div>}</div>
        <div className="nfl-res"><div><small>Valor</small><b>{pesosCorto(r.valor)}</b></div><div><small>Pagado</small><b>{pesosCorto(r.pagado)}</b></div>
          <div><small>Saldo</small><b>{pesosCorto(r.saldo)}</b></div>
          <div><small>Vencido</small><b style={{ color: r.vencido > 0.5 ? 'var(--peligro)' : 'inherit' }}>{r.vencido > 0.5 ? pesosCorto(r.vencido) : 'Al día'}</b></div>
          <div><small>Próxima cuota</small><b>{r.proxima ? `${pesosCorto(r.proxima.pendiente)} · ${fecha(r.proxima.fecha)}` : '—'}</b></div></div>
        <div className="bloque-tit" style={{ margin: '14px 0 6px' }}>Lotes del negocio</div>
        <table className="mini-tabla nfl-tabla"><thead><tr><th>#</th><th>Lote</th><th className="d">Valor</th><th className="d">Pagado</th><th className="d">Saldo</th><th>Avance</th><th>Estado</th></tr></thead>
          <tbody>{b.lotes.map((l: Datos) => (
            <tr key={l.id_lote} className={l.estado !== 'ACTIVA' ? 'nf-inactivo' : ''}><td>{l.orden}</td>
              <td><button type="button" className="link" onClick={() => { cerrar(); abrir(l.id_lote) }}>{l.id_lote}</button></td>
              <td className="d">{pesos(l.valor)}</td><td className="d">{pesos(l.pagado)}</td><td className="d">{pesos(l.saldo)}</td>
              <td><div className="nfl-barra"><i style={{ width: `${Math.min(100, l.pct_pagado || 0)}%` }} /></div></td>
              <td>{l.estado !== 'ACTIVA' ? 'Desistido' : l.etapa === 'ESCRITURADO' ? 'Escriturado' : l.saldo <= 0.5 ? <b style={{ color: 'var(--menta-osc)' }}>Pagado · listo para escriturar</b>
                : l.vencido > 0.5 ? <span style={{ color: 'var(--peligro)' }}>Mora {l.dias_mora} días</span> : 'Al día'}</td></tr>))}</tbody></table>
        <div className="bloque-tit" style={{ margin: '14px 0 6px' }}>Plan de pagos único</div>
        <div className="nfl-plan"><table className="mini-tabla"><thead><tr><th>Fecha</th><th className="d">Valor</th><th className="d">Pagado</th><th className="d">Pendiente</th><th>Estado</th><th>Lotes</th></tr></thead>
          <tbody>{b.plan.map((x: Datos) => (
            <tr key={x.fecha}><td>{fecha(x.fecha)}</td><td className="d">{pesos(x.valor)}</td><td className="d">{pesos(x.pagado)}</td><td className="d">{pesos(x.pendiente)}</td>
              <td>{estadoCuota(x)}</td><td><small>{x.lotes.join(', ')}</small></td></tr>))}</tbody></table></div>
        <div className="bloque-tit" style={{ margin: '14px 0 6px' }}>Pagos del bloque</div>
        {b.pagos_bloque.length ? <table className="mini-tabla"><tbody>{b.pagos_bloque.map((g: Datos) => (
          <tr key={g.id}><td><b>{g.numero}</b></td><td>{fecha(g.fecha)}</td><td className="d">{pesos(g.valor)}</td><td>{g.medio} {g.referencia || ''}</td><td><small>{g.pagos.length} recibos</small></td>
            <td style={{ textAlign: 'right' }}><button type="button" className="link" title="Recibo consolidado" onClick={() => imprimirReciboBloque(g.id, config)}><FileDown /></button></td></tr>))}</tbody></table>
          : <div className="vacio" style={{ padding: 10 }}>Aún no hay pagos registrados como bloque.</div>}
      </Modal>
      {sub === 'pagar' && <FormPagoBloque b={b} cerrar={() => setSub(null)} listo={() => { recargar(); listo() }} config={config} />}
      {sub && sub !== 'pagar' && <FormContrato v={sub.v} tipos={sub.tipos} tipo0="PROMESA_BLOQUE" bienes={[]} bloque={sub.bloque} cerrar={() => setSub(null)} listo={() => {}} config={config} />}
    </>
  )
}

function FormPagoBloque({ b, cerrar, listo, config }: { b: Datos; cerrar: () => void; listo: () => void; config: Datos }) {
  const r = b.resumen
  const [valor, setValor] = useState(Math.round(r.vencido > 0.5 ? r.vencido : r.proxima ? r.proxima.pendiente : r.saldo))
  const [rep, setRep] = useState<Datos[]>([]), [err, setErr] = useState('')
  useEffect(() => {
    const t = setTimeout(() => {
      if (!valor) { setRep([]); return }
      api<Datos>('/api/bloque/pago/simular', { bloque_id: b.id, valor }).then((s) => { setRep(s.reparto); setErr('') }).catch((e) => { setRep([]); setErr(e.message) })
    }, 300)
    return () => clearTimeout(t)
  }, [valor, b.id])
  return (
    <Modal titulo={`Pago del negocio en bloque · ${b.numero}`} cerrar={cerrar} boton="Registrar pago y generar recibos" alEnviar={async (x) => {
      const res = await api<Datos>('/api/bloque/pago', { ...x, valor, bloque_id: b.id })
      cerrar(); listo(); aviso(`Pago ${res.numero} registrado: ${res.recibos.length} recibos`); imprimirReciboBloque(res.id, config)
    }}>
      <div className="form-grid">
        <div className="c2 resumen-plan" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><div className="et">Saldo</div><div className="va">{pesos(r.saldo)}</div></div><div><div className="et">Vencido</div><div className="va">{pesos(r.vencido)}</div></div>
          <div><div className="et">Próxima cuota</div><div className="va">{r.proxima ? pesos(r.proxima.pendiente) : '—'}</div></div></div>
        <Campo etq="Valor recibido" req><DineroC required valor={valor} set={setValor} /></Campo>
        <Campo etq="Fecha" req><input type="date" name="fecha" defaultValue={hoyISO()} max={hoyISO()} required /></Campo>
        <Campo etq="Medio de pago"><Sel name="medio" ops={MEDIOS} def="Transferencia" /></Campo>
        <Campo etq="Referencia / comprobante"><input name="referencia" /></Campo>
        <Campo etq="Observación" cls="c2"><input name="observacion" /></Campo>
        <div className="c2">
          {err ? <div className="alerta-caja mora"><TriangleAlert /><div>{err}</div></div> : rep.length > 0 && (
            <><div className="bloque-tit" style={{ marginBottom: 6 }}>Cómo se aplica a cada lote</div>
              <table className="mini-tabla"><tbody>{rep.map((x) => <tr key={x.venta_id}><td><b>{x.id_lote}</b></td><td className="d">{pesos(x.valor)}</td></tr>)}</tbody></table></>)}
        </div>
      </div>
    </Modal>
  )
}

function FormDescuentos({ reglas, cerrar, listo }: { reglas: number[][]; cerrar: () => void; listo: () => void }) {
  const filas = [...reglas, [0, 0]]
  return (
    <Modal titulo="Descuento por volumen" cerrar={cerrar} boton="Guardar" alEnviar={async (x) => {
      const nuevas = filas.map((_, k) => [+x['n' + k], +x['p' + k]]).filter(([n]) => n >= 2)
      await api('/api/bloque/descuentos', { reglas: nuevas }); cerrar(); aviso('Descuentos actualizados'); listo()
    }}>
      <p className="texto-modal">Para cada cantidad mínima de lotes, el descuento máximo que un operador puede dar sin aprobación de un dueño.</p>
      <table className="mini-tabla"><thead><tr><th>Desde (lotes)</th><th>Descuento máximo (%)</th></tr></thead>
        <tbody>{filas.map(([n, p], k) => (
          <tr key={k}><td><input type="number" name={'n' + k} min={2} max={500} defaultValue={n || ''} /></td>
            <td><input type="number" name={'p' + k} min={0} max={50} step={0.5} defaultValue={n ? p : ''} /></td></tr>))}</tbody></table>
    </Modal>
  )
}

// ------------------------------------------------------------------ página Comercial → Negocios en bloque
export default function Bloques({ abrir, config, rol, seleccionar }: { abrir: (id: string) => void; config: Datos; rol: string; seleccionar: () => void }) {
  const { d: r, error, recargar } = useApi<Datos>('/api/bloques')
  const [ver, setVer] = useState<number | null>(null), [reglas, setReglas] = useState(false)
  if (!r) return <Cargando error={error} />
  return (
    <div className="pagina">
      <div className="pagina-cab"><div><h1>Negocios en bloque</h1>
        <p>Compradores con varios lotes: un solo plan de pagos, un recibo consolidado por pago y la promesa en bloque. Para crear uno, use «Seleccionar varios lotes» en el mapa.</p></div>
        <div className="botones">{rol === 'DUENO' && <button className="btn sec" onClick={() => setReglas(true)}><Percent />Descuentos por volumen</button>}
          <button className="btn pri" onClick={seleccionar}><Layers />Seleccionar lotes en el mapa</button></div></div>
      <div className="tarjeta" style={{ marginBottom: 16 }}><h3>Descuento por volumen vigente</h3>
        <div className="nfl-reglas">{r.descuentos.map(([n, p]: number[]) => <div key={n}><b>{fmtN1.format(p)} %</b><span>desde {n} lotes</span></div>)}</div>
        <div className="ley-ayuda" style={{ padding: '6px 0 0' }}>Es lo máximo que un operador puede dar sin aprobación; por encima, la venta la aprueba un dueño.</div></div>
      {r.bloques.length ? (
        <div className="tabla-wrap grande"><table className="datos nf-tabla"><thead><tr><th>Negocio</th><th>Comprador</th><th>Lotes</th><th className="d">Valor</th><th className="d">Pagado</th><th className="d">Saldo</th><th>Cartera</th><th>Reparto</th><th /></tr></thead>
          <tbody>{r.bloques.map((b: Datos) => (
            <tr key={b.id}><td><b>{b.numero}</b><br /><small>{fecha(b.fecha_venta)}{b.descuento_pct > 0.05 ? ` · desc. ${fmtN1.format(b.descuento_pct)} %` : ''}</small></td>
              <td>{b.cliente || ''}<br /><small>{b.documento || ''}</small></td>
              <td>{b.lotes.map((l: string) => <span key={l} className="nfl-chip">{l}</span>)}<br /><small>{b.resumen.lotes_pagados} pagados · {b.resumen.escriturados} escriturados</small></td>
              <td className="d">{pesos(b.resumen.valor)}</td><td className="d">{pesos(b.resumen.pagado)}</td><td className="d"><b>{pesos(b.resumen.saldo)}</b></td>
              <td>{b.resumen.vencido > 0.5 ? <ChipNf t={`${b.resumen.dias_mora} días · ${pesosCorto(b.resumen.vencido)}`} c="#DC2626" />
                : b.resumen.saldo <= 0.5 ? <ChipNf t="Pagado" c="#7C3AED" /> : <ChipNf t="Al día" c="#17A974" />}</td>
              <td><small>{MODOS[b.modo] || b.modo}</small></td>
              <td><button type="button" className="link" title="Ver negocio" onClick={() => setVer(b.id)}><ChevronRight /></button></td></tr>))}</tbody></table></div>
      ) : <div className="tarjeta"><Vacio Ic={Layers} t="Aún no hay negocios en bloque." /></div>}
      {ver !== null && <DetalleBloque id={ver} cerrar={() => setVer(null)} abrir={abrir} config={config} listo={recargar} />}
      {reglas && <FormDescuentos reglas={r.descuentos} cerrar={() => setReglas(false)} listo={recargar} />}
    </div>
  )
}

// ------------------------------------------------------------------ documentos para imprimir / PDF
const CSS_BLOQUE = `
  .ficha-b th { width: 150px; text-transform: none; letter-spacing: 0; font-size: 11px; color: #4D6369; }
  .kp { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
  .kp div { background: #F2F5F5; border-radius: 6px; padding: 8px 10px; } .kp div.malo b { color: #DC2626; }
  .kp small { display: block; font-size: 9.5px; text-transform: uppercase; color: #82959A; } .kp b { font: 600 13px Lexend, Arial; }
  tr.venc td { color: #B91C1C; } tr.pag td { color: #15803D; }
  .firmas.dos { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 60px; } .firmas.dos div { font-size: 10px; }`

async function imprimirEstadoBloque(id: number, c: Datos) {
  try {
    const b = await api<Datos>(`/api/bloque?id=${id}`)
    const r = b.resumen, hoy = hoyISO()
    imprimir(`Estado de cuenta ${b.numero}`, `${cabecera(c, 'ESTADO DE CUENTA · NEGOCIO EN BLOQUE', b.numero, `Fecha de corte: ${fechaLarga(hoy)}`)}
      <table class="ficha-b"><tr><th>Comprador</th><td>${esc(b.cliente || '')} · ${esc(b.tipo_doc || '')} ${esc(b.documento || '')}</td></tr>
        <tr><th>Fecha del negocio</th><td>${fechaLarga(b.fecha_venta)} · ${b.lotes.length} lotes · ${esc(b.modo_nombre)}</td></tr></table>
      <div class="kp"><div><small>Valor</small><b>${pesos(r.valor)}</b></div><div><small>Pagado</small><b>${pesos(r.pagado)}</b></div>
        <div><small>Saldo</small><b>${pesos(r.saldo)}</b></div><div class="${r.vencido > 0.5 ? 'malo' : ''}"><small>Vencido</small><b>${pesos(r.vencido)}</b></div></div>
      <h3>1. Lotes</h3><table><thead><tr><th>#</th><th>Lote</th><th class="d">Valor</th><th class="d">Pagado</th><th class="d">Saldo</th><th>Estado</th></tr></thead><tbody>
        ${b.lotes.map((l: Datos) => `<tr><td>${l.orden}</td><td>${l.id_lote}</td><td class="d">${pesos(l.valor)}</td><td class="d">${pesos(l.pagado)}</td><td class="d">${pesos(l.saldo)}</td>
          <td>${l.estado !== 'ACTIVA' ? 'Desistido' : l.etapa === 'ESCRITURADO' ? 'Escriturado' : l.saldo <= 0.5 ? 'Pagado' : 'Vigente'}</td></tr>`).join('')}</tbody></table>
      <h3>2. Plan de pagos</h3><table><thead><tr><th>Fecha</th><th class="d">Valor</th><th class="d">Pagado</th><th class="d">Pendiente</th><th>Estado</th></tr></thead><tbody>
        ${b.plan.map((x: Datos) => `<tr class="${x.pendiente > 0.5 && x.fecha < hoy ? 'venc' : x.pendiente <= 0.5 ? 'pag' : ''}"><td>${fecha(x.fecha)}</td><td class="d">${pesos(x.valor)}</td>
          <td class="d">${pesos(x.pagado)}</td><td class="d">${pesos(x.pendiente)}</td><td>${x.pendiente <= 0.5 ? 'Pagada' : x.fecha < hoy ? 'Vencida' : 'Pendiente'}</td></tr>`).join('')}</tbody></table>
      ${b.pagos_bloque.length ? `<h3>3. Pagos del bloque</h3><table><thead><tr><th>Recibo</th><th>Fecha</th><th>Medio</th><th class="d">Valor</th></tr></thead><tbody>
        ${b.pagos_bloque.map((g: Datos) => `<tr><td>${esc(g.numero)}</td><td>${fecha(g.fecha)}</td><td>${esc(g.medio)}</td><td class="d">${pesos(g.valor)}</td></tr>`).join('')}</tbody></table>` : ''}`, CSS_BLOQUE)
  } catch (e) { falla(e) }
}

async function imprimirReciboBloque(id: number, c: Datos) {
  try {
    const g = await api<Datos>(`/api/bloque/recibo?id=${id}`)
    const b = g.negocio
    imprimir(`Recibo ${g.numero}`, `${cabecera(c, 'RECIBO DE CAJA CONSOLIDADO', g.numero, `${esc(c.ciudad || '')}, ${fechaLarga(g.fecha)}`)}
      <table class="ficha-b"><tr><th>Recibimos de</th><td><b>${esc(b.cliente || '')}</b> · ${esc(b.tipo_doc || '')} ${esc(b.documento || '')}</td></tr>
        <tr><th>La suma de</th><td><b>${pesos(g.valor)}</b> (${esc(numeroALetras(g.valor).toLowerCase())})</td></tr>
        <tr><th>Concepto</th><td>Pago del negocio en bloque ${esc(b.numero)} (${b.lotes.length} lotes)</td></tr>
        <tr><th>Medio</th><td>${esc(g.medio)}${g.referencia ? ` · ${esc(g.referencia)}` : ''}</td></tr></table>
      <h3>1. Aplicación a cada lote</h3><table><thead><tr><th>Recibo</th><th>Lote</th><th class="d">Valor aplicado</th></tr></thead><tbody>
        ${g.detalle_pagos.map((p: Datos) => `<tr><td>N° ${String(p.recibo).padStart(6, '0')}</td><td>${p.id_lote}</td><td class="d">${pesos(p.valor)}</td></tr>`).join('')}
        <tr class="tot"><td colspan="2">Total</td><td class="d">${pesos(g.valor)}</td></tr></tbody></table>
      <p style="font-size:10px;margin-top:10px">Saldo del negocio después de este pago: <b>${pesos(b.resumen.saldo)}</b>.</p>
      <div class="firmas dos"><div>Recibido por<br><b>${esc(c.vendedor_razon_social || c.proyecto)}</b></div><div>Pagado por<br><b>${esc(b.cliente || '')}</b></div></div>`, CSS_BLOQUE)
  } catch (e) { falla(e) }
}

