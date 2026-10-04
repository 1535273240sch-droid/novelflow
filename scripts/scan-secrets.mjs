#!/usr/bin/env node
/**
 * 发布前敏感信息扫描（m5b 验收要点 4）。
 * 扫描仓库内文本文件，查找：GitHub/OpenAI/Google/xAI 等令牌、私钥、可疑的 key 赋值、本机绝对路径。
 * 命中即打印并写入 docs/发布前敏感信息扫描.md，退出码 1（可被 CI 用作门禁）。
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SELF = path.relative(repo, fileURLToPath(import.meta.url)).split(path.sep).join('/')

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'release', '.git', 'seed-novel', 'logs', 'coverage'])
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.css', '.html', '.txt', '.gitignore'])

const WIN_USER = '[A-Za-z]:\\\\\\\\' + 'Users' // 拼装，避免扫描脚本自身命中
const patterns = [
  ['GitHub token', /ghp_[A-Za-z0-9]{20,}/g],
  ['GitHub token (fine-grained)', /github_pat_[A-Za-z0-9_]{20,}/g],
  ['OpenAI key', /sk-[A-Za-z0-9]{32,}/g],
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{32,}/g],
  ['Google API key', /AIza[0-9A-Za-z\-_]{30,}/g],
  ['xAI key', /xai-[A-Za-z0-9]{20,}/g],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['key 赋值', /(api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/gi],
  ['Windows 用户绝对路径', new RegExp(WIN_USER, 'g')],
  ['macOS 用户绝对路径', /\/Users\/[A-Za-z0-9._-]+\//g]
]

/** 明显的测试占位值不计为敏感信息（并在报告中说明该豁免）。 */
const FIXTURE_HINTS = ['test', 'plain', 'fake', 'dummy', 'mock', 'sample', 'example', 'placeholder', 'xxx', '123456', 'secret-1']
const isFixture = (s) => FIXTURE_HINTS.some((h) => s.toLowerCase().includes(h))

async function walk(dir) {
  const out = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      out.push(...(await walk(path.join(dir, e.name))))
    } else {
      const ext = path.extname(e.name).toLowerCase()
      if (TEXT_EXT.has(ext) || e.name === '.gitignore') out.push(path.join(dir, e.name))
    }
  }
  return out
}

const findings = []
const files = await walk(repo)
for (const file of files) {
  const rel = path.relative(repo, file).split(path.sep).join('/')
  if (rel === SELF) continue
  const text = await fs.readFile(file, 'utf8').catch(() => '')
  for (const [name, re] of patterns) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      if (isFixture(m[0])) continue
      findings.push({ file: rel, rule: name, sample: m[0].slice(0, 8) + '…' })
    }
  }
}

const report = [
  '# 发布前敏感信息扫描',
  '',
  `- 扫描时间：${new Date().toISOString()}`,
  `- 扫描文件数：${files.length}`,
  `- 规则：GitHub/OpenAI/Anthropic/Google/xAI 令牌、私钥、key 赋值、本机绝对路径`,
  `- 豁免：含 test/plain/fake/dummy/mock/sample/example/placeholder/xxx/123456 的明显占位串`,
  `- 结论：**${findings.length === 0 ? '未发现敏感信息（PASS）' : `发现 ${findings.length} 处（FAIL）`}**`,
  '',
  findings.length === 0
    ? '未命中任何规则。'
    : findings.map((f) => `- \`${f.file}\` — ${f.rule}：\`${f.sample}\``).join('\n'),
  ''
].join('\n')

await fs.mkdir(path.join(repo, 'docs'), { recursive: true })
await fs.writeFile(path.join(repo, 'docs', '发布前敏感信息扫描.md'), report, 'utf8')
console.log(report)
process.exit(findings.length === 0 ? 0 : 1)
