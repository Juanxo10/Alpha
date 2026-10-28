import { useEffect, useState } from 'react'
import { Construction, ShieldCheck } from 'lucide-react'
import { api, aviso } from './api'
import Splash from './Splash'
import Encabezado, { type Vista } from './Encabezado'
import Mapa, { type DatosLoteo } from './Mapa'
import Tablero from './Tablero'
import Cartera from './Cartera'
import Pagos from './Pagos'
import Cobranza from './Cobranza'
import Prospectos from './Prospectos'
import Comisionistas from './Comisionistas'
import Gastos from './Gastos'
import Flujo from './Flujo'
import Conciliacion from './Conciliacion'
import Contratos from './Contratos'
import Bienes from './Bienes'
import Desistimientos from './Desistimientos'
import Bloques from './Bloques'
import Ayuda from './Ayuda'
import { setContexto } from './plantillas'
import { FormPreciosMasivos } from './Acciones'
import { Aprobaciones, Auditoria, Avisos, Configuracion, Cuenta, Usuarios } from './Administracion'
import type { CapaExtra, Geo, Lote, Orto, ResumenMapa } from './tipos'
import type { FeatureCollection } from 'geojson'

const VACIA: FeatureCollection = { type: 'FeatureCollection', features: [] }
// lotes, manzanas y límite son obligatorias; el resto de capas, si el cliente las tiene
async function capa(n: string, opcional = false): Promise<FeatureCollection> {
  const r = await fetch(`/data/${n}.geojson`)
  if (r.ok) return r.json()
  if (opcional) return VACIA
  throw new Error(`Falta la capa ${n} del proyecto.`)
}

async function cargarLoteo(): Promise<DatosLoteo> {
  const [lotesGeo, manz, manzEtq, vias, zv, cano, limite, cfg, lotes, resumen] = await Promise.all([
    capa('lotes'), capa('manzanas'), capa('manzanas_etq', true), capa('vias', true), capa('zonas_verdes', true),
    capa('hidrografia', true), capa('limite'), api<{ capas_extra?: CapaExtra[] }>('/api/config'),
    api<Lote[]>('/api/lotes'), api<ResumenMapa>('/api/resumen'),
  ])
  const capasExtra = cfg.capas_extra ?? []
  const extra = await Promise.all(capasExtra.map((x) => capa(x.archivo.replace(/\.geojson$/i, ''), true)))
  const orto: Orto | null = await fetch('/data/orto/orto.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
  const geo: Geo = { lotes: lotesGeo, manz, manzEtq, vias, zv, cano, limite, extra }
  return { geo, orto, capasExtra, lotes, resumen }
}

interface Estado {
  configurado: boolean
  sesion: { nombre: string; rol: string } | null
  proyecto: string
  marca: { empresa: string; logo?: boolean; pide_codigo?: boolean }
}

function Ingreso({ estado, alEntrar }: { estado: Estado; alEntrar: () => void }) {
  const [error, setError] = useState('')
  const nuevo = !estado.configurado
  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    try {
      if (nuevo && d.clave !== d.clave2) throw new Error('Las claves no coinciden.')
      await api(nuevo ? '/api/sesion/configurar' : '/api/sesion/entrar', d)
      alEntrar()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <div className="ingreso">
      <div className="ing-caja">
        <div className="ing-cab"><img src={estado.marca.logo ? '/marca/logo_claro.png' : '/marca/icono-192.png'} alt="" className={estado.marca.logo ? undefined : 'ing-ico'} /><div><b>{estado.marca.empresa}</b><span>Ventas y cartera</span></div><img src="/alpha/logo_blanco.svg" alt="Alpha" className="logo-alpha" /></div>
        <form onSubmit={enviar} autoComplete="on">
          <h2>{nuevo ? 'Configuración inicial' : 'Ingresar'}</h2>
          <p>{nuevo ? 'Cree la cuenta del propietario (dueño). Con ella podrá crear después los usuarios de la oficina y aprobar las operaciones sensibles.'
            : 'Ingrese con su usuario y clave. Cada operación queda registrada a su nombre.'}</p>
          {nuevo && estado.marca.pide_codigo && <label className="campo"><span>Código de instalación</span><input name="codigo" required autoComplete="off" /></label>}
          {nuevo && <>
            <label className="campo"><span>Nombre completo</span><input name="nombre" required /></label>
            <label className="campo"><span>Correo</span><input name="email" type="email" /></label></>}
          <label className="campo"><span>Usuario</span><input name="usuario" required autoCapitalize="off" autoComplete="username" autoFocus /></label>
          <label className="campo"><span>Clave</span><input name="clave" type="password" required minLength={nuevo ? 6 : undefined} autoComplete={nuevo ? 'new-password' : 'current-password'} /></label>
          {nuevo && <label className="campo"><span>Repita la clave</span><input name="clave2" type="password" required minLength={6} /></label>}
          <div className="ing-error">{error}</div>
          <button className="btn pri" style={{ width: '100%', justifyContent: 'center', height: 44 }}>{nuevo ? 'Crear cuenta e ingresar' : 'Ingresar'}</button>
        </form>
        <div className="ing-pie"><ShieldCheck />Conexión privada · la sesión se cierra sola por inactividad</div>
      </div>
    </div>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Modales = null | 'avisos' | 'cuenta' | 'config' | 'ayuda' | 'precios'

export default function App() {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [vista, setVista] = useState<Vista>('mapa')
  const [loteo, setLoteo] = useState<DatosLoteo | null>(null)
  const [abrir, setAbrir] = useState<string | null>(null)
  const [errorLoteo, setErrorLoteo] = useState('')
  const [config, setConfig] = useState<Record<string, any>>({})
  const [avisos, setAvisos] = useState<Record<string, any>>({ avisos: [], no_leidas: 0, aprobaciones: 0, mis_pendientes: 0 })
  const [modal, setModal] = useState<Modales>(null)
  const [selMapa, setSelMapa] = useState(false)
  const [falloEstado, setFalloEstado] = useState('')
  const cargar = () => api<Estado>('/api/sesion/estado').then(setEstado).catch((e) => setFalloEstado(e.message))
  const revisarAvisos = () => api<Record<string, any>>('/api/notificaciones').then(setAvisos).catch(() => {})
  useEffect(() => { cargar() }, [])
  useEffect(() => {
    if (estado?.sesion && !loteo) cargarLoteo().then(setLoteo).catch((e) => setErrorLoteo(e.message))
  }, [estado, loteo])
  useEffect(() => {
    if (!estado?.sesion) return
    api<Record<string, any>>('/api/config').then(setConfig).catch(() => {})
    revisarAvisos()
    const t = setInterval(revisarAvisos, 45000)
    return () => clearInterval(t)
  }, [estado?.sesion])
  useEffect(() => {
    if (!loteo) return
    const props = Object.fromEntries(loteo.geo.lotes.features.map((f) => [f.properties!.id_lote as string, f.properties]))
    setContexto(loteo.geo, props, config, loteo.lotes)
  }, [loteo, config])
  useEffect(() => { document.title = estado ? `${estado.marca.empresa} · Ventas y cartera` : 'Ventas y cartera' }, [estado])

  if (!estado) return <Splash error={falloEstado} />
  const toasts = <div className="avisos" id="avisos" />
  if (!estado.sesion) return <>{toasts}<Ingreso estado={estado} alEntrar={cargar} /></>
  const rol = estado.sesion.rol
  const dueno = rol === 'DUENO'
  const ir = (v: Vista) => { setAbrir(null); setSelMapa(false); setVista(v) }
  const irALote = (id: string) => { setAbrir(id); setSelMapa(false); setVista('mapa') }
  const refrescar = async () => {
    const [lotes, resumen] = await Promise.all([api<any[]>('/api/lotes'), api<any>('/api/resumen')])
    setLoteo((x) => (x ? { ...x, lotes, resumen } : x)); revisarAvisos()
  }
  const recargarTodo = () => { refrescar() }
  const salir = () => api('/api/sesion/salir', {}).then(cargar)
  const espera = <Splash />
  const contenido = () => {
    switch (vista) {
      case 'mapa': return loteo ? <Mapa datos={loteo} abrir={abrir} config={config} refrescar={refrescar} seleccionar={selMapa} /> : <Splash error={errorLoteo} />
      case 'tablero': return <Tablero config={config} />
      case 'cartera': return loteo ? <Cartera lotes={loteo.lotes} abrir={irALote} /> : espera
      case 'pagos': return <Pagos abrir={irALote} config={config} />
      case 'cobranza': return <Cobranza abrir={irALote} config={config} />
      case 'prospectos': return <Prospectos config={config} lotes={loteo?.lotes ?? []} />
      case 'comisionistas': return <Comisionistas abrir={irALote} config={config} />
      case 'gastos': return <Gastos rol={rol} config={config} />
      case 'flujo': return <Flujo />
      case 'conciliacion': return <Conciliacion />
      case 'contratos': return <Contratos abrir={irALote} config={config} rol={rol} />
      case 'bloques': return <Bloques abrir={irALote} config={config} rol={rol} seleccionar={() => { setAbrir(null); setSelMapa(true); setVista('mapa') }} />
      case 'bienes': return <Bienes abrir={irALote} config={config} />
      case 'desistimientos': return <Desistimientos abrir={irALote} config={config} />
      case 'aprobaciones': return <Aprobaciones rol={rol} abrir={irALote} cambio={recargarTodo} />
      case 'usuarios': return <Usuarios />
      case 'auditoria': return <Auditoria abrir={irALote} />
      default: return <div className="pagina"><div className="vacio"><Construction />Esta pantalla ({vista}) aún no está migrada.</div></div>
    }
  }
  return (
    <>
      {toasts}
      <Encabezado logo={estado.marca.logo} empresa={estado.marca.empresa} subtitulo="Control de ventas y cartera" usuario={estado.sesion.nombre}
        rol={rol} vista={vista} ir={ir} lotes={loteo?.lotes ?? []} abrir={irALote}
        nAvisos={avisos.no_leidas + (dueno ? avisos.aprobaciones : 0)} nAprob={dueno ? avisos.aprobaciones : avisos.mis_pendientes}
        onAvisos={() => { revisarAvisos(); setModal('avisos') }} onCuenta={() => setModal('cuenta')} onConfig={() => setModal('config')}
        onAyuda={() => setModal('ayuda')} />
      <main>
        <section className="vista activa" id={`vista-${vista}`}>{contenido()}</section>
      </main>
      {modal === 'avisos' && <Avisos n={avisos} cerrar={() => setModal(null)} leidos={revisarAvisos} irAprob={() => { setModal(null); ir('aprobaciones') }} />}
      {modal === 'ayuda' && <Ayuda vista={vista} cerrar={() => setModal(null)} />}
      {modal === 'precios' && <FormPreciosMasivos lotes={loteo?.lotes ?? []} cerrar={() => setModal(null)} listo={(m) => { aviso(m); return refrescar() }} />}
      {modal === 'cuenta' && <Cuenta cerrar={() => setModal(null)} salir={salir} />}
      {modal === 'config' && <Configuracion c={config} dueno={dueno} cerrar={() => setModal(null)} precios={() => setModal('precios')}
        listo={() => api<Record<string, any>>('/api/config').then(setConfig)} />}
    </>
  )
}
