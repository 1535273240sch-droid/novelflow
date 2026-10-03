#!/usr/bin/env node
/**
 * 开发模式编排（替代 concurrently + wait-on，零额外依赖）：
 * 1. 用 vite 的 JS API 启动渲染进程 dev server；
 * 2. esbuild 构建主进程与 preload；
 * 3. 启动 Electron（注入 VITE_DEV_SERVER_URL），Electron 退出后自动关闭 dev server。
 */
import { createServer } from 'vite'
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import process from 'node:process'
import electronPath from 'electron'

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'silent'
}

async function buildMain() {
  await build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist-electron/main/index.js' })
  await build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist-electron/preload/index.js' })
}

console.log('[dev] 启动 vite dev server…')
const server = await createServer({
  configFile: 'vite.config.ts',
  server: { port: 5173, strictPort: true }
})
await server.listen()
const urls = server.resolvedUrls?.local ?? []
const url = urls[0] ?? 'http://localhost:5173/'
console.log(`[dev] 渲染进程：${url}`)

console.log('[dev] 构建主进程…')
await buildMain()

console.log('[dev] 启动 Electron…')
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
  windowsHide: false
})

child.on('exit', (code) => {
  console.log(`[dev] Electron 已退出（code=${code}），关闭 dev server`)
  void server.close()
  process.exit(code ?? 0)
})

const forward = (sig) => {
  child.kill(sig)
}
process.on('SIGINT', () => forward('SIGINT'))
process.on('SIGTERM', () => forward('SIGTERM'))
