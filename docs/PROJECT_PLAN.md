# 肥鱼电台 FishFM — 开发状态与下一步

更新：2026-10-30。本文是源码、发布、日常 Desktop、验收缺口和接续任务的唯一状态入口。产品规则见 [MVP](MVP.md)，接口见 [控制契约](CORE_CONTRACT.md)，操作命令见 [贡献指南](../CONTRIBUTING.md) 和 [脚本索引](../scripts/README.md)。

## 当前基线

| 状态面 | 已确认内容与边界 |
|---|---|
| 产品路径 | 默认 `filtered`：参考歌曲 → 网易云候选 → LLM 筛选 → 本地播放。自动播放只取入选曲；QQ 暂缓，Last.fm 富化未开工 |
| 已发布包 | `0.1.0-beta.3`，Windows／网易云 Beta。2026-10-13 已确认 `beta` 指向 beta.3、`latest` 保持 beta.1，公开下载摘要及 npm／官方 DSH 安装一致；范围、文件数和摘要只查 [发布记录](releases/0.1.0-beta.3.md) |
| `main` 源码 | beta.3 之后的 REV-04、研究工具、反馈补齐、U19/U20 原型、U21 反馈管理、N24 退出证据修复、[N25 多批入选池](spikes/N25-recent-playback-and-approved-pool.md)、[REV-05 HTTP 凭据边界](spikes/REV-05-http-transport-boundaries.md) 与 [N26 最近 50 次硬性窗口](spikes/N26-hard-repeat-window.md) 尚未随 npm 发布 |
| 日常 Desktop | [N23](spikes/N23-model-route-completion.md) 曾验原生正常退出重开。N26 本轮未重载日常实例；已运行 Core 不因磁盘源码修改自动更新，硬性窗口的日常加载与真实平台效果仍为 `unknown`。N25 的中途加载观察不补记最终提交的 Desktop 退出验收 |
| 最近功能验证 | 2026-10-30，Windows／Node 24.22.1，N26：**582 项，579 通过、0 失败、3 项真实媒体跳过**（CI 配置）；选歌／窗口／入选池／filtered 专项 **80/80 通过**；165 模块检查、构建/debug smoke、包白名单（4885 文件，34.78 MB）及引用审计通过。真实静音 WPF 在隔离 DSH 另验，不把套件跳过当音频通过 |
| DSH 插件验证 | [N26](spikes/N26-hard-repeat-window.md)：官方 DSH `0.2.1-rc.5` 隔离 Web profile，受控 filtered／两批合成批准／本地静音 WPF **23/23 通过**，12 首各实际开始一次后保持等待，普通 next 不能绕过硬窗口，重启保留窗口与批准池、进程清理、零真实模型请求均已验。[N24](spikes/N24-dsh-background-acceptance.md) 的真实模型并发／启停对照、U21 界面证据保留；真实平台补批／音频及完整 filtered 现场组合未验 |
| 最近引用审计 | 2026-10-30：108 份文档零坏链接、10/10 证据齐全，已纳入两小时反馈与 N26 硬窗口。引用存在不等于验收通过；文档蒸馏的原文比对与归档边界保留 |
| 真实推荐与观察 | N23：40 候选 → 9 入选 → WPF 静音进度通过；日常观察 54.72 分钟、16 条有效收听、0 播放错误，按用户要求提前结束。N24 已补隔离真实并发、启停对照、9418 ms 原生有效进度与一次 0.0045 的短会话静音成长；日常真实平台的成长应用与归因仍未补验 |
| 两小时播放反馈 | 2026-10-30 用户确认：Windows DSH Desktop 已持续自动换曲两小时，没有卡住和报错，但存在 10 首以内重复播放。[补充报告](spikes/R2-two-hour-playback-20261030.md) 单列用户实测来源；实际播放日期、精确版本、平台、请求计数与资源曲线为 `unknown`。后续只读历史实证 10-28～29 有 5 次隔 8 首重播，均为 `local-v6` 的 9 首池耗尽降级；最近 50 次开始无 10 首内重复，补曲不足原因待查；相关回归 17/17 通过 |
| macOS | [移植记录](spikes/MACOS_PORT.md) 仅确认 Helper 编译与本地 desktop profile 加载；适配随 beta.3 提供，真实登录、平台音频和退出生命周期待真机验收 |

**两小时播放已完成（2026-10-30 用户实测确认），存在 10 首以内重复播放。** 2026-10-16 取消其作为阻塞门槛的决定保留，本次反馈不要求重新计时。逐曲零模型请求仍以代码级故障注入／回归及 N24 隔离真实 DSH 对照核查；本次没有请求／资源等采集，真实平台及完整默认 filtered 的现场组合仍待补。稳定 v0.1 的 A01–A10 尚无一项完全通过。

## 本轮工程交付与反馈入口

2026-10-30 已重查 GitHub，两小时播放对应 #8 Gate 0，新增用户实测反馈并同步其路线说明；#12 工程修复与本地安全验收此前已完成。其余研究／原型状态沿用下表，真实试用由用户指定后置。离线指标和原型可运行不构成推荐收益或正式验收通过。

| 议题 | 已交付 | 剩余工作 |
|---|---|---|
| [#12 HTTP 凭据边界](https://github.com/A7m0spHere/dsh-feiyuFM/issues/12) | [REV-05](spikes/REV-05-http-transport-boundaries.md)：实际端点与接口包盘点、单 origin 与路径 Cookie、同源跳转、正文／Cookie 限额、新扫码隔离、错误脱敏；新增安全回归 19/19 与既有平台／登录回归 72/72 通过 | 原生 Node 跨端口跳转未复现 Cookie 转发，不记为泄露；本地模拟完成，不补记真实账号／平台／Desktop，接口包内部 Axios 未重写 |
| [#7 推荐质量](https://github.com/A7m0spHere/dsh-feiyuFM/issues/7) | [研究入口](research/README.md)：只读脱敏单批快照、生产解析器回放、冻结候选重排、指标与人工评价模板；12 项回归，初始提交 `ffec5b2` | 无真实样本／人工反馈，保留当前策略，Issue 打开 |
| [#11 真实试用](https://github.com/A7m0spHere/dsh-feiyuFM/issues/11) | [操作卡](research/TRIAL.md)、每人本机材料与匿名汇总；9 项回归 | 按该研究流程收集的样本仍为 0 人、0 分钟、0 有效评价，质量比例 `null`、`awaiting_real_trial`；本次两小时播放反馈单列 R2，未包含质量评价材料；Issue 打开 |
| [#9 偏好信号](https://github.com/A7m0spHere/dsh-feiyuFM/issues/9) | [语义与对照](research/PREFERENCE_SIGNALS.md)：16 项固定输入对照；候选逐曲 `liked/reduced` 进入筛选事实，撤销移除；4 项新增回归 | 传递缺口已修，不改权重／迁移／模型调用；质量与新算法收益待 #7/#11 |
| [#10 可控探索](https://github.com/A7m0spHere/dsh-feiyuFM/issues/10) | [设计与离线工具](research/EXPLORATION.md)：熟悉／相邻／未知证据、0/20/70/100 对照及三种排名假设；9 项回归 | 保留产品 `filtered` 策略，不把未知包装成跨风格发现；无真实收益证据，Issue 打开 |
| [#4 近期发现](https://github.com/A7m0spHere/dsh-feiyuFM/issues/4) | [U19](spikes/U19-recent-discoveries-prototype.md)：当前有效批次的只读来源与收听状态；12 项新增回归、隔离浏览器通过，提交 `23c542a` | 用户指定按原型交付关闭 Issue；真实反馈待收集，不扩展跨批次永久历史 |
| [#5 表达预设](https://github.com/A7m0spHere/dsh-feiyuFM/issues/5) | [U20](spikes/U20-expression-style-prototype.md)：`current/concise/lively` 独立保存、草稿／冲突保护／恢复默认；11 项新增回归及跨进程重开通过 | 真实反馈待收集；自由编辑、导入导出和分享频次不扩大，Issue 打开 |

研究工具只回放已保存名单，不是完整 Core 决策重演、真实音频或模型重新推理。6 候选演示的前三首艺人多样性从 2/3 变为 1 仅证明指标与重排可运行，不证明质量提升。本地曲库／反馈／Agent 偏好沿用数据目录范围，未改为按平台账号分表。

## 验收清单状态

标准定义只维护在 [MVP 第 6 节](MVP.md)；下表维护结果与缺口。**离线通过 6 条（A02–A06、A10），部分通过 3 条（A07–A09），未通过 1 条（A01）；完整通过 0/10。**

| 条目 | 状态 | 已有依据与剩余缺口 |
|---|---|---|
| A01 双平台登录／搜索／播放 | 未通过 | [P3 网易云闭环](spikes/P3-real-loop.md) 通过；[REV-02](spikes/REV-02-credential-cleanup.md) 有凭据删除失败／重试与 Windows 正常删除证据，Keychain 故障仅合成验证。QQ 暂缓，双平台未验 |
| A02 导入数量与真实来源 | 离线通过＋网易云局部实测 | [N4](spikes/N4-environment-profile.md) 三种来源 UI 更新已验；自动降级的完整失败／空结果／权限轨迹与 QQ 待验 |
| A03 开关／模式／暂停／期限 | 离线通过＋实包局部实测 | [N23](spikes/N23-model-route-completion.md) 已验四组开关、四模式和暂停优先；到期约束的完整现场覆盖仍缺 |
| A04 用户优先与约束 | 离线通过 | [REV-01](spikes/REV-01-import-reset-race.md) 取消旧导入、[REV-03](spikes/REV-03-snapshot-ordering.md) 快照去旧及慢请求回归通过；真实会话事件与完整冲突轨迹待验 |
| A05 候选／筛选／探索／重复 | 离线通过＋真实链路局部实测 | N22／N23 的严格筛选和真实链路证据保留；N25 的 100 首入选池沿用。[N26](spikes/N26-hard-repeat-window.md) 已将最近 50 次实际开始设为硬限制，覆盖小池等待、50 次边界、短播跳过、普通 next 与补批恢复，隔离 DSH 原生音频小池耗尽亦已验。旧版本重播证据保留；真实平台补曲供给、日常新规则加载、长期体验与 QQ 待验 |
| A06 环境／偏好／Session 分离 | 离线通过＋真实成长局部实测 | [N1](spikes/N1-autonomous-accounting.md) 及 [N24](spikes/N24-dsh-background-acceptance.md) 已验成长来源／重启、真实短会话身份与减权；旧导入取消有回归，长期差异及平台场景待验 |
| A07 DSH 音乐控制 UI | 部分通过 | [U5](spikes/U5-official-desktop.md) 基础入口、P3 离开面板续播及 [U7](spikes/U7-phl-ui-motion.md) 浏览器覆盖已验；日常宿主完整主题／窄窗口／键盘和播放中浮层组合待验 |
| A08 多 Session 与退出清理 | 部分通过 | [N24](spikes/N24-dsh-background-acceptance.md) 已补真实 Session `id`、实际模型请求并发／不抢播／暂停、Loader 停用后的 Core 与 WPF 子进程清理和重启；原生 Desktop、macOS 与真实平台组合仍待验 |
| A09 逐曲零模型请求／低频账本 | 部分通过 | 门控／账本／故障回归与 [N24](spikes/N24-dsh-background-acceptance.md) 的真实启停任务、静态工具、逐曲零请求及显式总结归因通过；默认 filtered 平台补批／自动调用完整现场组合、供应商内部重试仍未覆盖。两小时播放已由用户完成，本次请求计数未知，不能替代本项专项证据 |
| A10 不伪增收听或成长 | 离线通过＋隔离原生进度实测 | N1／REV-03／N24 及 [N25](spikes/N25-recent-playback-and-approved-pool.md) 覆盖有效进度、失败不入播放窗口／不成长、重启保持暂停且不重复结算；短暂开始只影响防重复，不改变成长门槛。真实平台长期行为待验 |

## 接续顺序与所需输入

1. 收到真实反馈后推进 #7/#11：按操作卡生成每人的本机材料，采集自愿评价，再判断 #9/#10 和 U19/U20 是否值得扩大；试用后置期间不凭合成结果调权重。
2. N24 的隔离宿主启停对照、请求归因及原生成长核对已完成；后续在真实平台／默认 filtered 中补按批调用和成长证据，不重复纯本地场景，也不重新要求两小时观察。
3. N26 已按用户要求禁止最近 50 次内自动重播；缺新曲时等待。后续核对日常实例加载新规则，并继续查平台候选、筛选入选量、补批调度与预算门控，提高新曲供给，不直接扩大预算或放宽严格入选。在相应环境就绪后补 N22 按批补充、N21 现场中断恢复、真实平台失败／权限及宿主窗口／键盘；多 Session 保留跨平台和长期组合。macOS 真机、干净系统与跨设备继续单列待验，需要对应设备。
4. QQ 待用户恢复优先级再核实接口与授权；Last.fm 待用户 API key，保留现有代码和范围。
5. 下一次发布按 [脚本索引](../scripts/README.md) 重打包并核对最终摘要和安装内容；npm 发布／Release／标签需另行安排，不把 beta.1/beta.2 或 U12 历史 tarball 当作当前包。

## 更新与交接

U21、N24、N25、REV-05 与 N26 均未发布 npm；范围和证据见各报告。N26 未重载日常实例，当前播放仍可能使用旧策略；源码推送不等于已加载。A09 保持部分通过，不提升完整通过数；独立 profile 的源码链接验证不等同已发布 tarball 安装验收。

修改行为或接口时同步 MVP／契约，改变取舍时更新 [决策摘要](DECISIONS.md) 并链接证据。报告记录实际环境、命令、结果和未验项，证据缺失用 `unknown`。离线、浏览器、隔离安装、原生 Desktop 和生产验收分别标明。

`main` 串行接续、检查与推送规则见 [AGENTS.md](../AGENTS.md)。Phase/F/P/T/I/U/R/N 的旧任务拆分、依赖和当轮完成度已迁至 [开发历史](archive/development-through-2026-10-18.md)；原始设计见 [design](design/README.md)，各轮证据见 [spikes](spikes/README.md)。历史条目不再维护实时状态。
