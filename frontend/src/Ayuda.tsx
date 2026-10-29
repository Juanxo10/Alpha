import { useState } from 'react'
import { AYUDA, AYUDA_VISTA } from './ayudaTexto'
import { Modal } from './ui'

export default function Ayuda({ vista, cerrar }: { vista: string; cerrar: () => void }) {
  const [k, setK] = useState(AYUDA_VISTA[vista] || 'inicio')
  const [, titulo, html] = AYUDA.find((x) => x[0] === k) ?? AYUDA[0]
  return (
    <Modal titulo="Ayuda" ancho="extra" cerrar={cerrar}>
      <div className="ayuda">
        <nav>{AYUDA.map(([id, t]) => <button type="button" key={id} className={id === k ? 'activo' : ''} onClick={() => setK(id)}>{t}</button>)}</nav>
        <div className="ay-txt"><h3>{titulo}</h3><div dangerouslySetInnerHTML={{ __html: html }} /></div>
      </div>
    </Modal>
  )
}
