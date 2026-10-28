import { useMemo, useState } from 'react'
import {
  BadgePercent, Ban, Check, Printer, FileSignature, FileSpreadsheet, HandCoins, History, Hourglass, Pencil, Phone, Receipt, Search, UserPlus, Users, Wallet,
} from 'lucide-react'
import { api, aviso, falla } from './api'
import { imprimirComprobante } from './imprimir'
import { imprimirInformeComisionista } from './plantillas'
import { fecha, fmtN, fmtN1, pesos, pesosCorto } from './formato'
import { MEDIOS } from './Gastos'
import { Campo, Cargando, hoyISO, Kpi, Modal, Sel, useApi, Vacio, type Datos } from './ui'

export const REGLAS_COM: Record<string, { nom: string; ayuda: string }> = {
  RECAUDO: { nom: 'Proporcional al recaudo', ayuda: 'Se causa a medida que el comprador paga el lote.' },
  INICIAL: { nom: 'Al pagarse la cuota inicial', ayuda: 'Se causa completa cuando se paga la cuota inicial.' },
  VENTA: { nom: 'Al firmar la venta', ayuda: 'Se causa completa en el momento de la venta.' },
}
const ESTADOS_COM: Record<string, string> = {
  POR_PAGAR: 'Por pagar', EN_CAUSACION: 'En causación', PAGADA: 'Pagada', EN_SEPARACION: 'Lote separado', VENTA_DESISTIDA: 'Venta desistida', ANULADA: 'Anulada',
}
export const VINCULOS_COM: Record<string, string> = { INDEPENDIENTE: 'Independiente', INMOBILIARIA: 'Inmobiliaria', EMPLEADO: 'Empleado', REFERIDO: 'Referido' }
export const ChipCom = ({ k }: { k: string }) => <span className={`chip COM_${k}`}>{ESTADOS_COM[k] || k}</span>
const viva = (x: Datos) => !['VENTA_DESISTIDA', 'ANULADA'].includes(x.estado_comision)
const fmtPct = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 })
export const pct = (v?: number) => `${fmtPct.format(v || 0)} %`
const ce = (n: number) => `CE ${String(n).padStart(6, '0')}`
const TIPOS_DOC = ['CC', 'CE', 'NIT', 'PP', 'TI', 'PPT']
const ACC_COM: Record<string, string> = {
  COMISIONISTA_NUEVO: 'Comisionista registrado', COMISIONISTA_EDITADO: 'Datos modificados', COMISIONISTA_ESTADO: 'Cambio de estado',
  COMISION_ASIGNADA: 'Comisión asignada', COMISION_EDITADA: 'Comisión modificada', COMISION_ANULADA: 'Comisión retirada',
  COMISION_PAGO: 'Pago de comisiones', COMISION_PAGO_ANULADO: 'Comprobante anulado',
}

// ------------------------------------------------------------------ formularios
function FormComisionista({ cm, cerrar, listo }: { cm: Datos; cerrar: () => void; listo: (id: number, nuevo: boolean) => void }) {
  const t = (k: string, et: string) => <Campo etq={et}><input type="text" name={k} defaultValue={cm[k] || ''} /></Campo>
  return (
    <Modal titulo={cm.id ? `Editar comisionista · ${cm.nombre}` : 'Nuevo comisionista'} ancho cerrar={cerrar} boton={cm.id ? 'Guardar cambios' : 'Registrar comisionista'}
      alEnviar={async (x) => {
        const r = await api<Datos>('/api/comisionista/guardar', { ...x, id: cm.id })
        aviso(cm.id ? 'Comisionista actualizado' : 'Comisionista registrado'); cerrar(); listo(r.id, !cm.id)
      }}>
      <div className="form-grid">
        <div className="form-sec">Identificación</div>
        <Campo etq="Nombre completo o razón social" req cls="c2"><input type="text" name="nombre" required defaultValue={cm.nombre || ''} /></Campo>
        <Campo etq="Tipo de persona"><select name="tipo_persona" defaultValue={cm.tipo_persona || 'NATURAL'}><option value="NATURAL">Persona natural</option><option value="JURIDICA">Persona jurídica</option></select></Campo>
        <Campo etq="Vínculo"><select name="vinculo" defaultValue={cm.vinculo || 'INDEPENDIENTE'}>{Object.entries(VINCULOS_COM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
        <Campo etq="Tipo de documento"><Sel name="tipo_doc" ops={TIPOS_DOC} def={cm.tipo_doc || 'CC'} /></Campo>
        <Campo etq="N° de documento / NIT"><input type="text" name="documento" defaultValue={cm.documento || ''} /></Campo>
        <div className="form-sec">Contacto</div>
        {t('telefono', 'Teléfono')} {t('email', 'Correo electrónico')} {t('direccion', 'Dirección')} {t('ciudad', 'Ciudad')}
        <div className="form-sec">Condiciones de comisión</div>
        <Campo etq="Comisión base (%)" ayuda="Se propone al asignarlo a una venta; se puede ajustar en cada venta."><input type="number" name="porcentaje_defecto" min="0" max="30" step="0.01" defaultValue={cm.porcentaje_defecto ?? 3} /></Campo>
        <Campo etq="Causación de la comisión" ayuda="Cuándo se gana el derecho a cobrarla."><select name="regla_causacion" defaultValue={cm.regla_causacion || 'RECAUDO'}>{Object.entries(REGLAS_COM).map(([k, v]) => <option key={k} value={k}>{v.nom}</option>)}</select></Campo>
        <Campo etq="Retención en la fuente (%)" ayuda="Se descuenta al pagar. Confirme el porcentaje con su contador."><input type="number" name="retencion_pct" min="0" max="20" step="0.01" defaultValue={cm.retencion_pct ?? 0} /></Campo>
        <Campo etq="Fecha de ingreso"><input type="date" name="fecha_ingreso" defaultValue={cm.fecha_ingreso || hoyISO()} /></Campo>
        <div className="form-sec">Cuenta para el pago</div>
        {t('banco', 'Banco')}
        <Campo etq="Tipo de cuenta"><Sel name="tipo_cuenta" ops={['Ahorros', 'Corriente', 'Nequi', 'Daviplata']} def={cm.tipo_cuenta || 'Ahorros'} /></Campo>
        {t('numero_cuenta', 'N° de cuenta')} {t('titular_cuenta', 'Titular de la cuenta')}
        <Campo etq="Observación" cls="c2"><textarea name="observacion" rows={2} defaultValue={cm.observacion || ''} /></Campo>
      </div>
    </Modal>
  )
}

function FormPagar({ d, cerrar, listo }: { d: Datos; cerrar: () => void; listo: (n: number) => void }) {
  const cm = d.comisionista, pend = d.comisiones.filter((x: Datos) => x.por_pagar > 0.5)
  const [sel, setSel] = useState<Record<number, boolean>>(Object.fromEntries(pend.map((x: Datos) => [x.id, true])))
  const [val, setVal] = useState<Record<number, number>>(Object.fromEntries(pend.map((x: Datos) => [x.id, Math.round(x.por_pagar)])))
  const [ret, setRet] = useState(cm.retencion_pct || 0)
  const bruto = pend.reduce((s: number, x: Datos) => s + (sel[x.id] ? val[x.id] : 0), 0)
  const r = Math.round((bruto * ret) / 100)
  return (
    <Modal titulo={`Pagar comisiones · ${cm.nombre}`} ancho cerrar={cerrar} boton="Registrar pago y generar comprobante" alEnviar={async (x) => {
      const items = pend.filter((p: Datos) => sel[p.id]).map((p: Datos) => ({ comision_id: p.id, valor: val[p.id] }))
      const g = await api<Datos>('/api/comision/pagar', { comisionista_id: cm.id, items, ...x })
      aviso(`Pago registrado · comprobante ${ce(g.comprobante)}`); cerrar(); listo(g.comprobante)
    }}>
      <p className="texto-modal">Seleccione las comisiones causadas que se pagan. Se genera un <b>comprobante de egreso</b> con consecutivo.
        {cm.banco && <><br />Cuenta registrada: <b>{cm.banco} {cm.tipo_cuenta} {cm.numero_cuenta}</b>{cm.titular_cuenta && ` · ${cm.titular_cuenta}`}</>}</p>
      <table className="mini-tabla"><thead><tr><th /><th>Lote</th><th>Comprador</th><th className="d">Causada</th><th className="d">Pagada</th><th className="d">Por pagar</th><th className="d" style={{ width: 170 }}>Valor a pagar</th></tr></thead>
        <tbody>{pend.map((x: Datos) => (
          <tr key={x.id}><td><input type="checkbox" checked={sel[x.id]} onChange={(e) => setSel({ ...sel, [x.id]: e.target.checked })} /></td><td><b>{x.id_lote}</b></td><td>{x.cliente}</td>
            <td className="d">{pesos(x.causado)}</td><td className="d">{x.pagado ? pesos(x.pagado) : '—'}</td><td className="d">{pesos(x.por_pagar)}</td>
            <td className="d"><div className="input-dinero"><input className="dinero" inputMode="numeric" value={fmtN.format(val[x.id])}
              onChange={(e) => setVal({ ...val, [x.id]: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></div></td></tr>))}</tbody></table>
      <div className="form-grid" style={{ marginTop: 14 }}>
        <Campo etq="Fecha del pago" req><input type="date" name="fecha" defaultValue={hoyISO()} required /></Campo>
        <Campo etq="Medio de pago"><Sel name="medio" ops={MEDIOS} def="Transferencia" /></Campo>
        <Campo etq="Retención en la fuente (%)"><input type="number" name="retencion_pct" min="0" max="20" step="0.01" value={ret} onChange={(e) => setRet(+e.target.value || 0)} /></Campo>
        <Campo etq="Referencia / comprobante bancario"><input type="text" name="referencia" /></Campo>
        <Campo etq="Observación" cls="c2"><input type="text" name="observacion" /></Campo>
        <div className="resumen-plan" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><div className="et">Valor bruto</div><div className="va">{pesos(bruto)}</div></div>
          <div><div className="et">Retención</div><div className="va">{pesos(r)}</div></div>
          <div><div className="et">Neto a pagar</div><div className="va">{pesos(bruto - r)}</div></div>
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ detalle
function Detalle({ id, pestana, abrir, cerrar, cambio, config }: { id: number; pestana: string; abrir: (l: string) => void; cerrar: () => void; cambio: () => void; config: Datos }) {
  const { d, recargar } = useApi<Datos>('/api/comisionista?id=' + id)
  const [st, setSt] = useState(pestana)
  const [edit, setEdit] = useState(false), [pagar, setPagar] = useState(false), [ok, setOk] = useState<number | null>(null)
  const [anular, setAnular] = useState<Datos | null>(null)
  if (!d) return null
  const cm = d.comisionista, t = d.totales, activo = cm.estado === 'ACTIVO'
  const listo = () => { recargar(); cambio() }
  const f = (et: string, va?: string | null) => <><dt>{et}</dt><dd>{va || '—'}</dd></>
  return (
    <>
      <Modal titulo={cm.nombre} ancho="extra" cerrar={cerrar} pie={<>
        <button type="button" className="btn sec" onClick={() => api('/api/comisionista/estado', { id: cm.id, estado: activo ? 'INACTIVO' : 'ACTIVO' }).then(() => { aviso(`Comisionista ${activo ? 'desactivado' : 'activado'}`); listo() }).catch(falla)}>{activo ? 'Desactivar' : 'Activar'}</button>
        <button type="button" className="btn sec" onClick={() => setEdit(true)}><Pencil />Editar datos</button>
        <button type="button" className="btn sec" onClick={() => imprimirInformeComisionista(d)}><Printer />Informe PDF</button>
        <button type="button" className="btn acento" disabled={!(t.por_pagar > 0.5)} onClick={() => setPagar(true)}><HandCoins />Pagar comisiones</button>
      </>}>
        <div className="com-cab">
          <div className="com-id"><span className={`chip ${activo ? 'DISPONIBLE' : 'BLOQUEADO'}`}>{activo ? 'Activo' : 'Inactivo'}</span>
            <span className="chip VENDIDO">{VINCULOS_COM[cm.vinculo] || cm.vinculo}</span>
            <span>{cm.tipo_doc} {cm.documento || '—'}{cm.telefono && <> · <Phone /> {cm.telefono}</>}{cm.email && ` · ${cm.email}`}</span></div>
          <div className="com-kpis">
            <div><small>Ventas</small><b>{t.ventas}</b></div><div><small>Valor vendido</small><b>{pesosCorto(t.valor_vendido)}</b></div>
            <div><small>Generada</small><b>{pesos(t.generado)}</b></div><div><small>Causada</small><b>{pesos(t.causado)}</b></div>
            <div><small>Pagada</small><b>{pesos(t.pagado)}</b></div><div className={t.por_pagar ? 'malo' : ''}><small>Por pagar</small><b>{pesos(t.por_pagar)}</b></div>
          </div></div>
        <div className="subtabs" style={{ padding: 0, position: 'static' }}>
          {([['com', 'Comisiones', d.comisiones.length], ['pag', 'Pagos', d.pagos.length], ['dat', 'Datos'], ['his', 'Historial']] as [string, string, number?][]).map(([k, n, c]) => (
            <button key={k} type="button" className={st === k ? 'activo' : ''} onClick={() => setSt(k)}>{n}{c !== undefined && <span className="n">{c}</span>}</button>))}
        </div>
        <div style={{ paddingTop: 12 }}>
          {st === 'com' && (!d.comisiones.length ? <Vacio Ic={FileSignature} t="Este comisionista aún no tiene ventas asignadas. Se asignan al vender o separar un lote, o desde la ficha del lote." /> : (
            <div className="tabla-wrap"><table className="datos"><thead><tr><th>Lote</th><th>Comprador</th><th>Fecha</th><th className="d">Valor venta</th><th className="d">%</th><th>Causación</th><th className="d">Comisión</th><th className="d">Recaudo lote</th><th className="d">Causada</th><th className="d">Pagada</th><th className="d">Por pagar</th><th>Estado</th></tr></thead>
              <tbody>{d.comisiones.map((x: Datos) => (
                <tr key={x.id}><td><button type="button" className="link" onClick={() => { cerrar(); abrir(x.id_lote) }}>{x.id_lote}</button></td><td>{x.cliente}</td><td>{fecha(x.fecha_venta)}</td>
                  <td className="d">{pesos(x.valor_venta)}</td><td className="d">{pct(x.porcentaje)}</td><td>{x.regla_nombre}</td><td className="d">{viva(x) ? pesos(x.valor_comision) : '—'}</td>
                  <td className="d">{fmtN1.format(x.pct_recaudo)} %</td><td className="d">{pesos(x.causado)}</td><td className="d">{x.pagado ? pesos(x.pagado) : '—'}</td>
                  <td className="d">{x.por_pagar ? <span className="rojo">{pesos(x.por_pagar)}</span> : '—'}</td><td><ChipCom k={x.estado_comision} /></td></tr>))}</tbody>
              <tfoot><tr><td colSpan={6}>Total</td><td className="d">{pesos(t.generado)}</td><td /><td className="d">{pesos(t.causado)}</td><td className="d">{pesos(t.pagado)}</td><td className="d">{pesos(t.por_pagar)}</td><td /></tr></tfoot></table></div>))}
          {st === 'pag' && (!d.pagos.length ? <Vacio Ic={Receipt} t="Aún no se le han pagado comisiones." /> : (
            <div className="tabla-wrap"><table className="datos"><thead><tr><th>Comprobante</th><th>Fecha</th><th>Lotes</th><th className="d">Bruto</th><th className="d">Retención</th><th className="d">Neto pagado</th><th>Medio</th><th>Referencia</th><th>Registró</th><th /></tr></thead>
              <tbody>{[...d.pagos].reverse().map((p: Datos) => (
                <tr key={p.id} className={p.anulado ? 'anulado' : ''}><td className="num"><b>{ce(p.comprobante)}</b></td><td>{fecha(p.fecha)}</td>
                  <td>{p.detalle.map((x: Datos) => x.id_lote).join(', ')}</td><td className="d">{pesos(p.valor_bruto)}</td><td className="d">{p.retencion ? pesos(p.retencion) : '—'}</td>
                  <td className="d">{pesos(p.valor_neto)}</td><td>{p.medio}</td><td>{p.referencia}</td><td>{p.usuario}</td>
                  <td style={{ textDecoration: 'none' }}>{p.anulado ? <span className="chip ANULADO" title={p.motivo_anulacion}>Anulado</span>
                    : <><button type="button" className="link" title="Imprimir comprobante" onClick={() => imprimirComprobante(p.comprobante, config)}><Printer /></button> <button type="button" className="link rojo" title="Anular" onClick={() => setAnular(p)}><Ban /></button></>}</td></tr>))}</tbody></table></div>))}
          {st === 'dat' && (
            <div className="dos-col">
              <div><div className="bloque-tit" style={{ marginBottom: 8 }}>Identificación y contacto</div><dl className="dl">
                {f('Nombre', cm.nombre)}{f('Persona', cm.tipo_persona === 'JURIDICA' ? 'Jurídica' : 'Natural')}{f('Documento', `${cm.tipo_doc} ${cm.documento || ''}`)}
                {f('Teléfono', cm.telefono)}{f('Correo', cm.email)}{f('Dirección', cm.direccion)}{f('Ciudad', cm.ciudad)}
                {f('Vínculo', VINCULOS_COM[cm.vinculo])}{f('Fecha de ingreso', fecha(cm.fecha_ingreso))}</dl></div>
              <div><div className="bloque-tit" style={{ marginBottom: 8 }}>Condiciones y pago</div><dl className="dl">
                {f('Comisión base', pct(cm.porcentaje_defecto))}{f('Causación', REGLAS_COM[cm.regla_causacion]?.nom)}{f('Retención en la fuente', pct(cm.retencion_pct))}
                {f('Banco', cm.banco)}{f('Tipo de cuenta', cm.tipo_cuenta)}{f('N° de cuenta', cm.numero_cuenta)}{f('Titular', cm.titular_cuenta)}
                {cm.observacion && f('Observación', cm.observacion)}</dl></div></div>)}
          {st === 'his' && (!d.bitacora.length ? <Vacio Ic={History} t="Sin movimientos." /> : d.bitacora.map((b: Datos) => {
            const x = JSON.parse(b.detalle || '{}'); let txt = ''
            if (b.accion === 'COMISION_ASIGNADA') txt = `${b.id_lote} · ${pct(x.porcentaje)} · ${REGLAS_COM[x.regla]?.nom || ''}`
            else if (b.accion === 'COMISION_EDITADA') txt = `${b.id_lote} · ${pct(x.antes?.porcentaje)} → ${pct(x.despues?.porcentaje)}`
            else if (b.accion === 'COMISION_PAGO') txt = `${ce(x.comprobante)} · neto ${pesos(x.neto)} · ${(x.lotes || []).join(', ')}`
            else if (b.accion === 'COMISION_PAGO_ANULADO') txt = `${ce(x.comprobante)} · ${x.motivo}`
            else if (b.accion === 'COMISION_ANULADA') txt = `${b.id_lote} · ${x.motivo}`
            else if (b.accion === 'COMISIONISTA_EDITADO') txt = Object.keys(x.cambios || {}).join(', ')
            else if (b.accion === 'COMISIONISTA_ESTADO') txt = x.estado
            return <div className="bit" key={b.id}><span className="p" /><div><b>{ACC_COM[b.accion] || b.accion}</b>{txt && ' · ' + txt}<br /><span className="q">{fecha(b.fecha)} {b.fecha.slice(11, 16)} · {b.usuario}</span></div></div>
          }))}
        </div>
      </Modal>
      {edit && <FormComisionista cm={cm} cerrar={() => setEdit(false)} listo={() => { setSt('dat'); listo() }} />}
      {pagar && <FormPagar d={d} cerrar={() => setPagar(false)} listo={(n) => { setOk(n); listo() }} />}
      {ok !== null && (
        <Modal titulo="Pago de comisiones registrado" cerrar={() => { setOk(null); setSt('pag') }} pie={<button type="button" className="btn acento" onClick={() => imprimirComprobante(ok, config)}><Printer />Imprimir comprobante</button>}>
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#DCFCE7', color: '#15803D', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}><Check /></div>
            <div style={{ fontFamily: 'var(--f-tit)', fontSize: 18, fontWeight: 600, color: 'var(--teal)' }}>Comprobante de egreso {ce(ok)}</div>
            <p className="texto-modal" style={{ marginTop: 6 }}>Imprímalo y hágalo firmar por el comisionista como constancia del pago.</p></div>
        </Modal>)}
      {anular && (
        <Modal titulo="Anular comprobante de egreso" cerrar={() => setAnular(null)} boton="Anular comprobante" peligro alEnviar={async (x) => {
          await api('/api/comision/pago/anular', { pago_id: anular.id, motivo: x.motivo }); setAnular(null); aviso('Comprobante anulado'); setSt('pag'); listo()
        }}>
          <p className="texto-modal">Se anulará el <b>{ce(anular.comprobante)} · {pesos(anular.valor_neto)}</b>. El comprobante conserva su número y queda marcado como anulado; las comisiones vuelven a quedar por pagar.</p>
          <div className="form-grid"><Campo etq="Motivo de la anulación" req cls="c2"><input type="text" name="motivo" required /></Campo></div>
        </Modal>)}
    </>
  )
}

// ------------------------------------------------------------------ vista
export default function Comisionistas({ abrir, config }: { abrir: (id: string) => void; config: Datos }) {
  const { d: r, error, recargar } = useApi<Datos>('/api/comisionistas')
  const [q, setQ] = useState(''), [est, setEst] = useState('ACTIVO')
  const [ver, setVer] = useState<{ id: number; pestana: string } | null>(null), [nuevo, setNuevo] = useState(false)
  const ls = useMemo(() => (r?.comisionistas ?? []).filter((c: Datos) => (!est || c.estado === est) &&
    (!q || `${c.nombre} ${c.documento || ''} ${c.telefono || ''}`.toLowerCase().includes(q.toLowerCase().trim()))), [r, q, est])
  if (!r) return <Cargando error={error} />
  const t = r.totales, sum = (k: string) => ls.reduce((s: number, c: Datos) => s + (c[k] || 0), 0)
  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div><h1>Comisionistas</h1><p>Asesores e inmobiliarias que venden lotes: comisiones generadas, causadas, pagadas y por pagar.</p></div>
        <div className="botones">
          <a className="btn sec" href="/api/exportar/comisiones.csv"><FileSpreadsheet />Comisiones a Excel</a>
          <a className="btn sec" href="/api/exportar/pagos_comision.csv"><FileSpreadsheet />Pagos a Excel</a>
          <button className="btn pri" onClick={() => setNuevo(true)}><UserPlus />Nuevo comisionista</button>
        </div>
      </div>
      <div className="kpis">
        <Kpi Ic={Users} et="Comisionistas activos" va={fmtN.format(r.activos)} sub={`${fmtN.format(r.comisionistas.length)} registrados`} c="#0C2E37" />
        <Kpi Ic={FileSignature} et="Ventas con comisión" va={fmtN.format(t.ventas)} sub={pesosCorto(t.valor_vendido) + ' vendidos'} c="#3B82F6" />
        <Kpi Ic={BadgePercent} et="Comisiones generadas" va={pesosCorto(t.generado)} sub="Sobre ventas activas" c="#8B5CF6" />
        <Kpi Ic={Hourglass} et="Causadas" va={pesosCorto(t.causado)} sub="Exigibles según la regla" c="#F5B841" />
        <Kpi Ic={Wallet} et="Pagadas" va={pesosCorto(t.pagado)} sub="Con comprobante de egreso" c="#17A974" />
        <Kpi Ic={HandCoins} et="Por pagar" va={pesosCorto(t.por_pagar)} sub={t.anticipado ? `${pesosCorto(t.anticipado)} pagados por anticipado` : 'Causadas y no pagadas'} c="#DC2626" rojo={!!t.por_pagar} />
      </div>
      <div className="filtros-tabla">
        <div className="buscador peq"><Search /><input type="search" placeholder="Nombre, documento o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select value={est} onChange={(e) => setEst(e.target.value)}><option value="">Todos</option><option value="ACTIVO">Activos</option><option value="INACTIVO">Inactivos</option></select>
        <span className="contador">{fmtN.format(ls.length)} comisionistas</span>
      </div>
      <div className="tabla-wrap grande">
        {!ls.length ? <Vacio Ic={Users} pad t={r.comisionistas.length ? 'Ningún comisionista coincide con el filtro.' : 'Aún no hay comisionistas. Regístrelos con el botón «Nuevo comisionista».'} /> : (
          <table className="datos"><thead><tr><th>Comisionista</th><th>Documento</th><th>Teléfono</th><th>Vínculo</th><th className="d">% base</th><th className="d">Ventas</th><th className="d">Valor vendido</th><th className="d">Generada</th><th className="d">Causada</th><th className="d">Pagada</th><th className="d">Por pagar</th><th>Estado</th></tr></thead>
            <tbody>{ls.map((c: Datos) => (
              <tr key={c.id} onClick={() => setVer({ id: c.id, pestana: 'com' })}><td><b>{c.nombre}</b></td><td>{c.tipo_doc} {c.documento || '—'}</td><td>{c.telefono}</td>
                <td>{VINCULOS_COM[c.vinculo] || c.vinculo}</td><td className="d">{pct(c.porcentaje_defecto)}</td><td className="d">{c.ventas || '—'}</td>
                <td className="d">{c.valor_vendido ? pesos(c.valor_vendido) : '—'}</td><td className="d">{c.generado ? pesos(c.generado) : '—'}</td>
                <td className="d">{c.causado ? pesos(c.causado) : '—'}</td><td className="d">{c.pagado ? pesos(c.pagado) : '—'}</td>
                <td className="d">{c.por_pagar ? <span className="rojo">{pesos(c.por_pagar)}</span> : '—'}</td>
                <td><span className={`chip ${c.estado === 'ACTIVO' ? 'DISPONIBLE' : 'BLOQUEADO'}`}>{c.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}</span></td></tr>))}</tbody>
            <tfoot><tr><td colSpan={5}>Total</td><td className="d">{fmtN.format(sum('ventas'))}</td><td className="d">{pesos(sum('valor_vendido'))}</td><td className="d">{pesos(sum('generado'))}</td>
              <td className="d">{pesos(sum('causado'))}</td><td className="d">{pesos(sum('pagado'))}</td><td className="d">{pesos(sum('por_pagar'))}</td><td /></tr></tfoot></table>)}
      </div>
      {ver && <Detalle key={ver.id} config={config} id={ver.id} pestana={ver.pestana} abrir={abrir} cerrar={() => setVer(null)} cambio={recargar} />}
      {nuevo && <FormComisionista cm={{}} cerrar={() => setNuevo(false)} listo={(id) => { recargar(); setVer({ id, pestana: 'com' }) }} />}
    </div>
  )
}
