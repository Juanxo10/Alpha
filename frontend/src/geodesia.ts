// Conversión de longitud/latitud (MAGNA-SIRGAS, elipsoide GRS80) a coordenadas planas y a grados-minutos-segundos.
// Mercator transversa (series de Krüger): sin dependencias; error < 1 mm dentro de Colombia.
const A = 6378137, F = 1 / 298.257222101
const N = F / (2 - F), RAD = Math.PI / 180
const A_ = (A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64)
const ALFA = [N / 2 - (2 / 3) * N ** 2 + (5 / 16) * N ** 3, (13 / 48) * N ** 2 - (3 / 5) * N ** 3, (61 / 240) * N ** 3]

type Proy = { lat0: number; lon0: number; k: number; fe: number; fn: number }
// Origen Nacional: sistema oficial de Colombia desde 2020 · Colombia Bogotá: el del plano de loteo
export const EPSG_9377: Proy = { lat0: 4, lon0: -73, k: 0.9992, fe: 5000000, fn: 2000000 }
export const EPSG_3116: Proy = { lat0: 4.59620041666667, lon0: -74.0775079166667, k: 1, fe: 1000000, fn: 1000000 }

const E2 = 2 * F - F * F
// latitud conforme: tan(χ) = sinh(atanh(sin φ) − e·atanh(e·sin φ))
const conforme = (phi: number) => Math.sinh(Math.atanh(Math.sin(phi)) - Math.sqrt(E2) * Math.atanh(Math.sqrt(E2) * Math.sin(phi)))
const serie = (xi: number, eta: number): [number, number] => {
  let s = xi, w = eta
  ALFA.forEach((a, i) => { const j = 2 * (i + 1); s += a * Math.sin(j * xi) * Math.cosh(j * eta); w += a * Math.cos(j * xi) * Math.sinh(j * eta) })
  return [s, w]
}

export function aPlano(lon: number, lat: number, p: Proy): [number, number] {
  const t = conforme(lat * RAD), dl = (lon - p.lon0) * RAD
  const [s, w] = serie(Math.atan2(t, Math.cos(dl)), Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t)))
  const [s0] = serie(Math.atan(conforme(p.lat0 * RAD)), 0)
  return [p.fe + p.k * A_ * w, p.fn + p.k * A_ * (s - s0)]
}

export function aGMS(grados: number, eje: 'lat' | 'lon'): string {
  const hem = eje === 'lat' ? (grados >= 0 ? 'N' : 'S') : grados >= 0 ? 'E' : 'W'
  let g = Math.abs(grados), d = Math.floor(g), m = Math.floor((g - d) * 60)
  let s = Math.round(((g - d) * 60 - m) * 60 * 1000) / 1000
  if (s >= 60) { s = 0; m += 1 } if (m >= 60) { m = 0; d += 1 }
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(3).padStart(6, '0')}" ${hem}`
}
