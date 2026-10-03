# N7 宿主采集契约与真实长跑入口

2026-10-03：根据本机官方 DSH `0.2.0-rc.2` ASAR 内的 `@deepseek-ai/dsh-llm`、`cordis`、`dsh-agent-loop`、`dsh-token-meter` 实现核对契约，不复制宿主代码。

`llm.stream` 和 prepared call 均进入 `llm/stream` waterfall；监听器接收 `(options, next)`，调用原 `next()` 后逐块原样转发，不修改请求或返回块。计数指宿主 LLM 服务调用，供应商内部 HTTP 重试不在覆盖范围。usage 只累计平台返回的 input/output/cacheRead/cacheWrite 数字，缺失单独统计。

`request/header` 仅在 initial/resume/change/series 写入，不是模型请求次数。`assistant/message` 与 `assistant/attempt` 是持久化结算事件，另计结算数。监听 `session/event` 在音乐语义过滤前执行。系统/开发者事件只保存次数和指纹；请求只保存 FishFM 静态工具数量、序列化字节数及指纹，不保存用户消息、模型回复、完整系统文本或凭据。字节数不冒充真实 token 数。

采集范围始于插件激活，不包含此前宿主请求。宿主总体用量不等于插件直接用量；直接音乐请求归因与逐轮上下文插入仍需结合插件调用边界审计及真实对照，不自动填 0。

`observe:runtime` 每 5 秒只读唯一生产 Core/Adapter 报告，累计增量事件和资源样本，标明过期、实例变化和序列缺口；不打开生产数据库、不启动第二个 Core、不注入进度/曲终。运行 `--seconds 7200 --out <本机路径>` 后还须核对真实播放、SQLite 历史/成长、控制介入和 DSH 覆盖，脚本不自行授予 A09 通过。

当前状态：采集实现与专项验证，真实长跑未开始，不能宣称 N7/A09 完成。
