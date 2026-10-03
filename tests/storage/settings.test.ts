import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { SettingsStore, type SecretBox } from '../../src/main/services/storage/settings-store'

/** fake 加密盒：base64 混淆，模拟 safeStorage（加密失败返回 null 的行为也可注入）。 */
function fakeBox(opts: { fail?: boolean } = {}): SecretBox {
  return {
    encrypt(plain) {
      if (opts.fail) return null
      return `enc:test:${Buffer.from(plain, 'utf8').toString('base64')}`
    },
    decrypt(stored) {
      const b64 = stored.replace(/^enc:test:/, '')
      return Buffer.from(b64, 'base64').toString('utf8')
    }
  }
}

async function newStore(box: SecretBox = fakeBox()) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-settings-'))
  const filePath = path.join(dir, 'settings.json')
  return { store: new SettingsStore(filePath, box, (() => `id-${Math.random().toString(36).slice(2, 8)}`) as () => string), filePath }
}

describe('设置存储：API Key 不落盘明文', () => {
  it('保存预设后，磁盘文件中找不到 API Key 明文', async () => {
    const { store, filePath } = await newStore()
    const view = await store.upsertPreset({
      name: '测试预设',
      protocol: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:8801/v1',
      apiKey: 'sk-plain-text-secret-123',
      model: 'mock-model',
      contextLength: 128000,
      temperature: 0.7,
      maxOutputTokens: 4096
    })

    const raw = await fs.readFile(filePath, 'utf8')
    expect(raw).not.toContain('sk-plain-text-secret-123')
    expect(raw).toContain('enc:test:')

    // 渲染进程视图只有脱敏提示
    expect(view.apiKeyHint).not.toContain('sk-plain-text-secret-123')
    expect(view.apiKeyHint).toContain('***')
    const settings = await store.getSettings()
    expect(JSON.stringify(settings)).not.toContain('sk-plain-text-secret-123')

    // 主进程可解密出凭据用于调用
    const creds = await store.getCredentials(view.id)
    expect(creds?.apiKey).toBe('sk-plain-text-secret-123')
  })

  it('加密不可用时：密钥只在内存（会话级），磁盘仍无明文', async () => {
    const { store, filePath } = await newStore(fakeBox({ fail: true }))
    const view = await store.upsertPreset({
      name: '会话预设',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-session-only-987',
      model: 'claude-x',
      contextLength: 200000,
      temperature: 0.5,
      maxOutputTokens: 2048
    })

    const raw = await fs.readFile(filePath, 'utf8')
    expect(raw).not.toContain('sk-session-only-987')
    expect(view.apiKeySessionOnly).toBe(true)

    // 本次会话内仍可调用（内存密钥）
    const creds = await store.getCredentials(view.id)
    expect(creds?.apiKey).toBe('sk-session-only-987')
  })

  it('编辑预设不传 Key 时沿用已存密钥', async () => {
    const { store } = await newStore()
    const v1 = await store.upsertPreset({
      name: 'P',
      protocol: 'openai-compatible',
      baseUrl: 'http://a/v1',
      apiKey: 'sk-keep-me-0001',
      model: 'm1',
      contextLength: 1000,
      temperature: 0.2,
      maxOutputTokens: 100
    })
    const v2 = await store.upsertPreset({
      id: v1.id,
      name: 'P2',
      protocol: 'openai-compatible',
      baseUrl: 'http://b/v1',
      apiKey: null,
      model: 'm2',
      contextLength: 1000,
      temperature: 0.2,
      maxOutputTokens: 100
    })
    expect(v2.name).toBe('P2')
    const creds = await store.getCredentials(v2.id)
    expect(creds?.apiKey).toBe('sk-keep-me-0001')
    expect(creds?.model).toBe('m2')
  })
})

describe('设置存储：角色映射与应用配置', () => {
  it('setRoles / deletePreset 级联清理 / setAppConfig 默认并发 2', async () => {
    const { store } = await newStore()
    const p = await store.upsertPreset({
      name: '写作模型',
      protocol: 'openai-compatible',
      baseUrl: 'http://a/v1',
      apiKey: 'sk-role-0001',
      model: 'm',
      contextLength: 1000,
      temperature: 0.2,
      maxOutputTokens: 100
    })
    await store.setRoles({ writer: p.id, planner: p.id })
    expect(await store.getRoles()).toEqual({ writer: p.id, planner: p.id })

    await store.deletePreset(p.id)
    expect(await store.getRoles()).toEqual({})
    expect(await store.listPresets()).toEqual([])

    const config = await store.setAppConfig({ concurrencyLimit: 0 })
    expect(config.concurrencyLimit).toBe(1) // 非法值收敛为 1
    const config2 = await store.setAppConfig({})
    expect(config2.concurrencyLimit).toBe(1)
  })

  it('损坏的设置文件回退到默认值', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-settings-'))
    const filePath = path.join(dir, 'settings.json')
    await fs.writeFile(filePath, '{ not valid json !!!', 'utf8')
    const store = new SettingsStore(filePath, fakeBox())
    const settings = await store.getSettings()
    expect(settings.presets).toEqual([])
    expect(settings.config.concurrencyLimit).toBe(2)
  })
})
