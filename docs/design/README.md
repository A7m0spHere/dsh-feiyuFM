# 设计提案索引

这里保留设计时的目标、参数建议与分阶段标准，部分内容已由后续实现修订。当前行为看 [MVP](../MVP.md) 和 [控制契约](../CORE_CONTRACT.md)，完成状态看 [开发路线](../PROJECT_PLAN.md)。

后续修订：2026-10-07 的 [N22](../spikes/N22-platform-first-recommendations.md) 取代 N9/N11/N15 的默认展示和路径，自动池严格只取入选曲；2026-10-16 用户取消两小时连续观察。下列旧设计保留原文，不再按其中的旧流程／时间门槛执行，当前标准见 MVP。

| 设计 | 对应实现与证据 |
|---|---|
| [自主听歌与推荐规划](AUTONOMOUS_MUSIC_ROADMAP.md) | N0–N8 的原始拆分；两小时门槛已取消，实际结果从 [证据索引](../spikes/README.md) 查阅 |
| [透明人格、选歌回复与 token 用量](FEAT_TRANSPARENT_PERSONA.md) | [N9](../spikes/N9-transparent-persona.md)；具体模型歌单由 [N11](../spikes/N11-model-playlist.md) 扩展 |
| [平台候选与 LLM 筛选](FEAT_LLM_DISCOVERY_FILTER.md) | [N15](../spikes/N15-llm-discovery-filter.md)，状态计数修复见 [N20](../spikes/N20-review-fixes.md) |
| [画像缓存与个人相似图](FEAT_P0_PROFILE_CACHE_TRACK_GRAPH.md) | [N16](../spikes/N16-p0-cache-track-graph.md)，歌单关系事实见 [N18](../spikes/N18-p2-progress-and-relations.md) |

返回 [文档索引](../README.md)。
