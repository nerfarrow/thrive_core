import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// `blackhole-lensing` resolves to the shared library at the repo root. In Docker
// the build context is the repo root and the lib is copied to /blackhole-lensing
// (one level above /app), so `../blackhole-lensing` matches both local + Docker.
const blackhole = fileURLToPath(new URL('../blackhole-lensing', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'blackhole-lensing': blackhole },
  },
  server: {
    proxy: { '/api': 'http://localhost:8000' },
    fs: { allow: ['..'] },   // let dev server read the sibling library
  },
})
