import { useEffect } from 'react'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import { useProjectStore } from '../../stores/project'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'
import { formatForCopy } from '../../../main/services/export/copy-format'

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
  const setSelection = useProjectStore((s) => s.setSelection)
  const saveNow = useProjectStore((s) => s.saveNow)
  const showToast = useUiStore((s) => s.showToast)
  const config = useSettingsStore((s) => s.settings?.config)
  const autoSaveMs = config?.autoSaveMs ?? 3500

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
    const formatted = formatForCopy(content, config?.copyFormat ?? 'plain', {
      indent: config?.webCopyIndent ?? true,
      blankLine: config?.webCopyBlankLine ?? true
    })
    await window.novelflow.clipboard.writeText(formatted)
    showToast(`已复制 ${countChars(formatted)} 字`)
  }

  const onManualSave = async () => {
    const saved = await saveNow()
    if (saved) showToast('已保存')
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-white">
      {/* 章题栏 */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="truncate font-brush text-base tracking-wide text-slate-900">
            {currentTitle || '未打开文件'}
          </span>
          {dirty && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-red-500"
              title="有未保存修改"
              aria-label="有未保存修改"
            />
          )}
          {streamStatus === 'streaming' && (
            <span className="nf-chip shrink-0 border-blue-200 bg-blue-50 text-blue-700">
              <span className="nf-ink-pulse h-1.5 w-1.5 rounded-full bg-blue-500" aria-hidden />
              流式生成中
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onManualSave}
            disabled={!currentPath}
            className="nf-btn nf-btn-sm nf-btn-ghost"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button
            onClick={onCopy}
            disabled={!currentPath}
            className="nf-btn nf-btn-sm nf-btn-primary"
            title="复制全文（Ctrl+C 可复制选中文本）"
          >
            复制全文
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <CodeMirrorEditor
          value={content}
          onChange={setContent}
          onSelectionChange={(t, f, to) => setSelection(t, f, to)}
        />
      </div>

      {/* 状态栏 */}
      <div className="flex items-center justify-between border-t border-slate-200/80 px-5 py-1.5 text-xs text-slate-500">
        <span className="min-w-0 truncate">{currentPath ?? '—'}</span>
        <div className="flex shrink-0 items-center gap-4 [font-variant-numeric:tabular-nums]">
          <span>字数 {countChars(content)}</span>
          <span className="text-slate-300" aria-hidden>
            ·
          </span>
          <span>自动保存 {Math.round(autoSaveMs / 1000)} 秒</span>
          <span className="text-slate-300" aria-hidden>
            ·
          </span>
          <span>{lastSavedAt ? `上次保存 ${lastSavedAt}` : '尚未保存'}</span>
        </div>
      </div>
    </div>
  )
}
