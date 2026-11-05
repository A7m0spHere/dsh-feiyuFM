# 决策摘要

更新：2026-11-05。这里只保留仍影响开发的选择、理由与修订关系。行为和参数定义见 [MVP](MVP.md)／[控制契约](CORE_CONTRACT.md)，部署、测试数量和验收状态只维护在 [开发状态](PROJECT_PLAN.md)。

原第 0–46 节、D01–D13、依赖调研、参数理由与历史现场记录完整保存在 [决策原文](archive/decisions-through-2026-10-18.md)。旧报告中的节号指向该归档；它们不覆盖后续修订。新增决策记录日期、触发原因、选择、取代的旧规则和证据，不复制执行流水。

## 产品范围与宿主

| 日期 | 选择与原因 | 依据 |
|---|---|---|
| 2026-09-27 | 名称为肥鱼电台 FeiyuFM，仓库 `dsh-feiyuFM`；v0.1 保留网易云与 QQ 双平台范围，用户可只连接一个。偏好独立于用户环境，未知特征不猜测 | [原文第 1–3、6 节](archive/decisions-through-2026-10-18.md)、[MVP](MVP.md) |
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
| 2026-10-21 | 实际记录出现同批歌曲隔 5 首重播，30 分钟时间门控不足；用户选择最近 50 次开始优先避重复、最多 100 首多批有效入选池、缺歌时最久未播续播并允许放宽时间冷却。修订早期只按时间过滤／评分的重复策略，保留严格入选、账号／到期和预算边界 | [N25](spikes/N25-recent-playback-and-approved-pool.md) |
| 2026-10-23 | #12 将项目 HTTP transport 从无来源 Cookie 与自动跳转改为显式单 origin、路径／安全属性 Cookie、受控同源跳转及有界正文。Node 原生跨端口跳转未复现 Cookie 转发，不记为泄露事件；固定版本接口包内部 HTTP 不随此次重写。移除新登录借用旧 jar 的回退，CLI 模拟必须使用回环与内存凭据 | [REV-05](spikes/REV-05-http-transport-boundaries.md) |

## 模型与验证口径

| 日期 | 选择与原因 | 依据 |
|---|---|---|
| 2026-10-03～05 | 逐曲执行／解释零模型请求；总结、歌单和候选筛选为计划内低频调用，共享预算并全部入账。此项取代早期笼统“音乐零请求”；静态工具描述的 token 影响单独核对 | [N9](spikes/N9-transparent-persona.md)、[N17](spikes/N17-p1-retention-a09.md) |
| 2026-10-09 | 手动挑歌取消 U16 的 15 分钟冷却和倒计时；自动筛选仍限频，保留并发、次数、预算和失败计费，平台一分钟刷新节流与同批缓存保留 | [U18](spikes/U18-manual-picking-without-countdown.md) |
| 2026-10-12 | HTTP 200／推理流不代表成功；必须检查最终回答和结束原因。输出耗尽不应用截断文本，纯推理独立报错，不自动加额／重试；输出可设 64–4096，默认 256、共享预算保留 | [N23](spikes/N23-model-route-completion.md) |
| 2026-10-16 | 用户取消两小时连续观察，改用代码级故障注入与回归核查逐曲零请求；取消不等于通过，DSH 启停对照／归因仍待验。真实指标无法采集时保持 `unknown`，不能用模拟计数补齐 | [蒸馏前状态记录](archive/development-through-2026-10-18.md)、[REV-04](spikes/REV-04-host-failure-isolation.md) |
| 2026-10-18 | 推荐质量先用固定输入／冻结候选和人工评价研究，真实试用后置；无真实样本时比例为 `null`，不调生产策略或宣称收益 | [研究入口](research/README.md)、[试用卡](research/TRIAL.md)、[探索对照](research/EXPLORATION.md) |
| 2026-11-01 | #7 以两批自然数据、独立人工评价、筛选输入审计和“无可验证重排收益则保留原策略”完成研究结项。用户要求推进至关闭，取代本日首轮补证期间暂留打开的阶段约定；不把单曲遗漏线索直接变为算法改造，也不把未取得的大批次或长期体验设为无期限结项门槛。更广体验保留 #11，探索改动仍按 #10 的收益条件另行实施 | [#7 基线与审计结项](research/ISSUE_7_BASELINE_20261101.md) |
| 2026-10-30 | 补充 2026-10-16 的取消决定：用户后来完成的两小时播放按用户实测反馈单列，不恢复阻塞门槛、不改写旧短跑，也不由播放完成推定请求／资源／成长专项通过。短周期重复按实际数据定位后再决定是否修复 | [两小时播放补充报告](spikes/R2-two-hour-playback-20261030.md) |
| 2026-10-30 | 用户明确要求 50 首内不重复；最近 50 次实际开始改为自动续播／普通下一首／推荐队列的硬限制，取代 N25 缺歌时最久未播的回退。小池耗尽等待新入选曲，保留明确点播例外和既有补批预算；短暂播放后跳过也占窗。选择标识升为 `local-v7`，旧历史不改写 | [N26 硬性播放窗口](spikes/N26-hard-repeat-window.md)、[历史重复实证](spikes/R2-two-hour-playback-20261030.md) |

2026-11-01 持续补歌修订：用户现场出现 32 首有效批准均在最近 50 次内、12 次后台筛选耗尽但 Token 预算仍有余额。按用户要求将初始日预算提高到 100000，取消筛选每日次数及成功冷却，以整个窗口外有效池的 12／24 首水位补批，轮换召回种子并持久化已评候选；保留本地下一首、严格入选、50 次窗口、单任务并发和真实预算。此项取代 N22／U18 的筛选限额和 N26 保留原补批门控的部分，见 [N27](spikes/N27-continuous-recommendation-supply.md)。

## 界面、表达与素材

2026-11-05 陪伴区横排修订：用户指出人物周围留白过多，明确要求人物左、相关文本右，并在三个预览中选择 A。取代 U26 在中等宽度（原 960px 容器条件）把人物与文本上下堆叠的规则；保留均衡人物大小，窄容器先移动歌词到下一行，人物与文本继续并排并缩小。重复反馈状态说明收起，错误提示保留。选择与实际布局证据见 [U27](spikes/U27-companion-horizontal-layout.md)。

2026-11-05 控制台歌词：用户确认逐行滚动与当前句高亮，默认原文、翻译／音译按需开启，首版必须支持点击跳转，取代[初稿](design/FEAT_CONSOLE_LYRICS.md)的默认双语和暂不跳转建议。复用 MIT 的 lrc-kit 1.2.1 解析，沿用本地 React／CSS，AMLL 保留为未来调研参考；只读词源独立于播放链路，原地 seek 保留实例和暂停优先，跳过时间不计有效经历。词源提供什么就显示什么，不增加模型请求。实现证据见 [U26](spikes/U26-console-lyrics.md)。

| 日期 | 选择与原因 | 依据 |
|---|---|---|
| 2026-10-02～07 | 保持 PHL 视觉和现有角色，客户端本地模块生成单文件，不新增动效库。主界面聚焦歌曲／理由／控制，模型和用量收入设置，取代旧画像与 token 常显要求 | [U7](spikes/U7-phl-ui-motion.md)、[U15](spikes/U15-balanced-layout.md)、[N22](spikes/N22-platform-first-recommendations.md) |
| 2026-10-07 | 用户要求 GIF、静态衍生图与六张 doll PNG 一起打包，取代最初仅本地提取方案；开关无文字／无悬停说明、默认关闭，保留键盘／无障碍语义及本机同步。打包指令不改变素材许可 | [U12](spikes/U12-playback-dolls.md)、[U13](spikes/U13-easter-review-fixes.md)、[第三方声明](../THIRD_PARTY_NOTICES.md) |
| 2026-10-18 | U19 先做当前有效批次只读投影，沿用历史 JSON、以 modelCallId 关联经历；有声听过须实测 audibleMs 达阈值。不增表／发送／通知／模型调用或永久跨批历史 | [U19](spikes/U19-recent-discoveries-prototype.md) |
| 2026-10-18 | U20 用 settings 的结构化预设与独立 revision，避免 persona.md／自由指令的额外范围。仅改变有依据的本地说明，音乐状态优先；不进入模型事实，保存不阻塞播放 | [U20](spikes/U20-expression-style-prototype.md) |
| 2026-10-18 | 用户选择反馈管理首版仅查看与逐条撤销。沿用反馈表、增加独立递增版本；撤销留中立行以防重置恢复复活旧票，保留当前歌曲实例校验。以 DSH 插件及隔离 profile 验证，不以日常 Desktop 为前置 | [U21](spikes/U21-feedback-management.md) |
| 2026-10-28 | 用户要求工作区左缘的 ASCII 频谱作为背景融入（非悬浮块）。调查 DSH 0.2.1-rc.3：没有会话背景插槽，`conversation.content` 由会话包独占，最小侵入方案是 `shell.overlay` 条目，几何由 `[data-conversation-content]`（正文容器）、`[data-composer-card]`／宽度手柄运行时实测，不写死屏幕坐标、不挂 body、不改正文布局。真实 FFT 受阻：音频在 WPF 宿主播、播放协议无样本流、页面无音频元素，故采用本地时钟模拟（明确标注非音频测量），不伪装成真实频谱。用 ASCII 字符矩阵替代参考代码的 Three.js 渲染链（更轻、无 GPU、无全屏 canvas），借鉴字符集、亮度映射、波浪与等宽排版；宽度参考截图取 160px、随留白自适应 | [U22](spikes/U22-ascii-spectrum-backdrop.md)、[MVP §5](MVP.md)、[架构](ARCHITECTURE.md) |
| 2026-10-28 | 频谱运动改由独立模拟时钟驱动，不再随绘制节拍推进。原因：原实现每次 rAF 刷新 `last`、仅在跨帧间隔时 `engine.step(dt)`，60Hz 屏幕上 4 秒真实时间只推进约 0.68 秒模拟，轻量档更慢。改为固定步长（1/60s）＋250ms 追赶上限的驱动层：绘制频率只决定采样疏密，屏幕刷新率不改变速度，后台恢复不跳帧。动画 effect 依赖收敛到可见性与动效档位，播放状态／进度走 ref；同种子 `reseed` 为 no-op；网格变化只用最近一帧重画。取代上一行的逐帧 `dt` 计时实现 | [U22](spikes/U22-ascii-spectrum-backdrop.md)、`test/spectrum-bars.test.mjs`、`test/spectrum-backdrop.test.mjs` |
| 2026-10-28 | 频谱观感从「竖向柱＋镜面倒影」改为分层浪线海面：顶部浪脊即谱轮廓（每列浪高＝频段能量），下方逐层跟随轮廓、按透视变平变淡，断口按浪段成块出现；海的高度与浪段密度跟整体能量走，暂停后明显退潮。只改字符矩阵，不引入 Three.js／WebGL；新增 `FIELD_WAVE` 承载斜线字符。取代同日早前的柱状取景 | [U22](spikes/U22-ascii-spectrum-backdrop.md)、`test/spectrum-bars.test.mjs`、[MVP §5](MVP.md) |
| 2026-10-28 | 鲸鱼彩蛋落地为「同一张字符矩阵里的低频事件」：字母格取自 dsh-TUI／dsh-ui-whale 的像素鲸鱼轮廓，降采样到 18×9 后写进频谱那张网格，不新建浮层、不用贴图或 emoji；五阶段状态机（潜伏→浮出→跃起→下潜→涟漪）共 5.3 秒，95 秒冷却、每次掷 30% 骰子，窄网格与暂停／关闭／减少动态一律跳过或立即取消。复用范围为四个姿态的降采样轮廓，按 BSD-3-Clause 记来源与许可 | [U22](spikes/U22-ascii-spectrum-backdrop.md)、[第三方声明](../THIRD_PARTY_NOTICES.md)、`test/spectrum-whale.test.mjs` |
| 2026-10-29 | 隔离 DSH 现场验收暴露两个缺陷并各自定案：① 改窗口宽度时鲸鱼会消失一帧——原因是 resize 分支只重画海水；改为海面与鲸鱼共用 `composeField()`，animation frame 与 resize 都走它。② 默认节奏下彩蛋在真实播放中永不出现——原因是切歌时 Core 短暂进入 `resolving`，界面 `active` 掉线把 95 秒冷却反复清零；彩蛋改用更宽的"在听"判据（连接正常、有快照、未暂停、无错误、非 idle），暂停／停止／出错仍立即取消。两处都由回归断言固定 | [U22](spikes/U22-ascii-spectrum-backdrop.md)、`test/spectrum-backdrop.test.mjs` |
| 2026-10-29 | 按用户本轮视觉要求，以底锚 ASCII 密度柱取代 2026-10-28 的横向海面决策，保留挂载、几何、时钟与鲸鱼导演。字符网格＋连续位移交给局部 Canvas 绘制，解决整数格扭曲跳变；不引入 Three.js，字形只在初始化测墨排序。完整档改为 24fps；浅深色分别调亮，渐隐移到正文侧末段。鲸鱼限制尺寸、擦除实体内部原柱体并按完整姿态缓存；换曲保留已开始的背景能量，静态档响应主题。真实 FFT 仍未实现。用户随后指定已有 Web 端后台静默复验，早期原生证据与最终 Web 证据分别记录 | [U22](spikes/U22-ascii-spectrum-backdrop.md)、[MVP §5](MVP.md)、`test/spectrum-backdrop.test.mjs` |
| 2026-10-30 | 按最新坐标要求修正 U22：以 Sidebar 右边界为左基线，频段沿 Y 从上到下排列，能量决定 X 条长；取代 2026-10-29 的底锚竖柱方向。条数由可用行数决定，两行条体＋空行，常规 960px 显示26条；弯曲改为末端上下亚字符位移，禁止旋转字形。鲸鱼活动带由纵向频段选定并固定行列比例，仍在同一网格合成；位置／颜色／透明度／时钟不变，只用隔离 Web 后台取证 | [U22](spikes/U22-ascii-spectrum-backdrop.md)、[MVP §5](MVP.md)、`test/spectrum-bars.test.mjs` |
| 2026-10-30 | 用户要求将 `feat/ascii-spectrum-bars` 合入 main 并提交 PR，解除此前仅在独立分支接续的约束。沿用最终灰黑左锚横条与同网格鲸鱼，并保留 main 的 N26 最近 50 次硬性防重复；合并不代表 npm 发布或日常 Desktop 已加载，真实 FFT 与原生／长期性能缺口保留 | [U22](spikes/U22-ascii-spectrum-backdrop.md)、[N26](spikes/N26-hard-repeat-window.md)、[开发状态](PROJECT_PLAN.md) |

2026-11-01，用户反馈主面板杂乱、暂停／下一首点击不顺畅。本轮 U23 将日常播放与低频设置分开：设置统一默认收起，歌单先展示 3 首；取代原来同时铺开两栏模式／偏好和多栏管理的默认布局，保留既有角色、彩蛋及全部设置入口。播放请求独立投影等待状态，暂停可取代未确认的播放／换曲，准备期间只加快轻量快照读取。Core 本来已先确认命令，本轮不修改其播放协议、推荐策略或模型预算。行为和证据见 [U23](spikes/U23-controls-and-panel.md)。

2026-11-01，用户在交互预览中选择第二版“陪伴电台”，要求保留一个设置 UI 入口和 doll 小开关。U24 用角色／歌曲主视图、可选池和常驻控制组织主面板，低频设置进入右侧抽屉，取代 U23 的主页面折叠设置组织。doll 的无文字／无悬停说明左右开关、默认关闭、原素材和本机偏好同步保持原契约；全池只增加安全只读投影，复用 N27 补池和既有控制，不改变推荐、成长或预算。设计、实现与实际边界见 [U24](spikes/U24-companion-player.md)。

2026-11-02，用户按截图指定将设置迁入顶部标签栏，并确认作为第四个完整页面。此修订取代 U24 初版的右上角按钮／右侧模态抽屉：顶部按正在听、发现记录、偏好与反馈、电台设置排列，设置在主内容区按宽屏两列／窄屏单列展示，所有页面共用一个底部播放控制。页面保持挂载以保留设置草稿；原生设置席位和客户端模型选择继续复用。没有新增 RPC、存储字段、依赖或模型调用。行为与修订证据见 [U24](spikes/U24-companion-player.md)。

2026-11-03，用户要求修复“上一首后下一首直接推荐新曲”及预取竞态。历史前后导航统一由 MusicCore 的固定快照游标协调，取代此前“next 一律重新锚定”的行为；新推荐、自然续播和点播才重建锚点。Selector 继续只做推荐，评分和最近 50 次自动窗口保持；显式历史重播与点播一样是用户例外。URL 解析与宿主媒体预加载分阶段管理，底层解析自行持有取消控制，已选目标先交接给前台；超时退役旧请求再重试。备用播放器以精确资源/宿主代次/token 防止迟到覆盖，并补原取消请求的终结应答。保留原双播放器及 3000ms 预取延迟，通过阶段实测判断后续优化，范围与证据见 [R3](spikes/R3-playback-navigation-prefetch.md)。

同轮真实隔离 DSH/网易云阶段计时确认 Core 接受路径有额外完整快照，且自动池耗尽时手动曲库回退没有被准备。播放 RPC 改为复用 dispatch 接受快照，设置更新仍重新投影；预取可准备手动回退目标但不得让自动续播使用该目标。此项修订前轮“只 peek 自动候选”的准备范围，不改变 Selector 评分或自动池边界，证据与复测见 R3。

2026-11-03，用户确认主页四个标签页已完整承载全部配置操作，移除 DSH 全局设置中重复的「肥鱼电台」`settings.section` 席位，只保留侧栏主面板入口；悬浮播放器菜单「打开肥鱼电台设置」仍打开主面板。此修订 U24 决策中「原生设置席位保留」的部分，客户端模型选择仍由同一控制器保存；不改后端、播放、推荐、数据库或模型。四标签页布局见 [U24](spikes/U24-companion-player.md)，本轮回归计数与验证边界见 [开发状态](PROJECT_PLAN.md)。

2026-11-03，用户补充角色图像作者与来源公告，要求版权信息集中到一个 Markdown 文件，README 只保留鲸鱼娘（大肥鱼）的形象来源。版权范围与第三方依赖清单合并到 THIRD_PARTY_NOTICES，取代单独维护 DEPENDENCY_LICENSES 的方式；生成器只更新标记区域，保留人工核对的署名、改动说明与原许可。旧报告中的许可结论按其记录日期阅读，当前来源与使用范围以统一声明为准。

第三方来源、版本、文件范围与许可只维护在 [版权声明](../THIRD_PARTY_NOTICES.md)，不在决策表重复许可结论。未核实的参考项目仍保留在归档，不能当作已获授权或已验证接口。

2026-11-04，用户确认首个正式版本使用 npm 包名 `dsh-feiyufm`，产品名称统一为肥鱼电台 FeiyuFM。客户端模块标识与 npm 包名同步；既有 RPC、命令、环境变量与本机数据目录保留兼容，以便换包来源后继续使用原曲库和偏好。已发布测试版的包名、标签和原始证据保留在历史发行记录中。

2026-11-04，首次安装故障证实 GitHub 归档不含 `node_modules`，而源码 manifest 的 `bundleDependencies` 让 pnpm 跳过网易云依赖，Core 因 `MODULE_NOT_FOUND` 退出。修订分发方式：源码 manifest 保留普通 dependencies，仅在临时发行树添加 bundle 标记；`npm run pack:release` 生成自带依赖与许可的 tgz，禁止直接从源码目录 publish，发布前仍需测试与包验证。正式 0.1.0 tarball 内容及版本不倒改。初始化各分项独立结算，错误明确显示并可重试，不改音乐策略、导航或数据库结构。依据见 [P0-07](spikes/P0-07-initial-state.md)；本轮按用户要求保留修复分支、不合并 main、不发布 npm。

同日 P0 收尾用永不完成的 library 证明 `allSettled` 仍会阻塞已就绪的平台，修订上条中的“各分项独立结算”：初始响应不再等待未完成的曲库，通过 `libraryPending` 使用既有独立查询，并保留真实超时与用户重试。运行依赖打包前核对 shrinkwrap 的版本、依赖声明和全部运行依赖版本，打包后核对每个锁定依赖 manifest 都在 tgz 中；tgz 发布不执行目录生命周期，发布前的测试与实包验收必须显式执行。反例、同机 WPF 对照、0.1.1 临时版本演练及边界继续记录在 P0-07，不扩大为架构改造。

2026-11-04，用户另行启动 P1 首次使用轻量引导，从 P0 的 `ce463a1` 派生 `feat/first-use-guide`，不合并或发布。选择正在听页面内卡片、复用四页切换及实际账号／导入控件；版本化本地记录替代音乐数据库字段，缺少数据时保守等待，旧用户默认静默。未完成状态可继续，跳过／完成保持；不将临时挂载或后台判定简单记为“用户已看过”。真实宿主与模拟界面证据分列，授权、导入和播放不由引导代执行，见 [U25](spikes/U25-first-use-guide.md)。
