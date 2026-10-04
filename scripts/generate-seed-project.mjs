#!/usr/bin/env node
/**
 * 生成 100 万字种子项目（M5 验收要点 3）——可重复、确定性。
 *
 * 用法：
 *   node scripts/generate-seed-project.mjs [--out <dir>] [--chapters 200] [--chars 5000] [--seed 42]
 *
 * 默认 200 章 × 5000 字 ≈ 100 万字。同一 seed 输出完全一致；重复运行会覆盖同名文件。
 * 生成的是「目标目录」本身（若已有 novel.json 直接覆盖，便于 benchmark 反复造数据）。
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

function parseArgs(argv) {
  const out = { out: 'seed-novel', chapters: 200, chars: 5000, seed: 42 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') out.out = argv[++i]
    else if (a === '--chapters') out.chapters = parseInt(argv[++i], 10)
    else if (a === '--chars') out.chars = parseInt(argv[++i], 10)
    else if (a === '--seed') out.seed = parseInt(argv[++i], 10)
  }
  return out
}

/** 确定性 PRNG（mulberry32）。 */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = '雨夜 义庄 仵作 遗言 铜钱 棺木 灯笼 巷口 刀刃 迷雾 更鼓 纸钱 长街 河埠 枯井 符纸 药铺 镖局 旧案 卷宗 衙役 捕快 密信 玉佩 更夫 香烛 棺材铺 破庙 残卷 暗号'.split(' ')
const PUNCT = ['。', '，', '、', '；', '：', '！', '？']

function paragraph(rand, length) {
  let s = ''
  while (s.length < length) {
    const w = WORDS[Math.floor(rand() * WORDS.length)]
    s += w
    if (rand() < 0.14) s += PUNCT[Math.floor(rand() * PUNCT.length)]
    else if (rand() < 0.02) s += '\n'
  }
  return s.replace(/[。，、；：！？]+$/, '') + '。'
}

function chapterText(rand, targetChars) {
  const paras = []
  let total = 0
  while (total < targetChars) {
    const p = paragraph(rand, 60 + Math.floor(rand() * 120))
    paras.push(p)
    total += p.length
  }
  return paras.join('\n\n')
}

async function main() {
  const { out, chapters, chars, seed } = parseArgs(process.argv.slice(2))
  const root = path.resolve(out)
  const rand = mulberry32(seed)

  const dirs = ['bible/02-人物', 'outline', 'chapters', 'state', 'runs', '.history']
  for (const d of dirs) await fs.mkdir(path.join(root, d), { recursive: true })

  const now = new Date().toISOString()
  await fs.writeFile(
    path.join(root, 'novel.json'),
    JSON.stringify(
      {
        version: 1,
        name: path.basename(root),
        genre: '悬疑',
        targetWords: chapters * chars,
        modelPresetId: null,
        createdAt: now,
        updatedAt: now
      },
      null,
      2
    ) + '\n',
    'utf8'
  )

  const bible = {
    '00-概述.md': '# 概述\n\n## 一句话梗概\n能听见亡者遗言的仵作，被迫为自己验尸。\n',
    '01-世界观.md': '# 世界观\n\n亡者遗言在死后三日内可闻，仵作受官府节制。\n',
    '03-主线与卷纲.md': '# 主线与卷纲\n\n## 主线\n揭开验尸案背后的阴谋。\n',
    '04-文风规范.md': '# 文风规范\n\n## 人称与视角\n第三人称，短句。\n',
    '05-时间线.md': '# 时间线\n\n| 时间 | 事件 | 涉及人物 |\n| --- | --- | --- |\n| 第一日 | 无名尸出现 | 张三 |\n'
  }
  for (const [name, content] of Object.entries(bible)) {
    await fs.writeFile(path.join(root, 'bible', name), content, 'utf8')
  }
  await fs.writeFile(path.join(root, 'bible', '02-人物', '张三.md'), '# 张三\n身份：仵作\n性格：沉默\n', 'utf8')

  await fs.writeFile(
    path.join(root, 'state', 'characters.json'),
    JSON.stringify({ version: 1, characters: [{ name: '张三', status: '警觉', location: '城南义庄' }] }, null, 2) + '\n',
    'utf8'
  )
  await fs.writeFile(path.join(root, 'state', 'foreshadowing.json'), JSON.stringify({ version: 1, items: [{ text: '来历不明的铜钥匙', status: 'open' }] }, null, 2) + '\n', 'utf8')
  await fs.writeFile(path.join(root, 'state', 'events.json'), JSON.stringify({ version: 1, events: [] }, null, 2) + '\n', 'utf8')

  let totalChars = 0
  for (let n = 1; n <= chapters; n++) {
    const id = `第${String(n).padStart(3, '0')}章`
    await fs.writeFile(
      path.join(root, 'outline', `${id}.md`),
      `- 章节标题：${id}\n- 本章目标：推进第 ${n} 段线索\n- 核心冲突：张三与官府的对抗\n- 出场人物：张三\n- 预计字数：${chars}\n`,
      'utf8'
    )
    const text = chapterText(rand, chars)
    totalChars += text.replace(/\s/g, '').length
    await fs.writeFile(path.join(root, 'chapters', `${id}.md`), `# ${id}\n\n${text}\n`, 'utf8')
  }

  console.log(JSON.stringify({ root, chapters, targetChars: chapters * chars, actualChars: totalChars, seed }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
