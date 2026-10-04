import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createProject } from '../../src/main/services/storage/project'
import { applyFramework, characterFileName, parseCharacters, parseFramework } from '../../src/main/services/framework/apply'

const SAMPLE = `## 一句话梗概
仵作能听见亡者遗言，被迫为自己验尸。

## 题材
古代悬疑

## 主题
真相与代价

## 基调
冷峻

## 目标读者
悬疑爱好者

## 世界观
亡者遗言在死后三日内可闻；仵作受官府节制。

## 主要人物
### 张三
- 身份：仵作
- 性格：沉默
- 目标：查明师父之死

### 李四
身份：捕快；性格：爽利

## 主线与卷纲
主线：揭开验尸案背后的朝堂阴谋。
### 第一卷
雨夜连环案。

## 文风规范
第三人称，短句。

## 时间线
| 时间 | 事件 | 涉及人物 |
| --- | --- | --- |
| 第一日 | 无名尸出现 | 张三 |

## 附录
这一段标题不在契约内。
`

async function project(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-fw-'))
  const root = path.join(base, 'proj')
  await createProject(root, { name: '框架测试' })
  return root
}

describe('故事框架解析与落库（验收要点 1）', () => {
  it('按固定标题拆分出六类内容', () => {
    const fw = parseFramework(SAMPLE)
    expect(fw.overview).toContain('仵作能听见亡者遗言')
    expect(fw.worldview).toContain('死后三日内可闻')
    expect(fw.mainline).toContain('朝堂阴谋')
    expect(fw.style).toContain('第三人称')
    expect(fw.timeline).toContain('无名尸出现')
    expect(fw.characters.map((c) => c.name)).toEqual(['张三', '李四'])
    expect(fw.unknownSections).toContain('附录')
  })

  it('落库写入 bible/ 六件套 + 每角色一个 md', async () => {
    const root = await project()
    const written = await applyFramework(root, parseFramework(SAMPLE))
    expect(written).toContain('bible/00-概述.md')
    expect(written).toContain('bible/01-世界观.md')
    expect(written).toContain('bible/03-主线与卷纲.md')
    expect(written).toContain('bible/04-文风规范.md')
    expect(written).toContain('bible/05-时间线.md')
    expect(written).toContain('bible/02-人物/张三.md')
    expect(written).toContain('bible/02-人物/李四.md')

    const overview = await fs.readFile(path.join(root, 'bible', '00-概述.md'), 'utf8')
    expect(overview).toContain('一句话梗概')
    expect(overview).toContain('目标读者')
    const zhang = await fs.readFile(path.join(root, 'bible', '02-人物', '张三.md'), 'utf8')
    expect(zhang).toContain('目标：查明师父之死')
  })

  it('模型漏节时不覆盖既有文件（避免清空已有设定）', async () => {
    const root = await project()
    const before = await fs.readFile(path.join(root, 'bible', '01-世界观.md'), 'utf8')
    expect(before).toContain('（待填写）')
    const partial = '## 一句话梗概\n只有梗概。\n## 文风规范\n短句。\n'
    const written = await applyFramework(root, parseFramework(partial))
    expect(written).not.toContain('bible/01-世界观.md')
    const after = await fs.readFile(path.join(root, 'bible', '01-世界观.md'), 'utf8')
    expect(after).toBe(before)
    const style = await fs.readFile(path.join(root, 'bible', '04-文风规范.md'), 'utf8')
    expect(style).toContain('短句。')
  })

  it('角色名做文件名安全化', () => {
    expect(characterFileName('张三')).toBe('张三.md')
    expect(characterFileName('A/B:C')).toBe('A-B-C.md')
  })

  it('空行分段的角色也能解析', () => {
    const chars = parseCharacters('张三：仵作，沉默寡言。\n\n李四：捕快，爽利。')
    expect(chars.map((c) => c.name)).toEqual(['张三', '李四'])
  })
})
