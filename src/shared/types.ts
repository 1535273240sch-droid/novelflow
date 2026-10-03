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
  app: {
    version(): Promise<string>
  }
}

/** 渲染进程通过 window.novelflow 访问主进程能力 */
export interface NovelflowWindow {
  novelflow: Api
}
