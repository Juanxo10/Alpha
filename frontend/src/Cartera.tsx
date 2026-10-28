import { useMemo, useState } from 'react'
import { FileSpreadsheet, Search } from 'lucide-react'
import { CARTERA, EN_MORA, fecha, fmtN, fmtN1, pesos } from './formato'
import { Chip } from './Ficha'
import type { Lote } from './tipos'

const COLS: [keyof Lote, string, boolean?][] = [
  ['id_lote', 'Lote'], ['area_m2', 'Área', true], ['estado', 'Estado'], ['cartera', 'Cartera'], ['cliente', 'Comprador'],
  ['documento', 'Documento'], ['valor_venta', 'Valor venta', true], ['pagado', 'Pagado', true], ['saldo', 'Saldo', true],
  ['vencido', 'Vencido', true], ['dias_mora', 'Días mora', true], ['proxima_fecha', 'Próxima cuota'],
]

export default function Cartera({ lotes, abrir }: { lotes: Lote[]; abrir: (id: string) => void }) {
  const [q, setQ] = useState(''), [es, setEs] = useState(''), [ca, setCa] = useState(''), [mz, setMz] = useState('')
  const [ord, setOrd] = useState<{ k: keyof Lote; asc: boolean }>({ k: 'id_lote', asc: true })
  const manzanas = useMemo(() => [...new Set(lotes.map((l) => l.manzana))].sort((a, b) => a - b), [lotes])
  const ls = useMemo(() => {
    const t = q.trim().toLowerCase()
    const f = lotes.filter((l) =>
      (es === 'NEGOCIADO' ? !!l.venta_id : !es || l.estado === es) &&
      (ca === 'MORA' ? EN_MORA.includes(l.cartera ?? '') : !ca || l.cartera === ca) &&
      (!mz || String(l.manzana) === mz) &&
      (!t || `${l.id_lote} ${l.cliente ?? ''} ${l.documento ?? ''}`.toLowerCase().includes(t)))
    return f.sort((a, b) => {
      const x = a[ord.k] ?? '', y = b[ord.k] ?? ''
      return (x > y ? 1 : x < y ? -1 : 0) * (ord.asc ? 1 : -1)
    })
  }, [lotes, q, es, ca, mz, ord])
  const sum = (k: 'area_m2' | 'valor_venta' | 'pagado' | 'saldo' | 'vencido') => ls.reduce((s, l) => s + (l[k] || 0), 0)

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div><h1>Cartera por lote</h1><p>Todos los lotes con su estado comercial, saldo y mora.</p></div>
        <div className="botones">
          <a className="btn sec" href="/api/exportar/cartera.csv"><FileSpreadsheet />Exportar a Excel</a>
        </div>
      </div>
      <div className="filtros-tabla">
        <div className="buscador peq"><Search /><input type="search" placeholder="Buscar en la tabla…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select value={es} onChange={(e) => setEs(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="DISPONIBLE">Disponible</option><option value="SEPARADO">Separado</option>
          <option value="VENDIDO">Vendido (con saldo)</option><option value="PAGADO">Pagado</option>
          <option value="ESCRITURADO">Escriturado</option><option value="BLOQUEADO">Bloqueado</option>
          <option value="NEGOCIADO">Con negocio (todos)</option>
        </select>
        <select value={ca} onChange={(e) => setCa(e.target.value)}>
          <option value="">Toda la cartera</option>
          <option value="AL_DIA">Al día</option><option value="MORA">En mora (todas)</option>
          <option value="MORA_30">Mora 1–30 días</option><option value="MORA_90">Mora 31–90 días</option>
          <option value="MORA_MAS_90">Mora más de 90 días</option>
        </select>
        <select value={mz} onChange={(e) => setMz(e.target.value)}>
          <option value="">Todas las manzanas</option>
          {manzanas.map((m) => <option key={m} value={m}>Manzana {m}</option>)}
        </select>
        <span className="contador">{fmtN.format(ls.length)} lotes</span>
      </div>
      <div className="tabla-wrap grande">
        <table className="datos">
          <thead><tr>{COLS.map(([k, t, d]) => (
            <th key={k} className={d ? 'd' : ''} onClick={() => setOrd({ k, asc: ord.k === k ? !ord.asc : true })}>
              {t}{ord.k === k && <span className="flecha">{ord.asc ? '▲' : '▼'}</span>}
            </th>))}</tr></thead>
          <tbody>{ls.map((l) => (
            <tr key={l.id_lote} onClick={() => abrir(l.id_lote)}>
              <td><b>{l.id_lote}</b></td><td className="d">{fmtN1.format(l.area_m2 ?? 0)}</td><td><Chip k={l.estado} /></td>
              <td>{l.cartera && l.cartera !== 'SEPARADO' && <Chip k={l.cartera} cat={CARTERA} />}</td>
              <td>{l.cliente}</td><td>{l.documento}</td>
              <td className="d">{l.valor_venta ? pesos(l.valor_venta) : l.precio_lista ? <span style={{ color: 'var(--txt-3)' }}>{pesos(l.precio_lista)}</span> : '—'}</td>
              <td className="d">{l.pagado ? pesos(l.pagado) : '—'}</td><td className="d">{l.saldo ? pesos(l.saldo) : '—'}</td>
              <td className="d">{l.vencido ? <span className="rojo">{pesos(l.vencido)}</span> : '—'}</td><td className="d">{l.dias_mora || '—'}</td>
              <td>{l.proxima_fecha && <>{fecha(l.proxima_fecha)} · <span className="num">{pesos(l.proxima_valor ?? 0)}</span></>}</td>
            </tr>))}</tbody>
          <tfoot><tr><td>Total</td><td className="d">{fmtN1.format(sum('area_m2'))}</td><td colSpan={4} />
            <td className="d">{pesos(sum('valor_venta'))}</td><td className="d">{pesos(sum('pagado'))}</td>
            <td className="d">{pesos(sum('saldo'))}</td><td className="d">{pesos(sum('vencido'))}</td><td colSpan={2} /></tr></tfoot>
        </table>
      </div>
    </div>
  )
}
