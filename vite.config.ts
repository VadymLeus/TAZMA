import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The app is a static client-side bundle (no backend), so the same build
// works locally and on a static host such as Vercel.
export default defineConfig({
  plugins: [react()],
})
