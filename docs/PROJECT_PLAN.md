# 肥鱼电台 FishFM — 开发状态与下一步

更新：2026-10-28。本文是源码、发布、日常 Desktop、验收缺口和接续任务的唯一状态入口。产品规则见 [MVP](MVP.md)，接口见 [控制契约](CORE_CONTRACT.md)，操作命令见 [贡献指南](../CONTRIBUTING.md) 和 [脚本索引](../scripts/README.md)。

## 当前基线

| 状态面 | 已确认内容与边界 |
|---|---|
| 产品路径 | 默认 `filtered`：参考歌曲 → 网易云候选 → LLM 筛选 → 本地播放。自动播放只取入选曲；QQ 暂缓，Last.fm 富化未开工 |
| 已发布包 | `0.1.0-beta.3`，Windows／网易云 Beta。2026-10-13 已确认 `beta` 指向 beta.3、`latest` 保持 beta.1，公开下载摘要及 npm／官方 DSH 安装一致；范围、文件数和摘要只查 [发布记录](releases/0.1.0-beta.3.md) |
| `main` 源码 | beta.3 之后的 REV-04、研究工具、反馈补齐、U19/U20 原型、U21 反馈管理、N24 退出证据修复、[N25 最近播放窗口与多批入选池](spikes/N25-recent-playback-and-approved-pool.md)、[REV-05 HTTP 凭据边界](spikes/REV-05-http-transport-boundaries.md) 与 [U22 工作区背景 ASCII 频谱](spikes/U22-ascii-spectrum-backdrop.md) 尚未随 npm 发布 |
| 日常 Desktop | [N23](spikes/N23-model-route-completion.md) 曾验原生正常退出重开。N25 本轮未主动重载；只读观察到日常进程期间重启且已有新窗口和 17 首待播池设置，但最终提交完整加载状态仍为 unknown，不据此补记 Desktop 退出验收 |
| 最近功能验证 | 2026-10-29，Windows／Node 24.22.1：U22 三阶段——① 修复计时缺陷并抽出 `createSpectrumClock`／`createSpectrumDriver`（模拟按真实时间固定步长结算、绘制频率不再改变速度、长空档按 250ms 上限追赶），动画 effect 只依赖可见性与动效档位、同种子 reseed 为 no-op；② `renderSpectrumField` 改为分层浪线海面（浪脊即谱轮廓、逐层透视变平变淡、断口按浪段成块、能量决定海深），移除柱状与镜面倒影；③ 鲸鱼彩蛋落地：dsh-TUI／dsh-ui-whale 像素鲸鱼降采样后与海面写进同一张字符矩阵，五阶段状态机＋95 秒冷却，窄网格／暂停／关闭／减少动态一律跳过或立即取消。全量 **622 项，622 通过、0 失败、0 跳过**，171 模块检查与 client 构建通过。**第四阶段隔离 DSH 现场验收已完成**（独立 `DSH_HOME`、launch URL 由浏览器换 cookie、全部本地夹具）：背景层 `x=280,y=40,w=160,h=960` 与正文左缘／满高一致，`pointer-events:none`、透明、无边框；播放 516 墨点／7 字形且逐帧变化，浅色 opacity 0.17、深色 0.32；`data-whale` 在 **155 秒**首次报出 `lurk` 并走完 `lurk→emerge→breach→dive→ripple`，结束后回 `none`，鲸鱼行与海面笔画同行（同一矩阵）；窄窗口 900px 整层隐藏不压正文；暂停后降到 147 墨点无残留；控制台零错误，`ISSUES: none`。期间修掉两个真实缺陷：resize 重画漏掉鲸鱼（海／鲸共用 `composeField`）、切歌瞬间 `resolving` 反复清零彩蛋冷却（改用更宽的"在听"判据）。默认节奏另用 Node 复刻 200 组种子量化：首现中位 108 秒、p99 218 秒、无超过 240 秒。构建／debug smoke、包白名单与真实媒体沿用 2026-10-23 记录，本轮未重跑 |
| DSH 插件验证 | [N25](spikes/N25-recent-playback-and-approved-pool.md)：官方 DSH `0.2.1-rc.2` 隔离 Web profile，受控 filtered／两批合成批准／本地静音 WPF 的窗口、失败、重启、12 首累计池／6 首当前批次和清理 **20/20 通过**，真实模型请求 0。[N24](spikes/N24-dsh-background-acceptance.md) 的真实模型并发／启停对照、U21 的界面／反馈证据保留；真实平台补批／音频及完整 filtered 现场组合未验 |
| 最近引用审计 | 2026-10-23：106 份文档零坏链接、10/10 证据齐全。引用存在不等于验收通过；文档蒸馏的原文比对与归档边界保留 |
| 真实推荐与观察 | N23：40 候选 → 9 入选 → WPF 静音进度通过；日常观察 54.72 分钟、16 条有效收听、0 播放错误，按用户要求提前结束。N24 已补隔离真实并发、启停对照、9418 ms 原生有效进度与一次 0.0045 的短会话静音成长；日常真实平台的成长应用与归因仍未补验 |
| macOS | [移植记录](spikes/MACOS_PORT.md) 仅确认 Helper 编译与本地 desktop profile 加载；适配随 beta.3 提供，真实登录、平台音频和退出生命周期待真机验收 |

**两小时连续观察已由用户于 2026-10-16 取消，不再作为验收手段，也不记为通过。** 逐曲零模型请求以代码级故障注入／回归及 N24 隔离真实 DSH 对照核查；真实平台及完整默认 filtered 的现场组合仍待补。稳定 v0.1 的 A01–A10 尚无一项完全通过。

## 本轮工程交付与反馈入口

2026-10-23 已重查 GitHub，#12 工程修复与本地安全验收完成；其余研究／原型状态沿用下表，真实试用由用户指定后置。离线指标和原型可运行不构成推荐收益或正式验收通过。

| 议题 | 已交付 | 剩余工作 |
|---|---|---|
| [#12 HTTP 凭据边界](https://github.com/A7m0spHere/dsh-feiyuFM/issues/12) | [REV-05](spikes/REV-05-http-transport-boundaries.md)：实际端点与接口包盘点、单 origin 与路径 Cookie、同源跳转、正文／Cookie 限额、新扫码隔离、错误脱敏；新增安全回归 19/19 与既有平台／登录回归 72/72 通过 | 原生 Node 跨端口跳转未复现 Cookie 转发，不记为泄露；本地模拟完成，不补记真实账号／平台／Desktop，接口包内部 Axios 未重写 |
| [#7 推荐质量](https://github.com/A7m0spHere/dsh-feiyuFM/issues/7) | [研究入口](research/README.md)：只读脱敏单批快照、生产解析器回放、冻结候选重排、指标与人工评价模板；12 项回归，初始提交 `ffec5b2` | 无真实样本／人工反馈，保留当前策略，Issue 打开 |
| [#11 真实试用](https://github.com/A7m0spHere/dsh-feiyuFM/issues/11) | [操作卡](research/TRIAL.md)、每人本机材料与匿名汇总；9 项回归 | 当前 0 人、0 分钟、0 有效评价，质量比例 `null`、`awaiting_real_trial`；Issue 打开 |
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
| A05 候选／筛选／探索／重复 | 离线通过＋真实链路局部实测 | N22／N23 的严格筛选和真实链路证据保留；[N25](spikes/N25-recent-playback-and-approved-pool.md) 已验 50 次窗口、100 首池、200 次加速模拟、降级及隔离 filtered 持久化。真实平台补批完整组合、长期推荐体验与 QQ 待验 |
| A06 环境／偏好／Session 分离 | 离线通过＋真实成长局部实测 | [N1](spikes/N1-autonomous-accounting.md) 及 [N24](spikes/N24-dsh-background-acceptance.md) 已验成长来源／重启、真实短会话身份与减权；旧导入取消有回归，长期差异及平台场景待验 |
| A07 DSH 音乐控制 UI | 部分通过 | [U5](spikes/U5-official-desktop.md) 基础入口、P3 离开面板续播及 [U7](spikes/U7-phl-ui-motion.md) 浏览器覆盖已验；日常宿主完整主题／窄窗口／键盘和播放中浮层组合待验 |
| A08 多 Session 与退出清理 | 部分通过 | [N24](spikes/N24-dsh-background-acceptance.md) 已补真实 Session `id`、实际模型请求并发／不抢播／暂停、Loader 停用后的 Core 与 WPF 子进程清理和重启；原生 Desktop、macOS 与真实平台组合仍待验 |
| A09 逐曲零模型请求／低频账本 | 部分通过 | 门控／账本／故障回归与 [N24](spikes/N24-dsh-background-acceptance.md) 的真实启停任务、静态工具、逐曲零请求及显式总结归因通过；默认 filtered 平台补批／自动调用完整现场组合、供应商内部重试仍未覆盖。两小时观察已取消 |
| A10 不伪增收听或成长 | 离线通过＋隔离原生进度实测 | N1／REV-03／N24 及 [N25](spikes/N25-recent-playback-and-approved-pool.md) 覆盖有效进度、失败不入播放窗口／不成长、重启保持暂停且不重复结算；短暂开始只影响防重复，不改变成长门槛。真实平台长期行为待验 |

## 接续顺序与所需输入

1. 收到真实反馈后推进 #7/#11：按操作卡生成每人的本机材料，采集自愿评价，再判断 #9/#10 和 U19/U20 是否值得扩大；试用后置期间不凭合成结果调权重。
2. N24 的隔离宿主启停对照、请求归因及原生成长核对已完成；后续在真实平台／默认 filtered 中补按批调用和成长证据，不重复纯本地场景，也不恢复两小时观察。
3. 在相应环境就绪后补 N22 按批补充、N21 现场中断恢复、真实平台失败／权限及宿主窗口／键盘；多 Session 保留跨平台和长期组合。macOS 真机、干净系统与跨设备继续单列待验，需要对应设备。
4. QQ 待用户恢复优先级再核实接口与授权；Last.fm 待用户 API key，保留现有代码和范围。
5. 下一次发布按 [脚本索引](../scripts/README.md) 重打包并核对最终摘要和安装内容；npm 发布／Release／标签需另行安排，不把 beta.1/beta.2 或 U12 历史 tarball 当作当前包。

## 更新与交接

U21、N24、N25、REV-05 和 U22 均未发布 npm；范围和证据见各报告。REV-05 未操作日常账号或重载插件。N25 不自动重载日常插件，日常进程期间发生重启的观察不等于最终提交已完整加载。U22 已在隔离 DSH Web profile 完成挂载、几何、浅深色、播放/暂停与鲸鱼五阶段现场验收；日常 Desktop 实例未重启、多显示器/DPI、macOS 与长时间运行未验。验收期间发生过一次误杀：脚本早期版本按镜像名结束所有 DSH 进程，连带终止用户的日常实例，已核对日常库完整并只按 PID 收尾。真实 FFT 因宿主无样本流未实现，当前为状态驱动的模拟频谱（明确标注）。A09 保持部分通过，不提升完整通过数；独立 profile 的源码链接验证不等同已发布 tarball 安装验收。

修改行为或接口时同步 MVP／契约，改变取舍时更新 [决策摘要](DECISIONS.md) 并链接证据。报告记录实际环境、命令、结果和未验项，证据缺失用 `unknown`。离线、浏览器、隔离安装、原生 Desktop 和生产验收分别标明。

`main` 串行接续、检查与推送规则见 [AGENTS.md](../AGENTS.md)。Phase/F/P/T/I/U/R/N 的旧任务拆分、依赖和当轮完成度已迁至 [开发历史](archive/development-through-2026-10-18.md)；原始设计见 [design](design/README.md)，各轮证据见 [spikes](spikes/README.md)。历史条目不再维护实时状态。
