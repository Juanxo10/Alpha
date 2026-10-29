import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Geo } from './tipos'

type Anillo = number[][]
// Polígonos (o multipolígonos) de una geometría como lista de anillos
function anillos(g: Geometry): Anillo[] {
  if (g.type === 'Polygon') return g.coordinates
  if (g.type === 'MultiPolygon') return g.coordinates.flat()
  return []
}

/** Ubicación del lote dentro del predio: límite, vías, zonas verdes, caño, manzana del lote y el lote marcado. */
export default function PlanoMini({ geo, id, manzana, ancho = 132, alto = 64 }: { geo: Geo; id: string; manzana: number; ancho?: number; alto?: number }) {
  const lim = geo.limite.features[0]
  const lote = geo.lotes.features.find((f) => f.properties?.id_lote === id)
  if (!lim || !lote) return null
  const lim0 = anillos(lim.geometry)[0][0]
  const k = Math.cos((lim0[1] * Math.PI) / 180)
  const P = ([x, y]: number[]) => [(x - lim0[0]) * k, y - lim0[1]]
  const pts = lim.geometry.type === 'Polygon' || lim.geometry.type === 'MultiPolygon' ? anillos(lim.geometry).flat().map(P) : []
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const mg = (x1 - x0) * 0.03
  const s = Math.min(ancho / (x1 - x0 + 2 * mg), alto / (y1 - y0 + 2 * mg))
  const ox = (ancho - (x1 - x0) * s) / 2, oy = (alto - (y1 - y0) * s) / 2
  const T = (p: number[]) => { const q = P(p); return [ox + (q[0] - x0) * s, oy + (y1 - q[1]) * s] }
  const ruta = (g: Geometry) => anillos(g).map((r) => 'M' + r.map((p) => T(p).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z').join('')
  const pinta = (fc: FeatureCollection, estilo: (f: Feature) => Record<string, string | number>) =>
    fc.features.map((f, i) => <path key={i} d={ruta(f.geometry)} {...estilo(f)} />)
  const c = anillos(lote.geometry).flat().map(T)
  const cx = c.reduce((a, p) => a + p[0], 0) / c.length, cy = c.reduce((a, p) => a + p[1], 0) / c.length
  const lineas = geo.cano.features.flatMap((f) =>
    f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [])
  return (
    <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`}>
      <rect width={ancho} height={alto} fill="#F4F7F7" />
      <path d={ruta(lim.geometry)} fill="#FFFFFF" />
      {pinta(geo.vias, () => ({ fill: '#DDE3E5' }))}
      {pinta(geo.zv, (f) => ({ fill: String(f.properties?.tipo ?? '').includes('RONDA') ? '#CDE8F6' : '#D8EFD2' }))}
      {lineas.map((l, i) => <path key={i} d={'M' + l.map((p) => T(p).map((v) => v.toFixed(1)).join(',')).join('L')} fill="none" stroke="#3B82C4" strokeWidth={0.8} />)}
      {pinta(geo.manz, (f) => f.properties?.manzana === manzana
        ? { fill: '#C9F5E1', stroke: '#0C2E37', strokeWidth: 0.8 } : { fill: 'none', stroke: '#7C9096', strokeWidth: 0.5 })}
      <path d={ruta(lim.geometry)} fill="none" stroke="#DC2626" strokeWidth={1} strokeDasharray="3 2" />
      <path d={ruta(lote.geometry)} fill="#5CE9AB" stroke="#0C2E37" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={7} fill="none" stroke="#DC2626" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={2.2} fill="#DC2626" />
    </svg>
  )
}
