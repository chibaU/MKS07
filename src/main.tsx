import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ActivationGate } from './components/ActivationGate.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ActivationGate>
      <App />
    </ActivationGate>
  </StrictMode>,
)