/**
 * 浏览器预览垫片：仅在「没有 Electron preload」的 dev 环境生效（普通浏览器打开 vite 页面）。
 * Electron 里 preload 总会注入真实 window.novelflow，本文件不做任何事；
 * 生产构建中调用处被 import.meta.env.DEV 静态短路。
 * 用途：让羊皮卷主题 UI 能在浏览器里直接预览/截图验收，无需启动桌面壳。
 * 注意：这不是功能模拟——启动必需的读取通道返回固定演示数据，其余操作明确拒绝。
 */
import type { Api, FileEntry, SkillMeta } from '../shared/types'

const demoProject = {
  dirPath: 'C:/demo/山河故梦',
  name: '山河故梦',
  genre: '都市',
  targetWords: 200000,
  createdAt: '2026-10-01T12:00:00.000Z'
}

const demoText =
  '　　雨是从黄昏时分落下来的。\n\n　　长街两侧的灯笼被风扯得东倒西歪，纸面上晕开一小片湿痕，像谁把一滴墨按进了旧年间的信纸里。沈砚收了伞，檐下的水帘便把他隔在了另一个世界外头——里头干爽、昏黄、安静，外头是整座城的潮气与灯影。\n\n　　「你来晚了。」柜台后的老者头也没抬，算盘珠子却停了一拍。\n\n　　「路上下了雨。」沈砚把湿透的信笺搁在案上，「而且不止我一人淋着——巷口停了两条船，船头都朝着咱们这边。」'

const bibleFiles: FileEntry[] = [
  { name: '00-概述.md', path: 'bible/00-概述.md', type: 'file' },
  { name: '01-世界观.md', path: 'bible/01-世界观.md', type: 'file' },
  { name: '02-人物', path: 'bible/02-人物', type: 'dir' },
  { name: '04-文风规范.md', path: 'bible/04-文风规范.md', type: 'file' }
]
const outlineFiles: FileEntry[] = [
  { name: '第1章-雨落长街.md', path: 'outline/第1章-雨落长街.md', type: 'file' },
  { name: '第2章-旧友新知.md', path: 'outline/第2章-旧友新知.md', type: 'file' }
]
const chapterFiles: FileEntry[] = [
  { name: '第1章-雨落长街.md', path: 'chapters/第1章-雨落长街.md', type: 'file' },
  { name: '第2章-旧友新知.md', path: 'chapters/第2章-旧友新知.md', type: 'file' }
]

const demoSkills: SkillMeta[] = [
  { id: 'builtin:generate-story-framework', name: '生成故事框架', description: '按类型与风格产出世界观、人物、主线大纲', version: 1, recommendedModel: 'planner', output: 'text', inputs: [], requires: [], builtin: true, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' },
  { id: 'builtin:plan-chapter', name: '章节规划', description: '依据框架生成本章目标、关键事件与结尾钩子', version: 1, recommendedModel: 'planner', output: 'text', inputs: [], requires: [], builtin: true, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' },
  { id: 'builtin:write-chapter', name: '正文写作', description: '结合上下文组装生成本章正文初稿', version: 1, recommendedModel: 'writer', output: 'rewrite', inputs: ['chapter_plan'], requires: ['chapter_plan'], builtin: true, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' },
  { id: 'builtin:proofread', name: '错别字与病句检查', description: '只修错别字、漏字、标点与明显语病，输出问题清单', version: 1, recommendedModel: 'checker', output: 'issues', inputs: [], requires: [], builtin: true, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' },
  { id: 'builtin:deai', name: '去AI味', description: '删除套话与模板句，让文字更像人写', version: 1, recommendedModel: 'polisher', output: 'rewrite', inputs: [], requires: [], builtin: true, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' },
  { id: 'builtin:polish', name: '润色', description: '保持风格，优化节奏、衔接与画面感', version: 1, recommendedModel: 'polisher', output: 'rewrite', inputs: [], requires: [], builtin: true, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' },
  { id: 'builtin:consistency-check', name: '一致性检查', description: '对照人物状态与伏笔台账检查前后矛盾', version: 1, recommendedModel: 'checker', output: 'issues', inputs: [], requires: [], builtin: true, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' },
  { id: 'builtin:state-writeback', name: '状态回写', description: '从本章正文提取人物状态变化与伏笔动向', version: 1, recommendedModel: 'checker', output: 'text', inputs: [], requires: [], builtin: true, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' }
]

const unsupported = (what: string): Promise<never> =>
  Promise.reject(new Error(`浏览器预览模式不支持「${what}」，请在 Electron 中运行`))

export function installBrowserPreviewShim(): void {
  if ((window as unknown as { novelflow?: unknown }).novelflow) return

  const api: Api = {
    project: {
      createDialog: () => unsupported('新建项目'),
      create: () => unsupported('新建项目'),
      openDialog: () => unsupported('打开项目'),
      open: () => unsupported('打开项目'),
      getCurrent: () => Promise.resolve(demoProject)
    },
    files: {
      list: (relDir) =>
        Promise.resolve(
          relDir === 'bible' ? bibleFiles : relDir === 'outline' ? outlineFiles : relDir === 'chapters' ? chapterFiles : []
        ),
      read: () => Promise.resolve(demoText),
      write: () => unsupported('保存'),
      writeWithSnapshot: () => unsupported('保存'),
      createChapter: () => unsupported('新建章节')
    },
    settings: {
      get: () =>
        Promise.resolve({
          version: 1,
          presets: [
            {
              id: 'demo-1',
              name: '本地 mock',
              protocol: 'openai-compatible',
              baseUrl: 'http://127.0.0.1:8801/v1',
              apiKeyHint: 'mock-****',
              apiKeySessionOnly: false,
              model: 'mock-model',
              contextLength: 128000,
              temperature: 0.7,
              maxOutputTokens: 4096,
              createdAt: '2026-10-01T12:00:00.000Z'
            }
          ],
          roles: { planner: 'demo-1', writer: 'demo-1', checker: 'demo-1', polisher: 'demo-1' },
          config: {
            concurrencyLimit: 2,
            streamThrottleMs: 80,
            autoSaveMs: 3500,
            theme: 'light',
            fontSize: 15,
            lineHeight: 1.9,
            copyFormat: 'plain',
            webCopyIndent: true,
            webCopyBlankLine: true
          }
        }),
      savePreset: () => unsupported('保存预设'),
      deletePreset: () => unsupported('删除预设'),
      setRoles: () => unsupported('保存角色映射'),
      setAppConfig: () => unsupported('保存配置')
    },
    llm: {
      testConnection: () => unsupported('测试连接'),
      chat: () => unsupported('模型试写'),
      cancel: () => Promise.resolve(false),
      onEvent: () => () => undefined
    },
    clipboard: {
      writeText: (text) => navigator.clipboard.writeText(text).catch(() => undefined)
    },
    export: {
      run: () => unsupported('导出')
    },
    skills: {
      list: () => Promise.resolve(demoSkills),
      get: () => Promise.resolve(null),
      importDialog: () => unsupported('导入 Skill'),
      importText: () => unsupported('导入 Skill'),
      save: () => unsupported('保存 Skill'),
      duplicate: () => unsupported('复制 Skill'),
      remove: () => unsupported('删除 Skill'),
      exportDialog: () => unsupported('导出 Skill'),
      run: () => unsupported('运行 Skill'),
      preview: () => unsupported('上下文预览'),
      cancel: () => Promise.resolve(false),
      onEvent: () => () => undefined
    },
    history: {
      list: () => Promise.resolve([]),
      read: () => unsupported('读取快照'),
      restore: () => unsupported('恢复快照')
    },
    framework: {
      applyText: () => unsupported('框架落库')
    },
    state: {
      writeback: () => unsupported('状态回写')
    },
    chapter: {
      checkGate: () => unsupported('门禁检查')
    },
    workflow: {
      list: () => Promise.resolve([]),
      save: () => unsupported('保存工作流'),
      remove: () => unsupported('删除工作流'),
      templates: () => Promise.resolve([]),
      createFromTemplate: () => unsupported('从模板创建')
    },
    runs: {
      list: () => Promise.resolve([]),
      unfinished: () => Promise.resolve(null),
      get: () => Promise.resolve(null),
      start: () => unsupported('运行工作流'),
      resume: () => unsupported('继续运行'),
      confirm: () => unsupported('确认节点'),
      retry: () => unsupported('重试节点'),
      abort: () => unsupported('中止运行')
    },
    app: {
      version: () => Promise.resolve('1.1.0 (browser preview)'),
      exportDiagnostics: () => unsupported('导出诊断')
    }
  }

  ;(window as unknown as { novelflow: Api }).novelflow = api
}
