import { ipcMain, clipboard } from 'electron'
import * as path from 'node:path'
import { Logger } from '../logger'
import { SettingsStore } from '../services/storage/settings-store'
import { LlmService } from '../services/llm/service'
import { ProjectStore, createProject, openProject, updateProjectMeta } from '../services/storage/project'
import { SkillRegistry } from '../services/skills/registry'
import { SkillRunner } from '../services/skills/runner'
import { readSnapshot, snapshotFile, snapshotRelPath, listSnapshots } from '../services/storage/snapshot'
import { applyFramework, parseFramework } from '../services/framework/apply'
import { applyStateWriteback, parseWriteback } from '../services/state/writeback'
import { requireChapterPlan, ChapterGateError } from '../services/context/gates'
import { WorkflowRegistry } from '../services/workflow/registry'
import { RunStore, runStoreFor } from '../services/workflow/store'
import { WorkflowEngine, type NodeExecutor, type EngineDeps } from '../services/workflow/engine'
import type { PresetCreds, ChatMessage } from '../services/llm/adapters'
import type {
  ChatStartParams,
  FrameworkApplyResult,
  LlmEvent,
  PresetInput,
  ProjectInfo,
  Skill,
  SkillEvent,
  SkillPreview,
  SkillRunParams,
  StateWritebackResult,
  Workflow,
  WorkflowRun
} from '../../shared/types'

export interface IpcContext {
  logger: Logger
  settings: SettingsStore
  llm: LlmService
  skills: SkillRegistry
  workflows: WorkflowRegistry
  getWindow: () => import('electron').BrowserWindow | null
}

export interface IpcHost {
  pickDirectory(): Promise<string | null>
  pickMarkdownFile(): Promise<string | null>
  saveMarkdownFile(defaultName: string, content: string): Promise<string | null>
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

  /** 应用改写前先快照到 .history/（验收要点 7），再原子写入。 */
  ipcMain.handle('files:writeWithSnapshot', (_e, relPath: string, content: string) =>
    wrap(async () => {
      const store = requireProject()
      const previous = await store.readRel(relPath).catch(() => null)
      if (previous !== null) {
        await snapshotFile(store.root, relPath, previous)
      }
      await store.writeRel(relPath, content)
    })
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

  // ---------- Skill（M2） ----------
  const runnerFor = (): SkillRunner => new SkillRunner(ctx.skills, requireProject().root)

  /** 未显式指定预设时，按 Skill 的 recommended_model 走角色映射，再退到写作模型/首个预设。 */
  const resolveSkillCreds = async (skill: Skill, presetId?: string): Promise<PresetCreds> => {
    if (presetId) {
      const creds = await ctx.settings.getCredentials(presetId)
      if (!creds) throw new Error('找不到指定模型预设')
      return creds
    }
    const roles = await ctx.settings.getRoles()
    const byRole = skill.recommendedModel ? roles[skill.recommendedModel] : undefined
    const fallback = byRole ?? roles.writer ?? roles.planner ?? roles.checker ?? roles.polisher
    let id = fallback
    if (!id) {
      const presets = await ctx.settings.listPresets()
      id = presets[0]?.id
    }
    if (!id) throw new Error('尚未配置任何模型预设，请先在设置中添加')
    const creds = await ctx.settings.getCredentials(id)
    if (!creds) throw new Error('找不到指定模型预设')
    return creds
  }

  ipcMain.handle('skills:list', () => wrap(() => ctx.skills.list()))
  ipcMain.handle('skills:get', (_e, id: string) => wrap(() => ctx.skills.get(id)))
  ipcMain.handle('skills:save', (_e, skill: Skill) =>
    wrap(async () => {
      const saved = await ctx.skills.save(skill)
      ctx.logger.info(`已保存 Skill：${saved.name}（v${saved.version}）`)
      return saved
    })
  )
  ipcMain.handle('skills:duplicate', (_e, id: string) => wrap(() => ctx.skills.duplicate(id)))
  ipcMain.handle('skills:remove', (_e, id: string) => wrap(() => ctx.skills.remove(id)))
  ipcMain.handle('skills:importText', (_e, fileName: string, content: string) =>
    wrap(() => ctx.skills.importText(fileName, content))
  )
  ipcMain.handle('skills:importDialog', () =>
    wrap(async () => {
      const file = await host.pickMarkdownFile()
      if (!file) return null
      const { promises: fsp } = await import('node:fs')
      const content = await fsp.readFile(file, 'utf8')
      const skill = await ctx.skills.importText(path.basename(file), content)
      ctx.logger.info(`已导入 Skill：${skill.name}（${skill.id}）`)
      return skill
    })
  )
  ipcMain.handle('skills:exportDialog', (_e, id: string) =>
    wrap(async () => {
      const skill = await ctx.skills.get(id)
      if (!skill) throw new Error('Skill 不存在')
      const text = await ctx.skills.exportText(id)
      return host.saveMarkdownFile(`${skill.id}.md`, text)
    })
  )

  ipcMain.handle('skills:run', (e, params: SkillRunParams) =>
    wrap(async () => {
      const prep = await runnerFor().prepare(params)
      const creds = await resolveSkillCreds(prep.skill, params.presetId)
      const sender = e.sender
      const send = (ev: SkillEvent): void => {
        if (!sender.isDestroyed()) sender.send('skill:event', ev)
      }
      const ticket = ctx.llm.startChat({ preset: creds, messages: prep.messages }, {
        onDelta: (callId, full) => send({ callId, type: 'delta', full }),
        onDone: (callId, raw) => send({ callId, type: 'done', full: raw, result: runnerFor().finalize(prep, raw) }),
        onError: (callId, error, partial, cancelled) =>
          send({ callId, type: 'error', full: partial, error, cancelled })
      })
      ctx.logger.info(`运行 Skill：${prep.skill.name}（目标 ${params.target}）`)
      return ticket.callId
    })
  )
  ipcMain.handle('skills:cancel', (_e, callId: string) => wrap(() => ctx.llm.cancel(callId)))

  ipcMain.handle('skills:preview', (_e, params: SkillRunParams) =>
    wrap(async (): Promise<SkillPreview> => {
      const prep = await runnerFor().prepare(params)
      return {
        skillId: prep.skill.id,
        skillName: prep.skill.name,
        kind: prep.kind,
        writesTo: prep.skill.writesTo ?? 'chapter',
        targetText: prep.targetText,
        variables: prep.variables,
        prompt: prep.messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n'),
        ...(prep.context ? { context: prep.context } : {})
      }
    })
  )

  // ---------- 故事框架 / 章节门禁 / 状态回写（M3） ----------
  ipcMain.handle('framework:applyText', (_e, text: string) =>
    wrap(async (): Promise<FrameworkApplyResult> => {
      const parsed = parseFramework(text)
      const written = await applyFramework(requireProject().root, parsed)
      ctx.logger.info(`故事框架已落库：${written.length} 个文件`)
      return { written, characters: parsed.characters.map((c) => c.name), unknownSections: parsed.unknownSections }
    })
  )

  ipcMain.handle('state:writeback', (_e, raw: string, chapterNo?: number) =>
    wrap(async (): Promise<StateWritebackResult> => {
      const payload = parseWriteback(raw)
      const result = await applyStateWriteback(requireProject().root, payload, chapterNo)
      ctx.logger.info(
        `状态回写：人物 +${result.charactersAdded}/~${result.charactersUpdated}，伏笔 +${result.planted}/回收 ${result.resolved}，事件 +${result.eventsAdded}`
      )
      return result
    })
  )

  ipcMain.handle('chapter:checkGate', (_e, chapterNo: number) =>
    wrap(async () => {
      try {
        await requireChapterPlan(requireProject().root, chapterNo)
        return { ok: true }
      } catch (e) {
        if (e instanceof ChapterGateError) return { ok: false, guidance: e.guidance }
        throw e
      }
    })
  )

  // ---------- 历史快照（M2） ----------
  ipcMain.handle('history:list', (_e, relPath?: string) => wrap(() => listSnapshots(requireProject().root, relPath)))
  ipcMain.handle('history:read', (_e, id: string) => wrap(() => readSnapshot(requireProject().root, id)))
  ipcMain.handle('history:restore', (_e, id: string) =>
    wrap(async () => {
      const store = requireProject()
      const relPath = await snapshotRelPath(store.root, id)
      const content = await readSnapshot(store.root, id)
      const current = await store.readRel(relPath).catch(() => null)
      if (current !== null) await snapshotFile(store.root, relPath, current)
      await store.writeRel(relPath, content)
      ctx.logger.info(`已还原快照：${relPath}`)
    })
  )

  // ---------- 工作流与运行（M4） ----------
  let runStore: { root: string; store: RunStore } | null = null
  const getRunStore = async (): Promise<RunStore> => {
    const root = requireProject().root
    if (runStore && runStore.root === root) return runStore.store
    runStore?.store.close()
    runStore = { root, store: await runStoreFor(root) }
    return runStore.store
  }

  const engineFor = async (): Promise<WorkflowEngine> => {
    const store = requireProject()
    const db = await getRunStore()
    const executor: NodeExecutor = async ({ node, inputText, chapterNo, presetId }) => {
      const runner = new SkillRunner(ctx.skills, store.root)
      const prep = await runner.prepare({
        skillId: node.skillId,
        presetId,
        target: 'chapter',
        text: inputText,
        ...(chapterNo != null ? { chapterNo } : {})
      })
      const creds = await resolveSkillCreds(prep.skill, presetId)
      const res = await ctx.llm.chat({ preset: creds, messages: prep.messages })
      const final = runner.finalize(prep, res.text)
      return {
        output: final.text ?? '',
        raw: final.raw,
        kind: prep.kind,
        writesTo: prep.skill.writesTo ?? 'chapter'
      }
    }
    const deps: EngineDeps = {
      readFile: (rel) => store.readRel(rel),
      writeFile: async (rel, content) => {
        const prev = await store.readRel(rel).catch(() => null)
        if (prev !== null) await snapshotFile(store.root, rel, prev)
        await store.writeRel(rel, content)
      },
      applyFramework: async (text) => applyFramework(store.root, parseFramework(text)),
      applyState: async (raw, chapterNo) =>
        applyStateWriteback(store.root, parseWriteback(raw), chapterNo)
    }
    return new WorkflowEngine(db, ctx.workflows, executor, deps)
  }

  ipcMain.handle('workflow:list', () => wrap(() => ctx.workflows.list()))
  ipcMain.handle('workflow:templates', () => wrap(() => ctx.workflows.templates()))
  ipcMain.handle('workflow:save', (_e, w: Workflow) => wrap(() => ctx.workflows.save(w)))
  ipcMain.handle('workflow:remove', (_e, id: string) => wrap(() => ctx.workflows.remove(id)))
  ipcMain.handle('workflow:createFromTemplate', (_e, id: string) => wrap(() => ctx.workflows.createFromTemplate(id)))

  ipcMain.handle('runs:list', () => wrap(() => getRunStore().then((s) => s.listRuns())))
  ipcMain.handle('runs:unfinished', () => wrap(() => getRunStore().then((s) => s.unfinished())))
  ipcMain.handle('runs:get', (_e, id: string) => wrap(() => getRunStore().then((s) => s.getRun(id))))
  ipcMain.handle('runs:start', (_e, workflowId: string, opts?: { chapterNo?: number; presetId?: string }) =>
    wrap(async (): Promise<WorkflowRun> => {
      const workflow = await ctx.workflows.get(workflowId)
      if (!workflow) throw new Error(`工作流不存在：${workflowId}`)
      const engine = await engineFor()
      const run = await engine.start(workflow, opts ?? {})
      ctx.logger.info(`工作流已启动：${workflow.name}（状态 ${run.status}）`)
      return run
    })
  )
  ipcMain.handle('runs:resume', (_e, id: string) => wrap(() => engineFor().then((e) => e.resume(id))))
  ipcMain.handle('runs:confirm', (_e, id: string, nodeId: string, editedOutput?: string) =>
    wrap(() => engineFor().then((e) => e.confirm(id, nodeId, editedOutput)))
  )
  ipcMain.handle('runs:retry', (_e, id: string, nodeId: string) =>
    wrap(() => engineFor().then((e) => e.retry(id, nodeId)))
  )
  ipcMain.handle('runs:abort', (_e, id: string) => wrap(() => engineFor().then((e) => e.abort(id))))

  // ---------- 剪贴板 / 应用 ----------
  ipcMain.handle('clipboard:write', (_e, text: string) => wrap(() => clipboard.writeText(text)))
  ipcMain.handle('app:version', () => Promise.resolve('0.1.0'))
}
