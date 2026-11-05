const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
export const fmtN = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })
export const fmtN1 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 })

export const pesos = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : cop.format(Math.round(v)).replace(/\s/g, ' ')

export function pesosCorto(v: number) {
  const a = Math.abs(v || 0)
  if (a >= 1e9) return '$' + fmtN1.format(v / 1e9) + ' mil M'
  if (a >= 1e6) return '$' + fmtN1.format(v / 1e6) + ' M'
  return pesos(v || 0)
}

export const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function fecha(s: string) {
  const [a, m, d] = s.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

export function fechaLarga(s: string) {
  const [a, m, d] = s.slice(0, 10).split('-').map(Number)
  return `${d} de ${MESES_L[m - 1]} de ${a}`
}

export const ESTADOS: Record<string, { nom: string; c: string }> = {
  DISPONIBLE: { nom: 'Disponible', c: '#E3FBEF' },
  SEPARADO: { nom: 'Separado', c: '#F5B841' },
  VENDIDO: { nom: 'Vendido con saldo', c: '#3B82F6' },
  PAGADO: { nom: 'Pagado', c: '#8B5CF6' },
  ESCRITURADO: { nom: 'Escriturado', c: '#1E3A8A' },
  BLOQUEADO: { nom: 'Bloqueado', c: '#94A3B8' },
}

export const CARTERA: Record<string, { nom: string; c: string }> = {
  AL_DIA: { nom: 'Al día', c: '#22C55E' },
  MORA_30: { nom: 'Mora 1–30 días', c: '#FACC15' },
  MORA_90: { nom: 'Mora 31–90 días', c: '#F97316' },
  MORA_MAS_90: { nom: 'Mora más de 90 días', c: '#DC2626' },
  PAGADO: { nom: 'Pagado', c: '#8B5CF6' },
  SEPARADO: { nom: 'Separado', c: '#F5B841' },
  SEPARACION_VENCIDA: { nom: 'Separación vencida', c: '#B45309' },
  SIN: { nom: 'Sin negocio', c: '#E5ECEE' },
}
export const AVANCE: Record<string, { nom: string; c: string }> = {
  SIN: { nom: 'Sin negocio', c: '#E5ECEE' },
  A0: { nom: '0 – 25 %', c: '#CFF7E5' },
  A25: { nom: '25 – 50 %', c: '#8DEBC5' },
  A50: { nom: '50 – 75 %', c: '#3FCB93' },
  A75: { nom: '75 – 99 %', c: '#13906A' },
  A100: { nom: '100 % pagado', c: '#0C4F44' },
}
export const EN_MORA = ['MORA_30', 'MORA_90', 'MORA_MAS_90']
export const m2 = (v: number) => fmtN1.format(v) + ' m²'
