# N7 宿主采集契约与真实长跑入口

2026-10-03：根据本机官方 DSH `0.2.0-rc.2` ASAR 内的 `@deepseek-ai/dsh-llm`、`cordis`、`dsh-agent-loop`、`dsh-token-meter` 实现核对契约，不复制宿主代码。

`llm.stream` 和 prepared call 均进入 `llm/stream` waterfall；监听器接收 `(options, next)`，调用原 `next()` 后逐块原样转发，不修改请求或返回块。计数指宿主 LLM 服务调用，供应商内部 HTTP 重试不在覆盖范围。usage 只累计平台返回的 input/output/cacheRead/cacheWrite 数字，缺失单独统计。

`request/header` 仅在 initial/resume/change/series 写入，不是模型请求次数。`assistant/message` 与 `assistant/attempt` 是持久化结算事件，另计结算数。监听 `session/event` 在音乐语义过滤前执行。系统/开发者事件只保存次数和指纹；请求只保存 FishFM 静态工具数量、序列化字节数及指纹，不保存用户消息、模型回复、完整系统文本或凭据。字节数不冒充真实 token 数。

采集范围始于插件激活，不包含此前宿主请求。宿主总体用量不等于插件直接用量；直接音乐请求归因与逐轮上下文插入仍需结合插件调用边界审计及真实对照，不自动填 0。

`observe:runtime` 每 5 秒只读唯一生产 Core/Adapter 报告，累计增量事件和资源样本，标明过期、实例变化和序列缺口；不打开生产数据库、不启动第二个 Core、不注入进度/曲终。运行 `--seconds 7200 --out <本机路径>` 后还须核对真实播放、SQLite 历史/成长、控制介入和 DSH 覆盖，脚本不自行授予 A09 通过。

`observe-processes.mjs` 用 Windows 只读进程查询采集生产 Core、Adapter 及宿主进程树的 RSS/CPU，包含 WPF pwsh 子进程；仅保存 PID/父 PID/进程名/资源数字，不输出命令行或媒体 URL。每 30 秒更新本机报告，运行前核对真实报告与合法 PID；首次真实探针 9 个相关进程、无查询失败。宿主总体进程树包含其他 DSH 活动，不冒充音乐独占资源。

长跑结束使用 `node scripts/audit-real-observation.mjs --report <报告> --out <本机审计路径>` 只读 SQLite 成长载荷核对窗口内播放实例。指标来自增量事件，不使用运行前的累计大数；识别重复历史/成长、未匹配数据库与控制介入。有效进度总和按窗口内结束的完整实例计算，首个实例可能带窗口前进度，因此明确注释，不能直接当作窗口内音频时长。无人交互阶段判定与 A09 分开，后者继续为 unknown。

审计同时检查 Core/Adapter 的连续样本时间：窗口边缘及相邻样本不得有超过 20 秒的缺口。即使恢复后报告已经 fresh，也不能将睡眠或时钟跳跃跨过的墙钟时间算作连续覆盖；专门回归以两小时缺口及已有有效曲终证明不会误判通过。

当前状态：真实无人交互静音长跑已开始，用户明确选择本轮不做正常 DSH 任务；模型请求/上下文对照继续未验，不宣称 N7/A09 完成。基线前一首手动歌曲单独排除；窗口从自然自主续播起算，保持探索率 70%。资源进程树探针在基线开始约 12 分钟后加入，Core/Adapter 内置样本从激活持续采集。
