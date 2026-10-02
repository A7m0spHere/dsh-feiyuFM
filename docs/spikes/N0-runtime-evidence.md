# N0 真实运行采集

2026-10-02：代码与离线接线完成，真实运行链路等待后续现场采集。不是 A09 两小时通过证据。

- Core 生产入口写入数据库旁 `runtime/core.json`，Adapter 写入 `runtime/adapter.json`；最多 2000 条事件、720 个资源样本，默认 5 秒原子刷新。
- 实际 HTTP/社区 API 请求、Host 命令/Session、Core 选择与播放实例、Playback 接受事件及成长结果从调用现场采集；Adapter 在实际注册成功后分别计工具/命令注册。
- `npm run observe:runtime -- --seconds 60 --out <本机报告路径>` 只读现有插件报告，不打开数据库、不启动 Core、不注入事件。默认 `~/.dsh/fishfm/runtime`，支持 `--directory`。
- 报告白名单只留类型、实例标识、数值和状态，不留凭据、媒体句柄、聊天正文及任意错误消息。旧报告、关闭进程、缺失组件与重启分开显示。
- DSH 模型请求及逐轮上下文注入尚无完整宿主采集，保持 `null/unknown`；报告不声称生产零模型请求或 A09 通过。实际外部请求计数与可观测本地状态可以核对。
- `scripts/soak.mjs` 仍是 synthetic 演练；不得以现有演练的 0 计数代替 DSH 生产证据。

验证：runtime evidence、Adapter、Host、社区请求与 HTTP transport 合计 42 项测试通过；85 模块检查、构建/调试冒烟与验收证据审计通过。测试验证事件上限、真实计数、未知覆盖、凭据过滤和过时状态。现场安装目前运行着其他 DSH 任务，未为此强制重启。

提交前全量 `npm test`：249/249 通过。DSH 请求对照与完整宿主注册采集仍待现场覆盖；N0 未据此标为全部验收通过。
