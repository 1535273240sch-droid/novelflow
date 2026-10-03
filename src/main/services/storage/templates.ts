/**
 * 新建项目时写入的初始文件模板（内容与说明书 3.1 一一对应）。
 */

export interface NovelMeta {
  version: number
  name: string
  genre: string
  targetWords: number
  /** 当前使用的模型预设 id（m1 暂不绑定，预留字段） */
  modelPresetId: string | null
  createdAt: string
  updatedAt: string
}

export function novelJson(name: string, genre: string, targetWords: number): NovelMeta {
  const now = new Date().toISOString()
  return {
    version: 1,
    name,
    genre,
    targetWords,
    modelPresetId: null,
    createdAt: now,
    updatedAt: now
  }
}

export const BIBLE_FILES: Array<{ name: string; content: string }> = [
  {
    name: '00-概述.md',
    content: `# 概述

<!-- 一句话梗概、题材、主题、基调、目标读者 -->

## 一句话梗概

（待填写）

## 题材

（待填写）

## 主题

（待填写）

## 基调

（待填写）

## 目标读者

（待填写）
`
  },
  {
    name: '01-世界观.md',
    content: `# 世界观

<!-- 世界设定、力量体系、社会结构、重要地点与组织 -->

（待填写）
`
  },
  {
    name: '03-主线与卷纲.md',
    content: `# 主线与卷纲

<!-- 核心冲突、主线走向、分卷规划 -->

## 主线

（待填写）

## 卷纲

### 第一卷

（待填写）
`
  },
  {
    name: '04-文风规范.md',
    content: `# 文风规范

<!-- 人称、句式、禁用词、示例段落 -->

## 人称与视角

（待填写）

## 句式偏好

（待填写）

## 禁用词

（待填写）

## 示例段落

（待填写）
`
  },
  {
    name: '05-时间线.md',
    content: `# 时间线

<!-- 大事记：时间 → 事件 → 涉及人物 -->

| 时间 | 事件 | 涉及人物 |
| --- | --- | --- |
| （待填写） | | |
`
  }
]

export function characterTemplate(name: string): string {
  return `# ${name}

<!-- 每个角色一个 .md：身份、外貌、性格、目标、口癖、人物弧线 -->

## 身份

（待填写）

## 性格

（待填写）

## 目标与动机

（待填写）
`
}

export const STATE_TEMPLATES: Record<string, unknown> = {
  'characters.json': { version: 1, characters: [] },
  'foreshadowing.json': { version: 1, items: [] },
  'events.json': { version: 1, events: [] }
}
