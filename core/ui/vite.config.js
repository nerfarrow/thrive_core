import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Shared renderer libraries live at core/ (next to ui/). The Docker build mirrors
// the repo layout (/repo/core/ui), so `../<lib>` → /repo/core/<lib> resolves the
// same locally and in the image.
const blackhole = fileURLToPath(new URL('../blackhole-lensing', import.meta.url))
const grovekeeper = fileURLToPath(new URL('../grovekeeper', import.meta.url))
// `@core` gives module UIs (in ../../modules/<name>/ui) a stable import surface
// for core's shared code (api, contexts, components) wherever they're loaded from.
const core = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'blackhole-lensing': blackhole, 'grovekeeper': grovekeeper, '@core': core },
  },
  server: {
    proxy: { '/api': 'http://localhost:8000' },
    fs: { allow: ['../..'] },   // dev server reads the sibling libs + ../../modules
  },
})
