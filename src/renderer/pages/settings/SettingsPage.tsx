import { useEffect, useState } from 'react'
import { useSettingsStore } from '../../stores/settings'
import { useProjectStore } from '../../stores/project'
import { useUiStore } from '../../stores/ui'
import {
  MODEL_ROLE_LABELS,
  MODEL_ROLES,
  type AppConfig,
  type CopyFormat,
  type ExportFormat,
  type ExportScope,
  type PresetInput,
  type PresetView,
  type Protocol,
  type RoleMapping,
  type TestConnectionResult
} from '../../../shared/types'

const MOCK_BASE_URL = 'http://127.0.0.1:8801/v1'

function emptyForm(): PresetInput {
  return {
    name: '',
    protocol: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    model: '',
    contextLength: 128000,
    temperature: 0.7,
    maxOutputTokens: 4096
  }
}

/** 设置页：模型预设增删改 + 测试连接 + 模型角色映射 + 性能配置。 */
export function SettingsPage({ onBack }: { onBack: () => void }) {
  const settings = useSettingsStore((s) => s.settings)
  const savePreset = useSettingsStore((s) => s.savePreset)
  const deletePreset = useSettingsStore((s) => s.deletePreset)
  const setRoles = useSettingsStore((s) => s.setRoles)
  const setAppConfig = useSettingsStore((s) => s.setAppConfig)
  const showToast = useUiStore((s) => s.showToast)

  const [form, setForm] = useState<PresetInput | null>(null)
  const [testing, setTesting] = useState<string>('') // 正在测试的预设 id
  const [results, setResults] = useState<Record<string, TestConnectionResult>>({})
  const [rolesDraft, setRolesDraft] = useState<RoleMapping>({})
  const [configDraft, setConfigDraft] = useState<AppConfig | null>(null)
  const [exportScope, setExportScope] = useState<ExportScope>('book')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('txt')
  const [exportFrom, setExportFrom] = useState('1')
  const [exportTo, setExportTo] = useState('999')
  const project = useProjectStore((s) => s.project)
  const currentPath = useProjectStore((s) => s.currentPath)

  useEffect(() => {
    if (settings) {
      setRolesDraft({ ...settings.roles })
      setConfigDraft({ ...settings.config })
    }
  }, [settings])

  if (!settings || !configDraft) return null

  const startCreate = () => setForm(emptyForm())
  const startEdit = (p: PresetView) =>
    setForm({
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      apiKey: '', // 留空 = 不修改已存密钥
      model: p.model,
      contextLength: p.contextLength,
      temperature: p.temperature,
      maxOutputTokens: p.maxOutputTokens
    })

  const submitForm = async () => {
    if (!form) return
    if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()) {
      showToast('名称、base_url、模型名不能为空')
      return
    }
    const input: PresetInput = { ...form, apiKey: form.apiKey?.trim() ? form.apiKey.trim() : null }
    await savePreset(input)
    showToast('预设已保存（API Key 已加密存储）')
    setForm(null)
  }

  const testConnection = async (p: PresetView) => {
    setTesting(p.id)
    setResults((r) => ({ ...r, [p.id]: { ok: false, error: '测试中…' } }))
    try {
      const result = await window.novelflow.llm.testConnection({
        id: p.id,
        name: p.name,
        protocol: p.protocol,
        baseUrl: p.baseUrl,
        apiKey: null,
        model: p.model,
        contextLength: p.contextLength,
        temperature: p.temperature,
        maxOutputTokens: p.maxOutputTokens
      })
      setResults((r) => ({ ...r, [p.id]: result }))
    } finally {
      setTesting('')
    }
  }

  const remove = async (p: PresetView) => {
    if (!window.confirm(`确定删除预设「${p.name}」？`)) return
    await deletePreset(p.id)
    showToast('已删除')
  }

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <label className="nf-label">
      {label}
      <span className="mt-1 block">{node}</span>
      {hint && <span className="mt-1 block font-normal text-slate-400">{hint}</span>}
    </label>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-7">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <h1 className="nf-page-title">设置</h1>
            <button onClick={onBack} className="nf-btn nf-btn-sm nf-btn-ghost">
              返回编辑器
            </button>
          </div>
          <hr className="nf-brush-rule mt-3" />
        </div>

        {/* 模型预设 */}
        <section className="nf-card mb-8 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">模型预设</h2>
            <button onClick={startCreate} className="nf-btn nf-btn-sm nf-btn-primary">
              + 新建预设
            </button>
          </div>

          {settings.presets.length === 0 && (
            <div className="nf-callout nf-callout-info mb-4">
              尚无预设。可用本地 mock 联调：先运行 <code className="rounded bg-slate-200/70 px-1">npm run mock</code>
              ，再新建预设，base_url 填 <code className="rounded bg-slate-200/70 px-1">{MOCK_BASE_URL}</code>
              ，模型名 mock-model。
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {settings.presets.map((p) => {
              const r = results[p.id]
              return (
                <div key={p.id} className="rounded-md border border-slate-200 p-3 transition-colors hover:bg-slate-50">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        <span className="nf-chip">{p.protocol}</span>
                        {p.apiKeySessionOnly && (
                          <span className="nf-chip border-amber-200 bg-amber-50 text-amber-800">
                            系统不支持加密：Key 仅本次会话有效
                          </span>
                        )}
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500">
                        {p.baseUrl} · 模型 {p.model} · 密钥 {p.apiKeyHint || '（未设置）'} · 上下文 {p.contextLength} · 温度{' '}
                        {p.temperature} · 最大输出 {p.maxOutputTokens}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        onClick={() => void testConnection(p)}
                        disabled={testing === p.id}
                        className="nf-btn nf-btn-sm nf-btn-ghost"
                      >
                        {testing === p.id ? '测试中…' : '测试连接'}
                      </button>
                      <button onClick={() => startEdit(p)} className="nf-btn nf-btn-sm nf-btn-ghost">
                        编辑
                      </button>
                      <button onClick={() => void remove(p)} className="nf-btn nf-btn-sm nf-btn-danger">
                        删除
                      </button>
                    </div>
                  </div>
                  {r && (
                    <div
                      className={`mt-2 text-xs ${r.ok ? 'text-green-700' : 'text-red-600'}`}
                      role="status"
                    >
                      {r.ok ? `连接成功，延迟 ${r.latencyMs}ms（模型 ${r.model}）` : `连接失败：${r.error}`}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 新建/编辑表单 */}
          {form && (
            <div className="mt-4 rounded-md border border-blue-200 bg-blue-50/40 p-4">
              <div className="mb-3 font-medium">{form.id ? '编辑预设' : '新建预设'}</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {field(
                  '名称',
                  <input
                    className="nf-input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="例如：本地 mock"
                  />
                )}
                {field(
                  '协议',
                  <select
                    className="nf-select"
                    value={form.protocol}
                    onChange={(e) => setForm({ ...form, protocol: e.target.value as Protocol })}
                  >
                    <option value="openai-compatible">openai-compatible</option>
                    <option value="anthropic">anthropic</option>
                  </select>
                )}
                {field(
                  'base_url',
                  <div className="flex gap-1.5">
                    <input
                      className="nf-input"
                      value={form.baseUrl}
                      onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                      placeholder={MOCK_BASE_URL}
                    />
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, baseUrl: MOCK_BASE_URL, model: 'mock-model' })}
                      className="nf-btn nf-btn-sm nf-btn-ghost shrink-0"
                      title="填入本地 mock 地址"
                    >
                      填入 mock
                    </button>
                  </div>,
                  'OpenAI 兼容地址通常以 /v1 结尾；本地模型（Ollama/LM Studio）同样适用'
                )}
                {field(
                  'API Key',
                  <input
                    type="password"
                    className="nf-input"
                    value={form.apiKey ?? ''}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder={form.id ? '留空则不修改已存密钥' : '仅加密存储，绝不明文落盘'}
                  />
                )}
                {field(
                  '模型名',
                  <input
                    className="nf-input"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder="例如 gpt-4o-mini / mock-model"
                  />
                )}
                {field(
                  '上下文长度（token）',
                  <input
                    type="number"
                    min={1024}
                    className="nf-input [font-variant-numeric:tabular-nums]"
                    value={form.contextLength}
                    onChange={(e) => setForm({ ...form, contextLength: Number(e.target.value) || 0 })}
                  />
                )}
                {field(
                  '默认温度',
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    max={2}
                    className="nf-input [font-variant-numeric:tabular-nums]"
                    value={form.temperature}
                    onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
                  />
                )}
                {field(
                  '最大输出（token）',
                  <input
                    type="number"
                    min={16}
                    className="nf-input [font-variant-numeric:tabular-nums]"
                    value={form.maxOutputTokens}
                    onChange={(e) => setForm({ ...form, maxOutputTokens: Number(e.target.value) || 0 })}
                  />
                )}
              </div>
              <div className="mt-5 flex gap-2">
                <button onClick={() => void submitForm()} className="nf-btn nf-btn-primary">
                  保存
                </button>
                <button onClick={() => setForm(null)} className="nf-btn nf-btn-ghost">
                  取消
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 模型角色映射 */}
        <section className="nf-card mb-8 p-5">
          <h2 className="mb-1 text-base font-semibold">模型角色映射</h2>
          <p className="mb-4 text-xs text-slate-500">
            为不同任务指定不同模型；Skill 可通过 recommended_model 自动取用。
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {MODEL_ROLES.map((role) => (
              <label key={role} className="nf-label">
                {MODEL_ROLE_LABELS[role]}
                <select
                  className="nf-select mt-1"
                  value={rolesDraft[role] ?? ''}
                  onChange={(e) => setRolesDraft({ ...rolesDraft, [role]: e.target.value || undefined })}
                >
                  <option value="">（未指定）</option>
                  {settings.presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}（{p.model}）
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            onClick={() => {
              void setRoles(rolesDraft)
              showToast('角色映射已保存')
            }}
            className="nf-btn nf-btn-primary mt-4"
          >
            保存角色映射
          </button>
        </section>

        {/* 性能 */}
        <section className="nf-card mb-8 p-5">
          <h2 className="mb-4 text-base font-semibold">性能</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {field(
              '并发 LLM 请求数',
              <input
                type="number"
                min={1}
                max={8}
                className="nf-input [font-variant-numeric:tabular-nums]"
                value={configDraft.concurrencyLimit}
                onChange={(e) => setConfigDraft({ ...configDraft, concurrencyLimit: Number(e.target.value) || 1 })}
              />,
              '默认 2'
            )}
            {field(
              '流式刷新节流（毫秒）',
              <input
                type="number"
                min={20}
                max={500}
                step={10}
                className="nf-input [font-variant-numeric:tabular-nums]"
                value={configDraft.streamThrottleMs}
                onChange={(e) => setConfigDraft({ ...configDraft, streamThrottleMs: Number(e.target.value) || 80 })}
              />,
              '默认 80（约 50–100ms）'
            )}
            {field(
              '自动保存间隔（毫秒）',
              <input
                type="number"
                min={2000}
                max={10000}
                step={500}
                className="nf-input [font-variant-numeric:tabular-nums]"
                value={configDraft.autoSaveMs}
                onChange={(e) => setConfigDraft({ ...configDraft, autoSaveMs: Number(e.target.value) || 3500 })}
              />,
              '默认 3500（3–5 秒）'
            )}
          </div>
          <button
            onClick={() => {
              void setAppConfig(configDraft)
              showToast('性能配置已保存')
            }}
            className="nf-btn nf-btn-primary mt-4"
          >
            保存性能配置
          </button>
        </section>

        {/* 外观 */}
        <section className="nf-card mb-8 p-5">
          <h2 className="mb-4 text-base font-semibold">外观</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            {field(
              '主题',
              <select
                className="nf-select"
                value={configDraft.theme}
                onChange={(e) => setConfigDraft({ ...configDraft, theme: e.target.value as AppConfig['theme'] })}
              >
                <option value="light">浅色 · 日读</option>
                <option value="dark">深色 · 玄墨夜读</option>
              </select>
            )}
            {field(
              '编辑器字号（px）',
              <input
                type="number"
                min={12}
                max={28}
                className="nf-input [font-variant-numeric:tabular-nums]"
                value={configDraft.fontSize}
                onChange={(e) => setConfigDraft({ ...configDraft, fontSize: Number(e.target.value) || 15 })}
              />
            )}
            {field(
              '行距（倍数）',
              <input
                type="number"
                step={0.1}
                min={1.2}
                max={3}
                className="nf-input [font-variant-numeric:tabular-nums]"
                value={configDraft.lineHeight}
                onChange={(e) => setConfigDraft({ ...configDraft, lineHeight: Number(e.target.value) || 1.9 })}
              />
            )}
            {field(
              '复制格式',
              <select
                className="nf-select"
                value={configDraft.copyFormat}
                onChange={(e) => setConfigDraft({ ...configDraft, copyFormat: e.target.value as CopyFormat })}
              >
                <option value="plain">纯文本</option>
                <option value="markdown">Markdown</option>
                <option value="web">网文格式</option>
              </select>
            )}
          </div>
          {configDraft.copyFormat === 'web' && (
            <div className="mt-4 flex gap-5 text-sm text-slate-600">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={configDraft.webCopyIndent}
                  onChange={(e) => setConfigDraft({ ...configDraft, webCopyIndent: e.target.checked })}
                />
                段首空两格
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={configDraft.webCopyBlankLine}
                  onChange={(e) => setConfigDraft({ ...configDraft, webCopyBlankLine: e.target.checked })}
                />
                段间空行
              </label>
            </div>
          )}
          <button
            onClick={() => {
              void setAppConfig(configDraft)
              showToast('外观设置已保存')
            }}
            className="nf-btn nf-btn-primary mt-4"
          >
            保存外观设置
          </button>
        </section>

        {/* 导出 */}
        <section className="nf-card mb-8 p-5">
          <h2 className="mb-4 text-base font-semibold">导出</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {field(
              '范围',
              <select
                className="nf-select"
                value={exportScope}
                onChange={(e) => setExportScope(e.target.value as ExportScope)}
              >
                <option value="chapter">当前章（{currentPath?.split('/').pop() ?? '未打开'}）</option>
                <option value="volume">整卷（章节号范围）</option>
                <option value="book">全书</option>
              </select>
            )}
            {field(
              '格式',
              <select
                className="nf-select"
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
              >
                <option value="txt">.txt</option>
                <option value="md">.md</option>
                <option value="docx">.docx（docx，MIT）</option>
              </select>
            )}
            {exportScope === 'volume' && (
              <div className="flex items-end gap-2">
                {field(
                  '起',
                  <input
                    className="nf-input [font-variant-numeric:tabular-nums]"
                    value={exportFrom}
                    onChange={(e) => setExportFrom(e.target.value)}
                  />
                )}
                {field(
                  '止',
                  <input
                    className="nf-input [font-variant-numeric:tabular-nums]"
                    value={exportTo}
                    onChange={(e) => setExportTo(e.target.value)}
                  />
                )}
              </div>
            )}
          </div>
          <button
            onClick={async () => {
              if (!project) {
                showToast('请先打开项目')
                return
              }
              try {
                const path = await window.novelflow.export.run({
                  scope: exportScope,
                  format: exportFormat,
                  ...(currentPath ? { chapterRel: currentPath } : {}),
                  fromChapter: parseInt(exportFrom, 10) || 1,
                  toChapter: parseInt(exportTo, 10) || 9999
                })
                if (path) showToast(`已导出到 ${path}`)
              } catch (e) {
                showToast(`导出失败：${e instanceof Error ? e.message : String(e)}`)
              }
            }}
            className="nf-btn nf-btn-primary mt-4"
          >
            导出
          </button>
        </section>

        {/* 诊断 */}
        <section className="nf-card mb-8 p-5">
          <h2 className="mb-1 text-base font-semibold">诊断</h2>
          <p className="mb-4 text-xs text-slate-500">
            一键导出诊断日志（版本 / 运行环境 / 配置 / 主进程日志尾部），导出内容已脱敏，不含 API Key。
          </p>
          <button
            onClick={async () => {
              const path = await window.novelflow.app.exportDiagnostics()
              if (path) showToast(`诊断日志已导出到 ${path}`)
            }}
            className="nf-btn nf-btn-ghost"
          >
            一键导出诊断日志
          </button>
        </section>
      </div>
    </div>
  )
}
