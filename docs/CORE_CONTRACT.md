# Phase 1 内部控制契约

## N10 增量（2026-10-03）

显式用户命令经既有认证 `fishfm/command` 白名单转发，均要求唯一 `commandId`：

- `setTrackFeedback`：`track={provider,providerTrackId}`、`playInstanceId`、`value ∈ {-1,0,1}`。Core 校验与当前歌曲/实例一致，旧实例返回 `stale_track`；仅写独立反馈，不改播放和 affinity。
- `resetTaste`：`value={clearFeedback:boolean}`。重置积累偏好并按输入环境重新初始化，默认保留手动反馈；保留账号、历史、约束与模型账本。Core 事务保存恢复点及去重记录，清除旧展示总结；模型预留/运行中返回 `summary_busy`。
- `undoTasteReset`：恢复最近恢复点；无恢复点返回 `no_reset_backup`。重置后新增手动反馈优先；恢复旧权重会覆盖重置之后的成长。

`insights.feedback={version:1,current,liked,reduced,resetAt,canUndoReset}` 是同一 Core 的只读投影。反馈/重置命令响应附新 insights/persona；歌曲评分增加 `userFeedback/feedback` 与 `algorithm='local-v3'`，逐曲仍不请求模型。schema v9、成长边界与验证见 [N10](spikes/N10-feedback-reset.md)。

更新：2026-09-27。此契约由 `src/` 的可运行实现定义，供后续 DSH Adapter、Provider 和 Playback 接入；它不是 DSH 已发布的事件或 SDK 接口。

## N0–N3 增量（2026-10-02）

- NetEase 可选 `getDiscoveryTracks({limit=40,signal})` 返回规范化 Track 数组，附 `discovery={source,seedTrackKey,fetchedAt,expiresAt}`；当前来源为账号每日推荐/私人 FM。缺方法不伪装为空结果；QQ 尚未接入真实推荐。
- facade/Host 有界后台刷新，selector 只读缓存；`snapshot.discovery` 为只读状态投影，包含 state/count/cached/sources、最近尝试/成功及下次允许时间。Host `discovery` 消息立即返回调度状态；认证 `fishfm/discovery-refresh` 使用同一入口，宿主 features 标志决定按钮是否可用。
- `current.origin` 保存自主选择的来源；`lastSelection` 增加 decisionId/source。已有效听过的自主曲目可以进入熟悉池，但不写成用户导入环境。
- `current.effectiveMs/agentEffectiveMs/audibleMs` 与 `positionMs` 分开。真实 Playback 的 progress 增加 `effectiveDeltaMs`，用单调时间和连续观测限定本段推进；恢复起点、长缺口和 seek 不补算。手动/自主及声音切换保持独立计数。
- schema v4 增加历史分段标识/有效 Agent 时长/可听时长、`growth_jobs` 和曲目临时可用性；历史与待处理成长同一事务，成长与已处理标记同一事务，实例幂等。启动重放待处理项，旧历史不批量重新成长；旧快照缺失分段字段时从 0 开始。
- 自主明确不可播替换最多 3 个候选，排除有效期 30 分钟；网络/账号失败不惩罚偏好。选择 RNG 状态随 Core 状态保留，重启恢复仍暂停。
- Core/Adapter 生产诊断分别保存 runtime 报告，观察入口只读、不启动 Core。DSH 模型请求及上下文覆盖仍为 unknown；不因此声称 A09 两小时通过。
- `command` 返回命令接受后的快照，媒体可能仍是 resolving；后端异步错误通过后续快照/事件显示，不把接受当成声音已播放。控制与读取不被慢账号/导入工作排队；stdio 持续读取消息，暂停可以取消前一个慢加载。调试需要媒体就绪时显式使用 `wait`。

以下为早期契约与历史验证说明，现场状态见 [N0](spikes/N0-runtime-evidence.md)、[N1](spikes/N1-autonomous-accounting.md)、[N2](spikes/N2-netease-discovery.md)、[N3](spikes/N3-discovery-cache.md)。

## 边界

N6 增量：`insights` 返回本地偏好、确定规则解释和按最近 200 次自主决策关联的播放统计；认证 `fishfm/state` 附带该投影。`startedAt/selectionPool/decisionId` 保留在经历中，恢复不重复计数；统计范围不是旧历史全期。没有模型总结或流派/情绪推断。

N5 增量：Registry 的可选发现请求附 `seeds`（同平台、最多 3 首）；NetEase 关系候选使用 `netease_similar`，保留 `seedTrackKey/seedTrackKeys`，与账号推荐来源分开。缓存仍同步可读，关系请求仅在有界刷新批次中执行。`lastSelection.detail` 增加 local-v2 的关系、弱环境和多样性项，解释来自实际得分，不写未知曲目的 affinity。

N4 增量：schema v5 增加 `tracks.artists_json/metadata_source` 和 `environment_sources`；曲目可带稳定艺人数组和来源，首次导入来源保留，重复导入追加/更新独立事实，不覆盖已有 Agent affinity。`environment.profile` 返回有界来源/艺人分布及覆盖率，流派/情绪缺失保持未知；艺人偏好在有 ID 时按平台 ID 保存/成长。`playlists` 读取账号歌单，`import-platform` 可指定 `source/playlistId` 并保留实际 sourceRef；认证 `fishfm/playlists` 与导入参数白名单对应。新客户端仅在宿主声明 importSources 时显示来源选择。

- 一个本地用户配置只有一个 `MusicCore` 实例和一条候选队列。Core 是状态唯一写入者；窗口和多个 DSH Session 将来都向它提交命令。
- Track key 是 `(provider, providerTrackId)`，`provider` 仅可为 `netease` 或 `qq`。同名歌曲不能替代 ID。
- Provider `resolve(track, { signal, version })` 返回 `{ handle, expiresAt? }`。`handle` 只在调用 Playback 时传递，不保存到 SQLite 或状态快照。Provider 同时暴露显式账号状态和能力状态；缺失能力不能伪装为空结果。
- Playback 实现 `load({ resource, playInstanceId, startPositionMs, version, signal })`、`play`、`pause`、`stop`、`setMuted`。`load` 返回实际就绪的 `{ positionMs }`；无法 seek 时返回 0，Core 重置本次进度。Playback 必须丢弃比已接受版本旧的命令。真实 Playback 接入前，需要用同一契约检查这些要求。
- Playback 事件为 `started`、`progress`、`ended`、`error`，均带 `playInstanceId`，并应回传 `version` 以拒绝旧事件。`progress` 带 `positionMs` 和 `progressSource` (`audio` 或 `logical`)。逻辑进度只接受已知时长的曲目。
- 真实后端只有确认媒体打开并开始推进后才能发 `started`；调用系统 `Play()` 成功不足以证明资源可播。WPF 探针中无效资源可能延迟触发 `MediaFailed`，恢复瞬间还可能短暂报告 0 ms，适配器需要等待稳定事实并设置有限超时。

## 真实 Playback 接入（P1，2026-09-27）

`src/playback/` 已按上面的契约接入真实音频：`PlaybackService` 是 Core 看到的 Playback，背后是独立进程的 WPF MediaPlayer 宿主，两者用同用户命名管道上的协议 v1 通信（[P1 证据](spikes/P1-playback.md)）。

- 宿主持有声音与时间线；Core 仍决定播什么。宿主不选曲、不写库、不读凭据。
- 命令与事件都带 `playInstanceId` 与 `version`，适配器丢弃比当前实例更旧的命令与事件；`load` 对过期版本抛 `stale_version`。
- `progress` 只向前报：恢复瞬间的 0 ms 不会被上报（P0-04 已观察该现象）；`ended` 携带最终位置。
- 断线恢复时**主动向宿主要 `snapshot`**，不用 supervisor 缓存的状态判定曲目是否还在——缓存可能是首次握手时的旧快照。
- 宿主进程的父进程是音乐服务；所有者进程消失时宿主自行停止，`dispose` 也会停掉它（「插件停用后停止」）。

## 命令与快照

命令都带非空 `commandId`；可带 `expectedRevision` 来拒绝旧 UI 状态。Core 持久去重 `commandId`，每条接受的用户命令递增 `decisionVersion`；会改变当前播放的命令还递增 `commandVersion`，取消旧解析。`snapshot()` 返回带递增 `revision` 的状态副本，包含开关、策略、队列、当前曲目、暂停和错误；不包含凭据或播放资源。

支持 `pause`、`resume`、`next`、`requestTrack`、`setListening`、`setHumanPlayback`、`setDiscovery`、`setDiscoveryRate`、`setMode`、`stopForToday`、`chooseSelf`、`banTrack`、`unbanTrack`。模式值为 `normal`、`focus`、`silent`、`off`。禁播曲目的明确点播返回 `constraint_conflict`，由上层向用户呈现并获取本次例外意图；本阶段不暗中覆盖约束。

`setQueue()` 和 `selectAutonomously()` 是调试与固定候选入口。`next` 优先取同一队列，队列为空时从本地选择器取候选，排除当前曲目并保留禁播/冷却过滤；用户换曲标为 `selectedBy=user`，暂停期间换曲保持暂停。到期的“今天别听”限制只失效，不自动解除暂停。

`library` Host 消息返回导入库总数及最多 300 首元数据；认证设置状态投影带同一库。主面板支持开始听歌、选择已导入曲目与 `requestTrack`；设置 RPC 只转发规范化的曲目字段，不接受音频 URL 或凭据。实测见 [P3](spikes/P3-real-loop.md)。

## 存储与进程

首版 SQLite 迁移有 `settings`、`core_state`、`constraints`、`credential_references`、`processed_commands`、`listen_history` 和 `track_stats`。完成事件的历史插入与统计更新在一个事务中，`playInstanceId` 唯一。`selectedBy`、`agentListening`、`progressSource` 和 `audible` 分别记录，避免把点歌、逻辑进度和可听输出混作一件事。重启后保留曲目与位置，但强制暂停；不会用墙钟补算进度。数据库只保存凭据引用；Windows 的 DSH grant 加 DPAPI 方案已有合成测试，真实平台与 desktop profile 尚待验证。

Core 当前可由独立 Node 进程执行；[P0-01 样例](spikes/P0-01-dsh.md)已验证隔离 DSH Web profile 启动/清理子进程，[P0-04 样例](spikes/P0-04-playback.md)已验证 Windows 同用户管道控制独立播放器及重连。正式 DSH desktop 适配、播放实例/版本 IPC 和平台音频仍待验证。`node:sqlite` 在本机 Node 24.14.0 可用，但该版本仍给出实验性提示；升级或替换存储驱动前需要复测迁移与事务。
