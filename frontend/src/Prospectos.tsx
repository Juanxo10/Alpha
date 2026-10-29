import { useState } from 'react'
import { Calculator, Calendar, FileSignature, FileSpreadsheet, MessageCircle, Pencil, Search, UserPlus } from 'lucide-react'
import { FormVenta } from './Acciones'
import { FormCotizacion } from './Documentos'
import { api, aviso } from './api'
import { fecha, fmtN, fmtN1, m2, pesos } from './formato'
import { Campo, Cargando, Dinero, hoyISO, Kpi, Modal, numeroWhatsApp, sumarDias, useApi, type Datos } from './ui'

const EST: Record<string, [string, string]> = {
  NUEVO: ['Nuevo', '#94A3B8'], CONTACTADO: ['Contactado', '#3B82F6'], VISITA: ['Visita al lote', '#8B5CF6'],
  NEGOCIACION: ['En negociación', '#F5B841'], GANADO: ['Compró', '#17A974'], PERDIDO: ['Perdido', '#DC2626'],
}
const CERRADO = ['GANADO', 'PERDIDO']

function FormProspecto({ p, r, cerrar, listo }: { p: Datos; r: Datos; cerrar: () => void; listo: (id: number) => void }) {
  const { d: cms } = useApi<Datos>('/api/comisionistas')
  return (
    <Modal titulo={p.id ? `Editar · ${p.nombre}` : 'Nuevo prospecto'} ancho cerrar={cerrar} boton={p.id ? 'Guardar' : 'Registrar prospecto'}
      alEnviar={async (x) => { const g = await api<Datos>('/api/prospecto/guardar', { ...x, id: p.id }); aviso('Prospecto guardado'); listo(g.id) }}>
      <div className="form-grid">
        <Campo etq="Nombre" req cls="c2"><input name="nombre" required defaultValue={p.nombre || ''} /></Campo>
        <Campo etq="Celular"><input name="telefono" defaultValue={p.telefono || ''} /></Campo>
        <Campo etq="Correo"><input name="email" type="email" defaultValue={p.email || ''} /></Campo>
        <Campo etq="¿Cómo llegó?"><select name="origen" defaultValue={p.origen || ''}><option value="">—</option>{r.origenes.map((o: string) => <option key={o}>{o}</option>)}</select></Campo>
        <Campo etq="Comisionista / asesor"><select name="comisionista_id" defaultValue={p.comisionista_id || ''}><option value="">—</option>
          {(cms?.comisionistas ?? []).filter((c: Datos) => c.estado === 'ACTIVO').map((c: Datos) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
        <Campo etq="Lotes o manzanas de interés"><input name="lotes_interes" defaultValue={p.lotes_interes || ''} placeholder="MZ05, esquineros…" /></Campo>
        <Campo etq="Presupuesto aproximado"><Dinero name="presupuesto" def={p.presupuesto || 0} /></Campo>
        <Campo etq="Próximo seguimiento"><input type="date" name="fecha_proxima" defaultValue={p.fecha_proxima || sumarDias(hoyISO(), 2)} /></Campo>
        <Campo etq="Acción"><input name="proxima_accion" defaultValue={p.proxima_accion || 'Llamar'} /></Campo>
        <Campo etq="Notas" cls="c2"><textarea name="notas" rows={2} defaultValue={typeof p.notas === 'string' ? p.notas : ''} /></Campo>
      </div>
    </Modal>
  )
}

function Ficha({ p, config, cerrar, editar, listo, lote }: { p: Datos; config: Datos; cerrar: () => void; editar: () => void; listo: () => void; lote: (tit: string, f: (id: string) => void) => void }) {
  const cerrado = CERRADO.includes(p.estado)
  const [nombre, color] = EST[p.estado]
  return (
    <Modal titulo={p.nombre} ancho cerrar={cerrar} boton="Guardar seguimiento" alEnviar={cerrado ? undefined : async (x) => {
      if (x.nota) await api('/api/prospecto/nota', { prospecto_id: p.id, nota: x.nota, fecha_proxima: x.fecha_proxima, proxima_accion: x.proxima_accion })
      if (x.estado !== p.estado) await api('/api/prospecto/estado', { id: p.id, estado: x.estado, motivo: x.motivo })
      cerrar(); aviso('Seguimiento guardado'); listo()
    }} pie={<>
      <button type="button" className="btn sec" onClick={editar}><Pencil />Editar</button>
      {!cerrado && <button type="button" className="btn sec" onClick={() => lote('Cotizar para ' + p.nombre, (id) => (window as any).__cotizar(id, p))}><Calculator />Cotizar lote</button>}
      {!cerrado && <button type="button" className="btn acento" onClick={() => lote('Lote que compra ' + p.nombre, (id) => (window as any).__vender(id, p))}><FileSignature />Convertir en venta</button>}
      {!cerrado && <button type="button" className="btn sec" disabled={!numeroWhatsApp(p.telefono)}
        onClick={() => window.open(`https://wa.me/${numeroWhatsApp(p.telefono)}?text=${encodeURIComponent(`Buen día, ${p.nombre.split(' ')[0]}. Le escribimos de ${config.proyecto}.`)}`, '_blank')}><MessageCircle />WhatsApp</button>}
    </>}>
      <div className="com-id" style={{ marginBottom: 10 }}>
        <span className="chip" style={{ background: color + '22', color }}>{nombre}</span>
        <span>{p.telefono}{p.email && ' · ' + p.email}{p.origen && ' · ' + p.origen}</span>
      </div>
      <dl className="dl" style={{ marginBottom: 12 }}>
        <dt>Interés</dt><dd>{p.lotes_interes || '—'}</dd><dt>Presupuesto</dt><dd>{p.presupuesto ? pesos(p.presupuesto) : '—'}</dd>
        <dt>Asesor</dt><dd>{p.comisionista || '—'}</dd><dt>Próximo paso</dt><dd>{p.fecha_proxima ? fecha(p.fecha_proxima) + ' · ' + (p.proxima_accion || '') : '—'}</dd>
        {p.motivo_perdida && <><dt>Motivo de pérdida</dt><dd>{p.motivo_perdida}</dd></>}
      </dl>
      {!cerrado && (
        <div className="form-grid" style={{ marginBottom: 10 }}>
          <div className="form-sec">Registrar seguimiento</div>
          <Campo etq="Nota" cls="c2"><input name="nota" placeholder="Qué se habló…" /></Campo>
          <Campo etq="Próximo seguimiento"><input type="date" name="fecha_proxima" defaultValue={sumarDias(hoyISO(), 3)} /></Campo>
          <Campo etq="Acción"><input name="proxima_accion" defaultValue="Llamar" /></Campo>
          <Campo etq="Mover a"><select name="estado" defaultValue={p.estado}>{Object.entries(EST).filter(([k]) => k !== 'GANADO').map(([k, [n]]) => <option key={k} value={k}>{n}</option>)}</select></Campo>
          <Campo etq="Motivo (si se perdió)"><input name="motivo" /></Campo>
        </div>)}
      <div className="bloque-tit" style={{ margin: '6px 0' }}>Historial</div>
      {p.notas.length ? p.notas.map((n: Datos, i: number) => (
        <div className="bit" key={i}><span className="p" /><div>{n.nota}<br /><span className="q">{fecha(n.fecha)} · {n.usuario}</span></div></div>
      )) : <div className="ley-ayuda">Sin seguimientos.</div>}
    </Modal>
  )
}

export default function Prospectos({ config, lotes }: { config: Datos; lotes: Datos[] }) {
  const { d: r, error, recargar } = useApi<Datos>('/api/prospectos')
  const [q, setQ] = useState(''), [cerr, setCerr] = useState(false)
  const [ver, setVer] = useState<number | null>(null)
  const [form, setForm] = useState<Datos | null>(null)
  const [elegir, setElegir] = useState<{ tit: string; f: (id: string) => void } | null>(null)
  const [cot, setCot] = useState<{ lote: Datos; p: Datos } | null>(null)
  const [venta, setVenta] = useState<{ d: Datos; p: Datos } | null>(null)
  if (!r) return <Cargando error={error} />
  const activos = r.prospectos.filter((p: Datos) => !CERRADO.includes(p.estado)).length
  const cols = Object.keys(EST).filter((e) => cerr || !CERRADO.includes(e))
  const p = ver == null ? null : r.prospectos.find((x: Datos) => x.id === ver)
  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div><h1>Prospectos</h1><p>Interesados en comprar: seguimiento y conversión en ventas.</p></div>
        <div className="botones">
          <a className="btn sec" href="/api/exportar/prospectos.csv"><FileSpreadsheet />Exportar</a>
          <button className="btn pri" onClick={() => setForm({})}><UserPlus />Nuevo prospecto</button>
        </div>
      </div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <Kpi et="Prospectos activos" va={fmtN.format(activos)} sub={`${r.prospectos.length} registrados`} c="#3B82F6" />
        <Kpi et="Seguimientos para hoy" va={fmtN.format(r.seguimientos_hoy)} sub="Llamar o visitar hoy" c="#F5B841" />
        <Kpi et="Seguimientos atrasados" va={fmtN.format(r.atrasados)} sub="Fecha de contacto vencida" c="#DC2626" rojo={!!r.atrasados} />
        <Kpi et="Conversión" va={r.conversion === null ? '—' : `${fmtN1.format(r.conversion)} %`} sub={`${r.embudo.GANADO} compraron · ${r.embudo.PERDIDO} perdidos`} c="#17A974" />
      </div>
      <div className="filtros-tabla">
        <div className="buscador peq"><Search /><input type="search" placeholder="Nombre, teléfono, lote…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="interruptor"><input type="checkbox" checked={cerr} onChange={(e) => setCerr(e.target.checked)} /><span />Ver comprados y perdidos</label>
      </div>
      <div className="kanban" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(220px, 1fr))` }}>
        {cols.map((e) => {
          const ps = r.prospectos.filter((x: Datos) => x.estado === e && (!q || `${x.nombre} ${x.telefono || ''} ${x.lotes_interes || ''}`.toLowerCase().includes(q.toLowerCase())))
          return (
            <div className="kb-col" key={e}>
              <div className="kb-cab" style={{ '--c': EST[e][1] } as React.CSSProperties}>{EST[e][0]}<span>{ps.length}</span></div>
              {ps.map((x: Datos) => (
                <div key={x.id} className={`kb-card ${x.atrasado ? 'atrasado' : ''}`} onClick={() => setVer(x.id)}>
                  <b>{x.nombre}</b>
                  <small>{x.telefono || x.email || ''}{x.origen && ' · ' + x.origen}</small>
                  {x.lotes_interes && <small>Interés: {x.lotes_interes}</small>}
                  {x.fecha_proxima && !CERRADO.includes(x.estado) && <span className="kb-prox"><Calendar />{fecha(x.fecha_proxima)} {x.proxima_accion}</span>}
                  {x.comisionista && <small>Asesor: {x.comisionista}</small>}
                </div>))}
              {!ps.length && <div className="kb-vacio">—</div>}
            </div>)
        })}
      </div>
      {p && !form && !elegir && !cot && !venta && <Ficha p={p} config={config} cerrar={() => setVer(null)} editar={() => setForm(p)} listo={recargar} lote={(tit, f) => {
        Object.assign(window, {
          __cotizar: (id: string, pr: Datos) => setCot({ lote: lotes.find((l) => l.id_lote === id)!, p: pr }),
          __vender: async (id: string, pr: Datos) => { const d = await api<Datos>('/api/lote?id=' + id); setVenta({ d, p: pr }) },
        })
        setElegir({ tit, f })
      }} />}
      {elegir && <ElegirLote lotes={lotes} titulo={elegir.tit} cerrar={() => setElegir(null)} alElegir={(id) => { const f = elegir.f; setElegir(null); f(id) }} />}
      {cot && <FormCotizacion lote={cot.lote} prospecto={cot.p} cerrar={() => setCot(null)} />}
      {venta && <FormVenta d={venta.d} v={venta.d.ventas.find((x: Datos) => x.estado === 'ACTIVA')} prospecto={venta.p} config={config} cerrar={() => setVenta(null)}
        listo={async (m) => { aviso(m); setVer(null); recargar() }} />}
      {form && <FormProspecto p={form} r={r} cerrar={() => setForm(null)} listo={(id) => { setForm(null); setVer(id); recargar() }} />}
    </div>
  )
}

function ElegirLote({ lotes, titulo, cerrar, alElegir }: { lotes: Datos[]; titulo: string; cerrar: () => void; alElegir: (id: string) => void }) {
  const libres = lotes.filter((l) => l.estado === 'DISPONIBLE')
  return (
    <Modal titulo={titulo} cerrar={cerrar} boton="Continuar" alEnviar={async (x) => {
      const id = (x.lote || '').trim().toUpperCase()
      if (!libres.some((l) => l.id_lote === id)) throw new Error('Escriba el código de un lote disponible.')
      alElegir(id)
    }}>
      <div className="form-grid"><Campo etq="Lote disponible" req cls="c2" ayuda={`${libres.length} lotes disponibles`}>
        <input name="lote" list="dlLotes" placeholder="MZ05-L012" required />
        <datalist id="dlLotes">{libres.map((l) => <option key={l.id_lote} value={l.id_lote}>{m2(l.area_m2)} · {l.precio_lista ? pesos(l.precio_lista) : 'sin precio'}</option>)}</datalist>
      </Campo></div>
    </Modal>
  )
}
