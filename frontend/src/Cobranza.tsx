import { useMemo, useState } from 'react'
import { BadgeCheck, FileSpreadsheet, MessageCircle, PhoneCall, Search } from 'lucide-react'
import { api, aviso } from './api'
import { fecha, fmtN, pesos, pesosCorto } from './formato'
import { Campo, Cargando, Dinero, hoyISO, Kpi, Modal, numeroWhatsApp, useApi, Vacio, type Datos } from './ui'

export const TIPOS_GESTION: Record<string, string> = { LLAMADA: 'Llamada', WHATSAPP: 'WhatsApp', CORREO: 'Correo', VISITA: 'Visita', MENSAJE: 'Mensaje de texto' }
const TIPO_TXT: Record<string, [string, string]> = { VENCIDA: ['Vencida', 'MORA_MAS_90'], POR_VENCER: ['Por vencer', 'VENDIDO'], SEPARACION: ['Separación', 'SEPARADO'] }

function mensajeCobro(f: Datos, c: Datos) {
  const nom = (f.cliente || '').split(' ')[0]
  const cuenta = c.cuenta_bancaria ? `\nPuede pagar en: ${c.cuenta_bancaria}.` : ''
  const firma = `\n\n${c.vendedor_razon_social || c.proyecto}${c.vendedor_telefono ? ' · ' + c.vendedor_telefono : ''}`
  if (f.tipo === 'VENCIDA') return `Buen día, ${nom}. Le escribimos de ${c.proyecto}. Su lote ${f.id_lote} presenta un saldo vencido de ${pesos(f.valor)} (${f.dias} días). ¿Nos confirma cuándo podría ponerse al día?${cuenta} Si ya pagó, por favor envíenos el comprobante.${firma}`
  if (f.tipo === 'SEPARACION') return `Buen día, ${nom}. Le recordamos que la separación del lote ${f.id_lote} en ${c.proyecto} vence el ${fecha(f.fecha)}. ¿Seguimos con la compra?${firma}`
  return `Buen día, ${nom}. Le recordamos que el ${fecha(f.fecha)} vence la cuota de su lote ${f.id_lote} por ${pesos(f.valor)}.${cuenta}${firma}`
}

export function FormGestion({ f, tipo = 'LLAMADA', resultado = '', cerrar, listo }: { f: Datos; tipo?: string; resultado?: string; cerrar: () => void; listo: () => void }) {
  return (
    <Modal titulo={`Gestión de cobro · ${f.id_lote}`} cerrar={cerrar} boton="Registrar gestión" alEnviar={async (x) => {
      await api('/api/cobranza/gestion', { ...x, venta_id: f.venta_id }); cerrar(); aviso('Gestión registrada'); listo()
    }}>
      <p className="texto-modal"><b>{f.cliente}</b>{f.telefono && ' · ' + f.telefono}{f.valor ? ` · ${f.tipo === 'VENCIDA' ? 'vencido' : 'cuota'} ${pesos(f.valor)}` : ''}</p>
      <div className="form-grid">
        <Campo etq="Tipo de gestión"><select name="tipo" defaultValue={tipo}>{Object.entries(TIPOS_GESTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
        <Campo etq="Fecha"><input type="date" name="fecha" defaultValue={hoyISO()} /></Campo>
        <Campo etq="Resultado" req cls="c2"><textarea name="resultado" rows={2} required defaultValue={resultado} /></Campo>
        <div className="form-sec">Compromiso de pago (si lo hubo)</div>
        <Campo etq="Fecha prometida"><input type="date" name="compromiso_fecha" /></Campo>
        <Campo etq="Valor prometido"><Dinero name="compromiso_valor" /></Campo>
      </div>
    </Modal>
  )
}

export default function Cobranza({ abrir, config }: { abrir: (id: string) => void; config: Datos }) {
  const [dias, setDias] = useState('15'), [tipo, setTipo] = useState('VENCIDA'), [q, setQ] = useState('')
  const [gestion, setGestion] = useState<{ f: Datos; tipo?: string; resultado?: string } | null>(null)
  const { d: r, error, recargar } = useApi<Datos>('/api/cobranza?dias=' + dias)
  const ls = useMemo(() => (r?.filas ?? []).filter((f: Datos) => (!tipo || f.tipo === tipo) && (!q || `${f.id_lote} ${f.cliente}`.toLowerCase().includes(q.toLowerCase()))), [r, tipo, q])
  if (!r) return <Cargando error={error} />
  const t = r.totales
  const wa = (f: Datos) => {
    const n = numeroWhatsApp(f.telefono)
    if (!n) return aviso('El comprador no tiene un celular válido registrado.', true)
    window.open(`https://wa.me/${n}?text=${encodeURIComponent(mensajeCobro(f, config))}`, '_blank')
    setGestion({ f, tipo: 'WHATSAPP', resultado: 'Mensaje enviado por WhatsApp' })
  }
  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div><h1>Cobranza</h1><p>A quién cobrar hoy: cuotas vencidas, separaciones por vencer y cuotas próximas, con sus gestiones y compromisos.</p></div>
        <div className="botones"><a className="btn sec" href="/api/exportar/cobranza.csv"><FileSpreadsheet />Exportar</a></div>
      </div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <Kpi et="Cartera vencida" va={pesosCorto(t.vencido)} sub={`${t.n_vencidas} negocios en mora`} c="#DC2626" rojo={!!t.vencido} />
        <Kpi et="Por vencer" va={pesosCorto(t.por_vencer)} sub={`${t.n_por_vencer} cuotas en ${r.dias} días`} c="#3B82F6" />
        <Kpi et="Compromisos para hoy" va={fmtN.format(t.compromisos_hoy)} sub={`${t.incumplidos} compromisos incumplidos`} c="#F5B841" rojo={!!t.incumplidos} />
        <Kpi et="Gestiones de hoy" va={fmtN.format(r.gestiones_hoy)} sub="Llamadas, mensajes y visitas" c="#17A974" />
      </div>
      <div className="filtros-tabla">
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todo</option><option value="VENCIDA">Vencidas</option><option value="POR_VENCER">Por vencer</option><option value="SEPARACION">Separaciones</option></select>
        <label className="campo-inline">Próximos <select value={dias} onChange={(e) => setDias(e.target.value)}><option>7</option><option>15</option><option>30</option><option>60</option></select> días</label>
        <div className="buscador peq"><Search /><input type="search" placeholder="Lote o comprador…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <span className="contador">{ls.length} casos</span>
      </div>
      <div className="tabla-wrap grande">
        {!ls.length ? <Vacio Ic={BadgeCheck} pad t="No hay casos para este filtro." /> : (
          <table className="datos">
            <thead><tr><th>Situación</th><th>Lote</th><th>Comprador</th><th>Teléfono</th><th>Vence</th><th className="d">Valor</th><th className="d">Días</th><th>Última gestión</th><th>Compromiso</th><th /></tr></thead>
            <tbody>{ls.map((f: Datos, k: number) => { const g = f.ultima_gestion, cp = f.compromiso; return (
              <tr key={k}>
                <td><span className={`chip ${TIPO_TXT[f.tipo][1]}`}>{TIPO_TXT[f.tipo][0]}</span></td>
                <td><button className="link" onClick={() => abrir(f.id_lote)}><b>{f.id_lote}</b></button></td>
                <td>{f.cliente}</td><td>{f.telefono || '—'}</td><td>{fecha(f.fecha)}</td><td className="d">{f.valor ? pesos(f.valor) : '—'}</td>
                <td className="d">{f.tipo === 'VENCIDA' ? <span className="rojo">{f.dias}</span> : f.tipo === 'POR_VENCER' ? `en ${f.dias}` : f.dias > 0 ? <span className="rojo">vencida</span> : ''}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: 240, fontSize: 12 }}>{g ? <><b>{TIPOS_GESTION[g.tipo]}</b> {fecha(g.fecha)}: {g.resultado}</> : <span style={{ color: 'var(--txt-3)' }}>Sin gestión</span>}</td>
                <td>{cp && <span className={`chip ${cp.estado === 'INCUMPLIDO' ? 'MORA_MAS_90' : cp.estado === 'VIGENTE' ? 'SEPARADO' : 'AL_DIA'}`}>{fecha(cp.fecha)}{cp.valor ? ' · ' + pesosCorto(cp.valor) : ''}</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sec peq" title="Escribir por WhatsApp" disabled={!numeroWhatsApp(f.telefono)} onClick={() => wa(f)}><MessageCircle /></button>{' '}
                  <button className="btn sec peq" title="Registrar gestión" onClick={() => setGestion({ f })}><PhoneCall /></button>
                </td>
              </tr>) })}</tbody>
          </table>)}
      </div>
      {gestion && <FormGestion {...gestion} cerrar={() => setGestion(null)} listo={recargar} />}
    </div>
  )
}
