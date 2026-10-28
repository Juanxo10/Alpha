/* Bienes recibidos como pago (dación en pago) y permutas. El comprador paga con un vehículo, un inmueble u otro bien: el bien entra
   al inventario del proyecto con su avalúo y su valor de recibo, el valor se abona al lote con un recibo «En especie», se sigue su
   traspaso y, cuando se vende, el dinero entra a la caja con su utilidad o pérdida. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from 'react'
import { Banknote, Ban, Beef, Car, ChevronRight, FileCheck, FileSignature, Home, LandPlot, Package, Receipt, Search, Tractor, TriangleAlert, Info } from 'lucide-react'
import { api, aviso, falla } from './api'
import { fecha, fmtN1, pesos, pesosCorto } from './formato'
import { imprimirRecibo } from './imprimir'
import { MEDIOS } from './Gastos'
import { FormContrato } from './Contratos'
import { ChipNf, subirAdjunto } from './Nuevas'
import { Campo, Cargando, Dinero, hoyISO, Kpi, Modal, Sel, useApi, Vacio, type Datos } from './ui'

const COL_BIEN: Record<string, string> = { RECIBIDO: '#3B82F6', EN_VENTA: '#F5B841', VENDIDO: '#17A974', ANULADO: '#DC2626' }
const COL_TRASPASO: Record<string, string> = { PENDIENTE: '#DC2626', EN_TRAMITE: '#F5B841', HECHO: '#17A974', NO_APLICA: '#94A3B8' }
const ICONO: Record<string, React.ComponentType> = { VEHICULO: Car, INMUEBLE: Home, LOTE: LandPlot, MAQUINARIA: Tractor, SEMOVIENTES: Beef, OTRO: Package }
const CONCEPTOS = ['Cuota', 'Cuota inicial', 'Abono a capital', 'Separación', 'Pago total']
const sinPuntos = (e: React.FormEvent) => Number((e.target as HTMLInputElement).value.replace(/\D/g, '')) || 0
const rojo = 'var(--peligro)', verde = 'var(--menta-osc)'
const Icono = ({ t }: { t: string }) => { const I = ICONO[t] || Package; return <I /> }

// ------------------------------------------------------------------ recibir un bien
function FormRecibirBien({ v, cerrar, listo, config }: { v: Datos; cerrar: () => void; listo: () => Promise<void> | void; config: Datos }) {
  const { d: cat } = useApi<Datos>('/api/bienes?venta_id=0')
  const [tipo, setTipo] = useState('VEHICULO'), [rec, setRec] = useState(0), [av, setAv] = useState(0)
  const [ok, setOk] = useState<Datos | null>(null)
  const [fc, setFc] = useState<Datos | null>(null)
  const soportes = useRef<HTMLInputElement>(null)
  if (!cat) return <Modal titulo="Recibir bien como pago" cerrar={cerrar}><p>Cargando…</p></Modal>
  if (fc) return <FormContrato v={v} tipos={fc.tipos} tipo0={fc.tipo0} bienes={fc.bienes} bloque={null} cerrar={cerrar} listo={listo} config={config} />
  if (ok) return (
    <Modal titulo={`Bien recibido · ${ok.numero}`} cerrar={() => { cerrar(); listo() }} pie={<>
      <button type="button" className="btn sec" onClick={() => imprimirRecibo(ok.recibo, config)}><Receipt />Ver recibo</button>
      <button type="button" className="btn pri" onClick={async () => {
        try {
          const [c, b] = await Promise.all([api<Datos>('/api/contratos?venta_id=0'), api<Datos>(`/api/bienes?venta_id=${v.id}`)])
          const tipo0 = ok.modalidad === 'PERMUTA' ? 'PERMUTA' : 'DACION'
          setFc({ tipos: c.tipos.filter((t: Datos) => t.tipo === tipo0), tipo0, bienes: b.bienes })
        } catch (e) { falla(e) }
      }}><FileSignature />Generar contrato de {ok.modalidad === 'PERMUTA' ? 'permuta' : 'dación en pago'}</button></>}>
      <p className="texto-modal">El bien quedó registrado y se abonó al lote con el <b>recibo de caja N° {String(ok.recibo).padStart(6, '0')}</b> (en especie).
        Siga su traspaso y su venta en <b>Finanzas → Bienes recibidos</b>.</p>
    </Modal>)
  const dif = av ? rec - av : null
  return (
    <Modal titulo={`Recibir bien como pago · ${v.id_lote}`} cerrar={cerrar} ancho boton="Recibir bien y generar recibo" alEnviar={async (x) => {
      const archivos = [...(soportes.current?.files ?? [])]
      const ids: number[] = []
      for (const f of archivos) ids.push(await subirAdjunto(v.id_lote, f, 'Otro', `Soporte de bien recibido: ${x.descripcion}`))
      const r = await api<Datos>('/api/bien/recibir', { ...x, venta_id: v.id, soportes: ids })
      await listo(); setOk({ ...r, modalidad: x.modalidad })
    }}>
      <div className="form-grid" onInput={(e) => {
        const n = (e.target as HTMLInputElement).name
        if (n === 'valor_recibo') setRec(sinPuntos(e)); if (n === 'valor_avaluo') setAv(sinPuntos(e))
      }}>
        <div className="c2 resumen-plan" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><div className="et">Comprador</div><div className="va" style={{ fontSize: 13 }}>{v.nombre}</div></div>
          <div><div className="et">Valor del negocio</div><div className="va">{pesos(v.valor_venta)}</div></div>
          <div><div className="et">Saldo actual</div><div className="va">{pesos(v.saldo)}</div></div></div>
        <Campo etq="Modalidad"><select name="modalidad">{Object.entries(cat.modalidades).map(([k, t]) => <option key={k} value={k}>{t as string}</option>)}</select></Campo>
        <Campo etq="Tipo de bien"><select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>{Object.entries(cat.tipos).map(([k, t]: [string, any]) => <option key={k} value={k}>{t.nombre}</option>)}</select></Campo>
        <Campo etq="Descripción del bien" req cls="c2"><input name="descripcion" required placeholder="Ej.: Chevrolet Spark GT 2019 gris / Casa de dos pisos" /></Campo>
        <Campo etq={cat.tipos[tipo].ident}><input name="identificacion" /></Campo>
        {['VEHICULO', 'MAQUINARIA'].includes(tipo) ? <Campo etq="Marca, modelo y año"><input name="marca_modelo" placeholder="Ej.: Chevrolet Spark GT · 2019" /></Campo>
          : ['INMUEBLE', 'LOTE'].includes(tipo) ? <Campo etq="Ubicación (dirección, municipio)"><input name="ubicacion" /></Campo> : <div />}
        <Campo etq="Propietario actual"><input name="propietario" defaultValue={v.nombre} /></Campo>
        <Campo etq="Documento del propietario"><input name="propietario_doc" defaultValue={`${v.tipo_doc || ''} ${v.documento || ''}`.trim()} /></Campo>
        <div className="form-sec">Valor</div>
        <Campo etq="Avalúo o valor de referencia" ayuda="Avalúo comercial, revista Motor/Fasecolda, catastral…"><Dinero name="valor_avaluo" /></Campo>
        <Campo etq="Fuente del avalúo"><select name="fuente_avaluo">{cat.fuentes.map((f: string) => <option key={f}>{f}</option>)}</select></Campo>
        <Campo etq="Valor por el que se recibe (se abona al lote)" req><Dinero name="valor_recibo" required /></Campo>
        <Campo etq="Fecha de recibo" req><input type="date" name="fecha_recibo" defaultValue={hoyISO()} max={hoyISO()} required /></Campo>
        <Campo etq="Se aplica como"><Sel name="concepto" ops={CONCEPTOS} def={v.inicial_pagada === false ? 'Cuota inicial' : 'Abono a capital'} /></Campo>
        <Campo etq="Observaciones"><input name="observacion" placeholder="Estado del bien, kilometraje, deudas pendientes…" /></Campo>
        <Campo etq="Soportes: tarjeta de propiedad, certificado de tradición, avalúo, fotos (varios archivos)" cls="c2">
          <input type="file" ref={soportes} multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" /></Campo>
        <div className="c2 resumen-plan" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><div className="et">Abono al lote</div><div className="va">{pesos(rec)}</div></div>
          <div><div className="et">Saldo después</div><div className="va">{pesos(Math.max(v.saldo - rec, 0))}</div></div>
          <div><div className="et">Frente al avalúo</div><div className="va" style={{ color: dif !== null && dif > 0 ? rojo : 'inherit' }}>
            {dif === null ? 'Sin avalúo' : `${dif > 0 ? '+' : ''}${fmtN1.format((100 * dif) / av)} %`}</div></div></div>
        <div className="c2">
          {rec > v.saldo + 0.5 ? <div className="alerta-caja mora"><TriangleAlert /><div>El valor supera el saldo del negocio ({pesos(v.saldo)}). Si el bien vale más, la diferencia se arregla aparte con el comprador.</div></div>
            : dif !== null && dif > 0 ? <div className="alerta-caja aviso"><TriangleAlert /><div>Se está recibiendo el bien por <b>más</b> de su avalúo. Verifique el valor: la diferencia es un riesgo de pérdida al venderlo.</div></div>
              : !av ? <div className="alerta-caja aviso"><Info /><div>Recomendado: registre un avalúo o valor de referencia para proteger el negocio.</div></div> : null}
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ detalle y acciones de un bien
function FormTraspaso({ b, cerrar, listo }: { b: Datos; cerrar: () => void; listo: (m: string) => void }) {
  const doc = useRef<HTMLInputElement>(null)
  return (
    <Modal titulo={`Traspaso · ${b.numero}`} cerrar={cerrar} boton="Guardar" alEnviar={async (x) => {
      const f = doc.current?.files?.[0]
      const soportes = f ? [await subirAdjunto(b.id_lote, f, 'Otro', `Traspaso del bien ${b.numero}`)] : []
      await api('/api/bien/traspaso', { id: b.id, ...x, soportes }); cerrar(); listo('Traspaso actualizado')
    }}>
      <div className="form-grid">
        <Campo etq="Estado del traspaso"><select name="traspaso" defaultValue={b.traspaso}>{Object.entries({ PENDIENTE: 'Pendiente', EN_TRAMITE: 'En trámite',
          HECHO: 'Traspasado a nombre del vendedor', NO_APLICA: 'No requiere traspaso' }).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Campo>
        <Campo etq="Fecha del traspaso"><input type="date" name="fecha_traspaso" defaultValue={b.fecha_traspaso || ''} max={hoyISO()} /></Campo>
        <Campo etq="Documento del traspaso (opcional)" cls="c2"><input type="file" ref={doc} accept=".pdf,.jpg,.jpeg,.png,.webp" /></Campo>
      </div>
    </Modal>
  )
}

function FormVenderBien({ b, cerrar, listo }: { b: Datos; cerrar: () => void; listo: (m: string) => void }) {
  const [val, setVal] = useState(0), [cos, setCos] = useState(0)
  const res = val - cos - b.valor_recibo
  return (
    <Modal titulo={`Registrar venta · ${b.numero}`} cerrar={cerrar} boton="Registrar venta" alEnviar={async (x) => {
      const r = await api<Datos>('/api/bien/vender', { id: b.id, ...x }); cerrar()
      listo(`Venta registrada: ${r.resultado < 0 ? 'pérdida' : 'utilidad'} de ${pesos(Math.abs(r.resultado))}`)
    }}>
      <p className="texto-modal">El dinero de esta venta entra a la caja del proyecto. Se recibió por <b>{pesos(b.valor_recibo)}</b>.</p>
      <div className="form-grid" onInput={(e) => { const n = (e.target as HTMLInputElement).name; if (n === 'valor') setVal(sinPuntos(e)); if (n === 'costos') setCos(sinPuntos(e)) }}>
        <Campo etq="Fecha de venta" req><input type="date" name="fecha" defaultValue={hoyISO()} min={b.fecha_recibo} max={hoyISO()} required /></Campo>
        <Campo etq="Valor de venta" req><Dinero name="valor" required /></Campo>
        <Campo etq="Costos de la venta (traspaso, comisión, arreglos)"><Dinero name="costos" /></Campo>
        <Campo etq="Medio"><Sel name="medio" ops={MEDIOS} def="Transferencia" /></Campo>
        <Campo etq="Comprador del bien" cls="c2"><input name="comprador" /></Campo>
        <Campo etq="Observación" cls="c2"><input name="observacion" /></Campo>
        <div className="c2 resumen-plan" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><div className="et">Entra a caja</div><div className="va">{pesos(val - cos)}</div></div>
          <div><div className="et">Valor de recibo</div><div className="va">{pesos(b.valor_recibo)}</div></div>
          <div><div className="et">{res < 0 ? 'Pérdida' : 'Utilidad'}</div><div className="va" style={{ color: res < 0 ? rojo : verde }}>{pesos(Math.abs(res))}</div></div></div>
      </div>
    </Modal>
  )
}

function FormAnularBien({ b, cerrar, listo }: { b: Datos; cerrar: () => void; listo: (m: string) => void }) {
  return (
    <Modal titulo={`Anular · ${b.numero}`} cerrar={cerrar} boton="Anular" peligro alEnviar={async (x) => {
      await api('/api/bien/anular', { id: b.id, motivo: x.motivo }); cerrar(); listo('Bien anulado')
    }}>
      <p className="texto-modal">Se anula el bien y su <b>recibo N° {String(b.recibo || '').padStart(6, '0')}</b>: el abono de {pesos(b.valor_recibo)} deja de contar en el lote (por ejemplo, si el bien se devolvió al comprador).</p>
      <div className="form-grid"><Campo etq="Motivo" req cls="c2"><input name="motivo" required /></Campo></div>
    </Modal>
  )
}

function DetalleBien({ id, cerrar, listo, abrir }: { id: number; cerrar: () => void; listo: (m?: string) => void; abrir: (id: string) => void }) {
  const { d: b, error, recargar } = useApi<Datos>(`/api/bien?id=${id}`)
  const [sub, setSub] = useState<string | null>(null)
  if (!b) return <Modal titulo="Bien recibido" cerrar={cerrar}>{error ? <p role="alert">{error}</p> : <p>Cargando…</p>}</Modal>
  const vivo = ['RECIBIDO', 'EN_VENTA'].includes(b.estado)
  const fila = (et: string, va: React.ReactNode) => (va ? <><dt>{et}</dt><dd>{va}</dd></> : null)
  const despues = (m?: string) => { if (m) aviso(m); recargar(); listo() }
  return (
    <>
      <Modal titulo={`${b.numero} · ${b.tipo_nombre}`} cerrar={cerrar} pie={<>
        {(vivo || b.estado === 'VENDIDO') && <button type="button" className="btn sec" onClick={() => setSub('traspaso')}><FileCheck />Traspaso</button>}
        {vivo && <>
          <button type="button" className="btn sec" onClick={async () => {
            try { await api('/api/bien/estado', { id, estado: b.estado === 'EN_VENTA' ? 'RECIBIDO' : 'EN_VENTA' }); despues('Estado actualizado') } catch (e) { falla(e) }
          }}>{b.estado === 'EN_VENTA' ? 'Quitar de venta' : 'Poner en venta'}</button>
          <button type="button" className="btn acento" onClick={() => setSub('vender')}><Banknote />Registrar venta</button>
          <button type="button" className="btn peligro" onClick={() => setSub('anular')}><Ban />Anular</button></>}</>}>
        <div className="nf-bien-cab"><Icono t={b.tipo} /><div><b>{b.descripcion}</b><br />
          <ChipNf t={b.estado_nombre} c={COL_BIEN[b.estado]} /> <ChipNf t={b.traspaso_nombre} c={COL_TRASPASO[b.traspaso]} /></div></div>
        <dl className="dl">
          {fila('Identificación', b.identificacion)}{fila('Marca / modelo', b.marca_modelo)}{fila('Ubicación', b.ubicacion)}
          {fila('Propietario anterior', [b.propietario, b.propietario_doc].filter(Boolean).join(' · '))}
          {fila('Modalidad', b.modalidad_nombre)}
          {fila('Lote / comprador', <><button className="link" onClick={() => { cerrar(); abrir(b.id_lote) }}>{b.id_lote}</button> · {b.cliente}</>)}
          {fila('Recibido el', `${fecha(b.fecha_recibo)} · recibo N° ${String(b.recibo || '').padStart(6, '0')}`)}
          {fila('Valor de recibo', <b>{pesos(b.valor_recibo)}</b>)}
          {fila('Avalúo', b.valor_avaluo ? <>{pesos(b.valor_avaluo)} ({b.fuente_avaluo || ''}) · {b.dif_avaluo > 0
            ? <span style={{ color: rojo }}>recibido {pesos(b.dif_avaluo)} por encima</span> : 'recibido por debajo o igual'}</> : 'Sin avalúo')}
          {fila('Traspaso', b.fecha_traspaso ? `${b.traspaso_nombre} el ${fecha(b.fecha_traspaso)}` : b.traspaso_nombre)}
          {b.estado === 'VENDIDO' && <>
            {fila('Vendido', <>{fecha(b.venta_fecha)} a {b.venta_comprador || '—'} por <b>{pesos(b.venta_valor)}</b> (costos {pesos(b.venta_costos || 0)})</>)}
            {fila('Resultado', <b style={{ color: b.resultado < 0 ? rojo : verde }}>{b.resultado < 0 ? 'Pérdida' : 'Utilidad'} de {pesos(Math.abs(b.resultado))}</b>)}</>}
          {vivo && fila('Días en inventario', String(b.dias_inventario))}
          {fila('Observaciones', b.observacion)}{b.estado === 'ANULADO' && fila('Anulado', b.motivo_anulacion)}
        </dl>
        {b.adjuntos.length > 0 && <>
          <div className="bloque-tit" style={{ margin: '12px 0 6px' }}>Soportes</div>
          <table className="mini-tabla"><tbody>{b.adjuntos.map((a: Datos) => (
            <tr key={a.id}><td>{a.nombre}</td><td style={{ textAlign: 'right' }}><button type="button" className="link" onClick={() => window.open(`/api/adjunto?id=${a.id}&ver=1`, '_blank')}>Ver</button></td></tr>))}</tbody></table></>}
      </Modal>
      {sub === 'traspaso' && <FormTraspaso b={b} cerrar={() => setSub(null)} listo={despues} />}
      {sub === 'vender' && <FormVenderBien b={b} cerrar={() => setSub(null)} listo={despues} />}
      {sub === 'anular' && <FormAnularBien b={b} cerrar={() => setSub(null)} listo={despues} />}
    </>
  )
}

// ------------------------------------------------------------------ en la ficha del lote
export function BienesFicha({ v, config, recargar }: { v: Datos; config: Datos; recargar: (m?: string) => Promise<void> }) {
  const { d, recargar: otra } = useApi<Datos>(`/api/bienes?venta_id=${v.id}`)
  const [m, setM] = useState<'recibir' | number | null>(null)
  const listo = async () => { otra(); await recargar() }
  return (
    <>
      {v.saldo > 0.5 && (
        <div className="f-sec" style={{ paddingTop: 0 }}><button className="btn sec" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setM('recibir')}>
          <Car />Recibir bien como pago (vehículo, inmueble, permuta)</button></div>)}
      {d && d.bienes.length > 0 && (
        <div className="f-sec"><h4><Car />Bienes recibidos como pago</h4>
          <table className="mini-tabla nf-tabla"><tbody>{d.bienes.map((b: Datos) => (
            <tr key={b.id} className={b.estado === 'ANULADO' ? 'nf-inactivo' : ''}>
              <td><Icono t={b.tipo} /></td>
              <td><b>{b.numero}</b> · {b.tipo_nombre} {b.identificacion || ''}<br /><small>{b.descripcion} · {b.modalidad_nombre} · recibo N° {String(b.recibo || '').padStart(6, '0')}</small></td>
              <td className="d"><b>{pesos(b.valor_recibo)}</b><br /><ChipNf t={b.estado_nombre} c={COL_BIEN[b.estado]} /></td>
              <td style={{ textAlign: 'right' }}><button className="link" title="Ver detalle" onClick={() => setM(b.id)}><ChevronRight /></button></td></tr>))}</tbody></table></div>)}
      {m === 'recibir' && <FormRecibirBien v={v} cerrar={() => setM(null)} listo={listo} config={config} />}
      {typeof m === 'number' && <DetalleBien id={m} cerrar={() => setM(null)} listo={listo} abrir={() => {}} />}
    </>
  )
}

// ------------------------------------------------------------------ página Finanzas → Bienes recibidos
export default function Bienes({ abrir }: { abrir: (id: string) => void; config: Datos }) {
  const { d: r, error, recargar } = useApi<Datos>('/api/bienes')
  const [f, setF] = useState({ estado: '', tipo: '', q: '' })
  const [ver, setVer] = useState<number | null>(null)
  if (!r) return <Cargando error={error} />
  const k = r.kpis, q = f.q.trim().toLowerCase()
  const filas = r.bienes.filter((b: Datos) => (!f.estado || b.estado === f.estado) && (!f.tipo || b.tipo === f.tipo)
    && (!q || `${b.numero} ${b.identificacion} ${b.descripcion} ${b.id_lote} ${b.cliente}`.toLowerCase().includes(q)))
  return (
    <div className="pagina">
      <div className="pagina-cab"><div><h1>Bienes recibidos como pago</h1>
        <p>Vehículos, inmuebles, lotes y otros bienes recibidos en dación en pago o en permuta: su traspaso, su venta y la utilidad o pérdida frente al valor con que se recibieron.</p></div></div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <Kpi et="En inventario" va={pesosCorto(k.inventario_valor)} sub={`${k.inventario_n} bienes sin vender (valor de recibo)`} c="#3B82F6" />
        <Kpi et="Traspasos pendientes" va={k.traspasos_pendientes} sub="Aún no están a nombre del vendedor" c="#DC2626" rojo={!!k.traspasos_pendientes} />
        <Kpi et="Vendidos" va={pesosCorto(k.vendidos_valor)} sub={`${k.vendidos_n} bienes · ${k.resultado < 0 ? 'pérdida' : 'utilidad'} ${pesosCorto(Math.abs(k.resultado))}`} c="#17A974" />
        <Kpi et="Recibido en especie" va={pesosCorto(k.recibido_total)} sub={`Abonado a lotes con bienes${k.sobre_avaluo ? ` · ${k.sobre_avaluo} por encima del avalúo` : ''}`} c="#8B5CF6" />
      </div>
      <div className="filtros-tabla">
        <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="">Todos los estados</option>
          {Object.entries(r.estados).map(([e, t]) => <option key={e} value={e}>{t as string}</option>)}</select>
        <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="">Todos los tipos</option>
          {Object.entries(r.tipos).map(([e, t]: [string, any]) => <option key={e} value={e}>{t.nombre.split(' (')[0]}</option>)}</select>
        <div className="buscador peq"><Search /><input type="search" placeholder="Placa, matrícula, lote o comprador…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        <span style={{ marginLeft: 'auto', color: 'var(--txt-3)' }}>{filas.length} bienes</span></div>
      <div className="tabla-wrap grande">{filas.length ? (
        <table className="datos nf-tabla"><thead><tr><th /><th>Bien</th><th>Lote / comprador</th><th>Recibido</th><th className="d">Avalúo</th><th className="d">Valor de recibo</th><th>Estado</th><th className="d">Resultado</th><th /></tr></thead>
          <tbody>{filas.map((b: Datos) => (
            <tr key={b.id} className={b.estado === 'ANULADO' ? 'nf-inactivo' : ''}>
              <td><Icono t={b.tipo} /></td>
              <td><b>{b.numero}</b> · {b.tipo_nombre} {b.identificacion || ''}<br /><small>{b.descripcion} · {b.modalidad_nombre}</small></td>
              <td><button className="link" onClick={() => abrir(b.id_lote)}>{b.id_lote}</button><br /><small>{b.cliente}</small></td>
              <td>{fecha(b.fecha_recibo)}<br /><small>{['RECIBIDO', 'EN_VENTA'].includes(b.estado) ? `${b.dias_inventario} días` : ''}</small></td>
              <td className="d">{b.valor_avaluo ? pesos(b.valor_avaluo) : '—'}</td>
              <td className="d"><b>{pesos(b.valor_recibo)}</b>{b.dif_avaluo > 0 && <><br /><small style={{ color: rojo }}>+{pesos(b.dif_avaluo)} sobre avalúo</small></>}</td>
              <td><ChipNf t={b.estado_nombre} c={COL_BIEN[b.estado]} /><br />{b.estado !== 'ANULADO' && <ChipNf t={b.traspaso_nombre} c={COL_TRASPASO[b.traspaso]} />}</td>
              <td className="d">{b.resultado === null ? '—' : <b style={{ color: b.resultado < 0 ? rojo : verde }}>{b.resultado < 0 ? '−' : '+'}{pesos(Math.abs(b.resultado))}</b>}</td>
              <td><button className="link" title="Ver y gestionar" onClick={() => setVer(b.id)}><ChevronRight /></button></td></tr>))}</tbody></table>
      ) : <Vacio Ic={Car} t={r.bienes.length ? 'No hay bienes con ese filtro.' : 'Aún no se han recibido bienes como pago. Se registran desde la ficha del lote: «Recibir bien como pago».'} />}</div>
      {ver !== null && <DetalleBien id={ver} cerrar={() => setVer(null)} listo={() => recargar()} abrir={abrir} />}
    </div>
  )
}
