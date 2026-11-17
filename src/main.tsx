import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ActivationGate } from './components/ActivationGate.tsx'
import { PrintRoot } from './print/PrintRoot.tsx'

// #app-shell محايد التخطيط على الشاشة (display: contents) فلا يتغيّر شكل التطبيق؛
// وقت الطباعة يُخفيه <PrintRoot/> ويُظهر #print-root وحده.
const appShellStyle = { display: 'contents' } as const

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ActivationGate>
      <div id="app-shell" style={appShellStyle}>
        <App />
      </div>
      <PrintRoot />
    </ActivationGate>
  </StrictMode>,
)
