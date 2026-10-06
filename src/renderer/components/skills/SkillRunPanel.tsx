import { useEffect, useMemo, useState } from 'react'
import { useProjectStore } from '../../stores/project'
import { useSettingsStore } from '../../stores/settings'
import { useSkillStore } from '../../stores/skill'
import { useUiStore } from '../../stores/ui'
import { DiffView } from '../diff/DiffView'
import { applyIssues } from '../../../main/services/skills/output'
import { applyHunks, diffHunks } from '../../../shared/diff'
import { MODEL_ROLE_LABELS } from '../../../shared/types'
import type { SkillMeta, SkillPreview, SkillRunParams, SkillTarget, SkillWritesTo } from '../../../shared/types'

const WRITES_LABEL: Record<SkillWritesTo, string> = {
  chapter: '正文（逐处接受）',
  outline: '章节计划 outline/',
  bible: '故事框架 bible/',
  state: '状态 state/'
}

/**
 * 右栏「Skill」面板：
 * - 选择 Skill 与模型预设，对「整章」或「选中文本」运行；
 * - 运行前做门禁检查（如写正文要求先有章节计划）与「查看本次实际发送的上下文」；
 * - 产物按 Skill 声明的 writes_to 写回：正文走差异视图、章节计划写 outline/、框架写 bible/、状态写 state/。
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
  const refresh = useProjectStore((s) => s.refresh)
  const showToast = useUiStore((s) => s.showToast)

  const [skillId, setSkillId] = useState('')
  const [presetId, setPresetId] = useState('')
  const [target, setTarget] = useState<SkillTarget>('chapter')
  const [acceptedHunks, setAcceptedHunks] = useState<Set<string>>(new Set())
  const [acceptedIssues, setAcceptedIssues] = useState<Set<number>>(new Set())
  const [gateMsg, setGateMsg] = useState<string | null>(null)
  const [preview, setPreview] = useState<SkillPreview | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const skill: SkillMeta | undefined = skills.find((s) => s.id === skillId) ?? skills[0]
  const isChapter = currentPath?.startsWith('chapters/') ?? false
  const targetText = target === 'selection' ? selection : content

  useEffect(() => {
    if (skill && !skillId) setSkillId(skill.id)
  }, [skill, skillId])

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

  const buildParams = (): SkillRunParams | null => {
    if (!skill) {
      showToast('请先选择一个 Skill')
      return null
    }
    if (!currentPath) {
      showToast('请先打开一个章节')
      return null
    }
    if (target === 'selection' && !selection.trim()) {
      showToast('未选中任何文本；请在编辑器中选中一段，或改选「整章」')
      return null
    }
    if (!effectivePreset) {
      showToast('请先在设置中添加模型预设')
      return null
    }
    return {
      skillId: skill.id,
      presetId: effectivePreset,
      target,
      text: targetText,
      ...(chapterNo != null ? { chapterNo } : {})
    }
  }

  const doRun = async () => {
    const params = buildParams()
    if (!params) return
    setGateMsg(null)
    setPreview(null)
    // 门禁：写正文前必须有本章计划（与单测共用主进程同一实现）
    if (skill?.requires.includes('chapter_plan') && chapterNo != null) {
      const gate = await window.novelflow.chapter.checkGate(chapterNo)
      if (!gate.ok) {
        setGateMsg(gate.guidance ?? '缺少本章计划，已阻止写正文。')
        showToast('被门禁拦下：缺少本章计划')
        return
      }
    }
    clear()
    await run(params)
  }

  const doPreview = async () => {
    const params = buildParams()
    if (!params) return
    try {
      setGateMsg(null)
      setPreview(await window.novelflow.skills.preview(params))
    } catch (e) {
      showToast(`预览失败：${e instanceof Error ? e.message : String(e)}`)
    }
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

  const writesTo: SkillWritesTo = skill?.writesTo ?? 'chapter'

  const applyRewrite = async () => {
    if (result?.text == null) return
    await applyTarget(applyHunks(targetText, result.text, acceptedHunks))
  }

  const applyIssueFixes = async () => {
    if (!result?.issues) return
    await applyTarget(applyIssues(targetText, result.issues, acceptedIssues))
  }

  const applyOutline = async () => {
    if (result?.text == null || chapterNo == null) {
      showToast('需要打开一个正文章节以确定章号')
      return
    }
    await window.novelflow.files.write(`outline/第${String(chapterNo).padStart(3, '0')}章.md`, result.text)
    await refresh()
    showToast(`章节计划已写入 outline/第${String(chapterNo).padStart(3, '0')}章.md`)
    clear()
  }

  const applyBible = async () => {
    if (result?.text == null) return
    const res = await window.novelflow.framework.applyText(result.text)
    await refresh()
    showToast(`故事框架已写入 ${res.written.length} 个文件`)
    if (res.unknownSections.length) showToast(`未识别的小节：${res.unknownSections.join('、')}`)
    clear()
  }

  const applyState = async () => {
    if (result?.raw == null) return
    try {
      const r = await window.novelflow.state.writeback(result.raw, chapterNo)
      showToast(
        `状态已回写：人物 +${r.charactersAdded}/~${r.charactersUpdated}，伏笔 +${r.planted}/回收 ${r.resolved}，事件 +${r.eventsAdded}`
      )
      clear()
    } catch (e) {
      showToast(`状态回写失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const targetOption = (value: SkillTarget, label: string) => (
    <label
      className={`flex flex-1 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
        target === value
          ? 'border-slate-400 bg-slate-100 text-slate-800'
          : 'border-slate-300 text-slate-500 hover:bg-slate-100/60'
      }`}
    >
      <input type="radio" checked={target === value} onChange={() => setTarget(value)} className="shrink-0" />
      {label}
    </label>
  )

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3.5">
      <div className="text-sm font-semibold text-slate-800">Skill 运行</div>

      <label className="nf-label">
        Skill
        <select
          value={skill?.id ?? ''}
          onChange={(e) => {
            setSkillId(e.target.value)
            setGateMsg(null)
            setPreview(null)
            clear()
          }}
          className="nf-select mt-1"
        >
          {skills.length === 0 && <option value="">（暂无 Skill）</option>}
          {skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}（v{s.version}
              {s.builtin ? ' · 内置' : ''}）
            </option>
          ))}
        </select>
      </label>

      <label className="nf-label">
        模型预设
        <select
          value={effectivePreset}
          onChange={(e) => setPresetId(e.target.value)}
          className="nf-select mt-1"
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
            推荐模型角色：{MODEL_ROLE_LABELS[skill.recommendedModel]} · 产物写回：{WRITES_LABEL[writesTo]}
          </span>
        )}
      </label>

      <div className="flex gap-2">
        {targetOption('chapter', '整章')}
        {targetOption('selection', `选中文本${selection ? `（${selection.length} 字）` : '（未选中）'}`)}
      </div>

      {!isChapter && (
        <div className="nf-callout nf-callout-warn text-xs">
          请先打开 chapters/ 下的章节；产物写回位置由 Skill 声明。
        </div>
      )}

      <div className="flex gap-2">
        {!running ? (
          <>
            <button
              onClick={() => void doRun()}
              disabled={!currentPath || skills.length === 0}
              className="nf-btn nf-btn-primary flex-1"
            >
              运行 Skill
            </button>
            <button
              onClick={() => void doPreview()}
              disabled={!currentPath}
              className="nf-btn nf-btn-ghost"
              title="查看本次实际发送的上下文"
            >
              预览上下文
            </button>
          </>
        ) : (
          <button onClick={() => void cancel()} className="nf-btn nf-btn-danger flex-1">
            取消
          </button>
        )}
      </div>

      {gateMsg && (
        <div className="nf-callout nf-callout-warn text-xs">
          <div className="font-medium">写正文门禁未通过</div>
          <div className="mt-1">{gateMsg}</div>
        </div>
      )}

      {preview && (
        <div className="nf-card p-2.5 text-xs">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-medium text-slate-800">本次实际发送的上下文</span>
            <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-600">
              关闭
            </button>
          </div>
          {preview.context && (
            <div className="mb-1.5 text-slate-500">
              预算 {preview.context.budget} tokens · 实际 {preview.context.totalTokens}
              {preview.context.droppedKeys.length > 0 && ` · 已裁剪：${preview.context.droppedKeys.join('、')}`}
              {preview.context.overBudget && ' · ⚠️ 仍超预算（前两项不裁剪）'}
            </div>
          )}
          <div className="mb-1.5 text-slate-500">变量：{Object.keys(preview.variables).join('、') || '（无）'}</div>
          <pre className="nf-inset max-h-64 overflow-auto whitespace-pre-wrap p-2 text-[11px] leading-relaxed text-slate-700">
            {preview.prompt}
          </pre>
        </div>
      )}

      {running && (
        <div className="nf-inset max-h-40 overflow-y-auto whitespace-pre-wrap p-2 text-xs leading-relaxed text-slate-600">
          {streamText || '生成中…'}
        </div>
      )}

      {error && <div className="nf-callout nf-callout-error text-xs">{error}</div>}

      {result && result.kind === 'issues' && (
        <div className="flex flex-col gap-2">
          {result.degraded && (
            <div className="nf-callout nf-callout-warn text-xs">{result.degradedReason}</div>
          )}
          {result.issues && result.issues.length > 0 ? (
            <>
              <div className="text-xs text-slate-500">共 {result.issues.length} 处问题，逐条勾选后应用。</div>
              {result.issues.map((it, i) => (
                <label
                  key={i}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-2 text-xs transition-colors hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
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
                  <span className="min-w-0 leading-relaxed">
                    <span className="text-red-600 line-through">{it.original}</span>
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
                className="nf-btn nf-btn-primary"
              >
                应用选中 {acceptedIssues.size} 处修改
              </button>
            </>
          ) : (
            !result.degraded && <div className="nf-callout nf-callout-success text-xs">未发现问题。</div>
          )}
          {result.degraded && (
            <pre className="nf-inset max-h-60 overflow-auto whitespace-pre-wrap p-2 text-xs text-slate-600">
              {result.raw}
            </pre>
          )}
        </div>
      )}

      {result && result.kind !== 'issues' && result.text != null && (
        <div className="flex flex-col gap-2">
          {writesTo === 'chapter' && (
            <>
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
                  className="nf-btn nf-btn-primary flex-1"
                >
                  应用 {acceptedHunks.size} 处改动
                </button>
                <button
                  onClick={() =>
                    setAcceptedHunks(
                      new Set(diffHunks(targetText, result.text ?? '').filter((h) => h.kind === 'change').map((h) => h.id))
                    )
                  }
                  className="nf-btn nf-btn-ghost"
                >
                  全选
                </button>
              </div>
            </>
          )}
          {writesTo === 'outline' && (
            <button onClick={() => void applyOutline()} className="nf-btn nf-btn-primary">
              写入章节计划 outline/第{chapterNo != null ? String(chapterNo).padStart(3, '0') : '???'}章.md
            </button>
          )}
          {writesTo === 'bible' && (
            <button onClick={() => void applyBible()} className="nf-btn nf-btn-primary">
              写入故事框架 bible/
            </button>
          )}
          {writesTo === 'state' && (
            <button onClick={() => void applyState()} className="nf-btn nf-btn-primary">
              写入状态 state/*.json
            </button>
          )}
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer select-none hover:text-slate-700">查看模型原始输出</summary>
            <pre className="nf-inset mt-1 max-h-60 overflow-auto whitespace-pre-wrap p-2 text-slate-600">
              {result.text}
            </pre>
          </details>
        </div>
      )}

      <div className="nf-callout nf-callout-info text-xs">
        检查类 Skill 只输出问题清单、不直接改全文；改写类可逐处接受/拒绝。应用前自动把原内容快照到项目
        <code className="mx-1 rounded bg-slate-200 px-1">.history/</code>。提示词全部来自
        <code className="mx-1 rounded bg-slate-200 px-1">skills/</code> 目录，可在「Skill 库」中编辑。
      </div>
      {lastParams && (
        <div className="text-xs text-slate-400">上次目标：{lastParams.target === 'selection' ? '选中文本' : '整章'}</div>
      )}
    </div>
  )
}
