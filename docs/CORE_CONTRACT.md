# 内部控制契约

更新：2026-10-06，按 N20 实现整理。本文描述 FishFM 内部契约，DSH 外部接口经 Adapter 映射。职责见 [架构](ARCHITECTURE.md)，用户行为见 [MVP](MVP.md)，现场状态见 [开发路线](PROJECT_PLAN.md)；历史变化见 [决策记录](DECISIONS.md) 与 [实验记录](spikes/README.md)。

## 1. 曲目、账号与资源

Track key 为 `(provider, providerTrackId)`，`provider` 仅为 `netease/qq`，字符串键为 `provider:providerTrackId`。标题不能替代 ID，不凭同名跨平台合并。可带 `title/artist/artists/durationMs/metadataSource`，缺失时长和特征保持未知。

Provider 暴露账号和能力状态，`resolve(track, {signal, version})` 返回 `{handle, expiresAt?}`。handle 仅交 Playback，不进 SQLite、Core/UI 快照或模型输入。缺能力、过期账号、无可播资源和空候选分别报告。

网易云导入可指定 `source/playlistId`，保留实际来源、sourceRef、数量及失败尝试。核对 `login_status` 账号 ID 后才保存 DPAPI 凭据引用；退出删除凭据及引用。QQ 真实登录/播放未验证，不显示未核实的扫码入口。

## 2. 用户命令

命令带非空 `commandId`，可带 `expectedRevision`。重复命令返回当前快照，旧 revision 返回 `stale_revision`；接受后递增 `decisionVersion`，影响播放时递增 `commandVersion` 并取消旧解析。

| 命令 | 参数 | 约定 |
|---|---|---|
| `pause/resume` | 无 | 暂停优先；恢复保持自主/声音设置，重新解析并尝试恢复位置 |
| `next` | 无 | 优先队列，否则用选择器；选择器排除当前并保留约束/不可播/冷却过滤，暂停期间换曲仍暂停 |
| `requestTrack` | `track` | 明确点播并解除暂停，不自动改声音或自主开关；禁播返回 `constraint_conflict` |
| `setListening/setHumanPlayback/setDiscovery` | `value: boolean` | 独立开关；关闭自主会暂停当前 Agent 曲目 |
| `setDiscoveryRate` | `value: 0..1` | 探索目标概率，不保证存在新歌 |
| `setMode` | `normal/focus/silent/off` | normal/focus 启用自主并恢复声音；silent 静听；off 关闭两开关并暂停 |
| `stopForToday/chooseSelf` | 无 | 禁止当日自主并暂停 / 解除当日限制、开启自主并尝试恢复 |
| `banTrack/unbanTrack` | `track` | 独立用户约束，不暗中取消禁播 |
| `setTrackFeedback` | `track, playInstanceId, value: -1/0/1` | 校验当前曲目与实例，旧实例返回 `stale_track`；不改 affinity 或平台收藏 |
| `resetTaste/resetLibrary` | `value: {clearFeedback: boolean}` | 保存可撤销恢复点，与去重记录同事务；模型预留/运行中返回 `summary_busy` |
| `undoTasteReset` | 无 | 恢复最近恢复点，缺备份返回 `no_reset_backup`，重置后新增反馈优先 |
| `setRecommendationMode` | `value: llm/platform` | 显式切换来源，不静默包装失败 |

`resetTaste` 保留输入曲库；`resetLibrary` 还清空输入/来源及队列。两者保留账号、历史、约束与模型账本，不改变当前播放。重置边界前的成长不能重新写回旧偏好。

用户下一首记 `selectedBy='agent'、selectionTrigger='user-next'`，保留来源、评分和 decisionId；只有 `requestTrack` 记为 `selectedBy='user'`。选择不是有效收听，旧历史不倒改归属。

今天限制到期不自动解除暂停。无当前曲目时，要求开始自主而失败应返回 `autonomy_blocked/no_candidates`，不得静默无操作。完整控制语义见 [MVP 第 3 节](MVP.md)。

## 3. Host、UI RPC 与快照

Host 协议 v1 使用 JSON-lines：启动发 `ready`，请求返回带 `id` 的 `result/error`，状态变化发 `state`，退出发 `exiting`。快照含递增 `revision`、开关、策略、队列、当前实例、暂停和错误，不含凭据或 handle。

`command` 应答代表接受后的快照，可能仍是 `resolving`；异步失败经后续状态呈现。控制/读取不被慢账号或导入排队，stdio 持续接收取消命令。调试用 `wait` 等媒体任务收尾，`setQueue/autonomous` 为固定候选及调试入口。

UI 经宿主认证 `/api` 调用；完整白名单见 [dsh-settings.mjs](../src/ui/dsh-settings.mjs)，不能把全部 Core 命令自动暴露给浏览器。

| RPC | 返回/用途 |
|---|---|
| `fishfm/state` | `snapshot/platforms/library/insights/persona/features` |
| `fishfm/command` | 白名单用户命令与更新状态 |
| `fishfm/login-start/login-poll/logout` | 网易云扫码、账号确认、退出 |
| `fishfm/import/playlists` | 来源导入与账号歌单，保留数量/尝试轨迹 |
| `fishfm/discovery-refresh` | 后台刷新状态，可补跑一次有预算的筛选 |
| `fishfm/persona-summary/persona-recommendations` | 复用 DSH 模型生成总结/具体歌单 |
| `fishfm/persona-budget/persona-output/persona-automatic` | 预算、输出上限与自动更新设置 |

Host `library` 返回导入总数及最多 300 首元数据，UI 不接受音频 URL。`insights` 统计按最近 200 次决策关联，不代表历史全期；反馈、成长与解释独立。业务错误有应答不等于 Core 断连。

## 4. 推荐缓存与歌单核对

网易云 `getDiscoveryTracks` 在有界刷新中接收最多 3 个种子，来源包括 `netease_similar/netease_daily/netease_personal_fm`。缓存容量 200、TTL 6 小时，自动间隔 30 分钟、手动最短间隔 1 分钟、失败重试间隔 5 分钟。账号切换、关闭、清理与代次取消拒绝迟到结果。

陌生候选排除已导入、有效听过、喜欢或不可播曲目。`snapshot.discovery` 包含 `state/count/cached/sources`、刷新时刻和 `picked/filtering`；`picked` 统计仍可用且已加入模型排名的条目，不计缓存外/不可用排名。

真实宿主默认 `llm`：熟悉池来自歌单已熟悉歌曲，探索池含歌单未听过歌曲和平台候选；`platform` 是显式兼容模式。自主选择不走输入曲库回退；用户 `next` 在默认候选耗尽后可经 `libraryFallback` 回退输入/已知/喜欢歌曲，并说明来源。

歌单为有界歌名/艺人 JSON，平台元数据匹配后才可执行。核对单飞、最短间隔 1 分钟，每歌单每进程最多 10 次自动核对；登录缺失不计数，手动不受次数上限限制，新 callId 重置预算，替换/退出取消旧核对。

`local-v5` 的真实评分保存在决策中，解释只读事实；筛选加入 `llmRank/llmReason` 与有界 `llmBoost`，未入选候选仍可用。默认规则含 30 分钟曲目冷却，精确参数见 [selection.mjs](../src/selection.mjs)。

## 5. 模型预留与账本

用途为 `persona-summary/model-recommendations/discovery-filter`，经 `persona-reserve → persona-start → persona-finish`，用预留时的事实映射和同一 token 账本。逐曲执行和解释不调用模型。

默认共享日预算 4000 tokens，可设 0–100000；输出 64–256，歌单至少 128。并发预留/运行只能一条，相同事实与模型复用缓存。未知 usage 按保守预留记账，失败不抹费用；重启把未结束调用标为 interrupted。

总结/歌单遵循日尝试上限 3，当前查询覆盖当日全部音乐模型调用；筛选单独计数，每日最多 12 次。普通用途冷却 1 小时，筛选 15 分钟；已知用量的失败可有限手动重试。精确门控见 [persona.mjs](../src/persona.mjs)。

自动总结默认关闭；开启需成功基线、沿用原路由、足够新增有效经历（默认 50 次）、至少 24 小时并复检预算。候选筛选属于 LLM 推荐模式，不要求自动总结开关，但仍受 due、冷却、次数与共享预算限制。

歌单事实不发平台 ID，筛选事实含候选曲目键用于映射，不发凭据。A09 要求逐曲零模型请求、计划内调用门控及真实两小时对照。

## 6. Playback 与有效进度

`PlaybackService` 通过协议 v1 同用户命名管道控制独立 WPF 宿主：

| 方法/事件 | 字段与要求 |
|---|---|
| `load` | `{resource, playInstanceId, startPositionMs, version, signal}`；媒体就绪返回实际 `{positionMs}`，无法 seek 返回 0 |
| `play/pause/stop/setMuted` | 携带版本，拒绝旧命令；暂停/停止可取消 pending open |
| `started` | 当前时间线确实推进后才发，系统 Play 返回不算证据 |
| `progress` | 实例、版本、`positionMs/effectiveDeltaMs/progressSource`；只向前报，连续观测限定有效增量 |
| `ended/error` | 当前实例/版本，结束带最终位置，错误保留分类 |

断线主动要新快照，不用 supervisor 缓存判断资源是否还在；匹配实例/版本的 `ended/error` 补发一次，不补计失联时间。每实例/版本共享恢复任务，最多三轮连接/快照尝试；await 后检查实例和版本，旧恢复不能清掉新曲目。超时/写入异常拒绝所有等待者；宿主退出、所有者消失及 `dispose` 都停止音频。

WPF 播放期间的媒体失败上报 `media_failed`；连续 15 秒时间线不推进上报 `media_stalled`，暂停和实际推进重置检测。终态快照附加 `errorCode/errorMessage/retryable`，不改变协议版本。Core 对 `playback_host_lost/media_stalled` 或可重试的 `media_failed` 重新解析原曲一次，尝试从已确认位置继续，保留实例和实际收听累计；与过期地址恢复共用一次预算。暂停/换曲可取消，恢复 load 失败保留已听片段，未开始加载不伪造收听。见 [N21](spikes/N21-playback-interruption-recovery.md)。

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

命令去重及已完成成长作业保留 30 天；未完成成长、历史、反馈、约束和模型账本保留。维护清理最多每小时一次，见 [N17](spikes/N17-p1-retention-a09.md)。数据位置与 DPAPI 跨设备限制见 [使用说明](DELIVERY.md)。

诊断脱敏且有界，观察脚本只读，不能启动另一个 Core 或把模拟事件当生产证据。完整 DSH 请求/上下文和两小时对照仍未通过，状态统一在开发路线。
