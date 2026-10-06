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

const NAV: { id: Page; label: string }[] = [
  { id: 'editor', label: '编辑器' },
  { id: 'framework', label: '故事框架' },
  { id: 'workflow', label: '工作流' },
  { id: 'skills', label: 'Skill 库' },
  { id: 'settings', label: '设置' }
]

function Welcome() {
  const createDialog = useProjectStore((s) => s.createDialog)
  const openDialog = useProjectStore((s) => s.openDialog)
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-7 overflow-hidden">
      {/* 背景淡墨字，营造书卷气 */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="select-none font-brush text-[24rem] leading-none text-slate-700 opacity-[0.05]">
          文
        </span>
      </div>

      <div className="relative z-10 flex flex-col items-center text-center">
        <div className="flex items-center gap-4">
          <span className="nf-seal h-14 w-14 text-2xl">墨</span>
          <div className="text-left">
            <h1 className="text-4xl font-bold tracking-wide text-slate-900">NovelFlow</h1>
            <p className="mt-1 font-brush text-base tracking-[0.4em] text-slate-500">小说写作工作台</p>
          </div>
        </div>
        <hr className="nf-brush-rule mt-6 w-64" />
        <p className="mt-4 max-w-md text-sm leading-6 text-slate-600">
          项目即文件夹 · 设定、大纲、正文、状态各自成卷
        </p>
      </div>

      <div className="relative z-10 flex gap-3">
        <button onClick={() => void createDialog()} className="nf-btn nf-btn-primary px-7 py-2.5">
          新建项目
        </button>
        <button onClick={() => void openDialog()} className="nf-btn nf-btn-ghost px-7 py-2.5">
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

  const showWorkspace = page === 'editor' && !!project

  return (
    <ErrorBoundary>
      <div className="flex h-full flex-col">
        {/* 顶栏：徽记 + 字标 + 项目名｜导航页签｜项目操作 */}
        <header className="z-10 flex shrink-0 items-center justify-between border-b border-slate-300/70 bg-white/80 px-4 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-3 py-1.5">
            <span className="nf-seal h-7 w-7 text-sm">卷</span>
            <span className="font-brush text-lg font-bold tracking-wide text-slate-900">NovelFlow</span>
            <span className="text-slate-300" aria-hidden>
              ·
            </span>
            <span className="max-w-[220px] truncate text-sm text-slate-500">
              {project ? project.name : '未打开项目'}
            </span>
          </div>

          <nav className="flex items-center" aria-label="主导航">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                data-active={page === n.id}
                className="nf-tab"
                aria-current={page === n.id ? 'page' : undefined}
              >
                {n.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <button onClick={() => void createDialog()} className="nf-btn nf-btn-sm nf-btn-ghost">
              新建
            </button>
            <button onClick={() => void openDialog()} className="nf-btn nf-btn-sm nf-btn-ghost">
              打开
            </button>
          </div>
        </header>

        {/* 主体：页级淡入；打开项目时以「展卷」过场呈现工作区 */}
        <main className="min-h-0 flex-1">
          {showWorkspace ? (
            <div key={project.dirPath} className="nf-unroll grid h-full grid-cols-[220px_minmax(0,1fr)_340px]">
              <aside className="min-h-0 border-r border-slate-200/80 bg-slate-100">
                <ProjectTree />
              </aside>
              <section className="min-h-0 bg-white">
                <EditorPane />
              </section>
              <aside className="flex min-h-0 flex-col border-l border-slate-200/80 bg-slate-50">
                <div className="flex shrink-0 border-b border-slate-200/80 bg-white">
                  <button
                    onClick={() => setSidebar('skill')}
                    data-active={sidebar === 'skill'}
                    className="nf-tab flex-1"
                  >
                    Skill
                  </button>
                  <button
                    onClick={() => setSidebar('demo')}
                    data-active={sidebar === 'demo'}
                    className="nf-tab flex-1"
                  >
                    模型试写
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {sidebar === 'skill' ? <SkillRunPanel /> : <StreamDemo />}
                </div>
              </aside>
            </div>
          ) : page === 'settings' ? (
            <div key="settings" className="nf-page h-full">
              <SettingsPage onBack={() => setPage('editor')} />
            </div>
          ) : page === 'skills' ? (
            <div key="skills" className="nf-page h-full">
              <SkillLibrary onBack={() => setPage('editor')} />
            </div>
          ) : page === 'framework' ? (
            <div key="framework" className="nf-page h-full">
              <FrameworkPage onBack={() => setPage('editor')} />
            </div>
          ) : page === 'workflow' ? (
            <div key="workflow" className="nf-page h-full">
              <WorkflowPage onBack={() => setPage('editor')} />
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
