import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import {
  parseFrontmatter,
  parseSkillFile,
  parseYamlSubset,
  serializeSkill,
  SkillParseError
} from '../../src/main/services/skills/parser'
import type { Skill } from '../../src/shared/types'

const SKILLS_DIR = path.resolve(process.cwd(), 'skills')

const BUILTIN = [
  { id: 'generate-story-framework', output: 'text', inputs: ['premise', 'genre', 'target_words'] },
  { id: 'plan-chapter', output: 'text', inputs: ['chapter_no'] },
  { id: 'write-chapter', output: 'text', inputs: ['chapter_no', 'chapter_plan'] },
  { id: 'proofread', output: 'issues', inputs: ['chapter_text'] },
  { id: 'polish', output: 'rewrite', inputs: ['chapter_text'] },
  { id: 'deai', output: 'rewrite', inputs: ['chapter_text'] },
  { id: 'consistency-check', output: 'issues', inputs: ['chapter_text'] },
  { id: 'state-writeback', output: 'text', inputs: ['chapter_no', 'chapter_text'] }
] as const

describe('SKILL.md：内置 8 个（验收要点 6）', () => {
  it('skills/ 目录恰好 8 个 .md，且 id/output/inputs 与契约一致', async () => {
    const files = (await fs.readdir(SKILLS_DIR)).filter((f) => f.endsWith('.md')).sort()
    expect(files).toHaveLength(8)

    for (const spec of BUILTIN) {
      const parsed = parseSkillFile(await fs.readFile(path.join(SKILLS_DIR, `${spec.id}.md`), 'utf8'))
      expect(parsed.skill.id).toBe(spec.id)
      expect(parsed.skill.output).toBe(spec.output)
      expect(parsed.skill.name.length).toBeGreaterThan(0)
      expect(parsed.skill.description.length).toBeGreaterThan(0)
      for (const input of spec.inputs) expect(parsed.skill.inputs).toContain(input)
      expect(parsed.skill.body).toContain('{{')
    }
  })

  it('8 个内置 id 无重复', async () => {
    const ids: string[] = []
    for (const f of await fs.readdir(SKILLS_DIR)) {
      if (!f.endsWith('.md')) continue
      ids.push(parseSkillFile(await fs.readFile(path.join(SKILLS_DIR, f), 'utf8')).skill.id)
    }
    expect(new Set(ids).size).toBe(8)
  })

  it('检查类 Skill 输出 issues，润色类输出 rewrite', async () => {
    const proofread = parseSkillFile(await fs.readFile(path.join(SKILLS_DIR, 'proofread.md'), 'utf8'))
    const polish = parseSkillFile(await fs.readFile(path.join(SKILLS_DIR, 'polish.md'), 'utf8'))
    expect(proofread.skill.output).toBe('issues')
    expect(polish.skill.output).toBe('rewrite')
    // 检查类必须要求结构化输出，否则无法解析
    expect(proofread.skill.body).toContain('JSON')
  })
})

describe('frontmatter 解析（YAML 子集）', () => {
  it('标量类型：字符串/数字/布尔/引号/内联数组', () => {
    const meta = parseYamlSubset(
      ['a: hello', 'b: 42', 'c: true', 'd: "含 空格:的 值"', 'e: [x, y, 3]'].join('\n')
    )
    expect(meta.a).toBe('hello')
    expect(meta.b).toBe(42)
    expect(meta.c).toBe(true)
    expect(meta.d).toBe('含 空格:的 值')
    expect(meta.e).toEqual(['x', 'y', 3])
  })

  it('块状列表与注释/空行', () => {
    const meta = parseYamlSubset(['# 注释', 'inputs:', '  - chapter_text', '  - bible.文风规范', '', 'version: 2'].join('\n'))
    expect(meta.inputs).toEqual(['chapter_text', 'bible.文风规范'])
    expect(meta.version).toBe(2)
  })

  it('无 frontmatter → meta 空、body 全文；未闭合 → 报错', () => {
    expect(parseFrontmatter('正文没有头')).toEqual({ meta: {}, body: '正文没有头' })
    expect(() => parseFrontmatter('---\nid: x\n没有结束线')).toThrow(SkillParseError)
  })
})

describe('提示词只存在于 skills/ 目录（验收要点 8）', () => {
  async function walk(dir: string): Promise<string[]> {
    const out: string[] = []
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) out.push(...(await walk(full)))
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(full)
    }
    return out
  }

  it('src/ 下任何文件都不包含内置 Skill 的提示词正文', async () => {
    // 从每个内置 Skill 正文里取出一条特征句（正文首个非标题、非空、长度 > 12 的行）
    const signatures: string[] = []
    for (const f of await fs.readdir(SKILLS_DIR)) {
      if (!f.endsWith('.md')) continue
      const parsed = parseSkillFile(await fs.readFile(path.join(SKILLS_DIR, f), 'utf8'))
      const line = parsed.skill.body
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 12 && !l.startsWith('#'))
      expect(line, `${f} 应有可作指纹的正文行`).toBeTruthy()
      if (line) signatures.push(line)
    }
    expect(signatures.length).toBe(8)

    const srcFiles = await walk(path.resolve(process.cwd(), 'src'))
    expect(srcFiles.length).toBeGreaterThan(20)
    const offenders: string[] = []
    for (const file of srcFiles) {
      const text = await fs.readFile(file, 'utf8')
      for (const sig of signatures) {
        if (text.includes(sig)) offenders.push(`${path.relative(process.cwd(), file)} ← ${sig}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('SKILL.md 解析与序列化', () => {
  it('缺少 id / 正文为空 / 非法输出类型时明确处理', () => {
    expect(() => parseSkillFile('---\nname: x\n---\n正文')).toThrow(/id/)
    expect(() => parseSkillFile('---\nid: x\n---\n   \n')).toThrow(/正文为空/)
    // 非法 output 收敛为 text，而不是抛错
    const parsed = parseSkillFile('---\nid: x\noutput: nope\n---\n正文')
    expect(parsed.skill.output).toBe('text')
    expect(parsed.skill.recommendedModel).toBeNull()
  })

  it('序列化 → 解析 往返保持字段（含中文与变量）', () => {
    const skill: Skill = {
      id: 'my-skill',
      name: '我的 技能',
      description: '含"引号"的描述',
      version: 3,
      recommendedModel: 'writer',
      output: 'rewrite',
      inputs: ['chapter_text', 'bible.文风规范'],
      body: '# 提示\n\n处理 {{chapter_text}}，参照 {{bible.文风规范}}。\n',
      builtin: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const parsed = parseSkillFile(serializeSkill(skill))
    expect(parsed.skill.id).toBe('my-skill')
    expect(parsed.skill.name).toBe('我的 技能')
    expect(parsed.skill.description).toBe('含"引号"的描述')
    expect(parsed.skill.version).toBe(3)
    expect(parsed.skill.recommendedModel).toBe('writer')
    expect(parsed.skill.output).toBe('rewrite')
    expect(parsed.skill.inputs).toEqual(['chapter_text', 'bible.文风规范'])
    expect(parsed.skill.body).toContain('{{chapter_text}}')
  })
})
