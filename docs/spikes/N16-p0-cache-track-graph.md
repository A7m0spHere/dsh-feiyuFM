# N16：P0 两项优化——画像缓存与个人相似图

日期：2026-10-05。设计见 [FEAT_P0_PROFILE_CACHE_TRACK_GRAPH](../design/FEAT_P0_PROFILE_CACHE_TRACK_GRAPH.md)。范围：`src/insights.mjs`、`src/persona.mjs`、`src/core-host.mjs`、新模块 `src/track-graph.mjs`、`src/selection.mjs`、`src/recommendation.mjs`、`src/ui/client/panel.mjs`。

## 一、画像计算缓存

UI 每 ~2.2 秒轮询 `fishfm/state`，其中 persona/insights 每次全量重算（全部曲目、全部偏好、成长任务逐条解析、`factBundle`×2、`listenEvidence` 全量），且成本随历史线性增长。拆分后：

- `describeMusicFacts(store)` 返回纯库内容重块（标题/艺人映射、偏好榜、决策表、成长任务统计）；`describeMusicInsights(store,snapshot,now,facts?)` 只做快照轻投影（回复、解释、当前曲反馈、observedStarts 去重）。
- `personaView`/`listenEvidence` 接受预取块 `{bundle,strategyBundle,growthRows,callRows}`；无缓存路径行为不变（向后兼容）。
- 宿主 `profileInputs()` 惰性构建，失效白名单：任何命令、成长回调、导入（含平台导入）、实际生效的偏好衰减、模型调用收尾、预算/开关修改、歌单核对更新。轮询路径零重算。

## 二、个人相似图

新模块 `track-graph.mjs`：边权 = `min(1, 共享歌单数×1.0 + 艺人集合 Jaccard×0.6 + 播放序列共现×0.15)`（序列取最近 400 条中相邻且间隔 <30 分钟的对，单对上限 3）；倒排索引建边，惰性构建、失效整体重建（与画像缓存同一失效白名单）。`artistKeys` 移入该模块，`recommendation.mjs` 转出复用，避免循环引用。

两处消费：
- **种子选择**：`selectRecommendationSeeds` 得分加 `0.15×归一化图中心度`——度数高的种子能从 `simi_song` 引回一整簇相关候选。
- **选歌评分**（local-v5）：`graphAffinity` = 与最近 5 首自然听完歌曲的平均相似度 × 0.06，与多样性惩罚方向互补；选歌依据面板以"与最近常听歌曲的相近度"白话展示。

## 验证

- `npm test`：367 项全过。新增 5 项：图三类边权与度数、种子枢纽优先、选歌 graphAffinity 有界加成、图缓存惰性重建、宿主轮询查询计数（第二轮 persona+insights 重查询 ≤4）与命令/导入失效即时反映；更新算法版本断言 local-v5。
- `npm run check`（115 模块）、`npm run build:client`、`npm run build` 通过。

## 未验/边界

- 真实曲库（549 首/1260 偏好）上的图构建耗时与轮询 CPU 改善幅度，待生产重载后按 N7 观察口径核对。
- 播放序列边随历史增长缓慢增强；参数（0.15/0.06/0.15×中心度）为首版有界值，按长期体验再调。
- 生产插件未重载。
