import { ipcMain, clipboard } from 'electron'
import { Logger } from '../logger'
import { SettingsStore } from '../services/storage/settings-store'
import { LlmService } from '../services/llm/service'
import { ProjectStore, createProject, openProject, updateProjectMeta } from '../services/storage/project'
import type { PresetCreds, ChatMessage } from '../services/llm/adapters'
import type { ChatStartParams, LlmEvent, PresetInput, ProjectInfo } from '../../shared/types'

export interface IpcContext {
  logger: Logger
  settings: SettingsStore
  llm: LlmService
  getWindow: () => import('electron').BrowserWindow | null
}

export interface IpcHost {
  pickDirectory(): Promise<string | null>
  onProjectOpened(info: ProjectInfo): void
}

/**
 * 所有 IPC 注册（渲染进程只经 preload 暴露的窄接口访问主进程）。
 * 项目句柄保存在主进程内存中（单窗口应用）。
 */
export function registerIpc(ctx: IpcContext, host: IpcHost): void {
  let current: ProjectStore | null = null

  const requireProject = (): ProjectStore => {
    if (!current) throw new Error('尚未打开任何项目，请先新建或打开项目')
    return current
  }

  const wrap = (fn: () => unknown): Promise<unknown> =>
    Promise.resolve()
      .then(fn)
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        ctx.logger.error(`IPC 错误：${msg}`)
        throw new Error(msg)
      })

  // ---------- 项目 ----------
  ipcMain.handle('project:createDialog', () =>
    wrap(async () => {
      const dir = await host.pickDirectory()
      if (!dir) return null
      const info = await createProject(dir)
      current = new ProjectStore(info.dirPath)
      ctx.logger.info(`新建项目：${info.dirPath}`)
      host.onProjectOpened(info)
      return info
    })
  )

  ipcMain.handle(
    'project:create',
    (_e, dirPath: string, meta: { name?: string; genre?: string; targetWords?: number }) =>
      wrap(async () => {
        const info = await createProject(dirPath, meta)
        current = new ProjectStore(info.dirPath)
        ctx.logger.info(`新建项目：${info.dirPath}`)
        host.onProjectOpened(info)
        return info
      })
  )

  ipcMain.handle('project:openDialog', () =>
    wrap(async () => {
      const dir = await host.pickDirectory()
      if (!dir) return null
      const info = await openProject(dir)
      current = new ProjectStore(info.dirPath)
      host.onProjectOpened(info)
      return info
    })
  )

  ipcMain.handle('project:open', (_e, dirPath: string) =>
    wrap(async () => {
      const info = await openProject(dirPath)
      current = new ProjectStore(info.dirPath)
      host.onProjectOpened(info)
      return info
    })
  )

  ipcMain.handle('project:getCurrent', () =>
    wrap(async () => (current ? await openProject(current.root) : null))
  )

  ipcMain.handle('project:updateMeta', (_e, patch: { name?: string; genre?: string; targetWords?: number }) =>
    wrap(async () => {
      const store = requireProject()
      const meta = await updateProjectMeta(store.root, patch)
      return {
        dirPath: store.root,
        name: meta.name,
        genre: meta.genre,
        targetWords: meta.targetWords,
        createdAt: meta.createdAt
      } satisfies ProjectInfo
    })
  )

  // ---------- 项目内文件（路径守卫在 ProjectStore/safeJoin 内） ----------
  ipcMain.handle('files:list', (_e, relDir: string) => wrap(() => requireProject().listDir(relDir)))
  ipcMain.handle('files:read', (_e, relPath: string) => wrap(() => requireProject().readRel(relPath)))
  ipcMain.handle('files:write', (_e, relPath: string, content: string) =>
    wrap(async () => {
      await requireProject().writeRel(relPath, content)
    })
  )
  ipcMain.handle('files:createChapter', (_e, kind: 'chapters' | 'outline') =>
    wrap(() => requireProject().createChapter(kind))
  )

  // ---------- 设置 ----------
  ipcMain.handle('settings:get', () => wrap(() => ctx.settings.getSettings()))

  ipcMain.handle('settings:savePreset', (_e, input: PresetInput) =>
    wrap(async () => {
      const view = await ctx.settings.upsertPreset(input)
      // 新密钥注册进日志脱敏器（明文只在主进程内存中出现一次）
      const creds = await ctx.settings.getCredentials(view.id)
      if (creds?.apiKey) ctx.logger.registerSecret(creds.apiKey)
      ctx.logger.info(`已保存模型预设：${view.name}（${view.protocol}）`)
      return view
    })
  )

  ipcMain.handle('settings:deletePreset', (_e, id: string) => wrap(() => ctx.settings.deletePreset(id)))

  ipcMain.handle('settings:setRoles', (_e, roles: Record<string, string | undefined>) =>
    wrap(async () => {
      await ctx.settings.setRoles(roles)
    })
  )

  ipcMain.handle(
    'settings:setAppConfig',
    (_e, patch: { concurrencyLimit?: number; streamThrottleMs?: number; autoSaveMs?: number }) =>
      wrap(async () => {
        const config = await ctx.settings.setAppConfig(patch)
        ctx.llm.updateConfig({
          concurrencyLimit: config.concurrencyLimit,
          throttleMs: config.streamThrottleMs
        })
        return config
      })
  )

  // ---------- LLM ----------
  const resolveCreds = async (params: Pick<ChatStartParams, 'presetId' | 'preset'>): Promise<PresetCreds> => {
    if (params.presetId) {
      const creds = await ctx.settings.getCredentials(params.presetId)
      if (!creds) throw new Error('找不到指定模型预设')
      return creds
    }
    if (params.preset) {
      const p = params.preset
      if (p.id && !p.apiKey) {
        const creds = await ctx.settings.getCredentials(p.id)
        if (!creds) throw new Error('找不到指定模型预设')
        return creds
      }
      return {
        protocol: p.protocol,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey ?? '',
        model: p.model,
        temperature: p.temperature,
        maxOutputTokens: p.maxOutputTokens,
        contextLength: p.contextLength
      }
    }
    throw new Error('未指定模型预设')
  }

  const safeSend = (sender: import('electron').WebContents, ev: LlmEvent): void => {
    if (!sender.isDestroyed()) sender.send('llm:event', ev)
  }

  ipcMain.handle('llm:testConnection', (_e, input: PresetInput & { id?: string }) =>
    wrap(async () => {
      const creds = await resolveCreds({ preset: input })
      ctx.logger.info(`测试连接：${input.name || input.baseUrl}（${input.protocol}）`)
      const result = await ctx.llm.testConnection(creds)
      ctx.logger.info(
        result.ok ? `测试连接成功：延迟 ${result.latencyMs}ms` : `测试连接失败：${result.error}`
      )
      return result
    })
  )

  ipcMain.handle('llm:chat', (e, params: ChatStartParams) =>
    wrap(async () => {
      const creds = await resolveCreds(params)
      const messages: ChatMessage[] = []
      if (params.system) messages.push({ role: 'system', content: params.system })
      messages.push({ role: 'user', content: params.prompt })
      const sender = e.sender
      // startChat 的 handlers 会带 callId，避免闭包取值时序问题
      const ticket = ctx.llm.startChat({ preset: creds, messages }, {
        onDelta: (callId, full) => safeSend(sender, { callId, type: 'delta', full }),
        onDone: (callId, text) => safeSend(sender, { callId, type: 'done', full: text }),
        onError: (callId, error, partial, cancelled) =>
          safeSend(sender, { callId, type: 'error', full: partial, error, cancelled })
      })
      return ticket.callId
    })
  )

  ipcMain.handle('llm:cancel', (_e, callId: string) => wrap(() => ctx.llm.cancel(callId)))

  // ---------- 剪贴板 / 应用 ----------
  ipcMain.handle('clipboard:write', (_e, text: string) => wrap(() => clipboard.writeText(text)))
  ipcMain.handle('app:version', () => Promise.resolve('0.1.0'))
}
