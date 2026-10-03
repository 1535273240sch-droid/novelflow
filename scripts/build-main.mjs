#!/usr/bin/env node
/**
 * 主进程 / preload 构建脚本（esbuild 打包为 CJS，external: electron）。
 * 生产模式输出到 dist-electron/，与 vite 构建的渲染产物 dist/ 配合使用。
 */
import { build } from 'esbuild'

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: false,
  logLevel: 'info'
}

await build({
  ...common,
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist-electron/main/index.js'
})

await build({
  ...common,
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist-electron/preload/index.js'
})

console.log('[build-main] 主进程与 preload 构建完成')
