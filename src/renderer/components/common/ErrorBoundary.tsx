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
        <div className="flex h-full flex-col items-center justify-center gap-5 p-8">
          <span className="nf-seal h-12 w-12 text-xl">误</span>
          <div className="text-lg font-semibold text-slate-900">界面出现异常</div>
          <pre className="nf-inset max-w-xl overflow-auto p-3 text-xs text-slate-600">
            {this.state.error.message}
          </pre>
          <button className="nf-btn nf-btn-primary" onClick={() => this.setState({ error: null })}>
            重新加载界面
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
