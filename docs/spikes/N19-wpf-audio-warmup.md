# N19：WPF 音频预热（播放/下一首慢的根因修复）

2026-10-06 复测修订：[N20](N20-review-fixes.md) 在当前机器上复现 4 个持有者仍需约 5 秒，改为默认 5 个后恢复到 1 秒以内。下文的 4 个资源阈值、约 15 秒填池和 0.35–0.45 秒数据是 N19 当时的测量，不能作为当前运行保证；最新默认值和证据以 N20 为准。

用户报告「播放歌曲或下一首反应慢，偶尔 DSH 崩溃」。两项分别定位：本文记录慢的修复；崩溃是宿主进程内未捕获异常，属另一条路径，见文末「崩溃」。

## 现象与测量

生产 runtime evidence（`~/.dsh/fishfm/runtime/core.json`，16 首曲目）显示，每首歌从选中到出声的分解高度稳定：

| 阶段 | 耗时 |
|---|---|
| 选中 → 平台解析返回 | ~100 ms |
| 解析返回 → `loaded`（媒体打开） | **5400–10200 ms** |
| `loaded` → `started`（出声） | ~660 ms |

慢的不是网络、选歌或平台解析，而是 WPF `MediaPlayer` 的媒体打开。用项目自己的 `PlaybackSupervisor`/`PlaybackService` 复现：本地 WAV 5747/5375/4953 ms，HTTP 流 5480/5258/5137 ms——与资源类型无关。

### 根因

宿主每次 `load` 走 `Stop-Playback`（`Stop()` + `Close()`）再用同一个 `MediaPlayer` `Open()`。实测该模式**每次都慢**，不衰减：

```
stop+close+open ×5 : 4917, 4815, 4897, 4848, 4902 ms
```

而 `Close()` 不可省：只 `Stop()` 不 `Close()` 重开直接 25 s 超时不出 `MediaOpened`。

真正的原因是 WPF 音频栈在进程内**已打开的资源数达到 4 个时才进入快路径**。5 次独立试验，每次在同一进程内逐个增加持有者、每个计数测两次（in-box PowerShell 5.1，与 `pwsh` 7 结果一致）：

```
holders=0: 4980 / 4822      holders=3: 4521 / 4573
holders=1: 4548 / 4553      holders=4:  353 /  371   ← 快路径
holders=2: 4533 / 4503
```

阈值出现在第 4 个，与文件无关（生成的静音 WAV、系统 `Ding.wav`、真实 3 秒音频、HTTP 流结果一致）。保持 4 个持有者后连续 10 次 load 稳定 370–424 ms，静置 45 秒后仍 406 ms——不衰减。

**持有者必须是已打开且保持打开的 `MediaPlayer`**，仅仅是构造对象不算（3 个仅构造的对象 → 4977/4835/9412 ms）。已打开的失败资源也不算（4 个指向不存在路径的持有者，全部 `MediaFailed` → 4933/5135 ms）。

## 实现

`src/playback/host/wpf-media-host.ps1` 增加预热池，`src/playback/backends.mjs` 传 `-WarmHolders`（默认 4）：

- 持有者是 `Volume = 0` 且 `IsMuted = $true`、**从不 `Play()`** 的 `MediaPlayer`，各自 `Open()` 一个静音 WAV。
- **静音资源由宿主自己生成**（`Write-SilentWav`：8 kHz 单声道 16 位、0.5 秒、全零样本、8044 字节），写到 `%TEMP%\fishfm-warm-silence-<pid>.wav`，退出时删除。不随仓库提交：AGENTS.md 规定音频不入库，`.gitignore` 也忽略 `*.wav`。文件名带进程号，避免并发宿主争抢同一文件。
- **首个真实 load 仍然冷启动**，与今天完全一致：`$script:warmArmed` 只在首个 load 进入后置位。预热填池发生在随后的播放期间，因此任何真实 load 都不会被一次持有者 Open 抢在前面。
- 池一次只开一个，且**只在 `status = 'playing'` 且无 pending open 时**推进。这是必要的让步：持有者 Open 与真实 load 并发时真实 load 变慢（见下），所以预热让路给真实工作。
- 失败降级：`Fail-Warm` 是唯一的计数点（同步 `Open()` 抛异常、异步 `MediaFailed`、20 秒超时都走它），连续 3 次把 `warmPath` 置空；`-WarmHolders 0` 或资源写不出来时直接 `WARM_DISABLED`。冷引擎只是慢，不会坏。
- 事件归属靠 `$sender` 而不是共享标志位：多个持有者共用一种处理函数形状，共享标志位会让一个持有者的事件结算另一个。PS 5.1 下 `param($sender, $eventArgs)` 绑定正确（已验证 `senderIsC=True senderIsB=False`）。
- 退出时 `Stop-WarmHolders` 不仅关闭池中成员，也关闭在飞的那个，并删除生成的临时文件。
- `FISHFM_PLAYBACK_WARM_HOLDERS` 环境变量覆盖默认值（沿用已有的 `FISHFM_PLAYBACK_SHELL` 约定），非法值回落到 4。

### 为什么不是别的做法

- **启动时预开 4 个持有者**（第一版原型）：顺序填池要 14.6–19 s，首个 load 仍冷，且用户在这期间点播放反而更慢。被否决。
- **并发预开 4 个**：并行 Open 互相排队，全部就绪 14.6–16.5 s，真实 load 撞进去要 17 s。被否决。
- **持有者与真实 load 抢跑**：交错 A/B 实测真实 load 变慢（见下）。被否决。
- **取消在飞的持有者**：8.5–8.9 ms 级更差，且被取消的 `MediaPlayer` 状态不可复用。被否决。
- **持有者用与正在播放曲目相同的文件**：与静音文件效果相同（343 ms vs 341 ms），却与真实曲目争同一资源句柄。被否决。
- **让持有者减少到 3 个以下**：3 个以下不触发快路径（见阈值表）。4 是下界。

交错 A/B 原始数据（同一进程，两臂交替，各 4 次；「holder-in-flight」= 真实 load 与一个持有者 Open 并发）：

```
offset + 500ms   no-holder: [5211, 4606, 4558, 4613]   holder-in-flight: [8565, 8475, 8547, 8542]
offset +2500ms   no-holder: [4671, 4629, 4590, 4662]   holder-in-flight: [6554, 6497, 6501, 6706]
offset +4500ms   no-holder: [4594, 4562, 4571, 4568]   holder-in-flight: [7248, 4554, 4700, 4599]
```

## 验证

产品实际用的是 `pwsh`（`backends.mjs` 的 `powerShellCandidates` 把 `pwsh` 排在 in-box PowerShell 之前，实测生产宿主进程就是 `pwsh.exe`），因此宿主脚本依赖的机制在 `pwsh` 7 下单独验过，不只验了 5.1：

```
pwsh 7.6.4：WARM_READY count=1..4，opened flags True,True,True,True，预热后 load 362ms
pwsh 7.6.4：逐个增加持有者的阈值同为第 4 个（0/1/2/3 个 ≈4.5s，4 个 ≈0.35s）
```

事件归属靠 `$sender` 这一点在两种 shell 下都必须成立，因为**函数内局部变量的闭包在 5.1 和 7 里都不被事件回调看见**——探测脚本用函数内哈希表存标志位时，回调静默不触发（两种 shell 都复现），这正是实现改用 `param($sender, $eventArgs)` 并回查 `warmPool` 的原因。

端到端（真实宿主脚本 + 真实 supervisor/service，`-WarmHolders 4`）：

```
host ready: 1433ms
track 1 load (cold, as today): 5514ms
warm markers: WARM_CONFIGURED holders=4 | WARM_READY count=1..4
track 2 load: 455ms      track 3 load: 436ms      track 4 load: 438ms
```

产品流程（track 1 播放中在第 N 秒点下一首）：

| 点下一首的时刻 | 首曲（冷） | 下一首 | 池就绪 |
|---|---|---|---|
| t=3 s | 5331 ms | 6207 ms | 0/4 |
| t=8 s | 5277 ms | 5828 ms | 1/4 |
| t=15 s | 5236 ms | **548 ms** | 4/4 |
| t=25 s | 5216 ms | **452 ms** | 4/4 |

即：池填满前，下一首比今天差一点（6.2 s vs 冷启动 4.6–5.1 s，仍是同一量级）；填满后 5 秒变 0.5 秒。池约 15–16 s 填满，所以一首正常长度的歌之后的每次切歌都走快路径。这是本次修复的边界：**第一次播放不变，前 15 秒内的切歌略慢，之后显著变快。**

`warmHolders: 0` 关闭时与今天一致（track1 5306 ms / track2 5068 ms，标记 `WARM_DISABLED`）。

预热期间正在播放的曲目时间线不受影响（30 秒曲目，播放中填满 4 个持有者）：

```
total wall 16965ms; real advanced 16971ms; drift 6ms
ended fired during priming: False
```

进度事件正常（26 s 观察内 60 条 progress，`effectiveDeltaMs` 合计 25710 ms，未提前 ended）。

内存：4 个持有者使宿主进程 RSS 从 103 MB 升到 107 MB（+4 MB），静置 20 秒不增长。

新增 4 项测试（`test/playback-warm.test.mjs`，真实 WPF，带独立 `timeout` 因为填池需要真实播放时间）：

1. 池在播放期间填满且下一次 load < 2 s 且 < 冷启动一半；
2. `0` 时确实不预热、冷宿主照常服务；
3. 不给 `warmResource` 时宿主自己生成资源并照样填池（fresh clone 路径）；
4. `warmHoldersFromEnv` 的默认/范围/回落与 `-WarmHolders` 参数序列化。

全量 **382 项测试**、117 模块检查、构建通过。

## 复查后的修正

本节记录独立复查提出、并经二次独立确认后实际改动或明确不改的项。

**已改：**

- 静音资源不入库（原实现提交 `silence.wav` + 生成脚本 —— 违反 AGENTS.md「音频不入库」，且 `.gitignore` 的 `*.wav` 会让它在新克隆里消失，预热静默失效）。现由宿主生成到临时目录。
- 同步 `Open()` 抛异常时无限重试、`warmFailures` 无界增长（只有异步路径计数到上限）。现统一走 `Fail-Warm`。
- `Stop-WarmHolders` 漏关在飞的持有者。已补，并删除生成的临时文件。
- 测试用 20 秒曲目可能导致池未填满就曲终（填池约 15–16 s，余量随机器变慢而消失）。改为 45 秒静音曲目 + 条件等待。
- `dsh-adapter.mjs` 的 `start()`：`spawnCore()` 同步抛异常会逸出 Promise executor 并留下已启动但无人认领的子进程。已改为 try/catch + `kill()`，并实测「同步抛 → 拒绝 → 重试成功」。
- `core.mjs` 的 `stage()`：`finally` 里未保护的 `onLog` 会顶掉正在抛出的播放错误（`lastError` 从 `stop_boom` 变成 `onLog threw`）。已加 try/catch，实测错误保持。
- `backends.mjs` 增加 `FISHFM_PLAYBACK_WARM_HOLDERS` 覆盖（预热在早期窗口略慢，需要一个产品级开关）。

**确认但不改（并记录理由）：**

- `registerAdapter` 里几处 `onLog` 未走 `_log`：复查声称「`evidence.event` 会抛异常因而杀死宿主」。二次确认**证伪**：`safeEvidenceEvent`/`event` 对 null/字符串/数字/数组/畸形对象全不抛，唯一会抛的是带抛异常 getter 的对象，没有任何调用点会构造它；且实测安装的 `@deepseek-ai/dsh-session@0.2.0-rc.1` 在 `invokeContainedSessionObservers` 里用 try/catch 包住每个 `session/event` 监听器。不是隐患，只是与 `_log` 风格不一致，不改。
- `service.mjs` 的 `_onHostClose` 在 `active` 为空时直接返回（load 中掉线不计入 `recoveries`）。一度改成计数，随后改回并写明理由：`recoveries` 是「正在播放曲目的重连预算」，掉线时 load 会自行以 `pipe_closed` 拒绝、无泄漏（实测 160 ms 内拒绝），把预算花在失败的 load 上会让**之后**一次真正可恢复的掉线没有重试机会。

## 崩溃

DSH 崩溃与预热无关，是宿主进程内未捕获异常，两条路径都用 HEAD（生产正在跑的版本）复现：

1. `CoreBridge.request()` 只检查 `child.exitCode !== null`，而管道断开比 `exitCode` 落值早约 2 ms（实测 `stdin error +165ms` / `exit event +167ms`）。窗口内写入在 socket 上抛出未处理的 `'error'` 事件，Node 直接终结进程：`DSH-HOST-CRASH: EPIPE`。
2. `_dispatch` 直接读 `message.type`，无形状校验；Core stdout 上一行 `null` 即 `TypeError: Cannot read properties of null (reading 'type')`。

工作区已有的未提交改动已修复这两条（stdin/stdout/stderr 错误监听、`_failChild`、协议缓冲上限、pending 上限、`_dispatch` 形状校验），实测：HEAD 崩溃（exit 9），当前工作区 73737 次请求存活且崩溃后 `start()` 重启成功。**这些改动此前未部署**：生产 Core 进程 14:59:37 启动，相关文件 17:00–17:05 才改，evidence 里 `playback-stage` 事件数为 0（新版会记）。插件是 `link:D:/AI项目/dsh-音乐`，重载 DSH 即生效。

## 边界

- 阈值 4、以及「静音持有者也能预热」是在本机（Windows 11 22631、in-box PowerShell 5.1 与 `pwsh` 7、16 核）测得的。别的机器或音频设备可能不同；池大小是参数，`-WarmHolders` / `FISHFM_PLAYBACK_WARM_HOLDERS` 可调。
- 4 个持有者常驻，每个持有一个已打开的静音资源。实测 +4 MB RSS，20 秒内不增长；数小时量级的长期曲线未测。
- 短曲（< ~16 s）可能填不满池，此时下一首仍是冷速度。这是「不抢跑」的代价，选择接受。
- 池填满前的第一段窗口（约 15 s 内）切歌比今天略慢（6.2 s vs 4.6–5.1 s）。已提供 `FISHFM_PLAYBACK_WARM_HOLDERS=0` 回到旧行为。
- 预热只覆盖媒体打开。真实平台句柄过期后的重解析（`resolve`）仍走网络，不在本文范围。
- 宿主崩溃会留下一个 8 KB 的 `%TEMP%\fishfm-warm-silence-<pid>.wav`（正常退出会删除）。
