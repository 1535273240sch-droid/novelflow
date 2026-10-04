# NovelFlow 开发计划与进度（ROADMAP）

> 更新时间：2026-10-04。本文件由战役协调者维护，随进度更新并推送，用于断点恢复。
> 需求来源：《小说写作工作台（暂名 NovelFlow）项目执行说明书》（本地桌面文档，关键内容已摘录到本文件）。
> 仓库：https://github.com/1535273240sch-droid/novelflow

---

## 一、项目是什么

桌面端小说写作软件：自定义接入任意大模型（OpenAI 兼容 / Anthropic 协议），把写作 Skill（规划、查错别字、润色、去 AI 味等）串成可复用工作流；先生成故事框架（Story Bible），后续章节强制按框架写；正文一键复制；稳定流畅不崩溃。

技术栈（固定）：Electron + Vite、React 18 + TypeScript + Zustand + Tailwind、CodeMirror 6、项目文件夹（Markdown/JSON）、better-sqlite3（M4 起）、electron-builder 打包。

---

## 二、当前进度（随提交更新）

| 里程碑 | 状态 | 提交 | 独立验证 |
|---|---|---|---|
| M1 骨架与模型接入 | ✅ 完成 | `ac64446` | ✅ auditor 独立复现 REPRODUCED（10/10 项） |
| M2 Skill 系统 | ✅ 完成 | `4613d08` | ⚠️ 本机 `npm test`(112) + `npm run build` + `--smoke-test` 全绿；独立验证待补 |
| M3 框架与上下文组装 | ⬜ 未开始 | — | — |
| M4 工作流 | ⬜ 未开始 | — | — |
| M5 打磨与打包 | ⬜ 未开始 | — | — |
| m5b 发布（CI+版本+说明） | ⬜ 未开始（仓库已建） | — | — |
| m6 终审 | ⬜ 未开始 | — | — |

### M1 已交付内容（已完成并验证）
- Electron+Vite+React18+TS 脚手架，`npm run dev` 可启动（含 `--smoke-test` 自退出冒烟）
- 项目新建/打开/保存，目录结构符合说明书 3.1（novel.json、bible/ 六件套、outline/、chapters/、state/ 三 json、runs/、.history/）
- 模型预设增删改（名称/协议/base_url/api_key/model/上下文长度/默认温度/最大输出）+『测试连接』+ 模型角色映射（规划/写作/检查/润色）
- 主进程 LLM 调用层：流式（SSE）、超时、429/5xx 指数退避重试≤3 次、取消、并发默认限 2 可配置；渲染进程零 LLM 直连
- `scripts/mock-openai-server.mjs`：零依赖 OpenAI 兼容 mock（SSE/401/429/5xx/超时注入）
- 编辑器：3.5s 自动保存、按章加载、一键复制『已复制 N 字』
- 安全：API Key 仅 safeStorage 加密落盘、日志脱敏；写文件临时文件+原子重命名
- 测试 42 用例全绿（vitest，全 mock 零真实 Key）

### M2 当前状态（已完成并推送）
8 个内置 SKILL.md（`skills/`）、`src/main/services/skills/{parser,registry,runner,vars,output}.ts`、
`storage/snapshot.ts`、`shared/diff.ts`、`renderer/components/{skills,diff}/`、`stores/skill.ts`、
`tests/skills/` 6 个测试文件。IPC / preload / App 已接线；README / DECISIONS 已更新。
验证：`npm test` 112 通过 / 0 失败、`npm run build`（tsc + vite + esbuild）通过、`--smoke-test` 输出 SMOKE_OK。
**未做**：critic 独立复跑（本次为同机自测，尚未由未参与实现的验证者重跑）。

---

## 三、执行规则（每个里程碑都必须遵守）

1. **严格串行**：M2 → M3 → M4 → M5 → m5b → m6，后一个依赖前一个。
2. **独立验证**：每里程碑由**未参与实现**的验证者（auditor/critic 轮换）重跑 `npm test`、`npm run build` 并逐条核对验收，写 `.teamwork/verifications/<id>.md`（本地工作区）。无验证记录不算完成。
3. **测试有牙**：测试断言必须来自说明书推导的期望（输入/期望都是构造好的），禁止拿实现输出当期望的同义反复。
4. **诚信模式 development**：允许捷径，但每条捷径必须记入 `DECISIONS.md`。
5. **零真实 API Key**：一切模型调用用 mock 或本地 mock server；提示词只存在于 `skills/` 目录文件，业务代码不硬编码。
6. **返工上限**：每里程碑最多 2 轮返工，之后升级人工决策。
7. 每里程碑完成 = 验收全过 + 验证记录落盘 + git 提交 + 推送到本仓库。

---

## 四、待办里程碑详情

### M2 — Skill 系统（进行中，验证者：critic）
验收要点（10 条，详见本地 plan.json m2）：
1. 导入标准 SKILL.md（YAML 头+正文）入库，可编辑/复制/导出，有版本号（编辑保存递增）
2. `{{变量}}` 替换：覆盖 `{{chapter_text}}` 与 `{{bible.文风规范}}` 两类占位符，缺变量明确报错
3. Skill 对『选中文本』/『整章』运行，结果差异视图**逐处接受/拒绝**
4. 『错别字与病句检查』输出结构化列表（位置/原文/建议），不直接改全文；畸形输出优雅降级
5. 『润色』『去AI味』前后对比可逐处接受
6. `skills/` 目录恰好 8 个内置 Skill（生成故事框架/章节规划/正文写作/错别字与病句检查/润色/去AI味/一致性检查/状态回写）
7. 改写应用前自动快照到 `.history/`（单测断言）
8. `skills/` 目录外无硬编码提示词（grep 可查）
9. `npm test` 全绿 + `npm run build` 通过（复核者重跑）
10. git 第二提交 + README/DECISIONS 更新

### M3 — 框架与上下文组装（验证者：auditor）
1. 『生成故事框架』问答界面 → 写入 bible/ 全部文件（00-概述/01-世界观/02-人物每角色一个 md/03-主线与卷纲/04-文风规范/05-时间线）
2. 『章节规划』→ outline/第NNN章.md（含目标/冲突/出场人物/伏笔/字数）
3. **门禁**：无章节计划时点『写正文』被拒绝并给引导（单测+界面双重验证）
4. **Context Builder**（说明书 3.5，六条优先级）：1 文风规范+世界观要点 → 2 本章计划 → 3 出场人物档案（按本章计划按需加载）→ 4 当前状态（人物最新状态+未回收伏笔）→ 5 前情摘要（最近 N 章，早期章节一句话摘要）→ 6 上一章结尾原文
5. token 预算：超预算按 **6→5→4→3** 顺序裁剪，**第 1–2 项永不裁剪**（单测构造固定输入断言）
6. 状态传递：写完第 1 章回写后，第 2 章上下文包含人物状态与未回收伏笔
7. 状态回写：从新章节抽取变化更新 state/ 三 json（单测断言）
8. 『查看本次实际发送的上下文』预览，与实际发送一致

### M4 — 工作流（验证者：critic）
1. 工作流=有序节点列表，节点四要素：选 Skill → 选模型 → 绑定输入（上节点输出/项目文件/手填）→ 输出去向（下一节点/写文件/仅展示）
2. 卡片列表拖拽排序（不要求画布）
3. 人工确认点：暂停查看/修改中间结果再继续
4. 三内置模板：开新书（框架→规划）/ 写一章（**7 节点**：读取章节计划→正文写作→一致性检查→错别字→润色→去AI味→状态回写）/ 精修（错别字→润色→去AI味）
5. 失败语义：停在该节点、已完成结果保留、可从此处重试
6. 运行持久化 SQLite（runs 表）；重启提示『继续上次未完成的运行』
7. **崩溃恢复集成测试**：模拟强杀→重启断点续跑且文件不损坏（复核者重跑该用例）

### M5 — 打磨与打包（验证者：auditor）
1. 导出单章/整卷/全书 → .txt/.md/.docx（docx 库注明 License）
2. 复制格式：纯文本/Markdown/网文格式（段首空两格、段间空行可配置）+『已复制 N 字』
3. `scripts/generate-seed-project.mjs` 生成 100 万字种子项目（可重复）
4. `npm run benchmark`：打开 ≤3 秒，**实测值如实记录，超阈值如实报告不得粉饰**
5. 全局错误边界 + 主进程 uncaughtException 记日志保持窗口存活 + 一键导出诊断日志
6. 外观设置：深/浅色、字体行距
7. `npm run dist` 产出 Windows 安装包；macOS 打包配置存在但**如实标注未真机验证**（本机 Windows）

### m5b — 发布（验证者：auditor；用户已确认：公开仓库 / v1.0.0）
1. `package.json` version → **1.0.0**，打 tag `v1.0.0` 并推送
2. `.github/workflows`：Windows CI（ELECTRON_MIRROR 安装依赖 → npm test → npm run build → electron-builder 出 .exe → artifact；**tag 推送触发 GitHub Release 附安装包**）
3. **详细中文使用说明**：README 扩充（安装、模型配置、Skill、工作流、导出、常见问题）+ docs/使用说明.md + LICENSE（MIT）
4. 发布前完整敏感信息扫描（token/key/绝对路径），扫描证据写入验证记录
5. 复核：`gh repo view` public、`git ls-remote` 有 tag、CI 绿、Release 有 .exe

### m6 — 终审（Success Auditor 写，Challenger 复核）
- 对照章程 7 条验收标准 + 说明书原文逐项核对（不只对照里程碑清单）
- 横切核查：零真实 Key、无硬编码提示词、License 表、每里程碑 git 提交、验证记录均非实现者所写
- 抽查重跑：npm test / build / M4 崩溃恢复用例 / M5 seed+benchmark+dist
- 产出 `.teamwork/final-audit.md`，总判定 ACHIEVED / PARTIALLY ACHIEVED / NOT ACHIEVED；未验证项如实清单（macOS 真机、用户人工冒烟）

---

## 五、环境备忘（Windows）

- shell 是 Git Bash；electron 二进制安装失败时用：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install`（详见 README）
- 常用命令：`npm test` / `npm run build` / `npm run dev` / `npx electron . --smoke-test` / `node scripts/mock-openai-server.mjs`（`--fail 429|timeout` 注入故障）
- GitHub CLI 已登录账号 `1535273240sch-droid`（本仓库所属）

## 六、断点恢复指南（电脑重启后看这里）

1. 战役状态文件在**本地工作区** `.teamwork/`：`campaign.json`（章程）、`plan.json`（里程碑+所有权+逐条验收）、`verifications/`（验证记录）。这些不随仓库分发。
2. 打开本文件看『当前进度』表确定停在哪一步。
3. 对 AI 说「继续 NovelFlow 战役」即可，让它先读 `.teamwork/campaign.json`、`plan.json` 和本文件再行动。
4. 若 `.teamwork/` 丢失：以本文件第四节为准重建章程，已验证里程碑（M1）无需返工。
