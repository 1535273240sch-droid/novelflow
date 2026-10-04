import { useEffect, useState } from 'react'
import { useSkillStore } from '../../stores/skill'
import { useUiStore } from '../../stores/ui'
import { MODEL_ROLE_LABELS, MODEL_ROLES, type ModelRole, type Skill, type SkillOutputKind } from '../../../shared/types'

const OUTPUT_LABELS: Record<SkillOutputKind, string> = {
  text: '文本产物',
  rewrite: '改写（可逐处接受）',
  issues: '问题清单'
}

function emptySkill(): Skill {
  const now = new Date().toISOString()
  return {
    id: `my-skill-${Date.now().toString(36)}`,
    name: '新建 Skill',
    description: '',
    version: 1,
    recommendedModel: 'writer',
    output: 'rewrite',
    inputs: ['chapter_text'],
    body: '# 角色\n\n你是……\n\n# 任务\n\n处理下面的文本：\n\n{{chapter_text}}\n',
    builtin: false,
    createdAt: now,
    updatedAt: now
  }
}

/**
 * Skill 库页面（验收要点 1）：内置与自建 Skill 的列表、新建 / 编辑 / 复制 / 导入 / 导出 / 删除。
 * 编辑保存后版本号自动递增（由主进程 registry 保证）。
 */
export function SkillLibrary({ onBack }: { onBack: () => void }) {
  const skills = useSkillStore((s) => s.skills)
  const load = useSkillStore((s) => s.load)
  const save = useSkillStore((s) => s.save)
  const remove = useSkillStore((s) => s.remove)
  const duplicate = useSkillStore((s) => s.duplicate)
  const importDialog = useSkillStore((s) => s.importDialog)
  const exportDialog = useSkillStore((s) => s.exportDialog)
  const getSkill = useSkillStore((s) => s.get)
  const showToast = useUiStore((s) => s.showToast)

  const [form, setForm] = useState<Skill | null>(null)
  const [inputsText, setInputsText] = useState('')

  useEffect(() => {
    void load()
  }, [load])

  const startEdit = async (id: string) => {
    const skill = await getSkill(id)
    if (!skill) {
      showToast('Skill 不存在')
      return
    }
    setForm(skill)
    setInputsText(skill.inputs.join(', '))
  }

  const submit = async () => {
    if (!form) return
    if (!form.name.trim()) {
      showToast('名称不能为空')
      return
    }
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(form.id)) {
      showToast('id 只能包含字母、数字、下划线、点、连字符（可与中文）')
      return
    }
    if (!form.body.trim()) {
      showToast('提示词正文不能为空')
      return
    }
    const inputs = inputsText
      .split(/[,，\s]+/)
      .map((x) => x.trim())
      .filter(Boolean)
    const saved = await save({ ...form, inputs })
    showToast(`已保存「${saved.name}」（v${saved.version}）`)
    setForm(saved)
    setInputsText(saved.inputs.join(', '))
  }

  const inputCls =
    'w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none'

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold">Skill 库</h1>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const s = await importDialog()
                if (s) showToast(`已导入「${s.name}」`)
              }}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            >
              导入 SKILL.md
            </button>
            <button
              onClick={() => {
                const s = emptySkill()
                setForm(s)
                setInputsText(s.inputs.join(', '))
              }}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
            >
              + 新建 Skill
            </button>
            <button onClick={onBack} className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
              返回编辑器
            </button>
          </div>
        </div>

        <section className="mb-8 rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 text-sm text-slate-500">
            共 {skills.length} 个 Skill。提示词只存放在 <code className="rounded bg-slate-100 px-1">skills/</code> 目录，
            业务代码不含任何硬编码提示词。编辑保存后版本号递增。
          </div>
          <div className="flex flex-col gap-2">
            {skills.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">v{s.version}</span>
                    {s.builtin && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">内置</span>}
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{OUTPUT_LABELS[s.output]}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {s.id} · {s.description || '（无描述）'} · 变量 {s.inputs.join('、') || '（无）'}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => void startEdit(s.id)} className="rounded border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100">
                    编辑
                  </button>
                  <button
                    onClick={async () => {
                      const c = await duplicate(s.id)
                      showToast(`已复制为「${c.name}」`)
                    }}
                    className="rounded border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100"
                  >
                    复制
                  </button>
                  <button
                    onClick={async () => {
                      const path = await exportDialog(s.id)
                      if (path) showToast(`已导出到 ${path}`)
                    }}
                    className="rounded border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100"
                  >
                    导出
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`确定删除「${s.name}」？`)) return
                      await remove(s.id)
                      if (form?.id === s.id) setForm(null)
                      showToast('已删除')
                    }}
                    className="rounded border border-red-200 px-2.5 py-1 text-sm text-red-600 hover:bg-red-50"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {form && (
          <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
            <div className="mb-3 font-medium">{form.builtin ? `编辑「${form.name}」（内置，保存为你的版本）` : '编辑 Skill'}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">id（文件名，保存后不建议改）</span>
                <input className={inputCls} value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">名称</span>
                <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-slate-600">描述</span>
                <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">推荐模型角色</span>
                <select
                  className={inputCls}
                  value={form.recommendedModel ?? ''}
                  onChange={(e) => setForm({ ...form, recommendedModel: (e.target.value || null) as ModelRole | null })}
                >
                  <option value="">（不指定）</option>
                  {MODEL_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {MODEL_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">输出形态</span>
                <select
                  className={inputCls}
                  value={form.output}
                  onChange={(e) => setForm({ ...form, output: e.target.value as SkillOutputKind })}
                >
                  <option value="text">文本产物</option>
                  <option value="rewrite">改写（差异视图逐处接受）</option>
                  <option value="issues">问题清单（结构化）</option>
                </select>
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-slate-600">变量（逗号分隔，如 chapter_text, bible.文风规范）</span>
                <input className={inputCls} value={inputsText} onChange={(e) => setInputsText(e.target.value)} />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-slate-600">提示词正文（用 {'{{变量}}'} 占位）</span>
                <textarea
                  className={`${inputCls} h-72 font-mono`}
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                />
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => void submit()} className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-500">
                保存（版本 +1）
              </button>
              <button onClick={() => setForm(null)} className="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-white">
                取消
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
