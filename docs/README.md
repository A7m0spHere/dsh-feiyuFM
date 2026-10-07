# 文档索引

当前文档与历史实验分开阅读。安装使用从 DELIVERY 开始，接续开发先看 PROJECT_PLAN；设计提案不能代替当前规格，历史报告中的账号、版本、性能和验收状态按记录日期理解。

## 当前文档

| 文档 | 维护内容 |
|---|---|
| [交付与使用说明](DELIVERY.md) | 安装、更新、数据位置、控制和排障 |
| [产品规格](MVP.md) | 用户行为、推荐范围和 A01–A10 验收标准 |
| [开发路线](PROJECT_PLAN.md) | 任务状态、加载版本、测试基线、验收缺口与下一步；状态唯一入口 |
| [技术架构](ARCHITECTURE.md) | 进程、模块职责、数据流与维护入口 |
| [内部控制契约](CORE_CONTRACT.md) | 命令、状态、RPC、资源、记账、预算与存储语义 |
| [技术验证方法](PHASE_0.md) | 探针通过条件、证据格式和真实验证要求 |
| [决策记录](DECISIONS.md) | 按日期保留取舍、来源和被后续修订的规则 |
| [仓库结构与维护入口](REPOSITORY.md) | 文件位置、生成物/本机数据边界、脚本和原型入口 |

## 设计与证据

| 目录 | 用法 |
|---|---|
| [design](design/README.md) | 自主听歌、透明人格、模型筛选、画像缓存与相似图的原始设计；最新行为看 MVP/契约，状态看 PROJECT_PLAN |
| [spikes](spikes/README.md) | N/U/P/T/I/R/A 各轮实现与实测报告，含截图和元数据附件；不作为实时账号或部署探针 |
| [releases](releases/README.md) | 公开包的范围、摘要、安装/界面验证与发布确认 |
| [archive](archive/README.md) | 封存的旧交接文字，不作为现行规则或实时状态 |

最近推荐流程与界面见 [N22](spikes/N22-platform-first-recommendations.md)，中断恢复见 [N21](spikes/N21-playback-interruption-recovery.md)。素材/彩蛋与布局的历史证据从 [spikes 索引](spikes/README.md) 查阅，源码、发布与生产的区别只看开发路线首页。

## 维护约定

- 修改产品行为同步 MVP；修改内部接口同步 CORE_CONTRACT；改变取舍追加 DECISIONS 并链接证据。
- 任务状态、生产加载边界和未验项统一维护在 PROJECT_PLAN，其他文档引用它，避免复制多份进度表。
- 新设计放入 design，新实验放入 spikes，并补对应索引。实验记录保留执行环境和剩余限制；历史事实不改写成当前已通过。
- 运行 `npm run audit:acceptance` 检查全部 docs Markdown 的本地链接和验收证据引用。审计检查引用存在，不执行真实验收。

仓库外入口：[项目首页](../README.md)、[贡献指南](../CONTRIBUTING.md)、[协作规则](../AGENTS.md)、[第三方声明](../THIRD_PARTY_NOTICES.md)。
