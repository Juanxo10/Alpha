/* Piezas comunes de las pantallas de contratos, bienes recibidos y ventas en bloque. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { api } from './api'
import { fmtN } from './formato'

export const ChipNf = ({ t, c }: { t: string; c: string }) =>
  <span className="nf-chip" style={{ '--c': c } as React.CSSProperties}>{t}</span>

// dinero escrito con puntos de miles, controlado desde el estado del formulario
export function DineroC({ valor, set, ...r }: { valor: number; set: (n: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div className="input-dinero">
      <input {...r} className="dinero" inputMode="numeric" value={valor ? fmtN.format(valor) : ''}
        onChange={(e) => { e.target.setCustomValidity(e.target.value.includes('-') ? 'No se permiten valores negativos' : ''); set(Number(e.target.value.replace(/\D/g, '')) || 0) }} />
    </div>
  )
}

export const leerArchivo = (f: File) =>
  new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.onerror = mal; r.readAsDataURL(f) })

// sube un archivo al expediente del lote y devuelve el id del adjunto
export async function subirAdjunto(id_lote: string, f: File, tipo: string, descripcion: string): Promise<number> {
  if (f.size > 15 * 1024 * 1024) throw new Error(`«${f.name}» supera 15 MB.`)
  const r = await api<{ id: number }>('/api/adjunto/subir', { id_lote, tipo, descripcion, nombre: f.name, contenido: await leerArchivo(f) })
  return r.id
}
