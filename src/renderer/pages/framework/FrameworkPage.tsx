import { useEffect, useState } from 'react'
import { useProjectStore } from '../../stores/project'
import { useSettingsStore } from '../../stores/settings'
import { useSkillStore } from '../../stores/skill'
import { useUiStore } from '../../stores/ui'
import type { SkillPreview } from '../../../shared/types'

const SKILL_ID = 'generate-story-framework'

/**
 * 故事框架页（验收要点 1）：问答式收集灵感/题材/目标字数，运行「生成故事框架」Skill，
 * 预览后一键落库到 bible/（00-概述、01-世界观、02-人物/<角色>.md、03-主线与卷纲、04-文风规范、05-时间线）。
 */
export function FrameworkPage({ onBack }: { onBack: () => void }) {
  const project = useProjectStore((s) => s.project)
  const load = useSkillStore((s) => s.load)
  const run = useSkillStore((s) => s.run)
  const running = useSkillStore((s) => s.running)
  const streamText = useSkillStore((s) => s.streamText)
  const result = useSkillStore((s) => s.result)
  const cancel = useSkillStore((s) => s.cancel)
  const clear = useSkillStore((s) => s.clear)
  const presets = useSettingsStore((s) => s.settings?.presets ?? [])
  const roles = useSettingsStore((s) => s.settings?.roles ?? {})
  const showToast = useUiStore((s) => s.showToast)

  const [premise, setPremise] = useState('')
  const [genre, setGenre] = useState('')
  const [targetWords, setTargetWords] = useState('1000000')
  const [preview, setPreview] = useState<SkillPreview | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const effectivePreset = roles.planner ?? roles.writer ?? presets[0]?.id ?? ''

  const params = () => ({
    skillId: SKILL_ID,
    presetId: effectivePreset,
    target: 'chapter' as const,
    text: '',
    vars: { premise: premise.trim(), genre: genre.trim(), target_words: targetWords.trim() }
  })

  const generate = async () => {
    if (!project) {
      showToast('请先新建或打开一个项目')
      return
    }
    if (!premise.trim()) {
      showToast('请先填写一句话灵感')
      return
    }
    if (!effectivePreset) {
      showToast('请先在设置中添加模型预设')
      return
    }
    clear()
    setPreview(null)
    await run(params())
  }

  const previewContext = async () => {
    if (!premise.trim()) {
      showToast('请先填写一句话灵感')
      return
    }
    try {
      setPreview(await window.novelflow.skills.preview(params()))
    } catch (e) {
      showToast(`预览失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const apply = async () => {
    if (result?.text == null) return
    const res = await window.novelflow.framework.applyText(result.text)
    await useProjectStore.getState().refresh()
    showToast(`已写入 bible/：${res.written.join('、')}`)
    if (res.characters.length) showToast(`人物：${res.characters.join('、')}`)
    if (res.unknownSections.length) showToast(`未识别的小节：${res.unknownSections.join('、')}`)
    clear()
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-7">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <h1 className="nf-page-title">生成故事框架</h1>
            <button onClick={onBack} className="nf-btn nf-btn-sm nf-btn-ghost">
              返回编辑器
            </button>
          </div>
          <hr className="nf-brush-rule mt-3" />
        </div>

        {!project && <div className="mb-4 nf-callout nf-callout-warn">请先新建或打开一个项目。</div>}

        <section className="nf-card mb-6 p-5">
          <p className="mb-4 text-sm leading-6 text-slate-500">
            回答下面几项，AI 会产出一份分节故事框架，确认后一键写入
            <code className="mx-1 rounded bg-slate-100 px-1">bible/</code>（人物会按角色拆成单独文件）。
          </p>
          <div className="grid grid-cols-1 gap-4">
            <label className="nf-label">
              一句话灵感 *
              <textarea
                className="nf-textarea mt-1 h-20"
                value={premise}
                onChange={(e) => setPremise(e.target.value)}
                placeholder="例如：一个能听见亡者遗言的仵作，被迫为自己验尸。"
              />
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="nf-label">
                题材
                <input
                  className="nf-input mt-1"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="玄幻 / 悬疑 / 都市…"
                />
              </label>
              <label className="nf-label">
                目标字数
                <input
                  className="nf-input mt-1 [font-variant-numeric:tabular-nums]"
                  value={targetWords}
                  onChange={(e) => setTargetWords(e.target.value)}
                  placeholder="1000000"
                />
              </label>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            {!running ? (
              <>
                <button onClick={() => void generate()} disabled={!project} className="nf-btn nf-btn-primary">
                  生成故事框架
                </button>
                <button onClick={() => void previewContext()} className="nf-btn nf-btn-ghost">
                  预览上下文
                </button>
              </>
            ) : (
              <button onClick={() => void cancel()} className="nf-btn nf-btn-danger">
                取消
              </button>
            )}
            {result?.text != null && (
              <button onClick={() => void apply()} className="nf-btn nf-btn-primary">
                写入 bible/
              </button>
            )}
          </div>
        </section>

        {preview && (
          <section className="nf-card mb-6 p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">本次实际发送的上下文</span>
              <button onClick={() => setPreview(null)} className="text-xs text-slate-400 hover:text-slate-600">
                关闭
              </button>
            </div>
            <div className="mb-2 text-xs text-slate-500">变量：{Object.keys(preview.variables).join('、') || '（无）'}</div>
            <pre className="nf-inset max-h-72 overflow-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-slate-700">
              {preview.prompt}
            </pre>
          </section>
        )}

        {(running || (result?.text != null && result.text.length > 0)) && (
          <section className="nf-card p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              {running && <span className="nf-ink-pulse h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />}
              {running ? '生成中…' : '生成结果'}
            </div>
            <pre className="nf-inset max-h-[28rem] overflow-auto whitespace-pre-wrap p-3 text-sm leading-[1.9] text-slate-700">
              {running ? streamText : result?.text}
            </pre>
          </section>
        )}
      </div>
    </div>
  )
}
