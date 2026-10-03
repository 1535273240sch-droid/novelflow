import { useState } from 'react'
import { useProjectStore } from '../../stores/project'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'

/**
 * 右栏「模型试写」面板（M1 演示通道）：
 * - 用户自己输入提示，软件不内置任何 LLM 提示词（提示词在 M2 进入 skills/ 目录）；
 * - 调用走主进程，结果按设置中的节流间隔流式追加进当前打开的正文章节；
 * - 可随时取消。
 */
export function StreamDemo() {
  const presets = useSettingsStore((s) => s.settings?.presets ?? [])
  const roles = useSettingsStore((s) => s.settings?.roles ?? {})
  const project = useProjectStore((s) => s.project)
  const chapters = useProjectStore((s) => s.chapters)
  const currentPath = useProjectStore((s) => s.currentPath)
  const streamStatus = useProjectStore((s) => s.streamStatus)
  const startStream = useProjectStore((s) => s.startStream)
  const showToast = useUiStore((s) => s.showToast)

  const [presetId, setPresetId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [callId, setCallId] = useState<string | null>(null)

  const effectivePreset =
    presetId || roles.writer || presets[0]?.id || ''

  const start = async () => {
    if (!effectivePreset) {
      showToast('请先在设置中添加模型预设')
      return
    }
    if (!prompt.trim()) {
      showToast('请输入提示内容')
      return
    }
    const isChapter = currentPath?.startsWith('chapters/')
    if (!project || !isChapter) {
      showToast('请先在左栏打开或新建一个正文章节（流式结果写入正文）')
      return
    }
    setRunning(true)
    try {
      const id = await window.novelflow.llm.chat({ presetId: effectivePreset, prompt: prompt.trim() })
      setCallId(id)
      startStream(id)
    } catch (e) {
      setRunning(false)
      showToast(`发起失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const cancel = async () => {
    if (callId) {
      await window.novelflow.llm.cancel(callId)
    }
  }

  // 生成结束后（store 中 streamStatus 回到 idle）同步本地状态
  const done = !running || streamStatus === 'idle'

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="text-sm font-semibold text-slate-700">模型试写（流式演示）</div>

      <label className="text-xs text-slate-500">
        模型预设
        <select
          value={effectivePreset}
          onChange={(e) => setPresetId(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          {presets.length === 0 && <option value="">（暂无预设，请到设置页添加）</option>}
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.model}）
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs text-slate-500">
        提示（自行输入，软件不内置提示词）
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="例如：请用两句话描写雨夜的小巷。"
          className="mt-1 w-full resize-none rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>

      <div className="flex gap-2">
        {!running ? (
          <button
            onClick={() => void start()}
            disabled={chapters.length === 0}
            className="flex-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
          >
            开始生成
          </button>
        ) : (
          <button
            onClick={() => void cancel()}
            className="flex-1 rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
          >
            取消
          </button>
        )}
      </div>

      <div className="text-xs text-slate-500">
        状态：
        {running && streamStatus === 'streaming'
          ? '流式生成中（输出追加到当前正文章节）'
          : done && callId
            ? '已结束（可再次发起）'
            : '空闲'}
      </div>

      <div className="mt-2 rounded bg-slate-100 p-2 text-xs leading-relaxed text-slate-500">
        说明：结果会流式追加到左侧编辑器当前打开的章节末尾，可随时点「取消」。流式刷新已按设置节流
        （默认 80ms）。请先用 mock 服务联调：运行
        <code className="mx-1 rounded bg-slate-200 px-1">npm run mock</code>
        后，在设置页添加 base_url 为 <code>http://127.0.0.1:8801/v1</code> 的预设。
      </div>
    </div>
  )
}
