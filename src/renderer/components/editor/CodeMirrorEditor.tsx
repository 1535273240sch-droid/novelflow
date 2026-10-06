import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'

interface Props {
  value: string
  onChange: (text: string) => void
  /** 选区变化（Skill「对选中文本运行」用）；无选区时回调空串与折叠区间 */
  onSelectionChange?: (text: string, from: number, to: number) => void
}

/**
 * CodeMirror 6 编辑器（选型理由见 DECISIONS.md）：
 * - 按文档增量更新，适合长章节；word wrap；撤销历史；
 * - 外部值（按章加载 / 流式追加）与内部编辑双向同步，值相等时跳过避免回环。
 */
export function CodeMirrorEditor({ value, onChange, onSelectionChange }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSelectionRef = useRef(onSelectionChange)
  onSelectionRef.current = onSelectionChange

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: '',
        extensions: [
          EditorView.lineWrapping,
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          placeholder('从左侧打开或新建一章，开始写作…'),
          markdown(),
          EditorView.theme({
            // 背景交给 CSS（深色主题下由 index.css 覆盖）
            '&': { backgroundColor: 'transparent' }
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString())
            }
            if (update.selectionSet || update.docChanged) {
              const sel = update.state.selection.main
              onSelectionRef.current?.(
                sel.empty ? '' : update.state.sliceDoc(sel.from, sel.to),
                sel.from,
                sel.to
              )
            }
          })
        ]
      })
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // 外部内容变化（按章加载 / 流式追加）同步进编辑器
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value }
      })
    }
  }, [value])

  return <div ref={hostRef} className="nf-editor h-full overflow-hidden" />
}
