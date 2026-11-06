/* Registro de la escritura (ORIP): etapa «Registrado» de la venta. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BookMarked, Pencil, Undo2 } from 'lucide-react'
import { api } from './api'
import { fecha, pesos } from './formato'
import { subirAdjunto } from './Nuevas'
import { Campo, Dinero, hoyISO, Modal } from './ui'

type Base = { d: any; v: any; cerrar: () => void; listo: (msg: string) => Promise<void> | void }

export function FormRegistro({ d, v, cerrar, listo, editar }: Base & { editar?: boolean }) {
  const r = (editar ? v.registro : null) || {}
  const hoy = hoyISO()
  return (
    <Modal titulo={`${editar ? 'Editar registro' : 'Registro de la escritura'} · ${d.lote.id_lote}`} cerrar={cerrar} ancho
      boton={editar ? 'Guardar cambios' : 'Registrar'}
      alEnviar={async (x) => {
        const f = (id: string) => (document.getElementById(id) as HTMLInputElement).files?.[0]
        const ids: number[] = editar ? [...v.registro.adjuntos] : []
        for (const [id, tipo] of [['regCert', 'Certificado de tradición'], ['regEsc', 'Escritura pública']] as const) {
          const a = f(id)
          if (a) ids.push(await subirAdjunto(d.lote.id_lote, a, tipo, 'Soporte del registro'))
        }
        await api(editar ? '/api/registro/editar' : '/api/registro/registrar', { ...x, venta_id: v.id, adjuntos: ids })
        cerrar(); await listo(editar ? 'Registro actualizado' : 'Escritura registrada: el lote quedó en estado Registrado')
      }}>
      <div className="form-grid">
        <Campo etq="Comprador"><input value={v.nombre} readOnly /></Campo>
        <Campo etq="Escritura"><input readOnly value={v.numero_escritura ? `N° ${v.numero_escritura} del ${fecha(v.fecha_escritura)} · ${v.notaria || ''}` : 'Sin número de escritura'} /></Campo>
        <Campo etq="Fecha de radicación"><input type="date" name="fecha_radicacion" defaultValue={r.fecha_radicacion || ''} max={hoy} /></Campo>
        <Campo etq="Número de turno"><input name="numero_turno" defaultValue={r.numero_turno || ''} /></Campo>
        <Campo etq="Fecha de registro" req><input type="date" name="fecha_registro" required defaultValue={r.fecha_registro || hoy} max={hoy} min={v.fecha_escritura || undefined} /></Campo>
        <Campo etq="Oficina de registro (ORIP)" req><input name="orip" required defaultValue={r.orip || ''} placeholder="Villavicencio" /></Campo>
        <Campo etq="Matrícula inmobiliaria" req ayuda="Formato NNN-NNNNNN, por ejemplo 230-123456">
          <input name="matricula_inmobiliaria" required defaultValue={r.matricula_inmobiliaria || ''} placeholder="230-123456" pattern="\d{3}-\d{4,8}" title="Formato NNN-NNNNNN, por ejemplo 230-123456" /></Campo>
        <Campo etq="Número de anotación"><input name="numero_anotacion" defaultValue={r.numero_anotacion || ''} /></Campo>
        <Campo etq="Número predial (código catastral)"><input name="numero_predial" defaultValue={r.numero_predial || ''} /></Campo>
        <Campo etq="Propietario inscrito"><input name="propietario_inscrito" defaultValue={r.propietario_inscrito || v.nombre} /></Campo>
        <Campo etq="Derechos de registro"><Dinero name="valor_derechos_registro" def={r.valor_derechos_registro || 0} /></Campo>
        <Campo etq="Impuesto de registro (boleta fiscal)"><Dinero name="valor_impuesto_registro" def={r.valor_impuesto_registro || 0} /></Campo>
        <Campo etq="Certificado de tradición y libertad"><input type="file" id="regCert" accept=".pdf,.jpg,.jpeg,.png,.webp" /></Campo>
        <Campo etq="Escritura registrada"><input type="file" id="regEsc" accept=".pdf,.jpg,.jpeg,.png,.webp" /></Campo>
        <Campo etq="Observaciones" cls="c2"><textarea name="observaciones" rows={2} defaultValue={r.observaciones || ''} /></Campo>
      </div>
    </Modal>
  )
}

export function FormAnularRegistro({ d, v, cerrar, listo }: Base) {
  return (
    <Modal titulo={`Anular registro · ${d.lote.id_lote}`} cerrar={cerrar} boton="Anular registro" peligro
      alEnviar={async (x) => { await api('/api/registro/anular', { venta_id: v.id, motivo: x.motivo }); cerrar(); await listo('Registro anulado') }}>
      <p className="texto-modal">El lote volverá a estado <b>Escriturado</b>. El registro anulado queda en el historial y en la auditoría.</p>
      <div className="form-grid"><Campo etq="Motivo" req cls="c2"><input name="motivo" required /></Campo></div>
    </Modal>
  )
}

export function BloqueRegistro({ d, v, editar, anular, dueno }: { d: any; v: any; editar: () => void; anular: () => void; dueno: boolean }) {
  const r = v.registro
  if (!r) return null
  const soportes = (r.adjuntos || []).map((id: number) => d.adjuntos.find((a: any) => a.id === id)).filter(Boolean)
  return (
    <div className="f-sec"><h4><BookMarked />Registro</h4>
      <dl className="dl">
        <dt>Matrícula</dt><dd className="num">{r.matricula_inmobiliaria}</dd>
        <dt>Oficina (ORIP)</dt><dd>{r.orip}</dd>
        <dt>Fecha de registro</dt><dd className="num">{fecha(r.fecha_registro)}</dd>
        {r.numero_turno && <><dt>Turno</dt><dd>{r.numero_turno}{r.fecha_radicacion ? ` · radicado el ${fecha(r.fecha_radicacion)}` : ''}</dd></>}
        {r.numero_anotacion && <><dt>Anotación</dt><dd>{r.numero_anotacion}</dd></>}
        {r.numero_predial && <><dt>N° predial</dt><dd>{r.numero_predial}</dd></>}
        <dt>Propietario</dt><dd>{r.propietario_inscrito || '—'}</dd>
        {r.valor_derechos_registro > 0 && <><dt>Derechos</dt><dd className="num">{pesos(r.valor_derechos_registro)}</dd></>}
        {r.valor_impuesto_registro > 0 && <><dt>Impuesto</dt><dd className="num">{pesos(r.valor_impuesto_registro)}</dd></>}
        {r.observaciones && <><dt>Observaciones</dt><dd style={{ fontWeight: 400 }}>{r.observaciones}</dd></>}
        {soportes.length > 0 && <><dt>Soportes</dt><dd>{soportes.map((a: any, i: number) => (
          <span key={a.id}>{i > 0 && ' · '}<a className="link" href={`/api/adjunto?id=${a.id}&ver=1`} target="_blank" rel="noreferrer">{a.tipo}</a></span>))}</dd></>}
      </dl>
      <div className="f-acciones" style={{ marginTop: 10 }}>
        <button className="btn sec peq" onClick={editar}><Pencil />Editar registro</button>
        {dueno && <button className="btn peligro peq" onClick={anular}><Undo2 />Anular registro</button>}
      </div>
    </div>
  )
}
