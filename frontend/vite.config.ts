import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    https: {
      key: fs.readFileSync(path.resolve(__dirname, '../certs/key.pem')),
      cert: fs.readFileSync(path.resolve(__dirname, '../certs/cert.pem')),
    },
    hmr: {
      host: '192.168.0.152',
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
})
