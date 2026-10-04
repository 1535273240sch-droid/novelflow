# NovelFlow 小说写作工作台

桌面端小说写作软件：接入任意大模型（OpenAI 兼容 / Anthropic 原生协议），把写作 Skill 串成工作流（M2 起）。本项目即文件夹，设定、大纲、正文、状态各自成文件，可读可备份。

当前进度：**M1–M5 已完成**（骨架与模型接入 / Skill 系统 / 框架与上下文组装 / 工作流 / 打磨与打包）。

## 如何运行

要求：Node.js >= 20（开发时使用 Node 24 验证）、npm。

```bash
cd novelflow
npm install          # 若 electron 二进制下载失败，可设镜像后重试：
                     #   ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

npm run dev          # 启动开发模式（vite dev server + Electron 窗口）
npm test             # 运行全部单元测试（vitest，全 mock，不需要真实 API Key）
npm run build        # typecheck（tsc --noEmit）+ 渲染进程构建 + 主进程/preload 构建
npm run mock         # 启动本地 OpenAI 兼容 mock 服务（默认 http://127.0.0.1:8801）
npm start            # 以生产模式启动 Electron（需先 npm run build）
```

### 用本地 mock 服务联调（不需要任何真实 Key）

1. 终端 A：`npm run mock`（监听 `http://127.0.0.1:8801`）
2. 终端 B：`npm run dev`
3. 在应用中：设置 → 模型预设 → 新建预设 → 点「填入 mock」自动填 base_url 与模型名 → 保存 → 点「测试连接」（应显示成功与延迟）
4. 打开或新建一个正文章节 → 右栏「模型试写」输入任意提示 → 开始生成 → 结果流式追加进编辑器，可随时「取消」
5. 失败路径验证：预设 base_url 故意写错（如 `http://127.0.0.1:1/v1`）→ 测试连接显示「无法连接」；或给 mock 传 `--fail 429 --fail-times 2`、`--fail timeout`、`--key xxx` 模拟限流/超时/401

### mock 服务参数

```bash
node scripts/mock-openai-server.mjs [--port 8801] [--key secret123] \
  [--fail 429|500|503|timeout] [--fail-times 2] [--hang-ms 30000] \
  [--chunk-delay-ms 30] [--stream-chars 8]
```
也支持环境变量 `MOCK_PORT / MOCK_API_KEY / MOCK_FAIL_MODE / MOCK_FAIL_TIMES / MOCK_HANG_MS / MOCK_CHUNK_DELAY_MS`。

## 已完成功能（M1）

- **工程骨架**：Electron + Vite + React 18 + TypeScript + Zustand + Tailwind CSS 4；主进程/预加载/渲染进程三层隔离（contextIsolation，渲染进程无 Node 能力）- **项目管理**：新建/打开项目（系统目录选择框），按说明书 3.1 生成完整目录结构：`novel.json`、`bible/`（00-概述、01-世界观、02-人物/、03-主线与卷纲、04-文风规范、05-时间线）、`outline/`、`chapters/`、`state/`（characters.json、foreshadowing.json、events.json）、`runs/`、`.history/`
- **模型预设管理**：任意数量预设的增删改，字段：名称/协议（openai-compatible | anthropic）/base_url/api_key/模型名/上下文长度/默认温度/最大输出；「测试连接」按钮显示成功延迟或失败原因
- **模型角色映射**：规划/写作/检查/润色 四个角色分别指向某预设
- **主进程 LLM 调用层**：流式输出（SSE，OpenAI 与 Anthropic 两种协议）；连接超时与流式空闲超时；429/5xx/超时指数退避重试（最多 3 次，1000/2000/4000ms）；随时取消；并发限制（默认 2，可在设置中修改）；流式刷新节流（默认 80ms，可配置）
- **编辑器**：CodeMirror 6，按章加载（不整书载入），3.5 秒自动保存（3–5 秒可配置），手动保存，字数统计
- **一键复制**：每章顶部「复制全文」按钮，复制后弹出「已复制 N 字」轻提示
- **安全**：API Key 仅经 Electron `safeStorage` 加密落盘（系统不支持加密时仅保存在内存并明确提示，绝不写入明文）；主进程日志统一脱敏；渲染进程永远拿不到密钥本身
- **原子写**：所有文件写入走「同目录临时文件 → rename 覆盖」，Windows EPERM/EBUSY 自动重试
- **稳定性**：渲染进程全局错误边界；主进程 `uncaughtException`/`unhandledRejection` 记录日志并保持存活；`--smoke-test` 自退出冒烟模式

## 已完成功能（M2：Skill 系统）

- **标准 SKILL.md 库**：`skills/` 目录内置 8 个 Skill（生成故事框架 / 章节规划 / 正文写作 / 错别字与病句检查 / 润色 / 去AI味 / 一致性检查 / 状态回写），YAML 头 + 正文；首次运行 seed 到用户目录，可**编辑 / 复制 / 导入 / 导出 / 删除**，编辑保存后**版本号递增**
- **变量替换**：`{{chapter_text}}`、`{{selection}}` 等顶层变量与 `{{bible.文风规范}}` 项目文件变量；**缺变量明确报错**并点名，不静默留空
- **对「整章」/「选中文本」运行**：结果按类型呈现——改写类走**差异视图逐处接受 / 拒绝**；检查类输出**结构化问题清单**（位置 / 原文 / 建议）逐条接受，**不直接改全文**
- **检查类结构化工单**：模型输出畸形（加解释、半截 JSON、非 JSON）时**优雅降级**为纯文本，不崩溃
- **改写应用前自动快照**：写入前把原文落到项目 `.history/`，支持列举 / 查看 / 还原
- **提示词零硬编码**：所有提示词只存在于 `skills/` 目录，业务代码不含任何提示词（有结构化测试守卫）

### 用 Skill 联调（不需要真实 Key）

1. 终端 A：`npm run mock`；终端 B：`npm run dev`
2. 设置页添加预设（base_url `http://127.0.0.1:8801/v1`，模型 mock-model）
3. 左栏新建/打开正文章节 → 右栏「Skill」标签 → 选「润色」→ 运行 → 逐处接受后「应用」
4. 顶栏「Skill 库」可查看/编辑 8 个内置 Skill 与导入外部 SKILL.md

## 已完成功能（M3：框架与上下文组装）

- **故事框架问答落库**：顶栏「故事框架」→ 填灵感/题材/目标字数 → 生成 → 一键写入 `bible/`（00-概述、01-世界观、02-人物/<角色>.md、03-主线与卷纲、04-文风规范、05-时间线）；模型漏节时不覆盖既有文件
- **章节规划**：`plan-chapter` 产出写入 `outline/第NNN章.md`
- **写正文门禁**：没有本章计划时点「写正文」被**拒绝**并给出可执行引导（界面与单测共用主进程同一实现）
- **Context Builder（说明书 3.5，六条优先级）**：① 文风规范+世界观要点 → ② 本章计划 → ③ 出场人物档案（按本章计划按需加载）→ ④ 当前状态（人物最新状态+未回收伏笔）→ ⑤ 前情摘要（最近 N 章原文，更早章节一句话摘要）→ ⑥ 上一章结尾原文
- **token 预算**：超预算按 **6→5→4→3** 顺序裁剪，**第 1–2 项永不裁剪**（单测构造固定输入断言）
- **状态回写与传递**：从新章节抽取变化合并进 `state/` 三个 json（幂等）；下一章上下文自动带上人物状态与未回收伏笔
- **上下文预览**：「预览上下文」展示本次**实际发送**的变量与完整提示词，与实际发送一致

## 已完成功能（M4：工作流）

- **节点卡片工作流**：工作流 = 有序节点列表，节点四要素可编辑——**选 Skill → 选模型 → 绑定输入（上节点输出 / 项目文件 / 手填）→ 输出去向（下一节点 / 写文件 / 仅展示）**；卡片可**拖拽排序**（不要求画布）
- **人工确认点**：节点可标记为确认点，执行到此暂停，可查看并**修改中间结果**再继续（修改未确认前不落盘）
- **三个内置模板**：开新书（框架→规划）、写一章（**7 节点**：读取章节计划→正文写作→一致性检查→错别字→润色→去AI味→状态回写）、精修（错别字→润色→去AI味）；内置模板只读，可一键复制为可编辑副本
- **失败语义**：停在该节点、已完成结果保留、**可从此节点重试**（后续节点保持待运行）
- **运行持久化 SQLite**：项目内 `runs/runs.db`（`runs` + `run_nodes` 两张表）；重启后提示「**继续上次未完成的运行**」
- **崩溃恢复**：节点状态逐步落库，进程在节点执行中被强杀后，重启 resume 会重跑中断节点、保留已完成节点，文件写入走原子写不损坏（有集成用例）
- **检查类不污染文本流**：错别字/一致性检查的输出只用于展示，文本流原样传递给下一节点

## 已完成功能（M5：打磨与打包）

- **导出**：单章 / 整卷（章节号范围）/ 全书 → `.txt` / `.md` / `.docx`（docx 用 `docx` 库，MIT）
- **复制格式**：纯文本 / Markdown / 网文格式（段首空两格、段间空行可配置）+「已复制 N 字」
- **种子项目**：`npm run seed` 生成 ~100 万字（默认 200 章 × 5000 字）确定性种子项目，可重复
- **启动基准**：`npm run benchmark` 实测冷启动到首屏（SMOKE_OK），阈值 3000ms，实测值写入 [docs/实测基准.md](docs/实测基准.md)
- **外观设置**：深/浅色主题、编辑器字号与行距
- **诊断**：全局错误边界 + 主进程 `uncaughtException` 记日志保持存活；设置页「一键导出诊断日志」（已脱敏）
- **打包**：`npm run dist` 出 Windows NSIS 安装包（`release/`）；`npm run dist:mac` 的 macOS 打包配置存在，但**未在 macOS 真机验证**（本机为 Windows，如实标注）

### 常用命令

```bash
npm test              # 单元测试（全 mock）
npm run seed          # 生成 ~100 万字种子项目（默认 ./seed-novel）
npm run benchmark     # 冷启动基准，结果写入 docs/实测基准.md
npm run dist          # Windows 安装包 → release/
```

## 目录结构（本仓库）

```
novelflow/
├── skills/                       # 8 个内置 Skill（SKILL.md：YAML 头 + 提示词正文）
├── scripts/
│   ├── dev.mjs                   # 开发编排（vite + esbuild + electron，零额外依赖）
│   ├── build-main.mjs            # 主进程/preload esbuild 构建
│   └── mock-openai-server.mjs    # 本地 OpenAI 兼容 mock（流式/401/429/5xx/超时注入）
├── src/
│   ├── shared/types.ts           # 主/预加载/渲染 共享类型与 IPC 契约
│   ├── shared/diff.ts            # 行级差异（逐处接受/拒绝）纯函数
│   ├── main/
│   │   ├── index.ts              # 主进程入口、窗口、--smoke-test
│   │   ├── logger.ts             # 脱敏日志
│   │   ├── ipc/register.ts       # 全部 IPC 注册
│   │   └── services/
│   │       ├── llm/              # adapters（双协议）/service（重试/取消/并发）/sse/throttle/concurrency/redact
│   │       ├── skills/           # parser（SKILL.md）/registry（版本与增删改）/runner（上下文与调用）/vars/output
│   │       ├── storage/          # atomic（原子写）/project（3.1 结构）/settings-store（加密预设）/snapshot（.history）
│   │       └── secrets/          # safeStorage 封装
│   ├── preload/index.ts          # contextBridge 暴露 window.novelflow
│   └── renderer/                 # React 界面（App/编辑器/项目树/设置页/试写面板/Skill 库/差异视图）
└── tests/                        # vitest：tests/llm、tests/storage、tests/skills
```

## 依赖与 License

运行时依赖：

| 依赖 | 版本 | 用途 | License |
| --- | --- | --- | --- |
| react / react-dom | ^18.3.1 | 渲染进程 UI 框架 | MIT |
| zustand | ^5.0.3 | 渲染进程状态管理 | MIT |
| @codemirror/state / view / commands | ^6 | 编辑器内核（增量文档、命令、历史） | MIT |
| @codemirror/lang-markdown | ^6.3.2 | Markdown 语法支持 | MIT |
| docx | ^9.0.0 | 导出 .docx（M5） | MIT |

开发依赖：

| 依赖 | 版本 | 用途 | License |
| --- | --- | --- | --- |
| electron | ^36.0.0 | 桌面壳（MIT） | MIT |
| vite | ^6.2.0 | 渲染进程构建/dev server | MIT |
| @vitejs/plugin-react | ^4.3.4 | React Fast Refresh | MIT |
| typescript | ^5.7.3 | 类型检查 | Apache-2.0 |
| tailwindcss / @tailwindcss/vite | ^4.1.4 | 原子化样式 | MIT |
| esbuild | ^0.25.0 | 主进程/preload 打包 | MIT |
| vitest | ^3.0.8 | 单元测试 | MIT |
| electron-builder | ^25.0.0 | 打包安装包（M5） | MIT |
| @types/react / react-dom / node | — | 类型声明 | MIT / MIT / MIT |

无付费或需联网安装的闭源依赖。`electron` 二进制本身为 MIT License。

## 已知局限（如实说明）

- M1 阶段编辑器为纯文本 + Markdown 高亮，查找替换、差异对比视图在后续里程碑
- 复制格式选项（网文格式等）与导出（txt/md/docx）属 M5
- 工作流运行持久化（SQLite）属 M4
- 开发模式下主进程代码修改后需重启 `npm run dev`（未做主进程热重载）
- 本仓库在 Windows 上开发与验证，macOS 未真机验证
