/* Desistimientos: liquidación (pagado − cláusula penal − otros descuentos), plazo de devolución y registro de la devolución. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react'
import { Banknote, FileSignature, FileText, Search, Undo2 } from 'lucide-react'
import { api, aviso, falla } from './api'
import { fecha, fechaLarga, fmtN1, pesos, pesosCorto } from './formato'
import { cabecera, esc, imprimir } from './imprimir'
import { FormContrato } from './Contratos'
import { MEDIOS } from './Gastos'
import { ChipNf } from './Nuevas'
import { Campo, Cargando, hoyISO, Kpi, Modal, Sel, useApi, Vacio, type Datos } from './ui'

const COL: Record<string, string> = { PENDIENTE: '#F5B841', DEVUELTA: '#17A974', SIN_DEVOLUCION: '#94A3B8' }

function imprimirLiquidacion(x: Datos, c: Datos) {
  imprimir(`Liquidación de desistimiento ${x.id_lote}`, `${cabecera(c, 'LIQUIDACIÓN DE DESISTIMIENTO', x.id_lote, `${esc(c.ciudad || '')}, ${fechaLarga(x.fecha)}`)}
    <div class="caja">
      <div class="fila"><span>Comprador</span><b>${esc(x.cliente)} · ${esc(x.documento || '')}</b></div>
      <div class="fila"><span>Lote</span><b>${esc(x.id_lote)}</b></div>
      <div class="fila"><span>Fecha del desistimiento</span><b>${fecha(x.fecha)}</b></div>
      <div class="fila"><span>Motivo</span><b style="font-weight:400">${esc(x.motivo || '')}</b></div></div>
    <table><tbody>
      <tr><td>Valor del negocio</td><td class="d">${pesos(x.valor_venta)}</td></tr>
      <tr><td>Total pagado por el comprador</td><td class="d"><b>${pesos(x.pagado)}</b></td></tr>
      <tr><td>Cláusula penal retenida (${fmtN1.format(x.penalidad_pct)} % del precio)</td><td class="d">− ${pesos(x.retencion)}</td></tr>
      ${x.otros_descuentos > 0 ? `<tr><td>Otros descuentos: ${esc(x.otros_concepto || '')}</td><td class="d">− ${pesos(x.otros_descuentos)}</td></tr>` : ''}
      <tr class="tot"><td>VALOR A DEVOLVER AL COMPRADOR</td><td class="d">${pesos(x.devolucion)}</td></tr></tbody></table>
    ${x.devolucion > 0 ? `<p>La devolución se hará dentro de los ${x.plazo_dias} días siguientes, es decir, a más tardar el <b>${fechaLarga(x.fecha_limite)}</b>.</p>` : '<p>No hay valor por devolver.</p>'}
    ${x.estado === 'DEVUELTA' ? `<p>Devuelto el ${fecha(x.fecha_devolucion)} por ${esc(x.medio || '')}${x.referencia ? ' · ref. ' + esc(x.referencia) : ''}.</p>` : ''}
    <div class="firmas"><div>EL VENDEDOR<br>${esc(c.vendedor_razon_social || c.proyecto)}</div><div>EL COMPRADOR<br>${esc(x.cliente)}</div></div>`)
}

function FormDevolucion({ x, cerrar, listo }: { x: Datos; cerrar: () => void; listo: () => void }) {
  return (
    <Modal titulo={`Registrar devolución · ${x.id_lote}`} cerrar={cerrar} boton="Registrar devolución" alEnviar={async (f) => {
      const r = await api<Datos>('/api/desistimiento/devolver', { id: x.id, ...f })
      cerrar(); aviso(`Devolución registrada · comprobante de egreso ${String(r.comprobante).padStart(6, '0')}`); listo()
    }}>
      <p className="texto-modal">Se devuelven <b>{pesos(x.devolucion)}</b> a <b>{x.cliente}</b>. Queda como un gasto «Devoluciones a compradores» con su comprobante de egreso: sale de la caja y se concilia con el banco.</p>
      <div className="form-grid">
        <Campo etq="Fecha de la devolución" req><input type="date" name="fecha" defaultValue={hoyISO()} min={x.fecha} max={hoyISO()} required /></Campo>
        <Campo etq="Medio"><Sel name="medio" ops={MEDIOS} def="Transferencia" /></Campo>
        <Campo etq="Referencia / comprobante" cls="c2"><input name="referencia" /></Campo>
      </div>
    </Modal>
  )
}

export default function Desistimientos({ abrir, config }: { abrir: (id: string) => void; config: Datos }) {
  const { d: r, error, recargar } = useApi<Datos>('/api/desistimientos')
  const [f, setF] = useState({ estado: '', q: '' })
  const [dev, setDev] = useState<Datos | null>(null), [resc, setResc] = useState<Datos | null>(null)
  if (!r) return <Cargando error={error} />
  const k = r.kpis, q = f.q.trim().toLowerCase()
  const filas = r.desistimientos.filter((x: Datos) => (!f.estado || x.estado === f.estado) && (!q || `${x.id_lote} ${x.cliente} ${x.documento || ''}`.toLowerCase().includes(q)))
  const resciliacion = async (x: Datos) => {
    try {
      const c = await api<Datos>('/api/contratos?venta_id=0')
      setResc({ v: { id: x.venta_id, id_lote: x.id_lote, etapa: x.etapa, estado: 'DESISTIDA' }, tipos: c.tipos.filter((t: Datos) => t.tipo === 'RESCILIACION'),
        previos: { valor_devolucion: String(Math.round(x.devolucion)), plazo_devolucion: `${x.plazo_dias} días calendario contados desde la firma` } })
    } catch (e) { falla(e) }
  }
  return (
    <div className="pagina">
      <div className="pagina-cab"><div><h1>Desistimientos</h1>
        <p>Cuánto se retiene y cuánto se devuelve a cada comprador que desistió, con el plazo para devolver y el registro del pago. Para desistir, use «Desistimiento» en la ficha del lote.</p></div></div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <Kpi et="Por devolver" va={pesosCorto(k.por_devolver)} sub={`${k.por_devolver_n} desistimientos pendientes`} c="#F5B841" />
        <Kpi et="Plazo vencido" va={k.vencidas} sub={`Pasaron los ${r.plazo_dias} días sin devolver`} c="#DC2626" rojo={!!k.vencidas} />
        <Kpi et="Devuelto" va={pesosCorto(k.devuelto)} sub="Pagado a compradores" c="#17A974" />
        <Kpi et="Retenido" va={pesosCorto(k.retenido)} sub="Cláusula penal y otros descuentos" c="#8B5CF6" />
      </div>
      <div className="filtros-tabla">
        <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="">Todos los estados</option>
          <option value="PENDIENTE">Por devolver</option><option value="DEVUELTA">Devueltas</option><option value="SIN_DEVOLUCION">Sin devolución</option></select>
        <div className="buscador peq"><Search /><input type="search" placeholder="Lote o comprador…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        <span style={{ marginLeft: 'auto', color: 'var(--txt-3)' }}>{filas.length} desistimientos</span></div>
      <div className="tabla-wrap grande">{filas.length ? (
        <table className="datos nf-tabla"><thead><tr><th>Lote / comprador</th><th>Fecha</th><th className="d">Pagado</th><th className="d">Retenido</th><th className="d">A devolver</th><th>Límite</th><th>Estado</th><th /></tr></thead>
          <tbody>{filas.map((x: Datos) => (
            <tr key={x.id}><td><button className="link" onClick={() => abrir(x.id_lote)}>{x.id_lote}</button><br /><small>{x.cliente}</small></td>
              <td>{fecha(x.fecha)}<br /><small>{x.motivo}</small></td>
              <td className="d">{pesos(x.pagado)}</td>
              <td className="d">{pesos(x.retencion + x.otros_descuentos)}<br /><small>{fmtN1.format(x.penalidad_pct)} %{x.otros_descuentos > 0 ? ` + ${x.otros_concepto}` : ''}</small></td>
              <td className="d"><b>{pesos(x.devolucion)}</b></td>
              <td>{x.estado === 'PENDIENTE' ? <>{fecha(x.fecha_limite)}<br /><small style={{ color: x.vencida ? 'var(--peligro)' : undefined }}>{x.vencida ? `Vencido hace ${-x.dias_para_vencer} días` : `Faltan ${x.dias_para_vencer} días`}</small></>
                : x.estado === 'DEVUELTA' ? <>Devuelta el {fecha(x.fecha_devolucion)}</> : '—'}</td>
              <td><ChipNf t={x.vencida ? 'Plazo vencido' : x.estado_nombre} c={x.vencida ? '#DC2626' : COL[x.estado]} /></td>
              <td className="nf-acc">
                {x.estado === 'PENDIENTE' && <button className="btn acento peq" onClick={() => setDev(x)}><Banknote />Registrar devolución</button>}
                <button className="btn sec peq" title="Liquidación" onClick={() => imprimirLiquidacion(x, config)}><FileText />Liquidación</button>
                <button className="btn sec peq" title="Resciliación" onClick={() => resciliacion(x)}><FileSignature />Resciliación</button></td></tr>))}</tbody></table>
      ) : <Vacio Ic={Undo2} t={r.desistimientos.length ? 'No hay desistimientos con ese filtro.' : 'Aún no hay desistimientos liquidados. Se registran desde la ficha del lote: «Desistimiento».'} />}</div>
      {dev && <FormDevolucion x={dev} cerrar={() => setDev(null)} listo={() => recargar()} />}
      {resc && <FormContrato v={resc.v} tipos={resc.tipos} tipo0="RESCILIACION" previos={resc.previos} bienes={[]} bloque={null} cerrar={() => setResc(null)} listo={() => recargar()} config={config} />}
    </div>
  )
}
