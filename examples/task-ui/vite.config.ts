import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    // Optional: proxy API requests to avoid CORS in local dev.
    // Alternatively, add CORS headers to the Worker (see README).
    //
    // proxy: {
    //   '/api': {
    //     target: 'http://localhost:8787',
    //     changeOrigin: true,
    //     ws: true,
    //     rewrite: (path) => path.replace(/^\/api/, ''),
    //   },
    // },
  },
})
