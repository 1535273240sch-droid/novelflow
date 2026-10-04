import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { chapterRel } from './builder'

/**
 * 写作门禁（验收要点 3）：没有章节计划就不允许写正文。
 *
 * 门禁做成主进程里的显式检查，界面与单测走同一条路径，避免「界面拦了、单测没拦」
 * 或反过来的假保护。
 */

export class ChapterGateError extends Error {
  readonly code = 'NO_PLAN'
  readonly guidance: string
  constructor(public readonly chapterNo: number) {
    const rel = chapterRel('outline', chapterNo)
    const guidance =
      `第 ${chapterNo} 章还没有章节计划（缺少 ${rel}）。` +
      `请先在「章节规划」中生成本章计划，再写正文——否则模型没有约束，会写出偏离框架的正文。`
    super(guidance)
    this.name = 'ChapterGateError'
    this.guidance = guidance
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** 返回章节计划内容；缺失时抛 ChapterGateError（带引导语）。 */
export async function requireChapterPlan(root: string, chapterNo: number): Promise<string> {
  const p = path.join(root, chapterRel('outline', chapterNo))
  if (!(await exists(p))) throw new ChapterGateError(chapterNo)
  const content = await fs.readFile(p, 'utf8')
  if (!content.trim()) throw new ChapterGateError(chapterNo)
  return content
}

/** 判断某个 Skill 声明的前置依赖是否满足；不满足抛 ChapterGateError。 */
export async function checkSkillRequires(
  root: string,
  chapterNo: number | undefined,
  requires: string[]
): Promise<void> {
  for (const req of requires) {
    if (req === 'chapter_plan') {
      if (chapterNo == null) {
        throw new Error('该 Skill 需要指定章号（请打开一个正文章节）')
      }
      await requireChapterPlan(root, chapterNo)
    }
  }
}
