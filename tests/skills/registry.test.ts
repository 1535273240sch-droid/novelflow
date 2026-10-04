import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { SkillRegistry } from '../../src/main/services/skills/registry'
import { parseSkillFile, serializeSkill, SkillParseError } from '../../src/main/services/skills/parser'
import type { Skill } from '../../src/shared/types'

const BUILTIN_DIR = path.resolve(process.cwd(), 'skills')

async function newRegistry(): Promise<{ reg: SkillRegistry; userDir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-skills-'))
  const userDir = path.join(dir, 'skills')
  return { reg: new SkillRegistry(BUILTIN_DIR, userDir), userDir }
}

function makeSkill(patch: Partial<Skill> = {}): Skill {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: 'custom-skillspec',
    name: '自定义技能',
    description: '测试用',
    version: 1,
    recommendedModel: 'writer',
    output: 'rewrite',
    inputs: ['chapter_text'],
    body: '请处理：{{chapter_text}}',
    builtin: false,
    createdAt: now,
    updatedAt: now,
    ...patch
  }
}

describe('Skill 库：内置 seed 与列表', () => {
  it('首次 list 自动 seed 内置 8 个，并标记 builtin', async () => {
    const { reg, userDir } = await newRegistry()
    const list = await reg.list()
    expect(list).toHaveLength(8)
    expect(list.every((s) => s.builtin)).toBe(true)
    const files = (await fs.readdir(userDir)).filter((f) => f.endsWith('.md'))
    expect(files).toHaveLength(8)
  })

  it('list 不返回正文（提示词不出现在列表接口）', async () => {
    const { reg } = await newRegistry()
    const list = await reg.list()
    expect(JSON.stringify(list)).not.toContain('{{chapter_text}}')
  })
})

describe('Skill 库：编辑保存版本递增（验收要点 1）', () => {
  it('修改正文 → 版本 +1；未修改 → 版本不变', async () => {
    const { reg } = await newRegistry()
    const original = (await reg.get('polish'))!
    expect(original.version).toBe(1)

    const edited = await reg.save({ ...original, body: original.body + '\n补充要求。' })
    expect(edited.version).toBe(2)

    const unchanged = await reg.save({ ...edited })
    expect(unchanged.version).toBe(2)

    const again = await reg.save({ ...edited, name: '润色（改）' })
    expect(again.version).toBe(3)
  })

  it('保存后重新读取，内容与版本一致落盘', async () => {
    const { reg } = await newRegistry()
    const s = makeSkill()
    await reg.save(s)
    const loaded = await reg.get('custom-skillspec')
    expect(loaded?.version).toBe(1)
    await reg.save({ ...loaded!, body: loaded!.body + '\nX' })
    const reread = await reg.get('custom-skillspec')
    expect(reread?.version).toBe(2)
    expect(reread?.body).toContain('\nX')
  })

  it('新建用户 Skill 的 builtin 为 false', async () => {
    const { reg } = await newRegistry()
    const saved = await reg.save(makeSkill())
    expect(saved.builtin).toBe(false)
    const list = await reg.list()
    expect(list).toHaveLength(9)
  })
})

describe('Skill 库：导入 / 复制 / 导出 / 删除', () => {
  it('导入标准 SKILL.md', async () => {
    const { reg } = await newRegistry()
    const text = serializeSkill(makeSkill({ id: 'imported-one', name: '导入的技能' }))
    const imported = await reg.importText('whatever.md', text)
    expect(imported.id).toBe('imported-one')
    expect(imported.version).toBe(1)
    expect((await reg.get('imported-one'))?.name).toBe('导入的技能')
  })

  it('导入 id 冲突时自动加后缀，不覆盖既有', async () => {
    const { reg } = await newRegistry()
    const text = serializeSkill(makeSkill({ id: 'dup-id' }))
    const a = await reg.importText('a.md', text)
    const b = await reg.importText('b.md', text)
    expect(a.id).toBe('dup-id')
    expect(b.id).toBe('dup-id-2')
  })

  it('缺少 id 时用文件名派生', async () => {
    const { reg } = await newRegistry()
    const noId = '---\nname: 无 id\noutput: text\n---\n正文 {{chapter_text}}'
    const s = await reg.importText('我的技能 名称.md', noId)
    expect(s.id).toContain('我的技能')
    expect(parseSkillFile(serializeSkill(s)).skill.id).toBe(s.id)
  })

  it('复制 → 新 id、版本归 1、名称加副本', async () => {
    const { reg } = await newRegistry()
    await reg.save(makeSkill({ id: 'base-skill', version: 5 }))
    const copy = await reg.duplicate('base-skill')
    expect(copy.id).toBe('base-skill-copy')
    expect(copy.version).toBe(1)
    expect(copy.name).toContain('副本')
    expect(copy.builtin).toBe(false)
  })

  it('导出文本可被重新解析（往返一致）', async () => {
    const { reg } = await newRegistry()
    await reg.save(makeSkill({ id: 'export-me', body: '导出正文 {{chapter_text}}' }))
    const text = await reg.exportText('export-me')
    const parsed = parseSkillFile(text)
    expect(parsed.skill.id).toBe('export-me')
    expect(parsed.skill.body).toContain('导出正文')
  })

  it('删除后不再出现在列表', async () => {
    const { reg } = await newRegistry()
    await reg.save(makeSkill({ id: 'to-delete' }))
    await reg.remove('to-delete')
    expect(await reg.get('to-delete')).toBeNull()
  })

  it('非法 id 拒绝写入（路径守卫）', async () => {
    const { reg } = await newRegistry()
    await expect(reg.save(makeSkill({ id: '../escape' }))).rejects.toThrow(SkillParseError)
  })

  it('单个损坏文件不拖垮整个列表', async () => {
    const { reg, userDir } = await newRegistry()
    await reg.list()
    await fs.writeFile(path.join(userDir, 'broken.md'), '---\nid: broken\n---\n', 'utf8')
    const list = await reg.list()
    expect(list.length).toBeGreaterThanOrEqual(8)
    expect(list.some((s) => s.id === 'broken')).toBe(false)
  })
})
