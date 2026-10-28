/* Contratos del negocio: promesa, separación, otrosí, acta de entrega, resciliación, cesión, dación, permuta y promesa en bloque.
   Se generan desde plantillas que el dueño ajusta; quedan numerados, con registro de firma y anulación controlada. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react'
import { Ban, Eye, FileCog, FileDown, FilePlus2, FileSignature, PenLine, Plus, RotateCcw, Search, ShieldCheck, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { api, aviso, falla } from './api'
import { fecha, fechaLarga } from './formato'
import { cabecera, esc, imprimir } from './imprimir'
import { ChipNf, DineroC, subirAdjunto } from './Nuevas'
import { Campo, Cargando, hoyISO, Kpi, Modal, useApi, Vacio, type Datos } from './ui'

const ESTADO: Record<string, [string, string]> = { GENERADO: ['Por firmar', '#F5B841'], FIRMADO: ['Firmado', '#17A974'], ANULADO: ['Anulado', '#DC2626'], REEMPLAZADO: ['Reemplazado', '#94A3B8'] }
const ChipContrato = ({ e }: { e: string }) => <ChipNf t={(ESTADO[e] || [e])[0]} c={(ESTADO[e] || ['', '#94A3B8'])[1]} />

const CSS_CONTRATO = `
  .legal { font-size: 11.2px; line-height: 1.55; text-align: justify; }
  .legal p { margin: 0 0 7px; }
  .legal h2 { font: 600 11.5px Lexend, Arial; color: #0C2E37; margin: 13px 0 5px; display: flex; gap: 7px; align-items: center; break-after: avoid; text-transform: none; letter-spacing: 0; }
  .legal h2 span { width: 17px; height: 17px; border-radius: 50%; background: #7FD8A6; display: inline-grid; place-items: center; font-size: 9.5px; }
  .legal .falta { background: #FEF08A; }
  .plan-contrato { margin: 4px 0 12px; break-inside: avoid; }
  .plan-contrato .pc-tit { font: 600 10.5px Lexend, Arial; color: #0C2E37; margin-bottom: 4px; }
  .plan-contrato table.lista td, .plan-contrato table.lista th { font-size: 9.3px; padding: 2.5px 6px; }
  .firmas.legal-f { display: grid; grid-template-columns: repeat(2, 1fr); gap: 50px 40px; break-inside: avoid; margin-top: 46px; }
  .legal p:has(+ .firmas) { break-after: avoid; }
  .firmas.legal-f.n3 { grid-template-columns: repeat(3, 1fr); gap: 50px 24px; }
  .firmas.legal-f div { border-top: 1px solid #0C2E37; padding-top: 6px; }
  .nf-anulado { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font: 700 90px Lexend, Arial; color: rgba(220,38,38,.16);
    transform: rotate(-24deg); pointer-events: none; }`

export async function imprimirContrato(id: number, c: Datos) {
  try {
    const k = await api<Datos>('/api/contrato?id=' + id)
    const sello = ['ANULADO', 'REEMPLAZADO'].includes(k.estado) ? `<div class="nf-anulado">${k.estado}</div>` : ''
    imprimir(`${k.numero} ${k.tipo_nombre}`, `${sello}${cabecera(c, esc(k.tipo_nombre.toUpperCase()), k.numero,
      `${esc(c.ciudad || '')}, ${fechaLarga((k.fecha_firma || k.generado).slice(0, 10))}`)}${k.texto_html}`, CSS_CONTRATO)
  } catch (e) { falla(e) }
}

const aplica = (t: Datos, v: Datos, bienes: Datos[], bloque: Datos | null) =>
  t.etapas.includes(v.etapa) && t.estados.includes(v.estado ?? 'ACTIVA') && !(t.tipo === 'OTROSI' && v.saldo !== undefined && v.saldo <= 0.5)
  && (!t.modalidad || bienes.some((b) => b.estado !== 'ANULADO' && b.modalidad === t.modalidad)) && (!t.bloque || !!bloque)

// ------------------------------------------------------------------ generar
const Hallazgos = ({ h }: { h?: Datos[] }) => h?.length ? <div className="c2">{h.map((x) =>
  <div key={x.codigo} className={`alerta-caja ${x.nivel === 'error' ? 'mora' : 'aviso'}`} style={{ margin: '0 0 6px' }}><TriangleAlert /><div>{x.nivel === 'error' ? <b>Impide generar: </b> : null}{x.mensaje}</div></div>)}
  <small>Revisión automática de datos completos; no reemplaza la revisión del abogado.</small></div> : null

export function FormContrato({ v, tipos, tipo0, previos, bienes, bloque, cerrar, listo, config }: {
  v: Datos; tipos: Datos[]; tipo0?: string; previos?: Record<string, string>; bienes: Datos[]; bloque: Datos | null; cerrar: () => void; listo: () => Promise<void> | void; config: Datos
}) {
  const [tipo, setTipo] = useState(tipo0 || (tipos.find((t) => t.tipo === 'PROMESA') || tipos[0]).tipo)
  const t = tipos.find((x) => x.tipo === tipo)!
  const bienesDe = (t2: Datos) => bienes.filter((b) => b.estado !== 'ANULADO' && b.modalidad === t2.modalidad)
  const iniciales = (t2: Datos) => Object.fromEntries((t2.campos || []).map((cp: Datos) => [cp.k,
    previos?.[cp.k] ?? (cp.tipo === 'fecha' ? hoyISO() : cp.tipo === 'bien' ? String(bienesDe(t2)[0]?.id ?? '') : cp.tipo === 'bloque' ? String(bloque?.id ?? '') : cp.def ?? '')]))
  const [campos, setCampos] = useState<Record<string, string>>(() => iniciales(t))
  const [previa, setPrevia] = useState<Datos | null>(null)
  useEffect(() => { setCampos(iniciales(t)); setPrevia(null) }, [tipo]) // eslint-disable-line react-hooks/exhaustive-deps
  const pon = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setCampos({ ...campos, [k]: e.target.value })
  const campo = (cp: Datos) => {
    const comun = { name: 'nf_' + cp.k, required: !!cp.req }
    return (
      <Campo key={cp.k} etq={cp.et} req={cp.req} cls={['texto', 'bien', 'bloque'].includes(cp.tipo) ? 'c2' : ''}>
        {cp.tipo === 'bloque' ? <select {...comun} value={campos[cp.k] ?? ''} onChange={pon(cp.k)}>{bloque && <option value={bloque.id}>{bloque.numero} · {bloque.n_lotes} lotes</option>}</select>
          : cp.tipo === 'bien' ? <select {...comun} value={campos[cp.k] ?? ''} onChange={pon(cp.k)}>{bienesDe(t).map((b) =>
            <option key={b.id} value={b.id}>{b.numero} · {b.tipo_nombre} {b.identificacion || ''} · ${new Intl.NumberFormat('es-CO').format(b.valor_recibo)}</option>)}</select>
          : cp.tipo === 'dinero' ? <DineroC {...comun} valor={Number(campos[cp.k] || 0)} set={(n) => setCampos({ ...campos, [cp.k]: String(n) })} />
          : cp.tipo === 'fecha' ? <input type="date" {...comun} value={campos[cp.k] ?? ''} onChange={pon(cp.k)} />
          : <input type="text" {...comun} value={campos[cp.k] ?? ''} onChange={pon(cp.k)} />}
      </Campo>)
  }
  return (
    <Modal titulo={`Nuevo contrato · ${v.id_lote}`} cerrar={cerrar} ancho="extra" boton="Generar e imprimir" alEnviar={async () => {
      const r = await api<Datos>('/api/contrato/generar', { venta_id: v.id, tipo, campos })
      cerrar(); aviso(`Contrato ${r.numero} generado`); imprimirContrato(r.id, config); await listo()
    }}>
      <div className="form-grid">
        <Campo etq="Tipo de contrato" cls="c2"><select value={tipo} onChange={(e) => setTipo(e.target.value)}>{tipos.map((x) => <option key={x.tipo} value={x.tipo}>{x.nombre}</option>)}</select></Campo>
        <div className="c2 ley-ayuda" style={{ padding: 0 }}>{t.ayuda}</div>
        {(t.campos || []).map(campo)}
        <div className="c2"><button type="button" className="btn sec" onClick={async () => {
          try { setPrevia(await api<Datos>('/api/contrato/vista', { venta_id: v.id, tipo, campos })) } catch (e) { falla(e) }
        }}><Eye />Vista previa</button></div>
        {previa && <Hallazgos h={previa.hallazgos} />}
        {previa && <div className="c2 nf-previa"><div className="nf-hoja"><div className="titulo-doc">{String(previa.titulo).toUpperCase()}</div>
          <div dangerouslySetInnerHTML={{ __html: previa.html }} /></div></div>}
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ firma y anulación
function FormFirma({ k, cerrar, listo }: { k: Datos; cerrar: () => void; listo: () => Promise<void> | void }) {
  const archivo = useRef<HTMLInputElement>(null)
  return (
    <Modal titulo={`Registrar firma · ${k.numero}`} cerrar={cerrar} boton="Registrar firma" alEnviar={async (x) => {
      const f = archivo.current?.files?.[0]
      const tipoAdj = k.tipo === 'PROMESA' ? 'Promesa de compraventa' : ['OTROSI', 'SEPARACION'].includes(k.tipo) ? 'Acuerdo de pago' : 'Otro'
      const adjunto_id = f ? await subirAdjunto(k.id_lote, f, tipoAdj, `${k.numero} firmado`) : null
      await api('/api/contrato/firmar', { id: k.id, fecha_firma: x.fecha_firma, adjunto_id })
      cerrar(); aviso(`Firma de ${k.numero} registrada`); await listo()
    }}>
      <p className="texto-modal">Indique la fecha en que las partes firmaron y suba el documento firmado (escaneo o foto). Queda guardado en el expediente del lote.</p>
      <div className="form-grid">
        <Campo etq="Fecha de firma" req><input type="date" name="fecha_firma" defaultValue={hoyISO()} max={hoyISO()} required /></Campo>
        <Campo etq="Documento firmado (PDF o foto · máx. 15 MB)" ayuda="Recomendado: así el contrato firmado queda respaldado en el expediente.">
          <input type="file" ref={archivo} accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" /></Campo>
      </div>
    </Modal>
  )
}

function FormAnularContrato({ k, cerrar, listo }: { k: Datos; cerrar: () => void; listo: () => Promise<void> | void }) {
  return (
    <Modal titulo={`Anular contrato · ${k.numero}`} cerrar={cerrar} boton="Anular" peligro alEnviar={async (x) => {
      await api('/api/contrato/anular', { id: k.id, motivo: x.motivo }); cerrar(); aviso(`Contrato ${k.numero} anulado`); await listo()
    }}>
      <p className="texto-modal">El contrato queda anulado con su número y su texto (no se borra). Si usted es operador, la anulación queda pendiente de aprobación de un dueño.</p>
      <div className="form-grid"><Campo etq="Motivo" req cls="c2"><input name="motivo" required /></Campo></div>
    </Modal>
  )
}

// ------------------------------------------------------------------ una fila de contrato (ficha del lote y página)
function Fila({ k, enFicha, alterar, irALote }: { k: Datos; enFicha?: boolean; alterar: (a: string, k: Datos) => void; irALote?: (id: string) => void }) {
  const vigente = ['GENERADO', 'FIRMADO'].includes(k.estado)
  return (
    <tr className={['ANULADO', 'REEMPLAZADO'].includes(k.estado) ? 'nf-inactivo' : ''}>
      <td><b>{k.numero}</b><br /><small>{k.tipo_nombre}</small></td>
      {!enFicha && <td><button className="link" onClick={() => irALote?.(k.id_lote)}>{k.id_lote}</button><br /><small>{k.cliente}</small></td>}
      <td><ChipContrato e={k.estado} /> {!k.integro && <ChipNf t="Alterado" c="#DC2626" />}<br />
        <small>{k.estado === 'FIRMADO' ? 'Firmado el ' + fecha(k.fecha_firma) : k.estado === 'GENERADO' ? 'Generado el ' + fecha(k.generado) : k.motivo_anulacion || ''}</small></td>
      <td className="nf-acc">
        {vigente && <button className="btn sec peq" title="Imprimir o guardar como PDF" onClick={() => alterar('pdf', k)}><FileDown />PDF</button>}
        {k.estado === 'GENERADO' && <button className="btn acento peq" onClick={() => alterar('firmar', k)}><PenLine />Registrar firma</button>}
        {k.adjunto_id && <button className="link" title="Ver el documento firmado" onClick={() => window.open(`/api/adjunto?id=${k.adjunto_id}&ver=1`, '_blank')}><Eye /></button>}
        {vigente && <button className="link rojo" title="Anular" onClick={() => alterar('anular', k)}><Ban /></button>}
      </td>
    </tr>
  )
}

function useAcciones(config: Datos, listo: () => Promise<void> | void) {
  const [m, setM] = useState<{ a: string; k: Datos } | null>(null)
  const alterar = (a: string, k: Datos) => (a === 'pdf' ? imprimirContrato(k.id, config) : setM({ a, k }))
  const modal = m && (m.a === 'firmar' ? <FormFirma k={m.k} cerrar={() => setM(null)} listo={listo} />
    : <FormAnularContrato k={m.k} cerrar={() => setM(null)} listo={listo} />)
  return { alterar, modal }
}

// ------------------------------------------------------------------ bloque en la pestaña Documentos de la ficha del lote
export function ContratosLote({ v, config, recargar }: { v: Datos; config: Datos; recargar: (m?: string) => Promise<void> }) {
  const { d: r, error, recargar: otra } = useApi<Datos>(`/api/contratos?venta_id=${v.id}`)
  const { d: b } = useApi<Datos>(`/api/bienes?venta_id=${v.id}`)
  const { d: bl } = useApi<Datos>(`/api/bloque/de_venta?venta_id=${v.id}`)
  const [nuevo, setNuevo] = useState(false)
  const listo = async () => { otra(); await recargar() }
  const { alterar, modal } = useAcciones(config, listo)
  if (error) return <div className="nf-bloque"><div className="bloque-tit">Contratos del negocio</div><p role="alert">{error}</p></div>
  if (!r || !b || !bl) return <div className="nf-bloque"><div className="bloque-tit">Contratos del negocio</div><div className="vacio">Cargando…</div></div>
  const disponibles = r.tipos.filter((t: Datos) => aplica(t, v, b.bienes, bl.bloque))
  return (
    <div className="nf-bloque">
      <div className="bloque-tit" style={{ display: 'flex', alignItems: 'center' }}>Contratos del negocio
        {disponibles.length > 0 && <button className="link" style={{ marginLeft: 'auto' }} onClick={() => setNuevo(true)}><FilePlus2 /> Nuevo contrato</button>}</div>
      {r.autorizacion_datos === false && (
        <div className="alerta-caja aviso" style={{ margin: '0 0 8px' }}><ShieldCheck /><div>Este comprador <b>no tiene firmada la autorización de tratamiento de datos personales</b> (Ley 1581 de 2012).
          Genere «Autorización de tratamiento de datos personales» en <b>Nuevo contrato</b>.</div></div>)}
      {r.contratos.length ? <table className="mini-tabla nf-tabla"><tbody>{r.contratos.map((k: Datos) => <Fila key={k.id} k={k} enFicha alterar={alterar} />)}</tbody></table>
        : <div className="vacio" style={{ padding: 10 }}><FileSignature />Aún no hay contratos. {disponibles.some((t: Datos) => t.tipo === 'PROMESA') ? 'Genere la promesa de compraventa.' : ''}</div>}
      {nuevo && <FormContrato v={v} tipos={disponibles} bienes={b.bienes} bloque={bl.bloque} cerrar={() => setNuevo(false)} listo={listo} config={config} />}
      {modal}
    </div>
  )
}

// ------------------------------------------------------------------ página Comercial → Contratos
export default function Contratos({ abrir, config, rol }: { abrir: (id: string) => void; config: Datos; rol: string }) {
  const { d: r, error, recargar } = useApi<Datos>('/api/contratos')
  const [f, setF] = useState({ tipo: '', estado: '', q: '' })
  const [nuevo, setNuevo] = useState<{ v: Datos; tipo: string } | null>(null)
  const [plantillas, setPlantillas] = useState(false)
  const { alterar, modal } = useAcciones(config, async () => recargar())
  if (!r) return <Cargando error={error} />
  const k = r.kpis, q = f.q.trim().toLowerCase()
  const filas = r.contratos.filter((x: Datos) => (!f.tipo || x.tipo === f.tipo) && (!f.estado || x.estado === f.estado)
    && (!q || `${x.numero} ${x.id_lote} ${x.cliente} ${x.documento || ''}`.toLowerCase().includes(q)))
  return (
    <div className="pagina">
      <div className="pagina-cab"><div><h1>Contratos</h1>
        <p>Promesas de compraventa, separaciones, otrosíes, actas de entrega, resciliaciones y cesiones: numerados, con su firma y su documento firmado.</p></div>
        <div className="botones">{rol === 'DUENO' && <button className="btn sec" onClick={() => setPlantillas(true)}><FileCog />Plantillas</button>}</div></div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
        <Kpi et="Firmados" va={k.firmados} sub="Con fecha de firma registrada" c="#17A974" />
        <Kpi et="Por firmar" va={k.por_firmar} sub="Generados, aún sin firma" c="#F5B841" />
        <Kpi et="Ventas sin promesa firmada" va={k.sin_promesa} sub="Negocios vendidos sin respaldo firmado" c="#DC2626" rojo={!!k.sin_promesa} />
        <Kpi et="Sin autorización de datos" va={k.sin_datos} sub="Compradores sin firmar el tratamiento de datos" c="#F97316" rojo={!!k.sin_datos} />
        <Kpi et="Anulados" va={k.anulados} sub={k.alterados ? `${k.alterados} con texto alterado` : 'Conservan su número'} c="#64748B" rojo={!!k.alterados} />
      </div>
      {r.pendientes_promesa.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 16 }}><h3>Ventas sin promesa firmada</h3>
          <table className="mini-tabla"><tbody>{r.pendientes_promesa.map((p: Datos) => (
            <tr key={p.venta_id}><td><button className="link" onClick={() => abrir(p.id_lote)}>{p.id_lote}</button></td><td>{p.cliente}</td><td>Vendido el {fecha(p.fecha_venta)}</td>
              <td style={{ textAlign: 'right' }}><button className="btn sec peq" onClick={() => setNuevo({ v: { id: p.venta_id, id_lote: p.id_lote, etapa: p.etapa, estado: 'ACTIVA' }, tipo: 'PROMESA' })}><FileSignature />Generar promesa</button></td></tr>))}
          </tbody></table></div>)}
      {r.pendientes_datos.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 16 }}><h3>Compradores sin autorización de datos personales</h3>
          <div className="ley-ayuda" style={{ padding: '0 0 8px' }}>La Ley 1581 de 2012 exige contar con la autorización del titular para tratar sus datos. Se firma una vez por comprador.</div>
          <table className="mini-tabla"><tbody>{r.pendientes_datos.map((p: Datos) => (
            <tr key={p.cliente_id}><td>{p.cliente}</td><td>{p.documento || ''}</td><td><button className="link" onClick={() => abrir(p.id_lote)}>{p.id_lote}</button></td>
              <td style={{ textAlign: 'right' }}><button className="btn sec peq" onClick={() => setNuevo({ v: { id: p.venta_id, id_lote: p.id_lote, etapa: p.etapa, estado: 'ACTIVA' }, tipo: 'AUTORIZACION_DATOS' })}><ShieldCheck />Generar autorización</button></td></tr>))}
          </tbody></table></div>)}
      <div className="filtros-tabla">
        <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="">Todos los tipos</option>{r.tipos.map((t: Datos) => <option key={t.tipo} value={t.tipo}>{t.nombre}</option>)}</select>
        <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="">Vigentes y anulados</option><option value="GENERADO">Por firmar</option><option value="FIRMADO">Firmados</option><option value="ANULADO">Anulados</option></select>
        <div className="buscador peq"><Search /><input type="search" placeholder="Número, lote o comprador…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        <span style={{ marginLeft: 'auto', color: 'var(--txt-3)' }}>{filas.length} contratos</span></div>
      <div className="tabla-wrap grande">{filas.length ? (
        <table className="datos nf-tabla"><thead><tr><th>Contrato</th><th>Lote / comprador</th><th>Estado</th><th /></tr></thead>
          <tbody>{filas.map((x: Datos) => <Fila key={x.id} k={x} alterar={alterar} irALote={abrir} />)}</tbody></table>
      ) : <Vacio Ic={FileSignature} t="No hay contratos con ese filtro." />}</div>
      {nuevo && <FormContrato v={nuevo.v} tipos={r.tipos.filter((t: Datos) => t.tipo === nuevo.tipo)} tipo0={nuevo.tipo} bienes={[]} bloque={null}
        cerrar={() => setNuevo(null)} listo={() => recargar()} config={config} />}
      {plantillas && <EditorPlantillas cerrar={() => setPlantillas(false)} />}
      {modal}
    </div>
  )
}

// ------------------------------------------------------------------ editor de plantillas (dueño)
function EditorPlantillas({ cerrar }: { cerrar: () => void }) {
  const { d: r, error } = useApi<Datos>('/api/plantillas')
  const [lista, setLista] = useState<Datos[] | null>(null)
  const [tipo, setTipo] = useState('PROMESA')
  const [texto, setTexto] = useState('')
  const [previa, setPrevia] = useState<Datos | null>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (r) { setLista(r.plantillas); setTexto(r.plantillas.find((p: Datos) => p.tipo === 'PROMESA').texto) } }, [r])
  if (!r || !lista) return <Modal titulo="Plantillas de contratos" cerrar={cerrar}>{error ? <p role="alert">{error}</p> : <p>Cargando…</p>}</Modal>
  const p = lista.find((x) => x.tipo === tipo)!
  const recargar = async (t: string) => {
    const n = await api<Datos>('/api/plantillas'); setLista(n.plantillas); setTipo(t); setTexto(n.plantillas.find((x: Datos) => x.tipo === t).texto); setPrevia(null)
  }
  const elegir = (t: string) => { setTipo(t); setTexto(lista.find((x) => x.tipo === t)!.texto); setPrevia(null) }
  const insertar = (v: string) => {
    const e = ta.current!, i = e.selectionStart
    setTexto(texto.slice(0, i) + `{{${v}}}` + texto.slice(e.selectionEnd))
    setTimeout(() => { e.focus(); e.setSelectionRange(i + v.length + 4, i + v.length + 4) })
  }
  return (
    <Modal titulo="Plantillas de contratos" cerrar={cerrar} ancho="extra" boton="Guardar plantilla" alEnviar={async () => {
      const r2 = await api<Datos>('/api/plantilla/guardar', { tipo, texto })
      aviso(`Plantilla guardada (versión ${r2.version})`); cerrar()
    }}>
      <div className="nf-editor">
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <Campo etq="Contrato"><select value={tipo} onChange={(e) => elegir(e.target.value)}>{lista.map((x) => <option key={x.tipo} value={x.tipo}>{x.nombre}</option>)}</select></Campo>
          <div className="campo"><span>Versión</span><div style={{ padding: '9px 0', color: 'var(--txt-2)' }}>{p.propia ? `Versión ${p.version} · ${fecha(p.actualizado)} · ${p.usuario}` : 'Texto original'}</div></div>
        </div>
        <div className="nf-ed-cols">
          <div><textarea ref={ta} value={texto} onChange={(e) => setTexto(e.target.value)} spellCheck />
            <div className="ley-ayuda" style={{ padding: '6px 0 0' }}>Para usar su propio contrato: <b>Nuevo contrato</b>, pegue su texto o use <b>Importar Word / texto</b>, y ponga <b>{'{{dato}}'}</b> donde van los datos y <b>{'{{firmas}}'}</b> al final. · <b>**texto**</b> negrita · <b>## Título</b> sección · <b>{'{{dato}}'}</b> dato del negocio ·{' '}
              <b>{'{{#dato}}…{{/dato}}'}</b> solo si existe · línea en blanco = nuevo párrafo. Los contratos ya generados no cambian.</div></div>
          <div className="nf-vars">{r.variables.map(([g, ks]: [string, string[]]) => (
            <div key={g} style={{ display: 'contents' }}><div className="nf-vg">{g}</div>{ks.map((v) => <button type="button" key={v} onClick={() => insertar(v)}>{v}</button>)}</div>))}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn sec" onClick={async () => {
            try { setPrevia(await api<Datos>('/api/contrato/vista', { tipo, texto })) } catch (e) { falla(e) }
          }}><Eye />Vista previa con un negocio real</button>
          <button type="button" className="btn sec" onClick={async () => {
            if (!confirm('¿Volver al texto original de este contrato? La versión actual queda guardada en el historial.')) return
            try {
              await api('/api/plantilla/restaurar', { tipo })
              const n = await api<Datos>('/api/plantillas'); setLista(n.plantillas); setTexto(n.plantillas.find((x: Datos) => x.tipo === tipo).texto); setPrevia(null)
              aviso('Se restauró el texto original')
            } catch (e) { falla(e) }
          }}><RotateCcw />Volver al texto original</button>
          <label className="btn sec" style={{ cursor: 'pointer' }}><Upload />Importar Word / texto
            <input type="file" accept=".docx,.txt" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ''
              if (!f) return
              if (texto.trim() && !confirm('El texto actual del editor se reemplaza por el del archivo (aún no se guarda). ¿Continuar?')) return
              try {
                const contenido = await new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.onerror = mal; r.readAsDataURL(f) })
                setTexto((await api<{ texto: string }>('/api/plantilla/importar', { nombre: f.name, contenido })).texto); setPrevia(null)
                aviso('Archivo importado: ponga {{datos}} donde van los datos del negocio, revise y guarde')
              } catch (x) { falla(x) }
            }} /></label>
          <button type="button" className="btn sec" onClick={async () => {
            const nombre = prompt('Nombre del nuevo contrato (ej. Contrato de arrendamiento):'); if (!nombre) return
            const prefijo = prompt('Prefijo para la numeración, 2 a 4 letras (ej. ARR):', nombre.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()); if (!prefijo) return
            try { const n = await api<Datos>('/api/plantilla/nueva', { nombre, prefijo }); await recargar(n.tipo); aviso('Contrato creado: escriba su texto y guárdelo') } catch (e) { falla(e) }
          }}><Plus />Nuevo contrato</button>
          {p.propio && <button type="button" className="btn sec" onClick={async () => {
            if (!confirm(`¿Eliminar el contrato «${p.nombre}»?`)) return
            try { await api('/api/plantilla/eliminar', { tipo }); await recargar('PROMESA'); aviso('Contrato eliminado') } catch (e) { falla(e) }
          }}><Trash2 />Eliminar este contrato</button>}</div>
        {previa && <div className="nf-previa">
          {previa.desconocidas.length > 0 && <div className="alerta-caja mora"><TriangleAlert /><div>Datos que no existen: {previa.desconocidas.join(', ')}</div></div>}
          <div className="nf-hoja"><div className="titulo-doc">{String(previa.titulo).toUpperCase()}</div><div dangerouslySetInnerHTML={{ __html: previa.html }} /></div></div>}
      </div>
    </Modal>
  )
}
