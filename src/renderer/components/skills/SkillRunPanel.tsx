import { useEffect, useMemo, useState } from 'react'
import { useProjectStore } from '../../stores/project'
import { useSettingsStore } from '../../stores/settings'
import { useSkillStore } from '../../stores/skill'
import { useUiStore } from '../../stores/ui'
import { DiffView } from '../diff/DiffView'
import { applyIssues } from '../../../main/services/skills/output'
import { applyHunks, diffHunks } from '../../../shared/diff'
import { MODEL_ROLE_LABELS } from '../../../shared/types'
import type { SkillMeta, SkillTarget } from '../../../shared/types'

/**
 * 右栏「Skill」面板：
 * - 选择 Skill 与模型预设，对「整章」或「选中文本」运行；
 * - 改写类（润色/去AI味）走差异视图逐处接受；检查类走结构化清单逐条接受；
 * - 应用前自动快照到 .history/（主进程 writeWithSnapshot）。
 */
export function SkillRunPanel() {
  const skills = useSkillStore((s) => s.skills)
  const load = useSkillStore((s) => s.load)
  const run = useSkillStore((s) => s.run)
  const cancel = useSkillStore((s) => s.cancel)
  const running = useSkillStore((s) => s.running)
  const streamText = useSkillStore((s) => s.streamText)
  const result = useSkillStore((s) => s.result)
  const lastParams = useSkillStore((s) => s.lastParams)
  const error = useSkillStore((s) => s.error)
  const clear = useSkillStore((s) => s.clear)

  const presets = useSettingsStore((s) => s.settings?.presets ?? [])
  const roles = useSettingsStore((s) => s.settings?.roles ?? {})

  const content = useProjectStore((s) => s.content)
  const currentPath = useProjectStore((s) => s.currentPath)
  const selection = useProjectStore((s) => s.selection)
  const selectionFrom = useProjectStore((s) => s.selectionFrom)
  const selectionTo = useProjectStore((s) => s.selectionTo)
  const applyContent = useProjectStore((s) => s.applyContent)
  const showToast = useUiStore((s) => s.showToast)

  const [skillId, setSkillId] = useState('')
  const [presetId, setPresetId] = useState('')
  const [target, setTarget] = useState<SkillTarget>('chapter')
  const [acceptedHunks, setAcceptedHunks] = useState<Set<string>>(new Set())
  const [acceptedIssues, setAcceptedIssues] = useState<Set<number>>(new Set())

  useEffect(() => {
    void load()
  }, [load])

  const skill: SkillMeta | undefined = skills.find((s) => s.id === skillId) ?? skills[0]
  const isChapter = currentPath?.startsWith('chapters/') ?? false
  const targetText = target === 'selection' ? selection : content

  useEffect(() => {
    if (skill && !skillId) setSkillId(skill.id)
  }, [skill, skillId])

  // 新结果到达时：改写默认全部接受；清单默认全部接受
  useEffect(() => {
    if (!result) return
    if (result.kind === 'issues') {
      setAcceptedIssues(new Set((result.issues ?? []).map((_, i) => i)))
    } else {
      const hunks = diffHunks(targetText, result.text ?? '')
      setAcceptedHunks(new Set(hunks.filter((h) => h.kind === 'change').map((h) => h.id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const effectivePreset = useMemo(() => {
    if (presetId) return presetId
    const role = skill?.recommendedModel
    if (role && roles[role]) return roles[role]
    return roles.writer ?? roles.planner ?? roles.checker ?? roles.polisher ?? presets[0]?.id ?? ''
  }, [presetId, skill, roles, presets])

  const chapterNo = useMemo(() => {
    const m = currentPath?.match(/第(\d+)章\.md$/)
    return m ? parseInt(m[1], 10) : undefined
  }, [currentPath])

  const doRun = async () => {
    if (!skill) {
      showToast('请先选择一个 Skill')
      return
    }
    if (!currentPath) {
      showToast('请先打开一个章节')
      return
    }
    if (target === 'selection' && !selection.trim()) {
      showToast('未选中任何文本；请在编辑器中选中一段，或改选「整章」')
      return
    }
    if (!effectivePreset) {
      showToast('请先在设置中添加模型预设')
      return
    }
    clear()
    await run({
      skillId: skill.id,
      presetId: effectivePreset,
      target,
      text: targetText,
      ...(chapterNo != null ? { chapterNo } : {})
    })
  }

  /** 把「目标文本的新版本」写回完整文件（整章直接替换；选区按偏移量拼接）。 */
  const applyTarget = async (newTargetText: string) => {
    let newFull = newTargetText
    if (target === 'selection') {
      const unchanged = content.slice(selectionFrom, selectionTo) === selection
      newFull = unchanged
        ? content.slice(0, selectionFrom) + newTargetText + content.slice(selectionTo)
        : content.replace(selection, newTargetText)
    }
    await applyContent(newFull)
    showToast('已应用修改，原内容已快照到 .history/')
    clear()
  }

  const applyRewrite = async () => {
    if (!result?.text) return
    const newText = applyHunks(targetText, result.text, acceptedHunks)
    await applyTarget(newText)
  }

  const applyIssueFixes = async () => {
    if (!result?.issues) return
    const newText = applyIssues(targetText, result.issues, acceptedIssues)
    await applyTarget(newText)
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="text-sm font-semibold text-slate-700">Skill 运行</div>

      <label className="text-xs text-slate-500">
        Skill
        <select
          value={skill?.id ?? ''}
          onChange={(e) => {
            setSkillId(e.target.value)
            clear()
          }}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          {skills.length === 0 && <option value="">（暂无 Skill）</option>}
          {skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}（v{s.version}{s.builtin ? ' · 内置' : ''}）
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs text-slate-500">
        模型预设
        <select
          value={effectivePreset}
          onChange={(e) => setPresetId(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          {presets.length === 0 && <option value="">（请到设置页添加）</option>}
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.model}）
            </option>
          ))}
        </select>
        {skill?.recommendedModel && (
          <span className="mt-1 block text-xs text-slate-400">
            推荐模型角色：{MODEL_ROLE_LABELS[skill.recommendedModel]}
          </span>
        )}
      </label>

      <div className="flex gap-2 text-xs">
        <label className="flex flex-1 items-center gap-1 rounded border border-slate-300 px-2 py-1">
          <input type="radio" checked={target === 'chapter'} onChange={() => setTarget('chapter')} />
          整章
        </label>
        <label className="flex flex-1 items-center gap-1 rounded border border-slate-300 px-2 py-1">
          <input type="radio" checked={target === 'selection'} onChange={() => setTarget('selection')} />
          选中文本{selection ? `（${selection.length} 字）` : '（未选中）'}
        </label>
      </div>

      {!isChapter && <div className="text-xs text-amber-600">提示：Skill 结果写回正文章节，请先打开 chapters/ 下的章节。</div>}

      <div className="flex gap-2">
        {!running ? (
          <button
            onClick={() => void doRun()}
            disabled={!currentPath || skills.length === 0}
            className="flex-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
          >
            运行 Skill
          </button>
        ) : (
          <button onClick={() => void cancel()} className="flex-1 rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500">
            取消
          </button>
        )}
      </div>

      {running && (
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-slate-100 p-2 text-xs text-slate-500">
          {streamText || '生成中…'}
        </div>
      )}

      {error && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}

      {result && result.kind === 'issues' && (
        <div className="flex flex-col gap-2">
          {result.degraded && (
            <div className="rounded bg-amber-50 p-2 text-xs text-amber-700">{result.degradedReason}</div>
          )}
          {result.issues && result.issues.length > 0 ? (
            <>
              <div className="text-xs text-slate-500">共 {result.issues.length} 处问题，逐条勾选后应用。</div>
              {result.issues.map((it, i) => (
                <label key={i} className="flex items-start gap-1 rounded border border-slate-200 p-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={acceptedIssues.has(i)}
                    onChange={() =>
                      setAcceptedIssues((s) => {
                        const n = new Set(s)
                        if (n.has(i)) n.delete(i)
                        else n.add(i)
                        return n
                      })
                    }
                  />
                  <span className="min-w-0">
                    <span className="text-red-700 line-through">{it.original}</span>
                    <span className="mx-1 text-slate-400">→</span>
                    <span className="text-green-700">{it.suggestion}</span>
                    {it.reason && <span className="ml-1 text-slate-400">（{it.reason}）</span>}
                    {it.line != null && <span className="ml-1 text-slate-400">第 {it.line} 行</span>}
                  </span>
                </label>
              ))}
              <button
                onClick={() => void applyIssueFixes()}
                disabled={acceptedIssues.size === 0}
                className="rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-500 disabled:opacity-40"
              >
                应用选中 {acceptedIssues.size} 处修改
              </button>
            </>
          ) : (
            !result.degraded && <div className="text-xs text-slate-500">未发现问题。</div>
          )}
          {result.degraded && (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 text-xs text-slate-600">
              {result.raw}
            </pre>
          )}
        </div>
      )}

      {result && result.kind !== 'issues' && result.text != null && (
        <div className="flex flex-col gap-2">
          <DiffView
            before={targetText}
            after={result.text}
            accepted={acceptedHunks}
            onToggle={(id) =>
              setAcceptedHunks((s) => {
                const n = new Set(s)
                if (n.has(id)) n.delete(id)
                else n.add(id)
                return n
              })
            }
          />
          <div className="flex gap-2">
            <button
              onClick={() => void applyRewrite()}
              disabled={acceptedHunks.size === 0}
              className="flex-1 rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-500 disabled:opacity-40"
            >
              应用 {acceptedHunks.size} 处改动
            </button>
            <button
              onClick={() => setAcceptedHunks(new Set(diffHunks(targetText, result.text ?? '').filter((h) => h.kind === 'change').map((h) => h.id)))}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            >
              全选
            </button>
          </div>
        </div>
      )}

      <div className="mt-1 rounded bg-slate-100 p-2 text-xs leading-relaxed text-slate-500">
        说明：检查类 Skill 只输出问题清单、不直接改全文；改写类 Skill 的结果可逐处接受/拒绝。
        应用前会自动把原内容快照到项目 <code className="mx-1 rounded bg-slate-200 px-1">.history/</code>。
        提示词全部来自 <code className="mx-1 rounded bg-slate-200 px-1">skills/</code> 目录，可在「Skill 库」中编辑。
      </div>
      {lastParams && <div className="text-xs text-slate-400">上次目标：{lastParams.target === 'selection' ? '选中文本' : '整章'}</div>}
    </div>
  )
}
