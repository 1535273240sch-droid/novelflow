import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { parseSkillFile, serializeSkill, isValidSkillId, SkillParseError } from './parser'
import type { Skill, SkillMeta } from '../../../shared/types'

/**
 * Skill 库（用户可编辑）：
 * - 内置 Skill 位于仓库 `skills/`（随应用分发），首次运行 seed 到用户目录；
 * - 用户在用户目录（userData/skills）中编辑/新增/导入，互不覆盖；
 * - 编辑保存后版本号递增（验收要点 1）。
 *
 * 本模块不 import electron，便于单元测试直接运行。
 */

export class SkillRegistry {
  constructor(
    private readonly builtinDir: string,
    private readonly userDir: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  private fileFor(id: string): string {
    if (!isValidSkillId(id)) throw new SkillParseError(`非法 Skill id：${id}`)
    return path.join(this.userDir, `${id}.md`)
  }

  async ensureSeeded(): Promise<void> {
    await fs.mkdir(this.userDir, { recursive: true })
    let names: string[] = []
    try {
      names = await fs.readdir(this.builtinDir)
    } catch {
      return // 没有内置目录（如生产打包缺失）时不阻塞
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue
      const dest = path.join(this.userDir, name)
      try {
        await fs.access(dest)
      } catch {
        const content = await fs.readFile(path.join(this.builtinDir, name), 'utf8')
        const parsed = parseSkillFile(content)
        await fs.writeFile(dest, serializeSkill(withMeta(parsed.skill, true, this.now())), 'utf8')
      }
    }
  }

  private async builtinIds(): Promise<Set<string>> {
    const ids = new Set<string>()
    let names: string[] = []
    try {
      names = await fs.readdir(this.builtinDir)
    } catch {
      return ids
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue
      try {
        const parsed = parseSkillFile(await fs.readFile(path.join(this.builtinDir, name), 'utf8'))
        ids.add(parsed.skill.id)
      } catch {
        /* 内置文件损坏时跳过 */
      }
    }
    return ids
  }

  private async readSkill(id: string): Promise<Skill | null> {
    let raw: string
    try {
      raw = await fs.readFile(this.fileFor(id), 'utf8')
    } catch {
      return null
    }
    const parsed = parseSkillFile(raw)
    const st = await fs.stat(this.fileFor(id)).catch(() => null)
    const builtin = (await this.builtinIds()).has(id)
    const meta = (await this.readSidecar(id)) ?? {
      builtin,
      createdAt: st?.birthtime?.toISOString() ?? this.now().toISOString(),
      updatedAt: st?.mtime?.toISOString() ?? this.now().toISOString()
    }
    return { ...parsed.skill, ...meta, builtin }
  }

  /** 元数据（builtin/created/updated）存于同目录 .meta.json，避免污染 SKILL.md 契约。 */
  private metaFileFor(id: string): string {
    return path.join(this.userDir, `.${id}.meta.json`)
  }

  private async readSidecar(
    id: string
  ): Promise<{ createdAt: string; updatedAt: string } | null> {
    try {
      const raw = await fs.readFile(this.metaFileFor(id), 'utf8')
      const j = JSON.parse(raw) as { createdAt?: string; updatedAt?: string }
      if (j.createdAt && j.updatedAt) return { createdAt: j.createdAt, updatedAt: j.updatedAt }
    } catch {
      /* 无 sidecar */
    }
    return null
  }

  private async writeSidecar(id: string, createdAt: string, updatedAt: string): Promise<void> {
    await fs.writeFile(this.metaFileFor(id), JSON.stringify({ createdAt, updatedAt }, null, 2), 'utf8')
  }

  async list(): Promise<SkillMeta[]> {
    await this.ensureSeeded()
    const builtin = await this.builtinIds()
    const names = (await fs.readdir(this.userDir)).filter((n) => n.endsWith('.md') && !n.startsWith('.'))
    const out: SkillMeta[] = []
    for (const name of names) {
      const id = name.replace(/\.md$/, '')
      try {
        const skill = await this.readSkill(id)
        if (skill) {
          out.push({ ...toMeta(skill), builtin: builtin.has(id) })
        }
      } catch {
        /* 损坏文件跳过，不让一个坏文件拖垮整个列表 */
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    return out
  }

  async get(id: string): Promise<Skill | null> {
    await this.ensureSeeded()
    return this.readSkill(id)
  }

  /** 保存（编辑）：内容有变化则版本号 +1；无变化保持版本。 */
  async save(skill: Skill): Promise<Skill> {
    await this.ensureSeeded()
    const existing = await this.readSkill(skill.id)
    const parsed = parseSkillFile(serializeSkill({ ...skill, version: existing?.version ?? skill.version }))
    const changed =
      !existing ||
      existing.body !== parsed.skill.body ||
      JSON.stringify(metaSignature(existing)) !== JSON.stringify(metaSignature({ ...parsed.skill }))
    const version = existing ? (changed ? existing.version + 1 : existing.version) : parsed.skill.version || 1
    const now = this.now().toISOString()
    const createdAt = existing?.createdAt ?? now
    const record: Skill = {
      ...parsed.skill,
      version,
      builtin: (await this.builtinIds()).has(skill.id),
      createdAt,
      updatedAt: now
    }
    await fs.mkdir(this.userDir, { recursive: true })
    await fs.writeFile(this.fileFor(skill.id), serializeSkill(record), 'utf8')
    await this.writeSidecar(skill.id, createdAt, now)
    return record
  }

  /** 从 SKILL.md 文本导入；缺 id 时按文件名派生，id 冲突时自动加后缀。 */
  async importText(fileName: string, content: string): Promise<Skill> {
    await this.ensureSeeded()
    const parsed = parseSkillFile(content, { fallbackId: deriveIdFromFileName(fileName) })
    const id = parsed.skill.id
    let candidate = id
    let n = 2
    while (await this.exists(candidate)) {
      candidate = `${id}-${n++}`
    }
    const now = this.now().toISOString()
    const record: Skill = {
      ...parsed.skill,
      id: candidate,
      builtin: false,
      createdAt: now,
      updatedAt: now
    }
    await fs.mkdir(this.userDir, { recursive: true })
    await fs.writeFile(this.fileFor(candidate), serializeSkill(record), 'utf8')
    await this.writeSidecar(candidate, now, now)
    return record
  }

  async duplicate(id: string): Promise<Skill> {
    const src = await this.get(id)
    if (!src) throw new SkillParseError(`Skill 不存在：${id}`)
    let candidate = `${id}-copy`
    let n = 2
    while (await this.exists(candidate)) candidate = `${id}-copy-${n++}`
    const now = this.now().toISOString()
    const record: Skill = {
      ...src,
      id: candidate,
      name: `${src.name} 副本`,
      version: 1,
      builtin: false,
      createdAt: now,
      updatedAt: now
    }
    await fs.writeFile(this.fileFor(candidate), serializeSkill(record), 'utf8')
    await this.writeSidecar(candidate, now, now)
    return record
  }

  async remove(id: string): Promise<void> {
    await fs.rm(this.fileFor(id), { force: true })
    await fs.rm(this.metaFileFor(id), { force: true })
  }

  /** 导出为 SKILL.md 文本（验收要点 1：可导出）。 */
  async exportText(id: string): Promise<string> {
    const skill = await this.get(id)
    if (!skill) throw new SkillParseError(`Skill 不存在：${id}`)
    return serializeSkill(skill)
  }

  async exists(id: string): Promise<boolean> {
    try {
      await fs.access(this.fileFor(id))
      return true
    } catch {
      return false
    }
  }
}

function withMeta(
  skill: Omit<Skill, 'builtin' | 'createdAt' | 'updatedAt'>,
  builtin: boolean,
  date: Date
): Skill {
  const iso = date.toISOString()
  return { ...skill, builtin, createdAt: iso, updatedAt: iso }
}

function toMeta(skill: Skill): SkillMeta {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    recommendedModel: skill.recommendedModel,
    output: skill.output,
    inputs: skill.inputs,
    builtin: skill.builtin,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt
  }
}

function metaSignature(s: Pick<Skill, 'name' | 'description' | 'output' | 'recommendedModel' | 'inputs'>): unknown {
  return [s.name, s.description, s.output, s.recommendedModel, s.inputs]
}

/** 由文件名派生合法 id：保留中文，去掉路径分隔符与文件系统禁用字符。 */
function deriveIdFromFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/\.md$/i, '')
  const cleaned = base.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^[.\-]+|[.\-]+$/g, '')
  return isValidSkillId(cleaned) ? cleaned : `skill-${Date.now().toString(36)}`
}
