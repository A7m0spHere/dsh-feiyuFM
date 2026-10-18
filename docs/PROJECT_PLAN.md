# 肥鱼电台 FishFM — 开发状态与下一步

更新：2026-10-18。本文是源码、发布、日常 Desktop、验收缺口和接续任务的唯一状态入口。产品规则见 [MVP](MVP.md)，接口见 [控制契约](CORE_CONTRACT.md)，操作命令见 [贡献指南](../CONTRIBUTING.md) 和 [脚本索引](../scripts/README.md)。

## 当前基线

| 状态面 | 已确认内容与边界 |
|---|---|
| 产品路径 | 默认 `filtered`：参考歌曲 → 网易云候选 → LLM 筛选 → 本地播放。自动播放只取入选曲；QQ 暂缓，Last.fm 富化未开工 |
| 已发布包 | `0.1.0-beta.3`，Windows／网易云 Beta。2026-10-13 已确认 `beta` 指向 beta.3、`latest` 保持 beta.1，公开下载摘要及 npm／官方 DSH 安装一致；范围、文件数和摘要只查 [发布记录](releases/0.1.0-beta.3.md) |
| `main` 源码 | 已包含 beta.3 的 N23、U17/U18、DPAPI／PowerShell 5.1、REV-01–03；另有尚未随 npm 发布的 [REV-04](spikes/REV-04-host-failure-isolation.md)、推荐研究工具、逐曲反馈补齐、U19/U20 原型与 [U21 反馈管理](spikes/U21-feedback-management.md) |
| 日常 Desktop | [N23](spikes/N23-model-route-completion.md) 证实原生正常退出重开及曲库、位置、暂停和模型选择保留。后续修复和原型未重载；源码存在不代表日常实例已加载 |
| 最近功能验证 | 2026-10-18，Windows／Node 24.14.0：**538 项，535 通过、0 失败、3 项真实媒体跳过**（CI 配置），含 U21 新增 14 项；156 模块检查、构建/debug smoke、包白名单通过。此前 524/524 含 WPF 的结果仍按 U20 记录，不把本轮跳过当音频通过 |
| DSH 插件验证 | [U21](spikes/U21-feedback-management.md)：真实 CoreBridge／隔离 SQLite 重开通过；Headless Edge 8 组宽窄／浅深色及键盘通过；本机 DSH `0.2.1-rc.2` 独立 Web profile 经官方 CLI 离线安装源码 bundle，启用／认证查询／撤销／去重／冲突／暂停通过，模型调用 0。替身播放与合成数据，不新增平台音频结论；日常 Desktop 不作为本轮前置 |
| 最近引用审计 | 2026-10-18：103 份文档零坏链接、10/10 证据齐全。引用存在不等于验收通过；文档蒸馏的原文比对与归档边界保留 |
| 真实推荐与观察 | N23：40 候选 → 9 入选 → WPF 静音进度通过；日常观察 54.72 分钟、16 条有效收听、0 播放错误，按用户要求提前结束。成长应用标记与请求归因尚未闭环；两个真实 DSH 会话为串行，不能算并发或启停对照 |
| macOS | [移植记录](spikes/MACOS_PORT.md) 仅确认 Helper 编译与本地 desktop profile 加载；适配随 beta.3 提供，真实登录、平台音频和退出生命周期待真机验收 |

**两小时连续观察已由用户于 2026-10-16 取消，不再作为验收手段，也不记为通过。** 逐曲零模型请求改以代码级故障注入与回归核查；DSH 请求／上下文对照仍待补。稳定 v0.1 的 A01–A10 尚无一项完全通过。

## 本轮工程交付与反馈入口

议题状态按 2026-10-18 仓库记录；真实试用由用户指定后置。离线指标和原型可运行不构成推荐收益或正式验收通过。

| 议题 | 已交付 | 剩余工作 |
|---|---|---|
| [#7 推荐质量](https://github.com/A7m0spHere/dsh-feiyuFM/issues/7) | [研究入口](research/README.md)：只读脱敏单批快照、生产解析器回放、冻结候选重排、指标与人工评价模板；12 项回归，初始提交 `ffec5b2` | 无真实样本／人工反馈，保留当前策略，Issue 打开 |
| [#11 真实试用](https://github.com/A7m0spHere/dsh-feiyuFM/issues/11) | [操作卡](research/TRIAL.md)、每人本机材料与匿名汇总；9 项回归 | 当前 0 人、0 分钟、0 有效评价，质量比例 `null`、`awaiting_real_trial`；Issue 打开 |
| [#9 偏好信号](https://github.com/A7m0spHere/dsh-feiyuFM/issues/9) | [语义与对照](research/PREFERENCE_SIGNALS.md)：16 项固定输入对照；候选逐曲 `liked/reduced` 进入筛选事实，撤销移除；4 项新增回归 | 传递缺口已修，不改权重／迁移／模型调用；质量与新算法收益待 #7/#11 |
| [#10 可控探索](https://github.com/A7m0spHere/dsh-feiyuFM/issues/10) | [设计与离线工具](research/EXPLORATION.md)：熟悉／相邻／未知证据、0/20/70/100 对照及三种排名假设；9 项回归 | 保留产品 `filtered` 策略，不把未知包装成跨风格发现；无真实收益证据，Issue 打开 |
| [#4 近期发现](https://github.com/A7m0spHere/dsh-feiyuFM/issues/4) | [U19](spikes/U19-recent-discoveries-prototype.md)：当前有效批次的只读来源与收听状态；12 项新增回归、隔离浏览器通过，提交 `23c542a` | 用户指定按原型交付关闭 Issue；真实反馈待收集，不扩展跨批次永久历史 |
| [#5 表达预设](https://github.com/A7m0spHere/dsh-feiyuFM/issues/5) | [U20](spikes/U20-expression-style-prototype.md)：`current/concise/lively` 独立保存、草稿／冲突保护／恢复默认；11 项新增回归及跨进程重开通过 | 真实反馈待收集；自由编辑、导入导出和分享频次不扩大，Issue 打开 |

研究工具只回放已保存名单，不是完整 Core 决策重演、真实音频或模型重新推理。6 候选演示的前三首艺人多样性从 2/3 变为 1 仅证明指标与重排可运行，不证明质量提升。本地曲库／反馈／Agent 偏好沿用数据目录范围，未改为按平台账号分表。

## 验收清单状态

标准定义只维护在 [MVP 第 6 节](MVP.md)；下表维护结果与缺口。**离线通过 6 条（A02–A06、A10），部分通过 2 条（A07、A08），未通过 2 条（A01、A09）；完整通过 0/10。**

| 条目 | 状态 | 已有依据与剩余缺口 |
|---|---|---|
| A01 双平台登录／搜索／播放 | 未通过 | [P3 网易云闭环](spikes/P3-real-loop.md) 通过；[REV-02](spikes/REV-02-credential-cleanup.md) 有凭据删除失败／重试与 Windows 正常删除证据，Keychain 故障仅合成验证。QQ 暂缓，双平台未验 |
| A02 导入数量与真实来源 | 离线通过＋网易云局部实测 | [N4](spikes/N4-environment-profile.md) 三种来源 UI 更新已验；自动降级的完整失败／空结果／权限轨迹与 QQ 待验 |
| A03 开关／模式／暂停／期限 | 离线通过＋实包局部实测 | [N23](spikes/N23-model-route-completion.md) 已验四组开关、四模式和暂停优先；到期约束的完整现场覆盖仍缺 |
| A04 用户优先与约束 | 离线通过 | [REV-01](spikes/REV-01-import-reset-race.md) 取消旧导入、[REV-03](spikes/REV-03-snapshot-ordering.md) 快照去旧及慢请求回归通过；真实会话事件与完整冲突轨迹待验 |
| A05 候选／筛选／探索／重复 | 离线通过＋真实链路局部实测 | [N22](spikes/N22-platform-first-recommendations.md) 严格筛选边界及 N23 真实链路已有证据；模型筛选质量、按批补充的完整现场覆盖、长期体验与 QQ 待验 |
| A06 环境／偏好／Session 分离 | 离线通过＋真实成长局部实测 | [N1](spikes/N1-autonomous-accounting.md) 五条真实成长、来源与重启保留已验；旧导入取消有回归，完整多会话及长期差异待验 |
| A07 DSH 音乐控制 UI | 部分通过 | [U5](spikes/U5-official-desktop.md) 基础入口、P3 离开面板续播及 [U7](spikes/U7-phl-ui-motion.md) 浏览器覆盖已验；日常宿主完整主题／窄窗口／键盘和播放中浮层组合待验 |
| A08 多 Session 与退出清理 | 部分通过 | 真实停用清理、[多会话离线门控](spikes/A08-sessions.md) 通过；真实并发与真实 Session 标识字段仍未闭环 |
| A09 逐曲零模型请求／低频账本 | 未通过 | 已有门控、账本和故障回归；[N7](spikes/N7-host-contract.md) 的完整 DSH 启停请求／上下文对照和归因仍缺。两小时观察已取消 |
| A10 不伪增收听或成长 | 离线通过 | [N1](spikes/N1-autonomous-accounting.md)、[REV-03](spikes/REV-03-snapshot-ordering.md) 覆盖有效进度、幂等及文件库重开暂停；真实重启的长期行为与成长应用核对待验 |

## 接续顺序与所需输入

1. 收到真实反馈后推进 #7/#11：按操作卡生成每人的本机材料，采集自愿评价，再判断 #9/#10 和 U19/U20 是否值得扩大；试用后置期间不凭合成结果调权重。
2. 补 DSH 启停对照、请求归因和成长应用核对，按故障点执行代码级回归；不恢复已取消的两小时观察。
3. 在相应环境就绪后补 N22 按批补充、N21 现场中断恢复、真实平台失败／权限、宿主窗口／键盘及多 Session。macOS 真机、干净系统与跨设备继续单列待验，需要对应设备。
4. QQ 待用户恢复优先级再核实接口与授权；Last.fm 待用户 API key，保留现有代码和范围。
5. 下一次发布按 [脚本索引](../scripts/README.md) 重打包并核对最终摘要和安装内容；npm 发布／Release／标签需另行安排，不把 beta.1/beta.2 或 U12 历史 tarball 当作当前包。

## 更新与交接

U21 源码已补历史反馈管理，未发布 npm；范围、验证和截图见报告。查询和撤销不改变推荐权重或播放，不提升 A01–A10。DSH 独立 profile 的源码链接验证不等同已发布 tarball 安装验收。

修改行为或接口时同步 MVP／契约，改变取舍时更新 [决策摘要](DECISIONS.md) 并链接证据。报告记录实际环境、命令、结果和未验项，证据缺失用 `unknown`。离线、浏览器、隔离安装、原生 Desktop 和生产验收分别标明。

`main` 串行接续、检查与推送规则见 [AGENTS.md](../AGENTS.md)。Phase/F/P/T/I/U/R/N 的旧任务拆分、依赖和当轮完成度已迁至 [开发历史](archive/development-through-2026-10-18.md)；原始设计见 [design](design/README.md)，各轮证据见 [spikes](spikes/README.md)。历史条目不再维护实时状态。
