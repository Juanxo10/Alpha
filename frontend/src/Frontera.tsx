/* Si una pantalla falla al dibujarse, en vez de dejar la ventana en blanco muestra el error para poder corregirlo. */
import { Component } from 'react'
import type { ReactNode } from 'react'

export default class Frontera extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error(error) }
  render() {
    const e = this.state.error
    if (!e) return this.props.children
    const detalle = `${e.name}: ${e.message}\n${(e.stack || '').split('\n').slice(0, 8).join('\n')}\n${location.href}`
    return (
      <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 820, margin: '0 auto' }}>
        <h2 style={{ color: '#991B1B' }}>Algo falló al mostrar esta pantalla</h2>
        <p>Copie este detalle y envíelo para corregirlo. Mientras tanto puede recargar la aplicación.</p>
        <pre style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, whiteSpace: 'pre-wrap', fontSize: 12, userSelect: 'text' }}>{detalle}</pre>
        <button style={{ padding: '8px 14px', marginRight: 8 }} onClick={() => navigator.clipboard?.writeText(detalle)}>Copiar detalle</button>
        <button style={{ padding: '8px 14px' }} onClick={() => location.reload()}>Recargar</button>
      </div>
    )
  }
}
