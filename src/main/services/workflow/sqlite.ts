import { createRequire } from 'node:module'

/**
 * SQLite 打开器（Node 内置 node:sqlite，零第三方依赖、无需原生编译/针对 Electron ABI 重建）。
 * 用 createRequire(process.execPath) 取模块，在 CJS（esbuild 打包的主进程）与 ESM（vitest）下都可用。
 */

export interface SqliteStatement {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDb
}

export function openSqlite(filePath: string): SqliteDb {
  const require_ = createRequire(process.execPath)
  const mod = require_('node:sqlite') as SqliteModule
  return new mod.DatabaseSync(filePath)
}
