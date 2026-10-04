import { describe, expect, it } from 'vitest'
import {
  applyHunks,
  countChanges,
  diffHunks,
  diffLines,
  groupHunks
} from '../../src/shared/diff'

describe('行级差异', () => {
  it('相同文本全为 equal', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc')
    expect(lines.every((l) => l.op === 'equal')).toBe(true)
  })

  it('插入 / 删除 / 修改 的行号正确', () => {
    const lines = diffLines('a\nb\nc', 'a\nX\nc')
    expect(lines.map((l) => l.op)).toEqual(['equal', 'delete', 'insert', 'equal'])
    const del = lines.find((l) => l.op === 'delete')!
    const ins = lines.find((l) => l.op === 'insert')!
    expect(del).toMatchObject({ text: 'b', aLine: 2, bLine: null })
    expect(ins).toMatchObject({ text: 'X', aLine: null, bLine: 2 })
  })

  it('分块：连续变更归为一块，equal 分开', () => {
    const hunks = diffHunks('a\nb\nc\nd', 'a\nB\nC\nd')
    expect(hunks.map((h) => h.kind)).toEqual(['equal', 'change', 'equal'])
    expect(countChanges(hunks)).toBe(1)
  })

  it('纯插入产生一个 change 块', () => {
    const hunks = diffHunks('a\nc', 'a\nb\nc')
    expect(countChanges(hunks)).toBe(1)
    expect(hunks.filter((h) => h.kind === 'change')[0].lines.every((l) => l.op === 'insert')).toBe(true)
  })
})

describe('逐处接受 / 拒绝（验收要点 3、5）', () => {
  const before = '第一句。\n第二句，有病。\n第三句。'
  const after = '第一句。\n第二句，改好了。\n第三句。'

  it('全部接受 → 等于新文', () => {
    const hunks = diffHunks(before, after)
    const accepted = new Set(hunks.filter((h) => h.kind === 'change').map((h) => h.id))
    expect(applyHunks(before, after, accepted)).toBe(after)
  })

  it('全部拒绝 → 等于原文', () => {
    expect(applyHunks(before, after, new Set())).toBe(before)
  })

  it('多处修改可部分接受', () => {
    const b = 'A1\nB1\nC1\nD1'
    const a = 'A2\nB1\nC2\nD1'
    const hunks = diffHunks(b, a)
    const changes = hunks.filter((h) => h.kind === 'change')
    expect(changes).toHaveLength(2)
    expect(applyHunks(b, a, new Set([changes[0].id]))).toBe('A2\nB1\nC1\nD1')
    expect(applyHunks(b, a, new Set([changes[1].id]))).toBe('A1\nB1\nC2\nD1')
  })

  it('末尾换行语义无损', () => {
    expect(applyHunks('a\n', 'a\nb\n', new Set())).toBe('a\n')
    const accepted = new Set(diffHunks('a\n', 'a\nb\n').filter((h) => h.kind === 'change').map((h) => h.id))
    expect(applyHunks('a\n', 'a\nb\n', accepted)).toBe('a\nb\n')
  })

  it('纯插入块被拒绝时不影响原文', () => {
    const hunks = diffHunks('a\nc', 'a\nb\nc')
    expect(applyHunks('a\nc', 'a\nb\nc', new Set())).toBe('a\nc')
    const accepted = new Set(hunks.filter((h) => h.kind === 'change').map((h) => h.id))
    expect(applyHunks('a\nc', 'a\nb\nc', accepted)).toBe('a\nb\nc')
  })

  it('groupHunks 生成的 id 唯一且稳定前缀', () => {
    const hunks = groupHunks(diffLines('a\nb\nc\nd', 'a\nB\nC\nd'))
    expect(new Set(hunks.map((h) => h.id)).size).toBe(hunks.length)
    expect(hunks[0].id.startsWith('h')).toBe(true)
  })
})

describe('超长文本退化', () => {
  it('超过阈值时走整块替换，仍能无损往返', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `行${i}`).join('\n')
    const changed = big.replace('行2500', '改过的行')
    const accepted = new Set(diffHunks(big, changed).filter((h) => h.kind === 'change').map((h) => h.id))
    expect(applyHunks(big, changed, accepted)).toBe(changed)
    expect(applyHunks(big, changed, new Set())).toBe(big)
  })
})
