# NovelFlow 小说写作工作台

桌面端小说写作软件：接入任意大模型（OpenAI 兼容 / Anthropic 原生协议），把写作 Skill 串成工作流（M2 起）。本项目即文件夹，设定、大纲、正文、状态各自成文件，可读可备份。

当前进度：**M1 骨架与模型接入已完成**（本仓库第一个提交）。

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

- **工程骨架**：Electron + Vite + React 18 + TypeScript + Zustand + Tailwind CSS 4；主进程/预加载/渲染进程三层隔离（contextIsolation，渲染进程无 Node 能力）
- **项目管理**：新建/打开项目（系统目录选择框），按说明书 3.1 生成完整目录结构：`novel.json`、`bible/`（00-概述、01-世界观、02-人物/、03-主线与卷纲、04-文风规范、05-时间线）、`outline/`、`chapters/`、`state/`（characters.json、foreshadowing.json、events.json）、`runs/`、`.history/`
- **模型预设管理**：任意数量预设的增删改，字段：名称/协议（openai-compatible | anthropic）/base_url/api_key/模型名/上下文长度/默认温度/最大输出；「测试连接」按钮显示成功延迟或失败原因
- **模型角色映射**：规划/写作/检查/润色 四个角色分别指向某预设
- **主进程 LLM 调用层**：流式输出（SSE，OpenAI 与 Anthropic 两种协议）；连接超时与流式空闲超时；429/5xx/超时指数退避重试（最多 3 次，1000/2000/4000ms）；随时取消；并发限制（默认 2，可在设置中修改）；流式刷新节流（默认 80ms，可配置）
- **编辑器**：CodeMirror 6，按章加载（不整书载入），3.5 秒自动保存（3–5 秒可配置），手动保存，字数统计
- **一键复制**：每章顶部「复制全文」按钮，复制后弹出「已复制 N 字」轻提示
- **安全**：API Key 仅经 Electron `safeStorage` 加密落盘（系统不支持加密时仅保存在内存并明确提示，绝不写入明文）；主进程日志统一脱敏；渲染进程永远拿不到密钥本身
- **原子写**：所有文件写入走「同目录临时文件 → rename 覆盖」，Windows EPERM/EBUSY 自动重试
- **稳定性**：渲染进程全局错误边界；主进程 `uncaughtException`/`unhandledRejection` 记录日志并保持存活；`--smoke-test` 自退出冒烟模式

## 目录结构（本仓库）

```
novelflow/
├── scripts/
│   ├── dev.mjs                   # 开发编排（vite + esbuild + electron，零额外依赖）
│   ├── build-main.mjs            # 主进程/preload esbuild 构建
│   └── mock-openai-server.mjs    # 本地 OpenAI 兼容 mock（流式/401/429/5xx/超时注入）
├── src/
│   ├── shared/types.ts           # 主/预加载/渲染 共享类型与 IPC 契约
│   ├── main/
│   │   ├── index.ts              # 主进程入口、窗口、--smoke-test
│   │   ├── logger.ts             # 脱敏日志
│   │   ├── ipc/register.ts       # 全部 IPC 注册
│   │   └── services/
│   │       ├── llm/              # adapters（双协议）/service（重试/取消/并发）/sse/throttle/concurrency/redact
│   │       ├── storage/          # atomic（原子写）/project（3.1 结构）/settings-store（加密预设）
│   │       └── secrets/          # safeStorage 封装
│   ├── preload/index.ts          # contextBridge 暴露 window.novelflow
│   └── renderer/                 # React 界面（App/编辑器/项目树/设置页/试写面板）
└── tests/                        # vitest：tests/llm（调用层）、tests/storage（存储层）
```

## 依赖与 License

运行时依赖：

| 依赖 | 版本 | 用途 | License |
| --- | --- | --- | --- |
| react / react-dom | ^18.3.1 | 渲染进程 UI 框架 | MIT |
| zustand | ^5.0.3 | 渲染进程状态管理 | MIT |
| @codemirror/state / view / commands | ^6 | 编辑器内核（增量文档、命令、历史） | MIT |
| @codemirror/lang-markdown | ^6.3.2 | Markdown 语法支持 | MIT |

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
| @types/react / react-dom / node | — | 类型声明 | MIT / MIT / MIT |

无付费或需联网安装的闭源依赖。`electron` 二进制本身为 MIT License。

## 已知局限（如实说明）

- M1 阶段编辑器为纯文本 + Markdown 高亮，查找替换、差异对比视图在后续里程碑
- 复制格式选项（网文格式等）与导出（txt/md/docx）属 M5
- 工作流运行持久化（SQLite）属 M4
- 开发模式下主进程代码修改后需重启 `npm run dev`（未做主进程热重载）
- 本仓库在 Windows 上开发与验证，macOS 未真机验证
