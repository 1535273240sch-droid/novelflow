import { useEffect, useState } from 'react'
import { useProjectStore } from './stores/project'
import { useSettingsStore } from './stores/settings'
import { ProjectTree } from './components/project-tree/ProjectTree'
import { EditorPane } from './components/editor/EditorPane'
import { StreamDemo } from './components/chat/StreamDemo'
import { SkillRunPanel } from './components/skills/SkillRunPanel'
import { SkillLibrary } from './components/skills/SkillLibrary'
import { FrameworkPage } from './pages/framework/FrameworkPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { ToastContainer } from './components/common/Toast'
import { ErrorBoundary } from './components/common/ErrorBoundary'

type Page = 'editor' | 'settings' | 'skills' | 'framework'

function Welcome() {
  const createDialog = useProjectStore((s) => s.createDialog)
  const openDialog = useProjectStore((s) => s.openDialog)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-slate-800">NovelFlow</h1>
        <p className="mt-2 text-slate-500">小说写作工作台 · 项目即文件夹，设定/大纲/正文/状态各自成文件</p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => void createDialog()}
          className="rounded bg-blue-600 px-6 py-2.5 text-white hover:bg-blue-500"
        >
          新建项目
        </button>
        <button
          onClick={() => void openDialog()}
          className="rounded border border-slate-300 bg-white px-6 py-2.5 text-slate-700 hover:bg-slate-100"
        >
          打开项目
        </button>
      </div>
      <p className="max-w-md text-center text-xs text-slate-400">
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
  const [page, setPage] = useState<Page>('editor')
  const [sidebar, setSidebar] = useState<'demo' | 'skill'>('skill')

  useEffect(() => {
    void init()
    void loadSettings()
    initEvents()
  }, [init, loadSettings, initEvents])

  return (
    <ErrorBoundary>
      <div className="flex h-full flex-col">
        {/* 顶栏 */}
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="font-bold text-slate-800">NovelFlow</span>
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
