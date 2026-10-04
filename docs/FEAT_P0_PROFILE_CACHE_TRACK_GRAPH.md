# FEAT：P0 两项优化——画像缓存与个人相似图

日期：2026-10-05。用户确认的 P0 批次。两项相互独立，分别提交。

## 一、画像计算缓存（保流畅）

**问题**：UI 每 2.2 秒轮询 5 个 RPC；其中 `insights`/`persona` 每次全量重算——`describeMusicInsights` 遍历全部曲目（549）、全部偏好（1260）、最近 2000 条成长任务并逐条 JSON 解析，`personaView` 再把 `factBundle`（两次）与 `listenEvidence`（全量成长任务）各做一遍。每次轮询 ≈ 数千条 SQLite 查询 + 数 MB JSON 解析，且随历史增长线性恶化。

**原则**：特征预计算、请求时只读（Feast 等 feature store 的单机极简版）。

**设计**：
- `insights.mjs` 拆分：新增 `describeMusicFacts(store)` 返回重 DB 块（曲目标题/艺人映射、偏好榜、成长任务解析、统计、决策表）；`describeMusicInsights(store,snapshot,now,facts=null)` 只做轻量的快照投影（回复、解释、当前曲反馈、observedStarts 去重）。
- `persona.mjs`：`personaView(store,snapshot,now,cached=null)` 与 `listenEvidence` 接受预取的 `{bundle,strategyBundle,growthRows,callRows}`；无缓存时行为与现在完全一致（向后兼容）。
- `core-host.mjs` 持有缓存：`profileInputs()` 惰性构建上述四件，失效事件显式触发——任何命令、成长回调、导入、衰减实际改动、总结完成、歌单核对更新。轮询路径零重算。

**验收**：同一轮询周期内第二次 `persona`/`insights` 不再产生重查询；反馈/成长/导入后画像立即反映变化；全部既有测试语义不变。

## 二、个人相似图（提质量）

**问题**：探索质量上限在 `simi_song` 种子选择（现仅按偏好分挑 3 个）；熟悉池评分没有"与最近常听歌曲的关联"项；歌单共现（`environment_sources.source_ref`）一直存而未用。

**原则**：ItemKNN / 歌单共现（MPD 挑战方案）、小数据下简单 KNN 优于深度模型（Hidasi & Czapp 评估）。

**设计**（新模块 `src/track-graph.mjs`）：
- 边权 = `min(1, 共享歌单数×1.0 + 艺人集合 Jaccard×0.6 + 播放序列共现×0.15)`；序列边取最近 400 条播放记录中间隔 <30 分钟的相邻对（每对上限 3 次）。
- 倒排索引构建，只在实际共享歌单/艺人的曲目间建边；缓存实例惰性重建，失效事件同缓存一。
- 用途 1——**种子选择**（`selectRecommendationSeeds`）：得分加 `0.15 × 归一化图中心度`（度数高的种子能引回整簇相关候选），艺人去重保持不变。
- 用途 2——**选歌关联项**（`scoreCandidate` local-v4→local-v5）：加 `graphAffinity` = 与最近 5 首自然听完歌曲的平均相似度 × 0.06，与既有的多样性惩罚（防同艺人连续）方向互补；详情与白话解释同步暴露（"与最近常听歌曲的相近度"）。

**验收**：同歌单/同艺人/相邻播放产生边且权重符合设计；种子选择在偏好接近时偏向图中心；选歌对最近常听的相似曲有可观测加成；图构建惰性且随失效事件重建；纯本地零依赖。
