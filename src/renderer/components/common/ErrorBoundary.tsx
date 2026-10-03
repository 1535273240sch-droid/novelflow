import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** 全局错误边界：渲染异常时给出中文提示并可重载，避免白屏。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('渲染进程异常：', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
          <div className="text-lg font-semibold text-red-600">界面出现异常</div>
          <pre className="max-w-xl overflow-auto rounded bg-slate-100 p-3 text-xs text-slate-700">
            {this.state.error.message}
          </pre>
          <button
            className="rounded bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700"
            onClick={() => this.setState({ error: null })}
          >
            重新加载界面
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
