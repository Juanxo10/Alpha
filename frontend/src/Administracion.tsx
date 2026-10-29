import { useEffect, useState } from 'react'
import { BadgeCheck, BellOff, Check, FileSpreadsheet, LogOut, Search, ShieldAlert, ShieldCheck, User, UserPlus, X, DatabaseBackup, Tags } from 'lucide-react'
import { api, aviso, falla } from './api'
import { fecha, fmtN, pesos } from './formato'
import { Campo, Cargando, Modal, useApi, Vacio, type Datos } from './ui'

export const ROLES: Record<string, string> = { DUENO: 'Dueño', OPERADOR: 'Asistente', CONSULTA: 'Consulta' }
const hora = (s: string) => s.slice(11, 16)

// ------------------------------------------------------------------ aprobaciones
const EST: Record<string, [string, string]> = {
  PENDIENTE: ['Pendiente', 'SEPARADO'], APROBADA: ['Aprobada', 'AL_DIA'], RECHAZADA: ['Rechazada', 'MORA_MAS_90'],
  FALLIDA: ['No se pudo aplicar', 'MORA_90'], CANCELADA: ['Cancelada', 'BLOQUEADO'], VENCIDA: ['Vencida', 'BLOQUEADO'],
}

export function Aprobaciones({ rol, abrir, cambio }: { rol: string; abrir: (id: string) => void; cambio: () => void }) {
  const { d: ls, error, recargar } = useApi<Datos[]>('/api/solicitudes')
  const [res, setRes] = useState<{ id: number; aprobar: boolean } | null>(null)
  if (!ls) return <Cargando error={error} />
  const dueno = rol === 'DUENO', pend = ls.filter((s) => s.estado === 'PENDIENTE'), hist = ls.filter((s) => s.estado !== 'PENDIENTE')
  const listo = () => { recargar(); cambio() }
  return (
    <div className="pagina">
      <div className="pagina-cab"><div><h1>Aprobaciones</h1>
        <p>{dueno ? 'Operaciones sensibles que los operadores pidieron hacer. Nada se aplica hasta que un dueño lo apruebe.' : 'Sus solicitudes enviadas a los dueños y su resultado.'}</p></div></div>
      {pend.length ? (
        <div className="aprob-lista">{pend.map((s) => (
          <div className="aprob" key={s.id}>
            <div className="ap-cab"><span className="ap-n">N° {s.id}</span><span className="chip SEPARADO">Pendiente</span><small>{fecha(s.creado)} {hora(s.creado)} · {s.solicitante}</small></div>
            <div className="ap-txt">{s.resumen}</div>
            <div className="ap-acc">
              {dueno && <><button className="btn acento peq" onClick={() => setRes({ id: s.id, aprobar: true })}><Check />Aprobar</button>
                <button className="btn peligro peq" onClick={() => setRes({ id: s.id, aprobar: false })}><X />Rechazar</button></>}
              <button className="btn sec peq" onClick={() => api('/api/solicitud/cancelar', { id: s.id }).then(() => { aviso('Solicitud cancelada'); listo() }).catch(falla)}>Cancelar solicitud</button>
              {s.id_lote && <button className="link" onClick={() => abrir(s.id_lote)}>Ver lote {s.id_lote}</button>}
            </div>
          </div>))}</div>
      ) : <div className="tarjeta" style={{ marginBottom: 16 }}><Vacio Ic={BadgeCheck} t="No hay solicitudes pendientes." /></div>}
      <div className="tarjeta"><h3>Historial</h3>
        <div className="tabla-wrap"><table className="datos"><thead><tr><th>N°</th><th>Fecha</th><th>Solicitó</th><th>Operación</th><th>Estado</th><th>Resolvió</th><th>Detalle</th></tr></thead>
          <tbody>{hist.length ? hist.map((s) => (
            <tr key={s.id}><td>{s.id}</td><td>{fecha(s.creado)}</td><td>{s.solicitante}</td>
              <td style={{ whiteSpace: 'normal', minWidth: 320 }}>{s.resumen}</td>
              <td><span className={`chip ${EST[s.estado][1]}`}>{EST[s.estado][0]}</span></td>
              <td>{s.resuelto_por}<br /><small>{s.resuelto_en ? fecha(s.resuelto_en) : ''}</small></td>
              <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>{s.motivo_rechazo || (s.estado === 'FALLIDA' ? s.resultado : '') || ''}</td></tr>
          )) : <tr><td colSpan={7} className="vacio">Sin historial.</td></tr>}</tbody></table></div></div>
      {res && (
        <Modal titulo={`${res.aprobar ? 'Aprobar' : 'Rechazar'} solicitud N° ${res.id}`} cerrar={() => setRes(null)} peligro={!res.aprobar}
          boton={res.aprobar ? 'Aprobar y aplicar' : 'Rechazar'} alEnviar={async (x) => {
            const r = await api<Datos>('/api/solicitud/resolver', { id: res.id, aprobar: res.aprobar, motivo: x.motivo })
            setRes(null)
            if (r.estado === 'FALLIDA') aviso('No se pudo aplicar: ' + r.resultado, true)
            else aviso(res.aprobar ? 'Solicitud aprobada y aplicada' : 'Solicitud rechazada')
            listo()
          }}>
          <p className="texto-modal">{res.aprobar ? 'La operación se ejecutará de inmediato a nombre del solicitante, dejando constancia de que usted la aprobó.' : 'La operación no se aplicará. El solicitante verá el motivo.'}</p>
          {!res.aprobar && <div className="form-grid"><Campo etq="Motivo del rechazo" req cls="c2"><input type="text" name="motivo" required /></Campo></div>}
        </Modal>)}
    </div>
  )
}

// ------------------------------------------------------------------ usuarios
function FormUsuario({ u, cerrar, listo }: { u: Datos; cerrar: () => void; listo: () => void }) {
  return (
    <Modal titulo={u.id ? `Editar usuario · ${u.nombre}` : 'Nuevo usuario'} cerrar={cerrar} boton={u.id ? 'Guardar' : 'Crear usuario'}
      alEnviar={async (x) => { await api('/api/usuarios/guardar', { ...x, id: u.id }); cerrar(); aviso('Usuario guardado'); listo() }}>
      <div className="form-grid">
        <Campo etq="Nombre completo" req cls="c2"><input name="nombre" required defaultValue={u.nombre || ''} /></Campo>
        <Campo etq="Usuario (para ingresar)" req><input name="usuario" required defaultValue={u.usuario || ''} autoCapitalize="off" /></Campo>
        <Campo etq="Rol"><select name="rol" defaultValue={u.rol || 'OPERADOR'}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
        <Campo etq="Correo"><input name="email" type="email" defaultValue={u.email || ''} /></Campo>
        <Campo etq="Teléfono"><input name="telefono" defaultValue={u.telefono || ''} /></Campo>
        {!u.id && <Campo etq="Clave inicial (mínimo 6)" req cls="c2" ayuda="Entréguesela a la persona; podrá cambiarla en Mi cuenta."><input name="clave" type="password" required minLength={6} autoComplete="new-password" /></Campo>}
      </div>
    </Modal>
  )
}

export function Usuarios() {
  const { d: us, error, recargar } = useApi<Datos[]>('/api/usuarios')
  const [form, setForm] = useState<Datos | null>(null), [clave, setClave] = useState<Datos | null>(null)
  if (!us) return <Cargando error={error} />
  return (
    <div className="pagina">
      <div className="pagina-cab"><div><h1>Usuarios</h1><p>Quién puede entrar al geovisor y qué puede hacer.</p></div>
        <div className="botones"><button className="btn pri" onClick={() => setForm({})}><UserPlus />Nuevo usuario</button></div></div>
      <div className="roles-ayuda">
        <div><b>Dueño</b><span>Todo, incluidas las aprobaciones, los usuarios, la configuración y la auditoría.</span></div>
        <div><b>Asistente</b><span>Separa, vende a precio de lista, registra pagos, cobranza, prospectos y documentos. Lo sensible (precios, descuentos, anulaciones, desistimientos, gastos, pagos de comisión) queda <b>pendiente de aprobación</b>.</span></div></div>
      <div className="tabla-wrap grande"><table className="datos"><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Correo</th><th>Último ingreso</th><th>Estado</th><th /></tr></thead>
        <tbody>{us.map((u) => (
          <tr key={u.id}><td><b>{u.nombre}</b></td><td>{u.usuario}</td><td>{ROLES[u.rol]}</td><td>{u.email}</td>
            <td>{u.ultimo_acceso ? fecha(u.ultimo_acceso) + ' ' + hora(u.ultimo_acceso) : '—'}</td>
            <td><span className={`chip ${u.activo ? 'DISPONIBLE' : 'BLOQUEADO'}`}>{u.activo ? 'Activo' : 'Inactivo'}</span></td>
            <td style={{ whiteSpace: 'nowrap' }}><button className="link" onClick={() => setForm(u)}>Editar</button> · <button className="link" onClick={() => setClave(u)}>Clave</button> ·{' '}
              <button className={`link ${u.activo ? 'rojo' : ''}`} onClick={() => api('/api/usuarios/estado', { id: u.id, activo: !u.activo }).then(recargar).catch(falla)}>{u.activo ? 'Desactivar' : 'Activar'}</button></td></tr>))}</tbody></table></div>
      {form && <FormUsuario u={form} cerrar={() => setForm(null)} listo={recargar} />}
      {clave && (
        <Modal titulo={`Nueva clave · ${clave.nombre}`} cerrar={() => setClave(null)} boton="Asignar clave"
          alEnviar={async (x) => { await api('/api/usuarios/clave', { id: clave.id, clave: x.clave }); setClave(null); aviso('Clave asignada') }}>
          <p className="texto-modal">Asigna una clave nueva y cierra las sesiones abiertas de ese usuario.</p>
          <div className="form-grid"><Campo etq="Clave nueva (mínimo 6)" req cls="c2"><input name="clave" type="password" required minLength={6} autoComplete="new-password" /></Campo></div>
        </Modal>)}
    </div>
  )
}

// ------------------------------------------------------------------ auditoría
const ACCIONES_TXT: Record<string, string> = {
  PAGO: 'Pago registrado', ANULAR_PAGO: 'Recibo anulado', VENTA: 'Venta', SEPARACION: 'Separación', EDITAR_VENTA: 'Negocio modificado',
  DESISTIMIENTO: 'Desistimiento', ESCRITURA: 'Escrituración', REESTRUCTURACION: 'Plan reestructurado', PRECIO_LOTE: 'Precio de lote',
  PRECIO_MASIVO: 'Precios masivos', CLIENTE_NUEVO: 'Comprador creado', GASTO: 'Gasto', GASTO_ANULADO: 'Gasto anulado',
  PRESUPUESTO: 'Presupuesto', CONCILIACION: 'Conciliación', GESTION_COBRO: 'Gestión de cobro', RECORDATORIO: 'Recordatorio enviado',
  ADJUNTO: 'Documento subido', ADJUNTO_ELIMINADO: 'Documento eliminado', COTIZACION: 'Cotización', PROSPECTO_NUEVO: 'Prospecto',
  INGRESO: 'Ingreso al sistema', SOLICITUD: 'Solicitud de aprobación', SOLICITUD_APROBADA: 'Solicitud aprobada',
  SOLICITUD_RECHAZADA: 'Solicitud rechazada', SOLICITUD_FALLIDA: 'Solicitud no aplicada', SOLICITUD_CANCELADA: 'Solicitud cancelada',
  USUARIO_NUEVO: 'Usuario creado', USUARIO_EDITADO: 'Usuario editado', USUARIO_ESTADO: 'Usuario activado/desactivado',
  USUARIO_CLAVE: 'Clave asignada', CAMBIO_CLAVE: 'Cambio de clave', CONFIG: 'Configuración', CONFIG_SECRETA: 'Claves de alertas',
  TELEGRAM_VINCULADO: 'Telegram vinculado', COMISION_ASIGNADA: 'Comisión asignada', COMISION_EDITADA: 'Comisión modificada',
  COMISION_ANULADA: 'Comisión retirada', COMISION_PAGO: 'Pago de comisiones', COMISION_PAGO_ANULADO: 'Comprobante anulado',
  CONTRATO_GENERADO: 'Contrato generado', CONTRATO_FIRMADO: 'Firma de contrato', CONTRATO_ANULADO: 'Contrato anulado',
  CONTRATO_REEMPLAZADO: 'Contrato reemplazado', PLANTILLA_CONTRATO: 'Plantilla de contrato', BIEN_RECIBIDO: 'Bien recibido como pago',
  DESISTIMIENTO_LIQUIDADO: 'Desistimiento liquidado', DESISTIMIENTO_DEVUELTO: 'Devolución por desistimiento',
  BIEN_TRASPASO: 'Traspaso de bien', BIEN_ESTADO: 'Estado de bien', BIEN_VENDIDO: 'Venta de bien recibido', BIEN_ANULADO: 'Bien anulado',
  BLOQUE_VENTA: 'Venta en bloque', BLOQUE_PAGO: 'Pago de negocio en bloque', BLOQUE_DESCUENTOS: 'Descuentos por volumen',
  COMISIONISTA_NUEVO: 'Comisionista creado', COMISIONISTA_EDITADO: 'Comisionista editado', COMISIONISTA_ESTADO: 'Comisionista activado/desactivado',
}
function resumenDetalle(txt: string) {
  try {
    const x = JSON.parse(txt || '{}')
    return Object.entries(x).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'number' && v > 9999 ? pesos(v) : v}`).join(' · ')
  } catch { return txt }
}

export function Auditoria({ abrir }: { abrir: (id: string) => void }) {
  const [f, setF] = useState({ desde: '', hasta: '', accion: '', usuario: '', q: '' })
  const { d: r, error, recargar } = useApi<Datos>('/api/auditoria?' + new URLSearchParams({ ...f, limite: '800' }))
  const [ultimo, setUltimo] = useState<Datos | null>(null)
  useEffect(() => { if (r) setUltimo(r) }, [r])
  const x = r ?? ultimo
  if (!x) return <Cargando error={error} />
  const integ = x.integridad
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="pagina">
      <div className="pagina-cab"><div><h1>Auditoría</h1><p>Todo lo que se hace en el geovisor queda sellado en una cadena: si alguien altera un registro por fuera del sistema, se detecta.</p></div>
        <div className="botones"><button className="btn sec" onClick={() => api('/api/integridad/verificar', {}).then(() => { recargar(); aviso('Integridad verificada') }).catch(falla)}><ShieldCheck />Verificar integridad</button>
          <a className="btn sec" href="/api/exportar/auditoria.csv"><FileSpreadsheet />Exportar</a></div></div>
      {integ.ok
        ? <div className="alerta-caja ok" style={{ margin: '0 0 14px' }}><ShieldCheck /><div><b>Integridad verificada:</b> los {fmtN.format(integ.registros)} registros de la bitácora, los recibos, comprobantes, gastos y valores de venta coinciden. Revisado {fecha(integ.revisado)} {hora(integ.revisado)}.</div></div>
        : <div className="alerta-caja mora" style={{ margin: '0 0 14px' }}><ShieldAlert /><div><b>Se detectaron {integ.problemas.length} problema(s) de integridad:</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{integ.problemas.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul></div></div>}
      <div className="filtros-tabla">
        <label className="campo-inline">Desde <input type="date" value={f.desde} onChange={set('desde')} /></label>
        <label className="campo-inline">Hasta <input type="date" value={f.hasta} onChange={set('hasta')} /></label>
        <select value={f.accion} onChange={set('accion')}><option value="">Todas las acciones</option>{x.acciones.map((a: string) => <option key={a} value={a}>{ACCIONES_TXT[a] || a}</option>)}</select>
        <div className="buscador peq"><User /><input type="search" placeholder="Usuario…" value={f.usuario} onChange={set('usuario')} /></div>
        <div className="buscador peq"><Search /><input type="search" placeholder="Lote, recibo, texto…" value={f.q} onChange={set('q')} /></div>
        <span className="contador">{fmtN.format(x.filas.length)} registros</span>
      </div>
      <div className="tabla-wrap grande"><table className="datos"><thead><tr><th>N°</th><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Lote</th><th>Detalle</th></tr></thead>
        <tbody>{x.filas.map((b: Datos) => (
          <tr key={b.id}><td>{b.id}</td><td>{fecha(b.fecha)} {hora(b.fecha)}</td><td>{b.usuario}</td><td>{ACCIONES_TXT[b.accion] || b.accion}</td>
            <td>{b.id_lote && <button className="link" onClick={() => abrir(b.id_lote)}>{b.id_lote}</button>}</td>
            <td style={{ whiteSpace: 'normal', fontSize: 11.5, color: 'var(--txt-2)', maxWidth: 620 }}>{resumenDetalle(b.detalle)}</td></tr>))}</tbody></table></div>
    </div>
  )
}

// ------------------------------------------------------------------ avisos (campana)
export function Avisos({ n, irAprob, cerrar, leidos }: { n: Datos; irAprob: () => void; cerrar: () => void; leidos: () => void }) {
  useEffect(() => { if (n.no_leidas) api('/api/notificaciones/leer', {}).then(leidos).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal titulo="Avisos" cerrar={cerrar}>
      {n.aprobaciones > 0 && <div className="alerta-caja aviso" style={{ margin: '0 0 12px', cursor: 'pointer' }} onClick={irAprob}><ShieldAlert /><div><b>{n.aprobaciones} solicitud(es) esperando su aprobación.</b> Clic para revisarlas.</div></div>}
      {n.avisos.length ? n.avisos.map((a: Datos) => (
        <div key={a.id} className={`av-item ${a.estado === 'NO_LEIDA' ? 'nuevo' : ''}`}>
          <div className="av-tit">{a.asunto}<small>{fecha(a.creado)} {hora(a.creado)}</small></div>
          <div className="av-txt" style={{ whiteSpace: 'pre-line' }}>{String(a.texto).replace(/<\/?b>/g, '')}</div></div>
      )) : <Vacio Ic={BellOff} t="No hay avisos." />}
    </Modal>
  )
}

// ------------------------------------------------------------------ mi cuenta
export function Cuenta({ cerrar, salir }: { cerrar: () => void; salir: () => void }) {
  const { d: u } = useApi<Datos>('/api/cuenta')
  if (!u) return null
  return (
    <Modal titulo="Mi cuenta" cerrar={cerrar} boton="Guardar clave" pie={<button type="button" className="btn peligro" onClick={salir}><LogOut />Cerrar sesión</button>}
      alEnviar={async (x) => {
        if (!x.actual || !x.nueva) throw new Error('Escriba la clave actual y la nueva.')
        await api('/api/sesion/clave', { actual: x.actual, nueva: x.nueva }); cerrar(); aviso('Clave actualizada')
      }}>
      <dl className="dl" style={{ marginBottom: 14 }}><dt>Nombre</dt><dd>{u.nombre}</dd><dt>Usuario</dt><dd>{u.usuario}</dd>
        <dt>Rol</dt><dd>{ROLES[u.rol]}</dd><dt>Correo</dt><dd>{u.email || '—'}</dd></dl>
      <div className="form-grid">
        <div className="form-sec">Cambiar mi clave</div>
        <Campo etq="Clave actual"><input type="password" name="actual" autoComplete="current-password" /></Campo>
        <Campo etq="Clave nueva (mínimo 6)"><input type="password" name="nueva" autoComplete="new-password" /></Campo>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ configuración
export function Configuracion({ c, dueno, cerrar, listo, precios }: { c: Datos; dueno: boolean; cerrar: () => void; listo: () => void; precios: () => void }) {
  const [tab, setTab] = useState('proyecto')
  const t = (k: string, et: string, extra: { cls?: string; ayuda?: string } = {}) =>
    <Campo etq={et} {...extra}><input type="text" name={k} defaultValue={c[k] || ''} /></Campo>
  const n = (k: string, et: string, extra: { cls?: string; ayuda?: string } = {}, paso = '1') =>
    <Campo etq={et} {...extra}><input type="number" step={paso} name={k} defaultValue={c[k] || '0'} /></Campo>
  const sw = (k: string, et: string) =>
    <label className="interruptor c2" style={{ gridColumn: '1/-1' }}><input type="checkbox" name={k} defaultChecked={c[k] === '1'} /><span />{et}</label>
  const pestanas: [string, string][] = [['proyecto', 'Proyecto y vendedor'], ['cartera', 'Cartera y ventas'], ['seguridad', 'Seguridad'], ['respaldos', 'Respaldos y red']]
  return (
    <Modal titulo="Configuración" ancho cerrar={cerrar} alEnviar={async (x) => {
      const datos: Datos = {}
      Object.entries(x).forEach(([k, v]) => { datos[k] = typeof v === 'boolean' ? (v ? '1' : '0') : String(v) })
      const clave = (datos.smtp_clave || '').trim()
      delete datos.smtp_clave          // la clave va por su ruta aparte (solo dueño) y nunca vuelve al navegador
      Object.keys(datos).forEach((k) => { if (datos[k] === String(c[k] ?? '')) delete datos[k] })
      if (!Object.keys(datos).length && !clave) return cerrar()
      if (Object.keys(datos).length) await api('/api/config', datos)
      if (clave) await api('/api/config/secreta', { smtp_clave: clave })
      listo(); cerrar(); aviso('Configuración guardada')
    }}>
      <div className="subtabs" style={{ padding: 0, position: 'static', marginBottom: 14 }}>
        {pestanas.map(([k, nom]) => <button key={k} type="button" className={tab === k ? 'activo' : ''} onClick={() => setTab(k)}>{nom}</button>)}
      </div>
      <div className="form-grid" hidden={tab !== 'proyecto'}>
        {t('proyecto', 'Nombre del proyecto')} {t('subtitulo', 'Subtítulo')} {t('ciudad', 'Ciudad')}
        <div className="form-sec">Vendedor (aparece en recibos, contratos e informes)</div>
        {t('vendedor_razon_social', 'Razón social o nombre', { cls: 'c2' })} {t('vendedor_nit', 'NIT / cédula')} {t('vendedor_telefono', 'Teléfono')}
        {t('vendedor_direccion', 'Dirección')} {t('vendedor_email', 'Correo')}
        {t('vendedor_representante', 'Representante legal')} {t('vendedor_representante_doc', 'Documento del representante')}
        {t('cuenta_bancaria', 'Cuenta para recibir pagos', { cls: 'c2', ayuda: 'Ej.: Bancolombia ahorros 123-456789-01 a nombre de …' })}
      </div>
      <div className="form-grid" hidden={tab !== 'cartera'}>
        {n('dias_gracia', 'Días de gracia antes de marcar mora')} {n('tasa_mora_mensual', 'Interés de mora (% mensual)', { ayuda: '0 = no calcular. No puede superar el tope de usura.' }, '0.01')}
        <div className="form-sec">Tope legal de la mora (tasa de usura)</div>
        {n('tasa_usura_ea', 'Tasa de usura vigente (% efectivo anual)', { ayuda: 'La certifica la Superfinanciera cada mes. 0 = sin tope cargado.' }, '0.01')}
        <Campo etq="Mes que cubre"><input type="month" name="tasa_usura_mes" defaultValue={c.tasa_usura_mes || ''} /></Campo>
        <div className="c2">
          {c.tope_mora_mensual == null
            ? <div className="alerta-caja aviso" style={{ margin: 0 }}><ShieldAlert /><div><b>No hay tope de usura cargado:</b> el interés de mora no tiene límite. Digite la tasa de usura vigente.</div></div>
            : <div className={`alerta-caja ${c.usura_vencida ? 'aviso' : 'ok'}`} style={{ margin: 0 }}><ShieldAlert /><div>
              Tope mensual equivalente: <b>{c.tope_mora_mensual} %</b>. Mora que se está aplicando: <b>{c.tasa_mora_efectiva} %</b> mensual.
              {c.usura_vencida && <> <b>La tasa cargada no es la de este mes:</b> actualícela, porque cambia cada mes.</>}</div></div>}
        </div>
        {n('descuento_max_operador', 'Descuento máximo que un operador da sin aprobación (%)', { ayuda: '0 = todo descuento se aprueba.' }, '0.5')}
        {n('comision_max_pct', 'Tope de comisión por venta (%)', {}, '0.5')} {n('cotizacion_validez_dias', 'Validez de las cotizaciones (días)')}
        <div className="form-sec">Promesa de compraventa</div>
        {n('promesa_penalidad_pct', 'Cláusula penal por incumplimiento (% del precio)', { ayuda: 'También se usa para liquidar un desistimiento.' }, '0.5')}
        {n('desistimiento_plazo_dias', 'Plazo para devolver tras un desistimiento (días)')}
        {n('promesa_plazo_escritura_meses', 'Plazo para escriturar tras pagar (meses)')} {t('notaria_escrituracion', 'Notaría para escriturar', { cls: 'c2' })}
      </div>
      <div className="form-grid" hidden={tab !== 'seguridad'}>{n('sesion_minutos', 'Cerrar sesión tras (minutos sin uso)')}
        <div className="form-sec">Correo de envío (códigos de ingreso y alertas)</div>
        {t('smtp_servidor', 'Servidor')} {t('smtp_puerto', 'Puerto')} {t('smtp_usuario', 'Correo de envío', { ayuda: 'Ej.: alphaple.info@gmail.com' })} {t('smtp_remitente', 'Nombre del remitente')}
        {dueno && <Campo etq={c.smtp_configurado ? 'Contraseña de aplicación (ya guardada; escriba solo para cambiarla)' : 'Contraseña de aplicación de Gmail'} cls="c2">
          <input type="password" name="smtp_clave" autoComplete="new-password" /></Campo>}
      </div>
      <div className="form-grid" hidden={tab !== 'respaldos'}>
        {t('carpeta_respaldo_externa', 'Carpeta para la copia diaria', { cls: 'c2', ayuda: 'Una carpeta sincronizada (Google Drive, OneDrive) o una USB. Ej.: G:\\Mi unidad\\Respaldos loteo' })}
        <div className="c2"><button type="button" className="btn sec" onClick={() => api<Datos>('/api/respaldo', {}).then((r) => aviso('Respaldo creado: ' + r.archivo)).catch(falla)}><DatabaseBackup />Hacer respaldo ahora</button></div>
        <div className="form-sec">Acceso desde otros equipos</div>
        {sw('acceso_red', 'Permitir el acceso desde otros equipos y celulares de la misma red (wifi de la oficina)')}
        <div className="c2 ley-ayuda" style={{ padding: 0 }}>Al activarlo, reinicie el geovisor. Todos deben ingresar con usuario y clave.</div>
        <div className="form-sec">Precios</div>
        <div className="c2"><button type="button" className="btn sec" onClick={precios}><Tags />Asignar precios por manzana</button></div>
      </div>
      {!dueno && <div className="alerta-caja aviso" style={{ marginTop: 14 }}><ShieldAlert /><div>Los cambios que guarde quedarán <b>pendientes de aprobación</b> de un dueño.</div></div>}
    </Modal>
  )
}
