import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'

interface Props {
  value: string
  onChange: (text: string) => void
}

/**
 * CodeMirror 6 编辑器（选型理由见 DECISIONS.md）：
 * - 按文档增量更新，适合长章节；word wrap；撤销历史；
 * - 外部值（按章加载 / 流式追加）与内部编辑双向同步，值相等时跳过避免回环。
 */
export function CodeMirrorEditor({ value, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

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
            '&': { backgroundColor: '#ffffff' }
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString())
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

  return <div ref={hostRef} className="nf-editor h-full overflow-hidden bg-white" />
}
