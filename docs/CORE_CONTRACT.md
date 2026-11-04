# 内部控制契约

更新：2026-11-03。本文只维护内部字段、命令与边界，DSH 外部接口经 Adapter 映射；职责见 [架构](ARCHITECTURE.md)，用户行为见 [MVP](MVP.md)，实现／部署／验收状态只看 [开发状态](PROJECT_PLAN.md)。历史理由查 [决策摘要](DECISIONS.md) 与 [实验记录](spikes/README.md)。

## 1. 曲目、账号与资源

Track key 为 `(provider, providerTrackId)`，`provider` 仅为 `netease/qq`，字符串键为 `provider:providerTrackId`。标题不能替代 ID，不凭同名跨平台合并。可带 `title/artist/artists/durationMs/metadataSource`，缺失时长和特征保持未知。

Provider 暴露账号和能力状态，`resolve(track, {signal, version})` 返回 `{handle, expiresAt?}`。handle 仅交 Playback，不进 SQLite、Core/UI 快照或模型输入。缺能力、过期账号、无可播资源和空候选分别报告。

网易云导入可指定 `source/playlistId`，保留实际来源、sourceRef、数量及失败尝试。核对 `login_status` 账号 ID 后才保存平台凭据引用（Windows DPAPI，macOS Keychain）；退出先停用会话，再按第 3 节的失败／重试规则清理。QQ 不显示未核实的扫码入口。

项目 HTTP transport 必须显式提供独立于端点表的单一 `trustedOrigin`。Core 将网易云固定为 `https://music.163.com`；QQ 无生产端点，未来自定义 HTTP profile 必须声明自己的 origin。URL 中不接受用户名／密码，默认只允许 HTTPS；`allowInsecureLoopback` 仅供显式 IP 回环测试。端点在构造与每次请求前校验，`redirect: manual` 最多跟随 5 次同源跳转，跨源（含端口／子域变化）和 HTTPS→HTTP 在发下一次请求前拒绝；301/302 的 POST 与 303 按 GET 续接，307/308 保留方法与表单。

每个 transport 独有 Cookie jar，不再支持注入共享 jar。`useSecret` 清空旧会话后，将已有原始凭据头绑定至本 origin 的 `/`；HTTP `Set-Cookie` 按来源校验 Domain，并保留 Path／Secure／到期与删除语义。origin 始终精确匹配，父域 Cookie 也不扩大可访问站点；`toSecret(url)` 只输出该 URL 可发送的 Cookie。`loginQr/loginPoll` 使用请求内新 jar，既不发送旧 Cookie，也不从旧 jar 补全登录结果；共用 Provider 状态机同样不允许该回退。`includeCookies: false` 不发送、不吸收、不返回本地会话；描述符不能自行附加 Cookie／Authorization 或 Host 头。

`HTTP_LIMITS` 默认正文 4 MiB、Cookie 16 KiB；`maxResponseBytes/maxCookieBytes` 可在 transport／内部 adapter 配置调整，`maxRedirects` 在 transport 调整。正文同时检查 Content-Length 和解压后实际流字节，超限取消流；Cookie 输入与全 jar（含路径）均受限，更新失败不部分写入。边界错误为 `endpoint_untrusted/redirect_blocked/redirect_limit/response_too_large/cookie_too_large/invalid_cookie`；网络失败只暴露固定描述和 `ETIMEDOUT/ECONNRESET`，不携带原始错误 URL、凭据或 cause。CLI 的 `FISHFM_NETEASE_BASE` 只接受 `--dry-run` 的 IP 回环模拟端点，不读取持久化凭据。

以上 HTTP 跳转／流式限额不改写固定版本网易云接口包内部的 Axios 请求；接口包调用、固定域名与验证边界见 [REV-05](spikes/REV-05-http-transport-boundaries.md)，不能据此宣称所有第三方 HTTP 路径都已受同一限额保护。

## 2. 用户命令

命令带非空 `commandId`，可带 `expectedRevision`。重复命令返回当前快照，旧 revision 返回 `stale_revision`；接受后递增 `decisionVersion`，影响播放时递增 `commandVersion` 并取消旧解析。播放控制可附安全格式 `traceId`，只用于关联 UI/RPC 的计时，不替代 `commandId` 或改变幂等语义；带 traceId 的应答附 `timing={traceId,coreReceivedAt,coreAcceptedAt}`。客户端 `getPlaybackTrace()` 保留最多 200 条内存时间戳，按播放实例关联 UI 投影，自动续播不冒用上次点击的 traceId，不增加轮询或控制请求。

| 命令 | 参数 | 约定 |
|---|---|---|
| `pause/resume` | 无 | 暂停优先；恢复保持自主/声音设置，宿主仍持有暂停曲时直接恢复，否则重新解析并尝试恢复位置；确认恢复后重建后台预取 |
| `next` | 无 | 历史回退后优先沿固定游标前进，回到最新位置后才走队列/推荐选择器；历史前进绕过自动防重复窗口，仍跳过禁播/不可播；后续历史全部被阻止时返回 `no_next_history` 且游标不动；暂停期间换曲仍暂停 |
| `previous` | 无 | 返回实际播放历史中的上一首；用户显式操作可绕过最近 50 首自动防重复窗口，但仍跳过禁播/不可播；连续返回用固定历史游标，不因新播放记录来回跳；无更早可播返回 `no_previous`；暂停期间换曲仍暂停 |
| `requestTrack` | `track` | 明确点播并解除暂停，不自动改声音或自主开关；禁播返回 `constraint_conflict` |
| `setListening/setHumanPlayback/setDiscovery` | `value: boolean` | 独立开关；关闭自主会暂停当前 Agent 曲目 |
| `setDiscoveryRate` | `value: 0..1` | filtered 模式作筛选偏好，0 不自动播陌生曲；旧兼容模式仍作池选择概率 |
| `setMode` | `normal/focus/silent/off` | normal/focus 启用自主并恢复声音；silent 静听；off 关闭两开关并暂停 |
| `stopForToday/chooseSelf` | 无 | 禁止当日自主并暂停 / 解除当日限制、开启自主并尝试恢复 |
| `banTrack/unbanTrack` | `track` | 独立用户约束，不暗中取消禁播 |
| `setTrackFeedback` | `track, playInstanceId, value: -1/0/1` | 校验当前曲目与实例，旧实例返回 `stale_track`；不改 affinity 或平台收藏 |
| `resetTaste/resetLibrary` | `value: {clearFeedback: boolean}` | 保存可撤销恢复点，与去重记录同事务；模型预留/运行中返回 `summary_busy` |
| `undoTasteReset` | 无 | 恢复最近恢复点，缺备份返回 `no_reset_backup`，重置后新增反馈优先 |
| `setRecommendationMode` | `value: filtered/llm/platform` | filtered 默认平台召回后筛选；后两项保留内部兼容，界面不提供旧来源切换 |

`resetTaste` 保留输入曲库；`resetLibrary` 还清空输入/来源及队列。两者保留账号、历史、约束与模型账本，不改变当前播放。重置边界前的成长不能重新写回旧偏好。

成功的 `resetLibrary/resetTaste/undoTasteReset` 使此前接收的在途及排队平台导入失效；提交前校验独立输入代次，过期导入返回 `cancelled`，不写曲库、来源或偏好。暂停、音量等播放控制不改变输入代次，且仍可越过慢平台队列。

推荐下一首记 `selectedBy='agent'、selectionTrigger='user-next'`，保留来源、评分和 decisionId；`requestTrack` 与显式历史前后导航记为 `selectedBy='user'`。历史快照在首次回退时固定，导航产生的新播放记录不改变快照或方向；新推荐、自然续播和指定歌曲重新锚定。尚未开始的当前选择只作为内存导航锚点，不据此新增实际开始记录。历史加载失败明确报错，保留该目标的游标位置，后续导航继续检查禁播/不可播；实际播放沿用原历史、有效进度和成长规则，不自动写喜欢反馈。选择不是有效收听，旧历史不倒改归属。

今天限制到期不自动解除暂停。无当前曲目时，要求开始自主而失败应返回 `autonomy_blocked/no_candidates`，不得静默无操作。完整控制语义见 [MVP 第 3 节](MVP.md)。

## 3. Host、UI RPC 与快照

初始化必须先完成 `bridge.start()`。Core 启动异常通过 `startup-error` 返回固定错误码；缺依赖为 `dependency_missing`，启动超时为 `core_start_timeout`，意外退出为 `core_exited`，请求超时为 `core_request_timeout`。不把原始异常、路径或凭据放进启动应答。

`fishfm/state` 的 snapshot 为必要结果；platforms／library 分别结算，失败时保留其余成功结果，附 `platformError`／`libraryError` 固定描述与安全错误码，不伪造平台可用性或清空已有曲库。platforms 失败时客户端收起账号操作并提供“重试连接状态”；曲库失败不阻断可用平台的扫码入口。客户端状态读取 18 秒到期后必须结束本次等待、释放读取锁，即使宿主 RPC 忽略 abort 也能重试；迟到应答不写入新状态。

曲库不参与初始化的完成屏障：snapshot／platforms（完整读取时还含原有画像项）就绪后，只收集此时已完成的 library；未完成则返回 `libraryPending:true` 并取消本次初始曲库请求，不伪装成读取失败。客户端通过既有 `fishfm/library` 独立读取；轮询不取消或重复启动该查询，旧页码／旧代次不能覆盖新结果。独立读取同样有 18 秒实际结束等待的上限，超时只显示曲库错误和重新查询入口，保持平台登录可用；失败后由用户重试或后续成功的状态曲库结果恢复。不新增接口或存储结构。

初始化诊断记录 `type=initialization`、`phase=core-start/snapshot/platforms/library`、`status=started/ok/error`、安全 `code` 与 `durationMs`。客户端 `getInitializationTrace()` 保留最多 60 条 RPC 阶段、错误码及耗时；不携带请求 payload、账号、曲名、Cookie、二维码 key 或链接。证据与安装边界见 [P0 初始化修复](spikes/P0-07-initial-state.md)。

Host 协议 v1 使用 JSON-lines：启动发 `ready`，请求返回带 `id` 的 `result/error`，状态变化发 `state`，退出发 `exiting`。快照含递增 `revision`、开关、策略、队列、当前实例、暂停和错误，不含凭据或 handle。

客户端所有快照入口统一拒绝较低 `revision`；相等时拒绝较低 `commandVersion`。正常 Core 重启保留存储 revision，增加 commandVersion 并恢复暂停，因此重连可接收暂停，重启前迟到响应不能覆盖它。独立 playbackEpoch 继续保护本地播放命令取代的请求。

`command` 应答代表接受后的快照，可能仍是 `resolving`；异步失败经后续状态呈现。控制/读取不被慢账号或导入排队，stdio 持续接收取消命令。调试用 `wait` 等媒体任务收尾，`setQueue/autonomous` 为固定候选及调试入口。

播放链路（2026-11-03 优化）：切歌时先并行启动平台解析与（旧宿主上的）停止，解析结果命中资源缓存或后台预取时不再请求平台；宿主声明 `autoplay/reuseSwitch` 能力时，`load` 一次完成打开、静音与起播，且用 `Open()` 替换旧源而不先 `Stop()+Close()`，避免把网络流拆除耗时放进用户等待路径；旧宿主仍走 `stop→resolve→load→mute→play` 兼容路径。宿主声明 `preload` 能力时，下一首的媒体在后台用备用播放器打开（`preload`），切歌时暂停旧播放器并交换引用（`load{usePreload:true}`），用户等待从一次冷打开变成一次换源；备用流在暂停/选中其它曲目时取消。恢复（宿主丢失/媒体过期/卡顿）强制重新解析，不复用刚失败的 handle。预取/预加载只是建议：失败或选曲变化只意味着回退到按需解析。预热池默认关闭（`FISHFM_PLAYBACK_WARM_HOLDERS=0`），2026-11-03 实测其 holder open 会与真实 load 竞争（切歌 9–14s vs 5–6s）；需要时可用环境变量 1..8 重新启用。

URL 解析与媒体预加载分为两个阶段：有效缓存或共享解析命中只省略平台请求，仍检查备用播放器；只复用同一 handle、同一宿主代次的 ready 状态。`PlaybackService.preload({resource,playInstanceId,version,signal?})` 复用相同资源的 pending/ready，`isPreloaded(resource)` 查询真实准备状态，`state().preloadStatus` 为 `idle/loading/ready`；`load()` 的 `preloaded` 返回宿主实际命中。旧任务的取消/迟到结果不能改写新备用资源，宿主必须为取消的 preload 返回一次 `cancelled`，不能遗留 IPC 请求直至超时断开管道。

后台 `preloadCancel` 使用正常 `commandTimeoutMs`，其 advisory 超时只从 IPC pending 中移除并拒绝该请求，迟到应答忽略，不能关闭正在服务前台 load 的连接。其他播放命令沿用超时关闭整条连接的默认保护。该例外只针对后台取消，不把真实宿主无响应当作前台成功。

预取先看历史前进或自动推荐；自动池无候选时，可按手动 next 的同一 `libraryFallback` 路径准备资源，但只允许手动 next 使用该回退曲，不能据此扩大自动续播范围。窥视保存并恢复 RNG，包含自动失败与曲库回退的同一选择顺序；真实选择继续由 Selector 执行。播放命令 RPC 复用 dispatch 已生成的快照，避免接受后重复计算平台发现投影；设置命令仍在更新 Provider 状态后返回新投影。

CoreHost 周期发布先检查 Core revision，未变化时不计算完整快照；发现状态变化仍通过原回调递增 revision 后发布。不新增状态缓存或改变状态推送条件。

共享解析由独立 AbortController 所有，后台取消仅撤销自己的等待；切歌选中同一资源时先交给前台，过时目标才中止底层解析。单次前台等待 4 秒，后台/底层请求上限 15 秒；前台超时会退役并中止旧请求，100ms 后真正重新请求一次，迟到结果不写缓存。缓存/预加载失效或宿主失败均保留按需加载和既有有界恢复路径。默认预取仍在确认开始/直接恢复后延迟 3000ms，保留并发资源保护。计时只记录 traceId、版本、播放实例、阶段与命中事实，不传 URL 到 UI/证据文件，见 [第二轮修复](spikes/R3-playback-navigation-prefetch.md)。

状态、发现、环境、选择与批准池投影使用批量查询（`unavailableKeys/environmentKeys/effectiveListenKeys/feedbackScores` 等），投影内容不变；逐曲 SQLite prepare 曾让一次快照占 100–360ms 并阻塞事件循环。媒体打开失败按 code 分类并在 `playback-error` 记录 `downloadProgress/bufferingProgress/openElapsedMs/expiresAt/resourceAgeMs`（不记录 URL）；`media_open_timeout` 的不可播退避为 1 分钟，`media_unavailable` 保持 30 分钟，`media_failed` 5 分钟。WPF `MediaOpened` 只在 `status='loading'` 时生效，超时后迟到的打开事件不能标记新状态。见 [R4](spikes/R4-playback-delivery-and-reliability.md)。

UI 经宿主认证 `/api` 调用；完整白名单见 [dsh-settings.mjs](../src/ui/dsh-settings.mjs)，不能把全部 Core 命令自动暴露给浏览器。

| RPC | 返回/用途 |
|---|---|
| `fishfm/state` | 默认返回 `snapshot/platforms/library/insights/persona/features`，可携带 `library:{query,offset,limit}` 保留查询页；`playbackOnly:true` 仅返回权威 `snapshot`，不读曲库／画像／模型清单；`minimal:true` 只返回 `snapshot/platforms/library/features`，不读画像、不 warm 模型，供首屏轮询使用 |
| `fishfm/profile` | 按需返回 `insights/persona/summaryModels/features`；面板切到画像相关标签页时请求一次，播放实例变化或断线重连后刷新一次，不进入 2.2s 轮询 |
| `fishfm/library` | 全库搜索与分页，只返回 `library`，不覆盖播放状态 |
| `fishfm/command` | 白名单用户命令与更新状态 |
| `fishfm/login-start/login-poll/logout` | 网易云扫码、账号确认、退出 |
| `fishfm/import/playlists` | 来源导入与账号歌单，保留数量/尝试轨迹 |
| `fishfm/discovery-refresh` | 后台刷新状态，可补跑一次有预算的筛选 |
| `fishfm/persona-summary/persona-recommendations` | 旧展示总结 / 平台召回后模型筛选；后者不生成歌名 |
| `fishfm/persona-budget/persona-output/persona-automatic` | 预算、输出上限与自动更新设置 |
| `fishfm/expression-style` | 独立表达配置，参数和版本规则见第 8 节；不返回播放快照 |
| `fishfm/feedback-list` | `query/filter/offset/limit`，返回 `feedbackPage`，不返回播放快照 |
| `fishfm/feedback-clear` | `track/commandId/expectedRevision/view`，返回 `feedbackPage/feedback`，版本属于反馈域 |

U23 客户端将请求中状态与音频状态分开投影；暂停可抢占当前页面未确认的播放／换曲，撤销其 RPC 等待并忽略迟到的应答／错误，已写入 Core 的命令仍由 Core 接管。每个写请求有自己的取消控制器与超时；旧请求不能释放新请求的 UI 锁或覆盖其快照。待确认或 `resolving/selecting` 时，以 500ms 间隔串行读取 `playbackOnly`；正常轮询仍为 2200ms，隐藏、取消订阅、停用时清理加速计时器。不增加模型调用或更改原生音频协议。见 [U23](spikes/U23-controls-and-panel.md)。

`logout` 分离会话停用与持久化清理：清理失败返回 `credential_cleanup_failed`（可重试），带 `cleanupPending/sessionDisabled`；内存 secret、cookie jar、扫码会话与发现缓存仍清空。数据库保留 `revoked` 引用，重启不复用残留凭据；账号显示 `login_required/cleanupPending`，再次退出可重试删除。只有删除完成或凭据已不存在才移除引用并提示清理成功。

Host `library` 接收 `query/offset/limit`：关键词最多 200 字符，offset 为非负安全整数，limit 为 1–100（默认 12）。按标题/艺人/平台 ID 在全库搜索，返回 `total/matched/query/offset/limit/tracks/firstTrack`；偏移超出结果时收敛到最后一页，空结果回到 0。`firstTrack` 独立于查询，供手动模式在空搜索结果时开始播放。只返回安全曲目元数据，UI 不接受音频 URL。`insights` 统计按最近 200 次决策关联，不代表历史全期；反馈、成长与解释独立。业务错误有应答不等于 Core 断连；平台失败后以补查状态的结果更新连接标记，无法补查时保留实际错误语义。客户端平台任务与播放命令分别持有取消控制器；慢登录/导入不阻塞播放控制或状态轮询，命令之后到达的旧平台快照不能覆盖播放。曲库查询使用独立代次，旧搜索、旧轮询和旧平台响应不能替换新查询页。见 [U17](spikes/U17-control-library-fixes.md)。

### 本地频谱渲染边界

工作区背景只读取既有安全播放快照与本机动效偏好，不新增 RPC、模型事实或持久化频谱数据。`createSpectrumEngine().step(dt, {frequencyBands})` 为未来归一化频段预留本地输入口：非空数组按频率位置采样并限于 0..1，缺省／空数组使用模拟输入，均经过相同包络和峰值链；该口尚未接入真实 FFT。渲染输出统一字符矩阵、上下连续位移与左侧基线／水平条长信息，鲸鱼改写同一矩阵后交给一个透明 Canvas；UI 不接受媒体 URL、凭据或音频样本。见 [U22](spikes/U22-ascii-spectrum-backdrop.md)。

### 历史反馈管理

`feedback-list` 的 filter 为 `all/liked/reduced`，query 最多 200 字符，offset 为非负安全整数，limit 为 1–100、默认 12。只查询 score=±1，按更新时间倒序、曲目键升序；搜索歌名／艺人／平台 ID，百分号和下划线按普通字符处理。`feedbackPage` 含 `version/revision/query/filter/offset/limit/total/matched/counts/items`；total、counts 是全部有效反馈数量，matched 是筛选搜索结果，offset 收敛到有效页。items 只含 `key/track/score/updatedAt` 的安全元数据。

`settings.feedback_revision_v1` 缺省为 0，读旧库不写默认值。当前歌曲反馈、历史撤销、重置与恢复在各自事务内递增该版本，不随恢复点回退。历史撤销携带反馈域 expectedRevision 和 commandId，事务内去重／比对版本后写 score=0；保留中立行，避免恢复重置时复活旧票。冲突报 `feedback_conflict`，不写入、不自动重放。原 `setTrackFeedback` 的播放实例校验不变，历史管理不开放任意改票。

Host 的 `feedback-list/feedback-clear` 越过慢平台队列；撤销只使投影缓存失效，不触发平台刷新、模型调用或播放命令。`feedbackView` 保留 version=1，并新增 `managementVersion=1/revision/playInstanceId`。客户端独立查询／写入状态和查询代次，按反馈 revision 去旧；仅在 playInstanceId 匹配时接受当前曲目反馈提示，撤销应答不应用播放快照。新客户端连接旧 Core 隐藏管理入口。见 [U21](spikes/U21-feedback-management.md)。

## 4. 推荐缓存与歌单核对

网易云 `getDiscoveryTracks` 在有界刷新中接收最多 3 个种子，来源包括 `netease_similar/netease_daily/netease_personal_fm`。缓存容量 200、TTL 6 小时；新召回与未过期旧候选合并去重，内容相同的刷新不改变 revision。种子按偏好排序后轮换，`discovery_cache_v1.seedOffset` 保存游标，重启继续、切号／清理重置。默认 filtered 在需要补池且未评候选耗尽时，平台最短刷新间隔 1 分钟；其他模式保留自动 30 分钟，手动最短 1 分钟，平台失败重试间隔 5 分钟并持久化 `failureUntil`。账号切换、关闭、清理与代次取消拒绝迟到结果。

陌生候选排除已导入、有效听过、喜欢或不可播曲目。`snapshot.discovery` 包含 `state/count/cached/sources`、刷新时刻和 `picked/filtering`；`picked` 统计仍可用且已加入模型排名的条目，不计缓存外/不可用排名。

真实宿主首次加载 N22 默认迁移为 `filtered`：平台推荐先形成候选，再由 LLM 选出一个歌单，本地只从入选歌曲播放。保留原曲库、账号、历史和开关。`llm/platform` 保留旧内部兼容；用户 `next` 在筛选歌单耗尽后仍可经 `libraryFallback` 回退输入/已知/喜欢歌曲并说明，自动续播没有这条回退。

旧直接生成歌名的记录继续保留原有搜索匹配与有界核对契约，filtered 模式不调用这条核对路径，也不把旧歌名记录加入默认播放池。

`local-v7` 的真实评分保存在决策中，解释只读事实；旧 `local-v6` 的小池重播记录按当时规则读取，不覆盖当前硬窗口。filtered 模式只播放 LLM 入选曲，`llmRank/llmReason` 参与正常本地评分；未入选歌曲不进入默认自动池。N15 的“只加分、不排空”保留旧兼容模式。

`recent_playback_v1` 为 `{version:1,entries:[{playInstanceId,trackKey,startedAt}]}`，按实际开始顺序从旧到新保留最近 50 个实例；旧库只由有进度历史及已开始当前实例回填。`started` 或首个有效进度确认开始，零有效增量的位置变化不算开始；同实例恢复不再次登记。此设置与历史一起保留，不因偏好重置／换批清空，不增加收听或成长。推荐 next 的队列与曲库回退也不能绕过策略；明确 `requestTrack` 和沿固定游标的显式历史前后导航可重播，真正开始仍正常入窗。

推荐选择只使用：窗口外且满足 30 分钟冷却 → 窗口外但放宽时间冷却；不再允许窗口内最久未播回退。自动续播、推荐队列和推荐 next 的曲库回退均适用，内部旧 `allowRepeatFallback` 参数也不能放宽。当前或刚播完同曲、禁播和不可播不放宽。成功选择的 `lastSelection.detail.repeat` 含 `window=50`、`relaxed`、`reason=null/cooldown-exhausted` 与 `distance=null`；只允许放宽时间冷却。窗口内歌曲导致无可选曲时返回 `track=null`、`reason=recent-window-exhausted`，`detail.algorithm=local-v7`、`detail.repeat={window:50,relaxed:false,reason:'recent-window-exhausted',distance:null}`。自动续播保持无 current 等待，推荐 next 返回 `no_candidates` 并保留当前曲目／暂停状态；明确 `requestTrack` 和固定游标的历史前后导航保留重播例外。

窗口不足不增加逐曲模型请求，后台按 N27 的整个池水位与共享 token 预算补批。filtered 新批准批次完成后沿用 `persona-finish` 的自主续播入口，只在听歌开启、未暂停、未受停止约束且无 current 时开始窗口外歌曲；新批次不能撤销暂停。旧 `recent-exhausted` 表示历史小池重播，新的等待状态不复用该原因码。无需修改数据库 schema 或清理现有开始窗口。

`filtered_playback_pool_v1` 为 `{version:1,owner,entries:[{approvedAt,track}]}`，owner 沿用候选账号指纹。成功且仍属当前账号／候选代次的筛选完成时，与账本和当前批次同事务合并最多 100 首，同平台 ID 采用最新批准信息并保留来源、rank/reason、modelCallId 和原 expiry；先去过期，再淘汰最早批准。旧库只从当前有效且可核验批次兼容读取，下一成功批次一起落盘；不由旧候选账本反推批准。账号变化、清缓存及现有重置／撤销重置流程清理池，迟到／取消／失败结果不入池。数据仍在 settings，schema 版本不变。

`snapshot.discovery`／`persona.recommendationPipeline` 的 `playbackPool:{total,available,recentBlocked,replenishing,lowWater,target}` 描述整个有效池：`available` 排除最近 50 次、当前曲、禁播、不可播、到期及探索设置不允许的歌曲。余量 <=12 进入补池，>=24 停止，启动默认补至 24，区间内保持状态；`lowWater=12/target=24`。原 `picked/tracks/summary/filterCallId/remaining` 继续描述当前批次，不能作为整个池的低水位。`discovery-filter-status` 增加可选 `playbackPool/candidateSignature`，`count` 在 filtered 下是未评且窗口外候选数；调度器按不同候选签名连续处理批次，达到目标／无新候选／失败／预算不足即停止，30 秒轮询兜底。详见 [N27](spikes/N27-continuous-recommendation-supply.md)。

`discovery_reviews_v1` 为 `{version:1,owner,context,entries:[{key,reviewedAt,expiresAt}]}`，最多 400 条、最多保留 6 小时；只在成功且未迟到的筛选事务中登记实际送入的候选，包括明确未选中或空批。相同歌曲不因刷新时间或 revision 改变而重评；参考曲目集合、明确反馈 revision、偏好重置、探索设置和模型路线改变时 context 失效。已有效批准的歌曲无需再次筛选。切号／清缓存／重置清理，失败／取消／过期响应及事务回滚不写入；不发送 context 或该记录给模型。

U24 为 filtered 状态投影的 `playbackPool` 可选增加 `tracks`：最多 100 首，集合与 `available` 使用相同的近期／当前曲／权限／探索过滤；只含 `normalizeTrack` 的安全元数据和 `discovery:{source,llmReason}`（理由最多 420 字符），不包含媒体地址、凭据、内部 handle 或模型调用标识。旧 `recommendationPipeline.tracks` 仍表示最新批次。新客户端优先使用整个池的 `playbackPool.tracks`，空数组表示确实无可选曲，不回退旧批次；缺字段的旧宿主按“当前批次”明确展示。该列表不是固定播放顺序，不改变选曲或补池策略。

同一客户端控制器保存尚待下次手动挑歌应用的模型选择，主面板的正在听／电台设置页共用；选项变化本身不发模型请求，手动开始时仍由原 `persona-recommendations` 路径校验并保存路线。所有迟到状态入口同时保护 `recommendationPipeline`，不能以旧播放／曲库代次复活旧池。UI 行为与验证见 [U24](spikes/U24-companion-player.md)。

`fishfm/persona-recommendations` 现在先保存已配置模型路线、触发并等待平台推荐，再运行 `discovery-filter`；不调用直接生成歌名的用途。内部 `recommendation-route` 保存路线并进入 filtered 模式；启动/导入/候选变化/歌单低水位按需筛选，首次可沿用已配置模型，不要求先生成总结。推荐 DTO 使用 `persona.recommendationPipeline`（状态、歌曲、理由、剩余数量）与 `recommendationRoute`。见 [N22](spikes/N22-platform-first-recommendations.md)。

### 当前批次只读投影

`persona.discoveryJournal` 为 `current-valid-filtered-batch`：含 `status=ready/empty/unavailable`、空状态 `reason`、`recommendedAt/retained/historyLimited` 和最多 12 个 `items`。item 仅含安全曲目元数据、结构化 `evidence` 及 `recommended/userRequested/agentExperienced/silentExperienced/audibleHeard/latestListenAt`，不返回原始历史、账号 owner 或未核实的模型理由；旧宿主缺字段时隐藏，不新增路由或模型工具。

筛选曲目的 `discovery.modelCallId` 沿 `current.origin` 和历史 JSON 保存，自主经历按本批 call ID 关联。手动点播只记推荐后的同曲操作，不归为自主成长或推荐转化。有效有声须实测 audibleMs 达阈值；有效自主经历且明确零有声才标静音。批次／账号／时效和 200 条索引历史窗口边界见 [U19](spikes/U19-recent-discoveries-prototype.md)。

## 5. 模型预留与账本

用途为 `persona-summary/model-recommendations/discovery-filter`，经 `persona-reserve → persona-start → persona-finish`，用预留时的事实映射和同一 token 账本。逐曲执行和解释不调用模型。

默认共享日预算 100000 tokens，可设 0–100000；已有显式预算（包括 0）不覆盖。单次输出默认 256，可设 64–4096，歌单至少 128。提高输出上限须仍能满足共享日预算的保守预留，不自动扩大预算。并发预留/运行只能一条，相同事实与模型复用缓存。未知 usage 按保守预留记账，失败不抹费用；重启把未结束调用标为 interrupted。模型结束原因为 max-tokens 时记为 model_output_limit，即使已有可解析文本也不应用；只有推理块而无最终文本时记为 model_no_final_text，不将推理内容作为结果，也不在同一次调用中自动提高输出上限或重试。

总结/旧歌单遵循日尝试上限 3，次数不含 discovery-filter，普通用途冷却 1 小时。候选筛选无固定每日次数上限，成功后没有模型冷却；仅后台失败／取消／中断按完成时间（缺失则开始时间）退避 1 分钟，手动重试无需等待。并发与共享 token 预算继续生效，所有尝试仍入账。此项修订 N22／U18 的筛选 12 次及自动 15 分钟规则，精确门控见 [persona.mjs](../src/persona.mjs)。

`persona.recommendationAvailability` 含 `reason/serverNow/retryAt/retryAfterMs/resetAt/remainingAttempts/dailyAttempts/runningPurpose`，表示手动按钮可用性；筛选的 `remainingAttempts/dailyAttempts=null` 表示不设次数上限，`retryAt=null/retryAfterMs=0`，不投影后台退避，仅任务占用和预算可阻塞。时间为服务端毫秒时间戳，日界线按服务端本地日历计算；非零余额能否容纳本批仍由预留检查。门控错误的 RPC `details` 只转发有效计时／次数字段，旧宿主缺字段或返回冷却时用普通提示，不显示分钟倒计时。

手动挑歌在平台刷新前读取门控，预留事务按真实 `automatic` 参数区分手动／自动并最终复验；预留／启动使调用投影缓存失效。平台保留 1 分钟刷新节流，过密请求可复用同批缓存、不重复扣费，见 [U18](spikes/U18-manual-picking-without-countdown.md)。

旧画像自动总结仍保留内部契约，filtered 模式不再调度这条独立展示任务。自动候选筛选作为推荐流程按需运行，不要求自动总结开关，受整个池的 due、失败退避、单任务并发和共享预算限制；播放/下一首不调用模型。默认输出 256 时提示最多六首，低上限减少数量；结构解析最多保留十二个有效去重序号，明确空筛选登记已评候选，不循环重试相同输入。

候选 revision、账号归属摘要与完整候选元数据只存本机预留，不发送给模型。模型输出依预留索引映射；finish 检查当前 revision，候选变化时失败但记用量。普通刷新保留同账号有效的旧筛选歌曲；账号切换、清空输入或缓存清理使其失效，不让旧输出覆盖新候选。

#9 在 `discovery-filter` 的候选事实中增加可选 `feedback: "liked" | "reduced"`，只读取 `user_track_feedback` 的明确 +1/-1，0 和缺失不发送该字段。总数不能替代逐曲归属；用户反馈与 Agent 艺人权重仍分别表达，不推断情绪或艺人整体喜恶。已发送的预留不因新反馈自动重试，下一正常批次读取最新值，本地下一首始终读取当前反馈。输入/输出数量、字节和共享 token 预算不变，输出仍为候选序号；禁播在本地硬过滤，reduced 不等于禁播。语义、账号范围与对照见 [用户偏好信号](research/PREFERENCE_SIGNALS.md)。

歌单事实不发平台 ID，筛选事实含候选曲目键用于映射，不发凭据。A09 的逐曲零请求、低频调用门控和 DSH 对照标准统一见 [MVP](MVP.md)，不要求连续计时观察。

## 6. Playback 与有效进度

`PlaybackService` 通过协议 v1 控制独立本机音频宿主：Windows 使用同用户命名管道与 WPF，macOS 源码版使用同用户 AF_UNIX socket 与 AVFoundation：

| 方法/事件 | 字段与要求 |
|---|---|
| `load` | `{resource, playInstanceId, startPositionMs, version, signal}`；媒体就绪返回实际 `{positionMs}`，无法 seek 返回 0 |
| `play/pause/stop/setMuted` | 携带版本，拒绝旧命令；暂停/停止可取消 pending open |
| `started` | 当前时间线确实推进后才发，系统 Play 返回不算证据 |
| `progress` | 实例、版本、`positionMs/effectiveDeltaMs/progressSource`；只向前报，连续观测限定有效增量 |
| `ended/error` | 当前实例/版本，结束带最终位置，错误保留分类 |

断线主动要新快照，不用 supervisor 缓存判断资源是否还在；匹配实例/版本的 `ended/error` 补发一次，不补计失联时间。每实例/版本共享恢复任务，最多三轮连接/快照尝试；await 后检查实例和版本，旧恢复不能清掉新曲目。超时/写入异常拒绝所有等待者；宿主退出、所有者消失及 `dispose` 都停止音频。

播放期间的媒体失败上报 `media_failed`；连续 15 秒时间线不推进上报 `media_stalled`，暂停和实际推进重置检测。终态快照附加 `errorCode/errorMessage/retryable`，不改变协议版本。Core 对 `playback_host_lost/media_stalled` 或可重试的 `media_failed` 重新解析原曲一次，尝试从已确认位置继续，保留实例和实际收听累计；与过期地址恢复共用一次预算。暂停/换曲可取消，恢复 load 失败保留已听片段，未开始加载不伪造收听。见 [N21](spikes/N21-playback-interruption-recovery.md)。

默认播放中从 5 个静音、不播放的持有者开始，根据实际 Open 耗时最多补齐到 8 个；`FISHFM_PLAYBACK_WARM_HOLDERS=0..8` 可覆盖为固定数量，0 关闭。首曲仍冷，资源在临时目录生成；参数不是跨机器性能保证，见 [N19](spikes/N19-wpf-audio-warmup.md)、[N20](spikes/N20-review-fixes.md)。

实例分别累计 `effectiveMs/agentEffectiveMs/audibleMs`，与位置分离。逻辑进度只接受已知时长，真实静听用音频静音。恢复起点、长缺口、seek 与睡眠不补计，未有效播放不能伪造收听。

Provider 解析最多 3 次；自主不可播替换有有限预算，明确资源不可用排除 30 分钟，媒体打开超时/失败排除 5 分钟。账号/网络失败不写负面偏好，已知过期资源最多重新解析一次。见 [N1](spikes/N1-autonomous-accounting.md)、[N13](spikes/N13-crash-recovery-and-verification-bound.md)。

## 7. 存储与恢复

仓库 schema v11，高于支持版本时拒绝打开。主要数据域：

| 数据域 | 实体 |
|---|---|
| 配置/控制 | `settings/core_state/constraints/processed_commands` |
| 曲目/来源 | `tracks/seed_imports/user_environment/environment_sources/track_availability` |
| 独立偏好 | `agent_preferences/session_influence/user_track_feedback` |
| 播放/成长 | `listen_history/track_stats/growth_jobs` |
| 账号/模型 | `credential_references/music_model_calls` |

历史、统计与成长作业入队同事务，`playInstanceId` 幂等；成长可重放，不重复应用。RNG 随 Core 保存，重启保留曲目和位置但强制暂停，不用墙钟补进度。

命令去重及已完成成长作业保留 30 天；未完成成长、历史、反馈、约束和模型账本保留。维护清理最多每小时一次，见 [N17](spikes/N17-p1-retention-a09.md)。数据位置与平台凭据限制见 [使用说明](DELIVERY.md)。

诊断脱敏且有界，观察脚本只读，不启动另一个 Core、不把模拟事件当生产证据；无法采集的请求／上下文指标保持 `unknown`，验收缺口只在开发状态维护。正常关闭时，最后一份磁盘运行报告必须在同一次原子写入中包含 `closed: true` 和最终事件；写失败或被新实例拒绝时，旧实例不得声称干净收尾。实测与回归见 [N24](spikes/N24-dsh-background-acceptance.md)。

## 8. 独立表达配置

`settings.expression_style_v1` 保存 `{version:1,style,revision}`，style 仅为 current/concise/lively；缺省 current/revision=0，不新增表或迁移。`insights.expression` 返回 version/style/revision/available/examples，reply/explanation 同时返回确定性 variants，text 为已保存预设；默认 current 保留原有文案。表达配置与变体不加入任何音乐模型事实或提示。

认证 `fishfm/expression-style` → Core `expression-style`，只接收 style 和 expectedRevision（表达版本，与 Core revision 无关）。事务内冲突拒绝为 expression_conflict，无效值为 invalid_expression，未知持久化版本为 unsupported_expression；同值不增版本，恢复默认保留递增 revision。响应仅返回 expression，不返回或应用播放快照。客户端独立保存、草稿和版本去旧不占用播放 busy；无新工具、模型请求或上下文注入。三类状态所有权、文字优先级、格式取舍及验证见 [U20](spikes/U20-expression-style-prototype.md)。
