# N17：P1——数据保留、A09 口径与悬浮条错误可见性

日期：2026-10-05。范围：`src/storage.mjs`（迁移 v11 + 清理方法）、`src/core-host.mjs`（维护钩子）、`src/ui/client/floating.mjs`、`src/ui/client/controller.mjs`、`docs/MVP.md`、`docs/PROJECT_PLAN.md`、`AGENTS.md`。

## 一、数据保留（P1-3）

- 迁移 v11：`processed_commands(processed_at)` 与 `growth_jobs(processed_at)` 两条索引。
- `pruneProcessedCommands` / `pruneCompletedGrowthJobs`：两类行只留 30 天；**未完成**的成长任务保留（崩溃后重放依赖），`listen_history` 是听歌正史不清理。维护节拍顺带执行，至多每小时一次，清理量 >0 时使画像缓存失效并记 `maintenance-prune` 日志。
- 核实更正：runtime evidence 报告本就有界（事件上限 2000、单文件覆写），此前"日志无限增长"的判断不成立，不需要轮转——记录在此避免误传。

## 二、A09 验收口径（P1-4）

MVP A09 从"新增 LLM 请求为 0"细化为"**逐曲执行**零模型请求；计划内低频调用（画像总结、模型歌单、发现候选筛选）不受此限，但必须受开关/冷却/每日上限约束并全部入账本"。同步 PROJECT_PLAN A09 行与 AGENTS 实现边界规则。修订原因：N15 的候选筛选是用户确认的计划内调用，旧口径会把它误判为违规。**A09 维持未通过**——真实两小时与 DSH 请求/上下文对照仍缺，需要真实宿主参与（本轮无法代替）。

## 三、悬浮条错误可见与连接语义（P1-5）

- 悬浮抽屉新增错误提示（role=alert），按钮与主面板一致：LLM 无候选→「重新核对歌单」，服务在线→「刷新状态」，断连→「重新连接」——此前悬浮条操作失败必须打开主面板才知道原因。
- controller 连接语义修正：只有传输层失败或 `core_unavailable`（Core 不可达）才标记"连接中断"；带 code 的业务/内部错误说明 Core 有应答，服务保持在线。修复此前未知错误码（如 internal）误报断连的问题。

## 验证

- `npm test`：370 项全过。新增 3 项：保留清理（新旧行区别、未完成保留、正史不清理）、未知错误码保持在线/Core 不可达断连、悬浮抽屉错误可见与核对入口；迁移版本断言随 v11 更新。
- `npm run check`（115 模块）、`npm run build:client`、`npm run build`、`npm run audit:acceptance`（10/10、0 失效链接）通过。

## 未验/边界

- 30 天保留窗口是首版值；真实库上的清理量与耗时待生产重载后按维护日志核对。
- A09 真实两小时运行需要用户参与的真机长跑，本轮只完成口径与工具准备。
- 悬浮条错误提示在真实宿主的视觉/键盘行为未现场验证（生产插件未重载）。
