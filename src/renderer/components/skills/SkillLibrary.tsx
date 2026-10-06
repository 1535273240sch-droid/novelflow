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
    requires: [],
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-7">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <h1 className="nf-page-title">Skill 库</h1>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const s = await importDialog()
                  if (s) showToast(`已导入「${s.name}」`)
                }}
                className="nf-btn nf-btn-ghost"
              >
                导入 SKILL.md
              </button>
              <button
                onClick={() => {
                  const s = emptySkill()
                  setForm(s)
                  setInputsText(s.inputs.join(', '))
                }}
                className="nf-btn nf-btn-primary"
              >
                + 新建 Skill
              </button>
              <button onClick={onBack} className="nf-btn nf-btn-sm nf-btn-ghost">
                返回编辑器
              </button>
            </div>
          </div>
          <hr className="nf-brush-rule mt-3" />
        </div>

        <section className="nf-card mb-8 p-5">
          <div className="mb-4 text-sm text-slate-500">
            共 {skills.length} 个 Skill。提示词只存放在 <code className="rounded bg-slate-100 px-1">skills/</code>{' '}
            目录，业务代码不含任何硬编码提示词。编辑保存后版本号递增。
          </div>
          {skills.length === 0 && (
            <div className="nf-callout nf-callout-info">还没有任何 Skill：点「+ 新建 Skill」或「导入 SKILL.md」开始。</div>
          )}
          <div className="flex flex-col gap-2.5">
            {skills.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-3 transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <span className="nf-chip [font-variant-numeric:tabular-nums]">v{s.version}</span>
                    {s.builtin && (
                      <span className="nf-chip border-blue-200 bg-blue-50 text-blue-700">内置</span>
                    )}
                    <span className="nf-chip">{OUTPUT_LABELS[s.output]}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {s.id} · {s.description || '（无描述）'} · 变量 {s.inputs.join('、') || '（无）'}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button onClick={() => void startEdit(s.id)} className="nf-btn nf-btn-sm nf-btn-ghost">
                    编辑
                  </button>
                  <button
                    onClick={async () => {
                      const c = await duplicate(s.id)
                      showToast(`已复制为「${c.name}」`)
                    }}
                    className="nf-btn nf-btn-sm nf-btn-ghost"
                  >
                    复制
                  </button>
                  <button
                    onClick={async () => {
                      const path = await exportDialog(s.id)
                      if (path) showToast(`已导出到 ${path}`)
                    }}
                    className="nf-btn nf-btn-sm nf-btn-ghost"
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
                    className="nf-btn nf-btn-sm nf-btn-danger"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {form && (
          <section className="nf-card border-blue-200 p-5">
            <div className="mb-4 font-medium">
              {form.builtin ? `编辑「${form.name}」（内置，保存为你的版本）` : '编辑 Skill'}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="nf-label">
                id（文件名，保存后不建议改）
                <input className="nf-input mt-1" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
              </label>
              <label className="nf-label">
                名称
                <input className="nf-input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="nf-label sm:col-span-2">
                描述
                <input
                  className="nf-input mt-1"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              <label className="nf-label">
                推荐模型角色
                <select
                  className="nf-select mt-1"
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
              <label className="nf-label">
                输出形态
                <select
                  className="nf-select mt-1"
                  value={form.output}
                  onChange={(e) => setForm({ ...form, output: e.target.value as SkillOutputKind })}
                >
                  <option value="text">文本产物</option>
                  <option value="rewrite">改写（差异视图逐处接受）</option>
                  <option value="issues">问题清单（结构化）</option>
                </select>
              </label>
              <label className="nf-label sm:col-span-2">
                变量（逗号分隔，如 chapter_text, bible.文风规范）
                <input className="nf-input mt-1" value={inputsText} onChange={(e) => setInputsText(e.target.value)} />
              </label>
              <label className="nf-label sm:col-span-2">
                提示词正文（用 {'{{变量}}'} 占位）
                <textarea
                  className="nf-textarea mt-1 h-72 font-mono text-[13px]"
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                />
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => void submit()} className="nf-btn nf-btn-primary">
                保存（版本 +1）
              </button>
              <button onClick={() => setForm(null)} className="nf-btn nf-btn-ghost">
                取消
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
