import { app, BrowserWindow, dialog } from 'electron'
import * as path from 'node:path'
import { Logger } from './logger'
import { SettingsStore } from './services/storage/settings-store'
import { createSafeStorageBox } from './services/secrets/safe-storage'
import { LlmService } from './services/llm/service'
import { registerIpc, type IpcContext } from './ipc/register'
import type { ProjectInfo } from '../shared/types'

/**
 * 主进程入口：
 * - 渲染进程只做 UI，所有 LLM 请求都在主进程执行（说明书第 2 节）；
 * - uncaughtException 记录日志并保持窗口存活（第 5 节）；
 * - 支持 --smoke-test：窗口加载完成后自动退出，供验证者做无头冒烟。
 */

let mainWindow: BrowserWindow | null = null

let logger = new Logger()

process.on('uncaughtException', (err) => {
  logger.error(`uncaughtException: ${err?.stack || String(err)}`)
})
process.on('unhandledRejection', (reason) => {
  logger.error(`unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`)
})

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'NovelFlow 小说写作工作台',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../../dist/index.html'))
  }
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

async function initContext(): Promise<IpcContext> {
  const userData = app.getPath('userData')
  logger = new Logger(path.join(userData, 'logs', 'main.log'))
  const settings = new SettingsStore(path.join(userData, 'settings.json'), createSafeStorageBox())
  const llm = new LlmService()
  const config = await settings.getConfig()
  llm.updateConfig({ concurrencyLimit: config.concurrencyLimit, throttleMs: config.streamThrottleMs })
  // 已保存的密钥注册进日志脱敏器（明文只存在于主进程内存）
  for (const key of await settings.collectPlainKeys()) logger.registerSecret(key)
  return { logger, settings, llm, getWindow: () => mainWindow }
}

async function run(): Promise<void> {
  const smoke = process.argv.includes('--smoke-test')
  await app.whenReady()
  const ctx = await initContext()

  registerIpc(ctx, {
    async pickDirectory(): Promise<string | null> {
      const win = mainWindow
      const options = {
        title: '选择小说项目文件夹',
        properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
      }
      const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
    },
    onProjectOpened(info: ProjectInfo) {
      ctx.logger.info(`已打开项目：${info.dirPath}`)
    }
  })

  mainWindow = createWindow()
  mainWindow.webContents.on('did-finish-load', () => {
    ctx.logger.info('渲染进程加载完成')
  })

  if (smoke) {
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        console.log('SMOKE_OK')
        app.quit()
      }, 1500)
    })
    setTimeout(() => {
      console.error('SMOKE_TIMEOUT')
      app.exit(1)
    }, 25_000)
  }
}

app.on('window-all-closed', () => {
  app.quit()
})

void run()
