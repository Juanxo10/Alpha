import { useState } from 'react'
import { Calculator, Car, FileSpreadsheet } from 'lucide-react'
import { fmtN, MESES, pesos, pesosCorto } from './formato'
import { FormPresupuesto } from './Gastos'
import { Cargando, Kpi, useApi, Vacio, type Datos } from './ui'

function Grafico({ f }: { f: Datos }) {
  const reales = f.meses.filter((m: Datos) => m.real), futuros = f.meses.filter((m: Datos) => m.mes > f.mes_actual)
  const rs = reales.slice(-12), ms: Datos[] = [...rs, ...futuros.slice(0, 12)]
  const W = 900, H = 230, pad = 34, bw = (W - pad) / Math.max(ms.length, 1)
  const mx = Math.max(1, ...ms.map((m) => Math.max(m.ingresos, m.egresos, m.proyectado)))
  const accs = ms.map((m) => (m.real ? m.acumulado : null))
  const amx = Math.max(1, ...accs.filter((x) => x !== null).map((x) => Math.abs(x as number)))
  const y = (v: number) => H - (v / mx) * (H - 20)
  const ya = (v: number) => H - ((v + amx) / (2 * amx)) * (H - 20)
  let linea = ''
  accs.forEach((v, k) => { if (v !== null) linea += `${linea ? 'L' : 'M'}${pad + k * bw + bw / 2},${ya(v)}` })
  const corte = pad + rs.length * bw
  return (
    <svg viewBox={`0 0 ${W} ${H + 28}`} width="100%" className="barras">
      {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1={pad} x2={W} y1={y(mx * g)} y2={y(mx * g)} stroke="#EBF0F1" />)}
      {ms.map((m, k) => { const x = pad + k * bw; return m.real ? (
        <g key={k}>
          <rect x={x + 4} y={y(m.ingresos)} width={bw / 2 - 5} height={H - y(m.ingresos)} rx="2" fill="#17A974"><title>{m.mes} ingresos {pesos(m.ingresos)}</title></rect>
          <rect x={x + bw / 2 + 1} y={y(m.egresos)} width={bw / 2 - 5} height={H - y(m.egresos)} rx="2" fill="#DC2626"><title>{m.mes} egresos {pesos(m.egresos)}</title></rect>
        </g>) : (
        <rect key={k} x={x + 6} y={y(m.proyectado)} width={bw - 12} height={H - y(m.proyectado)} rx="2" fill="#A7C4F2"><title>{m.mes} proyectado {pesos(m.proyectado)}</title></rect>) })}
      <path d={linea} fill="none" stroke="#0C2E37" strokeWidth="2.5" />
      {ms.map((m, k) => <text key={k} x={pad + k * bw + bw / 2} y={H + 18} textAnchor="middle">{MESES[+m.mes.slice(5) - 1]}{m.mes.slice(5) === '01' ? ' ' + m.mes.slice(2, 4) : ''}</text>)}
      <line x1={corte} x2={corte} y1="0" y2={H} stroke="#82959A" strokeDasharray="4 3" />
      <text x={corte + 4} y="12">proyección →</text>
    </svg>
  )
}

export default function Flujo() {
  const { d: f, error, recargar } = useApi<Datos>('/api/flujo')
  const [presup, setPresup] = useState(false)
  if (!f) return <Cargando error={error} />
  const i = f.indicadores
  const pr = f.presupuesto.filter((p: Datos) => p.presupuesto || p.ejecutado)
  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div><h1>Flujo de caja y resultado del proyecto</h1><p>Lo que entró y salió mes a mes, lo que falta por recaudar según los planes de pago y el resultado esperado.</p></div>
        <div className="botones">
          <a className="btn sec" href="/api/exportar/flujo.csv"><FileSpreadsheet />Exportar</a>
          <button className="btn sec" onClick={() => setPresup(true)}><Calculator />Presupuesto</button>
        </div>
      </div>
      <div className="kpis">
        <Kpi et="Ingresos recaudados" va={pesosCorto(i.ingresos)} sub="Pagos de compradores" c="#17A974" />
        <Kpi et="Egresos" va={pesosCorto(i.egresos)} sub={`Gastos y comisiones (${pesosCorto(i.egresos_comisiones)})`} c="#DC2626" />
        <Kpi et="Caja del proyecto" va={pesosCorto(i.caja)} sub="Ingresos − egresos" c="#0C2E37" rojo={i.caja < 0} />
        <Kpi et="Por recaudar" va={pesosCorto(i.por_recaudar)} sub={`${pesosCorto(f.vencido_por_recaudar)} ya vencido`} c="#3B82F6" />
        <Kpi et="Inventario a precio de lista" va={pesosCorto(i.inventario)} sub="Lotes disponibles" c="#5CE9AB" />
        <Kpi et="Resultado proyectado" va={pesosCorto(i.resultado_proyectado)} sub="Si se vende y recauda todo" c="#8B5CF6" rojo={i.resultado_proyectado < 0} />
      </div>
      {(i.recibido_en_especie > 0 || i.bienes_inventario > 0 || i.ventas_bienes > 0) && (
        <div className="tarjeta nf-flujo" style={{ marginBottom: 16 }}><h3><Car /> Bienes recibidos como pago</h3>
          <div className="nf-flujo-g">
            <div><small>Recibido en especie</small><b>{pesos(i.recibido_en_especie)}</b><span>Abonado a lotes, no es dinero: no está en los ingresos ni en la caja</span></div>
            <div><small>Bienes vendidos</small><b>{pesos(i.ventas_bienes)}</b><span>Dinero que sí entró a la caja (neto de costos)</span></div>
            <div><small>Bienes en inventario</small><b>{pesos(i.bienes_inventario)}</b><span>Sumados al resultado proyectado por su valor de recibo</span></div></div></div>)}
      <div className="grilla-tablero" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="tarjeta"><h3>Ingresos y egresos por mes · recaudo proyectado</h3><Grafico f={f} />
          <div className="dona-ley" style={{ flexDirection: 'row', gap: 18, marginTop: 8 }}>
            <div><i style={{ background: '#17A974' }} />Ingresos</div><div><i style={{ background: '#DC2626' }} />Egresos</div>
            <div><i style={{ background: '#A7C4F2' }} />Recaudo proyectado</div><div><i style={{ background: '#0C2E37', height: 3 }} />Caja acumulada</div>
          </div></div>
        <div className="tarjeta"><h3>Cómo se calcula el resultado</h3>
          <table className="mini-tabla"><tbody>
            <tr><td>Recaudado a la fecha</td><td className="d">{pesos(i.ingresos)}</td></tr>
            <tr><td>+ Por recaudar (planes de pago)</td><td className="d">{pesos(i.por_recaudar)}</td></tr>
            <tr><td>+ Inventario a precio de lista</td><td className="d">{pesos(i.inventario)}</td></tr>
            <tr><td>− Egresos ejecutados</td><td className="d">{pesos(i.egresos)}</td></tr>
            <tr><td>− Presupuesto por ejecutar</td><td className="d">{pesos(i.presupuesto_pendiente)}</td></tr>
            <tr><td>− Comisiones por pagar</td><td className="d">{pesos(i.comisiones_pendientes)}</td></tr>
            <tr style={{ fontWeight: 700 }}><td>= Resultado proyectado</td><td className="d">{pesos(i.resultado_proyectado)}</td></tr>
          </tbody></table>
          <div className="ley-ayuda" style={{ padding: '8px 0 0' }}>Para que sea fiel, registre todos los gastos y cargue el presupuesto pendiente de obra.</div></div>
        <div className="tarjeta ancha"><h3>Presupuesto vs. ejecutado</h3>
          {!pr.length ? <Vacio Ic={Calculator} t="Cargue el presupuesto de obra y gastos con el botón «Presupuesto»." /> : (
            <table className="datos"><thead><tr><th>Categoría</th><th className="d">Presupuesto</th><th className="d">Ejecutado</th><th style={{ width: 240 }}>Avance</th><th className="d">Por ejecutar</th></tr></thead>
              <tbody>{pr.map((p: Datos) => { const a = p.presupuesto ? Math.min((100 * p.ejecutado) / p.presupuesto, 999) : null; return (
                <tr key={p.categoria}><td>{p.categoria}</td><td className="d">{p.presupuesto ? pesos(p.presupuesto) : '—'}</td><td className="d">{pesos(p.ejecutado)}</td>
                  <td>{a === null ? <span className="ley-ayuda" style={{ padding: 0 }}>Sin presupuesto</span> : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 7, borderRadius: 4, background: '#EEF2F3', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(a, 100)}%`, background: a > 100 ? '#DC2626' : '#17A974' }} /></div>
                      <span className="num" style={{ fontSize: 12, width: 44, textAlign: 'right' }}>{fmtN.format(a)}%</span></div>)}</td>
                  <td className="d">{p.presupuesto ? pesos(Math.max(p.presupuesto - p.ejecutado, 0)) : '—'}</td></tr>) })}</tbody></table>)}
        </div>
        <div className="tarjeta ancha"><h3>Detalle mensual</h3>
          <div className="tabla-wrap"><table className="datos"><thead><tr><th>Mes</th><th className="d">Ingresos</th><th className="d">Egresos</th><th className="d">Neto</th><th className="d">Caja acumulada</th><th className="d">Recaudo proyectado</th></tr></thead>
            <tbody>{f.meses.filter((m: Datos) => m.real || m.proyectado).map((m: Datos) => (
              <tr key={m.mes} style={m.mes === f.mes_actual ? { fontWeight: 700 } : undefined}>
                <td>{MESES[+m.mes.slice(5) - 1]} {m.mes.slice(0, 4)}{m.mes === f.mes_actual ? ' (actual)' : ''}</td>
                <td className="d">{m.real ? pesos(m.ingresos) : '—'}</td><td className="d">{m.real ? pesos(m.egresos) : '—'}</td><td className="d">{m.real ? pesos(m.neto) : '—'}</td>
                <td className="d">{m.real ? pesos(m.acumulado) : '—'}</td><td className="d">{m.proyectado ? pesos(m.proyectado) : '—'}</td></tr>))}</tbody></table></div></div>
      </div>
      {presup && <FormPresupuesto cerrar={() => setPresup(false)} listo={recargar} />}
    </div>
  )
}
