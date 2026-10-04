import { useEffect, useState } from 'react'
import { useProjectStore } from './stores/project'
import { useSettingsStore } from './stores/settings'
import { ProjectTree } from './components/project-tree/ProjectTree'
import { EditorPane } from './components/editor/EditorPane'
import { StreamDemo } from './components/chat/StreamDemo'
import { SkillRunPanel } from './components/skills/SkillRunPanel'
import { SkillLibrary } from './components/skills/SkillLibrary'
import { FrameworkPage } from './pages/framework/FrameworkPage'
import { WorkflowPage } from './pages/workflow/WorkflowPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { ToastContainer } from './components/common/Toast'
import { ErrorBoundary } from './components/common/ErrorBoundary'

type Page = 'editor' | 'settings' | 'skills' | 'framework' | 'workflow'

function Welcome() {
  const createDialog = useProjectStore((s) => s.createDialog)
  const openDialog = useProjectStore((s) => s.openDialog)
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-6 overflow-hidden">
      {/* 背景淡墨字，营造书卷气 */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="select-none font-brush text-[26rem] leading-none text-slate-700 opacity-[0.045]">
          文
        </span>
      </div>

      <div className="relative z-10 flex flex-col items-center text-center">
        <div className="flex items-center gap-4">
          <span className="nf-seal h-12 w-12 text-xl">墨</span>
          <div className="text-left">
            <h1 className="text-4xl font-bold tracking-wide text-slate-900">NovelFlow</h1>
            <p className="mt-1 font-brush text-base tracking-[0.35em] text-slate-600">小说写作工作台</p>
          </div>
        </div>
        <hr className="nf-brush-rule mt-5 w-64" />
        <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
          项目即文件夹 · 设定、大纲、正文、状态各自成卷
        </p>
      </div>

      <div className="relative z-10 flex gap-3">
        <button
          onClick={() => void createDialog()}
          className="nf-btn-ink rounded border border-slate-600/30 bg-slate-800 px-7 py-2.5 text-white transition hover:bg-slate-700 active:translate-y-px"
        >
          新建项目
        </button>
        <button
          onClick={() => void openDialog()}
          className="rounded border border-slate-300 bg-white px-7 py-2.5 text-slate-700 transition hover:bg-slate-100 active:translate-y-px"
        >
          打开项目
        </button>
      </div>

      <p className="relative z-10 max-w-md text-center text-xs leading-5 text-slate-500">
        新建项目将生成标准目录结构：novel.json、bible/（故事框架）、outline/（章节计划）、chapters/（正文）、
        state/（人物状态、伏笔、事件）、runs/、.history/
      </p>
    </div>
  )
}

export default function App() {
  const project = useProjectStore((s) => s.project)
  const init = useProjectStore((s) => s.init)
  const initEvents = useProjectStore((s) => s.initEvents)
  const createDialog = useProjectStore((s) => s.createDialog)
  const openDialog = useProjectStore((s) => s.openDialog)
  const loadSettings = useSettingsStore((s) => s.load)
  const config = useSettingsStore((s) => s.settings?.config)
  const [page, setPage] = useState<Page>('editor')
  const [sidebar, setSidebar] = useState<'demo' | 'skill'>('skill')

  // 外观设置：主题 + 编辑器字号/行距（通过 CSS 变量注入，不触碰组件样式）
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = config?.theme ?? 'light'
    root.style.setProperty('--nf-font-size', `${config?.fontSize ?? 15}px`)
    root.style.setProperty('--nf-line-height', String(config?.lineHeight ?? 1.9))
  }, [config?.theme, config?.fontSize, config?.lineHeight])

  useEffect(() => {
    void init()
    void loadSettings()
    initEvents()
  }, [init, loadSettings, initEvents])

  return (
    <ErrorBoundary>
      <div className="flex h-full flex-col">
        {/* 顶栏 */}
        <header className="flex shrink-0 items-center justify-between border-b border-slate-300/70 bg-white px-4 py-2 shadow-[0_1px_0_rgba(255,255,255,0.6)_inset]">
          <div className="flex items-center gap-3">
            <span className="nf-seal h-7 w-7 text-sm">卷</span>
            <span className="font-brush text-lg font-bold tracking-wide text-slate-900">NovelFlow</span>
            <span className="max-w-[240px] truncate text-sm text-slate-500">
              {project ? project.name : '未打开项目'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void createDialog()}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
            >
              新建项目
            </button>
            <button
              onClick={() => void openDialog()}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
            >
              打开项目
            </button>
            <button
              onClick={() => setPage(page === 'framework' ? 'editor' : 'framework')}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
            >
              {page === 'framework' ? '返回编辑器' : '故事框架'}
            </button>
            <button
              onClick={() => setPage(page === 'workflow' ? 'editor' : 'workflow')}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
            >
              {page === 'workflow' ? '返回编辑器' : '工作流'}
            </button>
            <button
              onClick={() => setPage(page === 'skills' ? 'editor' : 'skills')}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
            >
              {page === 'skills' ? '返回编辑器' : 'Skill 库'}
            </button>
            <button
              onClick={() => setPage(page === 'settings' ? 'editor' : 'settings')}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
            >
              {page === 'settings' ? '返回编辑器' : '设置'}
            </button>
          </div>
        </header>

        {/* 主体 */}
        <main className="min-h-0 flex-1">
          {page === 'settings' ? (
            <SettingsPage onBack={() => setPage('editor')} />
          ) : page === 'skills' ? (
            <SkillLibrary onBack={() => setPage('editor')} />
          ) : page === 'framework' ? (
            <FrameworkPage onBack={() => setPage('editor')} />
          ) : page === 'workflow' ? (
            <WorkflowPage onBack={() => setPage('editor')} />
          ) : project ? (
            <div className="grid h-full grid-cols-[220px_minmax(0,1fr)_340px]">
              <aside className="min-h-0 border-r border-slate-200 bg-slate-100">
                <ProjectTree />
              </aside>
              <section className="min-h-0">
                <EditorPane />
              </section>
              <aside className="flex min-h-0 flex-col border-l border-slate-200 bg-slate-50">
                <div className="flex shrink-0 border-b border-slate-200 bg-white text-sm">
                  <button
                    onClick={() => setSidebar('skill')}
                    className={`flex-1 px-3 py-2 ${sidebar === 'skill' ? 'border-b-2 border-blue-600 font-medium text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    Skill
                  </button>
                  <button
                    onClick={() => setSidebar('demo')}
                    className={`flex-1 px-3 py-2 ${sidebar === 'demo' ? 'border-b-2 border-blue-600 font-medium text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    模型试写
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {sidebar === 'skill' ? <SkillRunPanel /> : <StreamDemo />}
                </div>
              </aside>
            </div>
          ) : (
            <Welcome />
          )}
        </main>

        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}
