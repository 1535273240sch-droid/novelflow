import { useEffect } from 'react'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import { useProjectStore } from '../../stores/project'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'

/** 统计「字数」：去除空白字符后的长度（中文按字计）。 */
export function countChars(text: string): number {
  return text.replace(/\s/g, '').length
}

/**
 * 编辑器面板：按章加载（不整书载入）、3–5 秒自动保存、一键复制（提示「已复制 N 字」）。
 */
export function EditorPane() {
  const content = useProjectStore((s) => s.content)
  const currentPath = useProjectStore((s) => s.currentPath)
  const currentTitle = useProjectStore((s) => s.currentTitle)
  const dirty = useProjectStore((s) => s.dirty)
  const saving = useProjectStore((s) => s.saving)
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt)
  const streamStatus = useProjectStore((s) => s.streamStatus)
  const setContent = useProjectStore((s) => s.setContent)
  const saveNow = useProjectStore((s) => s.saveNow)
  const showToast = useUiStore((s) => s.showToast)
  const autoSaveMs = useSettingsStore((s) => s.settings?.config.autoSaveMs ?? 3500)

  // 自动保存：默认 3.5 秒（可在设置中调整 3–5 秒区间）
  useEffect(() => {
    const timer = setInterval(() => {
      void saveNow()
    }, autoSaveMs)
    return () => clearInterval(timer)
  }, [autoSaveMs, saveNow])

  const onCopy = async () => {
    if (!content) {
      showToast('当前内容为空，未复制')
      return
    }
    await window.novelflow.clipboard.writeText(content)
    showToast(`已复制 ${countChars(content)} 字`)
  }

  const onManualSave = async () => {
    const saved = await saveNow()
    if (saved) showToast('已保存')
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-800">
            {currentTitle || '未打开文件'}
          </span>
          {dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="有未保存修改" />}
          {streamStatus === 'streaming' && (
            <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
              流式生成中…
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onManualSave}
            disabled={!currentPath}
            className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button
            onClick={onCopy}
            disabled={!currentPath}
            className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
            title="复制全文（Ctrl+C 可复制选中文本）"
          >
            复制全文
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <CodeMirrorEditor value={content} onChange={setContent} />
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-1.5 text-xs text-slate-500">
        <span>{currentPath ?? '—'}</span>
        <div className="flex items-center gap-4">
          <span>字数：{countChars(content)}</span>
          <span>自动保存：{Math.round(autoSaveMs / 1000)} 秒</span>
          <span>{lastSavedAt ? `上次保存 ${lastSavedAt}` : '尚未保存'}</span>
        </div>
      </div>
    </div>
  )
}
