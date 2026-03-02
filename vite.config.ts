import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    legacy()
  ],
  server: {
    proxy: {
      // Forward /api/* → your backend (change port to match your server)
      '/api': {
        target: 'http://192.168.137.1:8000',
        changeOrigin: true,
        rewrite: path => path, // keeps /api prefix; remove if your server uses /kids directly
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts'
  }
})
