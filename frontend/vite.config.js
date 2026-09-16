import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Geen proxy nodig: de API (server/) heeft cors() aanstaan (zie server/app.js)
// en de basis-URL komt uit VITE_API_URL (.env, default http://localhost:3000).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 }
})
