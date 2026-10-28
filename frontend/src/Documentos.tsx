/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react'
import { BadgeCheck, Calculator, Download, Eye, File as FileIcon, FileBadge, FileText, FolderOpen, Image as ImageIcon, Stamp, Trash2, Upload } from 'lucide-react'
import { api, aviso, falla } from './api'
import { imprimirDocumento, imprimirHoja } from './plantillas'
import { fecha, fmtN1, pesos } from './formato'
import { imprimirEstadoCuenta } from './imprimir'
import { ContratosLote } from './Contratos'
import { Campo, Dinero, hoyISO, Modal, sumarMeses, Vacio, type Datos } from './ui'

const TIPOS_ADJ = ['Documento de identidad', 'Promesa de compraventa', 'Comprobante de pago', 'Escritura pública', 'Certificado de tradición',
  'Paz y salvo', 'Acuerdo de pago', 'Correspondencia', 'Otro']

export async function generar(doc: string, id: string | number) {
  try { imprimirDocumento(doc, await api(`/api/documento?tipo=${doc}&id=${id}`)) } catch (e) { falla(e) }
}

export function FormCotizacion({ lote, prospecto, cerrar }: { lote: Datos; prospecto?: Datos | null; cerrar: () => void }) {
  const lista = lote.precio_lista || 0
  const [v, setV] = useState(lista), [i, setI] = useState(lista ? Math.round((lista * 0.2) / 100000) * 100000 : 0), [n, setN] = useState(24)
  return (
    <Modal titulo={`Cotizar lote ${lote.id_lote}`} cerrar={cerrar} boton="Generar cotización" alEnviar={async (x) => {
      const r = await api<Datos>('/api/cotizacion', { ...x, id_lote: lote.id_lote, prospecto_id: prospecto?.id })
      cerrar(); aviso(`Cotización COT-${String(r.numero).padStart(5, '0')} creada`); generar('cotizacion', r.id)
    }}>
      <div className="form-grid" onInput={(e) => {
        const t = e.target as HTMLInputElement, num = Number(t.value.replace(/\D/g, '')) || 0
        if (t.name === 'valor') setV(num); if (t.name === 'cuota_inicial') setI(num); if (t.name === 'n_cuotas') setN(+t.value || 0)
      }}>
        <Campo etq="A nombre de" req cls="c2"><input name="nombre" required defaultValue={prospecto?.nombre || ''} /></Campo>
        <Campo etq="Teléfono"><input name="telefono" defaultValue={prospecto?.telefono || ''} /></Campo>
        <Campo etq="Correo"><input name="email" defaultValue={prospecto?.email || ''} /></Campo>
        <Campo etq="Valor del lote" ayuda={lista ? `Lista: ${pesos(lista)}` : 'Sin precio de lista'}><Dinero name="valor" def={lista} /></Campo>
        <Campo etq="Cuota inicial"><Dinero name="cuota_inicial" def={i} /></Campo>
        <Campo etq="Número de cuotas"><input type="number" name="n_cuotas" min="0" max="360" defaultValue={24} /></Campo>
        <Campo etq="Primera cuota"><input type="date" name="fecha_primera" defaultValue={sumarMeses(hoyISO(), 1)} /></Campo>
        <Campo etq="Observación" cls="c2"><input name="observacion" /></Campo>
        <div className="resumen-plan" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><div className="et">Saldo a financiar</div><div className="va">{pesos(v - i)}</div></div>
          <div><div className="et">Cuota</div><div className="va">{n ? pesos((v - i) / n) : 'Contado'}</div></div>
          <div><div className="et">Inicial</div><div className="va">{v ? fmtN1.format((100 * i) / v) + ' %' : '—'}</div></div>
        </div>
      </div>
    </Modal>
  )
}

function FormSubir({ id_lote, cerrar, listo }: { id_lote: string; cerrar: () => void; listo: (m: string) => Promise<void> | void }) {
  return (
    <Modal titulo={`Subir documento · ${id_lote}`} cerrar={cerrar} boton="Subir" alEnviar={async (x) => {
      const f = (document.getElementById('adjArchivo') as HTMLInputElement).files?.[0]
      if (!f) throw new Error('Seleccione el archivo.')
      if (f.size > 15 * 1024 * 1024) throw new Error('El archivo supera 15 MB.')
      const contenido = await new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.onerror = mal; r.readAsDataURL(f) })
      await api('/api/adjunto/subir', { id_lote, tipo: x.tipo, descripcion: x.descripcion, nombre: f.name, contenido })
      cerrar(); await listo('Documento agregado al expediente')
    }}>
      <div className="form-grid">
        <Campo etq="Tipo de documento"><select name="tipo">{TIPOS_ADJ.map((t) => <option key={t}>{t}</option>)}</select></Campo>
        <Campo etq="Archivo (PDF, foto, Word o Excel · máx. 15 MB)"><input type="file" id="adjArchivo" required accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx" /></Campo>
        <Campo etq="Descripción" cls="c2"><input name="descripcion" /></Campo>
      </div>
    </Modal>
  )
}

export function DocsFicha({ d, v, config, libre, recargar, cotizar }: { d: Datos; v?: Datos; config: Datos; libre: boolean; recargar: (m?: string) => Promise<void>; cotizar: () => void }) {
  const l = d.lote, saldo0 = v && v.saldo <= 0.5 && v.etapa !== 'SEPARADO'
  const [subir, setSubir] = useState(false), [ver, setVer] = useState<Datos | null>(null), [borrar, setBorrar] = useState<Datos | null>(null)
  const docs: [string, string, React.ComponentType, string, string, boolean?, (() => void)?][] = v ? [
    ['ficha', l.id_lote, FileBadge, 'Ficha integral del lote', 'Identificación, linderos, negocio y estado de cuenta', false, () => imprimirHoja(d)],
    ['estado', l.id_lote, FileText, 'Estado de cuenta', 'Plan de pagos y pagos recibidos', false, () => imprimirEstadoCuenta(d, config)],
    ['certificado', v.id, BadgeCheck, 'Certificado de pagos', 'Pagos realizados y saldo a la fecha'],
    ['pazysalvo', v.id, Stamp, 'Paz y salvo', saldo0 ? 'El negocio está pagado' : 'Disponible cuando el saldo sea $0', !saldo0],
  ] : [['ficha', l.id_lote, FileBadge, 'Ficha técnica y comercial', 'Para entregar a un interesado', false, () => imprimirHoja(d)]]
  return (
    <>
      {v && <ContratosLote v={v} config={config} recargar={recargar} />}
      <div className="bloque-tit" style={{ marginBottom: 8 }}>Generar documento (imprimir o guardar como PDF)</div>
      <div className="docs-grid">
        {docs.map(([doc, id, Ic, nom, sub, off, fn]) => (
          <button className="doc-btn" key={doc} disabled={off} onClick={() => (fn ? fn() : generar(doc, id))}><Ic /><b>{nom}</b><small>{sub}</small></button>))}
        {libre && <button className="doc-btn" onClick={cotizar}><Calculator /><b>Cotización</b><small>Plan de pagos propuesto a un cliente</small></button>}
      </div>
      <div className="bloque-tit" style={{ margin: '16px 0 8px', display: 'flex', alignItems: 'center' }}>Expediente del lote
        <button className="link" style={{ marginLeft: 'auto' }} onClick={() => setSubir(true)}><Upload /> Subir documento</button></div>
      {d.adjuntos.length ? (
        <table className="mini-tabla"><tbody>{d.adjuntos.map((a: Datos) => (
          <tr key={a.id}><td>{/\.(jpe?g|png|webp|heic)$/i.test(a.nombre) ? <ImageIcon /> : <FileIcon />}</td>
            <td><b>{a.tipo}</b><br /><small style={{ color: 'var(--txt-3)' }}>{a.nombre} · {fmtN1.format(a.tamano / 1024)} KB · {fecha(a.creado)} · {a.usuario}</small>{a.descripcion && <><br /><small>{a.descripcion}</small></>}</td>
            <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
              <button className="link" title="Ver" onClick={() => setVer(a)}><Eye /></button>{' '}
              <a className="link" title="Descargar" href={`/api/adjunto?id=${a.id}`}><Download /></a>{' '}
              <button className="link rojo" title="Eliminar" onClick={() => setBorrar(a)}><Trash2 /></button></td></tr>))}</tbody></table>
      ) : <Vacio Ic={FolderOpen} t="Sin documentos. Suba la cédula, la promesa firmada, comprobantes y escrituras." />}
      {subir && <FormSubir id_lote={l.id_lote} cerrar={() => setSubir(false)} listo={recargar} />}
      {ver && (
        <Modal titulo="Documento" ancho="extra" cerrar={() => setVer(null)} pie={<a className="btn acento" href={`/api/adjunto?id=${ver.id}`}><Download />Descargar</a>}>
          {/\.(jpe?g|png|webp)$/i.test(ver.nombre) ? <img src={`/api/adjunto?id=${ver.id}&ver=1`} style={{ maxWidth: '100%', borderRadius: 8 }} />
            : /\.pdf$/i.test(ver.nombre) ? <iframe src={`/api/adjunto?id=${ver.id}&ver=1`} style={{ width: '100%', height: '70vh', border: 0, borderRadius: 8 }} />
              : <p className="texto-modal">Este tipo de archivo no se puede previsualizar. Descárguelo para abrirlo.</p>}
        </Modal>)}
      {borrar && (
        <Modal titulo="Eliminar documento" cerrar={() => setBorrar(null)} boton="Eliminar" peligro alEnviar={async (x) => {
          await api('/api/adjunto/eliminar', { id: borrar.id, motivo: x.motivo }); setBorrar(null); await recargar('Documento eliminado')
        }}>
          <p className="texto-modal">Se retirará «{borrar.nombre}» del expediente (queda en la auditoría).</p>
          <div className="form-grid"><Campo etq="Motivo" req cls="c2"><input name="motivo" required /></Campo></div>
        </Modal>)}
    </>
  )
}
