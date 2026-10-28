import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import './layout.css'
import './nuevas.css'
import App from './App.tsx'
import Frontera from './Frontera.tsx'

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Frontera><App /></Frontera>
  </StrictMode>,
)
