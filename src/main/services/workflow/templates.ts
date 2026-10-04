import type { Workflow, WorkflowNode } from '../../../shared/types'

/**
 * 三个内置工作流模板（M4 验收要点 4）。
 *
 * 约定：
 * - `skillId` 为空表示「读取节点」——只做输入绑定（读项目文件），不调用模型；
 * - `input.relPath` / `sink.relPath` 中的 `{chapter}` 会在运行时替换为 `第NNN章.md`；
 * - 检查类 Skill（output=issues）的输出不改变文本流，下一步仍拿到原文（见 engine）。
 */

function node(n: Partial<WorkflowNode> & Pick<WorkflowNode, 'id' | 'name'>): WorkflowNode {
  return {
    id: n.id,
    name: n.name,
    skillId: n.skillId ?? '',
    ...(n.presetId ? { presetId: n.presetId } : {}),
    input: n.input ?? { source: 'previous' },
    sink: n.sink ?? { kind: 'next' },
    ...(n.confirm ? { confirm: true } : {})
  }
}

export const BUILTIN_TEMPLATES: Workflow[] = [
  {
    id: 'template-new-book',
    name: '开新书（框架 → 规划）',
    builtin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: [
      node({
        id: 't1-framework',
        name: '生成故事框架',
        skillId: 'generate-story-framework',
        input: { source: 'manual', text: '' },
        sink: { kind: 'display' },
        confirm: true
      }),
      node({
        id: 't1-plan',
        name: '生成章节计划',
        skillId: 'plan-chapter',
        input: { source: 'previous' },
        sink: { kind: 'display' },
        confirm: true
      })
    ]
  },
  {
    id: 'template-write-chapter',
    name: '写一章（7 节点）',
    builtin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: [
      node({
        id: 't2-read-plan',
        name: '读取章节计划',
        skillId: '',
        input: { source: 'file', relPath: 'outline/{chapter}' },
        sink: { kind: 'next' }
      }),
      node({
        id: 't2-write',
        name: '正文写作',
        skillId: 'write-chapter',
        input: { source: 'previous' },
        sink: { kind: 'file', relPath: 'chapters/{chapter}' },
        confirm: true
      }),
      node({
        id: 't2-consistency',
        name: '一致性检查',
        skillId: 'consistency-check',
        input: { source: 'previous' },
        sink: { kind: 'next' }
      }),
      node({
        id: 't2-proofread',
        name: '错别字与病句检查',
        skillId: 'proofread',
        input: { source: 'previous' },
        sink: { kind: 'next' }
      }),
      node({
        id: 't2-polish',
        name: '润色',
        skillId: 'polish',
        input: { source: 'previous' },
        sink: { kind: 'file', relPath: 'chapters/{chapter}' }
      }),
      node({
        id: 't2-deai',
        name: '去AI味',
        skillId: 'deai',
        input: { source: 'previous' },
        sink: { kind: 'file', relPath: 'chapters/{chapter}' }
      }),
      node({
        id: 't2-writeback',
        name: '状态回写',
        skillId: 'state-writeback',
        input: { source: 'previous' },
        sink: { kind: 'display' }
      })
    ]
  },
  {
    id: 'template-polish',
    name: '精修（错别字 → 润色 → 去AI味）',
    builtin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: [
      node({
        id: 't3-proofread',
        name: '错别字与病句检查',
        skillId: 'proofread',
        input: { source: 'file', relPath: 'chapters/{chapter}' },
        sink: { kind: 'next' }
      }),
      node({
        id: 't3-polish',
        name: '润色',
        skillId: 'polish',
        input: { source: 'previous' },
        sink: { kind: 'file', relPath: 'chapters/{chapter}' }
      }),
      node({
        id: 't3-deai',
        name: '去AI味',
        skillId: 'deai',
        input: { source: 'previous' },
        sink: { kind: 'file', relPath: 'chapters/{chapter}' }
      })
    ]
  }
]

export function findTemplate(id: string): Workflow | null {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null
}

/** 章号占位符替换：`outline/{chapter}` → `outline/第007章.md`。 */
export function resolveChapterPlaceholder(rel: string, chapterNo?: number): string {
  const name = chapterNo != null ? `第${String(chapterNo).padStart(3, '0')}章.md` : '第???章.md'
  return rel.replace(/\{chapter\}/g, name)
}
