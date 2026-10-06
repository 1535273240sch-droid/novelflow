import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkflowStore, statusLabel } from '../../stores/workflow'
import { useProjectStore } from '../../stores/project'
import { useSettingsStore } from '../../stores/settings'
import { useSkillStore } from '../../stores/skill'
import { useUiStore } from '../../stores/ui'
import type { Workflow, WorkflowNode, WorkflowRun } from '../../../shared/types'

function clone(w: Workflow): Workflow {
  return JSON.parse(JSON.stringify(w)) as Workflow
}

/** 新节点工厂（渲染层本地实现，避免把带 node 内建模块的主进程代码打进渲染包）。 */
function makeNode(index: number): WorkflowNode {
  return {
    id: `n${Date.now().toString(36)}${index}`,
    name: `节点 ${index + 1}`,
    skillId: '',
    input: { source: 'previous' },
    sink: { kind: 'next' }
  }
}

const NODE_STATUS_LABEL: Record<string, string> = {
  pending: '待运行',
  running: '运行中',
  done: '已完成',
  failed: '失败',
  awaiting_confirm: '等待确认'
}

const NODE_STATUS_CLS: Record<string, string> = {
  done: 'border-green-200 bg-green-50 text-green-700',
  failed: 'border-red-200 bg-red-50 text-red-600',
  awaiting_confirm: 'border-amber-200 bg-amber-50 text-amber-800',
  running: 'border-blue-200 bg-blue-50 text-blue-700',
  pending: 'bg-slate-100 text-slate-500'
}

/**
 * 工作流页（M4）：
 * - 工作流 = 有序节点卡片列表，可拖拽排序；节点四要素（Skill / 模型 / 输入绑定 / 输出去向）可编辑；
 * - 运行控制：启动、人工确认（可改中间结果）、失败重试、中止；
 * - 重启后提示「继续上次未完成的运行」。
 */
export function WorkflowPage({ onBack }: { onBack: () => void }) {
  const project = useProjectStore((s) => s.project)
  const workflows = useWorkflowStore((s) => s.workflows)
  const runs = useWorkflowStore((s) => s.runs)
  const run = useWorkflowStore((s) => s.run)
  const load = useWorkflowStore((s) => s.load)
  const save = useWorkflowStore((s) => s.save)
  const remove = useWorkflowStore((s) => s.remove)
  const createFromTemplate = useWorkflowStore((s) => s.createFromTemplate)
  const start = useWorkflowStore((s) => s.start)
  const resume = useWorkflowStore((s) => s.resume)
  const confirm = useWorkflowStore((s) => s.confirm)
  const retry = useWorkflowStore((s) => s.retry)
  const abort = useWorkflowStore((s) => s.abort)
  const skills = useSkillStore((s) => s.skills)
  const skillsLoad = useSkillStore((s) => s.load)
  const presets = useSettingsStore((s) => s.settings?.presets ?? [])
  const showToast = useUiStore((s) => s.showToast)

  const [draft, setDraft] = useState<Workflow | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [chapterNo, setChapterNo] = useState('1')
  const [confirmEdit, setConfirmEdit] = useState('')
  const [unfinished, setUnfinished] = useState<WorkflowRun | null>(null)

  useEffect(() => {
    void load()
    void skillsLoad()
    void window.novelflow.runs.unfinished().then(setUnfinished).catch(() => setUnfinished(null))
  }, [load, skillsLoad])

  const projectChapterNo = () => {
    const n = parseInt(chapterNo, 10)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }

  const currentChapter = useProjectStore((s) => s.currentPath)
  useEffect(() => {
    const m = currentChapter?.match(/第(\d+)章\.md$/)
    if (m) setChapterNo(String(parseInt(m[1], 10)))
  }, [currentChapter])

  const runNodeMap = useMemo(() => {
    const map = new Map<string, WorkflowRun['nodes'][number]>()
    for (const n of run?.nodes ?? []) map.set(n.nodeId, n)
    return map
  }, [run])

  const dragFrom = useRef<number | null>(null)

  const update = (patch: Partial<WorkflowNode>, nodeId: string) => {
    if (!draft) return
    setDraft({
      ...draft,
      nodes: draft.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n))
    })
  }

  const move = (from: number, to: number) => {
    if (!draft || to < 0 || to >= draft.nodes.length || from === to) return
    const next = [...draft.nodes]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setDraft({ ...draft, nodes: next })
  }

  const doSave = async () => {
    if (!draft) return
    const saved = await save(draft)
    setDraft(clone(saved))
    showToast('工作流已保存')
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-7">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <h1 className="nf-page-title">工作流</h1>
            <button onClick={onBack} className="nf-btn nf-btn-sm nf-btn-ghost">
              返回编辑器
            </button>
          </div>
          <hr className="nf-brush-rule mt-3" />
        </div>

        {!project && <div className="mb-4 nf-callout nf-callout-warn">请先新建或打开一个项目。</div>}

        {unfinished && (!run || run.id !== unfinished.id) && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 nf-callout nf-callout-warn">
            <span>
              检测到上次未完成的运行：{unfinished.workflowName}（{statusLabel(unfinished.status)}）
            </span>
            <button
              onClick={async () => {
                await resume(unfinished.id)
                setUnfinished(null)
              }}
              className="nf-btn nf-btn-sm nf-btn-primary"
            >
              继续上次未完成的运行
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* 工作流列表 */}
          <aside className="nf-card h-fit p-3.5">
            <div className="mb-2 text-sm font-semibold text-slate-800">工作流库</div>
            <div className="flex flex-col gap-1">
              {workflows.map((w) => (
                <button
                  key={w.id}
                  onClick={() => {
                    setDraft(clone(w))
                    setExpanded(null)
                  }}
                  className={`truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    draft?.id === w.id ? 'bg-slate-800 text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {w.name}
                  {w.builtin && <span className="ml-1 text-xs opacity-70">模板</span>}
                </button>
              ))}
            </div>
            <div className="mt-3 border-t border-slate-200/80 pt-3">
              <div className="nf-label mb-1.5">从模板新建</div>
              {workflows
                .filter((w) => w.builtin)
                .map((t) => (
                  <button
                    key={t.id}
                    onClick={async () => {
                      const w = await createFromTemplate(t.id)
                      setDraft(clone(w))
                      showToast(`已从模板创建「${w.name}」`)
                    }}
                    className="mb-1 block w-full rounded-md border border-dashed border-slate-300 px-2 py-1 text-left text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-800"
                  >
                    + {t.name}
                  </button>
                ))}
            </div>
            {runs.length > 0 && (
              <div className="mt-3 border-t border-slate-200/80 pt-3">
                <div className="nf-label mb-1.5">最近运行</div>
                {runs.slice(0, 5).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => void window.novelflow.runs.get(r.id).then((x) => x && useWorkflowStore.setState({ run: x }))}
                    className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-slate-600 transition-colors hover:bg-slate-100"
                  >
                    {r.workflowName} · {statusLabel(r.status)}
                  </button>
                ))}
              </div>
            )}
          </aside>

          {/* 节点编辑 */}
          <section className="flex flex-col gap-4">
            {draft ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="nf-input max-w-md flex-1"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    disabled={draft.builtin}
                  />
                  <button
                    onClick={() => setDraft({ ...draft, nodes: [...draft.nodes, makeNode(draft.nodes.length)] })}
                    className="nf-btn nf-btn-ghost"
                  >
                    + 添加节点
                  </button>
                  <button
                    onClick={() => void doSave()}
                    disabled={draft.builtin}
                    title={draft.builtin ? '内置模板不可直接修改，请先从模板新建' : ''}
                    className="nf-btn nf-btn-primary"
                  >
                    保存
                  </button>
                  {!draft.builtin && (
                    <button
                      onClick={async () => {
                        await remove(draft.id)
                        setDraft(null)
                        showToast('已删除')
                      }}
                      className="nf-btn nf-btn-danger"
                    >
                      删除
                    </button>
                  )}
                </div>

                <div className="text-xs text-slate-500">
                  节点顺序即执行顺序，可拖拽排序。检查类 Skill（错别字/一致性）不改变文本流。
                </div>

                <div className="flex flex-col gap-2.5">
                  {draft.nodes.map((node, i) => {
                    const st = runNodeMap.get(node.id)
                    return (
                      <div
                        key={node.id}
                        draggable
                        onDragStart={() => (dragFrom.current = i)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragFrom.current != null) move(dragFrom.current, i)
                          dragFrom.current = null
                        }}
                        className="nf-card p-3.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="cursor-grab select-none text-slate-400" title="拖拽排序" aria-hidden>
                            ≡
                          </span>
                          <span className="text-xs text-slate-400 [font-variant-numeric:tabular-nums]">#{i + 1}</span>
                          <input
                            className="nf-input flex-1"
                            value={node.name}
                            onChange={(e) => update({ name: e.target.value }, node.id)}
                          />
                          {st && (
                            <span className={`nf-chip shrink-0 ${NODE_STATUS_CLS[st.status] ?? ''}`}>
                              {st.status === 'running' && (
                                <span className="nf-ink-pulse h-1.5 w-1.5 rounded-full bg-blue-500" aria-hidden />
                              )}
                              {NODE_STATUS_LABEL[st.status]}
                            </span>
                          )}
                          <button onClick={() => move(i, i - 1)} className="nf-btn nf-btn-sm nf-btn-ghost px-2" title="上移">
                            ↑
                          </button>
                          <button onClick={() => move(i, i + 1)} className="nf-btn nf-btn-sm nf-btn-ghost px-2" title="下移">
                            ↓
                          </button>
                          <button
                            onClick={() => setExpanded(expanded === node.id ? null : node.id)}
                            className="nf-btn nf-btn-sm nf-btn-ghost"
                          >
                            {expanded === node.id ? '收起' : '编辑'}
                          </button>
                          <button
                            onClick={() => setDraft({ ...draft, nodes: draft.nodes.filter((n) => n.id !== node.id) })}
                            className="nf-btn nf-btn-sm nf-btn-danger px-2"
                            title="删除节点"
                          >
                            删
                          </button>
                        </div>

                        {expanded === node.id && (
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="nf-label">
                              Skill（留空=读取节点，不调用模型）
                              <select
                                className="nf-select mt-1"
                                value={node.skillId}
                                onChange={(e) => update({ skillId: e.target.value }, node.id)}
                              >
                                <option value="">（读取节点）</option>
                                {skills.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="nf-label">
                              模型预设
                              <select
                                className="nf-select mt-1"
                                value={node.presetId ?? ''}
                                onChange={(e) => update({ presetId: e.target.value || undefined }, node.id)}
                              >
                                <option value="">（按 Skill 推荐角色）</option>
                                {presets.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="nf-label">
                              输入来源
                              <select
                                className="nf-select mt-1"
                                value={node.input.source}
                                onChange={(e) =>
                                  update({ input: { ...node.input, source: e.target.value as WorkflowNode['input']['source'] } }, node.id)
                                }
                              >
                                <option value="previous">上节点输出</option>
                                <option value="file">项目文件</option>
                                <option value="manual">手填文本</option>
                              </select>
                            </label>
                            <label className="nf-label">
                              输出去向
                              <select
                                className="nf-select mt-1"
                                value={node.sink.kind}
                                onChange={(e) =>
                                  update({ sink: { ...node.sink, kind: e.target.value as WorkflowNode['sink']['kind'] } }, node.id)
                                }
                              >
                                <option value="next">传给下一节点</option>
                                <option value="file">写入文件</option>
                                <option value="display">仅展示</option>
                              </select>
                            </label>
                            {node.input.source === 'file' && (
                              <label className="nf-label">
                                输入文件（可用 {'{chapter}'}）
                                <input
                                  className="nf-input mt-1"
                                  value={node.input.relPath ?? ''}
                                  onChange={(e) => update({ input: { ...node.input, relPath: e.target.value } }, node.id)}
                                  placeholder="outline/{chapter}"
                                />
                              </label>
                            )}
                            {node.input.source === 'manual' && (
                              <label className="nf-label sm:col-span-2">
                                手填文本
                                <textarea
                                  className="nf-textarea mt-1 h-20"
                                  value={node.input.text ?? ''}
                                  onChange={(e) => update({ input: { ...node.input, text: e.target.value } }, node.id)}
                                />
                              </label>
                            )}
                            {node.sink.kind === 'file' && (
                              <label className="nf-label">
                                输出文件（可用 {'{chapter}'}）
                                <input
                                  className="nf-input mt-1"
                                  value={node.sink.relPath ?? ''}
                                  onChange={(e) => update({ sink: { ...node.sink, relPath: e.target.value } }, node.id)}
                                  placeholder="chapters/{chapter}"
                                />
                              </label>
                            )}
                            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                              <input
                                type="checkbox"
                                checked={!!node.confirm}
                                onChange={(e) => update({ confirm: e.target.checked }, node.id)}
                              />
                              人工确认点（执行到此暂停，可修改中间结果）
                            </label>
                          </div>
                        )}

                        {st && (st.output != null || st.error) && (
                          <details className="mt-2.5 text-xs text-slate-500">
                            <summary className="cursor-pointer select-none hover:text-slate-700">
                              {st.error ? `错误：${st.error}` : `输出（${(st.output ?? '').length} 字）`}
                            </summary>
                            <pre className="nf-inset mt-1 max-h-40 overflow-auto whitespace-pre-wrap p-2">
                              {st.error ?? st.output}
                            </pre>
                          </details>
                        )}

                        {st?.status === 'awaiting_confirm' && run && (
                          <div className="nf-callout nf-callout-warn mt-2.5">
                            <div className="mb-1.5 text-xs">人工确认：可修改下方内容后继续</div>
                            <textarea
                              className="nf-textarea h-32 font-mono text-[13px]"
                              defaultValue={st.output ?? ''}
                              onChange={(e) => setConfirmEdit(e.target.value)}
                            />
                            <button
                              onClick={() => void confirm(run.id, node.id, confirmEdit || undefined).then(() => setConfirmEdit(''))}
                              className="nf-btn nf-btn-primary mt-2"
                            >
                              确认并继续
                            </button>
                          </div>
                        )}

                        {st?.status === 'failed' && run && (
                          <button onClick={() => void retry(run.id, node.id)} className="nf-btn nf-btn-danger mt-2.5">
                            从此节点重试
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* 运行控制 */}
                <div className="nf-card flex flex-wrap items-center gap-2.5 p-3.5">
                  <label className="nf-label !mb-0 flex items-center gap-2 text-sm text-slate-600">
                    章号
                    <input
                      className="nf-input w-20 [font-variant-numeric:tabular-nums]"
                      value={chapterNo}
                      onChange={(e) => setChapterNo(e.target.value)}
                    />
                  </label>
                  <button
                    onClick={() => void start(draft.id, projectChapterNo())}
                    disabled={!project || draft.builtin}
                    title={draft.builtin ? '请先从模板新建可编辑副本' : ''}
                    className="nf-btn nf-btn-primary"
                  >
                    运行工作流
                  </button>
                  {run && (
                    <>
                      <span className="text-sm text-slate-600">状态：{statusLabel(run.status)}</span>
                      {(run.status === 'paused' || run.status === 'failed' || run.status === 'running') && (
                        <button onClick={() => void resume(run.id)} className="nf-btn nf-btn-ghost">
                          继续
                        </button>
                      )}
                      {run.status !== 'completed' && run.status !== 'aborted' && (
                        <button onClick={() => void abort(run.id)} className="nf-btn nf-btn-danger">
                          中止
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-[10px] border border-dashed border-slate-300 p-10 text-center text-sm leading-6 text-slate-500">
                从左侧选择工作流，或从一个模板新建。
                <br />
                <span className="text-xs text-slate-400">「写一章」模板覆盖 计划 → 起稿 → 校对 → 精修 全流程。</span>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
