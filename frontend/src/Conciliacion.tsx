import { useState } from 'react'
import { CheckCheck, GitCompare, Landmark } from 'lucide-react'
import { api, aviso, falla } from './api'
import { fecha, fmtN, pesos } from './formato'
import { Cargando, Kpi, useApi, Vacio, type Datos } from './ui'

const reg = (x: Datos) => x.tabla === 'pagos' ? `Recibo N° ${String(x.numero).padStart(6, '0')} · ${x.tercero} · ${x.id_lote}`
  : `${x.tabla === 'gastos' ? 'Gasto' : 'Comisión'} CE ${String(x.numero).padStart(6, '0')} · ${x.tercero}`

export default function Conciliacion() {
  const { d: r, error, recargar } = useApi<Datos>('/api/conciliacion')
  const [banco, setBanco] = useState('')
  const [ext, setExt] = useState<{ texto: string; nombre: string; cols: string[]; prev: string } | null>(null)
  const [cols, setCols] = useState({ fecha: 0, valor: 0, desc: 0 })
  const [cruce, setCruce] = useState<Datos | null>(null)
  const [sel, setSel] = useState<boolean[]>([])
  if (!r) return <Cargando error={error} />

  async function cargar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    let texto: string
    if (/\.xls[xm]$/i.test(f.name)) {
      try {
        const contenido = await new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.onerror = mal; r.readAsDataURL(f) })
        texto = (await api<{ texto: string }>('/api/conciliacion/xlsx', { nombre: f.name, contenido })).texto
      } catch (x) { falla(x); return }
    } else if (/\.xls$/i.test(f.name)) {
      aviso('El formato .xls (Excel antiguo) no se lee: guárdelo como .xlsx'); e.target.value = ''; return
    } else texto = await f.text()
    if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(await f.arrayBuffer())
    const filas = texto.split(/\r?\n/).filter((x) => x.trim()).slice(0, 6)
    const sep = (filas[0].match(/;/g) || []).length >= (filas[0].match(/,/g) || []).length ? ';' : ','
    const cs = filas[0].split(sep)
    const adivina = (re: RegExp) => Math.max(0, cs.findIndex((c) => re.test(c.toLowerCase())))
    setCols({ fecha: adivina(/fecha|date/), valor: adivina(/valor|monto|importe|cr[eé]dito/), desc: adivina(/desc|concepto|detalle/) })
    setExt({ texto, nombre: f.name, cols: cs, prev: filas.slice(1, 3).join('  |  ').slice(0, 200) })
    setCruce(null)
  }
  async function analizar() {
    try {
      const x = await api<Datos>('/api/conciliacion/analizar', { texto: ext!.texto, col_fecha: cols.fecha, col_valor: cols.valor, col_desc: cols.desc })
      setCruce(x); setSel(x.pares.map(() => true))
    } catch (e) { falla(e) }
  }
  async function confirmar() {
    const pares = cruce!.pares.filter((_: Datos, k: number) => sel[k]).map((p: Datos) => ({ tabla: p.registro.tabla, id: p.registro.id }))
    try {
      const x = await api<Datos>('/api/conciliacion/confirmar', { pares, banco, archivo: ext!.nombre, movimientos: cruce!.movimientos })
      aviso(`${x.conciliados} registros conciliados`); setCruce(null); setExt(null); recargar()
    } catch (e) { falla(e) }
  }
  const opc = (v: number, set: (n: number) => void) => (
    <select value={v} onChange={(e) => set(+e.target.value)}>{ext!.cols.map((c, k) => <option key={k} value={k}>{k + 1}. {c.slice(0, 30)}</option>)}</select>)

  return (
    <div className="pagina">
      <div className="pagina-cab"><div><h1>Conciliación bancaria</h1>
        <p>Cargue el extracto del banco en Excel (.xlsx) o CSV. El sistema cruza cada movimiento con los recibos, gastos y pagos de comisión registrados.</p></div></div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <Kpi et="Recibos conciliados" va={fmtN.format(r.pagos_conciliados)} sub="Confirmados contra el banco" c="#17A974" />
        <Kpi et="Recibos por conciliar" va={fmtN.format(r.pagos_pendientes)} sub="Transferencias y consignaciones" c="#F5B841" rojo={!!r.pagos_pendientes} />
        <Kpi et="Egresos por conciliar" va={fmtN.format(r.egresos_pendientes)} sub="Gastos y comisiones no en efectivo" c="#DC2626" />
      </div>
      <div className="tarjeta" style={{ marginBottom: 16 }}><h3>1. Cargar el extracto</h3>
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <label className="campo"><span>Archivo del extracto (.xlsx o .csv)</span><input type="file" accept=".csv,.txt,.xlsx,.xlsm" onChange={cargar} /></label>
          <label className="campo"><span>Banco</span><input type="text" placeholder="Bancolombia, Davivienda…" value={banco} onChange={(e) => setBanco(e.target.value)} /></label>
        </div>
        {ext && (
          <div style={{ marginTop: 12 }}>
            <div className="bloque-tit" style={{ marginBottom: 8 }}>2. Indique qué columna es cada dato</div>
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
              <label className="campo"><span>Fecha</span>{opc(cols.fecha, (n) => setCols({ ...cols, fecha: n }))}</label>
              <label className="campo"><span>Valor (+ entra, − sale)</span>{opc(cols.valor, (n) => setCols({ ...cols, valor: n }))}</label>
              <label className="campo"><span>Descripción</span>{opc(cols.desc, (n) => setCols({ ...cols, desc: n }))}</label>
            </div>
            <div className="ley-ayuda" style={{ padding: '6px 0' }}>Vista previa: {ext.prev}</div>
            <button className="btn pri" onClick={analizar}><GitCompare />Cruzar con lo registrado</button>
          </div>)}
      </div>
      {cruce && (
        <>
          <div className="tarjeta" style={{ marginBottom: 16 }}>
            <h3>3. Resultado del cruce · {cruce.movimientos} movimientos del {fecha(cruce.periodo[0])} al {fecha(cruce.periodo[1])}</h3>
            <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 12 }}>
              <Kpi et="Coinciden" va={cruce.pares.length} sub="Se marcarán como conciliados" c="#17A974" />
              <Kpi et="En el banco, sin registro" va={cruce.sin_registro.length} sub="Pagos que nadie registró o egresos sin soporte" c="#DC2626" rojo={!!cruce.sin_registro.length} />
              <Kpi et="Ya conciliados" va={cruce.ya_conciliados.length} sub="Quedaron conciliados antes; no se cuentan de nuevo" c="#64748B" />
              <Kpi et="Registrados, no en el banco" va={cruce.sin_extracto.length} sub="Revise: ¿entró realmente el dinero?" c="#F5B841" rojo={!!cruce.sin_extracto.length} />
            </div>
            {!!cruce.pares.length && (
              <>
                <table className="mini-tabla"><thead><tr><th /><th>Fecha banco</th><th>Descripción del banco</th><th className="d">Valor</th><th>Registro en el geovisor</th></tr></thead>
                  <tbody>{cruce.pares.map((p: Datos, k: number) => (
                    <tr key={k}><td><input type="checkbox" checked={sel[k]} onChange={(e) => setSel(sel.map((s, i) => (i === k ? e.target.checked : s)))} /></td>
                      <td>{fecha(p.movimiento.fecha)}</td><td>{p.movimiento.descripcion}</td><td className="d">{pesos(p.movimiento.valor)}</td><td>{reg(p.registro)}</td></tr>))}</tbody></table>
                <button className="btn acento" style={{ marginTop: 10 }} onClick={confirmar}><CheckCheck />Confirmar conciliación</button>
              </>)}
          </div>
          {!!cruce.sin_registro.length && (
            <div className="tarjeta" style={{ marginBottom: 16 }}><h3 style={{ color: 'var(--peligro)' }}>Movimientos del banco sin registro</h3>
              <table className="mini-tabla"><tbody>{cruce.sin_registro.map((m: Datos, k: number) => (
                <tr key={k}><td>{fecha(m.fecha)}</td><td>{m.descripcion}</td><td className="d">{pesos(m.valor)}</td><td>{m.valor > 0 ? 'Entrada: ¿pago de un comprador sin recibo?' : 'Salida sin comprobante de egreso'}</td></tr>))}</tbody></table></div>)}
          {!!cruce.ya_conciliados.length && (
            <div className="tarjeta" style={{ marginBottom: 16 }}><h3 style={{ color: '#475569' }}>Movimientos ya conciliados antes</h3>
              <table className="mini-tabla"><thead><tr><th>Fecha banco</th><th>Descripción del banco</th><th className="d">Valor</th><th>Registro</th><th>Conciliado en</th></tr></thead>
                <tbody>{cruce.ya_conciliados.map((p: Datos, k: number) => (
                  <tr key={k}><td>{fecha(p.movimiento.fecha)}</td><td>{p.movimiento.descripcion}</td><td className="d">{pesos(p.movimiento.valor)}</td>
                    <td>{reg(p.registro)}</td><td><small>{p.registro.conciliacion_ref}</small></td></tr>))}</tbody></table></div>)}
          {!!cruce.sin_extracto.length && (
            <div className="tarjeta" style={{ marginBottom: 16 }}><h3 style={{ color: '#B45309' }}>Registros del periodo que no aparecen en el banco</h3>
              <table className="mini-tabla"><tbody>{cruce.sin_extracto.map((x: Datos, k: number) => (
                <tr key={k}><td>{fecha(x.fecha)}</td><td>{reg(x)}</td><td className="d">{pesos(Math.abs(x.valor))}</td><td>{x.medio} {x.referencia}</td></tr>))}</tbody></table></div>)}
        </>)}
      <div className="tarjeta"><h3>Conciliaciones anteriores</h3>
        {!r.historial.length ? <Vacio Ic={Landmark} t="Aún no se ha conciliado ningún extracto." /> : (
          <table className="datos"><thead><tr><th>Fecha</th><th>Banco</th><th>Archivo</th><th className="d">Movimientos</th><th className="d">Conciliados</th><th>Usuario</th></tr></thead>
            <tbody>{r.historial.map((h: Datos, k: number) => (
              <tr key={k}><td>{fecha(h.fecha)}</td><td>{h.banco}</td><td>{h.archivo}</td><td className="d">{h.movimientos}</td><td className="d">{h.conciliados}</td><td>{h.usuario}</td></tr>))}</tbody></table>)}
      </div>
    </div>
  )
}
