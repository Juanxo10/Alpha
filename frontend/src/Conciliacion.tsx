import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CheckCheck, CircleCheck, Eye, FileSpreadsheet, GitCompare, Landmark, RotateCcw, ScrollText, TriangleAlert, Upload, X } from 'lucide-react'
import { api, aviso, falla } from './api'
import { fecha, fmtN, pesos } from './formato'
import { Cargando, Kpi, useApi, Vacio, type Datos } from './ui'

type Rol = 'fecha' | 'valor' | 'desc'
const ROLES_COL: [Rol, string][] = [['fecha', 'Fecha'], ['valor', 'Valor (+ entra, − sale)'], ['desc', 'Descripción']]
const BANCOS = ['Bancolombia', 'Davivienda', 'Banco de Bogotá', 'BBVA', 'Banco Popular', 'AV Villas', 'Banco Agrario', 'Nequi', 'Daviplata']
const TIPO_REG: Record<string, string> = { pagos: 'Recibo', gastos: 'Gasto', pagos_comision: 'Comisión' }

const reg = (x: Datos) => `N° ${String(x.numero).padStart(6, '0')} · ${x.tercero}${x.tabla === 'pagos' && x.id_lote ? ' · ' + x.id_lote : ''}`
const dias = (a: string, b: string) => Math.round(Math.abs(+new Date(a + 'T12:00') - +new Date(b + 'T12:00')) / 864e5)

// ---- lectura del extracto en el navegador (para mostrar qué se entendió antes de cruzar) ----
function partir(linea: string, sep: string) {
  const out: string[] = []
  let c = '', q = false
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i]
    if (ch === '"') { if (q && linea[i + 1] === '"') { c += '"'; i++ } else q = !q }
    else if (ch === sep && !q) { out.push(c); c = '' }
    else c += ch
  }
  return [...out, c].map((s) => s.trim())
}

function fechaDe(s: string): string | null {
  const t = s.trim().slice(0, 10)
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/), a, mes, d
  if (m) [a, mes, d] = [m[1], m[2], m[3]]
  else if ((m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/))) [d, mes, a] = [m[1], m[2], m[3].length === 2 ? '20' + m[3] : m[3]]
  else if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) [a, mes, d] = [m[1], m[2], m[3]]
  else return null
  const f = new Date(+a!, +mes! - 1, +d!)
  return f.getFullYear() === +a! && f.getMonth() === +mes! - 1 && f.getDate() === +d! ? `${a}-${mes!.padStart(2, '0')}-${d!.padStart(2, '0')}` : null
}

// igual que el servidor, pero exige que parezca un monto: un texto como «G42 PROVEEDOR 42» no es un valor
function valorDe(txt: string): number | null {
  const raw = txt.trim()
  if (!/^[\s$()+-]*(cop\s*)?\d[\d.,\s]*[\s$()]*(cr|db)?$/i.test(raw)) return null
  let t = raw.replace(/[^\d,.-]/g, '')
  const neg = t.startsWith('-') || raw.startsWith('(')
  t = t.replace(/-/g, '')
  const puntos = (t.match(/\./g) || []).length
  if (t.includes(',') && t.includes('.')) { const dec = t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.'; t = t.split(dec === ',' ? '.' : ',').join('').replace(dec, '.') }
  else if (t.includes(',')) { const p = t.split(','); t = p.length === 2 && p[1].length <= 2 ? t.replace(',', '.') : p.join('') }
  else if (puntos > 1 || (puntos === 1 && t.split('.')[1].length === 3)) t = t.split('.').join('')
  const v = parseFloat(t)
  return Number.isNaN(v) ? null : neg ? -v : v
}

// Adivina el encabezado y qué columna es cada dato, por el nombre y por lo que contiene
function adivinar(filas: string[][]) {
  const cab = filas[0].every((c) => !fechaDe(c) && valorDe(c) === null)
  const datos = filas.slice(cab ? 1 : 0, 14)
  const n = Math.max(...filas.map((f) => f.length))
  const col = (k: number) => datos.map((f) => f[k] ?? '')
  const pct = (k: number, ok: (s: string) => boolean) => col(k).filter(ok).length / (datos.length || 1)
  const nombre = (re: RegExp) => (cab ? filas[0].findIndex((c) => re.test(c.toLowerCase())) : -1)
  const rango = Array.from({ length: n }, (_, k) => k)
  const esFecha = (k: number) => pct(k, (s) => !!fechaDe(s)) >= 0.6
  const esValor = (k: number) => pct(k, (s) => !fechaDe(s) && valorDe(s) !== null) >= 0.6
  const roles: Record<number, Rol> = {}
  const f = [nombre(/fecha|date/), ...rango.filter(esFecha)].find((k) => k >= 0 && esFecha(k)) ?? -1
  if (f >= 0) roles[f] = 'fecha'
  const v = [nombre(/valor|monto|importe|movimiento/), ...rango.filter((k) => esValor(k) && !/saldo/i.test(cab ? filas[0][k] : ''))]
    .find((k) => k >= 0 && k !== f && esValor(k)) ?? -1
  if (v >= 0) roles[v] = 'valor'
  const texto = rango.filter((k) => k !== f && k !== v && !esValor(k) && !esFecha(k))
  const d = [nombre(/desc|concepto|detalle/), ...texto.sort((a, b) => col(b).join('').length - col(a).join('').length)].find((k) => k >= 0 && k !== f && k !== v) ?? -1
  if (d >= 0) roles[d] = 'desc'
  return { cab, roles }
}

function Pasos({ paso }: { paso: number }) {
  const t = ['Cargar el extracto', 'Revisar el cruce', 'Confirmar']
  return <div className="conc-pasos">{t.map((x, k) => (
    <div key={k} className={`conc-paso ${k < paso ? 'hecho' : k === paso ? 'activo' : ''}`}><b>{k < paso ? <CheckCheck size={14} /> : k + 1}</b>{x}</div>))}</div>
}

function DetalleConciliacion({ id, cerrar }: { id: number; cerrar: () => void }) {
  const { d, error } = useApi<Datos>(`/api/conciliacion/detalle?id=${id}`)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [cerrar])
  const h = d?.conciliacion
  return (
    <div className="modal-fondo visible" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="modal ancho extra" role="dialog" aria-modal="true">
        <div className="modal-cab"><h2>Conciliación N° {id}{h ? ` · ${h.banco || 'Banco'}` : ''}</h2><button className="icono" type="button" onClick={cerrar}><X /></button></div>
        <div className="modal-cuerpo">
          {!d ? <p>{error || 'Cargando…'}</p> : (
            <>
              <div className="conc-chips">
                <span className="chip">{fecha(h.fecha)}</span><span className="chip"><FileSpreadsheet size={12} /> {h.archivo || 'sin archivo'}</span>
                <span className="chip">{h.usuario}</span><span className="chip">{d.registros.length} de {h.movimientos} movimientos</span>
              </div>
              <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)', margin: '12px 0' }}>
                <Kpi et="Entradas" va={pesos(d.totales.ingresos)} sub="Recibos de compradores" c="#17A974" />
                <Kpi et="Salidas" va={pesos(d.totales.egresos)} sub="Gastos y comisiones" c="#DC2626" />
                <Kpi et="Neto" va={pesos(d.totales.neto)} sub="Entradas − salidas" c="#64748B" />
              </div>
              {!d.registros.length ? <Vacio Ic={Landmark} t="No se encontraron registros asociados a esta conciliación." /> : (
                <table className="mini-tabla"><thead><tr><th>Fecha</th><th>Tipo</th><th>Registro</th><th>Medio</th><th className="d">Valor</th></tr></thead>
                  <tbody>{d.registros.map((x: Datos) => (
                    <tr key={x.tabla + x.id}><td>{fecha(x.fecha)}</td><td><span className={`chip conc-${x.valor > 0 ? 'in' : 'out'}`}>{TIPO_REG[x.tabla]}</span></td>
                      <td>{reg(x)}</td><td>{x.medio} {x.referencia}</td><td className="d">{pesos(x.valor)}</td></tr>))}</tbody></table>)}
            </>)}
        </div>
        <div className="modal-pie"><button type="button" className="btn sec" onClick={cerrar}>Cerrar</button></div>
      </div>
    </div>
  )
}

export default function Conciliacion() {
  const { d: r, error, recargar } = useApi<Datos>('/api/conciliacion')
  const [vista, setVista] = useState<'conciliar' | 'historial'>('conciliar')
  const [banco, setBanco] = useState('')
  const [ext, setExt] = useState<{ texto: string; nombre: string; filas: string[][] } | null>(null)
  const [cab, setCab] = useState(true)
  const [roles, setRoles] = useState<Record<number, Rol>>({})
  const [cruce, setCruce] = useState<Datos | null>(null)
  const [sel, setSel] = useState<boolean[]>([])
  const [tab, setTab] = useState('pares')
  const [hecha, setHecha] = useState<{ id: number; n: number } | null>(null)
  const [ver, setVer] = useState<number | null>(null)
  const [busca, setBusca] = useState('')
  const [sobre, setSobre] = useState(false)

  const col = (rol: Rol) => Number(Object.keys(roles).find((k) => roles[+k] === rol) ?? -1)
  const lectura = useMemo(() => {
    if (!ext) return null
    const [cf, cv] = [col('fecha'), col('valor')]
    const filas = ext.filas.slice(cab ? 1 : 0)
    const movs = cf < 0 || cv < 0 ? [] : filas.map((f) => ({ f: fechaDe(f[cf] ?? ''), v: valorDe(f[cv] ?? '') })).filter((m): m is { f: string; v: number } => !!m.f && m.v !== null && m.v !== 0)
    const fechas = movs.map((m) => m.f).sort()
    return { n: Math.max(...ext.filas.map((f) => f.length)), total: filas.length, ok: movs.length, ini: fechas[0], fin: fechas[fechas.length - 1],
      entra: movs.filter((m) => m.v > 0).reduce((s, m) => s + m.v, 0), sale: -movs.filter((m) => m.v < 0).reduce((s, m) => s + m.v, 0) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext, cab, roles])

  if (!r) return <Cargando error={error} />

  async function leerArchivo(f: File) {
    let texto: string
    if (/\.xls[xm]$/i.test(f.name)) {
      try {
        const contenido = await new Promise<string>((ok, mal) => { const l = new FileReader(); l.onload = () => ok(l.result as string); l.onerror = mal; l.readAsDataURL(f) })
        texto = (await api<{ texto: string }>('/api/conciliacion/xlsx', { nombre: f.name, contenido })).texto
      } catch (x) { falla(x); return }
    } else if (/\.xls$/i.test(f.name)) { aviso('El formato .xls (Excel antiguo) no se lee: guárdelo como .xlsx'); return }
    else texto = await f.text()
    if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(await f.arrayBuffer())
    const lineas = texto.split(/\r?\n/).filter((x) => x.trim())
    if (!lineas.length) { aviso('El archivo está vacío'); return }
    const sep = [';', ',', '\t', '|'].map((s) => [s, (lineas[0].match(new RegExp(s === '|' ? '\\|' : s, 'g')) || []).length] as const).sort((a, b) => b[1] - a[1])[0][0]
    const filas = lineas.slice(0, 40).map((l) => partir(l, sep))
    const g = adivinar(filas)
    setExt({ texto, nombre: f.name, filas }); setCab(g.cab); setRoles(g.roles); setCruce(null); setHecha(null)
  }
  const cambiarRol = (k: number, rol: Rol | '') => {
    const nuevo = Object.fromEntries(Object.entries(roles).filter(([, v]) => v !== rol)) as Record<number, Rol>
    if (rol) nuevo[k] = rol; else delete nuevo[k]
    setRoles(nuevo)
  }
  const reiniciar = () => { setExt(null); setCruce(null); setHecha(null); setSel([]) }

  async function analizar() {
    try {
      const x = await api<Datos>('/api/conciliacion/analizar', { texto: ext!.texto, col_fecha: col('fecha'), col_valor: col('valor'), col_desc: col('desc'), encabezado: cab })
      setCruce(x); setSel(x.pares.map(() => true)); setTab(x.pares.length ? 'pares' : x.sin_registro.length ? 'sin_registro' : x.sin_extracto.length ? 'sin_extracto' : 'ya')
    } catch (e) { falla(e) }
  }
  async function confirmar() {
    const pares = cruce!.pares.filter((_: Datos, k: number) => sel[k]).map((p: Datos) => ({ tabla: p.registro.tabla, id: p.registro.id }))
    try {
      const x = await api<Datos>('/api/conciliacion/confirmar', { pares, banco, archivo: ext!.nombre, movimientos: cruce!.movimientos })
      setHecha({ id: x.id, n: x.conciliados }); setCruce(null); setExt(null); recargar()
    } catch (e) { falla(e) }
  }

  const elegidos: Datos[] = cruce ? cruce.pares.filter((_: Datos, k: number) => sel[k]) : []
  const entra = elegidos.filter((p) => p.movimiento.valor > 0).reduce((s, p) => s + p.movimiento.valor, 0)
  const sale = -elegidos.filter((p) => p.movimiento.valor < 0).reduce((s, p) => s + p.movimiento.valor, 0)
  const falta = !ext ? '' : col('fecha') < 0 ? 'Indique cuál columna es la Fecha.' : col('valor') < 0 ? 'Indique cuál columna es el Valor.'
    : !lectura!.ok ? 'No se reconoció ningún movimiento: revise que «Fecha» sea la columna de fechas y «Valor» la de montos.' : !banco.trim() ? 'Escriba el banco del extracto.' : ''
  const poco = !!lectura && lectura.ok > 0 && lectura.ok < lectura.total * 0.8
  const hist = (r.historial as Datos[]).filter((h) => `${h.id} ${h.banco} ${h.archivo} ${h.usuario}`.toLowerCase().includes(busca.toLowerCase()))
  const tabs: [string, string, number][] = cruce ? [['pares', 'Coinciden', cruce.pares.length], ['sin_registro', 'En el banco, sin registro', cruce.sin_registro.length],
    ['ya', 'Ya conciliados', cruce.ya_conciliados.length], ['sin_extracto', 'Registrados, no en el banco', cruce.sin_extracto.length]] : []

  return (
    <div className="pagina">
      <div className="pagina-cab"><div><h1>Conciliación bancaria</h1>
        <p>Compare el extracto de su banco con los recibos, gastos y pagos de comisión registrados, y deje constancia de lo que ya está verificado.</p></div>
        <div className="segmento conc-vista">
          <button className={vista === 'conciliar' ? 'activo' : ''} onClick={() => setVista('conciliar')}><GitCompare size={14} /> Conciliar</button>
          <button className={vista === 'historial' ? 'activo' : ''} onClick={() => setVista('historial')}><ScrollText size={14} /> Historial ({r.historial.length})</button>
        </div></div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <Kpi et="Recibos conciliados" va={fmtN.format(r.pagos_conciliados)} sub="Confirmados contra el banco" c="#17A974" />
        <Kpi et="Recibos por conciliar" va={fmtN.format(r.pagos_pendientes)} sub="Transferencias y consignaciones" c="#F5B841" rojo={!!r.pagos_pendientes} />
        <Kpi et="Egresos por conciliar" va={fmtN.format(r.egresos_pendientes)} sub="Gastos y comisiones no en efectivo" c="#DC2626" />
      </div>

      {vista === 'conciliar' && (<>
        <Pasos paso={hecha ? 3 : cruce ? 1 : 0} />
        {hecha && (
          <div className="tarjeta conc-exito"><CircleCheck size={34} />
            <div><h3>Conciliación N° {hecha.id} guardada</h3><p>{hecha.n} registros quedaron marcados como conciliados.</p></div>
            <button className="btn sec" onClick={() => setVer(hecha.id)}><Eye />Ver detalle</button>
            <button className="btn pri" onClick={reiniciar}><RotateCcw />Conciliar otro extracto</button></div>)}

        {!cruce && !hecha && (
          <div className="tarjeta"><h3>1. Cargue el extracto del banco</h3>
            <div className="conc-fila">
              <label className={`conc-zona ${sobre ? 'sobre' : ''} ${ext ? 'lleno' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setSobre(true) }} onDragLeave={() => setSobre(false)}
                onDrop={(e) => { e.preventDefault(); setSobre(false); const f = e.dataTransfer.files[0]; if (f) void leerArchivo(f) }}>
                {ext ? <FileSpreadsheet size={26} /> : <Upload size={26} />}
                <b>{ext ? ext.nombre : 'Suelte aquí el extracto o haga clic para elegirlo'}</b>
                <small>{ext ? 'Haga clic para cambiar de archivo' : 'Excel (.xlsx) o CSV, con fecha, valor y descripción de cada movimiento'}</small>
                <input type="file" accept=".csv,.txt,.xlsx,.xlsm" onChange={(e) => { const f = e.target.files?.[0]; if (f) void leerArchivo(f); e.target.value = '' }} /></label>
              <label className="campo"><span>Banco del extracto</span>
                <input type="text" list="conc-bancos" placeholder="Ej. Bancolombia" value={banco} onChange={(e) => setBanco(e.target.value)} />
                <datalist id="conc-bancos">{BANCOS.map((b) => <option key={b} value={b} />)}</datalist></label>
            </div>
            {ext && lectura && (
              <div style={{ marginTop: 16 }}>
                <div className="bloque-tit" style={{ marginBottom: 6 }}>2. Confirme qué es cada columna</div>
                <p className="ley-ayuda" style={{ margin: '0 0 8px' }}>Las detectamos automáticamente. Si alguna está mal, cámbiela con el menú de arriba de cada columna.</p>
                <label className="conc-chk"><input type="checkbox" checked={cab} onChange={(e) => setCab(e.target.checked)} /> La primera fila es el encabezado</label>
                <div className="conc-prev"><table className="mini-tabla">
                  <thead><tr>{Array.from({ length: lectura.n }, (_, k) => (
                    <th key={k}><select className={roles[k] ? 'asig' : ''} value={roles[k] ?? ''} onChange={(e) => cambiarRol(k, e.target.value as Rol | '')}>
                      <option value="">— Ignorar —</option>{ROLES_COL.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></th>))}</tr></thead>
                  <tbody>{ext.filas.slice(0, 7).map((f, i) => (
                    <tr key={i} className={cab && i === 0 ? 'conc-cab' : ''}>{Array.from({ length: lectura.n }, (_, k) => <td key={k} className={roles[k] ? 'r-' + roles[k] : ''}>{f[k]}</td>)}</tr>))}</tbody></table></div>
                <div className={`conc-estado ${falta ? 'no' : poco ? 'ojo' : 'si'}`}>
                  {falta ? <><TriangleAlert size={16} /> {falta}</> : <><CircleCheck size={16} /> <span><b>{lectura.ok} movimientos reconocidos</b> del {fecha(lectura.ini)} al {fecha(lectura.fin)} · entradas {pesos(lectura.entra)} · salidas {pesos(lectura.sale)}
                    {poco && <> · <b>{lectura.total - lectura.ok} filas se ignorarán</b> (sin fecha o sin valor)</>}</span></>}
                </div>
                <button className="btn pri" style={{ marginTop: 12 }} disabled={!!falta} onClick={analizar}><GitCompare />Cruzar con lo registrado<ArrowRight size={16} /></button>
              </div>)}
          </div>)}

        {cruce && (<>
          <div className={`conc-estado grande ${cruce.pares.length === cruce.movimientos ? 'si' : cruce.pares.length ? 'ojo' : 'no'}`}>
            {cruce.pares.length === cruce.movimientos ? <><CircleCheck size={20} /> <span><b>Todo cuadra:</b> los {cruce.movimientos} movimientos del extracto tienen su registro.</span></>
              : cruce.pares.length ? <><TriangleAlert size={20} /> <span><b>{cruce.pares.length} de {cruce.movimientos} movimientos coinciden.</b> Revise las demás pestañas antes de confirmar.</span></>
                : <><TriangleAlert size={20} /> <span><b>Ningún movimiento coincidió.</b> Si no es lo esperado, revise las columnas de Fecha y Valor.</span>
                  <button className="btn sec" onClick={() => setCruce(null)}>Volver a las columnas</button></>}
          </div>
          <div className="tarjeta">
            <h3>2. Revise el cruce · {cruce.movimientos} movimientos del {fecha(cruce.periodo[0])} al {fecha(cruce.periodo[1])}</h3>
            <div className="segmento conc-tabs">{tabs.map(([k, t, n]) => <button key={k} className={tab === k ? 'activo' : ''} onClick={() => setTab(k)}>{t} <span className="badge-n">{n}</span></button>)}</div>

            {tab === 'pares' && (!cruce.pares.length ? <Vacio Ic={Landmark} t="Ningún movimiento del extracto coincide con un registro." /> : (
              <div className="conc-tabla"><table className="mini-tabla"><thead><tr>
                <th><input type="checkbox" title="Marcar o desmarcar todos" checked={sel.every(Boolean)} onChange={(e) => setSel(sel.map(() => e.target.checked))} /></th>
                <th>Fecha banco</th><th>Descripción del banco</th><th className="d">Valor</th><th>Registro en el sistema</th><th>Diferencia</th></tr></thead>
                <tbody>{cruce.pares.map((p: Datos, k: number) => {
                  const dd = dias(p.movimiento.fecha, p.registro.fecha)
                  return (
                    <tr key={k} className={sel[k] ? '' : 'conc-off'}><td><input type="checkbox" checked={sel[k]} onChange={(e) => setSel(sel.map((s, i) => (i === k ? e.target.checked : s)))} /></td>
                      <td>{fecha(p.movimiento.fecha)}</td><td>{p.movimiento.descripcion}</td><td className="d">{pesos(p.movimiento.valor)}</td>
                      <td><span className={`chip conc-${p.movimiento.valor > 0 ? 'in' : 'out'}`}>{TIPO_REG[p.registro.tabla]}</span> {reg(p.registro)}</td>
                      <td>{dd ? <span className="conc-dif">{dd} {dd === 1 ? 'día' : 'días'}</span> : <span className="conc-igual">mismo día</span>}</td></tr>)
                })}</tbody></table></div>))}

            {tab === 'sin_registro' && (<>
              <p className="ley-ayuda">Están en el banco pero no tienen recibo, gasto o comprobante. Regístrelos y vuelva a cruzar.</p>
              {!cruce.sin_registro.length ? <Vacio Ic={CircleCheck} t="Todos los movimientos del banco tienen registro." /> : (
                <div className="conc-tabla"><table className="mini-tabla"><tbody>{cruce.sin_registro.map((m: Datos, k: number) => (
                  <tr key={k}><td>{fecha(m.fecha)}</td><td>{m.descripcion}</td><td className="d">{pesos(m.valor)}</td>
                    <td>{m.valor > 0 ? 'Entrada: ¿pago de un comprador sin recibo?' : 'Salida sin comprobante de egreso'}</td></tr>))}</tbody></table></div>)}</>)}

            {tab === 'ya' && (!cruce.ya_conciliados.length ? <Vacio Ic={Landmark} t="Ningún movimiento estaba conciliado antes." /> : (
              <div className="conc-tabla"><table className="mini-tabla"><thead><tr><th>Fecha banco</th><th>Descripción del banco</th><th className="d">Valor</th><th>Registro</th><th>Conciliado en</th></tr></thead>
                <tbody>{cruce.ya_conciliados.map((p: Datos, k: number) => (
                  <tr key={k}><td>{fecha(p.movimiento.fecha)}</td><td>{p.movimiento.descripcion}</td><td className="d">{pesos(p.movimiento.valor)}</td>
                    <td>{reg(p.registro)}</td><td><small>{p.registro.conciliacion_ref}</small></td></tr>))}</tbody></table></div>))}

            {tab === 'sin_extracto' && (<>
              <p className="ley-ayuda">Están registrados en el periodo pero el banco no los muestra. Revise si el dinero ya entró o salió realmente.</p>
              {!cruce.sin_extracto.length ? <Vacio Ic={CircleCheck} t="Todo lo registrado aparece en el banco." /> : (
                <div className="conc-tabla"><table className="mini-tabla"><tbody>{cruce.sin_extracto.map((x: Datos, k: number) => (
                  <tr key={k}><td>{fecha(x.fecha)}</td><td><span className="chip">{TIPO_REG[x.tabla]}</span> {reg(x)}</td><td className="d">{pesos(Math.abs(x.valor))}</td><td>{x.medio} {x.referencia}</td></tr>))}</tbody></table></div>)}</>)}
          </div>
          <div className="conc-barra">
            <div><b>{elegidos.length}</b> de {cruce.pares.length} seleccionados · entradas <b>{pesos(entra)}</b> · salidas <b>{pesos(sale)}</b></div>
            <button className="btn sec" onClick={reiniciar}>Cancelar</button>
            <button className="btn acento" disabled={!elegidos.length} onClick={confirmar}><CheckCheck />Confirmar conciliación ({elegidos.length})</button>
          </div>
        </>)}
      </>)}

      {vista === 'historial' && (
        <div className="tarjeta"><h3>Conciliaciones realizadas</h3>
          {!r.historial.length ? <Vacio Ic={Landmark} t="Aún no se ha conciliado ningún extracto." /> : (<>
            <input className="conc-busca" type="search" placeholder="Buscar por número, banco, archivo o usuario…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <table className="datos"><thead><tr><th>N°</th><th>Fecha</th><th>Banco</th><th>Archivo</th><th className="d">Movimientos</th><th className="d">Conciliados</th><th>Usuario</th><th /></tr></thead>
              <tbody>{hist.map((h) => (
                <tr key={h.id} className="conc-fila-h" onClick={() => setVer(h.id)}><td><b>#{h.id}</b></td><td>{fecha(h.fecha)}</td><td>{h.banco}</td><td>{h.archivo}</td>
                  <td className="d">{h.movimientos}</td><td className="d">{h.conciliados}</td><td>{h.usuario}</td><td><button className="btn sec" onClick={(e) => { e.stopPropagation(); setVer(h.id) }}><Eye />Ver</button></td></tr>))}</tbody></table>
            {!hist.length && <Vacio Ic={Landmark} t="Ninguna conciliación coincide con la búsqueda." />}</>)}
        </div>)}
      {ver !== null && <DetalleConciliacion id={ver} cerrar={() => setVer(null)} />}
    </div>
  )
}
