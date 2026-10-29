import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { api, falla } from './api'
import { fmtN } from './formato'

export const hoyISO = () => new Date().toLocaleDateString('sv-SE')
export const sumarDias = (iso: string, n: number) => { const t = new Date(iso + 'T12:00'); t.setDate(t.getDate() + n); return t.toLocaleDateString('sv-SE') }
export function sumarMeses(iso: string, n: number) {
  const t = new Date(iso + 'T12:00'); const d = t.getDate(); t.setDate(1); t.setMonth(t.getMonth() + n)
  t.setDate(Math.min(d, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate())); return t.toLocaleDateString('sv-SE')
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Datos = Record<string, any>

export const Vacio = ({ Ic, t, pad }: { Ic: React.ComponentType; t: string; pad?: boolean }) =>
  <div className="vacio" style={pad ? { padding: 50 } : undefined}><Ic />{t}</div>

export const Kpi = ({ et, va, sub, c, Ic, rojo }: { et: string; va: ReactNode; sub?: ReactNode; c: string; Ic?: React.ComponentType; rojo?: boolean }) => (
  <div className={`kpi ${rojo ? 'rojo' : ''}`} style={{ '--c': c } as React.CSSProperties}>
    <div className="et">{Ic && <Ic />}{et}</div><div className="va">{va}</div>{sub && <div className="sub">{sub}</div>}
  </div>
)

export const Campo = ({ etq, req, cls = '', ayuda, children }: { etq: string; req?: boolean; cls?: string; ayuda?: string; children: ReactNode }) => (
  <label className={`campo ${req ? 'req' : ''} ${cls}`}><span>{etq}</span>{children}{ayuda && <span className="ayuda">{ayuda}</span>}</label>
)

// Escribe con puntos de miles; el formulario lo recoge como número (name con data-dinero)
export function Dinero({ name, def = 0, ...r }: { name: string; def?: number } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [v, setV] = useState(def ? fmtN.format(def) : '')
  return (
    <div className="input-dinero">
      <input {...r} name={name} data-dinero className="dinero" inputMode="numeric" value={v}
        onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '')); setV(n ? fmtN.format(n) : ''); e.target.setCustomValidity(e.target.value.includes('-') ? 'No se permiten valores negativos' : '') }} />
    </div>
  )
}

export const Sel = ({ name, ops, def }: { name: string; ops: string[]; def?: string }) =>
  <select name={name} defaultValue={def}>{ops.map((o) => <option key={o}>{o}</option>)}</select>

const pila: symbol[] = [] // ventanas abiertas: Esc cierra solo la de encima

// Ventana con formulario: alEnviar recibe los campos (dinero como número, casillas como booleano)
export function Modal(p: {
  titulo: string; cerrar: () => void; alEnviar?: (d: Datos) => Promise<void>; boton?: string; ancho?: boolean | 'extra'
  peligro?: boolean; pie?: ReactNode; children: ReactNode
}) {
  const [ocupado, setOcupado] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const yo = Symbol()
    pila.push(yo)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && pila[pila.length - 1] === yo) p.cerrar() }
    addEventListener('keydown', esc)
    return () => { removeEventListener('keydown', esc); pila.splice(pila.indexOf(yo), 1) }
  }, [p])
  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!p.alEnviar) return
    const f = form.current!, d: Datos = Object.fromEntries(new FormData(f))
    f.querySelectorAll<HTMLInputElement>('input[data-dinero]').forEach((i) => { d[i.name] = Number(i.value.replace(/\D/g, '')) || 0 })
    f.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((i) => { d[i.name] = i.checked })
    setOcupado(true)
    try { await p.alEnviar(d) } catch (er) { falla(er) } finally { setOcupado(false) }
  }
  return (
    <div className="modal-fondo visible" onMouseDown={(e) => { if (e.target === e.currentTarget) p.cerrar() }}>
      <div className={`modal ${p.ancho ? 'ancho' : ''} ${p.ancho === 'extra' ? 'extra' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-cab"><h2>{p.titulo}</h2><button className="icono" type="button" onClick={p.cerrar}><X /></button></div>
        <form ref={form} onSubmit={enviar} autoComplete="off">
          <div className="modal-cuerpo">{p.children}</div>
          <div className="modal-pie">
            {p.pie}
            <button type="button" className="btn sec" onClick={p.cerrar}>Cancelar</button>
            {p.alEnviar && <button type="submit" className={`btn ${p.peligro ? 'peligro' : 'pri'}`} disabled={ocupado}>{p.boton ?? 'Guardar'}</button>}
          </div>
        </form>
      </div>
    </div>
  )
}

// Carga una lectura del servidor y permite recargarla
export function useApi<T>(ruta: string) {
  const [d, setD] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    let vivo = true
    api<T>(ruta).then((x) => { if (vivo) { setD(x); setError('') } }).catch((e) => vivo && setError(e.message))
    return () => { vivo = false }
  }, [ruta, n])
  return { d, error, recargar: () => setN((x) => x + 1) }
}

export const Cargando = ({ error }: { error: string }) =>
  <div className="pagina">{error ? <p role="alert">{error}</p> : <p>Cargando…</p>}</div>

export const numeroWhatsApp = (tel?: string | null) => {
  let d = String(tel || '').replace(/\D/g, '')
  if (d.length === 10 && d.startsWith('3')) d = '57' + d
  return d.length >= 11 ? d : ''
}
