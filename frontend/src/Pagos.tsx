import { useMemo, useState } from 'react'
import { FileSpreadsheet, Printer, ReceiptText, Search } from 'lucide-react'
import { imprimirRecibo } from './imprimir'
import { fecha, fmtN, pesos } from './formato'
import { Cargando, useApi, Vacio, type Datos } from './ui'

export default function Pagos({ abrir, config }: { abrir: (id: string) => void; config: Datos }) {
  const { d, error } = useApi<Datos[]>('/api/pagos')
  const [q, setQ] = useState(''), [de, setDe] = useState(''), [ha, setHa] = useState(''), [anul, setAnul] = useState(false)
  const ps = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (d ?? []).filter((p) => (anul || !p.anulado) && (!de || p.fecha >= de) && (!ha || p.fecha <= ha) &&
      (!t || `${p.recibo} ${p.id_lote} ${p.cliente} ${p.documento || ''} ${p.referencia || ''}`.toLowerCase().includes(t)))
  }, [d, q, de, ha, anul])
  if (!d) return <Cargando error={error} />
  const tot = ps.filter((p) => !p.anulado).reduce((s, p) => s + p.valor, 0)
  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div><h1>Libro de pagos</h1><p>Recibos de caja emitidos, en orden de consecutivo.</p></div>
        <div className="botones"><a className="btn sec" href="/api/exportar/pagos.csv"><FileSpreadsheet />Exportar a Excel</a></div>
      </div>
      <div className="filtros-tabla">
        <div className="buscador peq"><Search /><input type="search" placeholder="Recibo, lote o comprador…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="campo-inline">Desde <input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label className="campo-inline">Hasta <input type="date" value={ha} onChange={(e) => setHa(e.target.value)} /></label>
        <label className="interruptor"><input type="checkbox" checked={anul} onChange={(e) => setAnul(e.target.checked)} /><span />Ver anulados</label>
        <span className="contador">{fmtN.format(ps.length)} recibos · {pesos(tot)}</span>
      </div>
      <div className="tabla-wrap grande">
        {!ps.length ? <Vacio Ic={ReceiptText} pad t={d.length ? 'Ningún pago coincide con el filtro.' : 'Aún no hay pagos registrados. Los pagos se registran desde la ficha de cada lote.'} /> : (
          <table className="datos">
            <thead><tr><th>Recibo</th><th>Fecha</th><th>Lote</th><th>Comprador</th><th>Concepto</th><th>Medio</th><th>Referencia</th><th className="d">Valor</th><th>Registró</th><th /></tr></thead>
            <tbody>{ps.map((p) => (
              <tr key={p.recibo} className={p.anulado ? 'anulado' : ''} onClick={() => abrir(p.id_lote)}>
                <td className="num"><b>N° {String(p.recibo).padStart(6, '0')}</b></td><td>{fecha(p.fecha)}</td>
                <td>{p.id_lote}</td><td>{p.cliente}</td><td>{p.concepto}</td><td>{p.medio}</td><td>{p.referencia}</td>
                <td className="d">{pesos(p.valor)}</td><td>{p.usuario}</td>
                <td>{p.anulado ? <span className="chip ANULADO" title={p.motivo_anulacion}>Anulado</span> : <button className="link" title="Imprimir recibo" onClick={(e) => { e.stopPropagation(); imprimirRecibo(p.recibo, config) }}><Printer /></button>}</td>
              </tr>))}</tbody>
            <tfoot><tr><td colSpan={7}>Total recaudado (sin anulados)</td><td className="d">{pesos(tot)}</td><td colSpan={2} /></tr></tfoot>
          </table>)}
      </div>
    </div>
  )
}
