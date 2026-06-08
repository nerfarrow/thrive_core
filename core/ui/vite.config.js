import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Shared renderer libraries live at core/ (next to ui/). In Docker each is copied
// one level above /app (/blackhole-lensing, /grovekeeper), so `../<lib>` matches
// both local + Docker.
const blackhole = fileURLToPath(new URL('../blackhole-lensing', import.meta.url))
const grovekeeper = fileURLToPath(new URL('../grovekeeper', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'blackhole-lensing': blackhole, 'grovekeeper': grovekeeper },
  },
  server: {
    proxy: { '/api': 'http://localhost:8000' },
    fs: { allow: ['..'] },   // let dev server read the sibling library
  },
})
