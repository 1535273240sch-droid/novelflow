import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 渲染进程构建配置。主进程/preload 由 scripts/build-main.mjs 用 esbuild 单独构建。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120'
  },
  server: {
    port: 5173,
    strictPort: true
  }
})
