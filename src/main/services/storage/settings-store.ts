import * as path from 'node:path'
import { atomicWriteJson, readJson } from './atomic'
import { maskKey } from '../llm/redact'
import type { PresetCreds } from '../llm/adapters'
import {
  DEFAULT_APP_CONFIG,
  type AppConfig,
  type AppSettings,
  type PresetInput,
  type PresetView,
  type Protocol,
  type RoleMapping
} from '../../../shared/types'

/**
 * 应用设置存储（userData/settings.json）：
 * - API Key 只以 safeStorage 加密后的 base64 存放（apiKeyEncrypted），绝不明文落盘；
 * - 系统不支持加密时（部分 Linux 桌面），Key 仅保留在内存（本次会话有效），并明确标记
 *   apiKeySessionOnly=true 提示用户；
 * - 渲染进程永远只能拿到 apiKeyHint（脱敏提示），拿不到密钥本身。
 */

/** 加密盒子抽象：主进程用 safeStorage 实现，单测用 fake 实现。 */
export interface SecretBox {
  /** 加密失败（如系统不支持）返回 null */
  encrypt(plain: string): string | null
  decrypt(stored: string): string | null
}

export interface StoredPreset {
  id: string
  name: string
  protocol: Protocol
  baseUrl: string
  apiKeyEncrypted: string | null
  apiKeyHint: string
  apiKeySessionOnly: boolean
  model: string
  contextLength: number
  temperature: number
  maxOutputTokens: number
  createdAt: string
}

interface SettingsFile {
  version: number
  presets: StoredPreset[]
  roles: RoleMapping
  config: AppConfig
}

function defaultSettings(): SettingsFile {
  return { version: 1, presets: [], roles: {}, config: { ...DEFAULT_APP_CONFIG } }
}

export class SettingsStore {
  private data: SettingsFile | null = null
  /** 加密不可用时的会话级密钥（进程内存，不落盘） */
  private sessionKeys = new Map<string, string>()

  constructor(
    private readonly filePath: string,
    private readonly box: SecretBox,
    private readonly newId: () => string = defaultId
  ) {}

  private async ensureLoaded(): Promise<SettingsFile> {
    if (this.data) return this.data
    this.data = await readJson<SettingsFile>(this.filePath, defaultSettings())
    if (!Array.isArray(this.data.presets)) this.data.presets = []
    this.data.config = { ...DEFAULT_APP_CONFIG, ...this.data.config }
    return this.data
  }

  private async persist(): Promise<void> {
    if (!this.data) return
    await atomicWriteJson(this.filePath, this.data)
  }

  async getSettings(): Promise<AppSettings> {
    const d = await this.ensureLoaded()
    return {
      version: d.version,
      presets: d.presets.map(toView),
      roles: { ...d.roles },
      config: { ...d.config }
    }
  }

  async listPresets(): Promise<PresetView[]> {
    const d = await this.ensureLoaded()
    return d.presets.map(toView)
  }

  async getConfig(): Promise<AppConfig> {
    const d = await this.ensureLoaded()
    return { ...d.config }
  }

  async setAppConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
    const d = await this.ensureLoaded()
    d.config = { ...d.config, ...patch }
    if (d.config.concurrencyLimit < 1) d.config.concurrencyLimit = 1
    await this.persist()
    return { ...d.config }
  }

  async upsertPreset(input: PresetInput): Promise<PresetView> {
    const d = await this.ensureLoaded()
    const existing = input.id ? d.presets.find((p) => p.id === input.id) : undefined
    const now = new Date().toISOString()
    let stored: StoredPreset

    if (existing) {
      existing.name = input.name
      existing.protocol = input.protocol
      existing.baseUrl = input.baseUrl
      existing.model = input.model
      existing.contextLength = input.contextLength
      existing.temperature = input.temperature
      existing.maxOutputTokens = input.maxOutputTokens
      stored = existing
    } else {
      stored = {
        id: this.newId(),
        name: input.name,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        apiKeyEncrypted: null,
        apiKeyHint: '',
        apiKeySessionOnly: false,
        model: input.model,
        contextLength: input.contextLength,
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        createdAt: now
      }
      d.presets.push(stored)
    }

    if (input.apiKey != null && input.apiKey !== '') {
      const enc = this.box.encrypt(input.apiKey)
      if (enc) {
        stored.apiKeyEncrypted = enc
        stored.apiKeySessionOnly = false
        this.sessionKeys.delete(stored.id)
      } else {
        // 系统不支持加密：拒绝明文落盘，密钥仅保留在内存（本次会话有效）
        stored.apiKeyEncrypted = null
        stored.apiKeySessionOnly = true
        this.sessionKeys.set(stored.id, input.apiKey)
      }
      stored.apiKeyHint = maskKey(input.apiKey)
    }
    await this.persist()
    return toView(stored)
  }

  async deletePreset(id: string): Promise<void> {
    const d = await this.ensureLoaded()
    d.presets = d.presets.filter((p) => p.id !== id)
    this.sessionKeys.delete(id)
    for (const role of Object.keys(d.roles) as Array<keyof RoleMapping>) {
      if (d.roles[role] === id) delete d.roles[role]
    }
    await this.persist()
  }

  async setRoles(roles: RoleMapping): Promise<void> {
    const d = await this.ensureLoaded()
    d.roles = { ...roles }
    await this.persist()
  }

  async getRoles(): Promise<RoleMapping> {
    const d = await this.ensureLoaded()
    return { ...d.roles }
  }

  /** 取某预设的调用凭据（解密只在主进程内存中发生）。不存在时返回 null。 */
  async getCredentials(presetId: string): Promise<PresetCreds | null> {
    const d = await this.ensureLoaded()
    const p = d.presets.find((x) => x.id === presetId)
    if (!p) return null
    let key = ''
    if (p.apiKeySessionOnly) {
      key = this.sessionKeys.get(p.id) ?? ''
    } else if (p.apiKeyEncrypted) {
      key = this.box.decrypt(p.apiKeyEncrypted) ?? ''
    }
    return {
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      apiKey: key,
      model: p.model,
      temperature: p.temperature,
      maxOutputTokens: p.maxOutputTokens,
      contextLength: p.contextLength
    }
  }

  /** 供日志脱敏注册：全部明文密钥（只在主进程内存中出现）。 */
  async collectPlainKeys(): Promise<string[]> {
    const d = await this.ensureLoaded()
    const keys: string[] = []
    for (const p of d.presets) {
      if (p.apiKeySessionOnly) {
        const k = this.sessionKeys.get(p.id)
        if (k) keys.push(k)
      } else if (p.apiKeyEncrypted) {
        const k = this.box.decrypt(p.apiKeyEncrypted)
        if (k) keys.push(k)
      }
    }
    return keys
  }
}

function toView(p: StoredPreset): PresetView {
  return {
    id: p.id,
    name: p.name,
    protocol: p.protocol,
    baseUrl: p.baseUrl,
    apiKeyHint: p.apiKeyHint,
    apiKeySessionOnly: p.apiKeySessionOnly,
    model: p.model,
    contextLength: p.contextLength,
    temperature: p.temperature,
    maxOutputTokens: p.maxOutputTokens,
    createdAt: p.createdAt
  }
}

function defaultId(): string {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function settingsFilePath(userDataDir: string): string {
  return path.join(userDataDir, 'settings.json')
}
