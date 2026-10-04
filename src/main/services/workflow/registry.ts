import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { BUILTIN_TEMPLATES, findTemplate } from './templates'
import type { Workflow, WorkflowNode } from '../../../shared/types'

/**
 * 工作流库：用户自建工作流存 userData/workflows/<id>.json；三个内置模板随应用提供。
 * 不 import electron，便于单测。
 */

export class WorkflowError extends Error {}

export class WorkflowRegistry {
  constructor(
    private readonly userDir: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  private dir(): string {
    return path.join(this.userDir, 'workflows')
  }

  private fileFor(id: string): string {
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(id)) throw new WorkflowError(`非法工作流 id：${id}`)
    return path.join(this.dir(), `${id}.json`)
  }

  async templates(): Promise<Workflow[]> {
    return BUILTIN_TEMPLATES.map((t) => structuredClone(t))
  }

  async list(): Promise<Workflow[]> {
    let names: string[] = []
    try {
      names = await fs.readdir(this.dir())
    } catch {
      names = []
    }
    const user: Workflow[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const w = JSON.parse(await fs.readFile(path.join(this.dir(), name), 'utf8')) as Workflow
        if (w && Array.isArray(w.nodes)) user.push({ ...w, builtin: false })
      } catch {
        /* 损坏文件跳过 */
      }
    }
    user.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    return [...(await this.templates()), ...user]
  }

  async get(id: string): Promise<Workflow | null> {
    const tpl = findTemplate(id)
    if (tpl) return structuredClone(tpl)
    try {
      const w = JSON.parse(await fs.readFile(path.join(this.dir(), `${id}.json`), 'utf8')) as Workflow
      return { ...w, builtin: false }
    } catch {
      return null
    }
  }

  async save(workflow: Workflow): Promise<Workflow> {
    if (findTemplate(workflow.id)) throw new WorkflowError('内置模板不可直接覆盖，请先复制为自建工作流')
    if (workflow.nodes.length === 0) throw new WorkflowError('工作流至少要有一个节点')
    const seen = new Set<string>()
    for (const n of workflow.nodes) {
      if (seen.has(n.id)) throw new WorkflowError(`节点 id 重复：${n.id}`)
      seen.add(n.id)
      if (!n.name.trim()) throw new WorkflowError('节点名称不能为空')
    }
    const record: Workflow = {
      ...workflow,
      builtin: false,
      createdAt: workflow.createdAt || this.now().toISOString(),
      updatedAt: this.now().toISOString()
    }
    await fs.mkdir(this.dir(), { recursive: true })
    await fs.writeFile(this.fileFor(record.id), JSON.stringify(record, null, 2), 'utf8')
    return record
  }

  async remove(id: string): Promise<void> {
    if (findTemplate(id)) throw new WorkflowError('内置模板不可删除')
    await fs.rm(this.fileFor(id), { force: true })
  }

  /** 由模板创建一份可编辑副本。 */
  async createFromTemplate(templateId: string): Promise<Workflow> {
    const tpl = findTemplate(templateId)
    if (!tpl) throw new WorkflowError(`模板不存在：${templateId}`)
    const now = this.now().toISOString()
    const copy: Workflow = {
      ...structuredClone(tpl),
      id: `${templateId}-${this.now().getTime().toString(36)}`,
      name: `${tpl.name}（副本）`,
      builtin: false,
      createdAt: now,
      updatedAt: now
    }
    await fs.mkdir(this.dir(), { recursive: true })
    await fs.writeFile(this.fileFor(copy.id), JSON.stringify(copy, null, 2), 'utf8')
    return copy
  }
}

/** 新节点工厂（界面「添加节点」用）。 */
export function newNode(index: number, skillId = ''): WorkflowNode {
  return {
    id: `n${Date.now().toString(36)}${index}`,
    name: `节点 ${index + 1}`,
    skillId,
    input: { source: 'previous' },
    sink: { kind: 'next' }
  }
}
