/** Pantalla de carga con el logo: entra, respira y deja una barra de avance. Sin textos. */
export default function Splash({ error }: { error?: string }) {
  return (
    <div className="splash" role={error ? 'alert' : 'status'} aria-label="Cargando">
      <img className="splash-logo" src="/alpha/logo_blanco.svg" alt="" />
      {error ? <p className="splash-err">{error}</p> : <div className="splash-barra"><b /></div>}
    </div>
  )
}
