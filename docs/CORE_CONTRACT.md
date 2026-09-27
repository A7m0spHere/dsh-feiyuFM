# Phase 1 内部控制契约

更新：2026-09-27。此契约由 `src/` 的可运行实现定义，供后续 DSH Adapter、Provider 和 Playback 接入；它不是 DSH 已发布的事件或 SDK 接口。

## 边界

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

`setQueue()` 和 `selectAutonomously()` 是 Phase 1 调试与固定候选入口。完整候选来源、探索和多 Session 活动上下文属于后续阶段。当前 `next` 从同一队列取曲目；暂停期间换曲保持暂停。到期的“今天别听”限制只失效，不自动解除暂停。

## 存储与进程

首版 SQLite 迁移有 `settings`、`core_state`、`constraints`、`credential_references`、`processed_commands`、`listen_history` 和 `track_stats`。完成事件的历史插入与统计更新在一个事务中，`playInstanceId` 唯一。`selectedBy`、`agentListening`、`progressSource` 和 `audible` 分别记录，避免把点歌、逻辑进度和可听输出混作一件事。重启后保留曲目与位置，但强制暂停；不会用墙钟补算进度。数据库只保存凭据引用；Windows 的 DSH grant 加 DPAPI 方案已有合成测试，真实平台与 desktop profile 尚待验证。

Core 当前可由独立 Node 进程执行；[P0-01 样例](spikes/P0-01-dsh.md)已验证隔离 DSH Web profile 启动/清理子进程，[P0-04 样例](spikes/P0-04-playback.md)已验证 Windows 同用户管道控制独立播放器及重连。正式 DSH desktop 适配、播放实例/版本 IPC 和平台音频仍待验证。`node:sqlite` 在本机 Node 24.14.0 可用，但该版本仍给出实验性提示；升级或替换存储驱动前需要复测迁移与事务。
