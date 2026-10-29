export class Pendiente extends Error {}

export function aviso(txt: string, error = false) {
  const caja = document.getElementById('avisos')
  if (!caja) return
  const d = document.createElement('div')
  d.className = 'aviso' + (error ? ' error' : '')
  d.textContent = txt
  caja.appendChild(d)
  setTimeout(() => d.remove(), error ? 6500 : 3800)
}

// Una operación que requiere aprobación responde «pendiente»: se avisa y se lanza Pendiente para que el formulario no siga.
export async function api<T>(ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(ruta, cuerpo === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  const d = await r.json().catch(() => ({ error: 'Respuesta no válida del servidor' }))
  if (r.status === 401 && d.sesion === false) setTimeout(() => location.reload(), 1200)
  if (!r.ok) throw new Error(d.error ?? d.detail ?? 'Error')
  if (d.pendiente) { aviso(d.mensaje || 'Pendiente de aprobación'); throw new Pendiente(d.mensaje) }
  return d as T
}

// errores de una operación: si quedó pendiente ya se avisó; lo demás se muestra en rojo
export const falla = (e: unknown) => { if (!(e instanceof Pendiente)) aviso((e as Error).message, true) }
