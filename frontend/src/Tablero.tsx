import { Printer } from 'lucide-react'
import { imprimirInforme } from './imprimir'
import type { Lote } from './tipos'
import { useEffect, useState } from 'react'
import {
  AlertTriangle, BadgeDollarSign, CalendarCheck, CalendarClock, FileSignature, Landmark, MapPinned, Receipt, Wallet,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { api } from './api'
import { ESTADOS, MESES, fecha, fechaLarga, fmtN, fmtN1, pesos, pesosCorto } from './formato'

interface Manzana {
  manzana: number; lotes: number; disponibles: number; separados: number; vendidos: number
  valor_venta: number; pagado: number; saldo: number; en_mora: number
}
interface Resumen {
  fecha: string; total_lotes: number; area_total_m2: number; area_vendida_m2: number
  conteo: Record<string, number>; valor_vendido: number; valor_separado: number; recaudado: number
  cartera: number; vencido: number; lotes_mora: number; inventario_valor: number; disponibles_sin_precio: number
  serie_recaudo: { mes: string; valor: number }[]
  mora_rangos: Record<'MORA_30' | 'MORA_90' | 'MORA_MAS_90', { n: number; valor: number }>
  manzanas: Manzana[]
  recientes: { recibo: number; cliente: string; id_lote: string; fecha: string; medio: string; valor: number }[]
  proximos: { cliente: string; id_lote: string; fecha: string; valor: number }[]
  comisiones?: { comisionistas: { id: number; nombre: string; ventas: number; pagado: number; por_pagar: number }[]
    totales: { generado?: number; pagado?: number; por_pagar?: number } }
}

function Kpi(p: { et: string; va: string; sub: string; color: string; Ic: ComponentType; rojo?: boolean }) {
  return (
    <div className={`kpi ${p.rojo ? 'rojo' : ''}`} style={{ '--c': p.color } as React.CSSProperties}>
      <div className="et"><p.Ic />{p.et}</div><div className="va">{p.va}</div><div className="sub">{p.sub}</div>
    </div>
  )
}

function Dona({ r, vendidos }: { r: Resumen; vendidos: number }) {
  const R = 62, C = 2 * Math.PI * R
  let acum = 0
  return (
    <div className="dona-wrap">
      <svg width="160" height="160" viewBox="0 0 160 160">
        {Object.entries(ESTADOS).filter(([k]) => r.conteo[k]).map(([k, v]) => {
          const f = r.conteo[k] / r.total_lotes
          const el = <circle key={k} r={R} cx="80" cy="80" fill="none" stroke={v.c} strokeWidth="26"
            strokeDasharray={`${f * C} ${C}`} strokeDashoffset={-acum * C} transform="rotate(-90 80 80)" />
          acum += f
          return el
        })}
        <text x="80" y="76" textAnchor="middle" style={{ font: '600 24px Lexend', fill: '#0C2E37' }}>{fmtN1.format((100 * vendidos) / r.total_lotes)}%</text>
        <text x="80" y="96" textAnchor="middle" style={{ font: '12px Cabin', fill: '#82959A' }}>vendido</text>
      </svg>
      <div className="dona-ley">
        {Object.entries(ESTADOS).map(([k, v]) => <div key={k}><i style={{ background: v.c }} />{v.nom}<b>{fmtN.format(r.conteo[k] || 0)}</b></div>)}
      </div>
    </div>
  )
}

function rellenarMeses(serie: Resumen['serie_recaudo'], n: number) {
  const mapa = Object.fromEntries(serie.map((s) => [s.mes, s.valor]))
  const hoy = new Date()
  return Array.from({ length: n }, (_, j) => {
    const t = new Date(hoy.getFullYear(), hoy.getMonth() - (n - 1 - j), 1)
    const k = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
    return { etq: MESES[t.getMonth()], valor: mapa[k] || 0 }
  })
}

function Barras({ serie }: { serie: Resumen['serie_recaudo'] }) {
  const s = rellenarMeses(serie, 12)
  const mx = Math.max(...s.map((x) => x.valor), 1) * 1.12, W = 380, H = 170, bw = W / s.length
  return (
    <svg className="barras" viewBox={`0 0 ${W} ${H + 34}`} width="100%">
      {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1="0" x2={W} y1={H - g * H + 14} y2={H - g * H + 14} stroke="#EBF0F1" />)}
      {s.map((x, i) => {
        const h = (x.valor / mx) * H
        return (
          <g key={i}>
            <rect x={i * bw + 5} y={H - h + 14} width={bw - 10} height={Math.max(h, x.valor ? 2 : 0)} rx="3"
              fill={i === s.length - 1 ? '#5CE9AB' : '#0C2E37'}><title>{x.etq}: {pesos(x.valor)}</title></rect>
            {x.valor > 0 && <text className="vtx" x={i * bw + bw / 2} y={H - h + 9} textAnchor="middle">{pesosCorto(x.valor).replace('$', '')}</text>}
            <text x={i * bw + bw / 2} y={H + 30} textAnchor="middle">{x.etq}</text>
          </g>
        )
      })}
    </svg>
  )
}

function Mora({ r, alDia }: { r: Resumen; alDia: number }) {
  const m = r.mora_rangos
  const filas: [string, number, number | null, string][] = [
    ['Al día', alDia, null, '#22C55E'], ['1 – 30 días', m.MORA_30.n, m.MORA_30.valor, '#FACC15'],
    ['31 – 90 días', m.MORA_90.n, m.MORA_90.valor, '#F97316'], ['Más de 90 días', m.MORA_MAS_90.n, m.MORA_MAS_90.valor, '#DC2626'],
  ]
  const mx = Math.max(...filas.map((f) => f[1]), 1)
  return (
    <>
      {filas.map(([et, n, val, col]) => (
        <div key={et} style={{ marginBottom: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
            <span>{et}</span><span className="num"><b>{fmtN.format(n)}</b> lotes{val !== null && ` · ${pesos(val)}`}</span>
          </div>
          <div style={{ height: 9, borderRadius: 5, background: '#EEF2F3', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(100 * n) / mx}%`, background: col, borderRadius: 5 }} />
          </div>
        </div>
      ))}
      <div className="ley-ayuda" style={{ padding: 0 }}>Edad de la cuota vencida más antigua de cada negocio.</div>
    </>
  )
}

const Vacio = ({ Ic, t }: { Ic: ComponentType; t: string }) => <div className="vacio"><Ic />{t}</div>

export default function Tablero({ config }: { config: Record<string, unknown> }) {
  const [r, setR] = useState<Resumen | null>(null)
  const [alDia, setAlDia] = useState(0)
  const [lotes, setLotes] = useState<Lote[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    api<Resumen>('/api/resumen').then(setR).catch((e) => setError(e.message))
    api<Lote[]>('/api/lotes').then((l) => { setLotes(l); setAlDia(l.filter((x) => x.cartera === 'AL_DIA').length) }).catch(() => {})
  }, [])
  if (error) return <div className="pagina"><p role="alert">{error}</p></div>
  if (!r) return <div className="pagina"><p>Cargando…</p></div>

  const c = r.conteo, vendidos = (c.VENDIDO || 0) + (c.PAGADO || 0) + (c.ESCRITURADO || 0), neg = r.valor_vendido
  const pctRec = neg + r.valor_separado ? (100 * r.recaudado) / (neg + r.valor_separado) : 0
  const coms = (r.comisiones?.comisionistas || []).filter((x) => x.por_pagar > 0.5).sort((a, b) => b.por_pagar - a.por_pagar).slice(0, 8)
  const t = r.comisiones?.totales
  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <h1>Tablero de ventas y cartera</h1>
          <p>Corte al {fechaLarga(r.fecha)} · {fmtN.format(r.total_lotes)} lotes · {fmtN1.format(r.area_total_m2 / 1e4)} ha vendibles</p>
        </div>
        <div className="botones"><button className="btn sec" onClick={() => imprimirInforme(r, lotes, config)}><Printer />Informe general</button></div>
      </div>
      <div className="kpis">
        <Kpi et="Lotes vendidos" va={fmtN.format(vendidos)} Ic={FileSignature} color="#3B82F6"
          sub={`${fmtN1.format((100 * vendidos) / r.total_lotes)} % del loteo · ${fmtN.format(c.SEPARADO || 0)} separados`} />
        <Kpi et="Valor vendido" va={pesosCorto(neg)} Ic={BadgeDollarSign} color="#0C2E37" sub={`${fmtN1.format(r.area_vendida_m2 / 1e4)} ha vendidas`} />
        <Kpi et="Recaudado" va={pesosCorto(r.recaudado)} Ic={Wallet} color="#17A974"
          sub={neg ? `${fmtN1.format(pctRec)} % de lo negociado` : 'Sin ventas aún'} />
        <Kpi et="Cartera por cobrar" va={pesosCorto(r.cartera)} Ic={Landmark} color="#8B5CF6" sub="Saldo de lotes vendidos" />
        <Kpi et="Cartera vencida" va={pesosCorto(r.vencido)} Ic={AlertTriangle} color="#DC2626" rojo={!!r.vencido}
          sub={`${fmtN.format(r.lotes_mora)} lotes en mora`} />
        <Kpi et="Inventario disponible" va={pesosCorto(r.inventario_valor)} Ic={MapPinned} color="#5CE9AB"
          sub={`${fmtN.format(c.DISPONIBLE || 0)} lotes${r.disponibles_sin_precio ? ` · ${fmtN.format(r.disponibles_sin_precio)} sin precio` : ''}`} />
      </div>
      <div className="grilla-tablero">
        <div className="tarjeta"><h3>Inventario por estado</h3><Dona r={r} vendidos={vendidos} /></div>
        <div className="tarjeta"><h3>Recaudo mensual</h3><Barras serie={r.serie_recaudo} /></div>
        <div className="tarjeta"><h3>Cartera vencida por edad</h3><Mora r={r} alDia={alDia} /></div>
        <div className="tarjeta ancha"><h3>Resumen por manzana</h3>
          <div className="tabla-wrap">
            <table className="datos">
              <thead><tr><th>Manzana</th><th className="d">Lotes</th><th className="d">Disponibles</th><th className="d">Separados</th>
                <th className="d">Vendidos</th><th style={{ width: 160 }}>% vendido</th><th className="d">Valor vendido</th>
                <th className="d">Recaudado</th><th className="d">Saldo</th><th className="d">En mora</th></tr></thead>
              <tbody>
                {r.manzanas.map((m) => {
                  const p = (100 * (m.vendidos + m.separados)) / m.lotes
                  return (
                    <tr key={m.manzana}>
                      <td><b>MZ {String(m.manzana).padStart(2, '0')}</b></td>
                      <td className="d">{m.lotes}</td><td className="d">{m.disponibles}</td>
                      <td className="d">{m.separados || '—'}</td><td className="d">{m.vendidos || '—'}</td>
                      <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 7, borderRadius: 4, background: '#EEF2F3', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${p}%`, background: '#3B82F6' }} /></div>
                        <span className="num" style={{ fontSize: 12, width: 38, textAlign: 'right' }}>{fmtN.format(p)}%</span></div></td>
                      <td className="d">{m.valor_venta ? pesos(m.valor_venta) : '—'}</td>
                      <td className="d">{m.pagado ? pesos(m.pagado) : '—'}</td>
                      <td className="d">{m.saldo ? pesos(m.saldo) : '—'}</td>
                      <td className="d">{m.en_mora ? <span className="rojo">{m.en_mora}</span> : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="tarjeta"><h3>Últimos pagos</h3>
          {r.recientes.length ? <div className="lista">{r.recientes.map((p) => (
            <div className="it" key={p.recibo}>
              <div className="ic"><Receipt /></div>
              <div className="q"><div><b>{p.cliente}</b></div><small>N° {p.recibo} · {p.id_lote} · {fecha(p.fecha)} · {p.medio}</small></div>
              <div className="v">{pesos(p.valor)}</div>
            </div>))}</div> : <Vacio Ic={Receipt} t="Aún no hay pagos registrados." />}
        </div>
        <div className="tarjeta"><h3>Cuotas próximas (30 días)</h3>
          {r.proximos.length ? <div className="lista">{r.proximos.map((p, i) => (
            <div className="it" key={i}>
              <div className="ic cal"><CalendarClock /></div>
              <div className="q"><div><b>{p.cliente}</b></div><small>{p.id_lote} · vence {fecha(p.fecha)}</small></div>
              <div className="v">{pesos(p.valor)}</div>
            </div>))}</div> : <Vacio Ic={CalendarCheck} t="No hay cuotas por vencer en los próximos 30 días." />}
        </div>
        <div className="tarjeta"><h3>Comisiones por pagar</h3>
          <div className="lista">{coms.length ? coms.map((x) => (
            <div className="it" key={x.id}>
              <div className="ic" style={{ background: '#F3EEFF', color: '#6B36D9' }}><Wallet /></div>
              <div className="q"><div><b>{x.nombre}</b></div><small>{x.ventas} ventas · pagado {pesosCorto(x.pagado)}</small></div>
              <div className="v">{pesos(x.por_pagar)}</div>
            </div>)) : <Vacio Ic={CalendarCheck} t="No hay comisiones causadas pendientes de pago." />}</div>
          {t?.generado ? <div className="ley-ayuda" style={{ padding: '8px 0 0' }}>
            Generadas {pesosCorto(t.generado)} · pagadas {pesosCorto(t.pagado ?? 0)} · por pagar {pesosCorto(t.por_pagar ?? 0)}</div> : null}
        </div>
      </div>
    </div>
  )
}
