# N15：LLM 筛选的平台发现候选（探索池重排）

日期：2026-10-05。设计见 [FEAT_LLM_DISCOVERY_FILTER](../design/FEAT_LLM_DISCOVERY_FILTER.md)。范围：`src/persona.mjs`（新用途与按用途预算）、`src/discovery.mjs`（排序戳记）、`src/core-host.mjs`（门控统一/候选事实/状态查询）、`src/persona-scheduler.mjs`（自动检查）、`src/selection.mjs`（llmBoost）、`src/insights.mjs`（理由回复）、`index.js` 与 `src/ui/dsh-settings.mjs`（手动触发）、`src/ui/client/*`（白话化）。

## 实现

- **新模型用途 `discovery-filter`**：预留时由 Core 从发现缓存取候选（带"相似于《种子歌名》/每日推荐"来源线索，上限 30 首、字节上限 2600）；模型只输出 `{summary,picks:[{i,why}]}`，完成时按预留期 `facts_json` 的索引→trackKey 映射落库 `discovery_filter_v1`；越界/重复序号丢弃，解析失败按失败记账、不落结果。
- **按用途预算**：筛选每日 12 次、15 分钟冷却，只统计本用途；总结/歌单维持 3 次/日、1 小时冷却不变。筛选不要求"自动总结"开关，沿用共享 token 预算与 busy 互斥。
- **发现缓存**：`usable()` 把筛选结果按 trackKey 戳成 `llmRank/llmReason`；`clear()` 与账号切换一并删除筛选结果。LLM 模式重新启用平台候选获取（N11 边界修订，见 DECISIONS 第 29 节），歌单核对与平台候选来源在 `discoveryStatus` 中分开呈现（`playlist` 字段）。
- **选歌**：`local-v4` 加入有界 `llmBoost`（Top1 +0.24 线性衰减），未入选候选不扣分；解释与「大肥鱼说」优先引用 LLM 的真实理由。
- **触发**：调度器每 10 分钟检查 due（有候选、无进行中调用/刷新、筛选缺失或早于最近成功刷新），最多等刷新 30 秒；设置页"刷新新歌推荐"后后台补跑一次。Core 侧每次预留都重验门控。
- **UI 白话化**：发现状态改为"正在找新歌/大肥鱼正在试听挑选/挑了 N 首合口味"；歌单徽标"已核对→可播放、not-found→网易云没有这首歌、ambiguous→同名歌太多拿不准"；选歌依据"陌生池/熟悉池→新歌/常听歌曲"，数字详情保留在折叠区。

## 验证

- `npm test`：362 项全过。新增 5 项：候选事实与越界/注入样例丢弃、按用途冷却与每日预算（且与总结互不挤占）、缓存戳记与随缓存清理、llmBoost 排序与不排空池子、llmReason 回复；更新"LLM 模式不调用平台候选"为新的召回行为断言、算法版本 local-v4、发现状态白话文案。
- `npm run check`（113 模块）、`npm run build:client`、`npm run build`（含调试冒烟）通过。

## 未验/边界

- 真实模型输出质量（挑选是否合口味）需要真实 DSH 会话验证；本轮只验证结构、预算与降级路径。
- 生产插件未重载：LLM 模式下平台候选获取、筛选调用与新文案都要随下次部署生效。
- 种子选择仍按偏好分（阶段一的本地相似图未实现）；`simi_song` 免登录不可用，未登录时发现池只有每日推荐且如实标注需要登录。
- 筛选结果不参与歌单核对；两套来源在探索池并存时按统一评分排序。
