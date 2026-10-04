# DECISIONS — 技术取舍记录

按说明书第 7 节工作规则：不确定的需求优先选更简单、更稳的实现，并在此记录。development 诚信模式下允许的捷径均列于文末「捷径清单」。

## 1. 编辑器选型：CodeMirror 6（说明书允许 TipTap 或 CodeMirror 6 二选一）

- CodeMirror 6 按文档增量更新，长章节性能好、包体小；小说写作本质是纯文本/轻 Markdown，不需要 TipTap（ProseMirror）的富文档模型。
- Markdown 高亮用官方 `@codemirror/lang-markdown`；未引入 `codemirror` 聚合包，只显式依赖 state/view/commands，减少依赖面。
- 流式输出与按章加载都通过「整文档替换 + 相等性守卫」同步，实现简单且无回环。

## 2. 测试框架：Vitest

- 与 Vite 同一生态，零配置解析 TS；`vitest.config.ts` 独立于 `vite.config.ts`，互不干扰。
- 版本选 vitest 3（peer 兼容 vite 6；vitest 2 只支持 vite 5）。

## 3. 构建与开发编排：自写 scripts/dev.mjs、scripts/build-main.mjs，不用 electron-vite / concurrently

- 主进程与 preload 用 esbuild 打包为 CJS（`external: ['electron']`），输出 `dist-electron/`；渲染进程走标准 vite（`base: './'` 以支持生产 `file://` 加载）。
- dev.mjs 直接用 vite 的 JS API 起 dev server、esbuild 构建主进程、再 spawn electron 并注入 `VITE_DEV_SERVER_URL`——替代 concurrently + wait-on + cross-env 三个依赖，且跨平台可靠（不走 `npx` shell 解析）。
- 代价：主进程代码改动需重启 dev（无 watch 热重载）。M1 认为可接受，后续里程碑如痛点明显再加 esbuild context watch。

## 4. Tailwind CSS 4（含 @tailwindcss/vite 插件）

- 说明书要求 Tailwind。选 v4 的 CSS-first 接法：`@import 'tailwindcss'` + vite 插件，省去 postcss.config 与 tailwind.config，配置面最小。

## 5. base_url 规范化规则

- OpenAI 兼容地址约定：末尾已带 `/vN` → 追加 `/chat/completions`；已带动作路径 → 原样；否则补 `/v1/chat/completions`。无协议前缀默认补 `http://`。
- Anthropic 同理（`/v1/messages`），默认 base_url 为 `https://api.anthropic.com`。
- 兼容 Ollama/LM Studio（它们本质是 `http://host:port/v1`）。

## 6. 重试语义：仅在「尚未收到任何内容」时重试，且连接类错误不重试

- 429/5xx/超时 → 指数退避重试，最多 3 次（共 4 次尝试），间隔 1000/2000/4000ms（上限 15s，无抖动以便测试断言）。
- 已收到流式内容后出错**不重试**——避免内容重复拼接；错误连同已收文本一起上抛（对应说明书「流中断时保留已收到内容」，续写功能后续里程碑再做）。
- ECONNREFUSED 等连接错误**不重试**，快速失败并给出可读原因（重试对配置错误只是浪费时间）。
- 「测试连接」永远单次尝试，失败即刻显示原因。

## 7. 超时拆分：连接超时（默认 30s）+ 流式空闲超时（默认 60s）

- 连接超时覆盖「发出请求 → 收到响应头」；空闲超时覆盖流式过程中「上一次收到数据 → 下一次」的间隔。不设整体硬超时，长章节生成不会被误杀。
- 两者均可按请求覆盖（单测用小值）。

## 8. 流式刷新节流：默认 80ms（约 50–100ms 区间），推「全量快照」而非增量

- 主进程对 delta 做节流（ThrottledEmitter：首帧立即 + 尾随定时帧），向渲染进程发送「到目前为止的完整文本」。渲染端直接整体替换，无状态累积错位问题；事件丢失（缓冲回放前的乱序）也无损。
- 代价：长章生成时每次 IPC 负载随文本线性增长。M1 章节规模下可接受，M4 若成瓶颈再改为增量协议。

## 9. 并发限制：Semaphore 实现于 LLM 服务层，默认 2，设置页可改

- 渲染进程设置页可配置 1–8；保存后实时 `updateConfig`。等待队列中的请求也可被取消（acquire 接受 AbortSignal）。
- 单测断言默认 2 与自定义 3 的最大并发数，全 mock。

## 10. API Key 安全

- 密钥经 Electron `safeStorage` 加密（`enc:v1:` 前缀 + base64）后写入 `userData/settings.json`；渲染进程只能拿到 `apiKeyHint`（如 `sk-***abcd`），永远拿不到密钥本身。
- 系统不支持加密（部分 Linux）时：**拒绝明文落盘**，密钥仅保留在主进程内存（本次会话有效），UI 显式提示「Key 仅本次会话有效」。
- 明文密钥在主进程内存中只出现于解密瞬间，并全部注册进日志脱敏器（Redactor），任何日志输出前统一替换 `***`。

## 11. 原子写与 Windows 重试

- `atomicWriteFile`：同目录写 `.{name}.{uuid}.tmp` → `fs.rename` 覆盖。同目录保证同一文件系统，rename 原子生效。
- Windows 上 rename 遇 EPERM/EBUSY（杀毒/索引服务占用）按 50ms×n 重试最多 5 次，最终失败清理临时文件。
- 单测直接 spy `fs.promises.rename` 断言走临时文件路径，并断言无 `.tmp` 残留、并发写结果完整。

## 12. 字数统计口径：「去空白字符后的长度」

- 「已复制 N 字」与状态栏字数均为 `content.replace(/\s/g, '').length`，与网文平台常用口径一致。

## 13. 自动保存默认 3.5 秒，可配置（3–5 秒区间在 UI 提示中体现）

- 定时器在编辑器面板挂载；`dirty` 且已打开章节才写盘；保存走原子写。切换章节前也自动保存。

## 14. IPC 事件早于 callId 返回的竞态处理

- `llm:chat` 的 invoke 返回 callId 之前，主进程可能已发出事件。渲染进程 store 先缓冲事件（上限 100 条），拿到 callId 后回放。因事件是全量快照语义，回放无损。

## 15. 项目创建语义：目录中已有 novel.json 则拒绝，否则合并创建

- 不强制目录为空：用户选中的目录可能已有个别文件；只拦截「已是项目」的情况，避免覆盖。`.history/`、`runs/` 等目录一定创建。

## 16. 「模型试写」面板不内置任何提示词

- M1 的流式演示由用户自行输入提示；按说明书第 7 节，所有 LLM 提示词自 M2 起放 `skills/` 目录，业务代码零硬编码。试写结果流式追加到当前打开的正文章节末尾。

## 17. `--smoke-test` 自退出冒烟

- 主进程识别 `--smoke-test`：窗口 `did-finish-load` 后 1.5s 打印 `SMOKE_OK` 并退出；25s 超时打印 `SMOKE_TIMEOUT` 退出码 1。供无头环境验证「Electron 能启动且渲染进程加载完成」。

## 18. mock server 参数与故障注入

- 纯 Node http 实现（零依赖）。`--fail 429|500|503|timeout` + `--fail-times` 全局注入，或查询参数 `?fail=...&times=...` 临时覆盖；`--key` 启用 Bearer 校验以测 401；`--hang-ms` 控制超时挂起时长；`--chunk-delay-ms`/`--stream-chars` 控制流式节奏。中文按「码点」切片，保证每片都是合法 UTF-8。

## 19. SKILL.md 头部：自写最小 YAML 子集，不引第三方 YAML 依赖

- 只支持 `key: value`、内联数组、块状列表与双引号转义；不支持锚点、多行折叠、嵌套映射。
- 理由：README 明确「无闭源依赖」，且 Skill 头部是本项目自定义的固定 schema，用不到的语法不实现。代价已在 `parser.ts` 注明。
- 头部损坏或正文为空时明确抛 `SkillParseError`，单个坏文件只从列表移除，不影响其余。

## 20. Skill 库落盘位置：随包 `skills/` → 首次 seed 到 `userData/skills`

- 内置 8 个 Skill 随仓库分发（`skills/*.md`），首次运行复制到用户目录；用户编辑/新增/导入都发生在用户目录，升级不覆盖。
- `builtin` 标记由「id 是否出现在仓库 skills/ 目录」实时判定，因此编辑内置 Skill 后仍显示「内置」，但版本号递增、内容以用户版本为准。
- `createdAt/updatedAt` 存同目录 `.{id}.meta.json` sidecar，避免往 SKILL.md 契约里塞私有字段。

## 21. 差异算法：行级 LCS，超长文本退化整块替换

- `src/shared/diff.ts` 为纯函数，主/渲染共用、可直接单测。行数超过 4000 时退化为「保留首尾公共行 + 中间整块替换」，避免 O(n·m) 卡死。
- 逐处接受/拒绝的依据是「连续非 equal 行」聚合出的 change 块 id；重建时 equal 恒取原文，change 取接受侧。

## 22. 结构化输出解析：四级阶梯 + 优雅降级

- 顺序：严格 JSON（数组或 `{issues:[]}`）→ 从混杂文本抠平衡数组 → 行式 `原文 → 建议` → 降级为纯文本（`degraded=true`）。
- 数组内出现畸形元素不作为半截清单使用，而是继续降级；降级不抛异常，界面展示原始输出并提示。

## 23. 「对选中文本运行」用编辑器偏移量精确拼接

- CodeMirror 选区变化上报文本与 `from/to` 偏移；应用改写时按偏移拼回完整文件，避免「同名片段被替换到错误位置」。
- 偏移失效（文档已被编辑）时退化为「替换首个完全匹配的选区文本」。

## 24. Context Builder 的裁剪是「整段裁剪」而非「截断内容」

- 超预算时按 6→5→4→3 顺序**整段丢弃**骨架段（6 上一章结尾、5 前情摘要、4 当前状态、3 人物档案），1–2 永不裁剪。
- 理由：整段丢弃的边界清晰、可断言（单测直接断言 `droppedKeys` 顺序），且不会产出半截人物档案这类更糟的结果。代价是粒度较粗，M5 若需要可加「段内按句裁剪」。
- token 估算用启发式（约 1.5 字符 / token），只用于**相对比较**，不追求与具体 tokenizer 一致。

## 25. 写作门禁 = 主进程显式检查，界面与单测共用一条路径

- 「没有章节计划不许写正文」做成 `context/gates.ts` 的 `requireChapterPlan`，由 IPC（界面）与 SkillRunner（运行路径）共同调用，Skill 用 `requires: [chapter_plan]` 声明依赖。
- 理由：如果只在界面拦，单测就测不到；只在运行路径拦，界面就无从给引导。两条路走同一函数，才不是假保护。
- 状态回写做成**增量合并 + 幂等**（同文本伏笔、同摘要事件不重复登记），因为工作流会重跑节点（M4）。

## 26. Skill 的 `writes_to` 决定产物去向（数据驱动，而非硬编码 Skill 名）

- 取值 `chapter`（进差异视图）/ `outline`（写章节计划）/ `bible`（落库故事框架）/ `state`（合并状态）。
- 理由：避免在渲染层用 `if (skillId === 'plan-chapter')` 这种硬编码分支；新增 Skill 只要声明 `writes_to` 就能被界面正确处理。
- `generate-story-framework` 另有独立问答页（FrameworkPage），因为它需要结构化问答输入，不适合通用的「对选中文本运行」面板。

## 捷径清单（development 诚信模式）

1. **设置存 JSON 而非 SQLite**：运行记录/索引类需求 M4 才上 better-sqlite3；m1 的 settings.json 原子写足够。
2. **主进程无 watch 热重载**：dev 模式改主进程代码需重启（见第 3 条）。
3. **流式推全量快照**：实现换稳健，长文本负载优化推迟（见第 8 条）。
4. **流中断自动续写未实现**：M1 只保证保留已收内容并报错；「允许续写」留待后续里程碑。
5. **圣经（bible/02-人物/）暂无角色模板文件生成**：只建目录；人物模板函数已备（templates.ts 的 characterTemplate），M3 生成故事框架时使用。
6. **novel.json 的 modelPresetId 字段预留**：M1 界面未提供绑定入口（角色映射已覆盖 M1 需求），字段与 IPC（project:updateMeta）已就位。
7. **渲染进程「窗口关闭前强制保存」未做**：依赖 3.5 秒自动保存兜底；宽限期保存属 M5 打磨范畴。
8. **Electron 36 二进制安装**：npm postinstall 曾因网络失败，本机用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` + 手动解压修复；README 已写明镜像用法（环境问题，非代码捷径，如实记录）。
9. **Skill 运行不落 runs/ 运行记录**：M2 只做「运行 + 应用 + 快照」，运行历史的 SQLite 持久化属 M4（见第 20 条与 ROADMAP M4）。
10. **差异视图只做行级**：不做到字符级内联高亮；网文以段落/句子为改动单位，行级足够（M5 若需要再增强）。
11. **「生成故事框架」「章节规划」等 Skill 依赖尚未由界面装配的上下文变量**：M2 阶段这些 Skill 可运行但需要调用方提供相应变量（如 `premise`、`chapter_plan`）；完整上下文装配与门禁属 M3。
12. **主进程未做 Skill 运行并发隔离**：与 LLM 共用同一 Semaphore（默认 2），M2 足够。
