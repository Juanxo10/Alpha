import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import {
  BadgePercent, Globe2, Info, Map as MapIcon, Phone, Plane, SlidersHorizontal, Wallet, X, HandCoins,
  FileSignature, Bookmark, PanelRightOpen, AlertTriangle, CalendarClock, BadgeCheck, Layers,
} from 'lucide-react'
import { api, aviso } from './api'
import Ficha, { Chip, ChipCartera, areaPredio, cuotaDe, pctPredio } from './Ficha'
import PlanoMini from './PlanoMini'
import { FormBloque, PanelSeleccion } from './Bloques'
import { AVANCE, CARTERA, EN_MORA, ESTADOS, fecha, fmtN, fmtN1, m2, pesos, pesosCorto } from './formato'
import type { CapaExtra, Detalle, Geo, Lote, Orto, Props, ResumenMapa } from './tipos'

export interface DatosLoteo {
  geo: Geo; orto: Orto | null; capasExtra: CapaExtra[]; lotes: Lote[]; resumen: ResumenMapa
}

type Tema = 'estado' | 'cartera' | 'avance'

// MapLibre lanza «Style is not done loading» si se toca el estilo antes de que termine de cargar, y eso tumbaba toda la pantalla.
// Se intenta ahora y, si todavía no está listo, se reintenta cuando el mapa avise que cargó.
function cuando(m: maplibregl.Map, f: () => void) {
  const intentar = () => { try { f(); return true } catch { return false } }
  if (intentar()) return undefined
  const r = () => { if (intentar()) { m.off('styledata', r); m.off('idle', r) } }
  m.on('styledata', r); m.on('idle', r)
  return () => { m.off('styledata', r); m.off('idle', r) }
}
// El avance se agrupa por el % pagado del negocio
const claveAvance = (l: Lote) => !l.venta_id ? 'SIN' : l.pct_pagado >= 99.99 ? 'A100' : l.pct_pagado >= 75 ? 'A75'
  : l.pct_pagado >= 50 ? 'A50' : l.pct_pagado >= 25 ? 'A25' : 'A0'
const TEMAS: Record<Tema, { cat: Record<string, { nom: string; c: string }>; clave: (l: Lote) => string; ayuda: string }> = {
  estado: { cat: ESTADOS, clave: (l) => l.estado, ayuda: 'Situación comercial de cada lote.' },
  cartera: { cat: CARTERA, clave: (l) => l.cartera || 'SIN', ayuda: 'Comportamiento de pago de los lotes negociados.' },
  avance: { cat: AVANCE, clave: claveAvance, ayuda: 'Porcentaje del valor del negocio ya pagado.' },
}

const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const ES_HIDRICA: ExpressionSpecification = ['any',
  ['in', 'RONDA', ['upcase', ['to-string', ['get', 'tipo']]]], ['in', 'HIDRIC', ['upcase', ['to-string', ['get', 'tipo']]]]]
const origen = location.origin
maplibregl.setWorkerUrl(workerUrl)

function bbox(fc: FeatureCollection | Feature): [[number, number], [number, number]] {
  let b = [180, 90, -180, -90]
  const rec = (c: unknown): void => {
    const a = c as number[] | unknown[]
    if (typeof a[0] === 'number') { const [x, y] = a as number[]; b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] } else a.forEach(rec)
  }
  const fs = 'features' in fc ? fc.features : [fc]
  fs.forEach((f) => rec((f.geometry as Exclude<Geometry, { type: 'GeometryCollection' }>).coordinates))
  return [[b[0], b[1]], [b[2], b[3]]]
}

const opacidadLotes = (o: number): ExpressionSpecification => ['case', ['boolean', ['feature-state', 'oculto'], false], 0.06 * o,
  ['boolean', ['feature-state', 'hover'], false], Math.min(o + 0.17, 1), o]
const filtroId = (id: string): ExpressionSpecification => ['==', ['get', 'id_lote'], id]

function estilo(d: DatosLoteo): StyleSpecification {
  const esri = (s: string) => `https://server.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`
  const { geo, orto } = d
  const extras = d.capasExtra.flatMap((x, i): LayerSpecification[] => {
    const col = x.color || '#F59E0B', layout = { visibility: x.visible === false ? 'none' as const : 'visible' as const }
    if (x.tipo === 'linea') return [{ id: 'extra' + i, type: 'line', source: 'extra' + i, layout, paint: { 'line-color': col, 'line-width': 2 } }]
    if (x.tipo === 'punto') return [{ id: 'extra' + i, type: 'circle', source: 'extra' + i, layout, paint: { 'circle-color': col, 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } }]
    return [{ id: 'extra' + i, type: 'fill', source: 'extra' + i, layout, paint: { 'fill-color': col, 'fill-opacity': 0.35 } },
      { id: 'extra' + i + '-b', type: 'line', source: 'extra' + i, layout, paint: { 'line-color': col, 'line-width': 1.2 } }]
  })
  const capas: LayerSpecification[] = [
    { id: 'fondo', type: 'background', paint: { 'background-color': '#E8EEEF' } },
    { id: 'base-satelite', type: 'raster', source: 'satelite' },
    { id: 'base-claro', type: 'raster', source: 'claro', layout: { visibility: 'none' } },
    ...(orto ? [{ id: 'base-orto', type: 'raster', source: 'orto', layout: { visibility: 'none' } } as LayerSpecification] : []),
    { id: 'vias', type: 'fill', source: 'vias', paint: { 'fill-color': '#D9DEE0', 'fill-opacity': 0.55 } },
    { id: 'zv', type: 'fill', source: 'zv', paint: { 'fill-color': ['case', ES_HIDRICA, '#7CC4E8', '#6DBE5B'], 'fill-opacity': 0.45 } },
    { id: 'zv-borde', type: 'line', source: 'zv', paint: { 'line-color': ['case', ES_HIDRICA, '#1E78AA', '#3B8A2E'], 'line-width': 1 } },
    { id: 'cano', type: 'line', source: 'cano', paint: { 'line-color': '#1D6FD1', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 19, 3.5] } },
    ...extras,
    { id: 'lotes', type: 'fill', source: 'lotes', paint: { 'fill-color': ['to-color', ['coalesce', ['feature-state', 'c'], '#CBD5E1']], 'fill-opacity': opacidadLotes(0.78) } },
    { id: 'lotes-borde', type: 'line', source: 'lotes', paint: {
      'line-color': '#FFFFFF', 'line-opacity': ['case', ['boolean', ['feature-state', 'oculto'], false], 0.25, 0.9],
      'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.3, 19, 1.2] } },
    { id: 'manzanas', type: 'line', source: 'manzanas', paint: { 'line-color': '#0C2E37', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 19, 2.4] } },
    { id: 'limite', type: 'line', source: 'limite', paint: { 'line-color': '#E11D48', 'line-width': 2.2, 'line-dasharray': [3, 2] } },
    { id: 'lote-hover', type: 'line', source: 'lotes', filter: filtroId(''), paint: { 'line-color': '#0C2E37', 'line-width': 2 } },
    { id: 'lote-sel-halo', type: 'line', source: 'lotes', filter: filtroId(''), paint: { 'line-color': '#FFFFFF', 'line-width': 7 } },
    { id: 'lote-sel', type: 'line', source: 'lotes', filter: filtroId(''), paint: { 'line-color': '#0C2E37', 'line-width': 3.5 } },
    { id: 'nfl-sel-f', type: 'fill', source: 'lotes', filter: filtroId(''), paint: { 'fill-color': '#7C3AED', 'fill-opacity': 0.5 } },
    { id: 'nfl-sel-l', type: 'line', source: 'lotes', filter: filtroId(''), paint: { 'line-color': '#4C1D95', 'line-width': 2.4 } },
    { id: 'lotes-num', type: 'symbol', source: 'lotes', minzoom: 17.6, layout: {
      'text-field': ['to-string', ['get', 'lote']], 'text-font': ['Open Sans Semibold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 17.6, 9, 20, 14], 'text-allow-overlap': true },
      paint: { 'text-color': '#0C2E37', 'text-halo-color': 'rgba(255,255,255,.9)', 'text-halo-width': 1.3 } },
    { id: 'manzanas-etq', type: 'symbol', source: 'manzanasEtq', minzoom: 14.5, layout: {
      'text-field': ['concat', 'MZ ', ['slice', ['get', 'id_manzana'], 2]], 'text-font': ['Open Sans Semibold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 15], 'text-allow-overlap': false },
      paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#0C2E37', 'text-halo-width': 2.2, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 17.3, 1, 17.8, 0] } },
  ]
  return {
    version: 8, glyphs: `${origen}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      satelite: { type: 'raster', tiles: [esri('World_Imagery')], tileSize: 256, maxzoom: 18, attribution: 'Imagen © Esri, Maxar' },
      claro: { type: 'raster', tiles: [esri('Canvas/World_Light_Gray_Base')], tileSize: 256, maxzoom: 16, attribution: '© Esri' },
      lotes: { type: 'geojson', data: geo.lotes, promoteId: 'id_lote' },
      manzanas: { type: 'geojson', data: geo.manz }, manzanasEtq: { type: 'geojson', data: geo.manzEtq },
      vias: { type: 'geojson', data: geo.vias }, zv: { type: 'geojson', data: geo.zv },
      cano: { type: 'geojson', data: geo.cano }, limite: { type: 'geojson', data: geo.limite },
      ...Object.fromEntries(geo.extra.map((e, i) => ['extra' + i, { type: 'geojson', data: e }])),
      ...(orto ? { orto: { type: 'raster', tiles: [`${origen}/data/orto/{z}/{x}/{y}.${orto.ext || 'png'}`], tileSize: 256, scheme: orto.scheme || 'xyz',
        minzoom: orto.minzoom, maxzoom: orto.maxzoom, bounds: orto.bounds, attribution: orto.atribucion || 'Ortofoto del proyecto' } } : {}),
    },
    layers: capas,
  } as StyleSpecification
}

function Tooltip({ l, p }: { l: Lote; p: Props }) {
  return (
    <>
      <div className="tt-cab"><span className="tt-id">{l.id_lote}</span><Chip k={l.estado} /></div>
      <div className="tt-fila"><span>Área</span><b>{m2(p.area_m2)}</b></div>
      {l.venta_id ? (
        <>
          <div className="tt-fila"><span>Comprador</span><b>{l.cliente}</b></div>
          <div className="tt-fila"><span>Saldo</span><b>{pesos(l.saldo)}</b></div>
          {l.dias_mora > 0 && <div className="tt-fila"><span>En mora</span><b style={{ color: '#DC2626' }}>{l.dias_mora} días · {pesos(l.vencido)}</b></div>}
        </>
      ) : <div className="tt-fila"><span>Precio</span><b>{l.precio_lista ? pesos(l.precio_lista) : 'Sin precio'}</b></div>}
    </>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const pct = (v: number) => `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v || 0)} %`
function frenteA(p: Props) {
  const l = (p.linderos || []).find((x: any) => x.colinda.includes('Vía')) || (p.linderos || []).find((x: any) => !/^MZ/.test(x.colinda[0]))
  return l ? `${l.colinda.includes('Vía') ? 'Vía' : l.colinda[0]} (${l.rumbo.toLowerCase()})` : '—'
}

function Tarjeta({ d, p, geo, cerrar, abrirFicha }: { d: Detalle; p: Props; geo: Geo; cerrar: () => void; abrirFicha: (accion?: string) => void }) {
  const l = d.lote, r = d.resumen, v = d.ventas.find((x) => x.estado === 'ACTIVA')
  const pm2 = l.precio_lista ? l.precio_lista / l.area_m2 : null
  const Dato = ({ et, va }: { et: string; va: React.ReactNode }) => <div className="t-d"><span>{et}</span><b>{va}</b></div>
  const esSep = v?.etapa === 'SEPARADO'
  return (
    <>
      <div className="t-cab"><div><div className="t-id">{l.id_lote}</div><div className="t-tit">Manzana {l.manzana} · Lote {l.lote}</div>
        <div className="t-chips"><Chip k={r.estado} /><ChipCartera k={r.cartera} /></div></div>
        <button className="t-x" title="Cerrar" onClick={cerrar}><X /></button></div>
      <div className="t-sec"><div className="t-sub">Inmueble</div>
        <div className="t-grid">
          <Dato et="Área" va={`${fmtN1.format(l.area_m2)} m²`} /><Dato et="Perímetro" va={`${fmtN1.format(p.perimetro_m)} m`} />
          <Dato et="Medidas" va={`${fmtN1.format(p.frente_m)} × ${fmtN1.format(p.fondo_m)} m`} />
          <Dato et="Precio de lista" va={l.precio_lista ? pesosCorto(l.precio_lista) : '—'} /><Dato et="Valor m²" va={pm2 ? pesos(pm2) : '—'} />
          <Dato et="Frente a" va={frenteA(p)} />
        </div>
        <div className="t-pct"><div className="t-mini"><PlanoMini geo={geo} id={l.id_lote} manzana={l.manzana} /></div>
          <div><span>Participación en el predio</span><b>{pctPredio(p)}</b><small>del área total del predio<br />{areaPredio(p)}</small></div></div>
      </div>
      {v && (
        <>
          <div className="t-sec"><div className="t-sub">Comprador</div>
            <div className="t-cli"><b>{v.nombre}</b><span>{v.tipo_doc} {v.documento || '—'}{v.telefono && <> · <Phone /> {v.telefono}</>}</span></div>
            {(v.comisiones || []).filter((x: any) => x.estado === 'ACTIVA').map((x: any, i: number) =>
              <div className="t-com" key={i}><BadgePercent />Comisionista: <b>{x.comisionista}</b> · {pct(x.porcentaje)}</div>)}</div>
          <div className="t-sec"><div className="t-sub">{esSep ? 'Separación' : 'Negocio'}</div>
            <div className="t-grid">
              {esSep ? <><Dato et="Separado el" va={fecha(v.fecha_separacion)} /><Dato et="Vigente hasta" va={fecha(v.fecha_limite_separacion)} /><Dato et="Valor pactado" va={pesosCorto(v.valor_venta)} /></> : <>
                <Dato et="Valor de venta" va={pesosCorto(v.valor_venta)} />
                <Dato et="Cuota inicial" va={`${pesosCorto(v.cuota_inicial)}${v.inicial_pagada ? ' ✓' : ''}`} />
                <Dato et="Cuota mensual" va={v.n_cuotas ? pesos(cuotaDe(v)) : 'Contado'} />
                <Dato et="Cuotas pagadas" va={v.n_cuotas ? `${v.cuotas_pagadas} de ${v.cuotas_total}` : '—'} />
                <Dato et="Fecha de venta" va={fecha(v.fecha_venta)} /><Dato et="Termina" va={v.fecha_fin ? fecha(v.fecha_fin) : '—'} /></>}
            </div>
            <div className="t-av">
              <div className="t-av-txt"><span>Pagado <b>{pesos(v.pagado)}</b></span><span>Saldo <b>{pesos(v.saldo)}</b></span></div>
              <div className="t-barra"><i style={{ width: `${Math.min(v.pct_pagado, 100)}%` }} /></div>
              <div className="t-av-pie">{fmtN1.format(v.pct_pagado)} % pagado{v.ultimo_pago && ` · último pago ${pesosCorto(v.ultimo_pago.valor)} el ${fecha(v.ultimo_pago.fecha)}`}</div>
            </div>
            {v.dias_mora ? <div className="t-alerta mal"><AlertTriangle /><span><b>{v.dias_mora} días de mora</b> · {v.cuotas_vencidas} cuota{v.cuotas_vencidas > 1 ? 's' : ''} por {pesos(v.vencido)}{v.interes_mora > 0 && ` + interés est. ${pesos(v.interes_mora)}`}</span></div>
              : v.proxima_cuota ? <div className="t-alerta"><CalendarClock /><span>Próxima cuota <b>{pesos(v.proxima_cuota.pendiente)}</b> el {fecha(v.proxima_cuota.fecha)}</span></div>
              : r.cartera === 'PAGADO' ? <div className="t-alerta ok"><BadgeCheck /><span><b>Pagado en su totalidad</b></span></div> : null}
          </div>
        </>
      )}
      <div className="t-acc">
        {v ? <button className="btn pri peq" onClick={() => abrirFicha('pago')}><HandCoins />Registrar pago</button>
          : r.estado !== 'BLOQUEADO' && <><button className="btn pri peq" onClick={() => abrirFicha('vender')}><FileSignature />Vender</button><button className="btn sec peq" onClick={() => abrirFicha('separar')}><Bookmark />Separar</button></>}
        <button className="btn sec peq" title="Ficha completa" onClick={() => abrirFicha()}><PanelRightOpen />Ficha</button>
      </div>
    </>
  )
}

export default function Mapa({ datos, abrir, config, refrescar, seleccionar }: { datos: DatosLoteo; abrir?: string | null; config: Record<string, unknown>; refrescar: () => Promise<void>; seleccionar?: boolean }) {
  const { geo, orto, lotes, resumen: r } = datos
  const contenedor = useRef<HTMLDivElement>(null)
  const mapa = useRef<maplibregl.Map | null>(null)
  const hover = useRef<string | null>(null)
  const [listo, setListo] = useState(false)
  // opciones de vista del mapa: se recuerdan al salir y volver
  const gu = useMemo<Record<string, any>>(() => { try { return JSON.parse(localStorage.getItem('mapa_vista') || '{}') } catch { return {} } }, [])
  const [tema, setTema] = useState<Tema>(gu.tema ?? 'estado')
  const [ocultas, setOcultas] = useState<Set<string>>(new Set(gu.ocultas ?? []))
  const [manzana, setManzana] = useState<string>(gu.manzana ?? '')
  const [base, setBase] = useState<'orto' | 'satelite' | 'claro'>(gu.base ?? (orto ? 'orto' : 'satelite'))
  const [opac, setOpac] = useState<number>(gu.opac ?? (orto ? 55 : 78))
  const [etq, setEtq] = useState<boolean>(gu.etq ?? true)
  const [extraVis, setExtraVis] = useState<boolean[]>(
    Array.isArray(gu.extraVis) && gu.extraVis.length === datos.capasExtra.length ? gu.extraVis : datos.capasExtra.map((x) => x.visible !== false))
  useEffect(() => {
    try { localStorage.setItem('mapa_vista', JSON.stringify({ tema, ocultas: [...ocultas], manzana, base, opac, etq, extraVis })) } catch { /* sin almacenamiento */ }
  }, [tema, ocultas, manzana, base, opac, etq, extraVis])
  const [panel, setPanel] = useState(false)
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null)
  const [coords, setCoords] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [accion, setAccion] = useState<string | null>(null)
  const [fichaAbierta, setFichaAbierta] = useState(false)
  const [popupEl, setPopupEl] = useState<HTMLElement | null>(null)
  const popup = useRef<maplibregl.Popup | null>(null)
  const [error, setError] = useState('')
  // venta en bloque: selección de varios lotes
  const [modoSel, setModoSel] = useState(!!seleccionar)
  const [selMulti, setSelMulti] = useState<string[]>([])
  const [formBloque, setFormBloque] = useState<string[] | null>(null)
  const cajaSel = useRef<HTMLDivElement>(null)
  const selRef = useRef<string[]>([])
  selRef.current = selMulti

  const props = useMemo(() => Object.fromEntries(geo.lotes.features.map((f) => [f.properties!.id_lote as string, f.properties as Props])), [geo])
  const porId = useMemo(() => Object.fromEntries(lotes.map((l) => [l.id_lote, l])), [lotes])
  const caja = useMemo(() => bbox(geo.limite), [geo])
  const manzanas = useMemo(() => [...new Set(geo.lotes.features.map((f) => f.properties!.manzana as number))].sort((a, b) => a - b), [geo])

  const marcarSel = useCallback((id: string) => {
    const m = mapa.current
    if (m) ['lote-sel', 'lote-sel-halo'].forEach((c) => m.setFilter(c, filtroId(id)))
  }, [])

  const cerrarPopup = useCallback(() => { popup.current?.remove(); popup.current = null; setPopupEl(null) }, [])
  const cerrarFicha = useCallback(() => {
    setFichaAbierta(false); setSel(null); marcarSel('')
    setTimeout(() => mapa.current?.resize(), 240)
  }, [marcarSel])

  const estadoLote = (id: string) => {
    const l = porId[id]
    return !l ? 'No existe' : l.estado !== 'DISPONIBLE' ? (ESTADOS[l.estado]?.nom || l.estado) : ''
  }
  const alternarLote = (id: string) => {
    if (selRef.current.includes(id)) return setSelMulti(selRef.current.filter((x) => x !== id))
    const prob = estadoLote(id)
    if (prob) return aviso(`${id}: ${prob}. No se puede incluir.`, true)
    setSelMulti([...selRef.current, id])
  }
  const salirSeleccion = () => { setSelMulti([]); setModoSel(false) }

  async function abrirTarjeta(id: string, lngLat: maplibregl.LngLat) {
    if (modoSel) return alternarLote(id)
    try {
      const d = await api<Detalle>('/api/lote?id=' + encodeURIComponent(id))
      setDetalle(d); setSel(id); marcarSel(id); cerrarPopup()
      const m = mapa.current!
      const pt = m.project(lngLat), alto = m.getContainer().clientHeight, ancho = m.getContainer().clientWidth
      const anchor = ((pt.y > alto / 2 ? 'bottom' : 'top') + (pt.x < 200 ? '-left' : pt.x > ancho - 200 ? '-right' : '')) as maplibregl.PositionAnchor
      if (innerWidth <= 760) m.easeTo({ center: lngLat, offset: [0, -innerHeight * 0.24], duration: 300 })
      const el = document.createElement('div')
      popup.current = new maplibregl.Popup({ closeButton: false, maxWidth: '380px', className: 'hv-pop', offset: 12, focusAfterOpen: false, anchor })
        .setLngLat(lngLat).setDOMContent(el).addTo(m)
      popup.current.on('close', () => { if (!fichaRef.current) marcarSel('') })
      setPopupEl(el)
      // con el contenido ya dibujado, se mide la tarjeta y se mueve el mapa para que quepa completa
      setTimeout(() => {
        const r = popup.current?.getElement()?.getBoundingClientRect()
        if (!r || innerWidth <= 760) return
        const sobra = r.bottom - (innerHeight - 12), falta = 72 - r.top
        if (sobra > 0) m.panBy([0, sobra]); else if (falta > 0) m.panBy([0, -falta])
      }, 120)
    } catch (e) { setError((e as Error).message) }
  }
  const fichaRef = useRef(false)
  fichaRef.current = fichaAbierta
  const abrirRef = useRef(abrirTarjeta)
  abrirRef.current = abrirTarjeta

  async function recargarFicha(msg?: string) {
    if (msg) aviso(msg)
    await refrescar()
    if (sel) setDetalle(await api<Detalle>('/api/lote?id=' + encodeURIComponent(sel)))
  }

  async function abrirFicha(id: string, accion?: string) {
    setAccion(accion ?? null)
    cerrarPopup()
    if (!detalle || detalle.lote.id_lote !== id) setDetalle(await api<Detalle>('/api/lote?id=' + encodeURIComponent(id)))
    setSel(id); marcarSel(id); setFichaAbierta(true)
    setTimeout(() => {
      const m = mapa.current!
      m.resize()
      const f = geo.lotes.features.find((x) => x.properties!.id_lote === id)!
      m.fitBounds(bbox(f), { padding: 120, maxZoom: 19.3, duration: 700 })
    }, 240)
  }

  // ---- mapa
  useEffect(() => {
    const m = new maplibregl.Map({
      container: contenedor.current!, bounds: caja, fitBoundsOptions: { padding: 40 }, maxZoom: orto ? 23 : 21.5,
      attributionControl: { compact: true }, style: estilo(datos),
    })
    mapa.current = m
    m.once('style.load', () => {
      m.resize() // el contenedor puede haber cambiado de tamaño desde que se creó el mapa
      m.fitBounds(caja, { padding: 40, duration: 0 })
      setListo(true)
    })
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')
    m.on('mousemove', 'lotes', (e) => {
      const id = e.features![0].properties.id_lote as string
      m.getCanvas().style.cursor = 'pointer'
      if (hover.current !== id) {
        if (hover.current) m.setFeatureState({ source: 'lotes', id: hover.current }, { hover: false })
        hover.current = id
        m.setFeatureState({ source: 'lotes', id }, { hover: true })
        m.setFilter('lote-hover', filtroId(id))
      }
      setTip({ id, x: e.point.x + 16, y: e.point.y + 16 })
    })
    m.on('mouseleave', 'lotes', () => {
      m.getCanvas().style.cursor = ''
      if (hover.current) m.setFeatureState({ source: 'lotes', id: hover.current }, { hover: false })
      hover.current = null
      m.setFilter('lote-hover', filtroId(''))
      setTip(null)
    })
    m.on('click', 'lotes', (e) => abrirRef.current(e.features![0].properties.id_lote as string, e.lngLat))
    m.on('error', (e) => { if (!(e as { sourceId?: string }).sourceId) setError(String(e.error?.message ?? e.error)) })
    m.on('mousemove', (e) => setCoords(`${e.lngLat.lat.toFixed(6)}, ${e.lngLat.lng.toFixed(6)}`))
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrarFicha() }
    addEventListener('keydown', esc)
    return () => { removeEventListener('keydown', esc); m.remove(); mapa.current = null }
    // el mapa se crea una sola vez por conjunto de datos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos.geo, datos.orto])

  useEffect(() => { if (listo && abrir) abrirFicha(abrir) }, [listo]) // eslint-disable-line react-hooks/exhaustive-deps

  // lotes seleccionados para la venta en bloque
  useEffect(() => {
    const m = mapa.current
    if (listo && m) return cuando(m, () => ['nfl-sel-f', 'nfl-sel-l'].forEach((c) => m.setFilter(c, ['in', ['get', 'id_lote'], ['literal', selMulti]])))
  }, [listo, selMulti])
  useEffect(() => {
    const m = mapa.current
    if (!listo || !m || !modoSel) return
    popup.current?.remove()
    aviso(innerWidth > 760 ? 'Toque los lotes, o mantenga Mayús y arrastre un recuadro' : 'Toque los lotes que quiere agregar')
    m.boxZoom.disable()
    const lienzo = m.getCanvasContainer(), recuadro = cajaSel.current!
    let ini: [number, number] | null = null
    const pos = (e: MouseEvent): [number, number] => { const r = lienzo.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
    const abajo = (e: MouseEvent) => {
      if (!e.shiftKey || e.button !== 0) return
      e.preventDefault(); m.dragPan.disable(); ini = pos(e); recuadro.hidden = false
      Object.assign(recuadro.style, { left: ini[0] + 'px', top: ini[1] + 'px', width: '0px', height: '0px' })
    }
    const mueve = (e: MouseEvent) => {
      if (!ini) return
      const q = pos(e)
      Object.assign(recuadro.style, { left: Math.min(ini[0], q[0]) + 'px', top: Math.min(ini[1], q[1]) + 'px', width: Math.abs(q[0] - ini[0]) + 'px', height: Math.abs(q[1] - ini[1]) + 'px' })
    }
    const arriba = (e: MouseEvent) => {
      if (!ini) return
      const q = pos(e), a = ini
      ini = null; recuadro.hidden = true; m.dragPan.enable()
      if (Math.abs(q[0] - a[0]) < 6 || Math.abs(q[1] - a[1]) < 6) return
      const ids = [...new Set(m.queryRenderedFeatures([a, q], { layers: ['lotes'] }).map((f) => f.properties.id_lote as string))]
      const nuevos = ids.filter((id) => !selRef.current.includes(id) && !estadoLote(id)).sort()
      setSelMulti([...selRef.current, ...nuevos])
      const fuera = ids.filter((id) => !selRef.current.includes(id) && estadoLote(id)).length
      aviso(`${nuevos.length} lote(s) agregados${fuera > 0 ? ` · ${fuera} no disponibles se omitieron` : ''}`)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.modal-fondo')) salirSeleccion() }
    lienzo.addEventListener('mousedown', abajo, true); addEventListener('mousemove', mueve); addEventListener('mouseup', arriba); addEventListener('keydown', esc)
    return () => {
      lienzo.removeEventListener('mousedown', abajo, true); removeEventListener('mousemove', mueve); removeEventListener('mouseup', arriba); removeEventListener('keydown', esc)
      m.boxZoom.enable(); m.dragPan.enable()
    }
  }, [listo, modoSel]) // eslint-disable-line react-hooks/exhaustive-deps

  // colores de los lotes según el tema, las categorías ocultas y la manzana filtrada
  useEffect(() => {
    const m = mapa.current
    if (!listo || !m) return
    const t = TEMAS[tema]
    return cuando(m, () => lotes.forEach((l) => {
      const k = t.clave(l)
      m.setFeatureState({ source: 'lotes', id: l.id_lote }, { c: t.cat[k]?.c || '#CBD5E1', oculto: ocultas.has(k) || (manzana !== '' && String(l.manzana) !== manzana) })
    }))
  }, [listo, lotes, tema, ocultas, manzana])

  useEffect(() => {
    const m = mapa.current
    if (!listo || !m) return
    return cuando(m, () => (['satelite', 'claro', 'orto'] as const).forEach((x) => m.getLayer('base-' + x) &&
      m.setLayoutProperty('base-' + x, 'visibility', x === base || (base === 'orto' && x === 'satelite') ? 'visible' : 'none')))
  }, [listo, base])
  useEffect(() => { const m = mapa.current; if (listo && m) return cuando(m, () => m.setPaintProperty('lotes', 'fill-opacity', opacidadLotes(opac / 100))) }, [listo, opac])
  useEffect(() => { const m = mapa.current; if (listo && m) return cuando(m, () => m.setLayoutProperty('lotes-num', 'visibility', etq ? 'visible' : 'none')) }, [listo, etq])
  useEffect(() => {
    const m = mapa.current
    if (!listo || !m) return
    return cuando(m, () => extraVis.forEach((v, i) => ['extra' + i, 'extra' + i + '-b'].forEach((id) =>
      m.getLayer(id) && m.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'))))
  }, [listo, extraVis])
  useEffect(() => { document.body.classList.toggle('panel-abierto', panel); return () => document.body.classList.remove('panel-abierto') }, [panel])

  function filtrarManzana(mz: string) {
    setManzana(mz)
    const m = mapa.current!
    if (!mz) m.fitBounds(caja, { padding: 40 })
    else m.fitBounds(bbox(geo.manz.features.find((x) => String(x.properties!.manzana) === mz)!), { padding: 80, maxZoom: 19 })
  }

  // ---- panel
  const t = TEMAS[tema]
  const cuenta: Record<string, number> = {}, valor: Record<string, number> = {}
  lotes.forEach((l) => {
    const k = t.clave(l)
    cuenta[k] = (cuenta[k] || 0) + 1
    valor[k] = (valor[k] || 0) + (tema === 'cartera' && EN_MORA.includes(k) ? l.vencido : l.saldo || 0)
  })
  const c = r.conteo, vendidos = (c.VENDIDO || 0) + (c.PAGADO || 0) + (c.ESCRITURADO || 0)
  const neg = r.valor_vendido + r.valor_separado, pctRec = neg ? (100 * r.recaudado) / neg : 0
  const gestion = lotes.filter((l) => l.cartera === 'SEPARACION_VENCIDA' || (EN_MORA.includes(l.cartera ?? '') && l.dias_mora > 30))
    .sort((a, b) => (b.dias_mora || 0) - (a.dias_mora || 0))
  const lm = manzana ? lotes.filter((l) => String(l.manzana) === manzana) : []
  const negociados = lm.filter((l) => l.venta_id).length
  const hayOrto = !!orto
  const tt = tip && porId[tip.id] && !popupEl ? tip : null

  return (
    <>
      <aside className="panel-izq">
        <div className="panel-x"><span>Resumen y filtros</span><button type="button" onClick={() => setPanel(false)} title="Cerrar"><X /></button></div>
        <div className="kpis-mini">
          <div className="km ancho"><div className="et"><Wallet />Recaudado</div><div className="va">{pesos(r.recaudado)}</div>
            <div className="sub">{fmtN1.format(pctRec)} % de lo negociado · por cobrar {pesosCorto(r.cartera)}</div>
            <div className="barra"><i style={{ width: `${pctRec}%`, background: 'var(--menta)' }} /></div></div>
          <div className="km"><div className="et">Vendidos</div><div className="va">{fmtN.format(vendidos)}</div><div className="sub">de {fmtN.format(r.total_lotes)} lotes</div></div>
          <div className="km"><div className="et">Disponibles</div><div className="va">{fmtN.format(c.DISPONIBLE || 0)}</div><div className="sub">{fmtN.format(c.SEPARADO || 0)} separados</div></div>
          <div className={`km ${r.lotes_mora ? 'alerta' : ''}`}><div className="et">En mora</div><div className="va">{fmtN.format(r.lotes_mora)}</div><div className="sub">{pesosCorto(r.vencido)} vencidos</div></div>
          <div className="km"><div className="et">Recaudo del mes</div><div className="va">{pesosCorto(r.recaudo_mes)}</div><div className="sub">{MESES_L[new Date().getMonth()]}</div></div>
        </div>

        <div className="bloque"><div className="bloque-tit">Ver el mapa por</div>
          <div className="segmento">
            {(['estado', 'cartera', 'avance'] as Tema[]).map((k) => (
              <button key={k} className={tema === k ? 'activo' : ''} onClick={() => { setTema(k); setOcultas(new Set()) }}>{k[0].toUpperCase() + k.slice(1)}</button>))}
          </div>
          <div className="leyenda">
            <div className="ley-ayuda">{t.ayuda} Clic en una categoría para ocultarla.</div>
            {Object.entries(t.cat).filter(([k]) => cuenta[k] || ['DISPONIBLE', 'VENDIDO', 'AL_DIA', 'SIN'].includes(k)).map(([k, v]) => (
              <div key={k} className={`ley ${ocultas.has(k) ? 'off' : ''}`}
                onClick={() => setOcultas((o) => { const n = new Set(o); if (!n.delete(k)) n.add(k); return n })}>
                <span className="sw" style={{ background: v.c }} />
                <span className="nom">{v.nom}{tema === 'cartera' && EN_MORA.includes(k) && cuenta[k] > 0 && <span className="val">{pesos(valor[k])} vencidos</span>}</span>
                <span className="cnt">{fmtN.format(cuenta[k] || 0)}</span>
              </div>))}
          </div>
        </div>

        <div className="bloque"><div className="bloque-tit">Filtrar</div>
          <label className="campo"><span>Manzana</span>
            <select value={manzana} onChange={(e) => filtrarManzana(e.target.value)}>
              <option value="">Todas las manzanas</option>
              {manzanas.map((m) => <option key={m} value={m}>Manzana {String(m).padStart(2, '0')}</option>)}
            </select></label>
          <div className="nota-filtro">{manzana && <><b>{lm.length}</b> lotes · {negociados} negociados · {lm.length - negociados} libres<br />
            Saldo por cobrar: <b>{pesos(lm.reduce((s, l) => s + l.saldo, 0))}</b></>}</div>
        </div>

        <div className="bloque"><div className="bloque-tit">Mapa base</div>
          <div className="bases">
            <button className={base === 'orto' ? 'activo' : ''} disabled={!hayOrto} onClick={() => { setBase('orto'); setOpac(55) }}
              title={orto ? `${orto.descripcion || 'Ortofoto del loteo'}${orto.resolucion_cm ? ` · ${orto.resolucion_cm} cm/px` : ''}` : ''}>
              <Plane /><span>Ortofoto</span>{!hayOrto && <em>Pendiente</em>}</button>
            <button className={base === 'satelite' ? 'activo' : ''} onClick={() => setBase('satelite')}><Globe2 /><span>Satélite</span></button>
            <button className={base === 'claro' ? 'activo' : ''} onClick={() => setBase('claro')}><MapIcon /><span>Claro</span></button>
          </div>
          <label className="deslizador"><span>Opacidad de lotes</span><b>{opac} %</b>
            <input type="range" min={10} max={100} value={opac} onChange={(e) => setOpac(+e.target.value)} /></label>
          <label className="interruptor"><input type="checkbox" checked={etq} onChange={(e) => setEtq(e.target.checked)} /><span />Números de lote</label>
          {datos.capasExtra.map((x, i) => (
            <label className="interruptor" key={i}><input type="checkbox" checked={extraVis[i]}
              onChange={(e) => setExtraVis((v) => v.map((y, j) => (j === i ? e.target.checked : y)))} /><span />{x.nombre || x.archivo}</label>))}
        </div>

        <div className="bloque"><div className="bloque-tit">Requieren gestión <span className="badge-n">{gestion.length || ''}</span></div>
          <div className="gestion">
            {gestion.length ? gestion.slice(0, 40).map((l) => (
              <div className="ges" key={l.id_lote} onClick={() => abrirFicha(l.id_lote)}>
                <span className="ges-id">{l.id_lote}</span><span className="ges-txt">{l.cliente}</span>
                <span className={`ges-v ${l.cartera === 'SEPARACION_VENCIDA' ? 'amb' : ''}`}>{l.cartera === 'SEPARACION_VENCIDA' ? 'Sep. vencida' : `${l.dias_mora} d · ${pesosCorto(l.vencido)}`}</span></div>))
              : <div className="ley-ayuda">No hay moras mayores a 30 días ni separaciones vencidas.</div>}
            {gestion.length > 40 && <div className="ley-ayuda">… y {gestion.length - 40} más (ver Cartera)</div>}
          </div>
        </div>
      </aside>

      <div className="mapa-wrap">
        <div id="mapa" ref={contenedor} />
        <button type="button" className="btn-panel" onClick={() => setPanel(true)}><SlidersHorizontal />Resumen y filtros</button>
        <button type="button" className={`nfl-btn ${modoSel ? 'activo' : ''}`} onClick={() => (modoSel ? salirSeleccion() : setModoSel(true))}>
          <Layers /><span>{modoSel ? 'Salir de la selección' : 'Seleccionar varios lotes'}</span></button>
        {modoSel && <PanelSeleccion sel={selMulti} porId={porId} props={props} quitar={alternarLote} limpiar={() => setSelMulti([])} cerrar={salirSeleccion}
          vender={() => setFormBloque([...selMulti])} />}
        <div className="nfl-caja" ref={cajaSel} hidden />
        <div className="tooltip" style={tt ? { display: 'block', left: tt.x, top: tt.y } : undefined}>
          {tt && <Tooltip l={porId[tt.id]} p={props[tt.id]} />}
        </div>
        <div className="mapa-pie"><span><Info /> Toque un lote para ver su ficha</span><span>{coords}</span></div>
        {error && <div className="avisos"><div className="aviso error">{error}</div></div>}
      </div>

      <aside className={`ficha ${fichaAbierta ? 'abierta' : ''}`}>
        <div className="ficha-cont">{fichaAbierta && detalle && sel && <Ficha d={detalle} props={props[sel]} geo={geo} cerrar={cerrarFicha} config={config} lotes={lotes} recargar={recargarFicha} inicial={accion} />}</div>
      </aside>

      {formBloque && <FormBloque ids={formBloque} porId={porId} config={config} abrir={(id) => { setFormBloque(null); abrirFicha(id) }} listo={refrescar}
        cerrar={(vendido) => { setFormBloque(null); if (vendido) salirSeleccion() }} />}

      {popupEl && detalle && sel && createPortal(
        <Tarjeta d={detalle} p={props[sel]} geo={geo} cerrar={cerrarPopup} abrirFicha={(a) => abrirFicha(sel, a)} />, popupEl)}
    </>
  )
}
