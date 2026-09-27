# P1 独立 Playback：实现与验证

- 日期 / 环境：2026-09-27，Windows 11，Node 24.14.0（另在宿主 payload Node 24.21.0 与 Electron-as-node 24.18.1 上复跑离线套件），pwsh 7.6.4 与Windows PowerShell 5.1 均可用。
- 状态：**离线契约与真实音频均已在本机通过；平台（网易云/QQ）音频资源仍未接入**，因此 A01 不因本文通过。
- 相关任务：[PROJECT_PLAN](../PROJECT_PLAN.md) P1（前置 F4、P0-04）；验收关联 A03/A07/A08/A10。

## 交付物

| 文件 | 职责 |
|---|---|
| [`src/playback/protocol.mjs`](../../src/playback/protocol.mjs) | 协议版本、命令/事件白名单、行解码、greeting 校验 |
| [`src/playback/transport.mjs`](../../src/playback/transport.mjs) | 同用户命名管道客户端：连接、请求-应答配对、超时即判连接不可用 |
| [`src/playback/backends.mjs`](../../src/playback/backends.mjs) | 后端描述符与 PowerShell 候选（`pwsh` 优先，回退系统自带 5.1）、假后端 |
| [`src/playback/supervisor.mjs`](../../src/playback/supervisor.mjs) | 宿主进程生命周期：spawn、握手、重连、所有者看门狗、dispose |
| [`src/playback/service.mjs`](../../src/playback/service.mjs) | F2/F4 Playback 契约实现：load/play/pause/stop/setMuted + 事件守卫 |
| [`src/playback/host/wpf-media-host.ps1`](../../src/playback/host/wpf-media-host.ps1) | 真实音频宿主：隐藏 STA 进程 + WPF MediaPlayer + 协议 v1 |
| [`src/playback/fake-backend.mjs`](../../src/playback/fake-backend.mjs) | 离线替身后端（慢/失败打开、瞬时 0、重复 ended、过期版本、崩溃） |
| [`test/playback.test.mjs`](../../test/playback.test.mjs) | 13 项离线测试，真实 spawn + 真实命名管道 + 真协议 |
| [`scripts/playback-smoke.mjs`](../../scripts/playback-smoke.mjs) | 真实音频冒烟：14 项检查，自生成 WAV，不需要任何账号 |
| [`src/playback/ui-probe.mjs`](../../src/playback/ui-probe.mjs) | 诊断用：附着到已运行的宿主并打印它的 hello/state，用于人工排查（宿主一次只服务一个客户端） |

## 协议要点（v1）

- 一篇 JSON 一行，UTF-8，LF；`protocol` 不匹配直接拒绝连接。
- 连接建立后宿主主动发 `hello`（含 `protocol`、`pid`、`backend`、`capabilities`）与一份 `state` 快照。
- 命令：`load` / `play` / `pause` / `stop` / `setMuted` / `snapshot` / `ping` / `shutdown`，都带 `id`、`playInstanceId`、`version`。
- 事件：`started` / `progress` / `ended` / `error` / `exiting`，都带 `playInstanceId` 与 `version`。
- `load` 返回 `{ positionMs, seek, muted, durationMs }`；`seek=false` 时 Core 依契约把本次进度重置为 0。
- 宿主只发事实，不做决策：不选下一首、不写数据库、不读凭据。

## 真实音频实测（`npm run smoke:playback`，14/14）

自生成 8 秒 44.1kHz 单声道 WAV（[`scripts/make-tone.mjs`](../../scripts/make-tone.mjs)，纯 Node，不引入 FFmpeg）：

```text
PASS  real host greets and opens a local WAV        backend=wpf-mediaplayer hostPid=32608
PASS  an unrelated UI process starts and exits      uiPid=35932
PASS  audio timeline really advances after play
PASS  playback continues with no UI process alive   positionMs=601
PASS  pause freezes the position                    afterPause=601 stillPaused=601
PASS  resume seeks back to the paused position      requested=601 actual=601
PASS  muted playback still advances the timeline    from=601 to=985
PASS  a dropped client connection reconnects to the same host  hostPid=32608
PASS  client loss does not report a playback error
PASS  the reconnected host still holds the running track  hostPositionMs=1827 positionBeforeDrop=985
PASS  a muted track still reaches its end           endedPositionMs=8000 toneDurationMs=8000
PASS  an unplayable resource fails with a bounded, named error  code=media_failed
PASS  no fabricated playback events for the failing resource
PASS  tearing the service down stops the audio host hostPid=32608
```

逐条对应 P1 的完成条件：真实后端接入统一契约（同一 `load/play/pause/stop/setMuted` 与同一事件）；暂停、静音、结束、错误都可观察；**退出 UI 后继续播放**（宿主由音乐服务拥有，UI 进程来去不影响时间线）；**插件停用后停止**（dispose 后宿主进程消失，子进程不留残留）。

## 离线实测（`npm test`，13 项播放 + 14 项核心 = 27 项全过）

替身后端让这些在 CI 上也可复现：慢/永不打开（有界 `media_open_timeout`，不伪造 started）、损坏资源（`media_failed`）、恢复瞬间的瞬时 0 不倒退、重复 `ended` 只计一次、过期版本事件被丢弃、静音仍走完时间线、宿主崩溃报 `playback_host_lost` 且下次 load 重新拉起、dispose 停掉宿主、所有者消失后宿主自杀、断线重连不误杀正在播放的曲目。

## 本轮修掉的三个真实缺陷（都由实测暴露）

1. **并发命令会抢着 spawn/重连宿主**：两条命令前后脚发出时都会判定"宿主不存在"，各自 spawn 一个进程并互相拆掉对方的连接，导致 Core 收到 `host_unavailable: ENOENT`。改为并发共享同一次 `ensureHost`，并把"进程活着但管道未就绪"改成有界重试而不是只试一次。
2. **重连用缓存的过期状态判定曲目丢失**：`supervisor.hostState` 保留的是首次握手时的 `idle` 快照，断线恢复时被当成"主机已不再持有当前曲目"，于是发出假的 `playback_host_lost` 并提前结束播放（实测位置明明还在前进）。改为恢复时主动发 `snapshot` 取权威状态。
3. **`ended` 事件不带位置**：契约要求 `ended` 携带位置，补上以便上层核对。

## 仍未验证 / 已知限制

- **平台音频未接入**：全部验证用的是本地 WAV。网易云/QQ 的 http(s) 音频流、会员权限、URL 过期后的重取仍属 P2/P3/P4。
- **真实桌面边缘情况未测**：多屏/DPI 变化、睡眠恢复、系统音频设备被占用或拔出时的 `MediaFailed` 行为。
- **未做音量控制**：契约与宿主都只到静音，没有 volume 命令（MVP 也未要求）。
- **PowerShell 5.1 与 pwsh 都列在候选里，但真实音频只在 `pwsh` 路径上跑过**；`FISHFM_PLAYBACK_SHELL` 可覆盖，5.1 路径待补测。
- 宿主启动依赖 PowerShell 进程（本机实测约 0.4–0.7 秒），比原生后端慢；这是 Phase 0 已知取舍，未做优化。