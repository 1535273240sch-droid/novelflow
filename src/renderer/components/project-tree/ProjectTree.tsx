import { useProjectStore } from '../../stores/project'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 px-3 text-xs font-semibold tracking-wide text-slate-400">{title}</div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

function Item({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`mx-2 truncate rounded px-2 py-1 text-left text-sm ${
        active ? 'bg-slate-800 text-white' : 'text-slate-700 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mx-2 mb-1 rounded border border-dashed border-slate-300 px-2 py-1 text-left text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700"
    >
      + {label}
    </button>
  )
}

/** 左栏项目树：故事框架（bible）/ 章节计划（outline）/ 正文（chapters）。 */
export function ProjectTree() {
  const project = useProjectStore((s) => s.project)
  const bible = useProjectStore((s) => s.bible)
  const outline = useProjectStore((s) => s.outline)
  const chapters = useProjectStore((s) => s.chapters)
  const currentPath = useProjectStore((s) => s.currentPath)
  const openFile = useProjectStore((s) => s.openFile)
  const newChapter = useProjectStore((s) => s.newChapter)

  if (!project) return null

  return (
    <div className="h-full overflow-y-auto py-3">
      <Section title="故事框架（bible）">
        {bible.map((e) => (
          <Item
            key={e.path}
            label={e.type === 'dir' ? `${e.name}/` : e.name.replace(/\.md$/, '')}
            active={currentPath === e.path}
            onClick={() => {
              if (e.type === 'file') void openFile(e.path)
            }}
          />
        ))}
        {bible.length === 0 && <div className="px-3 text-xs text-slate-400">（空）</div>}
      </Section>

      <Section title="章节计划（outline）">
        <AddButton label="新建章节计划" onClick={() => void newChapter('outline')} />
        {outline.map((e) => (
          <Item
            key={e.path}
            label={e.name.replace(/\.md$/, '')}
            active={currentPath === e.path}
            onClick={() => void openFile(e.path)}
          />
        ))}
      </Section>

      <Section title="正文（chapters）">
        <AddButton label="新建正文章节" onClick={() => void newChapter('chapters')} />
        {chapters.map((e) => (
          <Item
            key={e.path}
            label={e.name.replace(/\.md$/, '')}
            active={currentPath === e.path}
            onClick={() => void openFile(e.path)}
          />
        ))}
      </Section>
    </div>
  )
}
