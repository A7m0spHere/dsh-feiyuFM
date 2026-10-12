# N23 模型最终回答与 beta.3 补验

日期：2026-10-12，Windows／官方 DSH 0.2.0-rc.2。接续 [beta.3 发布前验收](../releases/0.1.0-beta.3-acceptance.md)，保留前轮失败与用量，不覆盖其历史结论。

## 原因与修复

同一测试服务、同一 DeepSeek 模型的 Messages 兼容路由收到 `thinking: disabled` 后，原始响应仍只有 thinking 事件；256 tokens 请求以 `max_tokens` 结束，原始最终文本字符数为 0。2048 tokens 也耗尽，4096 tokens 请求在插件的 45 秒截止时间取消。Qwen 的另一条普通自定义路线也超时。这些结果只说明对应请求未完成，不代表 API 整体不可用；DSH 没有遗漏原始最终文本。

改用该服务的 `openai-completions` 路由，并明确声明模型的推理能力与 `compat.thinkingFormat: deepseek` 后，实际 `/v1/chat/completions` 请求发送 `thinking: disabled`，原始推理字符数 0、最终文本 288 字符、finish reason 为 `stop`。网易云实际返回 40 首候选，模型选择 9 首；账本为 input 769、output 160，共 929 tokens。没有拼接推理内容、伪造候选或清空失败账本。

下面只展示本轮经过实测的自定义模型配置片段，不包含凭据；不自动改写所有提供方，也不替换日常 DSH 的主对话模型。

```yaml
api: openai-completions
models:
  - id: deepseek-v4.1-flash
    reasoningEfforts:
      off: null
      high: high
    compat:
      thinkingFormat: deepseek
```

源码新增明确的失败分类：`max-tokens` 结束记为 `model_output_limit`，即使已有可解析文本也不应用；只有推理而无最终文本记为 `model_no_final_text`。保留旧结果和实际／未知用量，不在同一次调用中自动提高额度或重试。输出设置范围由 64–256 扩展为 64–4096，默认 256、既有设置与共享日预算保留；更大的额度仍必须通过保守预算预留。

## 实测范围

- 相关回归 95/95；全量 438/438，0 失败、0 跳过，包含本机真实 WPF 回归；最终检查覆盖 133 模块，构建/debug smoke 通过。新增回归检查预算不足时不派发、截断答案不能覆盖旧结果，以及纯推理失败准确记账。
- 隔离实宿主从入选歌曲选中《上山岗》，真实 WPF 进度达到 6371 ms、有效静音时间 5511 ms，随后暂停；该次恢复／换曲没有新增模型调用（前后均为 10 条）。这里证明平台音频后端与时间线，不追加真人听音确认。
- 通过官方应用 shutdown API 退出隔离宿主后，Core／WPF 清理完成；这项与下述原生 Desktop 菜单退出分别记录。
- 日常原生 Desktop 从仓库链接加载当前源码。用户通过正常应用入口完整退出并重开；旧应用 16472、Host 36264、Core 37348 均已退出，新应用 26344、Host 39632、Core 25444 启动。前后曲库均为 233 首，同一曲目位置 48789 ms、暂停、开关与 `deepseek-account / deepseek-flash` 选择保持。未覆盖日常模型路线。
- Windows 原生 Computer Use 已直接验证实际 FishFM 面板，并点击继续播放。21:13:48–22:08:31 的有效观察窗口为 3283370 ms（54.72 分钟）；用户决定提前结束，报告状态为 interrupted。同一实例、采样连续，16 首自主自然结束、16 条有效收听（其中 3 条陌生池），没有重复历史、窗口内控制干预或播放错误。审计未闭环成长应用标记和模型请求归因，不把有效收听数当作新增成长全部通过。
- 两个真实 DSH 会话分别完成普通请求。其系统内容均为 55450 bytes、指纹一致，包含三个 FishFM 静态工具名称；未检出 playInstanceId／agentEffectiveMs／candidateRevision 字段。PTC 请求头只列一个入口工具，不能只看请求头而漏算系统工具目录。新增 [上下文检查入口](../../scripts/inspect-dsh-session-context.mjs) 读取显式指定的 JSONL／多帧 Zstd 文件，只输出大小、指纹与字段标记，不输出提示正文。这两次为串行会话，不算真实并发或插件启停对照通过。
- 最终 beta.3 快照通过仓库外 npm 安装、官方 DSH CLI 安装和管理器启用；两处安装的 95 个项目文件与打包时源码逐字节相同，入口／11 条资源路由／Core／WPF 与 PowerShell 7／5.1／仅 5.1 PATH 的 DPAPI 矩阵通过。安装态真实播放《上山岗》自然结束并续播下一首；模型调用计数保留为 10。四种模式与四组独立开关实测通过：非 Off 模式是明确开始操作，Off 保持暂停，独立开关不能撤销暂停，迟到平台／音频工作不能撤销后续暂停。

本轮公共摘要见 [结构化证据](../releases/evidence/n23-20261012.json)。两小时、完整 DSH 启停对照、真实并发、完整窗口、现场中断恢复和 macOS 真机仍未闭环；用户明确跨设备验收保留待验。

版本已准备为 `0.1.0-beta.3`，npm／GitHub Release／版本标签仍未发布。证据中的包摘要对应补验时的实包快照；本次文档收尾后，正式发布前仍须重打包并核对最终摘要。当前状态与剩余工作统一见 [PROJECT_PLAN](../PROJECT_PLAN.md)。
