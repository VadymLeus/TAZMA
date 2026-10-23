// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // The export worker is a module of its own, built as one.
  worker: { format: 'es' },
})
