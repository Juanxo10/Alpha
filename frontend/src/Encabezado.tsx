import { useState } from 'react'
import {
  Bell, ChevronDown, CircleHelp, Search, Settings, UserRound, Map, LayoutDashboard, Wallet, Handshake,
  Landmark, ShieldCheck, TableProperties, ReceiptText, PhoneCall, UserSearch, Users, ChartColumn, Receipt,
  GitCompare, ShieldAlert, UserCog, ScrollText, FileSignature, Layers, Car, Undo2,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { ESTADOS } from './formato'
import { Chip } from './Ficha'
import type { Lote } from './tipos'

export type Vista = string
type Item = { v: Vista; ic: ComponentType; t: string; s: string; solo?: string }
const GRUPOS: { ic: ComponentType; t: string; items: Item[] }[] = [
  { ic: Wallet, t: 'Cartera', items: [
    { v: 'cartera', ic: TableProperties, t: 'Cartera por lote', s: 'Saldo, mora y estado de cada lote' },
    { v: 'pagos', ic: ReceiptText, t: 'Libro de pagos', s: 'Recibos de caja por consecutivo' },
    { v: 'cobranza', ic: PhoneCall, t: 'Cobranza', s: 'A quién cobrar hoy, gestiones y compromisos' },
    { v: 'desistimientos', ic: Undo2, t: 'Desistimientos', s: 'Qué se retiene, qué se devuelve y hasta cuándo' }] },
  { ic: Handshake, t: 'Comercial', items: [
    { v: 'prospectos', ic: UserSearch, t: 'Prospectos', s: 'Interesados, seguimiento y embudo de ventas' },
    { v: 'comisionistas', ic: Users, t: 'Comisionistas', s: 'Comisiones generadas, causadas y pagadas' },
    { v: 'contratos', ic: FileSignature, t: 'Contratos', s: 'Promesas, otrosíes, actas y firmas' },
    { v: 'bloques', ic: Layers, t: 'Negocios en bloque', s: 'Un comprador, varios lotes y un solo plan' }] },
  { ic: Landmark, t: 'Finanzas', items: [
    { v: 'flujo', ic: ChartColumn, t: 'Flujo de caja', s: 'Ingresos, egresos, proyección y resultado' },
    { v: 'gastos', ic: Receipt, t: 'Gastos', s: 'Egresos del proyecto con comprobante' },
    { v: 'conciliacion', ic: GitCompare, t: 'Conciliación bancaria', s: 'Cruce con el extracto del banco' },
    { v: 'bienes', ic: Car, t: 'Bienes recibidos', s: 'Vehículos, inmuebles y permutas como pago' }] },
  { ic: ShieldCheck, t: 'Administración', items: [
    { v: 'aprobaciones', ic: ShieldAlert, t: 'Aprobaciones', s: 'Operaciones que esperan visto bueno de un dueño' },
    { v: 'usuarios', ic: UserCog, t: 'Usuarios', s: 'Quién entra y qué puede hacer', solo: 'DUENO' },
    { v: 'auditoria', ic: ScrollText, t: 'Auditoría', s: 'Bitácora sellada e integridad', solo: 'DUENO,CONSULTA' }] },
]
const ROLES: Record<string, string> = { DUENO: 'Dueño', OPERADOR: 'Asistente' }

const norm = (t?: string | null) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
function buscarLotes(lotes: Lote[], q: string) {
  const m = q.match(/^\s*(?:mz|m|manzana)?\s*0*(\d{1,2})\s*[-–\s.,/l]+\s*(?:l|lote)?\s*0*(\d{1,3})\s*$/i)
  if (m) {
    const id = `MZ${m[1].padStart(2, '0')}-L${m[2].padStart(3, '0')}`
    const l = lotes.find((x) => x.id_lote === id)
    if (l) return [l]
  }
  const qn = norm(q), qd = q.replace(/\D/g, '')
  return lotes.filter((l) => norm(l.id_lote).includes(qn) || norm(l.cliente).includes(qn) || (qd.length >= 4 && (l.documento || '').includes(qd)))
}

export default function Encabezado(p: {
  empresa: string; logo?: boolean; subtitulo: string; usuario: string; rol: string; vista: Vista; ir: (v: Vista) => void
  lotes: Lote[]; abrir: (id: string) => void; nAvisos: number; nAprob: number
  onAvisos: () => void; onCuenta: () => void; onConfig: () => void; onAyuda: () => void
}) {
  const [q, setQ] = useState(''), [idx, setIdx] = useState(0), [foco, setFoco] = useState(false)
  const res = q.trim() ? buscarLotes(p.lotes, q.trim()).slice(0, 10) : []
  const ir = (id: string) => { setQ(''); setFoco(false); p.abrir(id) }
  const [abierto, setAbierto] = useState<string | null>(null)
  const va = (v: Vista) => { setAbierto(null); p.ir(v) }
  return (
    <header className="top" onMouseLeave={() => setAbierto(null)}>
      <div className="marca">
        <img src={p.logo ? '/marca/logo_claro.png' : '/marca/icono-192.png'} alt="" className={p.logo ? 'logo' : 'logo logo-ico'} />
        <span className="sep" />
        <div className="proyecto"><strong>{p.empresa}</strong><small>{p.subtitulo}</small></div>
      </div>
      <nav className="tabs">
        <button className={p.vista === 'mapa' ? 'activo' : ''} onClick={() => va('mapa')}><Map /><span>Mapa</span></button>
        <button className={p.vista === 'tablero' ? 'activo' : ''} onClick={() => va('tablero')}><LayoutDashboard /><span>Tablero</span></button>
        {GRUPOS.map((g) => (
          <div key={g.t} className={`grupo ${abierto === g.t ? 'abierto' : ''} ${g.items.some((i) => i.v === p.vista) ? 'activo' : ''}`}>
            <button className="g-btn" onClick={() => setAbierto(abierto === g.t ? null : g.t)}>
              <g.ic /><span>{g.t}</span>{g.t === 'Administración' && p.nAprob > 0 && <span className="badge-n">{p.nAprob}</span>}<ChevronDown className="flecha" />
            </button>
            <div className="g-menu">
              {g.items.filter((i) => !i.solo || i.solo.split(',').includes(p.rol)).map((i) => (
                <button key={i.v} className={p.vista === i.v ? 'activo' : ''} onClick={() => va(i.v)}>
                  <i.ic /><b>{i.t}</b><small>{i.s}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="acciones-top">
        <div className="buscador"><Search />
          <input type="search" placeholder="Lote, comprador o documento…" autoComplete="off" value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0) }} onFocus={() => setFoco(true)} onBlur={() => setTimeout(() => setFoco(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { setIdx(Math.min(idx + 1, res.length - 1)); e.preventDefault() }
              if (e.key === 'ArrowUp') { setIdx(Math.max(idx - 1, 0)); e.preventDefault() }
              if (e.key === 'Enter' && res[idx]) ir(res[idx].id_lote)
            }} />
          <div className={`sugerencias ${foco && q.trim() ? 'visible' : ''}`}>
            {res.length ? res.map((l, i) => (
              <div key={l.id_lote} className={`sug ${i === idx ? 'sel' : ''}`} onMouseDown={() => ir(l.id_lote)}>
                <span className="sug-id">{l.id_lote}</span><span className="sug-txt">{l.cliente || ESTADOS[l.estado]?.nom}{l.documento ? ' · ' + l.documento : ''}</span><Chip k={l.estado} />
              </div>)) : <div className="sug-vacia">Sin resultados para «{q}»</div>}
          </div></div>
        <button className="icono campana" title="Avisos" onClick={p.onAvisos}><Bell /><span className="badge-n">{p.nAvisos > 99 ? '99+' : p.nAvisos || ''}</span></button>
        <button className="icono" title="Ayuda" onClick={p.onAyuda}><CircleHelp /></button>
        <button className="chip-usuario" title="Mi cuenta" onClick={p.onCuenta}>
          <UserRound /><span className="cu-txt"><span>{p.usuario}</span><small>{ROLES[p.rol] ?? p.rol}</small></span>
        </button>
        {p.rol !== 'CONSULTA' && <button className="icono" title="Configuración" onClick={p.onConfig}><Settings /></button>}
      </div>
      <img src="/alpha/logo_blanco.svg" alt="Alpha" className="logo-alpha" />
    </header>
  )
}
