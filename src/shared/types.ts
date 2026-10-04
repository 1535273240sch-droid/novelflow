/**
 * NovelFlow 共享类型（主进程 / 预加载 / 渲染进程共用）。
 * 注意：此文件及其下游模块不得 import 'electron'，以便单元测试直接运行。
 */

/** 模型协议 */
export type Protocol = 'openai-compatible' | 'anthropic'

/** 模型角色：规划 / 写作 / 检查 / 润色 */
export type ModelRole = 'planner' | 'writer' | 'checker' | 'polisher'

export const MODEL_ROLES: ModelRole[] = ['planner', 'writer', 'checker', 'polisher']

export const MODEL_ROLE_LABELS: Record<ModelRole, string> = {
  planner: '规划模型',
  writer: '写作模型',
  checker: '检查模型',
  polisher: '润色模型'
}

/** 模型预设（渲染进程可见视图，绝不含密钥明文） */
export interface PresetView {
  id: string
  name: string
  protocol: Protocol
  baseUrl: string
  /** 脱敏提示，如 "sk-***abcd"；密钥本身永不回传渲染进程 */
  apiKeyHint: string
  /** true 表示密钥因系统不支持加密而仅在本次会话内有效 */
  apiKeySessionOnly: boolean
  model: string
  /** 上下文长度（token） */
  contextLength: number
  /** 默认温度 */
  temperature: number
  /** 最大输出（token） */
  maxOutputTokens: number
  createdAt: string
}

/** 新建/编辑预设时的输入（api_key 明文仅经 IPC 传入主进程，立即加密，不落盘明文） */
export interface PresetInput {
  id?: string
  name: string
  protocol: Protocol
  baseUrl: string
  /** 传 undefined/null 表示沿用已存密钥（编辑时不改动密钥） */
  apiKey?: string | null
  model: string
  contextLength: number
  temperature: number
  maxOutputTokens: number
}

/** 模型角色映射：角色 → 预设 id */
export type RoleMapping = Partial<Record<ModelRole, string>>

/** 应用设置（并发限制、节流、自动保存间隔） */
export interface AppConfig {
  /** 同时进行的 LLM 请求上限，默认 2，可配置 */
  concurrencyLimit: number
  /** 流式输出刷新节流（毫秒），默认 80（约 50–100ms） */
  streamThrottleMs: number
  /** 编辑器自动保存间隔（毫秒），默认 3500（3–5 秒） */
  autoSaveMs: number
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  concurrencyLimit: 2,
  streamThrottleMs: 80,
  autoSaveMs: 3500
}

/** 设置页拿到的完整设置（预设不含明文密钥） */
export interface AppSettings {
  version: number
  presets: PresetView[]
  roles: RoleMapping
  config: AppConfig
}

/** 项目信息 */
export interface ProjectInfo {
  /** 项目根目录绝对路径 */
  dirPath: string
  name: string
  genre: string
  targetWords: number
  createdAt: string
}

/** 文件/目录条目（项目树用） */
export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'dir'
}

/** LLM 消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 发起 LLM 对话请求（渲染进程 → 主进程） */
export interface ChatStartParams {
  /** 二选一：直接给预设 id */
  presetId?: string
  /** 或临时给完整预设（测试用） */
  preset?: PresetInput
  /** 用户输入的提示（渲染进程只传提示文本，不涉及内置提示词） */
  prompt: string
  /** 可选 system 文本（来自用户输入） */
  system?: string
}

export type LlmEventType = 'delta' | 'done' | 'error'

/** LLM 流式事件（主进程 → 渲染进程，已按 streamThrottleMs 节流） */
export interface LlmEvent {
  callId: string
  type: LlmEventType
  /** 到当前为止的完整文本（delta 事件为节流后的全量快照） */
  full: string
  /** error 事件时的失败原因（已脱敏） */
  error?: string
  cancelled?: boolean
}

// ---------------- M2：Skill 系统 ----------------

/** Skill 输出形态：text=普通文本产物；rewrite=可逐处接受的改写；issues=结构化问题清单 */
export type SkillOutputKind = 'text' | 'rewrite' | 'issues'

/** 产物写回位置：正文 / 章节计划 / 故事框架(bible) / 状态(state) */
export type SkillWritesTo = 'chapter' | 'outline' | 'bible' | 'state'

/** Skill 元数据（列表页用，不含正文提示词） */
export interface SkillMeta {
  id: string
  name: string
  description: string
  /** 编辑保存后递增 */
  version: number
  recommendedModel: ModelRole | null
  output: SkillOutputKind
  /** 声明使用的变量名（如 chapter_text、bible.文风规范） */
  inputs: string[]
  /** 前置依赖（如 chapter_plan：无本章计划则拒绝运行） */
  requires: string[]
  /** 产物写回位置（缺省视为 chapter） */
  writesTo?: SkillWritesTo
  /** 是否来自内置 skills/ 目录 */
  builtin: boolean
  createdAt: string
  updatedAt: string
}

/** 完整 Skill（含正文提示词，仅在主进程读取后经 IPC 传给设置/编辑界面） */
export interface Skill extends SkillMeta {
  body: string
}

/** 运行目标：选中文本 / 整章 */
export type SkillTarget = 'selection' | 'chapter'

export interface SkillRunParams {
  skillId: string
  /** 指定预设；缺省时按 Skill 的 recommendedModel 走角色映射 */
  presetId?: string
  target: SkillTarget
  /** 章节正文或选中文本 */
  text: string
  /** 章号（章节规划/状态回写等 Skill 需要） */
  chapterNo?: number
  /** 用户补充的变量 */
  vars?: Record<string, string>
  /** 覆盖本次上下文 token 预算（默认 6000） */
  budget?: number
}

/** 结构化的错别字/病句/一致性条目 */
export interface SkillIssue {
  original: string
  suggestion: string
  reason?: string
  /** 在目标文本中的起始下标（可为空） */
  index?: number
  /** 1 起行号（可为空） */
  line?: number
}

export interface SkillRunResult {
  kind: SkillOutputKind
  /** 模型原始输出 */
  raw: string
  /** rewrite/text 形态的最终文本 */
  text?: string
  /** issues 形态的解析结果 */
  issues?: SkillIssue[]
  /** 结构化输出畸形、已优雅降级为纯文本时置 true */
  degraded?: boolean
  degradedReason?: string
}

/** 「查看本次实际发送的上下文」预览（与实际发送一致） */
export interface SkillPreview {
  skillId: string
  skillName: string
  kind: SkillOutputKind
  writesTo: SkillWritesTo
  targetText: string
  /** 各变量最终取值 */
  variables: Record<string, string>
  /** 实际发送给模型的完整提示词 */
  prompt: string
  context?: { budget: number; totalTokens: number; droppedKeys: string[]; overBudget: boolean }
}

export type SkillEventType = 'delta' | 'done' | 'error'

export interface SkillEvent {
  callId: string
  type: SkillEventType
  /** 到当前为止的完整文本（全量快照语义） */
  full: string
  result?: SkillRunResult
  error?: string
  cancelled?: boolean
}

/** 历史快照条目（.history/） */
export interface SnapshotEntry {
  /** 快照 id（用于读取/还原） */
  id: string
  /** 来源文件相对路径 */
  relPath: string
  /** 展示名（来源文件名） */
  name: string
  createdAt: string
  size: number
}

/** 状态回写结果（M3） */
export interface StateWritebackResult {
  charactersUpdated: number
  charactersAdded: number
  planted: number
  resolved: number
  eventsAdded: number
}

/** 故事框架落库结果（M3） */
export interface FrameworkApplyResult {
  written: string[]
  characters: string[]
  unknownSections: string[]
}

/** 写正文门禁检查结果（M3） */
export interface ChapterGateResult {
  ok: boolean
  /** 未通过时的引导语 */
  guidance?: string
}

// ---------------- M4：工作流 ----------------

export type WorkflowInputSource = 'previous' | 'file' | 'manual'
export type WorkflowOutputSink = 'next' | 'file' | 'display'

/** 工作流节点四要素：选 Skill → 选模型 → 绑定输入 → 输出去向 */
export interface WorkflowNode {
  id: string
  name: string
  skillId: string
  /** 模型预设；缺省时按 Skill 的 recommended_model 走角色映射 */
  presetId?: string
  input: {
    source: WorkflowInputSource
    /** source=file 时的项目相对路径 */
    relPath?: string
    /** source=manual 时的固定文本 */
    text?: string
  }
  sink: {
    kind: WorkflowOutputSink
    /** sink.kind=file 时的项目相对路径 */
    relPath?: string
  }
  /** 人工确认点：运行到此节点后暂停 */
  confirm?: boolean
}

export interface Workflow {
  id: string
  name: string
  nodes: WorkflowNode[]
  builtin: boolean
  createdAt: string
  updatedAt: string
}

export type WorkflowNodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'awaiting_confirm'

export interface WorkflowNodeState {
  nodeId: string
  name: string
  skillId: string
  status: WorkflowNodeStatus
  /** 流向下一节点的文本（issues 类检查节点此处为原文，保持文本流不被检查结果污染） */
  output?: string
  /** 模型原始输出（供查看，如检查清单 JSON） */
  raw?: string
  kind?: SkillOutputKind
  writesTo?: SkillWritesTo
  error?: string
  startedAt?: string
  finishedAt?: string
}

export type WorkflowRunStatus = 'running' | 'paused' | 'failed' | 'completed' | 'aborted'

export interface WorkflowRun {
  id: string
  workflowId: string
  workflowName: string
  chapterNo?: number
  status: WorkflowRunStatus
  nodes: WorkflowNodeState[]
  createdAt: string
  updatedAt: string
}

/** 测试连接结果 */
export interface TestConnectionResult {
  ok: boolean
  latencyMs?: number
  model?: string
  /** 失败原因（已脱敏、含可读解释） */
  error?: string
}

export interface Api {
  project: {
    /** 弹出系统目录选择框并新建项目 */
    createDialog(): Promise<ProjectInfo | null>
    /** 在指定目录新建项目（要求目录内无 novel.json） */
    create(dirPath: string, meta?: { name?: string; genre?: string; targetWords?: number }): Promise<ProjectInfo>
    openDialog(): Promise<ProjectInfo | null>
    open(dirPath: string): Promise<ProjectInfo>
    getCurrent(): Promise<ProjectInfo | null>
  }
  files: {
    /** 列出项目内相对目录（安全限制在项目根内） */
    list(relDir: string): Promise<FileEntry[]>
    read(relPath: string): Promise<string>
    /** 原子写入（临时文件 + 重命名） */
    write(relPath: string, content: string): Promise<void>
    /** 写入前先把当前内容快照到 .history/（用于应用 Skill 改写） */
    writeWithSnapshot(relPath: string, content: string): Promise<void>
    /** 在 chapters/ 或 outline/ 下新建 第NNN章.md，返回文件名 */
    createChapter(kind: 'chapters' | 'outline'): Promise<string>
  }
  settings: {
    get(): Promise<AppSettings>
    savePreset(input: PresetInput): Promise<PresetView>
    deletePreset(id: string): Promise<void>
    setRoles(roles: RoleMapping): Promise<void>
    setAppConfig(config: Partial<AppConfig>): Promise<void>
  }
  llm: {
    testConnection(input: PresetInput & { id?: string }): Promise<TestConnectionResult>
    /** 发起流式对话，返回 callId；结果通过 onEvent 推送 */
    chat(params: ChatStartParams): Promise<string>
    cancel(callId: string): Promise<boolean>
    onEvent(cb: (ev: LlmEvent) => void): () => void
  }
  clipboard: {
    writeText(text: string): Promise<void>
  }
  skills: {
    /** 内置 + 用户自建 Skill 列表 */
    list(): Promise<SkillMeta[]>
    get(id: string): Promise<Skill | null>
    /** 弹出文件选择框导入 SKILL.md，返回入库后的 Skill */
    importDialog(): Promise<Skill | null>
    /** 从文本导入（供自动化/测试） */
    importText(fileName: string, content: string): Promise<Skill>
    /** 保存（编辑）→ 版本号递增 */
    save(skill: Skill): Promise<Skill>
    duplicate(id: string): Promise<Skill>
    remove(id: string): Promise<void>
    /** 弹出保存框导出 SKILL.md，返回导出路径（取消为 null） */
    exportDialog(id: string): Promise<string | null>
    /** 运行（流式），返回 callId；结果经 onEvent 推送 */
    run(params: SkillRunParams): Promise<string>
    /** 预演：组装上下文与提示词但不调用模型（「查看本次实际发送的上下文」） */
    preview(params: SkillRunParams): Promise<SkillPreview>
    cancel(callId: string): Promise<boolean>
    onEvent(cb: (ev: SkillEvent) => void): () => void
  }
  framework: {
    /** 把「生成故事框架」的分节 Markdown 落库到 bible/ */
    applyText(text: string): Promise<FrameworkApplyResult>
  }
  state: {
    /** 把「状态回写」的 JSON 输出合并进 state/ 三个文件 */
    writeback(raw: string, chapterNo?: number): Promise<StateWritebackResult>
  }
  chapter: {
    /** 写正文门禁：本章计划是否存在（界面与单测共用同一实现） */
    checkGate(chapterNo: number): Promise<ChapterGateResult>
  }
  workflow: {
    list(): Promise<Workflow[]>
    save(workflow: Workflow): Promise<Workflow>
    remove(id: string): Promise<void>
    /** 三个内置模板（开新书 / 写一章 / 精修） */
    templates(): Promise<Workflow[]>
    createFromTemplate(templateId: string): Promise<Workflow>
  }
  runs: {
    list(): Promise<WorkflowRun[]>
    /** 上次未完成的运行（供重启时提示继续） */
    unfinished(): Promise<WorkflowRun | null>
    get(id: string): Promise<WorkflowRun | null>
    start(workflowId: string, opts?: { chapterNo?: number; presetId?: string }): Promise<WorkflowRun>
    resume(id: string): Promise<WorkflowRun>
    /** 人工确认点：查看/修改中间结果后继续 */
    confirm(id: string, nodeId: string, editedOutput?: string): Promise<WorkflowRun>
    /** 从失败/指定节点重试 */
    retry(id: string, nodeId: string): Promise<WorkflowRun>
    abort(id: string): Promise<WorkflowRun>
  }
  history: {
    /** 列出某文件的全部快照（不传则列全部） */
    list(relPath?: string): Promise<SnapshotEntry[]>
    read(id: string): Promise<string>
    /** 还原快照到其来源文件（还原前会先对当前内容再做一次快照） */
    restore(id: string): Promise<void>
  }
  app: {
    version(): Promise<string>
  }
}

/** 渲染进程通过 window.novelflow 访问主进程能力 */
export interface NovelflowWindow {
  novelflow: Api
}
