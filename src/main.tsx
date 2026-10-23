// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'

// The measurement stand is a page of the app; the old address with ?stand
// still opens it.
const stand = new URLSearchParams(window.location.search).has('stand')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App initialPage={stand ? 'stand' : 'editor'} />
  </StrictMode>,
)
