import { useState } from 'react'
import {
  AlertTriangle, BadgeCheck, Bookmark, CalendarCheck, CalendarX, Clock, FileSignature, FileText, HandCoins,
  History, Lock, Pencil, Printer, Receipt, Stamp, Tag, Undo2, UserRound, Handshake, X, Ban, MessageCircle, PhoneCall, CalendarRange, BadgePercent, Plus, Calculator,
} from 'lucide-react'
import { CARTERA, ESTADOS, fecha, fmtN1, m2, pesos, pesosCorto } from './formato'
import PlanoMini from './PlanoMini'
import { FormAnular, FormAsignarComision, FormDesistir, FormEditarComision, FormEscritura, FormInmueble, FormPago, FormPrecio, FormQuitarComision, FormReestructurar, FormSeparar, FormVenta, Recibo } from './Acciones'
import { FormGestion, TIPOS_GESTION } from './Cobranza'
import { ChipCom, pct } from './Comisionistas'
import { imprimirEstadoCuenta, imprimirRecibo } from './imprimir'
import { numeroWhatsApp } from './ui'
import { DocsFicha, FormCotizacion } from './Documentos'
import { BienesFicha } from './Bienes'
import { AvisoBloque, DetalleBloque } from './Bloques'
import type { Detalle, Geo, Props } from './tipos'

export const Chip = ({ k, cat = ESTADOS }: { k: string | null; cat?: Record<string, { nom: string }> }) =>
  k ? <span className={`chip ${k}`}>{cat[k]?.nom ?? k}</span> : null
export const ChipCartera = ({ k }: { k: string | null }) => (k && !['SEPARADO', 'PAGADO'].includes(k) ? <Chip k={k} cat={CARTERA} /> : null)

const ACCIONES: Record<string, string> = {
  PAGO: 'Pago registrado', SEPARACION: 'Lote separado', VENTA: 'Venta registrada', EDITAR_VENTA: 'Negocio modificado',
  ESCRITURA: 'Escrituración', DESISTIMIENTO: 'Desistimiento', ANULAR_PAGO: 'Pago anulado',
  PRECIO_LOTE: 'Precio / bloqueo modificado', CLIENTE_NUEVO: 'Comprador creado',
  CONTRATO_GENERADO: 'Contrato generado', CONTRATO_FIRMADO: 'Firma de contrato', CONTRATO_ANULADO: 'Contrato anulado',
  BIEN_RECIBIDO: 'Bien recibido como pago', BLOQUE_VENTA: 'Venta en bloque', BLOQUE_PAGO: 'Pago de negocio en bloque',
}
const ESTADO_CUOTA: Record<string, string> = {
  PAGADA: 'Pagada', VENCIDA: 'Vencida', VENCIDA_PARCIAL: 'Vencida (parcial)', PARCIAL: 'Abono parcial', PENDIENTE: 'Pendiente',
}
const fmtPct4 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
const fmtHa = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
export const pctPredio = (p: Props) => (p.pct_predio != null ? `${fmtPct4.format(p.pct_predio)} %` : '—')
export const areaPredio = (p: Props) => (p.area_predio_m2 ? `${fmtN1.format(p.area_predio_m2)} m² = ${fmtHa.format(p.area_predio_m2 / 10000)} ha` : '—')
export const cuotaDe = (v: any) => v.plan.find((x: any) => x.n === 1)?.valor ?? 0 // eslint-disable-line @typescript-eslint/no-explicit-any

const Vacio = ({ Ic, t }: { Ic: React.ComponentType; t: string }) => <div className="vacio"><Ic />{t}</div>

/* eslint-disable @typescript-eslint/no-explicit-any */
function Plan({ v }: { v: any }) {
  if (!v.plan.length) return <Vacio Ic={CalendarX} t="Sin plan de pagos." />
  return (
    <table className="mini-tabla">
      <thead><tr><th>Cuota</th><th>Vence</th><th className="d">Valor</th><th className="d">Pendiente</th><th>Estado</th></tr></thead>
      <tbody>{v.plan.map((c: any) => (
        <tr key={c.n}><td>{c.n === 0 ? 'Inicial' : c.n}</td><td>{fecha(c.fecha)}</td><td className="d">{pesos(c.valor)}</td>
          <td className="d">{c.pendiente > 0.5 ? pesos(c.pendiente) : '—'}</td>
          <td><span className={`estado-cuota ${c.estado}`}>{ESTADO_CUOTA[c.estado]}</span></td></tr>))}
      </tbody>
    </table>
  )
}

function Pagos({ v, recibo, anular }: { v: any; recibo: (n: number) => void; anular: (p: any) => void }) {
  if (!v.pagos.length) return <Vacio Ic={Receipt} t="Aún no hay pagos registrados." />
  return (
    <table className="mini-tabla">
      <thead><tr><th>Recibo</th><th>Fecha</th><th>Concepto</th><th className="d">Valor</th><th /></tr></thead>
      <tbody>{[...v.pagos].reverse().map((p: any) => (
        <tr key={p.id} className={p.anulado ? 'anulado' : ''}>
          <td className="num">N° {p.recibo}</td><td>{fecha(p.fecha)}</td>
          <td>{p.concepto}<br /><small style={{ color: 'var(--txt-3)' }}>{p.medio}{p.referencia ? ' · ' + p.referencia : ''}</small></td>
          <td className="d">{pesos(p.valor)}</td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{p.anulado
            ? <span className="chip ANULADO" title={p.motivo_anulacion}>Anulado</span>
            : <><button className="link" title="Imprimir recibo" onClick={() => recibo(p.recibo)}><Printer /></button><button className="link rojo" title="Anular" onClick={() => anular(p)}><Ban /></button></>}</td>
        </tr>))}
      </tbody>
    </table>
  )
}

function Cobro({ v, gestion, wa, reest }: { v: any; gestion: () => void; wa: () => void; reest: () => void }) {
  return (
    <>
      <div className="f-acciones" style={{ marginBottom: 12 }}>
        <button className="btn sec peq" disabled={!numeroWhatsApp(v.telefono)} onClick={wa}><MessageCircle />WhatsApp</button>
        <button className="btn sec peq" onClick={gestion}><PhoneCall />Registrar gestión</button>
        {v.etapa !== 'SEPARADO' && v.saldo > 0.5 && <button className="btn sec peq" onClick={reest}><CalendarRange />Reestructurar plan</button>}
      </div>
      {(v.gestiones || []).length ? v.gestiones.map((g: any) => (
        <div className="bit" key={g.id}><span className="p" style={{ background: '#3B82F6' }} /><div><b>{TIPOS_GESTION[g.tipo]}</b> · {g.resultado}
          {g.compromiso_fecha && <><br /><span className="chip SEPARADO" style={{ marginTop: 3 }}>Compromiso: {fecha(g.compromiso_fecha)}{g.compromiso_valor ? ' · ' + pesos(g.compromiso_valor) : ''}</span></>}
          <br /><span className="q">{fecha(g.fecha)} · {g.usuario}</span></div></div>
      )) : <Vacio Ic={PhoneCall} t="Sin gestiones de cobro registradas." />}
    </>
  )
}

function Historial({ d }: { d: Detalle }) {
  const previas = d.ventas.filter((x) => x.estado === 'DESISTIDA')
  return (
    <>
      {previas.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="bloque-tit" style={{ marginBottom: 6 }}>Negocios anteriores</div>
          {previas.map((x) => (
            <div className="bit" key={x.id}><span className="p" style={{ background: 'var(--peligro)' }} />
              <div><b>{x.nombre}</b> · {pesos(x.valor_venta)}<br />
                <span className="q">Desistió el {fecha(x.fecha_desistimiento)} · pagó {pesos(x.pagado)} · {x.motivo_desistimiento}</span></div></div>))}
        </div>
      )}
      {!d.bitacora.length ? <Vacio Ic={History} t="Sin movimientos registrados." /> : (
        <>
          <div className="bloque-tit" style={{ marginBottom: 6 }}>Bitácora</div>
          {d.bitacora.map((b) => {
            const det = JSON.parse(b.detalle || '{}')
            let txt = ''
            if (b.accion === 'PAGO') txt = `Recibo N° ${det.recibo} · ${pesos(det.valor)} · ${det.medio || ''}`
            else if (b.accion === 'ANULAR_PAGO') txt = `Recibo N° ${det.recibo} · ${det.motivo}`
            else if (b.accion === 'VENTA') txt = `${pesos(det.valor_venta)} · ${det.n_cuotas ? det.n_cuotas + ' cuotas' : 'contado'}`
            else if (b.accion === 'PRECIO_LOTE') txt = `${det.antes ? pesos(det.antes) : 'sin precio'} → ${det.despues ? pesos(det.despues) : 'sin precio'}${det.bloqueado ? ' · bloqueado' : ''}`
            else if (b.accion === 'DESISTIMIENTO') txt = det.motivo
            else if (b.accion === 'CLIENTE_NUEVO') txt = det.nombre
            return (
              <div className="bit" key={b.id}><span className="p" />
                <div><b>{ACCIONES[b.accion] || b.accion}</b>{txt ? ' · ' + txt : ''}<br />
                  <span className="q">{fecha(b.fecha)} {b.fecha.slice(11, 16)} · {b.usuario}</span></div></div>)
          })}
        </>
      )}
    </>
  )
}

type Modal = null | { t: string; [k: string]: any }

export default function Ficha({ d, props: p, geo, cerrar, config, lotes, recargar, inicial }: {
  d: Detalle; props: Props; geo: Geo; cerrar: () => void; config: any; lotes: any[]; recargar: (msg?: string) => Promise<void>; inicial?: string | null
}) {
  const [m, setM] = useState<Modal>(inicial ? { t: inicial } : null)
  const cierra = () => setM(null)
  const [verBloque, setVerBloque] = useState<number | null>(null)
  const l = d.lote, r = d.resumen
  const v = d.ventas.find((x) => x.estado === 'ACTIVA')
  const esSep = v?.etapa === 'SEPARADO'
  const [tab, setTab] = useState<string>(!v || esSep ? (v ? 'pagos' : 'hist') : 'plan')
  const pm2 = l.precio_lista ? l.precio_lista / l.area_m2 : null
  const bloqueado = r.estado === 'BLOQUEADO'

  let alerta: React.ReactNode = null
  if (v) {
    const prox = v.proxima_cuota
    if (esSep) {
      const vence = v.fecha_limite_separacion
      alerta = <div className={`alerta-caja ${r.cartera === 'SEPARACION_VENCIDA' ? 'mora' : 'aviso'}`}><Clock /><div>
        {vence ? (r.cartera === 'SEPARACION_VENCIDA'
          ? <>La separación <b>venció el {fecha(vence)}</b>. Formalice la venta o libere el lote.</>
          : <>Separación vigente hasta el <b>{fecha(vence)}</b>.</>) : 'Separación sin fecha límite.'}</div></div>
    } else if (r.cartera === 'PAGADO') {
      alerta = <div className="alerta-caja ok"><BadgeCheck /><div><b>Negocio pagado en su totalidad.</b>{v.etapa === 'ESCRITURADO' ? ` Escriturado el ${fecha(v.fecha_escritura)}.` : ' Pendiente de escriturar.'}</div></div>
    } else if (v.dias_mora > 0) {
      const venc = v.plan.filter((c: any) => c.estado.startsWith('VENCIDA'))
      alerta = <div className="alerta-caja mora"><AlertTriangle /><div><b>{v.dias_mora} días de mora</b> · {venc.length} cuota{venc.length > 1 ? 's' : ''} vencida{venc.length > 1 ? 's' : ''} por <b>{pesos(v.vencido)}</b>. La más antigua venció el {fecha(venc[0].fecha)}.</div></div>
    } else if (prox) {
      alerta = <div className="alerta-caja ok"><CalendarCheck /><div>Al día. Próxima cuota: <b>{pesos(prox.pendiente)}</b> el {fecha(prox.fecha)}.</div></div>
    }
  }

  return (
    <>
      <div className="f-cab">
        <div className="fila1">
          <div><div className="idl">{l.id_lote}</div><h2>Manzana {l.manzana} · Lote {l.lote}</h2></div>
          <button className="icono" title="Cerrar (Esc)" onClick={cerrar}><X /></button>
        </div>
        <div className="chips"><Chip k={r.estado} /><ChipCartera k={r.cartera} /></div>
      </div>
      {v && <AvisoBloque v={v} ver={setVerBloque} />}
      <div className="f-datos">
        <div><div className="et">Área</div><div className="va">{m2(l.area_m2)}</div></div>
        <div><div className="et">Medidas</div><div className="va">{fmtN1.format(p.frente_m)} × {fmtN1.format(p.fondo_m)}</div></div>
        <div><div className="et">Precio lista</div><div className="va">{l.precio_lista ? pesosCorto(l.precio_lista) : '—'}</div></div>
        <div><div className="et">Valor m²</div><div className="va">{pm2 ? pesos(pm2) : '—'}</div></div>
      </div>
      <div className="f-pct">
        <div className="t-mini"><PlanoMini geo={geo} id={l.id_lote} manzana={l.manzana} ancho={150} alto={72} /></div>
        <div><span>Participación en el predio</span><b>{pctPredio(p)}</b><small>del área total del predio: {areaPredio(p)}</small></div>
      </div>

      {v ? (
        <>
          <div className="f-sec"><div className="finanzas">
            <div className="fin-top"><span className="et" style={{ fontSize: 12, color: 'var(--txt-2)' }}>Avance de pago</span>
              <span className="pct">{fmtN1.format(v.pct_pagado)}<small> %</small></span></div>
            <div className="progreso"><i style={{ width: `${Math.min(v.pct_pagado, 100)}%` }} /></div>
            <div className="fin-grid">
              <div><div className="et">Valor negocio</div><div className="va">{pesos(v.valor_venta)}</div></div>
              <div><div className="et">Pagado</div><div className="va">{pesos(v.pagado)}</div></div>
              <div><div className="et">Saldo</div><div className="va">{pesos(v.saldo)}</div></div>
            </div>{alerta}</div></div>
          <div className="f-sec">
            <div className="f-acciones">
              <button className="btn acento" onClick={() => setM({ t: 'pago' })}><HandCoins />Registrar pago</button>
              {esSep && <button className="btn pri" onClick={() => setM({ t: 'vender' })}><FileSignature />Formalizar venta</button>}
            </div>
            <div className="f-acciones" style={{ marginTop: 8 }}>
              <button className="btn sec peq" onClick={() => imprimirEstadoCuenta(d, config)}><FileText />Estado de cuenta</button>
              <button className="btn sec peq" onClick={() => setM({ t: 'editar' })}><Pencil />Editar negocio</button>
              {v.etapa === 'VENDIDO' && <button className="btn sec peq" onClick={() => setM({ t: 'escritura' })}><Stamp />Escriturar</button>}
              {!esSep && v.saldo > 0.5 && <button className="btn sec peq" onClick={() => setM({ t: 'reest' })}><CalendarRange />Reestructurar plan</button>}
              <button className="btn peligro peq" onClick={() => setM({ t: 'desistir' })}><Undo2 />{esSep ? 'Liberar lote' : 'Desistimiento'}</button>
            </div>
          </div>
          <BienesFicha v={v} config={config} recargar={recargar} />
          <div className="f-sec"><h4><UserRound />Comprador</h4>
            <dl className="dl"><dt>Nombre</dt><dd>{v.nombre}</dd>
              <dt>Documento</dt><dd>{v.tipo_doc} {v.documento || '—'}</dd>
              <dt>Teléfono</dt><dd>{v.telefono || '—'}</dd>
              <dt>Correo</dt><dd>{v.email || '—'}</dd>
              {v.direccion && <><dt>Dirección</dt><dd>{v.direccion}</dd></>}</dl></div>
          <div className="f-sec"><h4><Handshake />Negocio</h4>
            <dl className="dl">
              {v.fecha_separacion && <><dt>Separación</dt><dd className="num">{fecha(v.fecha_separacion)}</dd></>}
              {esSep ? <><dt>Valor pactado</dt><dd className="num">{pesos(v.valor_venta)}</dd></> : <>
                <dt>Fecha de venta</dt><dd className="num">{fecha(v.fecha_venta)}</dd>
                <dt>Valor de venta</dt><dd className="num">{pesos(v.valor_venta)}</dd>
                <dt>Cuota inicial</dt><dd className="num">{pesos(v.cuota_inicial)}</dd>
                <dt>Financiación</dt><dd className="num">{v.n_cuotas ? `${v.n_cuotas} cuotas mensuales de ${pesos(cuotaDe(v))}` : 'Contado'}</dd>
                {v.n_cuotas > 0 && <><dt>Primera cuota</dt><dd className="num">{fecha(v.fecha_primera_cuota)}</dd></>}</>}
              {v.vendedor && <><dt>Asesor</dt><dd>{v.vendedor}</dd></>}
              {v.numero_escritura && <><dt>Escritura</dt><dd>N° {v.numero_escritura} · {v.notaria || ''}</dd></>}
              {v.observacion && <><dt>Observación</dt><dd style={{ fontWeight: 400 }}>{v.observacion}</dd></>}
            </dl></div>
          <div className="f-sec"><h4><BadgePercent />Comisión
            <span className="mas"><button className="link" onClick={() => setM({ t: 'com-asignar' })}><Plus /> Asignar</button></span></h4>
            {(v.comisiones || []).filter((x: any) => x.estado === 'ACTIVA').map((x: any) => (
              <div className="com-ficha" key={x.id}>
                <div className="cf-top"><b>{x.comisionista}</b><ChipCom k={x.estado_comision} /></div>
                <div className="cf-grid"><span>{pct(x.porcentaje)} · {x.regla_nombre}</span><span>Comisión <b>{pesos(x.valor_comision)}</b></span>
                  <span>Causada <b>{pesos(x.causado)}</b></span><span>Pagada <b>{pesos(x.pagado)}</b></span></div>
                <div className="cf-acc"><button className="link" onClick={() => setM({ t: 'com-editar', x })}>Editar</button>
                  {!x.pagado && <button className="link rojo" onClick={() => setM({ t: 'com-quitar', x })}>Quitar</button>}</div></div>
            ))}
            {!(v.comisiones || []).some((x: any) => x.estado === 'ACTIVA') && <div className="ley-ayuda" style={{ padding: 0 }}>Venta sin comisionista asignado.</div>}</div>
          <div className="subtabs">
            {!esSep && <button className={tab === 'plan' ? 'activo' : ''} onClick={() => setTab('plan')}>Plan de pagos<span className="n">{v.plan.length}</span></button>}
            <button className={tab === 'pagos' ? 'activo' : ''} onClick={() => setTab('pagos')}>Pagos<span className="n">{v.pagos.length}</span></button>
            <button className={tab === 'docs' ? 'activo' : ''} onClick={() => setTab('docs')}>Documentos{d.adjuntos.length > 0 && <span className="n">{d.adjuntos.length}</span>}</button>
            <button className={tab === 'cobro' ? 'activo' : ''} onClick={() => setTab('cobro')}>Cobro{(v.gestiones || []).length > 0 && <span className="n">{v.gestiones.length}</span>}</button>
            <button className={tab === 'hist' ? 'activo' : ''} onClick={() => setTab('hist')}>Historial</button>
          </div>
          <div className="f-sec" style={{ border: 0 }}>
            {tab === 'plan' ? <Plan v={v} /> : tab === 'pagos' ? <Pagos v={v} recibo={(n) => imprimirRecibo(n, config)} anular={(x) => setM({ t: 'anular', x })} />
              : tab === 'cobro' ? <Cobro v={v} gestion={() => setM({ t: 'gestion' })} reest={() => setM({ t: 'reest' })} wa={() => {
                window.open(`https://wa.me/${numeroWhatsApp(v.telefono)}?text=${encodeURIComponent(`Buen día, ${(v.nombre || '').split(' ')[0]}. Le escribimos de ${config.proyecto} sobre su lote ${l.id_lote}.`)}`, '_blank')
                setM({ t: 'gestion', tipo: 'WHATSAPP', resultado: 'Mensaje enviado por WhatsApp' })
              }} /> : tab === 'docs' ? <DocsFicha d={d} v={v} config={config} libre={false} recargar={recargar} cotizar={() => {}} /> : <Historial d={d} />}
          </div>
        </>
      ) : (
        <>
          <div className="f-sec">
            {bloqueado && <div className="alerta-caja aviso" style={{ margin: '0 0 12px' }}><Lock /><div><b>Lote bloqueado para la venta.</b>{l.nota ? ' ' + l.nota : ''}</div></div>}
            {!l.precio_lista && !bloqueado && <div className="alerta-caja aviso" style={{ margin: '0 0 12px' }}><Tag /><div>Este lote aún no tiene <b>precio de lista</b>.</div></div>}
            <div className="f-acciones">
              <button className="btn acento" disabled={bloqueado} onClick={() => setM({ t: 'vender' })}><FileSignature />Vender</button>
              <button className="btn pri" disabled={bloqueado} onClick={() => setM({ t: 'separar' })}><Bookmark />Separar</button>
            </div>
            <div className="f-acciones" style={{ marginTop: 8 }}>
              <button className="btn sec peq" onClick={() => setM({ t: 'precio' })}><Tag />Precio y bloqueo</button>
              <button className="btn sec peq" onClick={() => setM({ t: 'inmueble' })}><Pencil />Datos del inmueble</button>
              <button className="btn sec peq" disabled={bloqueado} onClick={() => setM({ t: 'cotizar' })}><Calculator />Cotizar</button>
            </div>
          </div>
          <div className="subtabs">
            <button className={tab === 'docs' ? 'activo' : ''} onClick={() => setTab('docs')}>Documentos{d.adjuntos.length > 0 && <span className="n">{d.adjuntos.length}</span>}</button>
            <button className={tab !== 'docs' ? 'activo' : ''} onClick={() => setTab('hist')}>Historial</button>
          </div>
          <div className="f-sec" style={{ border: 0 }}>{tab === 'docs' ? <DocsFicha d={d} config={config} libre={r.estado === 'DISPONIBLE'} recargar={recargar} cotizar={() => setM({ t: 'cotizar' })} /> : <Historial d={d} />}</div>
        </>
      )}
      {m && <Modales m={m} d={d} v={v} cierra={cierra} config={config} lotes={lotes} recargar={recargar} />}
      {verBloque !== null && <DetalleBloque id={verBloque} cerrar={() => setVerBloque(null)} abrir={() => {}} config={config} listo={() => recargar()} />}
    </>
  )
}

const cobroFicha = (d: any, v: any) => ({
  venta_id: v.id, id_lote: d.lote.id_lote, cliente: v.nombre, telefono: v.telefono, email: v.email,
  tipo: v.vencido > 0.5 ? 'VENCIDA' : 'POR_VENCER', valor: v.vencido > 0.5 ? v.vencido : v.proxima_cuota?.pendiente, dias: v.dias_mora, fecha: v.proxima_cuota?.fecha,
})

function Modales({ m, d, v, cierra, config, recargar }: { m: NonNullable<Modal>; d: any; v: any; cierra: () => void; config: any; lotes: any[]; recargar: (msg?: string) => Promise<void> }) {
  const [rec, setRec] = useState<{ n: number; nota?: string } | null>(null)
  const base = { d, cerrar: cierra, listo: (msg: string) => recargar(msg), config }
  return (
    <>
      {m.t === 'separar' && <FormSeparar {...base} recibo={(n) => setRec({ n })} />}
      {m.t === 'vender' && <FormVenta {...base} v={v} />}
      {m.t === 'editar' && <FormVenta {...base} v={v} editar />}
      {m.t === 'pago' && <FormPago {...base} v={v} recibo={(n, nota) => setRec({ n, nota })} />}
      {m.t === 'anular' && <FormAnular pagoId={m.x.id} info={`Recibo N° ${m.x.recibo} · ${pesos(m.x.valor)}`} cerrar={cierra} listo={(msg) => recargar(msg)} />}
      {m.t === 'desistir' && <FormDesistir {...base} v={v} />}
      {m.t === 'escritura' && <FormEscritura {...base} v={v} />}
      {m.t === 'precio' && <FormPrecio {...base} />}
      {m.t === 'inmueble' && <FormInmueble {...base} />}
      {m.t === 'cotizar' && <FormCotizacion lote={d.lote} cerrar={cierra} />}
      {m.t === 'reest' && <FormReestructurar {...base} v={v} />}
      {m.t === 'com-asignar' && <FormAsignarComision {...base} v={v} />}
      {m.t === 'com-editar' && <FormEditarComision {...base} x={m.x} />}
      {m.t === 'com-quitar' && <FormQuitarComision {...base} x={m.x} />}
      {m.t === 'gestion' && <FormGestion f={cobroFicha(d, v)} tipo={m.tipo} resultado={m.resultado} cerrar={cierra} listo={() => recargar('Gestión registrada')} />}
      {rec && <Recibo n={rec.n} nota={rec.nota} config={config} cerrar={() => setRec(null)} />}
    </>
  )
}
