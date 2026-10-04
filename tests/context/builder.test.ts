import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createProject } from '../../src/main/services/storage/project'
import {
  buildChapterContext,
  estimateTokens,
  oneLineSummary,
  parseAppearingCharacters
} from '../../src/main/services/context/builder'

async function fixture(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-ctx-'))
  const root = path.join(base, 'proj')
  await createProject(root, { name: '上下文测试', genre: '悬疑', targetWords: 800000 })
  await fs.writeFile(path.join(root, 'bible', '04-文风规范.md'), '人称：第三人称。短句为主。', 'utf8')
  await fs.writeFile(path.join(root, 'bible', '01-世界观.md'), '世界观：亡者遗言可被仵作听见。', 'utf8')
  await fs.writeFile(path.join(root, 'bible', '02-人物', '张三.md'), '# 张三\n身份：仵作\n性格：沉默', 'utf8')
  await fs.writeFile(path.join(root, 'bible', '02-人物', '李四.md'), '# 李四\n身份：捕快', 'utf8')
  await fs.writeFile(path.join(root, 'bible', '02-人物', '王五.md'), '# 王五\n身份：路人（本章不出场）', 'utf8')
  await fs.writeFile(
    path.join(root, 'outline', '第002章.md'),
    '章节标题：雨夜验尸\n本章目标：确认死者身份\n核心冲突：张三与官府的对抗\n出场人物：张三、李四\n预计字数：3000\n',
    'utf8'
  )
  await fs.writeFile(path.join(root, 'state', 'characters.json'), JSON.stringify({ version: 1, characters: [{ name: '张三', status: '左臂受伤', location: '城南义庄' }] }), 'utf8')
  await fs.writeFile(path.join(root, 'state', 'foreshadowing.json'), JSON.stringify({ version: 1, items: [{ text: '青铜怀表', status: 'open' }, { text: '已回收的线头', status: 'resolved' }] }), 'utf8')
  await fs.writeFile(path.join(root, 'chapters', '第001章.md'), '第一章 开场\n\n张三在雨夜接到一具无名尸。他听见了遗言。\n后面还有很多细节。', 'utf8')
  return root
}

describe('Context Builder：六条优先级（验收要点 4）', () => {
  it('分段优先级为 1..6，且按序拼接', async () => {
    const root = await fixture()
    const built = await buildChapterContext(root, 2)
    expect(built.sections.map((s) => s.priority)).toEqual([1, 2, 3, 4, 5, 6])
    const idxStyle = built.text.indexOf('文风规范与世界观要点')
    const idxPlan = built.text.indexOf('本章计划')
    const idxPrev = built.text.indexOf('上一章结尾')
    expect(idxStyle).toBeGreaterThanOrEqual(0)
    expect(idxPlan).toBeGreaterThan(idxStyle)
    expect(idxPrev).toBeGreaterThan(idxPlan)
  })

  it('第 1 项同时含文风规范与世界观要点', async () => {
    const root = await fixture()
    const built = await buildChapterContext(root, 2)
    const s1 = built.sections.find((s) => s.priority === 1)!
    expect(s1.content).toContain('第三人称')
    expect(s1.content).toContain('亡者遗言')
  })

  it('第 3 项按本章计划「按需」加载出场人物，未出场角色不加载', async () => {
    const root = await fixture()
    const built = await buildChapterContext(root, 2)
    const s3 = built.sections.find((s) => s.priority === 3)!
    expect(s3.content).toContain('张三')
    expect(s3.content).toContain('李四')
    expect(s3.content).not.toContain('王五')
  })

  it('第 4 项含人物最新状态与未回收伏笔（已回收的不出现）', async () => {
    const root = await fixture()
    const built = await buildChapterContext(root, 2)
    const s4 = built.sections.find((s) => s.priority === 4)!
    expect(s4.content).toContain('左臂受伤')
    expect(s4.content).toContain('青铜怀表')
    expect(s4.content).not.toContain('已回收的线头')
  })

  it('第 5 项：最近 N 章保留原文，更早章节压成一句话摘要', async () => {
    const root = await fixture()
    await fs.writeFile(path.join(root, 'chapters', '第002章.md'), '第二章\n\n李四登场。他带来一封信。', 'utf8')
    await fs.writeFile(path.join(root, 'chapters', '第003章.md'), '第三章\n\n真相浮现，张三做出选择。', 'utf8')
    await fs.writeFile(path.join(root, 'outline', '第004章.md'), '出场人物：张三\n', 'utf8')
    const built = await buildChapterContext(root, 4, { recentChapters: 1 })
    const s5 = built.sections.find((s) => s.priority === 5)!
    expect(s5.content).toContain('第1章：第一章') // 早期 → 摘要
    expect(s5.content).toContain('第三章') // 最近 1 章 → 原文
    expect(s5.content).toContain('第二章') // 次新 → 摘要
  })

  it('第 6 项是上一章结尾原文（可配置截取长度）', async () => {
    const root = await fixture()
    await fs.writeFile(path.join(root, 'chapters', '第002章.md'), '第二章结尾内容ABC', 'utf8')
    await fs.writeFile(path.join(root, 'outline', '第003章.md'), '出场人物：张三\n', 'utf8')
    const built = await buildChapterContext(root, 3, { tailChars: 4 })
    const s6 = built.sections.find((s) => s.priority === 6)!
    expect(s6.content).toBe('容ABC')
    expect(s6.content.endsWith('ABC')).toBe(true)
  })
})

describe('Context Builder：token 预算与裁剪切序（验收要点 5）', () => {
  it('预算充足时一段不裁', async () => {
    const root = await fixture()
    const built = await buildChapterContext(root, 2, { budget: 1_000_000 })
    expect(built.droppedKeys).toEqual([])
    expect(built.overBudget).toBe(false)
  })

  it('超预算按 6→5→4→3 顺序裁剪，第 1–2 项永不裁剪', async () => {
    const root = await fixture()
    const built = await buildChapterContext(root, 2, { budget: 1 })
    expect(built.droppedKeys).toEqual(['previous_tail', 'recap', 'current_state', 'character_profiles'])
    const dropped = new Set(built.sections.filter((s) => s.dropped).map((s) => s.priority))
    expect(dropped.has(1)).toBe(false)
    expect(dropped.has(2)).toBe(false)
    expect(built.overBudget).toBe(true) // 只剩 1、2 仍可能超
  })

  it('预算恰好等于第 1+2 项时，裁到 3 即停，且不超预算', async () => {
    const root = await fixture()
    const full = await buildChapterContext(root, 2, { budget: 1_000_000 })
    const t12 = full.sections
      .filter((s) => s.priority === 1 || s.priority === 2)
      .reduce((sum, s) => sum + s.tokens, 0)
    const built = await buildChapterContext(root, 2, { budget: t12 })
    expect(built.droppedKeys).toEqual(['previous_tail', 'recap', 'current_state', 'character_profiles'])
    expect(built.overBudget).toBe(false)
    expect(built.totalTokens).toBe(t12)
  })

  it('estimateTokens 单调且对空串为 0', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('a'.repeat(15))).toBe(10)
    expect(estimateTokens('a'.repeat(30))).toBeGreaterThan(estimateTokens('a'.repeat(15)))
  })
})

describe('辅助函数', () => {
  it('parseAppearingCharacters 解析「出场人物：」行', () => {
    expect(parseAppearingCharacters('目标：x\n出场人物：张三、李四，王五\n预计：3000')).toEqual(['张三', '李四', '王五'])
    expect(parseAppearingCharacters('没有这一行')).toEqual([])
  })
  it('oneLineSummary 跳过标题取首句', () => {
    expect(oneLineSummary('# 第一章\n\n张三走进义庄。第二句。')).toBe('张三走进义庄。')
    expect(oneLineSummary('# 标题\n正文首句在这里。接下来。')).toBe('正文首句在这里。')
    expect(oneLineSummary('没有标点的短句')).toBe('没有标点的短句')
    expect(oneLineSummary('# 只有标题\n')).toBe('')
  })
})
