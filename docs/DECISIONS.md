# 决策摘要

更新：2026-10-18。这里只保留仍影响开发的选择、理由与修订关系。行为和参数定义见 [MVP](MVP.md)／[控制契约](CORE_CONTRACT.md)，部署、测试数量和验收状态只维护在 [开发状态](PROJECT_PLAN.md)。

原第 0–46 节、D01–D13、依赖调研、参数理由与历史现场记录完整保存在 [决策原文](archive/decisions-through-2026-10-18.md)。旧报告中的节号指向该归档；它们不覆盖后续修订。新增决策记录日期、触发原因、选择、取代的旧规则和证据，不复制执行流水。

## 产品范围与宿主

| 日期 | 选择与原因 | 依据 |
|---|---|---|
| 2026-09-27 | 名称为肥鱼电台 FishFM，仓库 `dsh-feiyuFM`；v0.1 保留网易云与 QQ 双平台范围，用户可只连接一个。偏好独立于用户环境，未知特征不猜测 | [原文第 1–3、6 节](archive/decisions-through-2026-10-18.md)、[MVP](MVP.md) |
| 2026-09-28～29 | 产品是可隐藏的音乐控制 UI，鲸鱼图只表达音乐状态；界面落在 DSH 主面板／设置／`shell.overlay`。这取代早期桌宠、默认角色和独立 Tauri 窗口设想；原生窗与 DPI 探针保留为历史 | [U3](spikes/U3-dsh-settings.md)、[U4](spikes/U4-quick-login.md)、原文第 15–19 节 |
| 2026-10-01～02 | 真实闭环优先官方 Desktop。复用宿主认证 RPC／Fetch registry，不修改宿主、手写 profile 或新增生产监听端口；`npm install` 仅分发，注册由 Plugin Manager／DSH CLI 完成 | [U5](spikes/U5-official-desktop.md)、[交付说明](DELIVERY.md) |
| 2026-10-02 | 用户暂缓 QQ，优先网易云与 UI；不删除 QQ，也不把网易云专项通过算成双平台完成 | [原文第 20 节](archive/decisions-through-2026-10-18.md) |
| 2026-10-02～04 | 日常直接在 `main` 开发，跨设备串行接续；提交保留英文类型前缀，标题和说明使用简体中文 | [协作规则](../AGENTS.md) |

## 进程、数据与播放

| 日期 | 选择与原因 | 依据 |
|---|---|---|
| 2026-09-27 | Core 用 Node ESM、`node:test`、`node:sqlite`；先验证宿主再锁实现。Provider 管平台、Playback 管声音、Core 管队列，可见页面不拥有音频 | [P0-01](spikes/P0-01-dsh.md)、[P0-06](spikes/P0-06-local-data.md)、[架构](ARCHITECTURE.md) |
| 2026-09-27 | Windows 使用隐藏 STA PowerShell＋WPF，经同用户命名管道和协议 v1 控制。断线取权威快照，不靠过期 supervisor 缓存；测试 WAV 现场生成 | [P1](spikes/P1-playback.md) |
| 2026-09-27～10-03 | 环境、显式反馈、Agent 偏好和 Session 影响分别保存；初始化仅补缺失偏好。有效进度与位置分开，历史／成长任务同事务、实例幂等重放，未知不写 0 | [T1](spikes/T1-environment.md)、[T3](spikes/T3-growth.md)、[N1](spikes/N1-autonomous-accounting.md) |
| 2026-09-27 | 成长只作有界非负更新，跳过和平台失败不代表讨厌，因此必须有衰减和 Session 上限，不能“选中就加分”。首版数值及理由保留在归档，不称为真人质量结论 | [T3](spikes/T3-growth.md)、[A08](spikes/A08-sessions.md)、原文第 11–14 节 |
| 2026-10-05 | 已完成成长任务和命令去重保留 30 天，未完成作业、收听历史、反馈、约束和模型账本保留；证据原本已有界，撤销“日志无限增长”的判断 | [N17](spikes/N17-p1-retention-a09.md) |
| 2026-10-06 | N19 的固定四持有者不足以稳定降低打开耗时，改为默认五个、按测量最多八个；显式 0–8 可覆盖，首曲仍冷。超时／写失败必须结束等待者 | [N20](spikes/N20-review-fixes.md) |
| 2026-10-07 | 丢失音频宿主、持续 15 秒卡住或可重试失败先恢复原曲一次，与过期地址共享预算；保持实例／位置／静音，不补计缺口，暂停和换曲可取消 | [N21](spikes/N21-playback-interruption-recovery.md) |
| 2026-10-09 | macOS 复用协议 v1，以 Swift AVPlayer／同用户 Unix socket／Keychain 适配；首次编译 Helper 到私有数据目录。Secret 不进入进程参数，Windows 路径保留 | [MACOS_PORT](spikes/MACOS_PORT.md) |
| 2026-10-11～13 | DPAPI 助手是生产依赖，移入 `src/providers/` 并随包验证；CLI 登录仍是仓库工具。退出先停用内存会话，删除失败保留撤销引用与重试，不误报清理成功 | [beta.3](releases/0.1.0-beta.3.md)、[REV-02](spikes/REV-02-credential-cleanup.md) |

## 推荐与用户控制

| 日期 | 选择与原因 | 依据 |
|---|---|---|
| 2026-10-02～03 | 真实来源先验证再接发现缓存；账号推荐不称为 Agent 风格。使用有来源的曲目／艺人／关系，流派和情绪保持未知 | [N2](spikes/N2-netease-discovery.md)、[N4](spikes/N4-environment-profile.md)、[N5](spikes/N5-seeded-recommendation.md) |
| 2026-10-03～04 | 喜欢／少推荐独立可撤销，不覆盖 affinity 或同步平台收藏；重置偏好与清空输入分开，均保留账号／历史／账本。下一首是用户触发的推荐，不是用户指定歌曲 | [N10](spikes/N10-feedback-reset.md)、[N11](spikes/N11-model-playlist.md) |
| 2026-10-05 | Normal／Focus 恢复声音；独立开关不改另一个开关。“今天停止”必须有 `chooseSelf` 恢复入口，失败返回真实原因，避免按钮看似失效 | [U11](spikes/U11-mode-autonomy-restore.md) |
| 2026-10-05 | 歌单耗尽时，用户主动下一首可按相同过滤／评分回退输入曲库，并如实标注；自主续播仍不回退。此项修订 N11 的单一候选限制 | [N14](spikes/N14-user-next-library-fallback.md) |
| 2026-10-05 | 画像显式失效缓存；个人相似图用歌单共现、艺人和播放关系补充本地评分。关系事实可进入模型输入，不靠孤立歌名猜风格；Last.fm 富化待 key | [N16](spikes/N16-p0-cache-track-graph.md)、[N18](spikes/N18-p2-progress-and-relations.md) |
| 2026-10-07 | 用户收拢为“参考歌曲 → 平台候选 → LLM 严格筛选 → 本地播放”。取代 N11 直接生成歌名和 N15 仅加分不排空的默认路径；旧数据／内部兼容保留。失败仅保留同账号有效旧歌单 | [N22](spikes/N22-platform-first-recommendations.md) |
| 2026-10-08 | 平台工作与播放控制分开排队；曲库全库搜索／后端分页，迟到平台和查询结果不可覆盖新状态。清空／重置／撤销另以输入代次取消旧导入，快照以 revision／commandVersion 去旧 | [U17](spikes/U17-control-library-fixes.md)、[REV-01](spikes/REV-01-import-reset-race.md)、[REV-03](spikes/REV-03-snapshot-ordering.md) |
| 2026-10-18 | 固定输入证明反馈总数会丢失歌曲归属，补候选逐曲 `liked/reduced`，撤销移除；不改权重、迁移或调用次数。本地偏好仍按数据目录保存，不能宣称账号级画像隔离 | [#9 信号语义](research/PREFERENCE_SIGNALS.md) |

## 模型与验证口径

| 日期 | 选择与原因 | 依据 |
|---|---|---|
| 2026-10-03～05 | 逐曲执行／解释零模型请求；总结、歌单和候选筛选为计划内低频调用，共享预算并全部入账。此项取代早期笼统“音乐零请求”；静态工具描述的 token 影响单独核对 | [N9](spikes/N9-transparent-persona.md)、[N17](spikes/N17-p1-retention-a09.md) |
| 2026-10-09 | 手动挑歌取消 U16 的 15 分钟冷却和倒计时；自动筛选仍限频，保留并发、次数、预算和失败计费，平台一分钟刷新节流与同批缓存保留 | [U18](spikes/U18-manual-picking-without-countdown.md) |
| 2026-10-12 | HTTP 200／推理流不代表成功；必须检查最终回答和结束原因。输出耗尽不应用截断文本，纯推理独立报错，不自动加额／重试；输出可设 64–4096，默认 256、共享预算保留 | [N23](spikes/N23-model-route-completion.md) |
| 2026-10-16 | 用户取消两小时连续观察，改用代码级故障注入与回归核查逐曲零请求；取消不等于通过，DSH 启停对照／归因仍待验。真实指标无法采集时保持 `unknown`，不能用模拟计数补齐 | [蒸馏前状态记录](archive/development-through-2026-10-18.md)、[REV-04](spikes/REV-04-host-failure-isolation.md) |
| 2026-10-18 | 推荐质量先用固定输入／冻结候选和人工评价研究，真实试用后置；无真实样本时比例为 `null`，不调生产策略或宣称收益 | [研究入口](research/README.md)、[试用卡](research/TRIAL.md)、[探索对照](research/EXPLORATION.md) |

## 界面、表达与素材

| 日期 | 选择与原因 | 依据 |
|---|---|---|
| 2026-10-02～07 | 保持 PHL 视觉和现有角色，客户端本地模块生成单文件，不新增动效库。主界面聚焦歌曲／理由／控制，模型和用量收入设置，取代旧画像与 token 常显要求 | [U7](spikes/U7-phl-ui-motion.md)、[U15](spikes/U15-balanced-layout.md)、[N22](spikes/N22-platform-first-recommendations.md) |
| 2026-10-07 | 用户要求 GIF、静态衍生图与六张 doll PNG 一起打包，取代最初仅本地提取方案；开关无文字／无悬停说明、默认关闭，保留键盘／无障碍语义及本机同步。打包指令不改变素材许可 | [U12](spikes/U12-playback-dolls.md)、[U13](spikes/U13-easter-review-fixes.md)、[第三方声明](../THIRD_PARTY_NOTICES.md) |
| 2026-10-18 | U19 先做当前有效批次只读投影，沿用历史 JSON、以 modelCallId 关联经历；有声听过须实测 audibleMs 达阈值。不增表／发送／通知／模型调用或永久跨批历史 | [U19](spikes/U19-recent-discoveries-prototype.md) |
| 2026-10-18 | U20 用 settings 的结构化预设与独立 revision，避免 persona.md／自由指令的额外范围。仅改变有依据的本地说明，音乐状态优先；不进入模型事实，保存不阻塞播放 | [U20](spikes/U20-expression-style-prototype.md) |

第三方来源、版本、文件范围与许可只维护在 [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md) 和 [依赖许可清单](../DEPENDENCY_LICENSES.md)，不在决策表重复许可结论。未核实的参考项目仍保留在归档，不能当作已获授权或已验证接口。
