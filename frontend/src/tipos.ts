import type { FeatureCollection } from 'geojson'

export interface Lote {
  id_lote: string; manzana: number; lote: number; estado: string; cartera: string | null
  cliente: string | null; documento: string | null; venta_id: number | null
  saldo: number; vencido: number; dias_mora: number; precio_lista: number | null; pct_pagado: number
  area_m2?: number; valor_venta?: number; pagado?: number; proxima_fecha?: string; proxima_valor?: number
}
export interface Geo {
  lotes: FeatureCollection; manz: FeatureCollection; manzEtq: FeatureCollection; vias: FeatureCollection
  zv: FeatureCollection; cano: FeatureCollection; limite: FeatureCollection; extra: FeatureCollection[]
}
export interface Orto {
  minzoom: number; maxzoom: number; bounds: [number, number, number, number]; scheme?: 'xyz' | 'tms'
  ext?: string; descripcion?: string; resolucion_cm?: number; atribucion?: string
}
export interface CapaExtra { archivo: string; nombre?: string; tipo?: string; color?: string; visible?: boolean }
export interface ResumenMapa {
  total_lotes: number; conteo: Record<string, number>; recaudado: number; cartera: number; vencido: number
  lotes_mora: number; recaudo_mes: number; valor_vendido: number; valor_separado: number
}
// Detalle de /api/lote: el servidor lo arma en nucleo/cartera.py
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Detalle { lote: any; resumen: any; ventas: any[]; adjuntos: any[]; bitacora: any[] }
export type Props = Record<string, any>
