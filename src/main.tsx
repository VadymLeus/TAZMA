// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'
import StandApp from './stand/StandApp.tsx'

// The measurement stand lives at the same address with ?stand.
const stand = new URLSearchParams(window.location.search).has('stand')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {stand ? <StandApp /> : <App />}
  </StrictMode>,
)
