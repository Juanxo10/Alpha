import { useMemo, useState } from 'react'
import { imprimirEgreso } from './imprimir'
import { Ban, Calculator, Printer, FileSpreadsheet, Plus, Receipt, Search, ShieldAlert } from 'lucide-react'
import { api, aviso } from './api'
import { fecha, MESES_L, pesos, pesosCorto } from './formato'
import { Campo, Cargando, Dinero, hoyISO, Kpi, Modal, Sel, useApi, Vacio, type Datos } from './ui'

export const MEDIOS = ['Efectivo', 'Transferencia', 'Consignación', 'Cheque', 'Tarjeta']
const ce = (n: number) => `CE ${String(n).padStart(6, '0')}`

export function FormPresupuesto({ cerrar, listo }: { cerrar: () => void; listo: () => void }) {
  const { d: f } = useApi<Datos>('/api/flujo')
  return (
    <Modal titulo="Presupuesto de gastos del proyecto" ancho cerrar={cerrar} boton="Guardar presupuesto" alEnviar={async (x) => {
      await api('/api/presupuesto', { valores: Object.fromEntries((f?.presupuesto ?? []).map((p: Datos) => [p.categoria, x['cat_' + p.categoria] || 0])) })
      cerrar(); aviso('Presupuesto guardado'); listo()
    }}>
      <p className="texto-modal">Lo presupuestado por categoría se compara con lo ejecutado en el flujo de caja y alimenta el resultado proyectado.</p>
      {!f ? <p>Cargando…</p> : (
        <table className="mini-tabla"><thead><tr><th>Categoría</th><th className="d">Ejecutado</th><th className="d" style={{ width: 200 }}>Presupuesto</th></tr></thead>
          <tbody>{f.presupuesto.map((p: Datos) => (
            <tr key={p.categoria}><td>{p.categoria}</td><td className="d">{pesos(p.ejecutado)}</td>
              <td className="d"><Dinero name={'cat_' + p.categoria} def={Math.round(p.presupuesto)} /></td></tr>))}</tbody></table>)}
    </Modal>
  )
}

function FormGasto({ categorias, dueno, cerrar, listo, config }: { categorias: string[]; dueno: boolean; cerrar: () => void; listo: () => void; config: Datos }) {
  const [b, setB] = useState(0), [r, setR] = useState(0)
  return (
    <Modal titulo="Registrar gasto" ancho cerrar={cerrar} boton="Registrar y generar comprobante" alEnviar={async (x) => {
      const g = await api<Datos>('/api/gasto', x); cerrar(); aviso(`Gasto registrado · ${ce(g.comprobante)}`); listo(); if (g.comprobante) imprimirEgreso(g.comprobante, config)
    }}>
      <div className="form-grid" onInput={(e) => {
        const i = e.target as HTMLInputElement
        if (i.name === 'valor_bruto') setB(Number(i.value.replace(/\D/g, '')) || 0)
        if (i.name === 'retencion') setR(Number(i.value.replace(/\D/g, '')) || 0)
      }}>
        <Campo etq="Fecha" req><input type="date" name="fecha" defaultValue={hoyISO()} max={hoyISO()} required /></Campo>
        <Campo etq="Categoría"><Sel name="categoria" ops={categorias} /></Campo>
        <Campo etq="Proveedor o beneficiario" req><input name="proveedor" required /></Campo>
        <Campo etq="NIT / documento"><input name="documento_proveedor" /></Campo>
        <Campo etq="Descripción" req cls="c2"><input name="descripcion" required /></Campo>
        <Campo etq="N° de factura o cuenta de cobro"><input name="factura" /></Campo>
        <Campo etq="Medio de pago"><Sel name="medio" ops={MEDIOS} def="Transferencia" /></Campo>
        <Campo etq="Valor total" req><Dinero name="valor_bruto" required /></Campo>
        <Campo etq="Retención practicada" ayuda="Si se retuvo al proveedor (ej. retención en la fuente)."><Dinero name="retencion" /></Campo>
        <Campo etq="Referencia / comprobante bancario" cls="c2"><input name="referencia" /></Campo>
        <div className="resumen-plan" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><div className="et">Valor</div><div className="va">{pesos(b)}</div></div>
          <div><div className="et">Retención</div><div className="va">{pesos(r)}</div></div>
          <div><div className="et">Neto a pagar</div><div className="va">{pesos(b - r)}</div></div>
        </div>
      </div>
      {!dueno && <div className="alerta-caja aviso" style={{ marginTop: 12 }}><ShieldAlert /><div>Los gastos registrados por un operador quedan <b>pendientes de aprobación</b>.</div></div>}
    </Modal>
  )
}

export default function Gastos({ rol, config }: { rol: string; config: Datos }) {
  const { d: r, error, recargar } = useApi<Datos>('/api/gastos')
  const [q, setQ] = useState(''), [cat, setCat] = useState(''), [anul, setAnul] = useState(false)
  const [nuevo, setNuevo] = useState(false), [presup, setPresup] = useState(false)
  const [anular, setAnular] = useState<Datos | null>(null)
  const vivos = useMemo(() => (r?.gastos ?? []).filter((g: Datos) => !g.anulado), [r])
  const ls = useMemo(() => (r?.gastos ?? []).filter((g: Datos) => (anul || !g.anulado) && (!cat || g.categoria === cat) &&
    (!q || `${g.comprobante} ${g.proveedor} ${g.descripcion} ${g.factura || ''}`.toLowerCase().includes(q.toLowerCase()))), [r, q, cat, anul])
  if (!r) return <Cargando error={error} />
  const mes = hoyISO().slice(0, 7)
  const tot: Record<string, number> = {}
  vivos.forEach((g: Datos) => { tot[g.categoria] = (tot[g.categoria] || 0) + g.valor_bruto })
  const may = Object.entries(tot).sort((a, b) => b[1] - a[1])[0]
  const suma = (a: Datos[], k: string) => a.reduce((s, g) => s + g[k], 0)
  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div><h1>Gastos del proyecto</h1><p>Todo egreso queda con comprobante (CE) consecutivo, el mismo de los pagos de comisión.</p></div>
        <div className="botones">
          <a className="btn sec" href="/api/exportar/gastos.csv"><FileSpreadsheet />Exportar</a>
          <button className="btn sec" onClick={() => setPresup(true)}><Calculator />Presupuesto</button>
          <button className="btn pri" onClick={() => setNuevo(true)}><Plus />Registrar gasto</button>
        </div>
      </div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <Kpi et="Gastos acumulados" va={pesosCorto(suma(vivos, 'valor_bruto'))} sub={`${vivos.length} comprobantes`} c="#DC2626" />
        <Kpi et="Gastos del mes" va={pesosCorto(suma(vivos.filter((g: Datos) => g.fecha.startsWith(mes)), 'valor_bruto'))} sub={MESES_L[new Date().getMonth()]} c="#F5B841" />
        <Kpi et="Retenciones practicadas" va={pesosCorto(suma(vivos, 'retencion'))} sub="Por declarar y pagar" c="#8B5CF6" />
        <Kpi et="Mayor categoría" va={may ? pesosCorto(may[1]) : '—'} sub={may ? may[0] : 'Sin gastos'} c="#0C2E37" />
      </div>
      <div className="filtros-tabla">
        <div className="buscador peq"><Search /><input type="search" placeholder="Proveedor, descripción, CE…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas las categorías</option>{r.categorias.map((c: string) => <option key={c}>{c}</option>)}</select>
        <label className="interruptor"><input type="checkbox" checked={anul} onChange={(e) => setAnul(e.target.checked)} /><span />Ver anulados</label>
        <span className="contador">{ls.length} gastos · {pesos(suma(ls.filter((g: Datos) => !g.anulado), 'valor_bruto'))}</span>
      </div>
      <div className="tabla-wrap grande">
        {!ls.length ? <Vacio Ic={Receipt} pad t="No hay gastos registrados." /> : (
          <table className="datos">
            <thead><tr><th>CE</th><th>Fecha</th><th>Categoría</th><th>Proveedor</th><th>Descripción</th><th>Factura</th><th className="d">Valor</th><th className="d">Retención</th><th className="d">Neto pagado</th><th>Medio</th><th>Conc.</th><th /></tr></thead>
            <tbody>{ls.map((g: Datos) => (
              <tr key={g.id} className={g.anulado ? 'anulado' : ''}>
                <td className="num"><b>{ce(g.comprobante)}</b></td><td>{fecha(g.fecha)}</td><td>{g.categoria}</td><td>{g.proveedor}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: 280 }}>{g.descripcion}</td><td>{g.factura}</td>
                <td className="d">{pesos(g.valor_bruto)}</td><td className="d">{g.retencion ? pesos(g.retencion) : '—'}</td><td className="d">{pesos(g.valor_neto)}</td>
                <td>{g.medio}</td><td>{g.conciliado ? '✓' : ''}</td>
                <td style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>{g.anulado
                  ? <span className="chip ANULADO" title={g.motivo_anulacion}>Anulado</span>
                  : <><button className="link" title="Imprimir" onClick={() => imprimirEgreso(g.comprobante, config)}><Printer /></button> <button className="link rojo" title="Anular" onClick={() => setAnular(g)}><Ban /></button></>}</td>
              </tr>))}</tbody>
          </table>)}
      </div>
      {nuevo && <FormGasto categorias={r.categorias} dueno={rol === 'DUENO'} config={config} cerrar={() => setNuevo(false)} listo={recargar} />}
      {presup && <FormPresupuesto cerrar={() => setPresup(false)} listo={recargar} />}
      {anular && (
        <Modal titulo="Anular gasto" cerrar={() => setAnular(null)} boton="Anular" peligro alEnviar={async (x) => {
          await api('/api/gasto/anular', { id: anular.id, motivo: x.motivo }); setAnular(null); aviso('Gasto anulado'); recargar()
        }}>
          <p className="texto-modal">Se anulará el <b>{ce(anular.comprobante)} · {pesos(anular.valor_bruto)}</b>; el número se conserva.</p>
          <div className="form-grid"><Campo etq="Motivo" req cls="c2"><input name="motivo" required /></Campo></div>
        </Modal>)}
    </div>
  )
}
