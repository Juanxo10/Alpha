/* Convierte un valor en pesos a letras, como se escribe en recibos de caja en Colombia.
   numeroALetras(1250000) -> "UN MILLÓN DOSCIENTOS CINCUENTA MIL PESOS M/CTE" */
const U = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE',
  'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIÚN',
  'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE']
const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']

function cientos(n: number) {
  if (n === 0) return ''
  if (n === 100) return 'CIEN'
  const c = Math.floor(n / 100), r = n % 100
  let t = C[c]
  if (r) {
    const d = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' Y ' + U[r % 10] : '')
    t = (t ? t + ' ' : '') + d
  }
  return t
}

function miles(n: number) {
  const m = Math.floor(n / 1000), r = n % 1000
  let t = m === 0 ? '' : m === 1 ? 'MIL' : cientos(m) + ' MIL'
  if (r) t = (t ? t + ' ' : '') + cientos(r)
  return t
}

export function numeroALetras(valor: number) {
  const n = Math.round(Math.abs(Number(valor) || 0))
  if (n === 0) return 'CERO PESOS M/CTE'
  const millones = Math.floor(n / 1e6), resto = n % 1e6
  let t = ''
  if (millones) t = millones === 1 ? 'UN MILLÓN' : miles(millones) + ' MILLONES'
  if (resto) t = (t ? t + ' ' : '') + miles(resto)
  const de = resto === 0 && millones ? ' DE' : ''
  return (t + de + ' PESOS M/CTE').replace(/\s+/g, ' ').trim()
}
