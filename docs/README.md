# 开发文档入口

接续开发先看 [PROJECT_PLAN](PROJECT_PLAN.md) 的当前基线、验收缺口和下一步，再按改动读取规格或契约。安装使用看 [DELIVERY](DELIVERY.md)，命令看 [贡献指南](../CONTRIBUTING.md)／[脚本索引](../scripts/README.md)。

## 现行文档：各维护一类事实

| 要查或修改什么 | 文档 |
|---|---|
| 源码／发布／日常 Desktop、测试基线、任务状态和待验项 | [PROJECT_PLAN](PROJECT_PLAN.md) |
| 产品范围、用户行为、A01–A10 标准 | [MVP](MVP.md) |
| 进程、职责、数据流和代码入口 | [ARCHITECTURE](ARCHITECTURE.md) |
| 命令、RPC、版本、推荐缓存、模型预算、播放与存储契约 | [CORE_CONTRACT](CORE_CONTRACT.md) |
| 选择理由、被替代规则和证据 | [DECISIONS](DECISIONS.md) |
| 文件位置、生成物与本机资料边界 | [REPOSITORY](REPOSITORY.md) |
| 安装、更新、数据位置与排障 | [DELIVERY](DELIVERY.md) |
| 技术实验的问题、证据格式和通过边界 | [PHASE_0](PHASE_0.md) |

## 按需查证

| 入口 | 内容与阅读边界 |
|---|---|
| [research](research/README.md) | 冻结候选的离线比较、[信号语义](research/PREFERENCE_SIGNALS.md)、[探索对照](research/EXPLORATION.md) 和 [真实试用卡](research/TRIAL.md)；不代表质量收益 |
| [spikes](spikes/README.md) | 按轮次保留实现／实测报告与附件。默认推荐看 [N22](spikes/N22-platform-first-recommendations.md)，真实补验看 [N23](spikes/N23-model-route-completion.md)，近期原型看 U19/U20 |
| [releases](releases/README.md) | 公开包范围、摘要与安装确认；[beta.3 发布前验收](releases/0.1.0-beta.3-acceptance.md) 和 [最终记录](releases/0.1.0-beta.3.md) 分开保留 |
| [design](design/README.md) | 原始提案和参数建议，可能被后续修订，不作现行规格或进度表 |
| [archive](archive/README.md) | 旧任务表、决策原文与交接，只供追溯，不维护实时状态 |

行为变更同步 MVP，接口变更同步契约，取舍变更更新 DECISIONS 并链接证据；状态只更新 PROJECT_PLAN。历史证据保留日期／环境和原结论，不因文档精简提升验收。新增设计或报告补对应索引；不要再建一份完整规格或进度表。

`npm run audit:acceptance` 检查维护文档的本地链接与验收引用，只验证存在性。协作规则见 [AGENTS.md](../AGENTS.md)，第三方来源与许可见 [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md)。
